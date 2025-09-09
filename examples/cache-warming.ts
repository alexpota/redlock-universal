/**
 * Distributed Cache Warming Example
 *
 * This example demonstrates using RedLock for distributed cache warming
 * operations that need to run across multiple Redis instances with
 * automatic lock extension for long-running operations.
 */

import { createRedlock, NodeRedisAdapter } from 'redlock-universal';
import { createClient } from 'redis';

// Mock data source interfaces
interface DataSource {
  key: string;
  url: string;
  priority: number;
}

async function getDataSources(): Promise<DataSource[]> {
  // Simulate fetching data source configuration
  return [
    { key: 'users', url: 'https://api.example.com/users', priority: 1 },
    { key: 'products', url: 'https://api.example.com/products', priority: 2 },
    { key: 'orders', url: 'https://api.example.com/orders', priority: 3 },
    { key: 'analytics', url: 'https://api.example.com/analytics', priority: 4 },
  ];
}

async function fetchFromSource(source: DataSource): Promise<any[]> {
  // Simulate API call that takes ~30 seconds
  console.log(`🌐 Fetching data from ${source.key} (${source.url})`);

  // Simulate network delay and processing time
  await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds

  // Mock data
  return Array.from({ length: 1000 }, (_, i) => ({
    id: i,
    source: source.key,
    timestamp: Date.now(),
  }));
}

async function cacheData(key: string, data: any[]): Promise<void> {
  // Simulate caching operation
  console.log(`💾 Caching ${data.length} items for ${key}`);
  await new Promise(resolve => setTimeout(resolve, 2000)); // 2 seconds to cache
}

async function distributedCacheWarming() {
  // Setup multiple Redis clients for distributed locking
  const redis1 = createClient({ url: 'redis://localhost:6379' });
  const redis2 = createClient({ url: 'redis://localhost:6380' });
  const redis3 = createClient({ url: 'redis://localhost:6381' });

  await Promise.all([redis1.connect(), redis2.connect(), redis3.connect()]);

  // Create distributed lock
  const cacheWarmingLock = createRedlock({
    adapters: [
      new NodeRedisAdapter(redis1),
      new NodeRedisAdapter(redis2),
      new NodeRedisAdapter(redis3),
    ],
    key: 'cache-warming-job',
    ttl: 60000, // 1 minute initial TTL (will auto-extend)
    quorum: 2, // Need majority consensus
  });

  try {
    await cacheWarmingLock.using(async signal => {
      console.log('🔒 Distributed cache warming lock acquired');

      const dataSources = await getDataSources();
      const startTime = Date.now();

      console.log(`📊 Starting cache warming for ${dataSources.length} data sources`);

      for (const [index, source] of dataSources.entries()) {
        console.log(`\n[${index + 1}/${dataSources.length}] Processing ${source.key}...`);

        // Each source takes ~30 seconds - lock will auto-extend
        const data = await fetchFromSource(source);

        // Ensure we still have distributed consensus
        if (signal.aborted) {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          console.log(`⚠️  Cache warming stopped - quorum lost after ${elapsed}s`);
          console.log(`   Processed ${index}/${dataSources.length} sources`);

          if (signal.error) {
            console.log(`   Reason: ${signal.error.message}`);
          }

          return {
            status: 'aborted',
            processedSources: index,
            totalSources: dataSources.length,
            elapsedTime: elapsed,
          };
        }

        await cacheData(source.key, data);
        console.log(`✅ ${source.key} cached successfully`);
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`\n🎉 Cache warming completed in ${elapsed}s`);

      return {
        status: 'completed',
        processedSources: dataSources.length,
        totalSources: dataSources.length,
        elapsedTime: elapsed,
      };
    });
  } catch (error) {
    console.error('❌ Cache warming failed:', error);
  } finally {
    // Disconnect all clients
    await Promise.all([redis1.disconnect(), redis2.disconnect(), redis3.disconnect()]);
  }
}

// Run the example
if (require.main === module) {
  distributedCacheWarming()
    .then(() => console.log('Example completed'))
    .catch(console.error);
}

export { distributedCacheWarming };
