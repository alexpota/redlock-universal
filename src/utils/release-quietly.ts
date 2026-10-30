/**
 * Best-effort release of a lock value, for cleanup after an attempt that did not get the lock
 */

import type { RedisAdapter } from '../types/adapters.js';
import type { ILogger } from '../monitoring/Logger.js';
import {
  RELEASE_WITH_SCRIPT_BODY,
  type ReleaseWithScriptBody,
} from '../adapters/script-execution.js';

/**
 * Release a value this client may have written, without waiting for the result or failing.
 * Adapters that can send the release script itself do so, so an empty script cache (after a
 * restart, failover or SCRIPT FLUSH) does not stop the release; others use delIfMatch.
 *
 * Best effort: it relies on the client sending commands in order over one connection, so
 * the release runs after a SET that is still in flight. Connection pools and cluster
 * redirects can reorder the two; the key then expires with its TTL. A release that fails is
 * logged at debug level when a logger is given.
 */
export function releaseQuietly(
  adapter: RedisAdapter,
  key: string,
  value: string,
  logger?: ILogger
): void {
  const releaseWithScriptBody = (adapter as Partial<ReleaseWithScriptBody>)[
    RELEASE_WITH_SCRIPT_BODY
  ];

  void Promise.resolve()
    .then(() =>
      releaseWithScriptBody
        ? releaseWithScriptBody.call(adapter, key, value)
        : adapter.delIfMatch(key, value)
    )
    .catch((error: unknown) => {
      // An unreleased key expires with its TTL
      try {
        logger?.debug?.('Release after a failed lock attempt did not complete', {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // A failing logger must not turn into an unhandled rejection
      }
    });
}
