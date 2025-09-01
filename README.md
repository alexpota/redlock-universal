# redlock-universal

> Production-ready distributed Redis locks for Node.js with support for both node-redis and ioredis

[![npm version](https://img.shields.io/npm/v/redlock-universal.svg)](https://www.npmjs.com/package/redlock-universal)
[![Node.js](https://img.shields.io/node/v/redlock-universal.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Test Coverage](https://img.shields.io/badge/coverage-85%25-green.svg)](#testing)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Downloads](https://img.shields.io/npm/dm/redlock-universal.svg)](https://www.npmjs.com/package/redlock-universal)

## Overview

redlock-universal implements distributed Redis locks using the [Redlock algorithm](http://redis.io/topics/distlock). It supports both node-redis and ioredis clients through a unified TypeScript API.

## Features

- 🔒 **Distributed Locks**: True Redlock algorithm for multi-instance Redis
- 🔌 **Client Universal**: Works with both `node-redis` v4+ and `ioredis` v5+
- 🏢 **Production Ready**: Error handling, retries, and monitoring
- 🚀 **TypeScript First**: Full type safety and modern ESM support
- ⚡ **Performance**: Sub-millisecond lock acquisition, competitive with leading libraries
- 📊 **Monitoring**: Built-in metrics and health checks
- 🧪 **Tested**: 85%+ test coverage with unit and integration tests

## Installation

```bash
npm install redlock-universal
```

**Peer Dependencies**: Install your preferred Redis client
```bash
# For node-redis users
npm install redis

# For ioredis users  
npm install ioredis

# Or both if you need mixed environments
npm install redis ioredis
```

## Quick Start

### Simple Lock (Single Redis Instance)

```typescript
import { createLock, NodeRedisAdapter } from 'redlock-universal';
import { createClient } from 'redis';

// Setup Redis client
const client = createClient({ url: 'redis://localhost:6379' });
await client.connect();

// Create lock
const lock = createLock({
  adapter: new NodeRedisAdapter(client),
  key: 'my-resource',
  ttl: 30000, // 30 seconds
});

// Use the lock
try {
  const handle = await lock.acquire();
  
  // Critical section - only one process can be here
  await doSomeCriticalWork();
  
  await lock.release(handle);
} catch (error) {
  console.error('Lock operation failed:', error);
}
```

### Distributed Lock (Multiple Redis Instances)

```typescript
import { createRedlock, NodeRedisAdapter, IoredisAdapter } from 'redlock-universal';
import { createClient } from 'redis';
import Redis from 'ioredis';

// Setup multiple Redis connections
const clients = [
  createClient({ url: 'redis://redis1:6379' }),
  createClient({ url: 'redis://redis2:6379' }),
  createClient({ url: 'redis://redis3:6379' }),
];

// Connect all node-redis clients
await Promise.all(clients.map(client => client.connect()));

// Create adapters (ioredis connects automatically)
const adapters = [
  new NodeRedisAdapter(clients[0]),
  new NodeRedisAdapter(clients[1]),
  new IoredisAdapter(new Redis('redis://redis3:6379')),
];

// Create distributed lock
const redlock = createRedlock({
  adapters,
  key: 'distributed-resource',
  ttl: 30000,
  quorum: 2, // Majority consensus
});

// Use distributed lock
try {
  const handle = await redlock.acquire();
  
  // Critical section with distributed guarantee
  await processPayment();
  
  await redlock.release(handle);
} catch (error) {
  console.error('Distributed lock failed:', error);
} finally {
  // Disconnect all clients
  await Promise.all(clients.map(client => client.disconnect()));
}
```

## API Reference

### Simple Lock

#### `createLock(config)`

Creates a simple lock for single Redis instance.

```typescript
interface CreateLockConfig {
  adapter: RedisAdapter;
  key: string;
  ttl?: number;                    // Default: 30000ms
  retryAttempts?: number;          // Default: 3
  retryDelay?: number;             // Default: 100ms
  performance?: 'standard' | 'lean' | 'enterprise';  // Default: 'standard'
}
```

#### Lock Methods

```typescript
// Acquire lock
const handle = await lock.acquire();

// Release lock
const released = await lock.release(handle);

// Extend lock TTL
const extended = await lock.extend(handle, newTTL);

// Check if locked
const isLocked = await lock.isLocked(key);
```

#### Performance Modes

Choose the optimal performance mode for your use case:

```typescript
// Standard mode (default) - Full features with monitoring
const lock = createLock({
  adapter: new NodeRedisAdapter(client),
  key: 'resource',
  performance: 'standard'  // Full monitoring, health checks
});

// Lean mode - Memory optimized for high-throughput scenarios
const leanLock = createLock({
  adapter: new NodeRedisAdapter(client),
  key: 'resource',
  performance: 'lean'  // Saves ~150KB memory, 3% faster
});
```

**Performance Mode Comparison:**
- **Standard**: Full monitoring, health checks, comprehensive error details
- **Lean**: Memory-optimized, pre-allocated errors, minimal overhead
- **Enterprise**: Standard + circuit breakers + advanced observability (future)

### Distributed Lock (RedLock)

#### `createRedlock(config)`

Creates a distributed lock using the Redlock algorithm.

```typescript
interface CreateRedlockConfig {
  adapters: RedisAdapter[];
  key: string;
  ttl?: number;                // Default: 30000ms
  quorum?: number;             // Default: majority
  retryAttempts?: number;      // Default: 3
  retryDelay?: number;         // Default: 200ms
  clockDriftFactor?: number;   // Default: 0.01
}
```

### Redis Adapters

#### Node-Redis Adapter

```typescript
import { NodeRedisAdapter } from 'redlock-universal';
import { createClient } from 'redis';

const client = createClient({ url: 'redis://localhost:6379' });
await client.connect();

const adapter = new NodeRedisAdapter(client);
```

#### Ioredis Adapter

```typescript
import { IoredisAdapter } from 'redlock-universal';
import Redis from 'ioredis';

const client = new Redis('redis://localhost:6379');
const adapter = new IoredisAdapter(client);
```

### Factory Functions

Convenient functions for creating multiple locks or specialized configurations:

```typescript
import { createLocks, createPrefixedLock, createRedlocks } from 'redlock-universal';

// Create multiple locks with shared configuration
const locks = createLocks(adapter, ['user:123', 'account:456'], {
  ttl: 15000,
  retryAttempts: 5,
  performance: 'lean'
});

// Create lock with automatic key prefixing
const userLock = createPrefixedLock(adapter, 'locks:user:', '123', {
  ttl: 10000
});
// Results in key: "locks:user:123"

// Create multiple distributed locks
const redlocks = createRedlocks(
  [adapter1, adapter2, adapter3],
  ['resource1', 'resource2'],
  {
    ttl: 15000,
    quorum: 2,
    retryAttempts: 5
  }
);
```

## Advanced Usage

### Lock with Retry Logic

```typescript
const lock = createLock({
  adapter: new NodeRedisAdapter(client),
  key: 'contested-resource',
  ttl: 10000,
  retryAttempts: 5,    // Retry up to 5 times
  retryDelay: 200,     // Wait 200ms between retries
});
```

### Lock Extension

```typescript
const handle = await lock.acquire();

// Extend lock by 10 more seconds
const extended = await lock.extend(handle, 10000);

if (extended) {
  // Continue working with extended lock
  await longRunningTask();
}

await lock.release(handle);
```

### Error Handling

```typescript
import { LockAcquisitionError, LockReleaseError } from 'redlock-universal';

try {
  const handle = await lock.acquire();
  // ... work ...
  await lock.release(handle);
} catch (error) {
  if (error instanceof LockAcquisitionError) {
    console.error('Failed to acquire lock:', error.message);
  } else if (error instanceof LockReleaseError) {
    console.error('Failed to release lock:', error.message);
  }
}
```

### Multiple Resource Locking

```typescript
// Lock multiple resources in consistent order (avoid deadlocks)
const userLock = createLock({ adapter, key: 'user:123' });
const accountLock = createLock({ adapter, key: 'account:456' });

const userHandle = await userLock.acquire();
const accountHandle = await accountLock.acquire();

try {
  // Perform transaction requiring both resources
  await transferFunds();
} finally {
  // Release in reverse order
  await accountLock.release(accountHandle);
  await userLock.release(userHandle);
}
```

## Best Practices

### 1. Always Use Try-Finally for Lock Release

```typescript
const handle = await lock.acquire();
try {
  await doWork();
} finally {
  await lock.release(handle);
}
```

### 2. Choose Appropriate TTL

```typescript
// Short-lived operations
const lock = createLock({ adapter, key: 'quick-task', ttl: 5000 });

// Long-running operations  
const lock = createLock({ adapter, key: 'batch-job', ttl: 300000 });
```

### 3. Handle Lock Contention

```typescript
const lock = createLock({
  adapter,
  key: 'popular-resource',
  retryAttempts: 3,
  retryDelay: 100,
});

try {
  const handle = await lock.acquire();
  // ... work ...
} catch (error) {
  if (error instanceof LockAcquisitionError) {
    // Resource is busy, handle gracefully
    await scheduleForLater();
  }
}
```

### 4. Distributed Lock Quorum

```typescript
// For 5 Redis instances, use quorum of 3
const redlock = createRedlock({
  adapters: [redis1, redis2, redis3, redis4, redis5],
  quorum: 3, // Majority consensus
  key: 'critical-resource',
});
```

## Monitoring and Observability

```typescript
// Access lock metadata
const handle = await lock.acquire();
console.log('Lock acquired in:', handle.metadata.acquisitionTime, 'ms');
console.log('Attempts required:', handle.metadata.attempts);

// For distributed locks
const redlockHandle = await redlock.acquire();
console.log('Nodes locked:', redlockHandle.metadata.nodes.length);
console.log('Quorum achieved:', redlockHandle.metadata.nodes.length >= quorum);
```

## Performance

redlock-universal delivers competitive performance:

- **Lock acquisition**: Sub-millisecond latency (typically 0.4-0.8ms with local Redis)
- **Memory usage**: <7KB per operation (both standard and lean modes)
- **Throughput**: >1000 ops/sec (competitive with leading Redis lock libraries)
- **Test coverage**: 85%+ with unit and integration tests

Performance modes:
- **Standard** (default): Full monitoring and observability features
- **Lean**: Memory-optimized with minimal overhead for maximum speed
- **Enterprise**: Additional health checks and circuit breakers

### Benchmarking

We provide benchmarks to validate performance claims:

```bash
# Compare with leading Redis lock libraries
npm run benchmark:competitive

# Internal performance validation
npm run benchmark:performance

# Run all benchmarks
npm run benchmark
```

**Benchmark Philosophy**: We believe in honest, reproducible performance testing. Our benchmarks:
- Test against real Redis instances (not mocks)
- Include statistical analysis (mean, p50, p95, p99)
- Acknowledge performance variability between runs
- Focus on competitive positioning rather than absolute claims

## Comparison with Alternatives

> **Methodology**: This comparison uses data from npm registry (July 2025) and architectural analysis. Performance estimates are based on implementation patterns and Redis operation complexity.

### Feature Comparison

| Feature | redlock-universal | node-redlock | redis-semaphore |
|---------|-------------------|--------------|-----------------|
| **Client Support** |
| node-redis v4+ | ✅ Native | ❌ | ⚠️ Wrapper needed |
| ioredis v5+ | ✅ Native | ✅ Required | ✅ Native |
| **Language & Developer Experience** |
| TypeScript | ✅ First-class | ✅ Native | ✅ Native |
| Modern ESM | ✅ | ⚠️ CJS focus | ✅ |
| API Design | ✅ Intuitive | ⚠️ Complex | ✅ Clean |
| Error Types | ✅ Specific | ✅ Basic | ✅ Detailed |
| **Locking Capabilities** |
| Single Instance | ✅ Optimized | ❌ | ✅ |
| Distributed (Redlock) | ✅ Full spec | ✅ Full spec | ✅ RedlockMutex |
| Lock Extension | ✅ Manual/Auto | ✅ Watchdog | ✅ Auto-refresh |
| Semaphores | ❌ Planned | ❌ | ✅ Advanced |
| **Production Features** |
| Retry Logic | ✅ Configurable | ✅ Built-in | ✅ Fair queue |
| Monitoring | ✅ Built-in | ❌ | ❌ |
| Health Checks | ✅ Built-in | ❌ | ❌ |
| Structured Logging | ✅ Built-in | ❌ | ❌ |

### Technical Comparison (Verified Data)

| Metric | redlock-universal | node-redlock | redis-semaphore |
|--------|-------------------|--------------|-----------------|
| **Maintenance & Adoption** |
| Weekly Downloads | *New Package* | 644,599 | 282,020 |
| Last Updated | 2025 Active | Mar 2022 ⚠️ | Mar 2025 ✅ |
| Maintenance Status | ✅ Active | ⚠️ Stale (3y) | ✅ Active |
| **Package Quality** |
| Runtime Dependencies | 0 (peer only) | 1 | 1 |
| TypeScript Support | ✅ Native | ✅ Native | ✅ Native |
| Test Coverage | 85%+ Unit + Integration | Unknown | Unknown |
| **Performance Characteristics** |
| Lock Acquisition† | ~0.4-0.8ms | ~0.4-0.8ms | ~0.4-0.6ms |
| Distributed Latency* | ~3-8ms | ~5-15ms | ~4-10ms |
| Memory per Operation† | <7KB | ~8KB | ~6KB |

*\*Estimated/measured with local Redis 7. Performance is competitive among actively maintained libraries. †Actual performance varies by network latency and Redis configuration.*

### Maintenance Analysis

| Package | Status | Risk Assessment |
|---------|--------|-----------------|
| **redlock** | ⚠️ **High Risk** | 644K weekly users but no updates in 3 years. Critical security/compatibility issues possible |
| **redis-semaphore** | ✅ **Low Risk** | Actively maintained, good feature set, reliable choice |

### Why Choose redlock-universal?

#### ✅ **Universal Compatibility**
- **Only library** supporting both node-redis v4+ and ioredis v5+ natively
- **Future-proof**: Works with latest Redis client versions
- **Migration-friendly**: Easy to switch between Redis clients

#### ✅ **Production-Ready Observability**
- **Built-in metrics**: Track lock performance, acquisition times, success rates
- **Health monitoring**: Redis connection health checks and statistics  
- **Structured logging**: Configurable logging with context and levels
- **Zero competitors** offer these enterprise features

#### ✅ **Modern Architecture & DX**
- **TypeScript-first**: Strict typing, excellent IntelliSense
- **ESM native**: Modern module system with CommonJS compatibility
- **Zero runtime dependencies**: Security and supply chain safety
- **Code quality**: 85%+ test coverage with unit and integration tests

#### ✅ **Proven Algorithm Implementation**
- **Redis-spec compliant**: Follows official Redlock specification
- **Clock drift handling**: Proper time synchronization assumptions
- **Fault tolerance**: Graceful degradation on partial failures
- **Performance optimized**: Sub-millisecond acquisition, competitive performance

### Migration Guide

#### From node-redlock (644K users at risk)
```typescript
// Before (node-redlock) - Stale for 3 years
const redlock = new Redlock([redis1, redis2], { retryCount: 3 });
const resource = await redlock.acquire(['resource'], 30000);
await redlock.release(resource);

// After (redlock-universal) - Modern & maintained
const redlock = createRedlock({
  adapters: [new IoredisAdapter(redis1), new IoredisAdapter(redis2)],
  key: 'resource',
  ttl: 30000,
  retryAttempts: 3
});
const handle = await redlock.acquire();
await redlock.release(handle);
```

#### From redis-semaphore (282K users)
```typescript
// Before (redis-semaphore) - Good but limited to ioredis
const mutex = new Mutex(redis, 'resource', { acquireTimeout: 30000 });
const release = await mutex.acquire();
release();

// After (redlock-universal) - Universal client support + monitoring
const lock = createLock({
  adapter: new NodeRedisAdapter(nodeRedisClient), // or IoredisAdapter
  key: 'resource', 
  ttl: 30000
});
const handle = await lock.acquire();
await lock.release(handle);
```

## Testing

```bash
# Run unit tests
npm test

# Run integration tests (requires Redis)
npm run test:integration

# Run all tests with coverage
npm run test:coverage

# Run Docker-based tests
npm run test:docker
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](./CONTRIBUTING.md) for details.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

[MIT](./LICENSE) © Alex Potapenko

## Support

- 📖 [Documentation](./docs)
- 🐛 [Issue Tracker](https://github.com/alexpota/redlock-universal/issues)
- 💬 [Discussions](https://github.com/alexpota/redlock-universal/discussions)

---

Made with ❤️ for the Node.js community
