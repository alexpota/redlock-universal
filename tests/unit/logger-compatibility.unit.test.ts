import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createLock,
  createRedlock,
  createPinoAdapter,
  createBunyanAdapter,
  type ILogger,
} from '../../src/index.js';
import type { RedisAdapter } from '../../src/types/adapters.js';

describe('Logger Compatibility', () => {
  let mockAdapter: RedisAdapter;

  beforeEach(() => {
    mockAdapter = {
      setNX: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      get: vi.fn(),
      delIfMatch: vi.fn(),
      extendIfMatch: vi.fn(),
      atomicExtend: vi.fn(),
      ping: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
      disconnect: vi.fn(),
    };
  });

  describe('ILogger Interface', () => {
    it('should accept message-first logger (Winston-style)', () => {
      const mockLogger: ILogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const lock = createLock({
        adapter: mockAdapter,
        key: 'test-key',
        logger: mockLogger,
      });

      expect(lock).toBeDefined();
    });

    it('should accept console as logger', () => {
      const mockConsole: ILogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const lock = createLock({
        adapter: mockAdapter,
        key: 'test-key',
        logger: mockConsole,
      });

      expect(lock).toBeDefined();
    });

    it('should work with RedLock and external logger', () => {
      const mockLogger: ILogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const lock = createRedlock({
        adapters: [mockAdapter, mockAdapter, mockAdapter],
        key: 'distributed-key',
        logger: mockLogger,
      });

      expect(lock).toBeDefined();
    });
  });

  describe('Winston Compatibility', () => {
    it('should work with Winston-style logger', () => {
      const winstonMock = {
        debug: vi.fn((_message: string, _meta?: Record<string, unknown>) => {}),
        info: vi.fn((_message: string, _meta?: Record<string, unknown>) => {}),
        warn: vi.fn((_message: string, _meta?: Record<string, unknown>) => {}),
        error: vi.fn((_message: string, _error?: Error, _meta?: Record<string, unknown>) => {}),
      };

      const lock = createLock({
        adapter: mockAdapter,
        key: 'winston-test',
        logger: winstonMock,
      });

      expect(lock).toBeDefined();
      expect(winstonMock.debug).not.toHaveBeenCalled();
    });

    it('should pass logger to SimpleLock config', () => {
      const winstonMock: ILogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const lock = createLock({
        adapter: mockAdapter,
        key: 'winston-config-test',
        logger: winstonMock,
      });

      const config = (lock as any).getConfig();
      expect(config.logger).toBe(winstonMock);
    });
  });

  describe('Pino Adapter', () => {
    it('should create adapter for Pino logger', () => {
      const pinoMock = {
        debug: vi.fn((_obj: object, _msg?: string) => {}),
        info: vi.fn((_obj: object, _msg?: string) => {}),
        warn: vi.fn((_obj: object, _msg?: string) => {}),
        error: vi.fn((_obj: object, _msg?: string) => {}),
      };

      const adapter = createPinoAdapter(pinoMock);

      expect(adapter).toHaveProperty('debug');
      expect(adapter).toHaveProperty('info');
      expect(adapter).toHaveProperty('warn');
      expect(adapter).toHaveProperty('error');
    });

    it('should convert message-first to object-first for Pino debug', () => {
      const pinoMock = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const adapter = createPinoAdapter(pinoMock);
      adapter.debug('test message', { key: 'value' });

      expect(pinoMock.debug).toHaveBeenCalledWith({ key: 'value' }, 'test message');
    });

    it('should convert message-first to object-first for Pino info', () => {
      const pinoMock = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const adapter = createPinoAdapter(pinoMock);
      adapter.info('info message');

      expect(pinoMock.info).toHaveBeenCalledWith({}, 'info message');
    });

    it('should convert message-first to object-first for Pino warn', () => {
      const pinoMock = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const adapter = createPinoAdapter(pinoMock);
      adapter.warn('warning message', { code: 'WARN_01' });

      expect(pinoMock.warn).toHaveBeenCalledWith({ code: 'WARN_01' }, 'warning message');
    });

    it('should merge error into context for Pino error', () => {
      const pinoMock = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const testError = new Error('Test error');
      const adapter = createPinoAdapter(pinoMock);
      adapter.error('error message', testError, { code: 'ERR_01' });

      expect(pinoMock.error).toHaveBeenCalledWith(
        { code: 'ERR_01', err: testError },
        'error message'
      );
    });

    it('should work with Pino adapter in createLock', () => {
      const pinoMock = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const logger = createPinoAdapter(pinoMock);
      const lock = createLock({
        adapter: mockAdapter,
        key: 'pino-test',
        logger,
      });

      expect(lock).toBeDefined();
    });

    it('should work with Pino adapter in createRedlock', () => {
      const pinoMock = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const logger = createPinoAdapter(pinoMock);
      const lock = createRedlock({
        adapters: [mockAdapter, mockAdapter, mockAdapter],
        key: 'pino-redlock-test',
        logger,
      });

      expect(lock).toBeDefined();
    });
  });

  describe('Bunyan Adapter', () => {
    it('should create adapter for Bunyan logger', () => {
      const bunyanMock = {
        debug: vi.fn((_fields: object | string, _msg?: string) => {}),
        info: vi.fn((_fields: object | string, _msg?: string) => {}),
        warn: vi.fn((_fields: object | string, _msg?: string) => {}),
        error: vi.fn((_fields: object | string, _msg?: string) => {}),
      };

      const adapter = createBunyanAdapter(bunyanMock);

      expect(adapter).toHaveProperty('debug');
      expect(adapter).toHaveProperty('info');
      expect(adapter).toHaveProperty('warn');
      expect(adapter).toHaveProperty('error');
    });

    it('should convert message-first to fields-first for Bunyan info', () => {
      const bunyanMock = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const adapter = createBunyanAdapter(bunyanMock);
      adapter.info('info message', { userId: 123 });

      expect(bunyanMock.info).toHaveBeenCalledWith({ userId: 123 }, 'info message');
    });

    it('should handle info without context', () => {
      const bunyanMock = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const adapter = createBunyanAdapter(bunyanMock);
      adapter.info('info message');

      expect(bunyanMock.info).toHaveBeenCalledWith('info message');
    });

    it('should convert message-first to fields-first for Bunyan warn', () => {
      const bunyanMock = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const adapter = createBunyanAdapter(bunyanMock);
      adapter.warn('warn message', { retries: 3 });

      expect(bunyanMock.warn).toHaveBeenCalledWith({ retries: 3 }, 'warn message');
    });

    it('should handle error with both error and context', () => {
      const bunyanMock = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const testError = new Error('Test error');
      const adapter = createBunyanAdapter(bunyanMock);
      adapter.error('error message', testError, { code: 'ERR_01' });

      expect(bunyanMock.error).toHaveBeenCalledWith(
        { code: 'ERR_01', err: testError },
        'error message'
      );
    });

    it('should handle error with only error (no context)', () => {
      const bunyanMock = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const testError = new Error('Test error');
      const adapter = createBunyanAdapter(bunyanMock);
      adapter.error('error message', testError);

      expect(bunyanMock.error).toHaveBeenCalledWith({ err: testError }, 'error message');
    });

    it('should handle error without error or context', () => {
      const bunyanMock = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const adapter = createBunyanAdapter(bunyanMock);
      adapter.error('error message');

      expect(bunyanMock.error).toHaveBeenCalledWith('error message');
    });

    it('should work with Bunyan adapter in createLock', () => {
      const bunyanMock = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const logger = createBunyanAdapter(bunyanMock);
      const lock = createLock({
        adapter: mockAdapter,
        key: 'bunyan-test',
        logger,
      });

      expect(lock).toBeDefined();
    });

    it('should work with Bunyan adapter in createRedlock', () => {
      const bunyanMock = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const logger = createBunyanAdapter(bunyanMock);
      const lock = createRedlock({
        adapters: [mockAdapter, mockAdapter, mockAdapter],
        key: 'bunyan-redlock-test',
        logger,
      });

      expect(lock).toBeDefined();
    });
  });

  describe('Built-in Logger Compatibility', () => {
    it('should continue to work with built-in Logger class', async () => {
      const { Logger } = await import('../../src/monitoring/Logger.js');
      const builtInLogger = new Logger({ enableConsole: false });

      const lock = createLock({
        adapter: mockAdapter,
        key: 'builtin-logger-test',
        logger: builtInLogger,
      });

      expect(lock).toBeDefined();
    });

    it('should accept built-in Logger in RedLock', async () => {
      const { Logger } = await import('../../src/monitoring/Logger.js');
      const builtInLogger = new Logger({ enableConsole: false });

      const lock = createRedlock({
        adapters: [mockAdapter, mockAdapter, mockAdapter],
        key: 'builtin-redlock-test',
        logger: builtInLogger,
      });

      expect(lock).toBeDefined();
    });
  });
});
