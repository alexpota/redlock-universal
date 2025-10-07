/**
 * Lock extension example using redlock-universal
 * 
 * This example demonstrates extending lock TTL for long-running operations.
 */

import { createLock, NodeRedisAdapter } from 'redlock-universal';
import { createClient } from 'redis';

async function lockExtensionExample() {
  // Setup Redis client
  const client = createClient({ url: 'redis://localhost:6379' });
  await client.connect();

  // Create lock with shorter initial TTL
  const lock = createLock({
    adapter: new NodeRedisAdapter(client),
    key: 'long-running-task',
    ttl: 5000, // Start with 5 seconds
  });

  try {
    console.log('Acquiring lock for long-running task...');
    const handle = await lock.acquire();
    console.log('Lock acquired with 5s TTL');

    // Simulate long-running work that needs lock extension
    for (let i = 1; i <= 5; i++) {
      console.log(`Processing step ${i}/5...`);
      
      // Do some work (simulate 2 seconds per step)
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extend lock before it expires (after every 2 steps)
      if (i % 2 === 0 && i < 5) {
        console.log('Extending lock for another 10 seconds...');
        const extended = await lock.extend(handle, 10000);
        
        if (extended) {
          console.log('Lock extended successfully!');
        } else {
          console.error('Failed to extend lock - it may have expired');
          break;
        }
      }
    }
    
    console.log('Long-running task completed, releasing lock...');
    await lock.release(handle);
    console.log('Lock released successfully!');
  } catch (error) {
    console.error('Lock extension example failed:', error);
  } finally {
    await client.disconnect();
  }
}

// Example with automatic extension monitoring
async function autoExtensionExample() {
  const client = createClient({ url: 'redis://localhost:6379' });
  await client.connect();

  const lock = createLock({
    adapter: new NodeRedisAdapter(client),
    key: 'auto-extend-task',
    ttl: 8000, // 8 seconds initial TTL
  });

  try {
    console.log('\n=== Auto-Extension Example ===');
    const handle = await lock.acquire();
    console.log('Lock acquired with 8s TTL');

    // Set up automatic extension timer
    const extensionInterval = setInterval(async () => {
      console.log('Auto-extending lock...');
      const extended = await lock.extend(handle, 8000);
      
      if (!extended) {
        console.log('Failed to extend lock - stopping auto-extension');
        clearInterval(extensionInterval);
      } else {
        console.log('Lock auto-extended for 8 more seconds');
      }
    }, 6000); // Extend every 6 seconds (before 8s TTL expires)

    // Simulate variable-length work
    console.log('Starting work of unknown duration...');
    const workDuration = 15000 + Math.random() * 10000; // 15-25 seconds
    console.log(`Work will take approximately ${Math.round(workDuration / 1000)} seconds`);
    
    await new Promise(resolve => setTimeout(resolve, workDuration));
    
    // Stop auto-extension and release lock
    clearInterval(extensionInterval);
    console.log('Work completed, releasing lock...');
    await lock.release(handle);
    console.log('Lock released successfully!');
  } catch (error) {
    console.error('Auto-extension example failed:', error);
  } finally {
    await client.disconnect();
  }
}

// Run examples
async function main() {
  console.log('=== Manual Lock Extension ===');
  await lockExtensionExample();
  
  await autoExtensionExample();
}

main().catch(console.error);