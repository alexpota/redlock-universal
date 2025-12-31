export const TEST_CONFIG = {
  /** Ultra short TTL for rapid expiration tests in milliseconds */
  ULTRA_SHORT_TTL: 50,

  /** Very short TTL for quick expiration tests in milliseconds */
  VERY_SHORT_TTL: 1000,

  /** Short TTL for extension tests in milliseconds */
  SHORT_TTL: 1500,

  /** Medium TTL for standard tests in milliseconds */
  MEDIUM_TTL: 3000,

  /** Extended TTL for long-running tests in milliseconds */
  EXTENDED_TTL: 4000,

  /** Default TTL for test locks in milliseconds */
  DEFAULT_TTL: 5000,

  /** Long TTL for extended tests in milliseconds */
  LONG_TTL: 10000,

  /** Default retry attempts for tests */
  DEFAULT_RETRY_ATTEMPTS: 2,

  /** Single retry attempt for quick failure tests */
  SINGLE_RETRY_ATTEMPT: 1,

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

  /** Number of instances for using() API distributed tests */
  USING_API_INSTANCES: 3,

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

  /** Unit test default retry attempts (SimpleLock specific) */
  UNIT_DEFAULT_RETRY_ATTEMPTS: 3,

  /** Invalid TTL for negative validation tests */
  INVALID_TTL: -1000,

  /** Zero TTL for validation tests */
  ZERO_TTL: 0,

  /** Invalid retry attempts for validation tests */
  INVALID_RETRY_ATTEMPTS: -1,

  /** Extended TTL for extension tests in milliseconds */
  UNIT_EXTENDED_TTL: 10000,

  /** Clock drift test TTL - shorter than latency + drift */
  CLOCK_DRIFT_TTL: 5500,
} as const;

export const TIMING_CONFIG = {
  /** Very small delay for quick operations */
  DELAY_TINY: 100,

  /** Small delay for brief pauses */
  DELAY_SMALL: 200,

  /** Medium delay for standard operations */
  DELAY_MEDIUM: 300,

  /** Medium-large delay for processing */
  DELAY_MEDIUM_LARGE: 500,

  /** Large delay for substantial operations */
  DELAY_LARGE: 800,

  /** Standard routine delay */
  DELAY_ROUTINE: 1000,

  /** Long delay for extended operations */
  DELAY_LONG: 1500,

  /** Extended delay for very long operations */
  DELAY_EXTENDED: 2000,

  /** Extension trigger point (80% of SHORT_TTL=1500ms) */
  DELAY_EXTENSION_TRIGGER: 1200,

  /** Extension trigger for using() tests (80% of VERY_SHORT_TTL=2000ms, kept for compatibility) */
  DELAY_EXTENSION_TRIGGER_COMPAT: 1800,

  /** Total expected time for extension tests */
  DELAY_TOTAL_EXTENDED_TIME: 2500,

  /** Rapid completion threshold */
  DELAY_RAPID_MAX: 500,

  /** Extension threshold for MEDIUM_TTL=3000ms (80%) */
  DELAY_EXTENSION_THRESHOLD: 2400,

  /** Offset before extension threshold */
  DELAY_EXTENSION_THRESHOLD_OFFSET: 200,

  /** Buffer after extension threshold */
  DELAY_EXTENSION_THRESHOLD_BUFFER: 400,

  /** File processing interval */
  INTERVAL_FILE_PROCESS: 300,

  /** Minimum interval between extensions */
  INTERVAL_MIN_EXTENSION: 800,

  /** Maximum interval between extensions */
  INTERVAL_MAX_EXTENSION: 2000,

  /** Check interval for timing tests */
  INTERVAL_TIMING_CHECK: 800,

  /** Process interval for cache operations */
  INTERVAL_CACHE_PROCESS: 600,

  /** Leader duties interval */
  INTERVAL_LEADER_DUTIES: 700,

  /** Unit test retry timeout buffer */
  UNIT_RETRY_TIMEOUT_BUFFER: 75,

  /** Unit test quick operation delay */
  UNIT_QUICK_DELAY: 10,
} as const;

export const TEST_EXPECTATIONS = {
  /** Minimum number of extensions expected */
  MIN_EXTENSIONS: 2,

  /** Minimum extensions for multi-extension tests */
  MIN_MULTI_EXTENSIONS: 3,

  /** Maximum timing for extension operations */
  EXTENSION_TIMING_MAX: 500,

  /** Total number of files for file processing tests */
  TOTAL_FILES: 10,

  /** Iterations for multi-iteration tests */
  MULTI_ITERATIONS: 4,

  /** Check count for timing coordination */
  TIMING_CHECK_COUNT: 4,

  /** Minimum interval between extension timing checks */
  MIN_INTERVAL: 800,

  /** Maximum interval between extension timing checks */
  MAX_INTERVAL: 2000,
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

export const VALKEY_CONFIG = {
  /** Default Valkey host */
  DEFAULT_HOST: 'localhost',

  /** Default Valkey port */
  DEFAULT_PORT: 6390,
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

  /** Disconnection test timeout */
  DISCONNECT_TEST: 10000,
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

export const TEST_MESSAGES = {
  RESULTS: {
    SUCCESS: 'success',
    DISTRIBUTED_SUCCESS: 'distributed-success',
    FIRST_LOCK: 'first-distributed',
    SECOND_LOCK: 'second-distributed',
    FAILED_LOCK: 'failed-distributed',
    EXTENDED: 'distributed-extended',
    EXTENDED_SUCCESS: 'extended-success',
    SHOULD_ABORT: 'should-abort',
    SHOULD_NOT_COMPLETE: 'should-not-complete',
    PARTIAL_SUCCESS: 'partial-extension-success',
    PARTITION_HANDLED: 'partition-handled',
    MAJORITY_LOSS: 'majority-loss-test',
    TIMING_TEST: 'timing-test',
    TIMING_COORDINATION: 'timing-coordination-test',
    MULTI_EXTENSION: 'multi-distributed-extension',
    MULTI_EXTENDED: 'multi-extended',
    RAPID_COMPLETION: 'rapid-completion',
    HANDLE_DISCONNECT: 'should-handle-disconnect',
    EXTERNAL_DELETION: 'external-deletion-test',
    TRANSACTION_COMPLETE: 'transaction-complete',
    CACHE_WARMED: 'Cache warmed successfully',
    LEADERSHIP_COMPLETE: 'Leadership duties completed',
    RECOVERY_TEST: 'recovery-test',
    JOB_PROCESSING: 'Processed 5 items with distributed coordination',
    FILES_PROCESSED: 'Processed 10 files',
  },
  ERRORS: {
    ROUTINE_FAILED: 'Routine failed',
    QUORUM_FRAGMENT: 'quorum',
    EXTEND_FAILURE: 'Failed to extend lock',
    PROCESSING_CANCELLED: 'Processing cancelled at file',
  },
} as const;

export const TEST_DATA = {
  JOB_ITEMS: ['item1', 'item2', 'item3', 'item4', 'item5'] as const,
  CACHE_ENTRIES: [
    { key: 'user:1', value: 'userData1' },
    { key: 'user:2', value: 'userData2' },
    { key: 'config:app', value: 'appConfig' },
  ] as const,
  LEADER_DUTIES: ['heartbeat', 'cleanup', 'metrics', 'coordination'] as const,
  TRANSACTION_STEPS: ['begin', 'read', 'process', 'write', 'commit'] as const,
} as const;

export const ATOMIC_EXTENSION_RESULT_CODES = {
  SUCCESS: 1,
  TOO_LATE: 0,
  VALUE_MISMATCH: -1,
} as const;

export const TTL_VALUES = {
  KEY_NOT_EXISTS: -2,
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

/**
 * Get environment Valkey URL or default
 */
export function getValkeyUrl(): string {
  const host = process.env.VALKEY_1_HOST || VALKEY_CONFIG.DEFAULT_HOST;
  const port = process.env.VALKEY_1_PORT || VALKEY_CONFIG.DEFAULT_PORT;
  return `redis://${host}:${port}`;
}

/**
 * Get Valkey host from environment or default
 */
export function getValkeyHost(): string {
  return process.env.VALKEY_1_HOST || VALKEY_CONFIG.DEFAULT_HOST;
}

/**
 * Get Valkey port from environment or default
 */
export function getValkeyPort(): number {
  return parseInt(process.env.VALKEY_1_PORT || String(VALKEY_CONFIG.DEFAULT_PORT), 10);
}
