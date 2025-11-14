/**
 * Integration tests for Bunyan logger compatibility
 * Tests with actual Bunyan library (not mocks) via createBunyanAdapter()
 *
 * Automatically skips if Bunyan is not installed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type RedisClientType } from 'redis';
import {
  createLock,
  NodeRedisAdapter,
  createBunyanAdapter,
  type ILogger,
} from '../../src/index.js';

let bunyan: typeof import('bunyan') | null = null;
try {
  bunyan = await import('bunyan');
} catch {
  console.warn('⚠️  Bunyan not installed - skipping Bunyan integration tests');
}

describe('Bunyan Logger Integration', () => {
  let redisClient: RedisClientType;
  let adapter: NodeRedisAdapter;
  let bunyanLogger: ILogger;

  beforeAll(async () => {
    if (!bunyan) return;

    // Create Bunyan logger
    const rawBunyanLogger = bunyan.createLogger({
      name: 'test-logger',
      level: 'debug',
    });

    // Create adapter
    bunyanLogger = createBunyanAdapter(rawBunyanLogger);

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

  it('should work with Bunyan adapter in SimpleLock', async () => {
    if (!bunyan) return;
    const lock = createLock({
      adapter,
      key: 'bunyan:integration:test1',
      ttl: 5000,
      logger: bunyanLogger,
    });

    const handle = await lock.acquire();
    expect(handle).toBeDefined();
    expect(handle.key).toBe('bunyan:integration:test1');

    const released = await lock.release(handle);
    expect(released).toBe(true);
  });

  it('should accept Bunyan adapter without errors', async () => {
    if (!bunyan) return;
    const rawBunyan = bunyan.createLogger({
      name: 'test-logger',
      level: 'debug',
    });
    const logger = createBunyanAdapter(rawBunyan);

    const lock = createLock({
      adapter,
      key: 'bunyan:integration:test2',
      ttl: 5000,
      logger,
    });

    const handle = await lock.acquire();
    expect(handle).toBeDefined();
    await lock.release(handle);
  });

  it('should handle errors with Bunyan adapter', async () => {
    if (!bunyan) return;
    const rawBunyan = bunyan.createLogger({
      name: 'test-logger',
      level: 'error',
    });
    const logger = createBunyanAdapter(rawBunyan);

    // Test error logging
    const testError = new Error('Test error');
    logger.error('Test error message', testError, { code: 'TEST_ERR' });

    // If no exception thrown, test passes
    expect(true).toBe(true);
  });

  it('should work with using() API and Bunyan', async () => {
    if (!bunyan) return;
    const lock = createLock({
      adapter,
      key: 'bunyan:integration:test3',
      ttl: 10000,
      logger: bunyanLogger,
    });

    let workCompleted = false;

    await lock.using(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      workCompleted = true;
    });

    expect(workCompleted).toBe(true);
  });
});
