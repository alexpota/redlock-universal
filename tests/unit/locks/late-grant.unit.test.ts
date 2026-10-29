import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SimpleLock } from '../../../src/locks/SimpleLock.js';
import { LeanSimpleLock } from '../../../src/locks/LeanSimpleLock.js';
import { RedLock } from '../../../src/locks/RedLock.js';
import { LockManager } from '../../../src/manager/LockManager.js';
import { LockAcquisitionError } from '../../../src/types/errors.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';
import type { LockHandle } from '../../../src/types/locks.js';

const TTL = 1_000;
/** Clock drift allowance for TTL: floor(TTL × 0.01) + 2 ms */
const DRIFT = 12;
const START_TIME = 1_700_000_000_000;
const NTP_STEP_BACK = 5_000;

/** One acquisition attempt: how long the reply takes and whether the lock was set */
interface Attempt {
  readonly delay: number;
  readonly granted: boolean;
  /** Wall-clock change during the attempt, when it differs from the elapsed time */
  readonly wallShift?: number;
}

interface Scenario {
  acquire(): Promise<LockHandle[]>;
  /** Key and value of every delIfMatch call */
  released(): Array<[string, string]>;
}

let monotonicNow = 0;
let wallNow = START_TIME;

const elapse = (attempt: Attempt): void => {
  monotonicNow += attempt.delay;
  wallNow += attempt.wallShift ?? attempt.delay;
};

/** Node that replies to each attempt in turn; only a slow node moves the clocks */
const createNode = (attempts: readonly Attempt[], slow = true): RedisAdapter => {
  let call = 0;
  const next = (): Attempt => {
    const attempt = attempts[Math.min(call++, attempts.length - 1)]!;
    if (slow) {
      elapse(attempt);
    }
    return attempt;
  };

  return {
    setNX: vi.fn(async () => (next().granted ? 'OK' : null)),
    batchSetNX: vi.fn(async (keys: string[]) =>
      next().granted
        ? { success: true, acquiredCount: keys.length }
        : { success: false, acquiredCount: 0, failedKey: keys[0], failedIndex: 1 }
    ),
    delIfMatch: vi.fn().mockResolvedValue(true),
    ping: vi.fn().mockResolvedValue('PONG'),
    isConnected: vi.fn().mockReturnValue(true),
  } as unknown as RedisAdapter;
};

const releasedBy = (adapter: RedisAdapter): Array<[string, string]> =>
  vi.mocked(adapter.delIfMatch).mock.calls as Array<[string, string]>;

const SCENARIOS: Record<string, (attempts: readonly Attempt[]) => Scenario> = {
  SimpleLock: attempts => {
    const adapter = createNode(attempts);
    const lock = new SimpleLock({
      adapter,
      key: 'late',
      ttl: TTL,
      retryAttempts: attempts.length - 1,
      retryDelay: 0,
      circuitBreaker: false,
    });
    return { acquire: async () => [await lock.acquire()], released: () => releasedBy(adapter) };
  },
  LeanSimpleLock: attempts => {
    const adapter = createNode(attempts);
    const lock = new LeanSimpleLock({
      adapter,
      key: 'late',
      ttl: TTL,
      retryAttempts: attempts.length - 1,
      retryDelay: 0,
    });
    return { acquire: async () => [await lock.acquire()], released: () => releasedBy(adapter) };
  },
  RedLock: attempts => {
    const adapters = [
      createNode(attempts),
      createNode(attempts, false),
      createNode(attempts, false),
    ];
    const lock = new RedLock({
      adapters,
      key: 'late',
      ttl: TTL,
      retryAttempts: attempts.length - 1,
      retryDelay: 0,
    });
    return {
      acquire: async () => [await lock.acquire()],
      released: () => adapters.flatMap(releasedBy),
    };
  },
  'LockManager.acquireBatch': attempts => {
    const adapter = createNode(attempts);
    const manager = new LockManager({ nodes: [adapter] });
    return {
      acquire: () =>
        manager.acquireBatch(['late:a', 'late:b'], {
          ttl: TTL,
          retryAttempts: attempts.length - 1,
          retryDelay: 0,
        }),
      released: () => releasedBy(adapter),
    };
  },
};

describe.each(Object.entries(SCENARIOS))('%s grant validity', (_name, scenario) => {
  beforeEach(() => {
    monotonicNow = 0;
    wallNow = START_TIME;
    vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow);
    vi.spyOn(Date, 'now').mockImplementation(() => wallNow);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should accept a grant that leaves 1 ms of validity', async () => {
    const { acquire, released } = scenario([{ delay: TTL - DRIFT - 1, granted: true }]);

    const handles = await acquire();

    expect(handles.length).toBeGreaterThan(0);
    expect(released()).toEqual([]);
  });

  it('should reject and release a grant whose elapsed time plus drift reaches the TTL', async () => {
    const { acquire, released } = scenario([{ delay: TTL - DRIFT, granted: true }]);

    const error = await acquire().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LockAcquisitionError);
    expect((error as Error).message).toMatch(/validity time exceeded/i);
    expect((error as Error).message).not.toMatch(/quorum not achieved/i);
    expect(released().length).toBeGreaterThan(0);
  });

  it('should measure elapsed time on the monotonic clock', async () => {
    const { acquire } = scenario([{ delay: TTL, granted: true, wallShift: -NTP_STEP_BACK }]);

    await expect(acquire()).rejects.toThrow(/validity time exceeded/i);
  });

  it('should date the lock from when the winning attempt was sent', async () => {
    const busyTime = 50;
    const { acquire } = scenario([
      { delay: busyTime, granted: false },
      { delay: 300, granted: true },
    ]);

    const handles = await acquire();

    for (const handle of handles) {
      expect(handle.acquiredAt).toBe(START_TIME + busyTime);
    }
  });

  it('should retry after releasing a late grant', async () => {
    const { acquire, released } = scenario([
      { delay: TTL, granted: true },
      { delay: 10, granted: true },
    ]);

    const handles = await acquire();

    expect(handles[0]!.acquiredAt).toBe(START_TIME + TTL);
    expect(released().length).toBeGreaterThan(0);
  });
});
