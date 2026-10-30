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
 * Reply to one timed acquisition attempt
 */
export interface TimedReply<T> {
  readonly reply: T;
  /** When the attempt was sent (Unix epoch ms): the lock's acquiredAt if it is granted in time */
  readonly sentAt: number;
  /** Monotonic time from sending the attempt to its reply (ms) */
  readonly elapsed: number;
}

/**
 * Send one acquisition attempt and time it. The server starts the TTL when it runs the
 * command, so a granted lock is valid from when the attempt was sent
 */
export async function sendTimed<T>(send: () => Promise<T>): Promise<TimedReply<T>> {
  const sentAt = Date.now();
  const startedAt = performance.now();
  const reply = await send();
  return { reply, sentAt, elapsed: performance.now() - startedAt };
}

/**
 * Apply the validity rule to a granted attempt. If its elapsed time plus the drift allowance
 * reaches the TTL, release it without waiting and return the error to report; return
 * undefined for a grant that is still valid
 */
export function lateGrantError(
  attempt: TimedReply<unknown>,
  ttl: number,
  drift: number,
  release: () => void
): Error | undefined {
  if (attempt.elapsed + drift < ttl) {
    return undefined;
  }
  release();
  return validityExceededError(attempt.elapsed, drift, ttl);
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
