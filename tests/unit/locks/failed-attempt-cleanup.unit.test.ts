import { describe, it, expect, vi, afterEach } from 'vitest';
import { RedLock } from '../../../src/locks/RedLock.js';
import { LockAcquisitionError } from '../../../src/types/errors.js';
import {
  PRODUCERS,
  releasedValues,
  scriptedNode,
  sentValues,
  type Producer,
  type Reply,
} from '../../shared/lock-fixtures.js';

const TTL = 10_000;
/** Long enough for a stray timer or rejection to surface after acquire() settles */
const SETTLE_MS = 50;

/**
 * One node per producer, RedLock included, so each attempt is decided by its own reply;
 * multi-node timing is tested in the RedLock unit tests
 */
const produce = (
  name: string,
  replies: readonly Reply[],
  release?: () => Promise<boolean>
): Producer =>
  PRODUCERS[name]!({
    ttl: TTL,
    attempts: replies.length,
    redlockNodes: 1,
    node: () => scriptedNode(replies, release ? { release } : {}),
  });

const sent = (producer: Producer): string[][] => sentValues(producer.nodes[0]!);
const released = (producer: Producer): string[] => producer.nodes.flatMap(releasedValues);

describe.each(Object.keys(PRODUCERS))('%s after a failed attempt', name => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should send a new value with every attempt', async () => {
    const producer = produce(name, [null, new Error('timeout'), 'OK']);

    await producer.acquire();

    const attempts = sent(producer);
    expect(attempts).toHaveLength(3);
    expect(new Set(attempts.flat()).size).toBe(attempts.flat().length);
  });

  it('should release the value of an attempt whose outcome is unknown', async () => {
    const producer = produce(name, [new Error('timeout'), 'OK']);

    const handles = await producer.acquire();

    const [failedAttempt] = sent(producer);
    expect(failedAttempt!.length).toBeGreaterThan(0);
    for (const value of failedAttempt!) {
      expect(released(producer)).toContain(value);
    }
    for (const handle of handles) {
      expect(released(producer)).not.toContain(handle.value);
    }
  });

  it('should not release after a reply that definitely did not set the key', async () => {
    const producer = produce(name, [null, 'OK']);

    await producer.acquire();

    expect(released(producer)).toEqual([]);
  });

  it('should not wait for a release that never answers', async () => {
    const producer = produce(name, [new Error('timeout')], () => new Promise(() => {}));

    const outcome = await Promise.race([
      producer.acquire().catch((error: unknown) => error),
      new Promise(resolve => setTimeout(() => resolve('still waiting'), SETTLE_MS)),
    ]);

    expect(outcome).toBeInstanceOf(LockAcquisitionError);
    expect(released(producer).length).toBeGreaterThan(0);
  });

  it('should not leave an unhandled rejection when the release fails', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const producer = produce(name, [new Error('timeout')], () =>
        Promise.reject(new Error('release failed'))
      );

      await expect(producer.acquire()).rejects.toBeInstanceOf(LockAcquisitionError);
      await new Promise(resolve => setTimeout(resolve, SETTLE_MS));

      expect(released(producer).length).toBeGreaterThan(0);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

describe('RedLock cleanup after a failed round', () => {
  it('should release nodes that granted or failed, but not nodes that refused', async () => {
    const granted = scriptedNode(['OK']);
    const refused = scriptedNode([null]);
    const failed = scriptedNode([new Error('timeout')]);
    // Quorum 2 of 3: the round is decided only by the last reply, so every node has answered
    const lock = new RedLock({
      adapters: [granted, refused, failed],
      key: 'cleanup',
      ttl: TTL,
      quorum: 2,
      retryAttempts: 0,
    });

    await expect(lock.acquire()).rejects.toBeInstanceOf(LockAcquisitionError);

    expect(granted.delIfMatch).toHaveBeenCalledTimes(1);
    expect(failed.delIfMatch).toHaveBeenCalledTimes(1);
    expect(refused.delIfMatch).not.toHaveBeenCalled();
  });
});
