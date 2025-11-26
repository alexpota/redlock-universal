/**
 * Lock Inspection Example
 *
 * Demonstrates how to use the inspect() method to debug locks,
 * monitor lock ownership, and diagnose contention issues.
 *
 * The inspect() method atomically retrieves both the lock value (owner)
 * and remaining TTL in a single Redis operation using a Lua script.
 */

import { NodeRedisAdapter, createLock } from '../src/index.js';
import { createClient } from 'redis';

// Setup Redis connection
const client = createClient({ url: 'redis://localhost:6379' });
await client.connect();

const adapter = NodeRedisAdapter.from(client);

// Example 1: Basic Lock Inspection
console.log('Example 1: Basic Lock Inspection');
console.log('=================================\n');

const lock = createLock({
  adapter,
  key: 'inspection-demo',
  ttl: 10000, // 10 seconds
});

console.log('Before acquiring lock:');
let inspection = await adapter.inspect('inspection-demo');
console.log('  Lock exists:', inspection !== null);

console.log('\nAcquiring lock...');
const handle = await lock.acquire();
console.log('✓ Lock acquired');
console.log('  Key:', handle.key);
console.log('  Value (owner):', handle.value);

console.log('\nInspecting lock:');
inspection = await adapter.inspect('inspection-demo');
if (inspection) {
  console.log('  Owner:', inspection.value);
  console.log('  TTL remaining:', inspection.ttl, 'ms');
  console.log('  Owner matches:', inspection.value === handle.value);
}

await lock.release(handle);
console.log('\n✓ Lock released\n');

// Example 2: Debugging Stuck Locks
console.log('Example 2: Debugging Stuck Locks');
console.log('=================================\n');

console.log('Simulating a stuck lock scenario...');
const stuckLock = createLock({
  adapter,
  key: 'potentially-stuck',
  ttl: 30000, // 30 seconds
});

const stuckHandle = await stuckLock.acquire();
console.log('✓ Lock acquired by Process A');

// Simulate another process trying to acquire
const otherLock = createLock({
  adapter,
  key: 'potentially-stuck',
  ttl: 30000,
  retryAttempts: 0,
});

console.log('\nProcess B attempting to acquire...');
try {
  await otherLock.acquire();
  console.log('✗ Unexpected: Lock acquired');
} catch (error) {
  console.log('✓ Lock acquisition failed (expected)');
  console.log('  Error:', (error as Error).message);

  console.log('\nInspecting to debug:');
  const debugInspection = await adapter.inspect('potentially-stuck');
  if (debugInspection) {
    console.log('  Current owner:', debugInspection.value);
    console.log('  TTL remaining:', debugInspection.ttl, 'ms');

    const secondsRemaining = Math.floor(debugInspection.ttl / 1000);
    console.log(`  Wait time: ~${secondsRemaining} seconds before lock expires`);
  }
}

await stuckLock.release(stuckHandle);
console.log('\n✓ Lock released\n');

// Example 3: Monitoring Lock Expiration
console.log('Example 3: Monitoring Lock Expiration');
console.log('======================================\n');

const monitoredLock = createLock({
  adapter,
  key: 'monitored',
  ttl: 5000, // 5 seconds
});

console.log('Acquiring lock with 5s TTL...');
const monitoredHandle = await monitoredLock.acquire();
console.log('✓ Lock acquired\n');

console.log('Monitoring TTL every second:');
for (let i = 0; i < 6; i++) {
  await new Promise(resolve => setTimeout(resolve, 1000));

  const monitorInspection = await adapter.inspect('monitored');
  if (monitorInspection) {
    const secondsLeft = Math.floor(monitorInspection.ttl / 1000);
    console.log(`  [${i + 1}s] TTL remaining: ${monitorInspection.ttl}ms (~${secondsLeft}s)`);

    if (monitorInspection.ttl < 1000) {
      console.log('  ⚠️  Warning: Lock expiring soon!');
    }
  } else {
    console.log(`  [${i + 1}s] Lock no longer exists (expired)`);
    break;
  }
}

// Clean up if lock still exists
try {
  await monitoredLock.release(monitoredHandle);
  console.log('\n✓ Lock released\n');
} catch {
  console.log('\n✓ Lock already expired\n');
}

// Example 4: Production Monitoring Pattern
console.log('Example 4: Production Monitoring Pattern');
console.log('=========================================\n');

async function monitorLockHealth(adapter: NodeRedisAdapter, key: string): Promise<void> {
  const inspection = await adapter.inspect(key);

  if (!inspection) {
    console.log(`  Lock "${key}": Not currently held`);
    return;
  }

  const ttlSeconds = Math.floor(inspection.ttl / 1000);
  const status =
    inspection.ttl < 1000 ? '🔴 CRITICAL' : inspection.ttl < 5000 ? '🟡 WARNING' : '🟢 HEALTHY';

  console.log(`  Lock "${key}": ${status}`);
  console.log(`    Owner: ${inspection.value.substring(0, 16)}...`);
  console.log(`    TTL: ${inspection.ttl}ms (~${ttlSeconds}s)`);

  if (inspection.ttl < 1000) {
    console.log(`    ⚠️  Action Required: Lock expiring in <1s`);
  }
}

const healthLock = createLock({
  adapter,
  key: 'health-check',
  ttl: 15000,
});

console.log('Acquiring lock for health monitoring...');
await healthLock.acquire();

console.log('\nInitial health check:');
await monitorLockHealth(adapter, 'health-check');

console.log('\nHealth check after 10 seconds:');
await new Promise(resolve => setTimeout(resolve, 10000));
await monitorLockHealth(adapter, 'health-check');

console.log('\nHealth check after 5 more seconds:');
await new Promise(resolve => setTimeout(resolve, 5000));
await monitorLockHealth(adapter, 'health-check');

console.log('\n');

// Example 5: Batch Inspection for Multiple Locks
console.log('Example 5: Batch Inspection');
console.log('============================\n');

const lockKeys = ['service-a', 'service-b', 'service-c'];
const lockHandles = [];

console.log('Creating multiple locks...');
for (const key of lockKeys) {
  const batchLock = createLock({ adapter, key, ttl: 20000 });
  const handle = await batchLock.acquire();
  lockHandles.push({ lock: batchLock, handle });
}
console.log('✓ All locks acquired\n');

console.log('Inspecting all locks:');
for (const key of lockKeys) {
  const batchInspection = await adapter.inspect(key);
  if (batchInspection) {
    const ttlSeconds = Math.floor(batchInspection.ttl / 1000);
    console.log(`  ${key}:`);
    console.log(`    Owner: ${batchInspection.value.substring(0, 12)}...`);
    console.log(`    TTL: ${ttlSeconds}s`);
  }
}

console.log('\n✓ Batch inspection complete\n');

// Cleanup
console.log('Cleaning up...');
for (const { lock, handle } of lockHandles) {
  await lock.release(handle);
}

await client.disconnect();
console.log('✓ Cleanup complete\n');

console.log('=========================================');
console.log('Lock Inspection Examples Complete');
console.log('=========================================\n');

/**
 * Production Usage Patterns
 * ==========================
 *
 * 1. Stuck Lock Detector:
 *
 * async function detectStuckLocks(adapter: NodeRedisAdapter, keys: string[]) {
 *   const stuckLocks: string[] = [];
 *
 *   for (const key of keys) {
 *     const inspection = await adapter.inspect(key);
 *     if (inspection && inspection.ttl > 60000) { // Held >1 minute
 *       stuckLocks.push(key);
 *       console.warn(`Stuck lock detected: ${key} (${inspection.ttl}ms)`);
 *     }
 *   }
 *
 *   return stuckLocks;
 * }
 *
 * 2. Lock Ownership Verification:
 *
 * async function verifyOwnership(
 *   adapter: NodeRedisAdapter,
 *   key: string,
 *   expectedValue: string
 * ): Promise<boolean> {
 *   const inspection = await adapter.inspect(key);
 *   return inspection?.value === expectedValue;
 * }
 *
 * 3. TTL Warning Monitor:
 *
 * async function warnIfExpiring(
 *   adapter: NodeRedisAdapter,
 *   key: string,
 *   warnThreshold = 5000
 * ) {
 *   const inspection = await adapter.inspect(key);
 *   if (inspection && inspection.ttl < warnThreshold) {
 *     console.warn(`Lock ${key} expiring soon: ${inspection.ttl}ms remaining`);
 *     return true;
 *   }
 *   return false;
 * }
 */
