import { describe, it, expect, vi } from 'vitest';
import { IoredisAdapter } from '../../../src/adapters/IoredisAdapter.js';
import { NodeRedisAdapter } from '../../../src/adapters/NodeRedisAdapter.js';
import { GlideAdapter } from '../../../src/adapters/GlideAdapter.js';
import { BaseAdapter, DELETE_IF_MATCH_SCRIPT } from '../../../src/adapters/BaseAdapter.js';
import {
  RELEASE_WITH_SCRIPT_BODY,
  type ReleaseWithScriptBody,
} from '../../../src/adapters/script-execution.js';

const release = (adapter: unknown): ReleaseWithScriptBody[typeof RELEASE_WITH_SCRIPT_BODY] => {
  const method = (adapter as ReleaseWithScriptBody)[RELEASE_WITH_SCRIPT_BODY];
  return method.bind(adapter);
};

describe('release that sends the script body', () => {
  it('ioredis sends EVAL with the script, never EVALSHA', async () => {
    const client = { call: vi.fn().mockResolvedValue(1), evalsha: vi.fn(), status: 'ready' };
    const adapter = new IoredisAdapter(client as never, { keyPrefix: 'app:' });

    await expect(release(adapter)('lock', 'value')).resolves.toBe(true);

    expect(client.call).toHaveBeenCalledWith(
      'eval',
      DELETE_IF_MATCH_SCRIPT,
      1,
      'app:lock',
      'value'
    );
    expect(client.evalsha).not.toHaveBeenCalled();
  });

  it('node-redis sends EVAL with the script, never EVALSHA', async () => {
    const client = { EVAL: vi.fn().mockResolvedValue(1), evalSha: vi.fn(), isReady: true };
    const adapter = new NodeRedisAdapter(client);

    await expect(release(adapter)('lock', 'value')).resolves.toBe(true);

    expect(client.EVAL).toHaveBeenCalledWith(DELETE_IF_MATCH_SCRIPT, {
      keys: ['lock'],
      arguments: ['value'],
    });
    expect(client.evalSha).not.toHaveBeenCalled();
  });

  it('GLIDE sends EVAL with the script, never EVALSHA', async () => {
    const client = { customCommand: vi.fn().mockResolvedValue(0) };
    const adapter = new GlideAdapter(client as never);

    await expect(release(adapter)('lock', 'value')).resolves.toBe(false);

    expect(client.customCommand).toHaveBeenCalledWith([
      'EVAL',
      DELETE_IF_MATCH_SCRIPT,
      '1',
      'lock',
      'value',
    ]);
    expect(client.customCommand).toHaveBeenCalledTimes(1);
  });

  it('falls back to delIfMatch for a custom adapter without script calls', async () => {
    const custom = Object.assign(Object.create(BaseAdapter.prototype) as BaseAdapter, {
      delIfMatch: vi.fn().mockResolvedValue(true),
    });

    await expect(release(custom)('lock', 'value')).resolves.toBe(true);

    expect(custom.delIfMatch).toHaveBeenCalledWith('lock', 'value');
  });
});
