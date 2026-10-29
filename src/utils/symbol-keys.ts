/**
 * Prefix of the Symbol.for keys the library registers. Symbol.for keys are global, so every
 * copy of the library loaded in a process (ESM and CommonJS builds) shares them
 */
export const SYMBOL_KEY_PREFIX = 'redlock-universal.';
