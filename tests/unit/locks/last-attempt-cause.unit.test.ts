import { describe, it, expect, vi } from 'vitest';
import { SimpleLock } from '../../../src/locks/SimpleLock.js';
import { LeanSimpleLock } from '../../../src/locks/LeanSimpleLock.js';
import { LockAcquisitionError } from '../../../src/types/errors.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';

type Reply = 'OK' | null | Error;

const node = (replies: readonly Reply[]): RedisAdapter => {
  let call = 0;
  return {
    setNX: vi.fn(async () => {
      const reply = replies[Math.min(call++, replies.length - 1)]!;
      if (reply instanceof Error) throw reply;
      return reply;
    }),
    delIfMatch: vi.fn().mockResolvedValue(false),
  } as unknown as RedisAdapter;
};

const LOCKS: Record<
  string,
  (adapter: RedisAdapter, attempts: number) => { acquire(): Promise<unknown> }
> = {
  SimpleLock: (adapter, attempts) =>
    new SimpleLock({
      adapter,
      key: 'k',
      retryAttempts: attempts - 1,
      retryDelay: 0,
      circuitBreaker: false,
    }),
  LeanSimpleLock: (adapter, attempts) =>
    new LeanSimpleLock({ adapter, key: 'k', retryAttempts: attempts - 1, retryDelay: 0 }),
};

describe.each(Object.entries(LOCKS))('%s error cause', (_name, create) => {
  it('should report the last attempt when it found the lock held', async () => {
    const error = await create(node([new Error('connection reset'), null]), 2)
      .acquire()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LockAcquisitionError);
    expect((error as LockAcquisitionError).cause?.message).toMatch(/already held/);
  });

  it('should report the last attempt when it failed', async () => {
    const error = await create(node([null, new Error('connection reset')]), 2)
      .acquire()
      .catch((caught: unknown) => caught);

    expect((error as LockAcquisitionError).cause?.message).toBe('connection reset');
  });
});
