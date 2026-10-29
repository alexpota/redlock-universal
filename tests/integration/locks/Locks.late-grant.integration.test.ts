import { describe, it, expect, afterEach } from 'vitest';
import Redis from 'ioredis';
import {
  createLock,
  createRedlock,
  IoredisAdapter,
  LockAcquisitionError,
  LockManager,
} from '../../../src/index.js';
import type { LockHandle } from '../../../src/types/locks.js';
import { delay, generateTestKey, getRedisUrl, REDIS_CONFIG } from '../../shared/constants.js';
import { startReplyDelayProxy, type ReplyDelayProxy } from '../../shared/reply-delay-proxy.js';

const TTL = 300;
/** Replies arrive after the key has already expired on the server */
const LATE_REPLY_MS = 450;
const LONG_TTL = 2_000;
/** Replies arrive within the TTL, late enough to show up in the server's PTTL */
const SLOW_REPLY_MS = 150;
const DRIFT_FACTOR = 0.01;
const DRIFT_PADDING_MS = 2;
/** PTTL has 1 ms resolution */
const PTTL_RESOLUTION_MS = 1;
const POLL_DELAY_MS = 20;
const POLL_DEADLINE_MS = 2_000;
const TEST_TIMEOUT_MS = 15_000;

/** Databases on one server stand in for independent Redis nodes */
const NODE_DATABASES = [0, 1, 2] as const;

const server = new URL(getRedisUrl());
const host = server.hostname;
const port = Number(server.port) || REDIS_CONFIG.DEFAULT_PORT;

const driftFor = (ttl: number): number => Math.floor(ttl * DRIFT_FACTOR) + DRIFT_PADDING_MS;

interface Holder {
  acquire(): Promise<LockHandle[]>;
  readonly databases: readonly number[];
}

type Connect = (db: number) => Redis;
type Producer = (key: string, ttl: number, connect: Connect) => Holder;

const PRODUCERS: Record<string, Producer> = {
  SimpleLock: (key, ttl, connect) => {
    const lock = createLock({
      adapter: new IoredisAdapter(connect(0)),
      key,
      ttl,
      retryAttempts: 0,
      circuitBreaker: false,
    });
    return { acquire: async () => [await lock.acquire()], databases: [0] };
  },
  LeanSimpleLock: (key, ttl, connect) => {
    const lock = createLock({
      adapter: new IoredisAdapter(connect(0)),
      key,
      ttl,
      retryAttempts: 0,
      performance: 'lean',
    });
    return { acquire: async () => [await lock.acquire()], databases: [0] };
  },
  RedLock: (key, ttl, connect) => {
    const lock = createRedlock({
      adapters: NODE_DATABASES.map(db => new IoredisAdapter(connect(db))),
      key,
      ttl,
      retryAttempts: 0,
    });
    return { acquire: async () => [await lock.acquire()], databases: NODE_DATABASES };
  },
  'LockManager.acquireBatch': (key, ttl, connect) => {
    const manager = new LockManager({ nodes: [new IoredisAdapter(connect(0))] });
    return {
      acquire: () => manager.acquireBatch([`${key}:a`, `${key}:b`], { ttl, retryAttempts: 0 }),
      databases: [0],
    };
  },
};

describe.each(Object.entries(PRODUCERS))('%s with late replies', (_name, produce) => {
  const clients: Redis[] = [];
  let proxy: ReplyDelayProxy | undefined;

  const connectTo =
    (targetPort: number): Connect =>
    db => {
      const client = new Redis({ host, port: targetPort, db });
      clients.push(client);
      return client;
    };
  const direct = connectTo(port);

  /** Connect a holder through a proxy that delays every reply */
  const behindProxy = async (key: string, ttl: number, replyDelay: number): Promise<Holder> => {
    proxy = await startReplyDelayProxy(host, port, replyDelay);
    const connected: Redis[] = [];
    const holder = produce(key, ttl, db => {
      const client = connectTo(proxy!.port)(db);
      connected.push(client);
      return client;
    });
    await Promise.all(connected.map(client => client.ping()));
    return holder;
  };

  const acquireWhenFree = async (holder: Holder): Promise<LockHandle[]> => {
    const deadline = Date.now() + POLL_DEADLINE_MS;
    for (;;) {
      try {
        return await holder.acquire();
      } catch (error) {
        if (Date.now() > deadline) {
          throw error;
        }
        await delay(POLL_DELAY_MS);
      }
    }
  };

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.disconnect();
    }
    await proxy?.close();
    proxy = undefined;
  });

  it(
    'rejects a grant that arrives after its validity time and leaves the next holder alone',
    async () => {
      const key = generateTestKey('late-grant');
      const late = await behindProxy(key, TTL, LATE_REPLY_MS);
      // The competitor's lock outlives the late holder's attempt, so a wrong release would show
      const competitor = produce(key, LONG_TTL, direct);

      const lateOutcome = late.acquire().then(
        handles => ({ handles, error: undefined }),
        (error: unknown) => ({ handles: undefined, error })
      );
      const competitorHandles = await acquireWhenFree(competitor);
      const { handles, error } = await lateOutcome;

      expect(handles).toBeUndefined();
      expect(error).toBeInstanceOf(LockAcquisitionError);
      expect((error as Error).message).toMatch(/validity time exceeded/i);

      const readers = competitor.databases.map(db => direct(db));
      for (const handle of competitorHandles) {
        const values = await Promise.all(readers.map(reader => reader.get(handle.key)));
        expect(values).toContain(handle.value);
      }
    },
    TEST_TIMEOUT_MS
  );

  it(
    'never reports more lock time than the server holds',
    async () => {
      const key = generateTestKey('late-grant-pttl');
      const slow = await behindProxy(key, LONG_TTL, SLOW_REPLY_MS);
      const readers = slow.databases.map(db => direct(db));
      await Promise.all(readers.map(reader => reader.ping()));

      const handles = await slow.acquire();

      for (const handle of handles) {
        const believedRemaining = handle.acquiredAt + LONG_TTL - driftFor(LONG_TTL) - Date.now();
        for (const reader of readers) {
          const startedAt = performance.now();
          const [value, pttl] = await Promise.all([
            reader.get(handle.key),
            reader.pttl(handle.key),
          ]);
          const roundTrip = performance.now() - startedAt;
          if (value === handle.value) {
            expect(believedRemaining).toBeLessThanOrEqual(pttl + roundTrip + PTTL_RESOLUTION_MS);
          }
        }
      }
    },
    TEST_TIMEOUT_MS
  );
});
