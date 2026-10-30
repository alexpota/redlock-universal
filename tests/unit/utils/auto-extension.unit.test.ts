import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeWithAutoExtension } from '../../../src/utils/auto-extension.js';
import type { Lock, LockHandle } from '../../../src/types/locks.js';
import type { AtomicExtensionResult } from '../../../src/types/adapters.js';

const TTL = 10_000;
/** Extensions are due once 80% of the TTL has been consumed */
const EXTENSION_POINT_MS = TTL * 0.8;
const REPLY_MS = 1_500;

const EXTENDED: AtomicExtensionResult = {
  resultCode: 1,
  actualTTL: 2_000,
  message: 'Extension successful',
};

type AtomicExtend = () => Promise<AtomicExtensionResult>;

function createHandle(acquiredAt: number, key = 'resource'): LockHandle {
  return { id: `id-${key}`, key, value: `value-${key}`, acquiredAt, ttl: TTL };
}

function createLock(atomicExtend: AtomicExtend) {
  const adapter = { atomicExtend: vi.fn(atomicExtend) };
  const lock = {
    getAdapter: () => adapter,
    release: vi.fn(async () => true),
    extend: vi.fn(async () => true),
  } as unknown as Lock;
  return { lock, adapter };
}

const replyAfter =
  (ms: number): AtomicExtend =>
  () =>
    new Promise(resolve => setTimeout(() => resolve(EXTENDED), ms));

/** Routine that runs until `finish()` is called */
function pendingRoutine() {
  let finish!: () => void;
  const done = new Promise<void>(resolve => {
    finish = resolve;
  });
  return { routine: () => done, finish };
}

describe('executeWithAutoExtension scheduling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('extends at once when the extension point has already passed', async () => {
    const { lock, adapter } = createLock(async () => EXTENDED);
    const handle = createHandle(Date.now() - EXTENSION_POINT_MS - 1);

    await executeWithAutoExtension({
      locks: [lock],
      handles: [handle],
      ttl: TTL,
      routine: async () => {
        expect(adapter.atomicExtend).toHaveBeenCalledTimes(1);
      },
    });
  });

  it('times the first extension from the earliest acquisition', async () => {
    const OFFSET_MS = 1_000;
    const earliest = createLock(async () => EXTENDED);
    const latest = createLock(async () => EXTENDED);
    const { routine, finish } = pendingRoutine();

    const run = executeWithAutoExtension({
      locks: [earliest.lock, latest.lock],
      handles: [createHandle(Date.now() - OFFSET_MS, 'a'), createHandle(Date.now(), 'b')],
      ttl: TTL,
      routine,
    });

    await vi.advanceTimersByTimeAsync(EXTENSION_POINT_MS - OFFSET_MS - 1);
    expect(earliest.adapter.atomicExtend).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(earliest.adapter.atomicExtend).toHaveBeenCalledTimes(1);

    finish();
    await run;
  });

  it('times the next extension from when the previous one was sent', async () => {
    const { lock, adapter } = createLock(replyAfter(REPLY_MS));
    const { routine, finish } = pendingRoutine();

    const run = executeWithAutoExtension({
      locks: [lock],
      handles: [createHandle(Date.now())],
      ttl: TTL,
      routine,
    });

    await vi.advanceTimersByTimeAsync(EXTENSION_POINT_MS);
    expect(adapter.atomicExtend).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(EXTENSION_POINT_MS - 1);
    expect(adapter.atomicExtend).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(adapter.atomicExtend).toHaveBeenCalledTimes(2);

    finish();
    await vi.advanceTimersByTimeAsync(REPLY_MS);
    await run;
  });

  it('keeps its schedule when the wall clock steps back during an extension', async () => {
    const STEP_BACK_MS = 10_000;
    const { lock, adapter } = createLock(async () => {
      vi.setSystemTime(Date.now() - STEP_BACK_MS);
      return EXTENDED;
    });
    const { routine, finish } = pendingRoutine();

    const run = executeWithAutoExtension({
      locks: [lock],
      handles: [createHandle(Date.now())],
      ttl: TTL,
      routine,
    });

    await vi.advanceTimersByTimeAsync(EXTENSION_POINT_MS);
    expect(adapter.atomicExtend).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(EXTENSION_POINT_MS);
    expect(adapter.atomicExtend).toHaveBeenCalledTimes(2);

    finish();
    await run;
  });

  it('leaves no timer behind when the routine returns during an extension', async () => {
    let markExtending!: () => void;
    const extending = new Promise<void>(resolve => {
      markExtending = resolve;
    });
    const { lock } = createLock(() => {
      markExtending();
      return replyAfter(REPLY_MS)();
    });

    const run = executeWithAutoExtension({
      locks: [lock],
      handles: [createHandle(Date.now())],
      ttl: TTL,
      routine: () => extending,
    });

    await vi.advanceTimersByTimeAsync(EXTENSION_POINT_MS + REPLY_MS);
    await run;

    expect(vi.getTimerCount()).toBe(0);
  });

  it('extends a short TTL once per extension point', async () => {
    const SHORT_TTL = 1_000;
    const ROUTINE_MS = 2_000;
    const { lock, adapter } = createLock(replyAfter(1));
    const { routine, finish } = pendingRoutine();

    const run = executeWithAutoExtension({
      locks: [lock],
      handles: [createHandle(Date.now())],
      ttl: SHORT_TTL,
      routine,
    });

    await vi.advanceTimersByTimeAsync(ROUTINE_MS);
    finish();
    await vi.advanceTimersByTimeAsync(1);
    await run;

    expect(adapter.atomicExtend).toHaveBeenCalledTimes(Math.floor(ROUTINE_MS / (SHORT_TTL * 0.8)));
  });
});
