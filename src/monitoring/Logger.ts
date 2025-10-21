/**
 * Structured logger for redlock-universal
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
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

export class Logger {
  private readonly config: Required<LoggerConfig>;
  private readonly entries: LogEntry[] = [];
  private _reusableEntry: {
    level?: LogLevel;
    message?: string;
    timestamp?: number;
    context?: Record<string, unknown>;
    error?: Error;
  } = {};

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

    // Console output (uses reusable entry to avoid allocation)
    if (this.config.enableConsole) {
      this._reusableEntry.level = level;
      this._reusableEntry.message = message;
      this._reusableEntry.timestamp = timestamp;
      if (context !== undefined) {
        this._reusableEntry.context = context;
      }
      if (error !== undefined) {
        this._reusableEntry.error = error;
      }

      this.writeToConsole(this._reusableEntry as LogEntry);
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

  private writeToConsole(entry: LogEntry): void {
    const timestamp = new Date(entry.timestamp).toISOString();
    const levelName = LogLevel[entry.level];
    const prefix = `[${timestamp}] ${this.config.prefix} ${levelName}:`;

    let output = `${prefix} ${entry.message}`;

    if (entry.context && Object.keys(entry.context).length > 0) {
      output += ` ${JSON.stringify(entry.context)}`;
    }

    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(output);
        break;
      case LogLevel.INFO:
        console.info(output);
        break;
      case LogLevel.WARN:
        console.warn(output);
        if (entry.error) {
          console.warn(entry.error);
        }
        break;
      case LogLevel.ERROR:
        console.error(output);
        if (entry.error) {
          console.error(entry.error);
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
