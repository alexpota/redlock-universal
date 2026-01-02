/**
 * Redis Cluster Usage Examples
 *
 * This example demonstrates how to use redlock-universal with Redis Cluster
 * via ioredis.Cluster or node-redis createCluster().
 *
 * IMPORTANT: Understanding Redlock vs Redis Cluster
 * ================================================
 *
 * The Redlock algorithm and Redis Cluster serve different purposes:
 *
 * - Redlock: Distributed locking across INDEPENDENT Redis instances
 *   for fault tolerance against arbitrary node failures.
 *
 * - Redis Cluster: ONE logical system with automatic sharding and
 *   replication for high availability and scalability.
 *
 * Using a single Redis Cluster with redlock-universal provides:
 * - High availability via cluster's built-in replication
 * - Automatic failover if master nodes fail
 *
 * But NOT the same guarantees as true Redlock:
 * - Eventual consistency within cluster during failover
 * - All eggs in one basket (single cluster = single point of failure)
 *
 * For strongest guarantees, use multiple INDEPENDENT Redis instances.
 *
 * CLUSTER LIMITATIONS
 * ===================
 *
 * Redis Cluster routes commands based on key hash slots. This affects:
 *
 * - Batch operations (acquireBatch/releaseBatch): Keys that hash to different
 *   slots will cause CROSSSLOT errors. Use hash tags like {user}:lock:1 and
 *   {user}:lock:2 to ensure related keys hash to the same slot, OR use
 *   multiple independent instances instead of Cluster for batch locking.
 *
 * - Lua scripts: All KEYS[] arguments must hash to the same slot. Our single-key
 *   lock operations are safe (KEYS[1] only), but batch operations are not.
 */

import Redis, { Cluster } from 'ioredis';
import { createClient, createCluster } from 'redis';
import { IoredisAdapter, NodeRedisAdapter, createLock, createRedlock } from '../src/index.js';

// ============================================================================
// APPROACH 1: Single Redis Cluster (Simpler, HA via cluster replication)
// ============================================================================

async function singleClusterWithIoredis(): Promise<void> {
  console.log('\n=== Single Cluster with ioredis ===\n');

  // Create ioredis Cluster client
  const cluster = new Cluster([
    { host: 'redis-node-1', port: 6379 },
    { host: 'redis-node-2', port: 6379 },
    { host: 'redis-node-3', port: 6379 },
  ]);

  // IoredisAdapter accepts both Redis and Cluster types
  const adapter = new IoredisAdapter(cluster);

  const lock = createLock({
    adapter,
    key: 'cluster:resource:1',
    ttl: 30000,
  });

  try {
    // Use auto-extending lock for long operations
    const result = await lock.using(async signal => {
      console.log('Lock acquired on cluster');

      // Simulate work
      await new Promise(resolve => setTimeout(resolve, 100));

      if (signal.aborted) {
        throw new Error('Lock lost during operation');
      }

      return 'operation-complete';
    });

    console.log('Result:', result);
  } finally {
    cluster.disconnect();
  }
}

async function singleClusterWithNodeRedis(): Promise<void> {
  console.log('\n=== Single Cluster with node-redis ===\n');

  // Create node-redis Cluster client
  const cluster = createCluster({
    rootNodes: [
      { url: 'redis://redis-node-1:6379' },
      { url: 'redis://redis-node-2:6379' },
      { url: 'redis://redis-node-3:6379' },
    ],
  });

  await cluster.connect();

  // NodeRedisAdapter accepts any redis client (standalone or cluster)
  const adapter = new NodeRedisAdapter(cluster);

  const lock = createLock({
    adapter,
    key: 'cluster:resource:2',
    ttl: 30000,
  });

  try {
    const handle = await lock.acquire();
    console.log('Lock acquired on node-redis cluster');

    // Do work...
    await new Promise(resolve => setTimeout(resolve, 100));

    await lock.release(handle);
    console.log('Lock released');
  } finally {
    await cluster.disconnect();
  }
}

// ============================================================================
// APPROACH 2: Multiple Independent Instances (Stronger Redlock guarantees)
// ============================================================================

async function multipleIndependentInstances(): Promise<void> {
  console.log('\n=== Multiple Independent Instances (True Redlock) ===\n');

  // Create connections to INDEPENDENT Redis instances
  // These should be on different machines/failure domains
  const redis1 = new Redis({ host: 'redis-independent-1', port: 6379 });
  const redis2 = new Redis({ host: 'redis-independent-2', port: 6379 });
  const redis3 = new Redis({ host: 'redis-independent-3', port: 6379 });

  const adapters = [
    new IoredisAdapter(redis1),
    new IoredisAdapter(redis2),
    new IoredisAdapter(redis3),
  ];

  // Create distributed lock with quorum
  const redlock = createRedlock({
    adapters,
    key: 'distributed:critical-resource',
    ttl: 30000,
    quorum: 2, // Need majority (2 of 3) for consensus
  });

  try {
    const handle = await redlock.acquire();
    console.log('Distributed lock acquired across', handle.metadata?.nodes?.length, 'nodes');

    // Critical section with strongest guarantees
    await new Promise(resolve => setTimeout(resolve, 100));

    await redlock.release(handle);
    console.log('Distributed lock released');
  } finally {
    redis1.disconnect();
    redis2.disconnect();
    redis3.disconnect();
  }
}

// ============================================================================
// APPROACH 3: Multiple Redis Clusters (HA + Strongest Guarantees)
// ============================================================================

async function multipleClusters(): Promise<void> {
  console.log('\n=== Multiple Independent Clusters (Maximum Fault Tolerance) ===\n');

  // For maximum fault tolerance: multiple independent clusters
  // Each cluster provides HA, and Redlock provides cross-cluster consensus
  const cluster1 = new Cluster([
    { host: 'cluster1-node1', port: 6379 },
    { host: 'cluster1-node2', port: 6379 },
  ]);

  const cluster2 = new Cluster([
    { host: 'cluster2-node1', port: 6379 },
    { host: 'cluster2-node2', port: 6379 },
  ]);

  const cluster3 = new Cluster([
    { host: 'cluster3-node1', port: 6379 },
    { host: 'cluster3-node2', port: 6379 },
  ]);

  const adapters = [
    new IoredisAdapter(cluster1),
    new IoredisAdapter(cluster2),
    new IoredisAdapter(cluster3),
  ];

  const redlock = createRedlock({
    adapters,
    key: 'multi-cluster:resource',
    ttl: 30000,
    quorum: 2,
  });

  try {
    // Auto-extending distributed lock
    await redlock.using(async signal => {
      console.log('Multi-cluster distributed lock acquired');

      // Long-running operation with auto-extension
      for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 50));

        if (signal.aborted) {
          console.log('Lock lost - aborting operation');
          return;
        }
      }

      console.log('Operation completed successfully');
    });
  } finally {
    cluster1.disconnect();
    cluster2.disconnect();
    cluster3.disconnect();
  }
}

// ============================================================================
// APPROACH 4: Mixed Cluster and Standalone
// ============================================================================

async function mixedClusterAndStandalone(): Promise<void> {
  console.log('\n=== Mixed Cluster and Standalone ===\n');

  // Combine cluster with standalone instances for flexibility
  const cluster = new Cluster([
    { host: 'cluster-node1', port: 6379 },
    { host: 'cluster-node2', port: 6379 },
  ]);

  const standalone1 = new Redis({ host: 'standalone-1', port: 6379 });
  const standalone2 = createClient({ url: 'redis://standalone-2:6379' });

  await standalone2.connect();

  const adapters = [
    new IoredisAdapter(cluster),
    new IoredisAdapter(standalone1),
    new NodeRedisAdapter(standalone2),
  ];

  const redlock = createRedlock({
    adapters,
    key: 'mixed:resource',
    ttl: 30000,
    quorum: 2,
  });

  try {
    const handle = await redlock.acquire();
    console.log('Lock acquired across mixed infrastructure');

    await new Promise(resolve => setTimeout(resolve, 100));

    await redlock.release(handle);
    console.log('Lock released');
  } finally {
    cluster.disconnect();
    standalone1.disconnect();
    await standalone2.disconnect();
  }
}

// ============================================================================
// BATCH OPERATIONS ON CLUSTER (with hash tags)
// ============================================================================

async function batchLockingOnCluster(): Promise<void> {
  console.log('\n=== Batch Locking on Cluster (with hash tags) ===\n');

  // IMPORTANT: Batch operations require all keys to hash to the same slot.
  // Use hash tags {tag} to ensure related keys are co-located.

  const cluster = new Cluster([
    { host: 'redis-node-1', port: 6379 },
    { host: 'redis-node-2', port: 6379 },
    { host: 'redis-node-3', port: 6379 },
  ]);

  // IoredisAdapter accepts both Redis and Cluster types
  // Use with LockManager for batch operations:
  // const manager = new LockManager({ adapter: new IoredisAdapter(cluster) });
  // await manager.acquireBatch(keysWithHashTag);

  // These keys will ALL hash to the same slot because of {user:123}
  const keysWithHashTag = ['{user:123}:profile', '{user:123}:wallet', '{user:123}:settings'];

  console.log('Keys with hash tags:', keysWithHashTag);
  console.log('All keys hash to same slot due to {user:123} tag');

  // WRONG: These keys hash to different slots - will cause CROSSSLOT error
  // const keysWithoutHashTag = ['user:1:profile', 'user:2:wallet', 'user:3:settings'];

  // For batch operations without hash tags, use multiple independent instances
  // instead of Redis Cluster

  cluster.disconnect();
}

// ============================================================================
// DECISION GUIDE
// ============================================================================

function printDecisionGuide(): void {
  console.log(`
================================================================================
REDIS CLUSTER DECISION GUIDE
================================================================================

Choose your approach based on requirements:

+---------------------------+-------------------+------------------+------------+
| Approach                  | Fault Tolerance   | Complexity       | Use Case   |
+---------------------------+-------------------+------------------+------------+
| Single Redis Instance     | None              | Simplest         | Dev/Test   |
| Single Redis Cluster      | HA within cluster | Simple           | Most apps  |
| Multiple Redis Instances  | Cross-instance    | Moderate         | Critical   |
| Multiple Redis Clusters   | Maximum           | Complex          | Financial  |
+---------------------------+-------------------+------------------+------------+

Recommendations:
- Development/Testing: Single instance or MemoryAdapter
- Standard Production: Single Redis Cluster (simplicity + HA)
- Critical Systems: Multiple independent instances (true Redlock)
- Financial/Safety-Critical: Multiple independent clusters

BATCH OPERATIONS WARNING:
- Cluster mode requires all batch keys to hash to same slot
- Use hash tags like {user}:lock:1 and {user}:lock:2
- Or use standalone instances for unrestricted batch operations

Note: Redis Cluster uses eventual consistency during failover.
For safety-critical systems, prefer multiple independent instances.
================================================================================
`);
}

// Main
async function main(): Promise<void> {
  printDecisionGuide();

  console.log('Note: These examples require actual Redis Cluster setup.');
  console.log('See docker-compose.cluster.yml for local testing.\n');

  // Uncomment to run when Redis clusters are available:
  // await singleClusterWithIoredis();
  // await singleClusterWithNodeRedis();
  // await multipleIndependentInstances();
  // await multipleClusters();
  // await mixedClusterAndStandalone();
  // await batchLockingOnCluster();
}

// Export for use in other examples
export {
  singleClusterWithIoredis,
  singleClusterWithNodeRedis,
  multipleIndependentInstances,
  multipleClusters,
  mixedClusterAndStandalone,
  batchLockingOnCluster,
  printDecisionGuide,
};

// Run main if executed directly
main().catch(console.error);
