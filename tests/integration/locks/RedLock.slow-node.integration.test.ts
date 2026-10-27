import { describe, it, expect, afterEach } from 'vitest';
import Redis from 'ioredis';
import { createRedlock, IoredisAdapter } from '../../../src/index.js';
import type { LockHandle } from '../../../src/types/locks.js';
import { delay, generateTestKey, getRedisUrl, REDIS_CONFIG } from '../../shared/constants.js';
import { startReplyDelayProxy, type ReplyDelayProxy } from '../../shared/reply-delay-proxy.js';

const TTL = 10_000;
/** One node answers 16% of the TTL late; requests still reach it at once */
const SLOW_REPLY_MS = 1_600;
/** A second client starts polling shortly before the original expiry */
const COMPETITOR_START_MS = TTL - 500;
/** The routine keeps running well past the original expiry */
const ROUTINE_MS = TTL + 3_000;
const POLL_INTERVAL_MS = 100;
const TEST_TIMEOUT_MS = 30_000;

/** Databases on one server stand in for independent Redis nodes */
const NODE_DATABASES = [0, 1, 2] as const;

describe('RedLock using() with a slow node', () => {
  const clients: Redis[] = [];
  let proxy: ReplyDelayProxy | undefined;

  const connect = (port: number, db: number, host: string): Redis => {
    const client = new Redis({ host, port, db });
    clients.push(client);
    return client;
  };

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.disconnect();
    }
    await proxy?.close();
    proxy = undefined;
  });

  it(
    'keeps exclusive ownership while one node replies late',
    async () => {
      const server = new URL(getRedisUrl());
      const host = server.hostname;
      const port = Number(server.port) || REDIS_CONFIG.DEFAULT_PORT;
      proxy = await startReplyDelayProxy(host, port, SLOW_REPLY_MS);

      const [dbA, dbB, dbC] = NODE_DATABASES;
      const key = generateTestKey('redlock:slow-node');
      const holder = createRedlock({
        adapters: [
          new IoredisAdapter(connect(port, dbA, host)),
          new IoredisAdapter(connect(port, dbB, host)),
          new IoredisAdapter(connect(proxy.port, dbC, '127.0.0.1')),
        ],
        key,
        ttl: TTL,
        retryAttempts: 0,
      });
      const competitor = createRedlock({
        adapters: NODE_DATABASES.map(db => new IoredisAdapter(connect(port, db, host))),
        key,
        ttl: TTL,
        retryAttempts: 0,
      });

      let competitorHandle: LockHandle | undefined;
      let competitorAcquiredMs: number | undefined;
      let signalAbortedMs: number | undefined;
      const startedAt = Date.now();
      const elapsed = (): number => Date.now() - startedAt;

      await holder.using(async signal => {
        signal.addEventListener('abort', () => {
          signalAbortedMs = elapsed();
        });

        while (!signal.aborted && elapsed() < ROUTINE_MS) {
          if (!competitorHandle && elapsed() >= COMPETITOR_START_MS) {
            try {
              competitorHandle = await competitor.acquire();
              competitorAcquiredMs = elapsed();
            } catch {
              // Still held by the routine
            }
          }
          await delay(POLL_INTERVAL_MS);
        }
      });

      if (competitorHandle) {
        await competitor.release(competitorHandle);
      }

      expect(competitorAcquiredMs, 'second client acquired the lock during the routine').toBe(
        undefined
      );
      expect(signalAbortedMs, 'routine signal aborted').toBe(undefined);
    },
    TEST_TIMEOUT_MS
  );
});
