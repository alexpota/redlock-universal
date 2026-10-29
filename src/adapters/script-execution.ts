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
 * Key of an optional adapter method that releases a lock with EVAL, sending the script itself,
 * so it works whatever the server's script cache holds (first use, restart, failover, SCRIPT
 * FLUSH). Best-effort cleanup uses it when an adapter has it, and delIfMatch otherwise.
 * @internal
 */
export const RELEASE_WITH_SCRIPT_BODY: unique symbol = Symbol.for(
  'redlock-universal.releaseWithScriptBody'
);

/**
 * Adapter that can release a lock by sending the release script itself
 * @internal
 */
export interface ReleaseWithScriptBody {
  [RELEASE_WITH_SCRIPT_BODY](key: string, value: string): Promise<boolean>;
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
 * the script is sent once more as EVAL. Redis 7.4+ and Valkey 8+ can also evict scripts
 * cached by EVAL once more than 500 are cached; the same fallback covers that.
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
