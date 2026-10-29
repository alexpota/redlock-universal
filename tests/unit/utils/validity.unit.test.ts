import { describe, it, expect, vi } from 'vitest';
import { releaseQuietly } from '../../../src/utils/validity.js';
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
});
