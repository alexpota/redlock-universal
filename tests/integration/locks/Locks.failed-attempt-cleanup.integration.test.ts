import { describe, it, expect, afterEach } from 'vitest';
import Redis from 'ioredis';
import { createClient } from 'redis';
import { GlideClient } from '@valkey/valkey-glide';
import {
  createLock,
  createRedlock,
  GlideAdapter,
  IoredisAdapter,
  LockAcquisitionError,
  LockManager,
  NodeRedisAdapter,
} from '../../../src/index.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';
import { delay, generateTestKey, getRedisUrl, REDIS_CONFIG } from '../../shared/constants.js';
import { startReplyDelayProxy, type ReplyDelayProxy } from '../../shared/reply-delay-proxy.js';

/** Long enough that a key left behind would still be there when checked */
const TTL = 10_000;
const COMMAND_TIMEOUT_MS = 200;
/** Replies arrive after the client has given up on the command */
const LATE_REPLY_MS = 600;
/** Time for a release sent after the timeout to reach the server */
const SETTLE_MS = 150;
/** Slack for scheduling on a busy machine */
const TIMING_MARGIN_MS = 150;
const TEST_TIMEOUT_MS = 15_000;

/** Databases on one server stand in for independent Redis nodes */
const NODE_DATABASES = [0, 1, 2] as const;

const server = new URL(getRedisUrl());
const host = server.hostname;
const port = Number(server.port) || REDIS_CONFIG.DEFAULT_PORT;

interface Connection {
  readonly adapter: RedisAdapter;
  close(): Promise<void>;
}

const CLIENTS: Record<string, (proxyPort: number, db: number) => Promise<Connection>> = {
  ioredis: async (proxyPort, db) => {
    const client = new Redis({ host: '127.0.0.1', port: proxyPort, db });
    await client.ping();
    return {
      adapter: new IoredisAdapter(client, { timeout: COMMAND_TIMEOUT_MS }),
      close: async () => client.disconnect(),
    };
  },
  'node-redis': async (proxyPort, db) => {
    const client = createClient({ socket: { host: '127.0.0.1', port: proxyPort }, database: db });
    client.on('error', () => {});
    await client.connect();
    return {
      adapter: new NodeRedisAdapter(client, { timeout: COMMAND_TIMEOUT_MS }),
      close: async () => {
        await client.disconnect().catch(() => {});
      },
    };
  },
  GLIDE: async (proxyPort, db) => {
    const client = await GlideClient.createClient({
      addresses: [{ host: '127.0.0.1', port: proxyPort }],
      databaseId: db,
      requestTimeout: COMMAND_TIMEOUT_MS,
    });
    return {
      adapter: new GlideAdapter(client, { timeout: COMMAND_TIMEOUT_MS }),
      close: async () => client.close(),
    };
  },
};

interface Holder {
  acquire(): Promise<unknown>;
  /** Database and key of every lock the holder tries to take */
  readonly locks: ReadonlyArray<readonly [number, string]>;
}

type Producer = (key: string, connect: (db: number) => Promise<RedisAdapter>) => Promise<Holder>;

const PRODUCERS: Record<string, Producer> = {
  SimpleLock: async (key, connect) => {
    const lock = createLock({
      adapter: await connect(0),
      key,
      ttl: TTL,
      retryAttempts: 0,
      circuitBreaker: false,
    });
    return { acquire: () => lock.acquire(), locks: [[0, key]] };
  },
  LeanSimpleLock: async (key, connect) => {
    const lock = createLock({
      adapter: await connect(0),
      key,
      ttl: TTL,
      retryAttempts: 0,
      performance: 'lean',
    });
    return { acquire: () => lock.acquire(), locks: [[0, key]] };
  },
  RedLock: async (key, connect) => {
    const adapters = await Promise.all(NODE_DATABASES.map(db => connect(db)));
    const lock = createRedlock({ adapters, key, ttl: TTL, retryAttempts: 0 });
    return { acquire: () => lock.acquire(), locks: NODE_DATABASES.map(db => [db, key] as const) };
  },
  'LockManager.acquireBatch': async (key, connect) => {
    const manager = new LockManager({ nodes: [await connect(0)] });
    const keys = [`${key}:a`, `${key}:b`];
    return {
      acquire: () => manager.acquireBatch(keys, { ttl: TTL, retryAttempts: 0 }),
      locks: keys.map(batchKey => [0, batchKey] as const),
    };
  },
};

describe.each(Object.entries(CLIENTS))('%s attempt that times out', (_client, connectVia) => {
  const connections: Connection[] = [];
  const readers: Redis[] = [];
  let proxy: ReplyDelayProxy | undefined;

  /** Holder whose replies arrive after its command timeout */
  const timingOut = async (produce: Producer, key: string): Promise<Holder> => {
    proxy = await startReplyDelayProxy(host, port, 0);
    const holder = await produce(key, async db => {
      const connection = await connectVia(proxy!.port, db);
      connections.push(connection);
      return connection.adapter;
    });
    proxy.setReplyDelay(LATE_REPLY_MS);
    return holder;
  };

  const reader = (db: number): Redis => {
    const client = new Redis({ host, port, db });
    readers.push(client);
    return client;
  };

  afterEach(async () => {
    await Promise.all(connections.splice(0).map(connection => connection.close()));
    for (const client of readers.splice(0)) {
      client.disconnect();
    }
    await proxy?.close();
    proxy = undefined;
  });

  it.each(Object.entries(PRODUCERS))(
    'removes the keys a timed-out %s attempt set',
    async (_producer, produce) => {
      const holder = await timingOut(produce, generateTestKey('timed-out-attempt'));

      await expect(holder.acquire()).rejects.toBeInstanceOf(LockAcquisitionError);
      await delay(SETTLE_MS);

      for (const [db, key] of holder.locks) {
        expect(await reader(db).get(key)).toBeNull();
      }
    },
    TEST_TIMEOUT_MS
  );

  it(
    'gives up after the command timeout without waiting for releases or leaving rejections',
    async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
      };
      process.on('unhandledRejection', onUnhandled);
      try {
        const holder = await timingOut(PRODUCERS.RedLock!, generateTestKey('hung-release'));

        const startedAt = performance.now();
        await expect(holder.acquire()).rejects.toBeInstanceOf(LockAcquisitionError);
        const elapsed = performance.now() - startedAt;

        expect(elapsed).toBeLessThan(COMMAND_TIMEOUT_MS + TIMING_MARGIN_MS);
        await delay(LATE_REPLY_MS + COMMAND_TIMEOUT_MS);
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    },
    TEST_TIMEOUT_MS
  );
});
