import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Redis, { Cluster } from 'ioredis';
import { createCluster } from 'redis';
import { GlideClusterClient } from '@valkey/valkey-glide';
import { GlideAdapter, IoredisAdapter, NodeRedisAdapter } from '../../../src/index.js';
import { DELETE_IF_MATCH_SCRIPT, REDIS_SCRIPT_SUCCESS } from '../../../src/adapters/BaseAdapter.js';
import type { RedisAdapter } from '../../../src/types/adapters.js';
import { generateTestKey } from '../../shared/constants.js';
import { scriptSha } from '../../shared/scripts.js';

/**
 * Cluster masters as "host:port,host:port,..." (see scripts/test-cluster.sh).
 * Without it these tests are skipped.
 */
const CLUSTER_NODES = (process.env.REDIS_CLUSTER_NODES ?? '')
  .split(',')
  .filter(Boolean)
  .map(address => {
    const [host = '', port = ''] = address.split(':');
    return { host, port: Number(port) };
  });

const TTL = 10_000;
const MIN_TTL = 1_000;
const COLD_CYCLES = 30;
const FLUSH_ROUNDS = 10;
const CYCLES_PER_FLUSH = 5;
const REQUEST_TIMEOUT_MS = 3_000;
const TEST_TIMEOUT_MS = 60_000;

interface Target {
  readonly adapter: RedisAdapter;
  close(): Promise<void>;
}

interface ClosableNodeRedisCluster {
  close?: () => Promise<unknown>;
  quit?: () => Promise<unknown>;
}

const TARGETS: Record<string, () => Promise<Target>> = {
  'ioredis Cluster': async () => {
    const cluster = new Cluster(CLUSTER_NODES);
    await new Promise<void>((resolve, reject) => {
      cluster.once('ready', resolve);
      cluster.once('error', reject);
    });
    return { adapter: new IoredisAdapter(cluster), close: async () => cluster.disconnect() };
  },
  'node-redis cluster': async () => {
    const cluster = createCluster({
      rootNodes: CLUSTER_NODES.map(({ host, port }) => ({ url: `redis://${host}:${port}` })),
    });
    await cluster.connect();
    // close() since node-redis 5, quit() before
    const closable = cluster as unknown as ClosableNodeRedisCluster;
    return {
      adapter: new NodeRedisAdapter(cluster),
      close: async () => {
        await (closable.close ?? closable.quit)?.call(cluster);
      },
    };
  },
  'GLIDE cluster': async () => {
    const client = await GlideClusterClient.createClient({
      addresses: CLUSTER_NODES,
      requestTimeout: REQUEST_TIMEOUT_MS,
    });
    return { adapter: new GlideAdapter(client), close: async () => client.close() };
  },
};

/** Runs a command on every master, one connection each */
async function onEveryMaster<T>(command: (node: Redis) => Promise<T>): Promise<T[]> {
  return Promise.all(
    CLUSTER_NODES.map(async node => {
      const client = new Redis(node);
      try {
        return await command(client);
      } finally {
        client.disconnect();
      }
    })
  );
}

/** Same effect on the script cache as a restart or failover */
const flushScripts = (): Promise<unknown[]> => onEveryMaster(node => node.script('FLUSH'));

/**
 * Exercises every lock script on keys spread across the cluster.
 * Returns a description of each failed operation.
 */
async function runLockCycles(adapter: RedisAdapter, count: number): Promise<string[]> {
  const failures: string[] = [];
  const attempt = async (label: string, operation: () => Promise<boolean>): Promise<void> => {
    try {
      if (!(await operation())) {
        failures.push(`${label}: unexpected result`);
      }
    } catch (error) {
      const cause = (error as Error).cause as Error | undefined;
      failures.push(`${label}: ${(error as Error).message}${cause ? ` (${cause.message})` : ''}`);
    }
  };

  for (let i = 0; i < count; i++) {
    const key = generateTestKey(`cluster:${i}`);
    const value = `owner-${i}`;
    // Batch keys share a hash tag, so they live in one slot
    const tag = generateTestKey(`cluster-batch:${i}`);
    const batchKeys = [`{${tag}}:a`, `{${tag}}:b`];

    await attempt('setNX', async () => (await adapter.setNX(key, value, TTL)) === 'OK');
    await attempt('extendIfMatch', () => adapter.extendIfMatch(key, value, TTL));
    await attempt(
      'atomicExtend',
      async () =>
        (await adapter.atomicExtend(key, value, MIN_TTL, TTL)).resultCode === REDIS_SCRIPT_SUCCESS
    );
    await attempt('inspect', async () => (await adapter.inspect(key))?.value === value);
    await attempt('delIfMatch', () => adapter.delIfMatch(key, value));
    await attempt(
      'batchSetNX',
      async () => (await adapter.batchSetNX(batchKeys, [value, value], TTL)).success
    );
    for (const batchKey of batchKeys) {
      await attempt('delIfMatch (batch)', () => adapter.delIfMatch(batchKey, value));
    }
  }

  return failures;
}

describe.skipIf(CLUSTER_NODES.length === 0)('Lock scripts on Redis Cluster', () => {
  describe.each(Object.entries(TARGETS))('%s', (_name, createTarget) => {
    let target: Target;

    beforeAll(async () => {
      target = await createTarget();
    });

    afterAll(async () => {
      await target?.close();
    });

    it(
      'run on a cluster with an empty script cache',
      async () => {
        await flushScripts();

        expect(await runLockCycles(target.adapter, COLD_CYCLES)).toEqual([]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'keep working each time the script cache is flushed',
      async () => {
        const failures: string[] = [];

        for (let round = 0; round < FLUSH_ROUNDS; round++) {
          await flushScripts();
          failures.push(...(await runLockCycles(target.adapter, CYCLES_PER_FLUSH)));
        }

        expect(failures).toEqual([]);
      },
      TEST_TIMEOUT_MS
    );

    it(
      'cache the scripts again on the nodes that run them',
      async () => {
        await flushScripts();
        await runLockCycles(target.adapter, 1);

        const cached = await onEveryMaster(
          async node => (await node.script('EXISTS', scriptSha(DELETE_IF_MATCH_SCRIPT))) as number[]
        );

        expect(cached.flat().some(present => present === 1)).toBe(true);
      },
      TEST_TIMEOUT_MS
    );
  });
});
