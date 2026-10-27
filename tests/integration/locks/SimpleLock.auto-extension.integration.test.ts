import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Redis from 'ioredis';
import { createLock, IoredisAdapter } from '../../../src/index.js';
import { delay, generateTestKey, getRedisUrl } from '../../shared/constants.js';

/** Extensions are due once 80% of the TTL has been consumed */
const EXTENSION_POINT = 0.8;
const IN_FLIGHT_TTL = 3_000;
const SHORT_TTLS = [1_000, 1_250] as const;
const ROUTINE_MS = 2_000;
const TEST_TIMEOUT_MS = 15_000;

/**
 * Records the start time of every atomic extension and reports the first one.
 */
function trackExtensions(adapter: IoredisAdapter): {
  readonly calls: number[];
  readonly first: Promise<void>;
} {
  const calls: number[] = [];
  let markFirst!: () => void;
  const first = new Promise<void>(resolve => {
    markFirst = resolve;
  });
  const atomicExtend = adapter.atomicExtend.bind(adapter);

  adapter.atomicExtend = (...args: Parameters<IoredisAdapter['atomicExtend']>) => {
    calls.push(Date.now());
    markFirst();
    return atomicExtend(...args);
  };

  return { calls, first };
}

describe('SimpleLock using() auto-extension timing', () => {
  let client: Redis;

  beforeEach(() => {
    client = new Redis(getRedisUrl());
  });

  afterEach(() => {
    client.disconnect();
  });

  it(
    'stops extending once using() returns during an extension',
    async () => {
      const adapter = new IoredisAdapter(client);
      const extensions = trackExtensions(adapter);
      const lock = createLock({
        adapter,
        key: generateTestKey('simplelock:extension:in-flight'),
        ttl: IN_FLIGHT_TTL,
      });
      let routineSignal: AbortSignal | undefined;

      await lock.using(async signal => {
        routineSignal = signal;
        // Return while the first extension is still in flight
        await extensions.first;
      });
      const returnedAt = Date.now();

      await delay(IN_FLIGHT_TTL + 500);

      expect(extensions.calls.filter(at => at >= returnedAt)).toEqual([]);
      expect(routineSignal?.aborted).toBe(false);
    },
    TEST_TIMEOUT_MS
  );

  for (const ttl of SHORT_TTLS) {
    it(
      `extends about once per ${EXTENSION_POINT * 100}% of a ${ttl}ms TTL`,
      async () => {
        const adapter = new IoredisAdapter(client);
        const extensions = trackExtensions(adapter);
        const lock = createLock({
          adapter,
          key: generateTestKey('simplelock:extension:short-ttl'),
          ttl,
        });
        let abortedDuringRoutine = true;

        await lock.using(async signal => {
          await delay(ROUTINE_MS);
          abortedDuringRoutine = signal.aborted;
        });

        const expectedMax = Math.ceil(ROUTINE_MS / (ttl * EXTENSION_POINT)) + 1;
        expect(extensions.calls.length).toBeLessThanOrEqual(expectedMax);
        expect(abortedDuringRoutine).toBe(false);
      },
      TEST_TIMEOUT_MS
    );
  }
});
