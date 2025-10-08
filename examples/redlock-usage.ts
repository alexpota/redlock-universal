/**
 * RedLock Usage Examples
 * Demonstrates distributed locking across multiple Redis instances
 */

import { createClient as createRedisClient } from 'redis';
import Redis from 'ioredis';
import {
  createRedlock,
  createRedlocks,
  NodeRedisAdapter,
  IoredisAdapter,
  LockAcquisitionError,
  type LockHandle,
  type Lock,
  RedLock,
} from '../src/index.js';

/**
 * Example 1: Basic RedLock with node-redis clients
 */
async function basicRedlockExample() {
  console.log('=== Basic RedLock Example ===');

  // Create multiple Redis connections (in production, these would be different servers)
  const redis1 = createRedisClient({ socket: { port: 6379 } });
  const redis2 = createRedisClient({ socket: { port: 6380 } });
  const redis3 = createRedisClient({ socket: { port: 6381 } });

  await Promise.all([redis1.connect(), redis2.connect(), redis3.connect()]);

  try {
    // Create distributed lock with automatic quorum (majority = 2 out of 3)
    const redlock = createRedlock({
      adapters: [
        new NodeRedisAdapter(redis1),
        new NodeRedisAdapter(redis2),
        new NodeRedisAdapter(redis3),
      ],
      key: 'critical-resource:user:123',
      ttl: 30000, // 30 seconds
      retryAttempts: 3,
      retryDelay: 200,
    });

    console.log('Acquiring distributed lock...');
    const handle = await redlock.acquire();

    console.log('✅ Lock acquired successfully!');
    console.log('Lock details:', {
      id: handle.id,
      key: handle.key,
      acquiredAt: new Date(handle.acquiredAt).toISOString(),
      ttl: `${handle.ttl}ms`,
      nodes: handle.metadata?.nodes,
      attempts: handle.metadata?.attempts,
      acquisitionTime: `${handle.metadata?.acquisitionTime}ms`,
    });

    // Simulate critical work
    console.log('Performing critical work...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Release the lock
    console.log('Releasing lock...');
    const released = await redlock.release(handle);
    console.log(`✅ Lock released: ${released}`);
  } catch (error) {
    if (error instanceof LockAcquisitionError) {
      console.error('❌ Failed to acquire lock:', error.message);
      console.error('Attempts made:', error.attempts);
    } else {
      console.error('❌ Unexpected error:', error);
    }
  } finally {
    await Promise.all([redis1.disconnect(), redis2.disconnect(), redis3.disconnect()]);
  }
}

/**
 * Example 2: RedLock with mixed client types (node-redis + ioredis)
 */
async function mixedClientsExample() {
  console.log('\n=== Mixed Client Types Example ===');

  // Mix node-redis and ioredis clients
  const nodeRedis1 = createRedisClient({ socket: { port: 6379 } });
  const nodeRedis2 = createRedisClient({ socket: { port: 6380 } });
  const ioredis1 = new Redis({ port: 6381 });
  const ioredis2 = new Redis({ port: 6382 });

  await nodeRedis1.connect();
  await nodeRedis2.connect();

  try {
    const redlock = createRedlock({
      adapters: [
        new NodeRedisAdapter(nodeRedis1),
        new NodeRedisAdapter(nodeRedis2),
        new IoredisAdapter(ioredis1),
        new IoredisAdapter(ioredis2),
      ],
      key: 'mixed-resource',
      ttl: 15000,
      quorum: 3, // Need 3 out of 4 nodes
      clockDriftFactor: 0.01,
    });

    const handle = await redlock.acquire();
    console.log('✅ Distributed lock acquired across mixed clients!');
    console.log(
      `Quorum achieved: ${handle.metadata?.nodes?.length}/${(redlock as RedLock).getAdapters().length}`
    );

    // Extend the lock
    console.log('Extending lock TTL...');
    const extended = await redlock.extend(handle, 25000);
    console.log(`✅ Lock extended: ${extended}`);

    await redlock.release(handle);
    console.log('✅ Lock released successfully');
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await nodeRedis1.disconnect();
    await nodeRedis2.disconnect();
    ioredis1.disconnect();
    ioredis2.disconnect();
  }
}

/**
 * Example 3: Multiple RedLocks for different resources
 */
async function multipleResourcesExample() {
  console.log('\n=== Multiple Resources Example ===');

  const redis1 = createRedisClient({ socket: { port: 6379 } });
  const redis2 = createRedisClient({ socket: { port: 6380 } });
  const redis3 = createRedisClient({ socket: { port: 6381 } });

  await Promise.all([redis1.connect(), redis2.connect(), redis3.connect()]);

  try {
    const adapters = [
      new NodeRedisAdapter(redis1),
      new NodeRedisAdapter(redis2),
      new NodeRedisAdapter(redis3),
    ];

    // Create multiple locks for different resources
    const redlocks = createRedlocks(
      adapters,
      ['user:123:profile', 'user:123:wallet', 'user:123:settings'],
      {
        ttl: 20000,
        retryAttempts: 2,
        retryDelay: 100,
      }
    );

    console.log('Acquiring locks for multiple resources...');
    const acquiredLocks: Array<{ lock: Lock; handle: LockHandle }> = [];

    // Acquire all locks
    for (const redlock of redlocks) {
      try {
        const handle = await redlock.acquire();
        acquiredLocks.push({ lock: redlock, handle });
        console.log(`✅ Acquired lock for: ${handle.key}`);
      } catch (error) {
        console.error(`❌ Failed to acquire lock:`, error);
      }
    }

    console.log(`Successfully acquired ${acquiredLocks.length} out of ${redlocks.length} locks`);

    // Simulate concurrent work on multiple resources
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Release all locks
    console.log('Releasing all locks...');
    for (const { lock, handle } of acquiredLocks) {
      const released = await lock.release(handle);
      console.log(`✅ Released lock for ${handle.key}: ${released}`);
    }
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await Promise.all([redis1.disconnect(), redis2.disconnect(), redis3.disconnect()]);
  }
}

/**
 * Example 4: Handling lock contention and failures
 */
async function lockContentionExample() {
  console.log('\n=== Lock Contention Example ===');

  const redis1 = createRedisClient({ socket: { port: 6379 } });
  const redis2 = createRedisClient({ socket: { port: 6380 } });
  const redis3 = createRedisClient({ socket: { port: 6381 } });

  await Promise.all([redis1.connect(), redis2.connect(), redis3.connect()]);

  try {
    const adapters = [
      new NodeRedisAdapter(redis1),
      new NodeRedisAdapter(redis2),
      new NodeRedisAdapter(redis3),
    ];

    const resourceKey = 'contended-resource';

    // Create two competing locks
    const redlock1 = createRedlock({
      adapters,
      key: resourceKey,
      ttl: 5000,
      retryAttempts: 1,
      retryDelay: 100,
    });

    const redlock2 = createRedlock({
      adapters,
      key: resourceKey,
      ttl: 5000,
      retryAttempts: 1,
      retryDelay: 100,
    });

    // First lock acquires successfully
    console.log('First client acquiring lock...');
    const handle1 = await redlock1.acquire();
    console.log('✅ First client acquired lock');

    // Second lock attempts to acquire (should fail)
    console.log('Second client attempting to acquire same lock...');
    try {
      await redlock2.acquire();
      console.log('❌ Unexpected: Second client should not have acquired lock');
    } catch (error) {
      if (error instanceof LockAcquisitionError) {
        console.log('✅ Expected: Second client failed to acquire lock');
        console.log(`Reason: ${error.message}`);
      }
    }

    // Check lock status
    const isLocked = await redlock1.isLocked(resourceKey);
    console.log(`Lock status check: ${isLocked ? 'LOCKED' : 'UNLOCKED'}`);

    // Release first lock
    await redlock1.release(handle1);
    console.log('✅ First client released lock');

    // Now second client can acquire
    console.log('Second client attempting to acquire after release...');
    const handle2 = await redlock2.acquire();
    console.log('✅ Second client acquired lock after first release');

    await redlock2.release(handle2);
    console.log('✅ Second client released lock');
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  } finally {
    await Promise.all([redis1.disconnect(), redis2.disconnect(), redis3.disconnect()]);
  }
}

/**
 * Example 5: Production patterns with error handling
 */
async function productionPatternExample() {
  console.log('\n=== Production Pattern Example ===');

  const redis1 = createRedisClient({ socket: { port: 6379 } });
  const redis2 = createRedisClient({ socket: { port: 6380 } });
  const redis3 = createRedisClient({ socket: { port: 6381 } });

  await Promise.all([redis1.connect(), redis2.connect(), redis3.connect()]);

  try {
    const redlock = createRedlock({
      adapters: [
        new NodeRedisAdapter(redis1),
        new NodeRedisAdapter(redis2),
        new NodeRedisAdapter(redis3),
      ],
      key: 'production:payment:process',
      ttl: 60000, // 1 minute for payment processing
      retryAttempts: 5,
      retryDelay: 500,
      clockDriftFactor: 0.02, // Account for network latency
    });

    console.log('Processing payment with distributed lock...');
    let handle: LockHandle | null = null;

    try {
      // Acquire lock with retry logic
      handle = await redlock.acquire();
      console.log('✅ Payment processing lock acquired');

      // Simulate payment processing work
      console.log('Processing payment...');
      await simulatePaymentProcessing(handle, redlock as RedLock);
      console.log('✅ Payment processed successfully');
    } catch (error) {
      if (error instanceof LockAcquisitionError) {
        console.error('❌ Failed to acquire payment lock:', error.message);
        console.error('This payment may already be processing elsewhere');
      } else {
        console.error('❌ Payment processing error:', error);
      }
      throw error;
    } finally {
      // Always attempt to release the lock
      if (handle) {
        try {
          const released = await redlock.release(handle);
          console.log(`✅ Payment lock released: ${released}`);
        } catch (releaseError) {
          console.error('⚠️ Warning: Failed to release payment lock:', releaseError);
          // In production, you might want to log this for monitoring
        }
      }
    }
  } finally {
    await Promise.all([redis1.disconnect(), redis2.disconnect(), redis3.disconnect()]);
  }
}

/**
 * Simulate payment processing with lock extension
 */
async function simulatePaymentProcessing(handle: LockHandle, redlock: RedLock) {
  for (let step = 1; step <= 3; step++) {
    console.log(`Payment step ${step}/3...`);

    // Simulate work
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Extend lock if we need more time
    if (step === 2) {
      console.log('Extending lock for additional processing time...');
      const extended = await redlock.extend(handle, 30000);
      if (!extended) {
        throw new Error('Failed to extend payment lock - processing aborted');
      }
      console.log('✅ Lock extended successfully');
    }
  }
}

// Run all examples
async function runAllExamples() {
  console.log('🚀 redlock-universal - Distributed Locking Examples\n');

  try {
    await basicRedlockExample();
    await mixedClientsExample();
    await multipleResourcesExample();
    await lockContentionExample();
    await productionPatternExample();

    console.log('\n✅ All examples completed successfully!');
  } catch (error) {
    console.error('\n❌ Example execution failed:', error);
    process.exit(1);
  }
}

// Export for use in other examples
export {
  basicRedlockExample,
  mixedClientsExample,
  multipleResourcesExample,
  lockContentionExample,
  productionPatternExample,
};

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples().catch(console.error);
}
