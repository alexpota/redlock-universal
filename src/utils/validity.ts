/**
 * Lock validity rules shared by every lock type
 */

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
 * Reject a TTL that leaves no validity once the clock drift allowance is taken off: a lock
 * with it could never be acquired
 */
export function assertTtlAboveDrift(
  ttl: number,
  driftFactor: number = DEFAULTS.CLOCK_DRIFT_FACTOR
): void {
  const drift = clockDriftFor(ttl, driftFactor);
  if (ttl <= drift) {
    throw new Error(
      `TTL must be greater than its clock drift allowance: ${ttl}ms TTL, ${drift}ms drift`
    );
  }
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
