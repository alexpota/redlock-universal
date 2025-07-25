import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Logger, LogLevel } from '../../../src/monitoring/Logger.js';

describe('Logger', () => {
  let logger: Logger;

  beforeEach(() => {
    // Reset console mocks
    vi.clearAllMocks();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('constructor', () => {
    it('should create logger with default configuration', () => {
      logger = new Logger();
      expect(logger).toBeInstanceOf(Logger);
    });

    it('should create logger with custom configuration', () => {
      logger = new Logger({
        level: LogLevel.WARN,
        enableConsole: false,
        enableCollection: true,
      });
      expect(logger).toBeInstanceOf(Logger);
    });
  });

  describe('logging methods', () => {
    beforeEach(() => {
      logger = new Logger({
        level: LogLevel.DEBUG,
        enableConsole: true,
        enableCollection: true,
      });
    });

    describe('debug', () => {
      it('should log debug messages when level allows', () => {
        logger.debug('Debug message');
        expect(console.debug).toHaveBeenCalledWith(expect.stringContaining('Debug message'));
      });

      it('should not log debug when level is higher', () => {
        logger = new Logger({ level: LogLevel.INFO });
        logger.debug('Debug message');
        expect(console.debug).not.toHaveBeenCalled();
      });

      it('should log debug with context', () => {
        const context = { key: 'value', number: 123 };
        logger.debug('Debug with context', context);
        expect(console.debug).toHaveBeenCalledWith(expect.stringContaining('Debug with context'));
      });
    });

    describe('info', () => {
      it('should log info messages', () => {
        logger.info('Info message');
        expect(console.info).toHaveBeenCalledWith(expect.stringContaining('Info message'));
      });

      it('should log info with context', () => {
        const context = { operation: 'test' };
        logger.info('Info with context', context);
        expect(console.info).toHaveBeenCalledWith(expect.stringContaining('Info with context'));
      });
    });

    describe('warn', () => {
      it('should log warning messages', () => {
        logger.warn('Warning message');
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Warning message'));
      });

      it('should log warn with context', () => {
        const context = { reason: 'test warning' };
        logger.warn('Warning with context', context);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Warning with context'));
      });
    });

    describe('error', () => {
      it('should log error messages', () => {
        logger.error('Error message');
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Error message'));
      });

      it('should log error with Error object', () => {
        const error = new Error('Test error');
        logger.error('Error occurred', error);
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Error occurred'));
        expect(console.error).toHaveBeenCalledWith(error);
      });

      it('should log error with Error object and context', () => {
        const error = new Error('Test error');
        const context = { operation: 'test' };
        logger.error('Error with context', error, context);
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Error with context'));
      });
    });
  });

  describe('console output control', () => {
    it('should not output to console when disabled', () => {
      logger = new Logger({
        level: LogLevel.DEBUG,
        enableConsole: false,
        enableCollection: true,
      });

      logger.info('Test message');
      expect(console.info).not.toHaveBeenCalled();
    });

    it('should output to console when enabled', () => {
      logger = new Logger({
        level: LogLevel.DEBUG,
        enableConsole: true,
        enableCollection: false,
      });

      logger.info('Test message');
      expect(console.info).toHaveBeenCalled();
    });
  });

  describe('log collection', () => {
    beforeEach(() => {
      logger = new Logger({
        level: LogLevel.DEBUG,
        enableConsole: false,
        enableCollection: true,
      });
    });

    it('should collect log entries when enabled', () => {
      logger.info('Test message');
      logger.warn('Warning message');

      const entries = logger.getEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].message).toBe('Test message');
      expect(entries[0].level).toBe(LogLevel.INFO);
      expect(entries[1].message).toBe('Warning message');
      expect(entries[1].level).toBe(LogLevel.WARN);
    });

    it('should not collect entries when disabled', () => {
      logger = new Logger({
        level: LogLevel.DEBUG,
        enableConsole: false,
        enableCollection: false,
      });

      logger.info('Test message');
      const entries = logger.getEntries();
      expect(entries).toHaveLength(0);
    });

    it('should include context in collected entries', () => {
      const context = { operation: 'test', id: 123 };
      logger.info('Test with context', context);

      const entries = logger.getEntries();
      expect(entries[0].context).toEqual(context);
    });

    it('should include error details in collected entries', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test';

      logger.error('Error occurred', error);

      const entries = logger.getEntries();
      expect(entries[0].error).toBe(error);
    });

    it('should maintain entry timestamps', () => {
      const before = Date.now();
      logger.info('Test message');
      const after = Date.now();

      const entries = logger.getEntries();
      expect(entries[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(entries[0].timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('log level filtering', () => {
    it('should respect log level for DEBUG', () => {
      logger = new Logger({
        level: LogLevel.DEBUG,
        enableConsole: true,
        enableCollection: true,
      });

      logger.debug('Debug');
      logger.info('Info');
      logger.warn('Warn');
      logger.error('Error');

      const entries = logger.getEntries();
      expect(entries).toHaveLength(4);
    });

    it('should respect log level for INFO', () => {
      logger = new Logger({
        level: LogLevel.INFO,
        enableConsole: true,
        enableCollection: true,
      });

      logger.debug('Debug');
      logger.info('Info');
      logger.warn('Warn');
      logger.error('Error');

      const entries = logger.getEntries();
      expect(entries).toHaveLength(3); // No debug
      expect(entries.map(e => e.level)).toEqual([LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR]);
    });

    it('should respect log level for WARN', () => {
      logger = new Logger({
        level: LogLevel.WARN,
        enableConsole: true,
        enableCollection: true,
      });

      logger.debug('Debug');
      logger.info('Info');
      logger.warn('Warn');
      logger.error('Error');

      const entries = logger.getEntries();
      expect(entries).toHaveLength(2); // Only warn and error
      expect(entries.map(e => e.level)).toEqual([LogLevel.WARN, LogLevel.ERROR]);
    });

    it('should respect log level for ERROR', () => {
      logger = new Logger({
        level: LogLevel.ERROR,
        enableConsole: true,
        enableCollection: true,
      });

      logger.debug('Debug');
      logger.info('Info');
      logger.warn('Warn');
      logger.error('Error');

      const entries = logger.getEntries();
      expect(entries).toHaveLength(1); // Only error
      expect(entries[0].level).toBe(LogLevel.ERROR);
    });
  });

  describe('clear', () => {
    beforeEach(() => {
      logger = new Logger({
        level: LogLevel.DEBUG,
        enableConsole: false,
        enableCollection: true,
      });
    });

    it('should clear all collected entries', () => {
      logger.info('Message 1');
      logger.warn('Message 2');
      logger.error('Message 3');

      expect(logger.getEntries()).toHaveLength(3);

      logger.clear();

      expect(logger.getEntries()).toHaveLength(0);
    });
  });
});
