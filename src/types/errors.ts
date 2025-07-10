/**
 * Error types for the library
 */

/**
 * Base class for all redlock-universal errors
 */
export abstract class RedlockError extends Error {
  abstract readonly code: string;
  declare public cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = this.constructor.name;
    if (cause) {
      this.cause = cause;
    }
  }
}

/**
 * Thrown when unable to acquire a lock
 */
export class LockAcquisitionError extends RedlockError {
  readonly code = 'LOCK_ACQUISITION_FAILED';

  constructor(
    public readonly key: string,
    public readonly attempts: number,
    cause?: Error
  ) {
    super(
      `Failed to acquire lock "${key}" after ${attempts} attempts${
        cause ? `: ${cause.message}` : ''
      }`,
      cause
    );
  }
}

/**
 * Thrown when lock release fails
 */
export class LockReleaseError extends RedlockError {
  readonly code = 'LOCK_RELEASE_FAILED';

  constructor(
    public readonly key: string,
    public readonly reason: 'not_found' | 'wrong_value' | 'redis_error',
    cause?: Error
  ) {
    super(`Failed to release lock "${key}": ${reason}${cause ? `: ${cause.message}` : ''}`, cause);
  }
}

/**
 * Thrown when lock extension fails
 */
export class LockExtensionError extends RedlockError {
  readonly code = 'LOCK_EXTENSION_FAILED';

  constructor(
    public readonly key: string,
    public readonly reason: 'not_found' | 'wrong_value' | 'redis_error',
    cause?: Error
  ) {
    super(`Failed to extend lock "${key}": ${reason}${cause ? `: ${cause.message}` : ''}`, cause);
  }
}

/**
 * Thrown when Redis adapter configuration is invalid
 */
export class AdapterError extends RedlockError {
  readonly code = 'ADAPTER_ERROR';

  constructor(message: string, cause?: Error) {
    super(`Redis adapter error: ${message}`, cause);
  }
}

/**
 * Thrown when configuration is invalid
 */
export class ConfigurationError extends RedlockError {
  readonly code = 'CONFIGURATION_ERROR';

  constructor(message: string) {
    super(`Configuration error: ${message}`);
  }
}
