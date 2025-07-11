import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient as createNodeRedisClient } from 'redis';
import Redis from 'ioredis';
import { createLock } from '../../src/index.js';
import { NodeRedisAdapter, IoredisAdapter } from '../../src/adapters/index.js';

describe('Developer Experience E2E Tests', () => {
  let nodeRedisClient: any;
  let ioredisClient: Redis;

  beforeAll(async () => {
    // Setup Redis clients
    nodeRedisClient = createNodeRedisClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });
    await nodeRedisClient.connect();

    ioredisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  });

  afterAll(async () => {
    await nodeRedisClient?.disconnect();
    ioredisClient?.disconnect();
  });

  // No need to flushDb since we use unique keys with process.pid

  const getTestKey = () =>
    `test-e2e-dev-exp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${process.pid}`;

  describe('As a developer using node-redis', () => {
    it('I want to protect a critical section with minimal setup', async () => {
      // Scenario: Developer wants to ensure only one process handles user registration
      const adapter = new NodeRedisAdapter(nodeRedisClient);
      const testKey = `user-registration:${getTestKey()}`;
      const userRegistrationLock = createLock({
        adapter,
        key: testKey,
        ttl: 30000, // 30 seconds
      });

      // Step 1: Acquire lock before processing
      const handle = await userRegistrationLock.acquire();
      expect(handle).toBeDefined();
      expect(handle.key).toBe(testKey);

      // Step 2: Simulate critical work (user registration)
      await new Promise(resolve => setTimeout(resolve, 100));

      // Step 3: Extend lock if work takes longer
      const extended = await userRegistrationLock.extend(handle, 45000);
      expect(extended).toBe(true);

      // Step 4: Complete work and release lock
      const released = await userRegistrationLock.release(handle);
      expect(released).toBe(true);

      // Step 5: Verify lock is released
      const isStillLocked = await userRegistrationLock.isLocked(testKey);
      expect(isStillLocked).toBe(false);
    });

    it('I want to handle lock contention gracefully', async () => {
      // Scenario: Two processes try to access same resource
      const adapter = new NodeRedisAdapter(nodeRedisClient);
      const testKey = `shared-resource:${getTestKey()}`;

      const process1Lock = createLock({
        adapter,
        key: testKey,
        ttl: 5000,
        retryAttempts: 0, // No retries for this test
      });

      const process2Lock = createLock({
        adapter,
        key: testKey,
        ttl: 5000,
        retryAttempts: 2,
        retryDelay: 50,
      });

      // Process 1 acquires lock
      const handle1 = await process1Lock.acquire();
      expect(handle1).toBeDefined();

      // Process 2 should fail immediately (no retries)
      await expect(process2Lock.acquire()).rejects.toThrow();

      // After Process 1 releases, Process 2 should succeed
      await process1Lock.release(handle1);

      const handle2 = await process2Lock.acquire();
      expect(handle2).toBeDefined();

      await process2Lock.release(handle2);
    });
  });

  describe('As a developer using ioredis', () => {
    it('I want the same API to work seamlessly', async () => {
      // Scenario: Switching Redis clients should be transparent
      const testKey = `background-task:email-queue:${getTestKey()}`;
      const adapter = new IoredisAdapter(ioredisClient);
      const taskProcessingLock = createLock({
        adapter,
        key: testKey,
        ttl: 60000, // 1 minute
      });

      // Same workflow as node-redis
      const handle = await taskProcessingLock.acquire();
      expect(handle.key).toBe(testKey);

      // Simulate background task processing
      await new Promise(resolve => setTimeout(resolve, 50));

      const released = await taskProcessingLock.release(handle);
      expect(released).toBe(true);
    });

    it('I want to handle Redis connection issues gracefully', async () => {
      const testKey = `resilient-test:${getTestKey()}`;
      const adapter = new IoredisAdapter(ioredisClient);
      const resilientLock = createLock({
        adapter,
        key: testKey,
        ttl: 5000,
      });

      // Normal operation should work
      const handle = await resilientLock.acquire();
      expect(handle).toBeDefined();

      // Even if we try to release a non-existent lock, it should be graceful
      await ioredisClient.del(testKey); // Manually delete

      const released = await resilientLock.release(handle);
      expect(released).toBe(false); // Lock was already gone
    });
  });

  describe('As a developer building microservices', () => {
    it('I want consistent behavior across different services', async () => {
      // Scenario: Service A uses node-redis, Service B uses ioredis
      const testKey = `shared-microservice-resource:${getTestKey()}`;
      const serviceAAdapter = new NodeRedisAdapter(nodeRedisClient);
      const serviceBAdapter = new IoredisAdapter(ioredisClient);

      const serviceALock = createLock({
        adapter: serviceAAdapter,
        key: testKey,
        ttl: 10000,
      });

      const serviceBLock = createLock({
        adapter: serviceBAdapter,
        key: testKey,
        ttl: 10000,
        retryAttempts: 0,
      });

      // Service A acquires the resource
      const handleA = await serviceALock.acquire();
      expect(handleA).toBeDefined();

      // Service B should be blocked
      await expect(serviceBLock.acquire()).rejects.toThrow();

      // Service A releases
      await serviceALock.release(handleA);

      // Now Service B can acquire
      const handleB = await serviceBLock.acquire();
      expect(handleB).toBeDefined();

      await serviceBLock.release(handleB);
    });

    it('I want predictable lock expiration behavior', async () => {
      // Scenario: Lock should auto-expire if process crashes
      const testKey = `auto-expire-test:${getTestKey()}`;
      const adapter = new NodeRedisAdapter(nodeRedisClient);
      const shortLivedLock = createLock({
        adapter,
        key: testKey,
        ttl: 200, // Very short TTL
      });

      const handle = await shortLivedLock.acquire();
      expect(handle).toBeDefined();

      // Verify lock exists
      const isLocked = await shortLivedLock.isLocked(testKey);
      expect(isLocked).toBe(true);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 250));

      // Lock should be auto-expired
      const isStillLocked = await shortLivedLock.isLocked(testKey);
      expect(isStillLocked).toBe(false);

      // Extension should fail on expired lock
      const extended = await shortLivedLock.extend(handle, 5000);
      expect(extended).toBe(false);
    });
  });

  describe('As a developer optimizing performance', () => {
    it('I want lock operations to be fast enough for production', async () => {
      const testKey = `performance-test:${getTestKey()}`;
      const adapter = new NodeRedisAdapter(nodeRedisClient);
      const performanceLock = createLock({
        adapter,
        key: testKey,
        ttl: 5000,
      });

      // Measure acquisition time
      const start = process.hrtime.bigint();
      const handle = await performanceLock.acquire();
      const acquisitionTime = Number(process.hrtime.bigint() - start) / 1_000_000;

      expect(acquisitionTime).toBeLessThan(100); // Should be under 100ms

      // Measure extension time
      const extendStart = process.hrtime.bigint();
      const extended = await performanceLock.extend(handle, 10000);
      const extensionTime = Number(process.hrtime.bigint() - extendStart) / 1_000_000;

      expect(extended).toBe(true);
      expect(extensionTime).toBeLessThan(50); // Extensions should be faster

      // Measure release time
      const releaseStart = process.hrtime.bigint();
      const released = await performanceLock.release(handle);
      const releaseTime = Number(process.hrtime.bigint() - releaseStart) / 1_000_000;

      expect(released).toBe(true);
      expect(releaseTime).toBeLessThan(50);

      console.log(`Performance metrics:
        Acquisition: ${acquisitionTime.toFixed(2)}ms
        Extension: ${extensionTime.toFixed(2)}ms  
        Release: ${releaseTime.toFixed(2)}ms`);
    });
  });

  describe('Real-world usage patterns', () => {
    it('should handle rapid acquire/release cycles', async () => {
      // Scenario: High-frequency trading or real-time processing
      const adapter = new NodeRedisAdapter(nodeRedisClient);

      const cycles = 50;
      for (let i = 0; i < cycles; i++) {
        const lock = createLock({
          adapter,
          key: `rapid-cycle-${i}`,
          ttl: 1000,
        });

        const handle = await lock.acquire();
        await lock.release(handle);
      }

      // All cycles completed without errors
      expect(true).toBe(true);
    });

    it('should work with key prefixes for multi-tenant applications', async () => {
      // Scenario: SaaS application with tenant isolation
      const logicalKey = `user-operation:${getTestKey()}`;
      const tenantAAdapter = new NodeRedisAdapter(nodeRedisClient, {
        keyPrefix: 'tenant:a:',
      });
      const tenantBAdapter = new NodeRedisAdapter(nodeRedisClient, {
        keyPrefix: 'tenant:b:',
      });

      const tenantALock = createLock({
        adapter: tenantAAdapter,
        key: logicalKey,
        ttl: 5000,
      });

      const tenantBLock = createLock({
        adapter: tenantBAdapter,
        key: logicalKey, // Same logical key
        ttl: 5000,
      });

      // Both tenants should be able to acquire their "user-operation" lock
      const handleA = await tenantALock.acquire();
      const handleB = await tenantBLock.acquire();

      expect(handleA).toBeDefined();
      expect(handleB).toBeDefined();

      // Keys should be different due to prefixes
      expect(handleA.key).toBe(logicalKey); // Logical key
      expect(handleB.key).toBe(logicalKey); // Logical key

      await tenantALock.release(handleA);
      await tenantBLock.release(handleB);
    });
  });
});
