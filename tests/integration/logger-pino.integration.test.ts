/**
 * Integration tests for Pino logger compatibility
 * Tests with actual Pino library (not mocks) via createPinoAdapter()
 *
 * Automatically skips if Pino is not installed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type RedisClientType } from 'redis';
import { createLock, NodeRedisAdapter, createPinoAdapter, type ILogger } from '../../src/index.js';

let pino: typeof import('pino').default | null = null;
try {
  pino = (await import('pino')).default;
} catch {
  console.warn('⚠️  Pino not installed - skipping Pino integration tests');
}

describe('Pino Logger Integration', () => {
  let redisClient: RedisClientType;
  let adapter: NodeRedisAdapter;
  let pinoLogger: ILogger;

  beforeAll(async () => {
    if (!pino) return;

    // Create Pino logger
    const rawPinoLogger = pino({ level: 'debug' });

    // Create adapter
    pinoLogger = createPinoAdapter(rawPinoLogger);

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

  it('should work with Pino adapter in SimpleLock', async () => {
    if (!pino) return;
    const lock = createLock({
      adapter,
      key: 'pino:integration:test1',
      ttl: 5000,
      logger: pinoLogger,
    });

    const handle = await lock.acquire();
    expect(handle).toBeDefined();
    expect(handle.key).toBe('pino:integration:test1');

    const released = await lock.release(handle);
    expect(released).toBe(true);
  });

  it('should accept Pino adapter without errors', async () => {
    if (!pino) return;
    const rawPino = pino({ level: 'debug' });
    const logger = createPinoAdapter(rawPino);

    const lock = createLock({
      adapter,
      key: 'pino:integration:test2',
      ttl: 5000,
      logger,
    });

    const handle = await lock.acquire();
    expect(handle).toBeDefined();
    await lock.release(handle);
  });

  it('should handle errors with Pino adapter', async () => {
    if (!pino) return;
    const rawPino = pino({ level: 'error' });
    const logger = createPinoAdapter(rawPino);

    // Test error logging
    const testError = new Error('Test error');
    logger.error('Test error message', testError, { code: 'TEST_ERR' });

    // If no exception thrown, test passes
    expect(true).toBe(true);
  });

  it('should work with using() API and Pino', async () => {
    if (!pino) return;
    const lock = createLock({
      adapter,
      key: 'pino:integration:test3',
      ttl: 10000,
      logger: pinoLogger,
    });

    let workCompleted = false;

    await lock.using(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      workCompleted = true;
    });

    expect(workCompleted).toBe(true);
  });
});
