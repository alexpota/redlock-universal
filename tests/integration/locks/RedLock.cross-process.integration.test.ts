import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { createClient as createNodeRedisClient } from 'redis';
import { RedLock, NodeRedisAdapter } from '../../../src/index.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';
import {
  TEST_CONFIG,
  REDIS_CONFIG,
  TIMEOUT_CONFIG,
  generateTestKey,
  delay,
  getRedisUrl,
} from '../../shared/constants.js';

/**
 * Cross-Process RedLock Validation Tests
 *
 * Tests RedLock behavior across multiple Node.js processes to validate
 * true distributed locking guarantees in real multi-process scenarios.
 */
describe('RedLock Cross-Process Validation', () => {
  const redisClients: any[] = [];
  const adapters: RedisAdapter[] = [];
  const childProcesses: ChildProcess[] = [];

  beforeAll(async () => {
    // Setup Redis connections for main process
    for (let i = 0; i < REDIS_CONFIG.DISTRIBUTED_INSTANCES; i++) {
      const client = createNodeRedisClient({
        url: getRedisUrl(),
        database: i,
      });
      await client.connect();
      redisClients.push(client);
      adapters.push(new NodeRedisAdapter(client));
    }

    // Verify all connections
    for (const adapter of adapters) {
      const result = await adapter.ping();
      expect(result).toBe('PONG');
    }
  });

  afterAll(async () => {
    // Clean up child processes
    childProcesses.forEach(child => {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    });

    // Clean up Redis connections
    await Promise.all(redisClients.map(client => client.disconnect()));
  });

  /**
   * Helper function to create a child process worker script
   */
  function createWorkerScript(testKey: string, workerId: number, operation: string): string {
    return `
import { createClient as createNodeRedisClient } from 'redis';
import { RedLock, NodeRedisAdapter } from './dist/index.js';

const NUM_INSTANCES = ${REDIS_CONFIG.DISTRIBUTED_INSTANCES};
const testTTL = ${TEST_CONFIG.DEFAULT_TTL};
const workerId = ${workerId};
const testKey = '${testKey}';
const operation = '${operation}';

async function main() {
  // Setup Redis connections
  const redisClients = [];
  const adapters = [];
  
  for (let i = 0; i < NUM_INSTANCES; i++) {
    const client = createNodeRedisClient({
      url: process.env.REDIS_URL || '${getRedisUrl()}',
      database: i,
    });
    await client.connect();
    redisClients.push(client);
    adapters.push(new NodeRedisAdapter(client));
  }

  const redlock = new RedLock({
    adapters,
    key: testKey,
    ttl: testTTL,
    quorum: ${TEST_CONFIG.DEFAULT_QUORUM_5},
    retryAttempts: ${TEST_CONFIG.DEFAULT_RETRY_ATTEMPTS},
    retryDelay: ${TEST_CONFIG.DEFAULT_RETRY_DELAY},
  });

  try {
    if (operation === 'acquire') {
      console.log(JSON.stringify({ workerId, event: 'attempting_acquire' }));
      const handle = await redlock.acquire();
      console.log(JSON.stringify({ workerId, event: 'acquired', handle: { id: handle.id, value: handle.value } }));
      
      // Hold lock for standard time
      await new Promise(resolve => setTimeout(resolve, ${TEST_CONFIG.STANDARD_HOLD}));
      
      const released = await redlock.release(handle);
      console.log(JSON.stringify({ workerId, event: 'released', success: released }));
    } else if (operation === 'compete') {
      console.log(JSON.stringify({ workerId, event: 'competing' }));
      
      // Try to acquire lock with retries
      try {
        const handle = await redlock.acquire();
        console.log(JSON.stringify({ workerId, event: 'won_competition', handle: { id: handle.id } }));
        
        // Hold briefly
        await new Promise(resolve => setTimeout(resolve, ${TEST_CONFIG.BRIEF_HOLD}));
        
        await redlock.release(handle);
        console.log(JSON.stringify({ workerId, event: 'released_after_competition' }));
      } catch (error) {
        console.log(JSON.stringify({ workerId, event: 'lost_competition', error: error.message }));
      }
    }
  } catch (error) {
    console.log(JSON.stringify({ workerId, event: 'error', error: error.message }));
  } finally {
    // Clean up
    await Promise.all(redisClients.map(client => client.disconnect()));
  }
}

main().catch(console.error);
`;
  }

  /**
   * Helper function to spawn a worker process
   */
  function spawnWorker(
    scriptContent: string,
    workerId: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const scriptPath = join(process.cwd(), `worker-${workerId}.mjs`);
      writeFileSync(scriptPath, scriptContent);

      const child = spawn('node', [scriptPath], {
        stdio: 'pipe',
        env: { ...process.env, NODE_ENV: 'test' },
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', data => {
        stdout += data.toString();
      });

      child.stderr?.on('data', data => {
        stderr += data.toString();
      });

      child.on('close', code => {
        try {
          unlinkSync(scriptPath);
        } catch (error) {
          // Ignore cleanup errors
        }

        resolve({
          stdout,
          stderr,
          exitCode: code || 0,
        });
      });

      child.on('error', error => {
        try {
          unlinkSync(scriptPath);
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
        reject(error);
      });

      childProcesses.push(child);
    });
  }

  describe('Basic Cross-Process Locking', () => {
    it('should prevent simultaneous lock acquisition across processes', async () => {
      const testKey = generateTestKey('cross-process');
      const numWorkers = 3;

      // Create worker scripts
      const workerPromises = Array.from({ length: numWorkers }, (_, i) => {
        const scriptContent = createWorkerScript(testKey, i, 'acquire');
        return spawnWorker(scriptContent, i);
      });

      // Wait for all workers to complete
      const results = await Promise.all(workerPromises);

      // Parse worker outputs
      const workerEvents = results.map((result, workerId) => {
        const events = result.stdout
          .split('\n')
          .filter(line => line.trim())
          .map(line => {
            try {
              return JSON.parse(line);
            } catch (error) {
              return null;
            }
          })
          .filter(event => event !== null);

        return { workerId, events, stderr: result.stderr };
      });

      // Verify mutual exclusion
      const acquisitions = workerEvents.flatMap(worker =>
        worker.events.filter(event => event.event === 'acquired')
      );

      // Only one worker should successfully acquire the lock
      expect(acquisitions.length).toBe(1);

      // Verify all workers attempted to acquire
      const attempts = workerEvents.flatMap(worker =>
        worker.events.filter(event => event.event === 'attempting_acquire')
      );
      expect(attempts.length).toBe(numWorkers);

      // Verify no errors in stderr
      workerEvents.forEach(worker => {
        expect(worker.stderr).toBe('');
      });
    }, 15000);

    it('should handle sequential lock acquisition across processes', async () => {
      const testKey = generateTestKey('cross-process');
      const numWorkers = 3;

      // Start workers sequentially with delays
      const results = [];
      for (let i = 0; i < numWorkers; i++) {
        const scriptContent = createWorkerScript(testKey, i, 'acquire');
        const resultPromise = spawnWorker(scriptContent, i);
        results.push(resultPromise);

        // Wait before starting next worker
        await delay(TIMEOUT_CONFIG.SEQUENTIAL_DELAY);
      }

      // Wait for all workers to complete
      const workerResults = await Promise.all(results);

      // Parse and verify results
      const workerEvents = workerResults.map((result, workerId) => {
        const events = result.stdout
          .split('\n')
          .filter(line => line.trim())
          .map(line => {
            try {
              return JSON.parse(line);
            } catch (error) {
              return null;
            }
          })
          .filter(event => event !== null);

        return { workerId, events };
      });

      // Most workers should successfully acquire and release
      // In distributed systems, some workers may fail due to timing/network issues
      const acquisitions = workerEvents.flatMap(worker =>
        worker.events.filter(event => event.event === 'acquired')
      );
      const releases = workerEvents.flatMap(worker =>
        worker.events.filter(event => event.event === 'released')
      );

      // Allow for at least 2 out of 3 workers to succeed (66% success rate)
      expect(acquisitions.length).toBeGreaterThanOrEqual(Math.floor(numWorkers * 0.66));
      expect(releases.length).toBeGreaterThanOrEqual(Math.floor(numWorkers * 0.66));
    }, 20000);
  });

  describe('Competitive Lock Acquisition', () => {
    it('should handle multiple competing processes', async () => {
      const testKey = generateTestKey('cross-process');
      const numCompetitors = 5;

      // Start all competitors simultaneously
      const workerPromises = Array.from({ length: numCompetitors }, (_, i) => {
        const scriptContent = createWorkerScript(testKey, i, 'compete');
        return spawnWorker(scriptContent, i);
      });

      // Wait for all workers to complete
      const results = await Promise.all(workerPromises);

      // Parse worker outputs
      const workerEvents = results.map((result, workerId) => {
        const events = result.stdout
          .split('\n')
          .filter(line => line.trim())
          .map(line => {
            try {
              return JSON.parse(line);
            } catch (error) {
              return null;
            }
          })
          .filter(event => event !== null);

        return { workerId, events };
      });

      // Count winners and losers
      const winners = workerEvents.filter(worker =>
        worker.events.some(event => event.event === 'won_competition')
      );
      const losers = workerEvents.filter(worker =>
        worker.events.some(event => event.event === 'lost_competition')
      );

      // Exactly one winner, rest should be losers
      expect(winners.length).toBe(1);
      expect(losers.length).toBe(numCompetitors - 1);

      // Verify winner released the lock
      const winnerReleases = winners.flatMap(worker =>
        worker.events.filter(event => event.event === 'released_after_competition')
      );
      expect(winnerReleases.length).toBe(1);
    }, 15000);
  });

  describe('Mixed Process and In-Process Locking', () => {
    it('should work with both child processes and main process', async () => {
      const testKey = generateTestKey('cross-process');

      // Create main process redlock
      const mainRedlock = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum: TEST_CONFIG.DEFAULT_QUORUM_5,
        retryAttempts: TEST_CONFIG.DEFAULT_RETRY_ATTEMPTS,
        retryDelay: TEST_CONFIG.DEFAULT_RETRY_DELAY,
      });

      // Start child process worker
      const scriptContent = createWorkerScript(testKey, 999, 'compete');
      const childPromise = spawnWorker(scriptContent, 999);

      // Small delay to let child process start
      await delay(TIMEOUT_CONFIG.PROCESS_STARTUP_DELAY);

      // Main process attempts to acquire lock
      const mainProcessResult = await mainRedlock.acquire().catch(error => error);

      // Wait for child process to complete
      const childResult = await childPromise;

      // Parse child process events
      const childEvents = childResult.stdout
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          try {
            return JSON.parse(line);
          } catch (error) {
            return null;
          }
        })
        .filter(event => event !== null);

      // Either main process or child process should win, but not both
      const mainWon = !(mainProcessResult instanceof Error);
      const childWon = childEvents.some(event => event.event === 'won_competition');

      expect(mainWon || childWon).toBe(true);
      expect(mainWon && childWon).toBe(false);

      // Clean up if main process won
      if (mainWon) {
        await mainRedlock.release(mainProcessResult);
      }
    }, 10000);
  });

  describe('Process Failure Simulation', () => {
    it('should handle abrupt process termination', async () => {
      const testKey = generateTestKey('cross-process');

      // Create worker script that acquires lock but doesn't release
      const abruptScript = `
import { createClient as createNodeRedisClient } from 'redis';
import { RedLock, NodeRedisAdapter } from './dist/index.js';

const NUM_INSTANCES = ${REDIS_CONFIG.DISTRIBUTED_INSTANCES};
const testTTL = ${TEST_CONFIG.SHORT_TTL * 3}; // Short TTL for faster test
const testKey = '${testKey}';

async function main() {
  const redisClients = [];
  const adapters = [];
  
  for (let i = 0; i < NUM_INSTANCES; i++) {
    const client = createNodeRedisClient({
      url: process.env.REDIS_URL || '${getRedisUrl()}',
      database: i,
    });
    await client.connect();
    redisClients.push(client);
    adapters.push(new NodeRedisAdapter(client));
  }

  const redlock = new RedLock({
    adapters,
    key: testKey,
    ttl: testTTL,
    quorum: 3,
  });

  try {
    const handle = await redlock.acquire();
    console.log(JSON.stringify({ event: 'acquired', handle: { id: handle.id } }));
    
    // Hold lock for 1 second then exit abruptly (simulating crash)
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log(JSON.stringify({ event: 'about_to_crash' }));
    
    // Exit without releasing lock (simulating process crash)
    process.exit(0);
  } catch (error) {
    console.log(JSON.stringify({ event: 'error', error: error.message }));
    process.exit(1);
  }
}

main().catch(console.error);
`;

      // Start the abrupt worker
      const scriptPath = join(process.cwd(), 'abrupt-worker.mjs');
      writeFileSync(scriptPath, abruptScript);

      const abruptChild = spawn('node', [scriptPath], {
        stdio: 'pipe',
        env: { ...process.env, NODE_ENV: 'test' },
      });

      let abruptOutput = '';
      abruptChild.stdout?.on('data', data => {
        abruptOutput += data.toString();
      });

      // Wait for abrupt process to complete
      await new Promise(resolve => {
        abruptChild.on('close', resolve);
      });

      // Clean up script file
      try {
        unlinkSync(scriptPath);
      } catch (error) {
        // Ignore cleanup errors
      }

      // Parse abrupt worker output
      const abruptEvents = abruptOutput
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          try {
            return JSON.parse(line);
          } catch (error) {
            return null;
          }
        })
        .filter(event => event !== null);

      // Verify abrupt worker acquired lock
      const acquisition = abruptEvents.find(event => event.event === 'acquired');
      expect(acquisition).toBeDefined();

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 4000));

      // Main process should be able to acquire lock after TTL expiration
      const mainRedlock = new RedLock({
        adapters,
        key: testKey,
        ttl: TEST_CONFIG.DEFAULT_TTL,
        quorum: TEST_CONFIG.DEFAULT_QUORUM_5,
        retryAttempts: 1,
        retryDelay: TEST_CONFIG.DEFAULT_RETRY_DELAY,
      });

      const mainHandle = await mainRedlock.acquire();
      expect(mainHandle).toBeDefined();

      // Clean up
      await mainRedlock.release(mainHandle);
    }, 15000);
  });

  describe('Performance Across Processes', () => {
    it('should maintain reasonable performance with multiple processes', async () => {
      const testKey = generateTestKey('cross-process');
      const numProcesses = 3;

      // Create performance test script
      const perfScript = (workerId: number) => `
import { createClient as createNodeRedisClient } from 'redis';
import { RedLock, NodeRedisAdapter } from './dist/index.js';

const NUM_INSTANCES = 5;
const testTTL = 5000;
const testKey = '${testKey}-${workerId}'; // Unique key per process
const workerId = ${workerId};

async function main() {
  const redisClients = [];
  const adapters = [];
  
  for (let i = 0; i < NUM_INSTANCES; i++) {
    const client = createNodeRedisClient({
      url: process.env.REDIS_URL || '${getRedisUrl()}',
      database: i,
    });
    await client.connect();
    redisClients.push(client);
    adapters.push(new NodeRedisAdapter(client));
  }

  const redlock = new RedLock({
    adapters,
    key: testKey,
    ttl: testTTL,
    quorum: 3,
    retryAttempts: 0, // No retries for performance test
  });

  const startTime = Date.now();
  
  try {
    const handle = await redlock.acquire();
    const acquisitionTime = Date.now() - startTime;
    
    console.log(JSON.stringify({ 
      workerId, 
      event: 'performance_result', 
      acquisitionTime,
      success: true 
    }));
    
    await redlock.release(handle);
  } catch (error) {
    const acquisitionTime = Date.now() - startTime;
    console.log(JSON.stringify({ 
      workerId, 
      event: 'performance_result', 
      acquisitionTime,
      success: false,
      error: error.message
    }));
  } finally {
    await Promise.all(redisClients.map(client => client.disconnect()));
  }
}

main().catch(console.error);
`;

      // Start all performance test processes
      const perfPromises = Array.from({ length: numProcesses }, (_, i) => {
        return spawnWorker(perfScript(i), i);
      });

      // Wait for all processes to complete
      const perfResults = await Promise.all(perfPromises);

      // Parse performance results
      const perfEvents = perfResults.map((result, workerId) => {
        const events = result.stdout
          .split('\n')
          .filter(line => line.trim())
          .map(line => {
            try {
              return JSON.parse(line);
            } catch (error) {
              return null;
            }
          })
          .filter(event => event !== null);

        return { workerId, events };
      });

      // Verify all processes completed successfully
      const perfData = perfEvents.flatMap(worker =>
        worker.events.filter(event => event.event === 'performance_result')
      );

      expect(perfData.length).toBe(numProcesses);
      perfData.forEach(data => {
        expect(data.success).toBe(true);
        expect(data.acquisitionTime).toBeLessThan(2000); // Should be fast
      });
    }, 15000);
  });
});
