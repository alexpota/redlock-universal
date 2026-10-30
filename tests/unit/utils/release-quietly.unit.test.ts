import { describe, it, expect, vi } from 'vitest';
import { releaseQuietly } from '../../../src/utils/release-quietly.js';
import { RELEASE_WITH_SCRIPT_BODY } from '../../../src/adapters/script-execution.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';

/** Long enough for the release and any rejection to settle */
const SETTLE_MS = 20;
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, SETTLE_MS));

describe('releaseQuietly', () => {
  it('should send the script body when the adapter can, so an empty script cache does not matter', async () => {
    const withScriptBody = vi.fn().mockResolvedValue(true);
    const adapter = {
      delIfMatch: vi.fn().mockResolvedValue(true),
      [RELEASE_WITH_SCRIPT_BODY]: withScriptBody,
    } as unknown as RedisAdapter;

    releaseQuietly(adapter, 'lock', 'value');
    await settle();

    expect(withScriptBody).toHaveBeenCalledWith('lock', 'value');
    expect(adapter.delIfMatch).not.toHaveBeenCalled();
  });

  it('should fall back to delIfMatch for adapters without it', async () => {
    const adapter = { delIfMatch: vi.fn().mockResolvedValue(true) } as unknown as RedisAdapter;

    releaseQuietly(adapter, 'lock', 'value');
    await settle();

    expect(adapter.delIfMatch).toHaveBeenCalledWith('lock', 'value');
  });

  it('should neither throw nor leave an unhandled rejection when the release fails', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const rejecting = {
        [RELEASE_WITH_SCRIPT_BODY]: vi.fn().mockRejectedValue(new Error('timed out')),
      } as unknown as RedisAdapter;
      const throwing = {
        delIfMatch: vi.fn(() => {
          throw new Error('client closed');
        }),
      } as unknown as RedisAdapter;

      expect(() => releaseQuietly(rejecting, 'lock', 'value')).not.toThrow();
      expect(() => releaseQuietly(throwing, 'lock', 'value')).not.toThrow();
      await settle();

      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('should log a release that fails at debug level when a logger is given', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const adapter = {
      delIfMatch: vi.fn().mockRejectedValue(new Error('Operation timed out after 5000ms')),
    } as unknown as RedisAdapter;

    releaseQuietly(adapter, 'lock', 'secret-value', logger);
    await settle();

    expect(logger.debug).toHaveBeenCalledWith(
      'Release after a failed lock attempt did not complete',
      { key: 'lock', error: 'Operation timed out after 5000ms' }
    );
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('secret-value');
  });

  it('should not surface an error thrown by the logger', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const logger = {
        debug: vi.fn(() => {
          throw new Error('logger broke');
        }),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const adapter = {
        delIfMatch: vi.fn().mockRejectedValue(new Error('down')),
      } as unknown as RedisAdapter;

      releaseQuietly(adapter, 'lock', 'value', logger);
      await settle();

      expect(logger.debug).toHaveBeenCalledTimes(1);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
