/**
 * Example: Using redlock-universal with Bunyan logger
 *
 * Demonstrates how to integrate Bunyan for structured JSON logging
 * using the createBunyanAdapter() helper.
 */

import * as bunyan from 'bunyan';
import { createClient } from 'redis';
import { createRedlock, createBunyanAdapter, NodeRedisAdapter } from '../src/index.js';

async function main() {
  // Create Bunyan logger
  const bunyanLogger = bunyan.createLogger({
    name: 'redlock-example',
    level: 'info',
    streams: [
      {
        level: 'info',
        stream: process.stdout,
      },
    ],
  });

  bunyanLogger.info('Starting Bunyan integration example');

  // Create adapter for Bunyan (required - fields-first signature)
  const logger = createBunyanAdapter(bunyanLogger);

  // For this example, we'll use a single Redis instance
  // In production, use multiple Redis instances for true distributed locking
  const redis = createClient({ url: 'redis://localhost:6379' });
  await redis.connect();

  // Create adapter
  const adapter = new NodeRedisAdapter(redis);

  // Create distributed lock with Bunyan adapter
  // Note: For true distributed locking, provide multiple adapters
  const lock = createRedlock({
    adapters: [adapter],
    key: 'bunyan:example:distributed-resource',
    ttl: 10000,
    logger, // Bunyan adapter works seamlessly
  });

  try {
    // Acquire distributed lock
    const handle = await lock.acquire();
    bunyanLogger.info({ lockId: handle.id, key: handle.key }, 'Distributed lock acquired');

    // Simulate critical section
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Release lock
    await lock.release(handle);
    bunyanLogger.info('Distributed lock released');
  } catch (error) {
    bunyanLogger.error({ err: error }, 'Lock operation failed');
  } finally {
    await redis.disconnect();
    bunyanLogger.info('Redis connection closed');
  }
}

main().catch(console.error);
