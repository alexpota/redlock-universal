import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient as createNodeRedisClient } from 'redis';
import { SimpleLock, NodeRedisAdapter } from '../../../src/index.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';
import { generateTestKey } from '../../shared/constants.js';
import { execSync } from 'node:child_process';

const INTEGRATION_TEST_TIMEOUT = 30000;

function stopRedis(): void {
  execSync('docker compose -f docker-compose.test.yml stop redis-2', {
    stdio: 'pipe',
    timeout: 10000,
  });
}

function startRedis(): void {
  execSync('docker compose -f docker-compose.test.yml start redis-2', {
    stdio: 'pipe',
    timeout: 10000,
  });
}

function waitForRedisReady(maxWaitMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      try {
        execSync('docker compose -f docker-compose.test.yml exec -T redis-2 redis-cli ping', {
          stdio: 'pipe',
          timeout: 2000,
        });
        resolve();
      } catch {
        if (Date.now() - start > maxWaitMs) {
          reject(new Error('Redis did not become ready in time'));
        } else {
          setTimeout(check, 500);
        }
      }
    };
    check();
  });
}

describe('SimpleLock Circuit Breaker Integration Tests', () => {
  let client: ReturnType<typeof createNodeRedisClient>;
  let adapter: RedisAdapter;

  beforeAll(async () => {
    startRedis();
    await waitForRedisReady();

    client = createNodeRedisClient({ url: 'redis://localhost:6380' });
    // Suppress expected socket errors when Redis is stopped during tests
    client.on('error', () => {});
    await client.connect();
    adapter = new NodeRedisAdapter(client);
  });

  afterAll(async () => {
    try {
      startRedis();
      await waitForRedisReady();
    } catch {
      // Best effort restore
    }
    await client?.disconnect().catch(() => {});
  });

  it(
    'should open breaker during outage and recover after Redis restarts',
    async () => {
      const lock = new SimpleLock({
        adapter,
        key: generateTestKey('cb-recovery'),
        ttl: 5000,
        retryAttempts: 0,
        circuitBreaker: {
          failureThreshold: 3,
          resetTimeout: 5000,
          healthCheckInterval: 1000,
        },
      });

      // Verify lock works initially
      const handle = await lock.acquire();
      await lock.release(handle);

      // Stop Redis
      stopRedis();

      // Accumulate failures to trip the breaker
      for (let i = 0; i < 3; i++) {
        try {
          await lock.acquire();
        } catch {
          // Expected failures
        }
      }

      // Breaker should be open
      expect(lock.getHealth().circuitBreaker.state).toBe('open');

      // Wait for resetTimeout to elapse
      await new Promise(r => setTimeout(r, 6000));

      // Restart Redis before the probe
      startRedis();
      await waitForRedisReady();

      // Reconnect the client
      try {
        await client.disconnect();
      } catch {
        /* ignore */
      }
      client = createNodeRedisClient({ url: 'redis://localhost:6380' });
      client.on('error', () => {});
      await client.connect();
      adapter = new NodeRedisAdapter(client);

      // New lock with recovered adapter
      const recoveredLock = new SimpleLock({
        adapter,
        key: generateTestKey('cb-recovered'),
        ttl: 5000,
        retryAttempts: 1,
        circuitBreaker: {
          failureThreshold: 3,
          resetTimeout: 5000,
          healthCheckInterval: 1000,
        },
      });

      const handle2 = await recoveredLock.acquire();
      expect(handle2).toBeDefined();
      await recoveredLock.release(handle2);
    },
    INTEGRATION_TEST_TIMEOUT
  );

  it(
    'should fast-fail when breaker is open instead of hanging',
    async () => {
      const lock = new SimpleLock({
        adapter,
        key: generateTestKey('cb-fast-fail'),
        ttl: 5000,
        retryAttempts: 0,
        circuitBreaker: {
          failureThreshold: 3,
          resetTimeout: 60000,
        },
      });

      // Stop Redis and trip the breaker
      stopRedis();

      for (let i = 0; i < 3; i++) {
        try {
          await lock.acquire();
        } catch {
          // Expected
        }
      }

      expect(lock.getHealth().circuitBreaker.state).toBe('open');

      // Measure how fast the breaker rejects
      const start = Date.now();
      await expect(lock.acquire()).rejects.toThrow('Circuit breaker is open');
      const elapsed = Date.now() - start;

      // Should reject in under 5ms (not hanging on TCP timeout)
      expect(elapsed).toBeLessThan(5);

      // Restore Redis for cleanup
      startRedis();
      await waitForRedisReady();
    },
    INTEGRATION_TEST_TIMEOUT
  );
});
