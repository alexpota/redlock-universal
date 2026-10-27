import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { executeScript, isNoScriptError } from '../../../src/adapters/script-execution.js';
import { NO_SCRIPT_ERRORS, scriptSha } from '../../shared/scripts.js';

const SCRIPT = 'return 1';
const SCRIPT_NAME = 'TEST';
const SOURCE_DIR = fileURLToPath(new URL('../../../src/', import.meta.url));
/** A call to eval, global or as a method */
const EVAL_CALL = /(^|[^\w$])eval\s*\(/;

describe('script execution', () => {
  describe('isNoScriptError', () => {
    it('recognises the NOSCRIPT server reply', () => {
      expect(isNoScriptError(new Error(NO_SCRIPT_ERRORS.REPLY))).toBe(true);
    });

    it('recognises the GLIDE NoScriptError message', () => {
      expect(isNoScriptError(new Error(NO_SCRIPT_ERRORS.GLIDE))).toBe(true);
    });

    it('recognises errors named NoScriptError', () => {
      const error = new Error('No matching script.');
      error.name = 'NoScriptError';

      expect(isNoScriptError(error)).toBe(true);
    });

    it('ignores other errors', () => {
      expect(isNoScriptError(new Error('Connection is closed.'))).toBe(false);
      expect(isNoScriptError(NO_SCRIPT_ERRORS.REPLY)).toBe(false);
    });
  });

  describe('executeScript', () => {
    it('runs the script by its SHA1 digest', async () => {
      const evalSha = vi.fn().mockResolvedValue(1);
      const evalScript = vi.fn();

      await expect(
        executeScript(new Map(), SCRIPT_NAME, SCRIPT, { evalSha, evalScript })
      ).resolves.toBe(1);
      expect(evalSha).toHaveBeenCalledWith(scriptSha(SCRIPT));
      expect(evalScript).not.toHaveBeenCalled();
    });

    it('sends the script body when the server does not have it cached', async () => {
      const evalSha = vi.fn().mockRejectedValue(new Error(NO_SCRIPT_ERRORS.GLIDE));
      const evalScript = vi.fn().mockResolvedValue(1);

      await expect(
        executeScript(new Map(), SCRIPT_NAME, SCRIPT, { evalSha, evalScript })
      ).resolves.toBe(1);
      expect(evalScript).toHaveBeenCalledTimes(1);
    });

    it('reports other errors without sending the script body', async () => {
      const cause = new Error('Connection is closed.');
      const evalScript = vi.fn();

      await expect(
        executeScript(new Map(), SCRIPT_NAME, SCRIPT, {
          evalSha: vi.fn().mockRejectedValue(cause),
          evalScript,
        })
      ).rejects.toMatchObject({ message: 'Script execution failed', cause });
      expect(evalScript).not.toHaveBeenCalled();
    });

    it('reports a failure of the script body', async () => {
      const cause = new Error('OOM command not allowed when used memory > maxmemory.');

      await expect(
        executeScript(new Map(), SCRIPT_NAME, SCRIPT, {
          evalSha: vi.fn().mockRejectedValue(new Error(NO_SCRIPT_ERRORS.REPLY)),
          evalScript: vi.fn().mockRejectedValue(cause),
        })
      ).rejects.toMatchObject({ message: 'Script execution failed', cause });
    });

    it('keeps the digest in the given cache', async () => {
      const cache = new Map<string, string>();

      await executeScript(cache, SCRIPT_NAME, SCRIPT, {
        evalSha: vi.fn().mockResolvedValue(1),
        evalScript: vi.fn(),
      });

      expect(cache.get(SCRIPT_NAME)).toBe(scriptSha(SCRIPT));
    });
  });

  it('library source never calls eval', () => {
    const files = readdirSync(SOURCE_DIR, { recursive: true, encoding: 'utf8' }).filter(file =>
      file.endsWith('.ts')
    );
    const offenders = files.filter(file =>
      EVAL_CALL.test(readFileSync(join(SOURCE_DIR, file), 'utf8'))
    );

    expect(files.length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
