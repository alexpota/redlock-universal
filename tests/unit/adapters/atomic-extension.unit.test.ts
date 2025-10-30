import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NodeRedisAdapter, IoredisAdapter } from '../../../src/index.js';
import { TEST_CONFIG, TIMING_CONFIG } from '../../shared/constants.js';
const TEST_VALUES = {
  KEY: 'test-key',
  VALUE: 'test-value',
  WRONG_VALUE: 'wrong-value',
  NONEXISTENT_KEY: 'nonexistent-key',
  CRITICAL_KEY: 'critical-key',
  PERF_TEST_KEY: 'perf-test',
  PERF_TEST_VALUE: 'value',
} as const;

const ATOMIC_EXTENSION_CONFIG = {
  STANDARD_TTL: 30000,
  SUCCESSFUL_REMAINING: 15000,
  IOREDIS_REMAINING: 18000,
  STOLEN_LOCK_TTL: 20000,
  EXTENSION_THRESHOLD: 0.2,
  NETWORK_LATENCY_MAX: 200,
  WORST_CASE_DELAY: 270,
  PERFORMANCE_ITERATIONS: 100,
} as const;

const RESULT_CODES = {
  SUCCESS: 1,
  TOO_LATE: 0,
  VALUE_MISMATCH: -1,
  KEY_NOT_EXISTS: -2,
} as const;

// Mock Redis clients
const createMockNodeRedisClient = () => ({
  eval: vi.fn(),
  evalSha: vi.fn(),
  scriptLoad: vi.fn(),
  isReady: true,
});

const createMockIoredisClient = () => ({
  eval: vi.fn(),
  evalsha: vi.fn(),
  script: vi.fn(),
  status: 'ready' as const,
});

describe('Atomic Extension Tests', () => {
  describe('NodeRedisAdapter', () => {
    let adapter: NodeRedisAdapter;
    let mockClient: ReturnType<typeof createMockNodeRedisClient>;

    beforeEach(() => {
      mockClient = createMockNodeRedisClient();
      adapter = new NodeRedisAdapter(mockClient as any);
    });

    it('should handle successful atomic extension', async () => {
      mockClient.scriptLoad.mockResolvedValueOnce('sha1234');
      mockClient.evalSha.mockResolvedValueOnce([
        RESULT_CODES.SUCCESS,
        ATOMIC_EXTENSION_CONFIG.SUCCESSFUL_REMAINING,
      ]);

      const result = await adapter.atomicExtend(
        TEST_VALUES.KEY,
        TEST_VALUES.VALUE,
        TEST_CONFIG.TTL_BUFFER,
        ATOMIC_EXTENSION_CONFIG.STANDARD_TTL
      );

      expect(result).toEqual({
        resultCode: RESULT_CODES.SUCCESS,
        actualTTL: ATOMIC_EXTENSION_CONFIG.SUCCESSFUL_REMAINING,
        message: `Extension successful (${ATOMIC_EXTENSION_CONFIG.SUCCESSFUL_REMAINING}ms remaining before extension)`,
      });

      expect(mockClient.scriptLoad).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("PTTL"')
      );
      expect(mockClient.evalSha).toHaveBeenCalledWith('sha1234', {
        keys: [TEST_VALUES.KEY],
        arguments: [
          TEST_VALUES.VALUE,
          TEST_CONFIG.TTL_BUFFER.toString(),
          ATOMIC_EXTENSION_CONFIG.STANDARD_TTL.toString(),
        ],
      });
    });

    it('should handle race condition (too late to extend)', async () => {
      mockClient.scriptLoad.mockResolvedValueOnce('sha1234');
      mockClient.evalSha.mockResolvedValueOnce([RESULT_CODES.TOO_LATE, TIMING_CONFIG.DELAY_TINY]);

      const result = await adapter.atomicExtend(
        TEST_VALUES.KEY,
        TEST_VALUES.VALUE,
        TEST_CONFIG.TTL_BUFFER,
        ATOMIC_EXTENSION_CONFIG.STANDARD_TTL
      );

      expect(result).toEqual({
        resultCode: RESULT_CODES.TOO_LATE,
        actualTTL: TIMING_CONFIG.DELAY_TINY,
        message: `Extension too late (only ${TIMING_CONFIG.DELAY_TINY}ms left, needed ${TEST_CONFIG.TTL_BUFFER}ms minimum)`,
      });
    });

    it('should handle lock value mismatch', async () => {
      mockClient.scriptLoad.mockResolvedValueOnce('sha1234');
      mockClient.evalSha.mockResolvedValueOnce([
        RESULT_CODES.VALUE_MISMATCH,
        ATOMIC_EXTENSION_CONFIG.STOLEN_LOCK_TTL,
      ]);

      const result = await adapter.atomicExtend(
        TEST_VALUES.KEY,
        TEST_VALUES.WRONG_VALUE,
        TEST_CONFIG.TTL_BUFFER,
        ATOMIC_EXTENSION_CONFIG.STANDARD_TTL
      );

      expect(result).toEqual({
        resultCode: RESULT_CODES.VALUE_MISMATCH,
        actualTTL: ATOMIC_EXTENSION_CONFIG.STOLEN_LOCK_TTL,
        message: `Lock value changed - lock stolen (${ATOMIC_EXTENSION_CONFIG.STOLEN_LOCK_TTL}ms remaining)`,
      });
    });

    it('should handle key not exists', async () => {
      mockClient.scriptLoad.mockResolvedValueOnce('sha1234');
      mockClient.evalSha.mockResolvedValueOnce([
        RESULT_CODES.VALUE_MISMATCH,
        RESULT_CODES.KEY_NOT_EXISTS,
      ]);

      const result = await adapter.atomicExtend(
        TEST_VALUES.NONEXISTENT_KEY,
        TEST_VALUES.VALUE,
        TEST_CONFIG.TTL_BUFFER,
        ATOMIC_EXTENSION_CONFIG.STANDARD_TTL
      );

      expect(result).toEqual({
        resultCode: RESULT_CODES.VALUE_MISMATCH,
        actualTTL: RESULT_CODES.KEY_NOT_EXISTS,
        message: `Lock key "${TEST_VALUES.NONEXISTENT_KEY}" no longer exists`,
      });
    });

    it('should validate parameters', async () => {
      await expect(
        adapter.atomicExtend(
          '',
          TEST_VALUES.VALUE,
          TEST_CONFIG.TTL_BUFFER,
          ATOMIC_EXTENSION_CONFIG.STANDARD_TTL
        )
      ).rejects.toThrow('Lock key must be a non-empty string');

      await expect(
        adapter.atomicExtend(
          TEST_VALUES.KEY,
          '',
          TEST_CONFIG.TTL_BUFFER,
          ATOMIC_EXTENSION_CONFIG.STANDARD_TTL
        )
      ).rejects.toThrow('Lock value must be a non-empty string');

      await expect(
        adapter.atomicExtend(
          TEST_VALUES.KEY,
          TEST_VALUES.VALUE,
          -TIMING_CONFIG.DELAY_TINY,
          ATOMIC_EXTENSION_CONFIG.STANDARD_TTL
        )
      ).rejects.toThrow('Minimum TTL must be a positive integer');

      await expect(
        adapter.atomicExtend(
          TEST_VALUES.KEY,
          TEST_VALUES.VALUE,
          TEST_CONFIG.TTL_BUFFER,
          TEST_CONFIG.INVALID_TTL
        )
      ).rejects.toThrow('TTL must be a positive integer');
    });

    it('should handle Redis errors', async () => {
      mockClient.scriptLoad.mockRejectedValueOnce(new Error('Redis connection failed'));

      await expect(
        adapter.atomicExtend(
          TEST_VALUES.KEY,
          TEST_VALUES.VALUE,
          TEST_CONFIG.TTL_BUFFER,
          ATOMIC_EXTENSION_CONFIG.STANDARD_TTL
        )
      ).rejects.toThrow('Failed to load script ATOMIC_EXTEND');
    });
  });

  describe('IoredisAdapter', () => {
    let adapter: IoredisAdapter;
    let mockClient: ReturnType<typeof createMockIoredisClient>;

    beforeEach(() => {
      mockClient = createMockIoredisClient();
      adapter = new IoredisAdapter(mockClient as any);
    });

    it('should handle successful atomic extension', async () => {
      mockClient.script.mockResolvedValueOnce('sha5678');
      mockClient.evalsha.mockResolvedValueOnce([
        RESULT_CODES.SUCCESS,
        ATOMIC_EXTENSION_CONFIG.IOREDIS_REMAINING,
      ]);

      const result = await adapter.atomicExtend(
        TEST_VALUES.KEY,
        TEST_VALUES.VALUE,
        TEST_CONFIG.TTL_BUFFER,
        ATOMIC_EXTENSION_CONFIG.STANDARD_TTL
      );

      expect(result).toEqual({
        resultCode: RESULT_CODES.SUCCESS,
        actualTTL: ATOMIC_EXTENSION_CONFIG.IOREDIS_REMAINING,
        message: `Extension successful (${ATOMIC_EXTENSION_CONFIG.IOREDIS_REMAINING}ms remaining before extension)`,
      });

      expect(mockClient.script).toHaveBeenCalledWith(
        'LOAD',
        expect.stringContaining('redis.call("PTTL"')
      );
      expect(mockClient.evalsha).toHaveBeenCalledWith(
        'sha5678',
        1,
        TEST_VALUES.KEY,
        TEST_VALUES.VALUE,
        TEST_CONFIG.TTL_BUFFER.toString(),
        ATOMIC_EXTENSION_CONFIG.STANDARD_TTL.toString()
      );
    });

    it('should handle race condition scenarios', async () => {
      mockClient.script.mockResolvedValueOnce('sha5678');
      mockClient.evalsha.mockResolvedValueOnce([
        RESULT_CODES.TOO_LATE,
        TEST_CONFIG.FAST_RETRY_DELAY,
      ]);

      const result = await adapter.atomicExtend(
        TEST_VALUES.CRITICAL_KEY,
        TEST_VALUES.VALUE,
        TEST_CONFIG.TTL_BUFFER,
        ATOMIC_EXTENSION_CONFIG.STANDARD_TTL
      );

      expect(result.resultCode).toBe(RESULT_CODES.TOO_LATE);
      expect(result.actualTTL).toBe(TEST_CONFIG.FAST_RETRY_DELAY);
      expect(result.message).toContain('Extension too late');
    });
  });

  describe('Race Condition Protection Analysis', () => {
    it('should demonstrate race condition window calculation', () => {
      const ttl = ATOMIC_EXTENSION_CONFIG.STANDARD_TTL;
      const extensionThreshold = ATOMIC_EXTENSION_CONFIG.EXTENSION_THRESHOLD;
      const safetyBuffer = TEST_CONFIG.TTL_BUFFER;

      const thresholdTime = ttl * extensionThreshold;
      const actualTriggerTime = thresholdTime;

      const typicalDelay = TIMING_CONFIG.DELAY_TINY;
      const worstCaseDelay = ATOMIC_EXTENSION_CONFIG.WORST_CASE_DELAY;

      expect(actualTriggerTime).toBeGreaterThan(worstCaseDelay);
      expect(safetyBuffer).toBeGreaterThan(worstCaseDelay);

      const edgeCase = TEST_CONFIG.FAST_RETRY_DELAY;
      expect(edgeCase).toBeLessThan(typicalDelay);
    });
  });

  describe('Atomic Extension Performance Impact', () => {
    it('should have minimal performance overhead', async () => {
      const mockClient = createMockNodeRedisClient();
      const adapter = new NodeRedisAdapter(mockClient as any);

      mockClient.scriptLoad.mockResolvedValue('sha1234');
      mockClient.evalSha.mockResolvedValue([
        RESULT_CODES.SUCCESS,
        ATOMIC_EXTENSION_CONFIG.SUCCESSFUL_REMAINING,
      ]);

      const start = performance.now();

      const firstResult = await adapter.atomicExtend(
        TEST_VALUES.PERF_TEST_KEY,
        TEST_VALUES.PERF_TEST_VALUE,
        TEST_CONFIG.TTL_BUFFER,
        ATOMIC_EXTENSION_CONFIG.STANDARD_TTL
      );
      expect(firstResult.resultCode).toBe(RESULT_CODES.SUCCESS);

      const promises = Array.from(
        { length: ATOMIC_EXTENSION_CONFIG.PERFORMANCE_ITERATIONS - 1 },
        () =>
          adapter.atomicExtend(
            TEST_VALUES.PERF_TEST_KEY,
            TEST_VALUES.PERF_TEST_VALUE,
            TEST_CONFIG.TTL_BUFFER,
            ATOMIC_EXTENSION_CONFIG.STANDARD_TTL
          )
      );

      const results = await Promise.all(promises);
      const end = performance.now();

      expect(results.every(r => r.resultCode === RESULT_CODES.SUCCESS)).toBe(true);

      const avgTime = (end - start) / ATOMIC_EXTENSION_CONFIG.PERFORMANCE_ITERATIONS;
      expect(avgTime).toBeLessThan(TIMING_CONFIG.UNIT_QUICK_DELAY);

      expect(mockClient.scriptLoad).toHaveBeenCalledTimes(1);
      expect(mockClient.evalSha).toHaveBeenCalledTimes(
        ATOMIC_EXTENSION_CONFIG.PERFORMANCE_ITERATIONS
      );
    });
  });
});
