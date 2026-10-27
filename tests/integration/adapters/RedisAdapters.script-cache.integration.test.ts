import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Redis from 'ioredis';
import { createClient } from 'redis';
import { GlideClient } from '@valkey/valkey-glide';
import { GlideAdapter, IoredisAdapter, NodeRedisAdapter } from '../../../src/index.js';
import {
  ATOMIC_EXTEND_SCRIPT,
  BATCH_ACQUIRE_SCRIPT,
  DELETE_IF_MATCH_SCRIPT,
  EXTEND_IF_MATCH_SCRIPT,
  INSPECT_SCRIPT,
  REDIS_SCRIPT_SUCCESS,
} from '../../../src/adapters/BaseAdapter.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';
import { generateTestKey, getRedisUrl, REDIS_CONFIG } from '../../shared/constants.js';
import { scriptSha } from '../../shared/scripts.js';

const TTL = 10_000;
const MIN_TTL = 1_000;
const LOCK_SCRIPTS = [
  DELETE_IF_MATCH_SCRIPT,
  EXTEND_IF_MATCH_SCRIPT,
  ATOMIC_EXTEND_SCRIPT,
  INSPECT_SCRIPT,
  BATCH_ACQUIRE_SCRIPT,
];

interface Target {
  readonly adapter: RedisAdapter;
  close(): Promise<void>;
}

const server = new URL(getRedisUrl());
const host = server.hostname;
const port = Number(server.port) || REDIS_CONFIG.DEFAULT_PORT;

const TARGETS: Record<string, () => Promise<Target>> = {
  ioredis: async () => {
    const client = new Redis(getRedisUrl());
    return { adapter: new IoredisAdapter(client), close: async () => client.disconnect() };
  },
  'node-redis': async () => {
    const client = createClient({ url: getRedisUrl() });
    await client.connect();
    return {
      adapter: new NodeRedisAdapter(client),
      close: async () => {
        await client.disconnect();
      },
    };
  },
  GLIDE: async () => {
    const client = await GlideClient.createClient({ addresses: [{ host, port }] });
    return { adapter: new GlideAdapter(client), close: async () => client.close() };
  },
};

describe.each(Object.entries(TARGETS))(
  '%s adapter after the script cache is flushed',
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

    const runLockScripts = async (): Promise<void> => {
      const { adapter } = target;
      const key = generateTestKey('script-cache');
      const value = 'owner';
      const batchKeys = [generateTestKey('script-cache:a'), generateTestKey('script-cache:b')];

      expect(await adapter.setNX(key, value, TTL)).toBe('OK');
      expect(await adapter.extendIfMatch(key, value, TTL)).toBe(true);
      expect((await adapter.atomicExtend(key, value, MIN_TTL, TTL)).resultCode).toBe(
        REDIS_SCRIPT_SUCCESS
      );
      expect(await adapter.inspect(key)).toMatchObject({ value });
      expect(await adapter.delIfMatch(key, value)).toBe(true);
      expect((await adapter.batchSetNX(batchKeys, [value, value], TTL)).success).toBe(true);
      for (const batchKey of batchKeys) {
        expect(await adapter.delIfMatch(batchKey, value)).toBe(true);
      }
    };

    it('runs every lock script and caches it again', async () => {
      // The adapter has used every script before the server loses them
      await runLockScripts();
      await admin.script('FLUSH');

      await runLockScripts();

      expect(await admin.script('EXISTS', ...LOCK_SCRIPTS.map(scriptSha))).toEqual(
        LOCK_SCRIPTS.map(() => 1)
      );
    });
  }
);
