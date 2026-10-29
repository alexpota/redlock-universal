import { describe, it, expect, vi, afterEach } from 'vitest';
import { SimpleLock } from '../../../src/locks/SimpleLock.js';
import { LeanSimpleLock } from '../../../src/locks/LeanSimpleLock.js';
import { RedLock } from '../../../src/locks/RedLock.js';
import { LockManager } from '../../../src/manager/LockManager.js';
import { LockAcquisitionError } from '../../../src/types/errors.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';
import type { LockHandle } from '../../../src/types/locks.js';

const TTL = 10_000;
/** Long enough for a stray timer or rejection to surface after acquire() settles */
const SETTLE_MS = 50;

/** Reply to one SET attempt: granted, definitely not set, or unknown (the command failed) */
type Reply = 'OK' | null | Error;

interface Scenario {
  acquire(): Promise<LockHandle[]>;
  /** Values sent with each attempt, in order */
  sentValues(): string[][];
  /** Value of every delIfMatch call */
  releasedValues(): string[];
}

const createNode = (replies: readonly Reply[], release?: () => Promise<boolean>): RedisAdapter => {
  let call = 0;
  const next = async (): Promise<Reply> => {
    const reply = replies[Math.min(call++, replies.length - 1)]!;
    if (reply instanceof Error) {
      throw reply;
    }
    return reply;
  };

  return {
    setNX: vi.fn(async () => next()),
    batchSetNX: vi.fn(async (keys: string[]) =>
      (await next()) === 'OK'
        ? { success: true, acquiredCount: keys.length }
        : { success: false, acquiredCount: 0, failedKey: keys[0], failedIndex: 1 }
    ),
    delIfMatch: vi.fn(release ?? (async () => true)),
    ping: vi.fn().mockResolvedValue('PONG'),
    isConnected: vi.fn().mockReturnValue(true),
  } as unknown as RedisAdapter;
};

const setValues = (adapter: RedisAdapter): string[][] =>
  vi.mocked(adapter.setNX).mock.calls.map(call => [call[1]]);
const batchValues = (adapter: RedisAdapter): string[][] =>
  vi.mocked(adapter.batchSetNX).mock.calls.map(call => call[1]);
const releasedBy = (adapter: RedisAdapter): string[] =>
  vi.mocked(adapter.delIfMatch).mock.calls.map(call => call[1]);

const SCENARIOS: Record<
  string,
  (replies: readonly Reply[], release?: () => Promise<boolean>) => Scenario
> = {
  SimpleLock: (replies, release) => {
    const adapter = createNode(replies, release);
    const lock = new SimpleLock({
      adapter,
      key: 'cleanup',
      ttl: TTL,
      retryAttempts: replies.length - 1,
      retryDelay: 0,
      circuitBreaker: false,
    });
    return {
      acquire: async () => [await lock.acquire()],
      sentValues: () => setValues(adapter),
      releasedValues: () => releasedBy(adapter),
    };
  },
  LeanSimpleLock: (replies, release) => {
    const adapter = createNode(replies, release);
    const lock = new LeanSimpleLock({
      adapter,
      key: 'cleanup',
      ttl: TTL,
      retryAttempts: replies.length - 1,
      retryDelay: 0,
    });
    return {
      acquire: async () => [await lock.acquire()],
      sentValues: () => setValues(adapter),
      releasedValues: () => releasedBy(adapter),
    };
  },
  RedLock: (replies, release) => {
    // One node, so the attempt is decided by its own reply; multi-node timing is tested in
    // the RedLock unit tests
    const adapters = [createNode(replies, release)];
    const lock = new RedLock({
      adapters,
      key: 'cleanup',
      ttl: TTL,
      retryAttempts: replies.length - 1,
      retryDelay: 0,
    });
    return {
      acquire: async () => [await lock.acquire()],
      sentValues: () => setValues(adapters[0]!),
      releasedValues: () => adapters.flatMap(releasedBy),
    };
  },
  'LockManager.acquireBatch': (replies, release) => {
    const adapter = createNode(replies, release);
    const manager = new LockManager({ nodes: [adapter] });
    return {
      acquire: () =>
        manager.acquireBatch(['cleanup:a', 'cleanup:b'], {
          ttl: TTL,
          retryAttempts: replies.length - 1,
          retryDelay: 0,
        }),
      sentValues: () => batchValues(adapter),
      releasedValues: () => releasedBy(adapter),
    };
  },
};

describe.each(Object.entries(SCENARIOS))('%s after a failed attempt', (_name, scenario) => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should send a new value with every attempt', async () => {
    const { acquire, sentValues } = scenario([null, new Error('timeout'), 'OK']);

    await acquire();

    const attempts = sentValues();
    expect(attempts).toHaveLength(3);
    expect(new Set(attempts.flat()).size).toBe(attempts.flat().length);
  });

  it('should release the value of an attempt whose outcome is unknown', async () => {
    const { acquire, sentValues, releasedValues } = scenario([new Error('timeout'), 'OK']);

    const handles = await acquire();

    const [failedAttempt] = sentValues();
    expect(failedAttempt!.length).toBeGreaterThan(0);
    for (const value of failedAttempt!) {
      expect(releasedValues()).toContain(value);
    }
    for (const handle of handles) {
      expect(releasedValues()).not.toContain(handle.value);
    }
  });

  it('should not release after a reply that definitely did not set the key', async () => {
    const { acquire, releasedValues } = scenario([null, 'OK']);

    await acquire();

    expect(releasedValues()).toEqual([]);
  });

  it('should not wait for a release that never answers', async () => {
    const { acquire, releasedValues } = scenario(
      [new Error('timeout')],
      () => new Promise(() => {})
    );

    const outcome = await Promise.race([
      acquire().catch((error: unknown) => error),
      new Promise(resolve => setTimeout(() => resolve('still waiting'), SETTLE_MS)),
    ]);

    expect(outcome).toBeInstanceOf(LockAcquisitionError);
    expect(releasedValues().length).toBeGreaterThan(0);
  });

  it('should not leave an unhandled rejection when the release fails', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { acquire, releasedValues } = scenario([new Error('timeout')], () =>
        Promise.reject(new Error('release failed'))
      );

      await expect(acquire()).rejects.toBeInstanceOf(LockAcquisitionError);
      await new Promise(resolve => setTimeout(resolve, SETTLE_MS));

      expect(releasedValues().length).toBeGreaterThan(0);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

describe('RedLock cleanup after a failed round', () => {
  it('should release nodes that granted or failed, but not nodes that refused', async () => {
    const granted = createNode(['OK']);
    const refused = createNode([null]);
    const failed = createNode([new Error('timeout')]);
    // Quorum 2 of 3: the round is decided only by the last reply, so every node has answered
    const lock = new RedLock({
      adapters: [granted, refused, failed],
      key: 'cleanup',
      ttl: TTL,
      quorum: 2,
      retryAttempts: 0,
    });

    await expect(lock.acquire()).rejects.toBeInstanceOf(LockAcquisitionError);

    expect(granted.delIfMatch).toHaveBeenCalledTimes(1);
    expect(failed.delIfMatch).toHaveBeenCalledTimes(1);
    expect(refused.delIfMatch).not.toHaveBeenCalled();
  });
});
