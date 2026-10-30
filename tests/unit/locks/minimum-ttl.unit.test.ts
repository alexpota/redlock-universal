import { describe, it, expect, vi } from 'vitest';
import { SimpleLock } from '../../../src/locks/SimpleLock.js';
import { LeanSimpleLock } from '../../../src/locks/LeanSimpleLock.js';
import { RedLock } from '../../../src/locks/RedLock.js';
import { LockManager } from '../../../src/manager/LockManager.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';

const TOO_SHORT = /TTL must be greater than its clock drift allowance/;
const adapter = { setNX: vi.fn(), delIfMatch: vi.fn() } as unknown as RedisAdapter;

const LOCKS: Record<string, (ttl: number) => unknown> = {
  SimpleLock: ttl => new SimpleLock({ adapter, key: 'k', ttl }),
  LeanSimpleLock: ttl => new LeanSimpleLock({ adapter, key: 'k', ttl }),
  RedLock: ttl => new RedLock({ adapters: [adapter], key: 'k', ttl }),
};

describe.each(Object.entries(LOCKS))('%s TTL that leaves no validity', (_name, create) => {
  it.each([1, 2])('should reject a %i ms TTL at construction', ttl => {
    expect(() => create(ttl)).toThrow(TOO_SHORT);
  });

  it('should accept the shortest TTL that leaves validity', () => {
    expect(() => create(3)).not.toThrow();
  });
});

describe('TTL that leaves no validity, other cases', () => {
  it('should reject it in acquireBatch options', async () => {
    const manager = new LockManager({ nodes: [adapter] });

    await expect(manager.acquireBatch(['a', 'b'], { ttl: 2 })).rejects.toThrow(TOO_SHORT);
    expect(adapter.setNX).not.toHaveBeenCalled();
  });

  it('should account for a larger RedLock clock drift factor', () => {
    const create = (ttl: number) =>
      new RedLock({ adapters: [adapter], key: 'k', ttl, clockDriftFactor: 0.5 });

    expect(() => create(4)).toThrow(TOO_SHORT);
    expect(() => create(5)).not.toThrow();
  });
});
