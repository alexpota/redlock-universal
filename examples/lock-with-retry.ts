/**
 * Lock with retry example using redlock-universal
 * 
 * This example demonstrates lock acquisition with retry logic for contested resources.
 */

import { createLock, NodeRedisAdapter, LockAcquisitionError } from 'redlock-universal';
import { createClient } from 'redis';

async function retryExample() {
  // Setup Redis client
  const client = createClient({ url: 'redis://localhost:6379' });
  await client.connect();

  // Create lock with retry configuration
  const lock = createLock({
    adapter: new NodeRedisAdapter(client),
    key: 'contested-resource',
    ttl: 10000, // 10 seconds
    retryAttempts: 5,
    retryDelay: 200, // 200ms between retries
  });

  try {
    console.log('Attempting to acquire contested lock with retries...');
    const startTime = Date.now();
    const handle = await lock.acquire();
    const acquisitionTime = Date.now() - startTime;
    
    console.log(`Lock acquired after ${acquisitionTime}ms!`);
    console.log(`Attempts: ${handle.metadata?.attempts ?? 1}`);

    // Simulate work
    console.log('Working with contested resource...');
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    await lock.release(handle);
    console.log('Lock released successfully!');
  } catch (error) {
    if (error instanceof LockAcquisitionError) {
      console.error(`Failed to acquire lock after ${error.attempts} attempts`);
      console.error(`Resource is highly contested, consider:`)
      console.error('1. Increasing retry attempts');
      console.error('2. Adding exponential backoff');
      console.error('3. Queueing the operation for later');
    } else {
      console.error('Unexpected error:', error);
    }
  } finally {
    await client.disconnect();
  }
}

// Simulate multiple processes competing for the same resource
async function simulateContention() {
  console.log('Simulating contention with multiple processes...');
  
  const processes = Array.from({ length: 3 }, (_, i) => 
    new Promise(async (resolve) => {
      console.log(`Process ${i + 1} starting...`);
      await new Promise(r => setTimeout(r, Math.random() * 1000)); // Random delay
      
      const client = createClient({ url: 'redis://localhost:6379' });
      await client.connect();
      
      const lock = createLock({
        adapter: new NodeRedisAdapter(client),
        key: 'contested-resource',
        ttl: 3000,
        retryAttempts: 3,
        retryDelay: 100,
      });

      try {
        const handle = await lock.acquire();
        console.log(`Process ${i + 1} acquired lock!`);
        
        // Hold lock for varying durations
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
        
        await lock.release(handle);
        console.log(`Process ${i + 1} released lock!`);
      } catch (error) {
        console.log(`Process ${i + 1} failed to acquire lock`);
      } finally {
        await client.disconnect();
      }
      
      resolve(void 0);
    })
  );

  await Promise.all(processes);
  console.log('All processes completed!');
}

// Run examples
async function main() {
  console.log('=== Single Process with Retry ===');
  await retryExample();
  
  console.log('\n=== Multiple Processes Contention ===');
  await simulateContention();
}

main().catch(console.error);