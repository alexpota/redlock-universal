export const TEST_CONFIG = {
  /** Default TTL for test locks in milliseconds */
  DEFAULT_TTL: 5000,

  /** Short TTL for expiration tests in milliseconds */
  SHORT_TTL: 1000,

  /** Long TTL for extended tests in milliseconds */
  LONG_TTL: 10000,

  /** Default retry attempts for tests */
  DEFAULT_RETRY_ATTEMPTS: 2,

  /** Default retry delay for tests in milliseconds */
  DEFAULT_RETRY_DELAY: 100,

  /** Fast retry delay for quick tests in milliseconds */
  FAST_RETRY_DELAY: 50,

  /** Default clock drift factor for tests */
  DEFAULT_CLOCK_DRIFT: 0.01,

  /** High clock drift factor for drift tests */
  HIGH_CLOCK_DRIFT: 0.1,

  /** Default quorum for 5-node tests */
  DEFAULT_QUORUM_5: 3,

  /** Default quorum for 3-node tests */
  DEFAULT_QUORUM_3: 2,

  /** Performance test timeout in milliseconds */
  PERFORMANCE_TIMEOUT: 500,

  /** TTL expiration buffer in milliseconds */
  TTL_BUFFER: 500,

  /** Brief hold time for tests in milliseconds */
  BRIEF_HOLD: 500,

  /** Standard hold time for tests in milliseconds */
  STANDARD_HOLD: 2000,

  /** TTL extension amount in milliseconds */
  TTL_EXTENSION: 3000,
} as const;

export const REDIS_CONFIG = {
  /** Default Redis host */
  DEFAULT_HOST: 'localhost',

  /** Default Redis port */
  DEFAULT_PORT: 6379,

  /** Default Redis URL */
  DEFAULT_URL: 'redis://localhost:6379',

  /** Number of Redis instances for distributed tests */
  DISTRIBUTED_INSTANCES: 5,

  /** Number of node-redis instances for mixed tests */
  NODE_REDIS_INSTANCES: 3,

  /** Number of ioredis instances for mixed tests */
  IOREDIS_INSTANCES: 3,

  /** Starting database index for ioredis instances */
  IOREDIS_START_DB: 5,
} as const;

export const TEST_PATTERNS = {
  /** Number of concurrent test attempts */
  CONCURRENT_ATTEMPTS: 5,

  /** Number of competitive workers */
  COMPETITIVE_WORKERS: 3,

  /** Number of processes for cross-process tests */
  CROSS_PROCESS_WORKERS: 3,

  /** Number of partition test iterations */
  PARTITION_ITERATIONS: 3,

  /** Minority failure count for 5-node setup */
  MINORITY_FAILURES: 2,

  /** Majority failure count for 5-node setup */
  MAJORITY_FAILURES: 3,
} as const;

export const TIMEOUT_CONFIG = {
  /** Default test timeout in milliseconds */
  DEFAULT_TIMEOUT: 10000,

  /** Long test timeout in milliseconds */
  LONG_TIMEOUT: 15000,

  /** Very long test timeout in milliseconds */
  VERY_LONG_TIMEOUT: 20000,

  /** Performance test timeout in milliseconds */
  PERFORMANCE_TIMEOUT: 5000,

  /** Process startup delay in milliseconds */
  PROCESS_STARTUP_DELAY: 100,

  /** Sequential test delay in milliseconds */
  SEQUENTIAL_DELAY: 1000,
} as const;

export const TEST_TIMEOUTS = {
  /** Cross-process test timeout */
  CROSS_PROCESS: 15000,

  /** Network partition test timeout */
  NETWORK_PARTITION: 10000,

  /** Performance test timeout */
  PERFORMANCE: 5000,

  /** Multi-instance test timeout */
  MULTI_INSTANCE: 10000,
} as const;

export const TEST_STRINGS = {
  /** Test key prefix for simple locks */
  SIMPLE_LOCK_KEY: 'test-simple-lock',

  /** Test key prefix for redlock */
  REDLOCK_KEY: 'test:redlock:key',

  /** Benchmark key prefix */
  BENCHMARK_KEY: 'benchmark',

  /** Adapter test key prefix */
  ADAPTER_TEST_KEY: 'test-key',

  /** Test value for mocking */
  SOME_VALUE: 'some-value',

  /** Test value string */
  TEST_VALUE: 'test-value',

  /** Wrong value for negative tests */
  WRONG_VALUE: 'wrong-value',

  /** Test ID string */
  TEST_ID: 'test-id',
} as const;

/**
 * Generate unique test key with timestamp and process ID
 */
export function generateTestKey(prefix: string = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}-${process.pid}`;
}

/**
 * Create delay promise
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get environment Redis URL or default
 */
export function getRedisUrl(): string {
  return process.env.REDIS_URL || REDIS_CONFIG.DEFAULT_URL;
}
