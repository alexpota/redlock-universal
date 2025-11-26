/**
 * MemoryAdapter Testing Example
 *
 * Demonstrates how to use MemoryAdapter for unit tests without Redis.
 * MemoryAdapter implements the full RedisAdapter interface in-memory,
 * allowing fast tests without Docker or Redis dependencies.
 *
 * ⚠️ TESTING ONLY: Not for production use!
 */

import { MemoryAdapter, SimpleLock, createLock } from '../src/index.js';

// Example 1: Basic Setup
console.log('Example 1: Basic MemoryAdapter Usage');
console.log('=====================================\n');

const adapter = new MemoryAdapter();

const lock = new SimpleLock({
  adapter,
  key: 'test-resource',
  ttl: 5000,
});

console.log('Acquiring lock...');
const handle = await lock.acquire();
console.log('✓ Lock acquired:', handle.key);
console.log('  Lock value:', handle.value);
console.log('  Acquired at:', new Date(handle.acquiredAt).toISOString());

console.log('\nReleasing lock...');
await lock.release(handle);
console.log('✓ Lock released\n');

// Example 2: Lock Contention
console.log('Example 2: Testing Lock Contention');
console.log('===================================\n');

const lock1 = createLock({ adapter, key: 'shared-resource', ttl: 5000 });
const lock2 = createLock({
  adapter,
  key: 'shared-resource',
  ttl: 5000,
  retryAttempts: 1,
  retryDelay: 50,
});

console.log('Lock 1 acquiring...');
const handle1 = await lock1.acquire();
console.log('✓ Lock 1 acquired');

console.log('\nLock 2 attempting to acquire (should fail)...');
try {
  await lock2.acquire();
  console.log('✗ Unexpected: Lock 2 acquired (should have failed)');
} catch (error) {
  console.log('✓ Lock 2 failed as expected:', (error as Error).message);
}

console.log('\nLock 1 releasing...');
await lock1.release(handle1);
console.log('✓ Lock 1 released');

console.log('\nLock 2 acquiring (should succeed now)...');
const handle2 = await lock2.acquire();
console.log('✓ Lock 2 acquired');
await lock2.release(handle2);
console.log('✓ Lock 2 released\n');

// Example 3: TTL Expiration
console.log('Example 3: Testing TTL Expiration');
console.log('==================================\n');

const shortLock = createLock({ adapter, key: 'expiring-lock', ttl: 100 });

console.log('Acquiring lock with 100ms TTL...');
await shortLock.acquire();
console.log('✓ Lock acquired');

console.log('Waiting for expiration...');
await new Promise(resolve => setTimeout(resolve, 150));

console.log('Attempting to acquire again (should succeed)...');
const handle3 = await shortLock.acquire();
console.log('✓ Lock acquired after expiration');
await shortLock.release(handle3);
console.log('✓ Lock released\n');

// Example 4: Lock Inspection
console.log('Example 4: Lock Inspection');
console.log('==========================\n');

const inspectLock = createLock({ adapter, key: 'inspectable', ttl: 10000 });

console.log('Before acquisition:');
let inspection = await adapter.inspect('inspectable');
console.log('  Lock exists:', inspection !== null);

console.log('\nAcquiring lock...');
const handle4 = await inspectLock.acquire();
console.log('✓ Lock acquired');

console.log('\nInspecting lock:');
inspection = await adapter.inspect('inspectable');
if (inspection) {
  console.log('  Owner:', inspection.value);
  console.log('  TTL:', inspection.ttl, 'ms');
  console.log('  Match:', inspection.value === handle4.value);
}

await inspectLock.release(handle4);
console.log('\n✓ Lock released\n');

// Example 5: Test Cleanup
console.log('Example 5: Test Cleanup');
console.log('=======================\n');

console.log('Current locks:', adapter.size);

const cleanup1 = createLock({ adapter, key: 'cleanup-1', ttl: 5000 });
const cleanup2 = createLock({ adapter, key: 'cleanup-2', ttl: 5000 });

await cleanup1.acquire();
await cleanup2.acquire();
console.log('Locks after acquisition:', adapter.size);

console.log('Calling adapter.clear()...');
adapter.clear();
console.log('Locks after clear:', adapter.size);

console.log('\n✓ All locks cleared\n');

// Example 6: Using with using() API
console.log('Example 6: Auto-Extension with using()');
console.log('=======================================\n');

const autoLock = createLock({ adapter, key: 'auto-extend', ttl: 5000 });

console.log('Using auto-extending lock...');
await autoLock.using(async signal => {
  console.log('✓ Inside critical section');
  console.log('  Signal aborted:', signal.aborted);

  await new Promise(resolve => setTimeout(resolve, 100));

  console.log('✓ Work completed');
  console.log('  Signal still not aborted:', !signal.aborted);
});
console.log('✓ Lock auto-released\n');

// Cleanup
console.log('Final cleanup...');
await adapter.disconnect();
console.log('✓ Adapter disconnected\n');

console.log('========================================');
console.log('MemoryAdapter Testing Examples Complete');
console.log('========================================\n');

/**
 * Common Test Patterns
 * ====================
 *
 * // Vitest/Jest setup
 * describe('My Feature', () => {
 *   let adapter: MemoryAdapter;
 *
 *   beforeEach(() => {
 *     adapter = new MemoryAdapter();
 *   });
 *
 *   afterEach(async () => {
 *     adapter.clear();
 *     await adapter.disconnect();
 *   });
 *
 *   it('should acquire and release lock', async () => {
 *     const lock = createLock({ adapter, key: 'test', ttl: 5000 });
 *     const handle = await lock.acquire();
 *     expect(handle.key).toBe('test');
 *     await lock.release(handle);
 *   });
 *
 *   it('should prevent concurrent access', async () => {
 *     const lock1 = createLock({ adapter, key: 'resource', ttl: 5000 });
 *     const lock2 = createLock({ adapter, key: 'resource', ttl: 5000, retryAttempts: 0 });
 *
 *     await lock1.acquire();
 *     await expect(lock2.acquire()).rejects.toThrow();
 *   });
 * });
 */
