/**
 * Integration tests for Winston logger compatibility
 * Tests with actual Winston library (not mocks)
 *
 * Automatically skips if Winston is not installed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type RedisClientType } from 'redis';
import { createLock, NodeRedisAdapter, type ILogger } from '../../src/index.js';

let winston: typeof import('winston') | null = null;
try {
  winston = await import('winston');
} catch {
  console.warn('⚠️  Winston not installed - skipping Winston integration tests');
}

describe('Winston Logger Integration', () => {
  let redisClient: RedisClientType;
  let adapter: NodeRedisAdapter;
  let winstonLogger: ILogger;

  beforeAll(async () => {
    if (!winston) return;

    // Create Winston logger
    winstonLogger = winston.createLogger({
      level: 'debug',
      format: winston.format.json(),
      transports: [new winston.transports.Console({ silent: true })],
    });

    // Setup Redis
    redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    await redisClient.connect();
    adapter = new NodeRedisAdapter(redisClient);
  });

  afterAll(async () => {
    if (redisClient?.isOpen) {
      await redisClient.disconnect();
    }
  });

  it('should work with Winston logger in SimpleLock', async () => {
    if (!winston) return;
    const lock = createLock({
      adapter,
      key: 'winston:integration:test1',
      ttl: 5000,
      logger: winstonLogger,
    });

    const handle = await lock.acquire();
    expect(handle).toBeDefined();
    expect(handle.key).toBe('winston:integration:test1');

    const released = await lock.release(handle);
    expect(released).toBe(true);
  });

  it('should accept Winston logger without errors', async () => {
    if (!winston) return;
    const testLogger = winston.createLogger({
      level: 'debug',
      format: winston.format.json(),
      transports: [new winston.transports.Console({ silent: true })],
    });

    const lock = createLock({
      adapter,
      key: 'winston:integration:test2',
      ttl: 5000,
      logger: testLogger,
    });

    const handle = await lock.acquire();
    expect(handle).toBeDefined();
    await lock.release(handle);
  });

  it('should work with Winston child logger', async () => {
    if (!winston) return;
    const childLogger = winstonLogger.child({ service: 'redlock-test' });

    const lock = createLock({
      adapter,
      key: 'winston:integration:test3',
      ttl: 5000,
      logger: childLogger as ILogger,
    });

    const handle = await lock.acquire();
    expect(handle).toBeDefined();

    await lock.release(handle);
  });
});
