import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Redis from 'ioredis';
import * as nodeRedis from 'redis';
import { createLock, IoredisAdapter, NodeRedisAdapter } from '../../../src/index.js';
import { REDIS_SCRIPT_SUCCESS } from '../../../src/adapters/BaseAdapter.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';
import { generateTestKey, getRedisUrl } from '../../shared/constants.js';

/** Set on the client, not on the adapter (node-redis applies it from 6.1) */
const CLIENT_KEY_PREFIX = 'client-prefix:';
const TTL = 10_000;
const MIN_TTL = 1_000;

interface Target {
  readonly adapter: RedisAdapter;
  close(): Promise<void>;
}

interface NodeRedisPool {
  connect(): Promise<unknown>;
  close?: () => Promise<unknown>;
  destroy?: () => void;
}

/** createClientPool exists from node-redis 5 */
const createClientPool = (
  nodeRedis as unknown as {
    createClientPool?: (options: { url: string; keyPrefix: string }) => NodeRedisPool;
  }
).createClientPool;

const TARGETS: Record<string, () => Promise<Target>> = {
  ioredis: async () => {
    const client = new Redis(getRedisUrl(), { keyPrefix: CLIENT_KEY_PREFIX });
    return { adapter: new IoredisAdapter(client), close: async () => client.disconnect() };
  },
  'node-redis': async () => {
    const options = { url: getRedisUrl(), keyPrefix: CLIENT_KEY_PREFIX };
    const client = nodeRedis.createClient(options);
    await client.connect();
    return {
      adapter: new NodeRedisAdapter(client),
      close: async () => {
        await client.disconnect();
      },
    };
  },
  ...(createClientPool && {
    'node-redis pool': async (): Promise<Target> => {
      const pool = createClientPool({ url: getRedisUrl(), keyPrefix: CLIENT_KEY_PREFIX });
      await pool.connect();
      return {
        adapter: new NodeRedisAdapter(pool),
        close: async () => {
          await (pool.close ?? pool.destroy)?.call(pool);
        },
      };
    },
  }),
};

describe.each(Object.entries(TARGETS))(
  '%s client with its own key prefix',
  (_name, createTarget) => {
    let admin: Redis;
    let target: Target;

    beforeAll(async () => {
      admin = new Redis(getRedisUrl());
      target = await createTarget();
    });

    afterAll(async () => {
      await target?.close();
      admin?.disconnect();
    });

    it('acquires, extends and releases a lock', async () => {
      const { adapter } = target;
      const key = generateTestKey('key-prefix');
      const lock = createLock({ adapter, key, ttl: TTL, retryAttempts: 0 });

      const handle = await lock.acquire();
      // Clients that support a prefix store the lock under it; older ones ignore the option
      expect(await admin.exists(`${CLIENT_KEY_PREFIX}${key}`, key)).toBe(1);

      expect(await lock.extend(handle, TTL)).toBe(true);
      expect((await adapter.atomicExtend(key, handle.value, MIN_TTL, TTL)).resultCode).toBe(
        REDIS_SCRIPT_SUCCESS
      );
      expect(await adapter.inspect(key)).toMatchObject({ value: handle.value });
      expect(await lock.release(handle)).toBe(true);

      expect(await admin.exists(`${CLIENT_KEY_PREFIX}${key}`, key)).toBe(0);
    });
  }
);
