import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RedLock } from '../../../src/locks/RedLock.js';
import { LockAcquisitionError } from '../../../src/types/errors.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';
import {
  PRODUCERS,
  releasedValues,
  scriptedNode,
  type Producer,
} from '../../shared/lock-fixtures.js';

const TTL = 1_000;
/** Clock drift allowance for TTL: floor(TTL × 0.01) + 2 ms */
const DRIFT = 12;
const START_TIME = 1_700_000_000_000;
const NTP_STEP_BACK = 5_000;

/** One acquisition attempt: how long the reply takes and whether the lock was set */
interface Attempt {
  readonly delay: number;
  readonly granted: boolean;
  /** Wall-clock change during the attempt, when it differs from the elapsed time */
  readonly wallShift?: number;
}

let monotonicNow = 0;
let wallNow = START_TIME;

const elapse = (attempt: Attempt): void => {
  monotonicNow += attempt.delay;
  wallNow += attempt.wallShift ?? attempt.delay;
};

/** Only node 0 moves the clocks, so a RedLock round takes as long as its first node */
const produce = (name: string, attempts: readonly Attempt[]): Producer =>
  PRODUCERS[name]!({
    ttl: TTL,
    attempts: attempts.length,
    node: index =>
      scriptedNode(
        attempts.map(attempt => (attempt.granted ? 'OK' : null)),
        index === 0
          ? { onSend: call => elapse(attempts[Math.min(call, attempts.length - 1)]!) }
          : {}
      ),
  });

const released = (producer: Producer): string[] => producer.nodes.flatMap(releasedValues);

beforeEach(() => {
  monotonicNow = 0;
  wallNow = START_TIME;
  vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow);
  vi.spyOn(Date, 'now').mockImplementation(() => wallNow);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(Object.keys(PRODUCERS))('%s grant validity', name => {
  it('should accept a grant that leaves 1 ms of validity', async () => {
    const producer = produce(name, [{ delay: TTL - DRIFT - 1, granted: true }]);

    const handles = await producer.acquire();

    expect(handles.length).toBeGreaterThan(0);
    expect(released(producer)).toEqual([]);
  });

  it('should reject and release a grant whose elapsed time plus drift reaches the TTL', async () => {
    const producer = produce(name, [{ delay: TTL - DRIFT, granted: true }]);

    const error = await producer.acquire().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LockAcquisitionError);
    expect((error as Error).message).toMatch(/validity time exceeded/i);
    expect((error as Error).message).not.toMatch(/quorum not achieved/i);
    expect(released(producer).length).toBeGreaterThan(0);
  });

  it('should measure elapsed time on the monotonic clock', async () => {
    const producer = produce(name, [{ delay: TTL, granted: true, wallShift: -NTP_STEP_BACK }]);

    await expect(producer.acquire()).rejects.toThrow(/validity time exceeded/i);
  });

  it('should date the lock from when the winning attempt was sent', async () => {
    const busyTime = 50;
    const producer = produce(name, [
      { delay: busyTime, granted: false },
      { delay: 300, granted: true },
    ]);

    const handles = await producer.acquire();

    for (const handle of handles) {
      expect(handle.acquiredAt).toBe(START_TIME + busyTime);
    }
  });

  it('should retry after releasing a late grant', async () => {
    const producer = produce(name, [
      { delay: TTL, granted: true },
      { delay: 10, granted: true },
    ]);

    const handles = await producer.acquire();

    expect(handles[0]!.acquiredAt).toBe(START_TIME + TTL);
    expect(released(producer).length).toBeGreaterThan(0);
  });
});

describe('RedLock quorum reached too late, before every node replied', () => {
  it('should reject it and release the nodes that granted and the node still in flight', async () => {
    const slow = scriptedNode(['OK'], { onSend: () => elapse({ delay: TTL, granted: true }) });
    const fast = scriptedNode(['OK']);
    const hung = {
      setNX: vi.fn(() => new Promise(() => {})),
      delIfMatch: vi.fn().mockResolvedValue(true),
    } as unknown as RedisAdapter;
    const lock = new RedLock({
      adapters: [slow, fast, hung],
      key: 'lock',
      ttl: TTL,
      retryAttempts: 0,
    });

    await expect(lock.acquire()).rejects.toThrow(/validity time exceeded/i);

    for (const node of [slow, fast, hung]) {
      expect(node.delIfMatch).toHaveBeenCalledTimes(1);
    }
  });
});
