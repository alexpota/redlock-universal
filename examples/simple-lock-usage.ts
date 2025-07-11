// Examples showing how SimpleLock should work
// This demonstrates the ideal API we want to achieve

import { createClient as createNodeRedisClient } from 'redis';
import Redis from 'ioredis';
import { createLock, NodeRedisAdapter, IoredisAdapter } from '../src/index.js';

// Example 1: Basic lock usage with node-redis
async function basicLockExample() {
  const client = createNodeRedisClient({ url: 'redis://localhost:6379' });
  await client.connect();

  const lock = createLock({
    adapter: new NodeRedisAdapter(client),
    key: 'my-resource',
    ttl: 30000, // 30 seconds
  });

  try {
    // Acquire the lock
    const handle = await lock.acquire();
    console.log('Lock acquired:', handle.id);

    // Critical section - only one process can be here
    await doSomeCriticalWork();

    // Release the lock
    const released = await lock.release(handle);
    console.log('Lock released:', released);
  } catch (error) {
    console.error('Lock operation failed:', error.message);
  } finally {
    await client.disconnect();
  }
}

// Example 2: Lock with automatic retry
async function retryLockExample() {
  const client = new Redis('redis://localhost:6379');

  const lock = createLock({
    adapter: new IoredisAdapter(client),
    key: 'contested-resource',
    ttl: 10000,
    retryAttempts: 5,
    retryDelay: 200,
  });

  try {
    // Will retry up to 5 times with 200ms delay
    const handle = await lock.acquire();

    // Do work with the lock
    await doSomeWork();

    await lock.release(handle);
  } catch (error) {
    console.error('Could not acquire lock after retries:', error.message);
  } finally {
    client.disconnect();
  }
}

// Example 3: Lock extension
async function lockExtensionExample() {
  const client = createNodeRedisClient({ url: 'redis://localhost:6379' });
  await client.connect();

  const lock = createLock({
    adapter: new NodeRedisAdapter(client),
    key: 'long-running-task',
    ttl: 5000, // Start with 5 seconds
  });

  try {
    const handle = await lock.acquire();

    // Start long-running work
    const workPromise = doLongRunningWork();

    // Extend the lock halfway through
    setTimeout(async () => {
      const extended = await lock.extend(handle, 10000); // Extend to 10 more seconds
      console.log('Lock extended:', extended);
    }, 2500);

    await workPromise;
    await lock.release(handle);
  } catch (error) {
    console.error('Lock operation failed:', error.message);
  } finally {
    await client.disconnect();
  }
}

// Example 4: Lock status checking
async function lockStatusExample() {
  const client = new Redis('redis://localhost:6379');

  const lock = createLock({
    adapter: new IoredisAdapter(client),
    key: 'status-check-resource',
    ttl: 15000,
  });

  // Check if resource is already locked
  const isLocked = await lock.isLocked('status-check-resource');
  console.log('Resource locked:', isLocked);

  if (!isLocked) {
    const handle = await lock.acquire();

    // Check again - should be true now
    const nowLocked = await lock.isLocked('status-check-resource');
    console.log('Resource now locked:', nowLocked);

    await lock.release(handle);
  }

  client.disconnect();
}

// Example 5: Error handling patterns
async function errorHandlingExample() {
  const client = createNodeRedisClient({ url: 'redis://localhost:6379' });
  await client.connect();

  const lock = createLock({
    adapter: new NodeRedisAdapter(client),
    key: 'error-demo',
    ttl: 5000,
  });

  try {
    const handle = await lock.acquire();

    try {
      // Simulated work that might fail
      await riskyWork();
    } catch (workError) {
      console.error('Work failed:', workError.message);
      // Still need to release the lock
    } finally {
      // Always release in finally block
      await lock.release(handle);
    }
  } catch (lockError) {
    console.error('Failed to acquire lock:', lockError.message);
  } finally {
    await client.disconnect();
  }
}

// Example 6: Multiple locks pattern
async function multipleLockExample() {
  const client = createNodeRedisClient({ url: 'redis://localhost:6379' });
  await client.connect();

  const adapter = new NodeRedisAdapter(client);

  // Create multiple locks for different resources
  const userLock = createLock({
    adapter,
    key: 'user:123',
    ttl: 10000,
  });

  const accountLock = createLock({
    adapter,
    key: 'account:456',
    ttl: 10000,
  });

  try {
    // Acquire both locks (order matters to avoid deadlock)
    const userHandle = await userLock.acquire();
    const accountHandle = await accountLock.acquire();

    // Perform transaction requiring both resources
    await transferFunds();

    // Release in reverse order
    await accountLock.release(accountHandle);
    await userLock.release(userHandle);
  } catch (error) {
    console.error('Multi-lock operation failed:', error.message);
  } finally {
    await client.disconnect();
  }
}

// Example 7: Using with async/await patterns
async function asyncPatternExample() {
  const client = new Redis('redis://localhost:6379');

  const withLock = async <T>(key: string, fn: () => Promise<T>, ttl = 30000): Promise<T> => {
    const lock = createLock({
      adapter: new IoredisAdapter(client),
      key,
      ttl,
    });

    const handle = await lock.acquire();
    try {
      return await fn();
    } finally {
      await lock.release(handle);
    }
  };

  try {
    // Clean API for lock-protected operations
    const result = await withLock('calculation', async () => {
      return performComplexCalculation();
    });

    console.log('Calculation result:', result);
  } catch (error) {
    console.error('Operation failed:', error.message);
  } finally {
    client.disconnect();
  }
}

// Mock functions for examples
async function doSomeCriticalWork(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 1000));
}

async function doSomeWork(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 500));
}

async function doLongRunningWork(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 8000));
}

async function riskyWork(): Promise<void> {
  if (Math.random() > 0.5) {
    throw new Error('Work failed randomly');
  }
}

async function transferFunds(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 2000));
}

async function performComplexCalculation(): Promise<number> {
  await new Promise(resolve => setTimeout(resolve, 1500));
  return 42;
}

export {
  basicLockExample,
  retryLockExample,
  lockExtensionExample,
  lockStatusExample,
  errorHandlingExample,
  multipleLockExample,
  asyncPatternExample,
};
