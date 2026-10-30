/**
 * One-time process warnings
 */

import { SYMBOL_KEY_PREFIX } from './symbol-keys.js';

const WARNING_TYPE = 'RedlockUniversalWarning';

/**
 * Process-wide flag that records that the warning with this code was emitted
 */
export function warningFlag(code: string): symbol {
  return Symbol.for(`${SYMBOL_KEY_PREFIX}warned.${code}`);
}

/**
 * Emit a process warning the first time its code is seen in this process.
 * The flag lives on globalThis, so a process that loads both the ESM and the
 * CommonJS build still warns once.
 *
 * @returns true when this call emitted the warning
 */
export function emitWarningOnce(code: string, message: string): boolean {
  const flag = warningFlag(code);
  const registry = globalThis as Record<symbol, unknown>;

  if (registry[flag]) {
    return false;
  }

  registry[flag] = true;
  process.emitWarning(message, { type: WARNING_TYPE, code });
  return true;
}
