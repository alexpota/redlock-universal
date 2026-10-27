import { createHash } from 'node:crypto';

/** Matches the NOSCRIPT server reply and GLIDE's NoScriptError */
const NO_SCRIPT_PATTERN = /noscript/i;

/**
 * Client calls that run one Lua script. Both pass the script's keys, so a cluster
 * client sends them to the node that owns those keys.
 * @internal
 */
export interface ScriptCalls {
  /** Runs the cached script by its SHA1 digest (EVALSHA) */
  readonly evalSha: (sha: string) => Promise<unknown>;
  /** Sends the script itself (EVAL), which also caches it on that node */
  readonly evalScript: () => Promise<unknown>;
}

/**
 * Whether an error means the server does not have the script cached
 * @internal
 */
export function isNoScriptError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (NO_SCRIPT_PATTERN.test(error.name) || NO_SCRIPT_PATTERN.test(error.message))
  );
}

/**
 * Runs a Lua script by its SHA1 digest, computed locally and kept in `shaCache`.
 * If the node does not have the script (first use, restart, failover, SCRIPT FLUSH),
 * the script is sent once more as EVAL.
 * @internal
 */
export async function executeScript<T>(
  shaCache: Map<string, string>,
  scriptName: string,
  script: string,
  calls: ScriptCalls
): Promise<T> {
  let sha = shaCache.get(scriptName);
  if (!sha) {
    sha = createHash('sha1').update(script).digest('hex');
    shaCache.set(scriptName, sha);
  }

  try {
    return (await calls.evalSha(sha)) as T;
  } catch (error) {
    if (!isNoScriptError(error)) {
      throw new Error('Script execution failed', { cause: error });
    }
  }

  try {
    return (await calls.evalScript()) as T;
  } catch (error) {
    throw new Error('Script execution failed', { cause: error });
  }
}
