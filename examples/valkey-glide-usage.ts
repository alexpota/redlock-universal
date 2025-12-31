// Valkey GLIDE Adapter Usage Example
// Demonstrates using redlock-universal with Valkey's official GLIDE client

import { GlideClient, GlideClientConfiguration } from '@valkey/valkey-glide';
import { GlideAdapter, createLock } from '../src/index.js';
import { getValkeyHost, getValkeyPort } from '../tests/shared/constants.js';

const UNIQUE_VALUE = 'unique-value';

// Example 1: Basic GlideAdapter usage
async function basicGlideExample() {
  // Create GLIDE client (async, unlike node-redis/ioredis)
  const config: GlideClientConfiguration = {
    addresses: [{ host: getValkeyHost(), port: getValkeyPort() }],
  };
  const client = await GlideClient.createClient(config);

  // Wrap with adapter
  const adapter = new GlideAdapter(client);

  // Use unified interface
  const result = await adapter.setNX('my-lock', UNIQUE_VALUE, 30000);
  console.log('Lock acquired:', result === 'OK');

  const value = await adapter.get('my-lock');
  console.log('Lock value:', value);

  const released = await adapter.delIfMatch('my-lock', UNIQUE_VALUE);
  console.log('Lock released:', released);

  await adapter.disconnect();
}

// Example 2: Using createLock factory with GLIDE
async function factoryExample() {
  const config: GlideClientConfiguration = {
    addresses: [{ host: getValkeyHost(), port: getValkeyPort() }],
  };
  const client = await GlideClient.createClient(config);
  const adapter = new GlideAdapter(client);

  const lock = createLock({
    adapter,
    key: 'my-resource',
    ttl: 30000,
  });

  const handle = await lock.acquire();
  try {
    console.log('Lock acquired, doing work...');
  } finally {
    await lock.release(handle);
  }

  await adapter.disconnect();
}

// Example 3: Using the using() API with auto-extension
async function usingApiExample() {
  const config: GlideClientConfiguration = {
    addresses: [{ host: getValkeyHost(), port: getValkeyPort() }],
  };
  const client = await GlideClient.createClient(config);
  const adapter = new GlideAdapter(client);

  const lock = createLock({
    adapter,
    key: 'long-running-task',
    ttl: 5000, // 5 second TTL, auto-extended as needed
  });

  // Auto-extension and cleanup handled automatically
  const result = await lock.using(async signal => {
    // Check signal.aborted if extension fails
    if (signal.aborted) {
      throw new Error('Lock extension failed');
    }

    // Simulate long-running work
    console.log('Processing with auto-extension...');
    return 'completed';
  });

  console.log('Result:', result);
  await adapter.disconnect();
}

// Example 4: Factory method pattern
async function factoryMethodExample() {
  const config: GlideClientConfiguration = {
    addresses: [{ host: getValkeyHost(), port: getValkeyPort() }],
  };
  const client = await GlideClient.createClient(config);

  // Use static factory method
  const adapter = GlideAdapter.from(client);

  const lockAcquired = await adapter.setNX('test-lock', 'value', 5000);
  if (lockAcquired === 'OK') {
    await adapter.delIfMatch('test-lock', 'value');
    console.log('Factory method example completed');
  }

  await adapter.disconnect();
}

export { basicGlideExample, factoryExample, usingApiExample, factoryMethodExample };
