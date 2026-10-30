import { describe, it, expect, vi } from 'vitest';
import { IoredisAdapter } from '../../../src/adapters/IoredisAdapter.js';
import { NodeRedisAdapter } from '../../../src/adapters/NodeRedisAdapter.js';
import { GlideAdapter } from '../../../src/adapters/GlideAdapter.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';

const clientError = new Error('connect ECONNREFUSED 127.0.0.1:6379');
const failing = () => vi.fn().mockRejectedValue(clientError);

const ADAPTERS: Record<string, () => RedisAdapter> = {
  ioredis: () =>
    new IoredisAdapter({
      set: failing(),
      get: failing(),
      del: failing(),
      ping: failing(),
      status: 'ready',
    } as never),
  'node-redis': () =>
    new NodeRedisAdapter({
      set: failing(),
      get: failing(),
      del: failing(),
      ping: failing(),
      isReady: true,
    } as never),
  GLIDE: () =>
    new GlideAdapter({
      set: failing(),
      get: failing(),
      del: failing(),
      customCommand: failing(),
    } as never),
};

const OPERATIONS: Array<[string, (adapter: RedisAdapter) => Promise<unknown>, string]> = [
  ['setNX', adapter => adapter.setNX('key', 'value', 1_000), 'Failed to acquire lock'],
  ['get', adapter => adapter.get('key'), 'Failed to get key'],
  ['del', adapter => adapter.del('key'), 'Failed to delete key'],
  ['ping', adapter => adapter.ping(), 'Ping failed'],
];

describe.each(Object.entries(ADAPTERS))('%s adapter errors', (_name, createAdapter) => {
  it.each(OPERATIONS)(
    '%s keeps the client error as cause and the same message',
    async (_operation, run, prefix) => {
      const error = await run(createAdapter()).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(`${prefix}: ${clientError.message}`);
      expect((error as Error).cause).toBe(clientError);
    }
  );
});
