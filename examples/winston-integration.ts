/**
 * Example: Using redlock-universal with Winston logger
 *
 * Demonstrates how to integrate Winston for production-grade logging
 * with SimpleLock and RedLock implementations.
 */

import * as winston from 'winston';
import { createClient } from 'redis';
import { createLock, NodeRedisAdapter } from '../src/index.js';

async function main() {
  // Create Winston logger
  const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
      }),
      new winston.transports.File({ filename: 'logs/redlock-error.log', level: 'error' }),
      new winston.transports.File({ filename: 'logs/redlock-combined.log' }),
    ],
  });

  logger.info('Starting Winston integration example');

  // Create Redis client
  const redisClient = createClient({ url: 'redis://localhost:6379' });
  await redisClient.connect();

  // Create adapter
  const adapter = new NodeRedisAdapter(redisClient);

  // Create lock with Winston logger
  const lock = createLock({
    adapter,
    key: 'winston:example:resource',
    ttl: 10000,
    logger, // Winston logger works directly - no adapter needed!
  });

  try {
    // Acquire lock - Winston will log circuit breaker events, health checks, etc.
    const handle = await lock.acquire();
    logger.info('Lock acquired successfully', {
      lockId: handle.id,
      key: handle.key,
      ttl: handle.ttl,
    });

    // Simulate work
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Release lock
    await lock.release(handle);
    logger.info('Lock released successfully');
  } catch (error) {
    logger.error('Lock operation failed', { error });
  } finally {
    await redisClient.disconnect();
    logger.info('Redis connection closed');
  }
}

main().catch(console.error);
