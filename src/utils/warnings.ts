/**
 * One-time process warnings
 */

const WARNING_TYPE = 'RedlockUniversalWarning';

/**
 * Emit a process warning the first time its code is seen in this process.
 * The flag lives on globalThis, so a process that loads both the ESM and the
 * CommonJS build still warns once.
 *
 * @returns true when this call emitted the warning
 */
export function emitWarningOnce(code: string, message: string): boolean {
  const flag = Symbol.for(`redlock-universal.warned.${code}`);
  const registry = globalThis as Record<symbol, unknown>;

  if (registry[flag]) {
    return false;
  }

  registry[flag] = true;
  process.emitWarning(message, { type: WARNING_TYPE, code });
  return true;
}
