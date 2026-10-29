/**
 * Lock validity rules shared by every lock type
 */

import type { RedisAdapter } from '../types/adapters.js';
import {
  RELEASE_WITH_SCRIPT_BODY,
  type ReleaseWithScriptBody,
} from '../adapters/script-execution.js';
import { DEFAULTS } from '../constants.js';

/** Allowance for the 1 ms resolution of Redis expiry, added to the clock drift */
const EXPIRY_RESOLUTION_ALLOWANCE_MS = 2;

/**
 * Clock drift allowance for a TTL, as in the Redlock algorithm: a fraction of the TTL
 * plus 2 ms for the resolution of Redis expiry
 */
export function clockDriftFor(
  ttl: number,
  driftFactor: number = DEFAULTS.CLOCK_DRIFT_FACTOR
): number {
  return Math.floor(ttl * driftFactor) + EXPIRY_RESOLUTION_ALLOWANCE_MS;
}

/**
 * Error for a lock granted after its validity time ran out: the time the attempt took
 * plus the drift allowance reached the TTL
 */
export function validityExceededError(elapsed: number, drift: number, ttl: number): Error {
  return new Error(
    `Lock validity time exceeded: acquiring took ${Math.ceil(elapsed)}ms + ${drift}ms clock drift >= ${ttl}ms TTL`
  );
}

/**
 * Release a value this client may have written, without waiting for the result or failing.
 * Adapters that can send the release script itself do so, so an empty script cache (after a
 * restart, failover or SCRIPT FLUSH) does not stop the release; others use delIfMatch.
 *
 * Best effort: it relies on the client sending commands in order over one connection, so
 * the release runs after a SET that is still in flight. Connection pools and cluster
 * redirects can reorder the two; the key then expires with its TTL.
 */
export function releaseQuietly(adapter: RedisAdapter, key: string, value: string): void {
  const releaseWithScriptBody = (adapter as Partial<ReleaseWithScriptBody>)[
    RELEASE_WITH_SCRIPT_BODY
  ];

  void Promise.resolve()
    .then(() =>
      releaseWithScriptBody
        ? releaseWithScriptBody.call(adapter, key, value)
        : adapter.delIfMatch(key, value)
    )
    .catch(() => {
      // An unreleased key expires with its TTL
    });
}
