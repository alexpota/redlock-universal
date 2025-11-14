/**
 * Example: Using redlock-universal with Pino logger
 *
 * Demonstrates how to integrate Pino (fastest Node.js logger)
 * using the createPinoAdapter() helper.
 */

import pino from 'pino';
import { createClient } from 'redis';
import { createLock, createPinoAdapter, NodeRedisAdapter } from '../src/index.js';

async function main() {
  // Create Pino logger
  const pinoLogger = (pino.default || pino)({
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
      },
    },
  });

  pinoLogger.info('Starting Pino integration example');

  // Create adapter for Pino (required - object-first signature)
  const logger = createPinoAdapter(pinoLogger);

  // Create Redis client
  const redisClient = createClient({ url: 'redis://localhost:6379' });
  await redisClient.connect();

  // Create adapter
  const adapter = new NodeRedisAdapter(redisClient);

  // Create lock with Pino adapter
  const lock = createLock({
    adapter,
    key: 'pino:example:resource',
    ttl: 10000,
    logger, // Pino adapter works seamlessly
  });

  try {
    // Use the using() API with auto-extension
    await lock.using(async signal => {
      pinoLogger.info('Lock acquired, starting work');

      // Simulate long-running work
      for (let i = 0; i < 5; i++) {
        if (signal.aborted) {
          pinoLogger.warn('Work aborted - lock extension failed');
          break;
        }

        pinoLogger.info({ step: i + 1 }, 'Processing step');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      pinoLogger.info('Work completed successfully');
    });
  } catch (error) {
    pinoLogger.error({ err: error }, 'Lock operation failed');
  } finally {
    await redisClient.disconnect();
    pinoLogger.info('Redis connection closed');
  }
}

main().catch(console.error);
