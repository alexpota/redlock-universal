// Examples showing how Redis adapter pattern should work

import { createClient as createNodeRedisClient } from 'redis';
import { Redis } from 'ioredis';
import { NodeRedisAdapter, IoredisAdapter } from 'redlock-universal';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const UNIQUE_VALUE = 'unique-value';

// Example 1: Using node-redis v4+ client
async function nodeRedisExample() {
  // User creates their Redis client
  const client = createNodeRedisClient({
    url: REDIS_URL,
  });
  await client.connect();

  // Our adapter wraps their client
  const adapter = new NodeRedisAdapter(client);

  // Unified interface regardless of client
  const result = await adapter.setNX('my-lock', UNIQUE_VALUE, 30000);
  console.log('Lock acquired:', result === 'OK');

  const value = await adapter.get('my-lock');
  console.log('Lock value:', value);

  const released = await adapter.delIfMatch('my-lock', UNIQUE_VALUE);
  console.log('Lock released:', released);

  await client.disconnect();
}

// Example 2: Using ioredis v5+ client
async function ioredisExample() {
  // User creates their Redis client
  const client = new Redis({
    host: 'localhost',
    port: 6379,
  });

  // Our adapter wraps their client
  const adapter = new IoredisAdapter(client);

  // Same unified interface
  const result = await adapter.setNX('my-lock', UNIQUE_VALUE, 30000);
  console.log('Lock acquired:', result === 'OK');

  const value = await adapter.get('my-lock');
  console.log('Lock value:', value);

  const released = await adapter.delIfMatch('my-lock', UNIQUE_VALUE);
  console.log('Lock released:', released);

  client.disconnect();
}

// Example 3: Universal factory function
async function universalExample() {
  // Works with either client type
  const nodeRedisClient = createNodeRedisClient({ url: REDIS_URL });
  await nodeRedisClient.connect();
  const ioredisClient = new Redis(REDIS_URL);

  const nodeAdapter = NodeRedisAdapter.from(nodeRedisClient);
  const ioAdapter = IoredisAdapter.from(ioredisClient);

  // Both adapters have identical interface
  const operations = [nodeAdapter, ioAdapter];

  for (const adapter of operations) {
    const lockAcquired = await adapter.setNX('test-lock', 'value', 5000);
    if (lockAcquired === 'OK') {
      await adapter.delIfMatch('test-lock', 'value');
    }
  }

  await nodeRedisClient.disconnect();
  ioredisClient.disconnect();
}

// Example 4: Error handling
async function errorHandlingExample() {
  const client = new Redis(REDIS_URL);
  const adapter = new IoredisAdapter(client);

  try {
    // Adapter should handle Redis errors gracefully
    await adapter.setNX('key', 'value', -1); // Invalid TTL
  } catch (error) {
    console.log('Validation error caught:', error instanceof Error ? error.message : String(error));
  }

  try {
    // Network errors should be propagated
    client.disconnect();
    await adapter.get('key');
  } catch (error) {
    console.log('Connection error caught:', error instanceof Error ? error.message : String(error));
  }
}

export { nodeRedisExample, ioredisExample, universalExample, errorHandlingExample };
