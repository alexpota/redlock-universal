import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Redis from 'ioredis';
import { IoredisAdapter, LockManager } from '../../../src/index.js';
import { delay, generateTestKey, getRedisUrl } from '../../shared/constants.js';

/** Databases on one server stand in for independent Redis nodes */
const NODE_DATABASES = [0, 1] as const;
const SECOND_NODE = 1;
const RELEASE_TTL = 20_000;
const SHORT_ROUTINE_MS = 200;
/** Long enough for at least one extension */
const EXTENDING_TTL = 2_000;
const EXTENDING_ROUTINE_MS = 3_000;
const TEST_TIMEOUT_MS = 15_000;

describe('LockManager batch locks on a non-default node', () => {
  let clients: Redis[];
  let manager: LockManager;

  beforeAll(() => {
    clients = NODE_DATABASES.map(db => new Redis(getRedisUrl(), { db }));
    manager = new LockManager({ nodes: clients.map(client => new IoredisAdapter(client)) });
  });

  afterAll(() => {
    for (const client of clients) {
      client.disconnect();
    }
  });

  const batchKeys = (scenario: string): string[] => [
    generateTestKey(`manager:node:${scenario}:a`),
    generateTestKey(`manager:node:${scenario}:b`),
  ];

  const heldOnSecondNode = (keys: string[]): Promise<number> =>
    clients[SECOND_NODE]!.exists(...keys);

  it('releaseBatch releases the locks on that node', async () => {
    const keys = batchKeys('release');
    const handles = await manager.acquireBatch(keys, { nodeIndex: SECOND_NODE, ttl: RELEASE_TTL });

    const results = await manager.releaseBatch(handles);

    expect(results).toEqual([true, true]);
    expect(await heldOnSecondNode(keys)).toBe(0);
  });

  it('usingBatch releases the locks on that node', async () => {
    const keys = batchKeys('using');

    await manager.usingBatch(keys, () => delay(SHORT_ROUTINE_MS), {
      nodeIndex: SECOND_NODE,
      ttl: RELEASE_TTL,
    });

    expect(await heldOnSecondNode(keys)).toBe(0);
  });

  it(
    'usingBatch extends the locks on that node',
    async () => {
      const keys = batchKeys('extend');
      let abortedDuringRoutine = true;

      await manager.usingBatch(
        keys,
        async signal => {
          await delay(EXTENDING_ROUTINE_MS);
          abortedDuringRoutine = signal.aborted;
        },
        { nodeIndex: SECOND_NODE, ttl: EXTENDING_TTL }
      );

      expect(abortedDuringRoutine).toBe(false);
      expect(await heldOnSecondNode(keys)).toBe(0);
    },
    TEST_TIMEOUT_MS
  );
});
