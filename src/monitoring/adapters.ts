/**
 * Logger adapters for external logging libraries
 */

import type { ILogger } from './Logger.js';

/**
 * Pino logger interface (object-first signature)
 */
export interface PinoLogger {
  debug(obj: object, msg?: string, ...args: unknown[]): void;
  info(obj: object, msg?: string, ...args: unknown[]): void;
  warn(obj: object, msg?: string, ...args: unknown[]): void;
  error(obj: object, msg?: string, ...args: unknown[]): void;
}

/**
 * Bunyan logger interface (fields-first signature)
 */
export interface BunyanLogger {
  debug(fields: object, msg?: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
  info(fields: object, msg?: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(fields: object, msg?: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(fields: object, msg?: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

/**
 * Create ILogger adapter for Pino
 *
 * Pino uses object-first signature, incompatible with ILogger's message-first.
 * This adapter bridges the gap.
 *
 * @param pino - Pino logger instance
 * @returns ILogger-compatible adapter
 */
export function createPinoAdapter(pino: PinoLogger): ILogger {
  return {
    debug: (message: string, context?: Record<string, unknown>) =>
      pino.debug(context ?? {}, message),

    info: (message: string, context?: Record<string, unknown>) => pino.info(context ?? {}, message),

    warn: (message: string, context?: Record<string, unknown>) => pino.warn(context ?? {}, message),

    error: (message: string, error?: Error, context?: Record<string, unknown>) =>
      pino.error({ ...context, err: error }, message),
  };
}

/**
 * Create ILogger adapter for Bunyan
 *
 * Bunyan uses fields-first signature, incompatible with ILogger's message-first.
 * This adapter converts message-first to fields-first for structured logging.
 *
 * @param bunyan - Bunyan logger instance
 * @returns ILogger-compatible adapter
 */
export function createBunyanAdapter(bunyan: BunyanLogger): ILogger {
  return {
    debug: (message: string, context?: Record<string, unknown>) => {
      if (context) {
        bunyan.debug(context, message);
      } else {
        bunyan.debug(message);
      }
    },

    info: (message: string, context?: Record<string, unknown>) => {
      if (context) {
        bunyan.info(context, message);
      } else {
        bunyan.info(message);
      }
    },

    warn: (message: string, context?: Record<string, unknown>) => {
      if (context) {
        bunyan.warn(context, message);
      } else {
        bunyan.warn(message);
      }
    },

    error: (message: string, error?: Error, context?: Record<string, unknown>) => {
      const fields = { ...context, ...(error && { err: error }) };
      if (Object.keys(fields).length > 0) {
        bunyan.error(fields, message);
      } else {
        bunyan.error(message);
      }
    },
  };
}
