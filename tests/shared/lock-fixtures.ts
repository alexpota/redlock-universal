import { vi } from 'vitest';
import { SimpleLock } from '../../src/locks/SimpleLock.js';
import { LeanSimpleLock } from '../../src/locks/LeanSimpleLock.js';
import { RedLock } from '../../src/locks/RedLock.js';
import { LockManager } from '../../src/manager/LockManager.js';
import type { RedisAdapter } from '../../src/types/adapters.js';
import type { LockHandle } from '../../src/types/locks.js';

/** Reply to one SET attempt: granted, definitely not set, or unknown (the command failed) */
export type Reply = 'OK' | null | Error;

export interface ScriptedNodeOptions {
  /** Called with the attempt number when its SET is sent, before the reply */
  readonly onSend?: (attempt: number) => void;
  /** delIfMatch implementation (default: resolves true) */
  readonly release?: () => Promise<boolean>;
}

/** Node that answers each SET (or batch SET) attempt with the next reply; the last one repeats */
export function scriptedNode(
  replies: readonly Reply[],
  options: ScriptedNodeOptions = {}
): RedisAdapter {
  let call = 0;
  const next = (): string | null => {
    const attempt = call++;
    options.onSend?.(attempt);
    const reply = replies[Math.min(attempt, replies.length - 1)]!;
    if (reply instanceof Error) {
      throw reply;
    }
    return reply;
  };

  return {
    setNX: vi.fn(async () => next()),
    batchSetNX: vi.fn(async (keys: string[]) =>
      next() === 'OK'
        ? { success: true, acquiredCount: keys.length }
        : { success: false, acquiredCount: 0, failedKey: keys[0], failedIndex: 1 }
    ),
    delIfMatch: vi.fn(options.release ?? (async () => true)),
    isConnected: vi.fn().mockReturnValue(true),
  } as unknown as RedisAdapter;
}

/** Values sent with each attempt, in order */
export const sentValues = (node: RedisAdapter): string[][] => [
  ...vi.mocked(node.setNX).mock.calls.map(call => [call[1]]),
  ...vi.mocked(node.batchSetNX).mock.calls.map(call => call[1]),
];

/** Value of every delIfMatch call */
export const releasedValues = (node: RedisAdapter): string[] =>
  vi.mocked(node.delIfMatch).mock.calls.map(call => call[1]);

export interface ProducerOptions {
  /** Creates node i: RedLock uses `redlockNodes` of them, the other producers node 0 */
  readonly node: (index: number) => RedisAdapter;
  readonly ttl: number;
  readonly attempts: number;
  readonly redlockNodes?: number;
}

export interface Producer {
  acquire(): Promise<LockHandle[]>;
  readonly nodes: readonly RedisAdapter[];
}

const DEFAULT_REDLOCK_NODES = 3;

/** Every way to get a lock handle, behind one interface */
export const PRODUCERS: Record<string, (options: ProducerOptions) => Producer> = {
  SimpleLock: ({ node, ttl, attempts }) => {
    const adapter = node(0);
    const lock = new SimpleLock({
      adapter,
      key: 'lock',
      ttl,
      retryAttempts: attempts - 1,
      retryDelay: 0,
      circuitBreaker: false,
    });
    return { acquire: async () => [await lock.acquire()], nodes: [adapter] };
  },
  LeanSimpleLock: ({ node, ttl, attempts }) => {
    const adapter = node(0);
    const lock = new LeanSimpleLock({
      adapter,
      key: 'lock',
      ttl,
      retryAttempts: attempts - 1,
      retryDelay: 0,
    });
    return { acquire: async () => [await lock.acquire()], nodes: [adapter] };
  },
  RedLock: ({ node, ttl, attempts, redlockNodes = DEFAULT_REDLOCK_NODES }) => {
    const adapters = Array.from({ length: redlockNodes }, (_, index) => node(index));
    const lock = new RedLock({
      adapters,
      key: 'lock',
      ttl,
      retryAttempts: attempts - 1,
      retryDelay: 0,
    });
    return { acquire: async () => [await lock.acquire()], nodes: adapters };
  },
  'LockManager.acquireBatch': ({ node, ttl, attempts }) => {
    const adapter = node(0);
    const manager = new LockManager({ nodes: [adapter] });
    return {
      acquire: () =>
        manager.acquireBatch(['lock:a', 'lock:b'], {
          ttl,
          retryAttempts: attempts - 1,
          retryDelay: 0,
        }),
      nodes: [adapter],
    };
  },
};
