// Examples showing how Redis adapter pattern should work
// This file demonstrates the ideal API we want to achieve

import { createClient as createNodeRedisClient } from 'redis';
import Redis from 'ioredis';
import { NodeRedisAdapter, IoredisAdapter } from '../src/adapters/index.js';

// Example 1: Using node-redis v4+ client
async function nodeRedisExample() {
  // User creates their Redis client
  const client = createNodeRedisClient({
    url: 'redis://localhost:6379',
  });
  await client.connect();

  // Our adapter wraps their client
  const adapter = new NodeRedisAdapter(client);

  // Unified interface regardless of client
  const result = await adapter.setNX('my-lock', 'unique-value', 30000);
  console.log('Lock acquired:', result === 'OK');

  const value = await adapter.get('my-lock');
  console.log('Lock value:', value);

  const released = await adapter.delIfMatch('my-lock', 'unique-value');
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
  const result = await adapter.setNX('my-lock', 'unique-value', 30000);
  console.log('Lock acquired:', result === 'OK');

  const value = await adapter.get('my-lock');
  console.log('Lock value:', value);

  const released = await adapter.delIfMatch('my-lock', 'unique-value');
  console.log('Lock released:', released);

  client.disconnect();
}

// Example 3: Universal factory function
async function universalExample() {
  // Works with either client type
  const nodeRedisClient = createNodeRedisClient({ url: 'redis://localhost:6379' });
  const ioredisClient = new Redis('redis://localhost:6379');

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
}

// Example 4: Error handling
async function errorHandlingExample() {
  const client = new Redis('redis://localhost:6379');
  const adapter = new IoredisAdapter(client);

  try {
    // Adapter should handle Redis errors gracefully
    await adapter.setNX('key', 'value', -1); // Invalid TTL
  } catch (error) {
    console.log('Validation error caught:', error.message);
  }

  try {
    // Network errors should be propagated
    client.disconnect();
    await adapter.get('key');
  } catch (error) {
    console.log('Connection error caught:', error.message);
  }
}

export { nodeRedisExample, ioredisExample, universalExample, errorHandlingExample };
