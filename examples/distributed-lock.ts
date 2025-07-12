/**
 * Distributed lock example using RedLock Universal
 *
 * This example demonstrates distributed locking across multiple Redis instances.
 */

import { createRedlock, NodeRedisAdapter } from 'redlock-universal';
import { createClient } from 'redis';

async function distributedExample() {
  // Setup multiple Redis connections
  const clients = [
    createClient({ url: 'redis://localhost:6379' }),
    createClient({ url: 'redis://localhost:6380' }),
    createClient({ url: 'redis://localhost:6381' }),
  ];

  // Connect all clients
  await Promise.all(clients.map(client => client.connect()));

  // Create adapters
  const adapters = clients.map(client => new NodeRedisAdapter(client));

  // Create distributed lock
  const redlock = createRedlock({
    adapters,
    key: 'payment:order:456',
    ttl: 30000, // 30 seconds
    quorum: 2, // Majority consensus (2 out of 3)
  });

  try {
    console.log('Attempting to acquire distributed lock...');
    const handle = await redlock.acquire();
    console.log('Distributed lock acquired successfully!');
    console.log(`Locked nodes: ${handle.metadata.nodes.length}`);

    // Simulate payment processing
    console.log('Processing payment...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('Payment processed, releasing lock...');
    await redlock.release(handle);
    console.log('Distributed lock released successfully!');
  } catch (error) {
    console.error('Distributed lock operation failed:', error);
  } finally {
    // Disconnect all clients
    await Promise.all(clients.map(client => client.disconnect()));
  }
}

// Run example
distributedExample().catch(console.error);
