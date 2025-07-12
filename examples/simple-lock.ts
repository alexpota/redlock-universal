/**
 * Simple lock example using RedLock Universal
 * 
 * This example demonstrates basic lock usage with a single Redis instance.
 */

import { createLock, NodeRedisAdapter } from 'redlock-universal';
import { createClient } from 'redis';

async function simpleExample() {
  // Setup Redis client
  const client = createClient({ url: 'redis://localhost:6379' });
  await client.connect();

  // Create lock
  const lock = createLock({
    adapter: new NodeRedisAdapter(client),
    key: 'user:123:profile',
    ttl: 30000, // 30 seconds
  });

  try {
    console.log('Attempting to acquire lock...');
    const handle = await lock.acquire();
    console.log('Lock acquired successfully!');

    // Simulate some work
    console.log('Performing critical work...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('Work completed, releasing lock...');
    await lock.release(handle);
    console.log('Lock released successfully!');
  } catch (error) {
    console.error('Lock operation failed:', error);
  } finally {
    await client.disconnect();
  }
}

// Run example
simpleExample().catch(console.error);