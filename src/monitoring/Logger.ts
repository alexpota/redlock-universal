/**
 * Structured logger for redlock-universal
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * Logger interface for external logger compatibility
 *
 * Message-first signature compatible with Winston, Bunyan, Log4js, and Console.
 * For Pino, use createPinoAdapter() helper.
 */
export interface ILogger {
  /** Log debug message */
  debug(message: string, context?: Record<string, unknown>): void;

  /** Log info message */
  info(message: string, context?: Record<string, unknown>): void;

  /** Log warning message */
  warn(message: string, context?: Record<string, unknown>): void;

  /** Log error message */
  error(message: string, error?: Error, context?: Record<string, unknown>): void;
}

export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: number;
  readonly context?: Record<string, unknown>;
  readonly error?: Error;
}

export interface LoggerConfig {
  readonly level: LogLevel;
  readonly prefix?: string;
  readonly enableConsole?: boolean;
  readonly enableCollection?: boolean;
  readonly maxEntries?: number;
}

/**
 * Built-in Logger implementation with extended features
 * Implements ILogger interface for compatibility
 */
export class Logger implements ILogger {
  private readonly config: Required<LoggerConfig>;
  private readonly entries: LogEntry[] = [];

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: config.level ?? LogLevel.INFO,
      prefix: config.prefix ?? 'RedLock',
      enableConsole: config.enableConsole ?? true,
      enableCollection: config.enableCollection ?? false,
      maxEntries: config.maxEntries ?? 1000,
    };
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * Log info message
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context);
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, context);
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, context, error);
  }

  /**
   * Create a child logger with additional context
   */
  child(context: Record<string, unknown>): Logger {
    const childLogger = new Logger(this.config);

    // Override the log method to include parent context
    const originalLog = childLogger.log.bind(childLogger);
    childLogger.log = (
      level: LogLevel,
      message: string,
      childContext?: Record<string, unknown>,
      error?: Error
    ) => {
      const mergedContext = { ...context, ...childContext };
      originalLog(level, message, mergedContext, error);
    };

    return childLogger;
  }

  /**
   * Get collected log entries
   */
  getEntries(level?: LogLevel): LogEntry[] {
    if (!this.config.enableCollection) {
      return [];
    }

    return level !== undefined
      ? this.entries.filter(entry => entry.level >= level)
      : [...this.entries];
  }

  /**
   * Clear collected log entries
   */
  clear(): void {
    this.entries.length = 0;
  }

  /**
   * Set log level
   */
  setLevel(level: LogLevel): void {
    (this.config as { level: LogLevel }).level = level;
  }

  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error
  ): void {
    if (level < this.config.level) {
      return;
    }

    const timestamp = Date.now();

    // Console output (fields are passed through, so no entry object is built or shared)
    if (this.config.enableConsole) {
      this.writeToConsole(level, message, timestamp, context, error);
    }

    // Collection (create new entry only if needed)
    if (this.config.enableCollection) {
      const entry: LogEntry = {
        level,
        message,
        timestamp,
        ...(context && { context }),
        ...(error && { error }),
      };

      this.entries.push(entry);

      // Maintain max entries limit
      if (this.entries.length > this.config.maxEntries) {
        this.entries.shift();
      }
    }
  }

  private writeToConsole(
    level: LogLevel,
    message: string,
    timestamp: number,
    context?: Record<string, unknown>,
    error?: Error
  ): void {
    const isoTime = new Date(timestamp).toISOString();
    const levelName = LogLevel[level];
    const prefix = `[${isoTime}] ${this.config.prefix} ${levelName}:`;

    let output = `${prefix} ${message}`;

    if (context && Object.keys(context).length > 0) {
      output += ` ${JSON.stringify(context)}`;
    }

    switch (level) {
      case LogLevel.DEBUG:
        console.debug(output);
        break;
      case LogLevel.INFO:
        console.info(output);
        break;
      case LogLevel.WARN:
        console.warn(output);
        if (error) {
          console.warn(error);
        }
        break;
      case LogLevel.ERROR:
        console.error(output);
        if (error) {
          console.error(error);
        }
        break;
    }
  }
}

export const logger = new Logger({
  level: LogLevel.INFO,
  enableConsole: true,
  enableCollection: false,
});
