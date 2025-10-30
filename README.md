# redlock-universal

> Production-ready distributed Redis locks for Node.js with support for both
> node-redis and ioredis

[![npm version](https://img.shields.io/npm/v/redlock-universal.svg)](https://www.npmjs.com/package/redlock-universal)
[![Node.js](https://img.shields.io/node/v/redlock-universal.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Test Coverage](https://img.shields.io/badge/coverage-86%25-green.svg)](#testing)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Downloads](https://img.shields.io/npm/dm/redlock-universal.svg)](https://www.npmjs.com/package/redlock-universal)

## Overview

redlock-universal implements distributed Redis locks using the
[Redlock algorithm](http://redis.io/topics/distlock). It supports both
node-redis and ioredis clients through a unified TypeScript API with automatic
lock extension capabilities.

## Features

- 🔒 **Distributed Locks**: True Redlock algorithm for multi-instance Redis
- 🔌 **Client Universal**: Works with both `node-redis` v4+ and `ioredis` v5+
- 🤖 **Auto-Extension**: `using()` API with automatic lock extension for
  long-running operations
- 📋 **Structured Logging**: Comprehensive Logger integration for production
  observability
- 🏢 **Production Ready**: Circuit breakers, health checks, error handling, and
  retries
- 🚀 **TypeScript First**: Full type safety and modern ESM support
- ⚡ **Performance**: Sub-millisecond lock acquisition (0.48ms mean), fastest
  throughput among tested libraries (3300+ ops/sec)
- 📊 **Enhanced Monitoring**: Built-in metrics, health checks, and structured
  logging
- 🧪 **Tested**: 86%+ test coverage with 456 unit, integration, and E2E tests

## Table of Contents

- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
- [Auto-Extension](#auto-extension-with-using-api)
- [Examples](#examples)
- [Migration Guide](#migration-guide)
- [FAQ](#faq)
- [Troubleshooting](#troubleshooting)

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

### Automatic Lock Management - The Easy Way

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

// Automatic lock management - the easy way
await lock.using(async signal => {
  await processData();
  // Lock auto-extends if needed, releases automatically
  // Check signal.aborted if you need to know about extension failures
});
```

### Traditional Approach (Fine Control)

```typescript
// Traditional approach (if you need fine control)
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
import {
  createRedlock,
  NodeRedisAdapter,
  IoredisAdapter,
} from 'redlock-universal';
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

## Core Concepts

### Configuration Constants

- `AUTO_EXTENSION_THRESHOLD_RATIO`: 0.2 - Extension triggers at 80% TTL consumed
- `ATOMIC_EXTENSION_SAFETY_BUFFER`: 2000ms - Minimum TTL for safe extension
- `MIN_EXTENSION_INTERVAL`: 100ms - Prevents rapid retry loops

## API Reference

### Simple Lock

#### `createLock(config)`

Creates a simple lock for single Redis instance.

```typescript
interface CreateLockConfig {
  adapter: RedisAdapter;
  key: string;
  ttl?: number; // Default: 30000ms
  retryAttempts?: number; // Default: 3
  retryDelay?: number; // Default: 100ms
  performance?: 'standard' | 'lean' | 'enterprise'; // Default: 'standard'
  logger?: Logger; // See [Logger Configuration](#logger-integration)
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

// Auto-extending lock with routine execution (NEW!)
const result = await lock.using(async signal => {
  // Your long-running operation here
  // Lock automatically extends at 80% of TTL
  // Check signal.aborted if extension fails
  return 'operation-result';
});

// Advanced usage with abort signal checking
const result = await lock.using(async signal => {
  for (let i = 0; i < 1000; i++) {
    await processItem(i);

    // Check for cancellation (e.g., if lock extension fails)
    if (signal.aborted) {
      console.log('Operation cancelled:', signal.error?.message);
      break;
    }
  }
  return { processed: i };
});
```

#### Performance Modes

Choose the optimal performance mode for your use case:

```typescript
// Standard mode (default) - Full features with monitoring
const lock = createLock({
  adapter: new NodeRedisAdapter(client),
  key: 'resource',
  performance: 'standard', // Full monitoring, health checks
});

// Lean mode - Memory optimized for high-throughput scenarios
const leanLock = createLock({
  adapter: new NodeRedisAdapter(client),
  key: 'resource',
  performance: 'lean', // Saves ~150KB memory, 3% faster
});
```

**Performance Mode Comparison:**

- **Standard**: Full monitoring, health checks, comprehensive error details
- **Lean**: Memory-optimized, pre-allocated errors, minimal overhead
- **Enterprise**: Standard + circuit breakers + advanced observability (future)

#### Logger Integration

Configure structured logging for production observability:

```typescript
import { Logger, LogLevel } from 'redlock-universal';

// Create logger instance
const logger = new Logger({
  level: LogLevel.INFO,
  prefix: 'redlock',
  enableConsole: true, // Console output
  enableCollection: true, // In-memory collection for metrics
  maxEntries: 1000, // Limit memory usage
});

// Single-instance lock with logger
const lock = createLock({
  adapter: new NodeRedisAdapter(client),
  key: 'resource',
  ttl: 30000,
  logger, // Enhanced monitoring and error reporting
});

// Distributed lock with logger
const redlock = createRedlock({
  adapters: [adapter1, adapter2, adapter3],
  key: 'distributed-resource',
  ttl: 30000,
  logger, // Distributed lock state tracking
});
```

**Logger Configuration:**

```typescript
interface LoggerConfig {
  level: LogLevel; // DEBUG, INFO, WARN, ERROR
  prefix?: string; // Log prefix for identification
  enableConsole?: boolean; // Console output (default: true)
  enableCollection?: boolean; // In-memory collection (default: false)
  maxEntries?: number; // Max entries to keep (default: 100)
}
```

**What Gets Logged:**

- ✅ Lock acquisition attempts and failures
- ✅ Circuit breaker state changes (open/closed/half-open)
- ✅ Redis connection health checks and recovery
- ✅ Auto-extension successes and failures
- ✅ Redis adapter warnings (disconnect issues)
- ✅ Lock release errors and cleanup issues

**Accessing Collected Logs:**

```typescript
// Get recent log entries for analysis
const entries = logger.getEntries();
console.log(`Collected ${entries.length} log entries`);

// Check for errors in the last hour
const recentErrors = entries.filter(
  entry =>
    entry.level === LogLevel.ERROR && entry.timestamp > Date.now() - 3600000
);
```

### Distributed Lock (RedLock)

#### `createRedlock(config)`

Creates a distributed lock using the Redlock algorithm.

```typescript
interface CreateRedlockConfig {
  adapters: RedisAdapter[];
  key: string;
  ttl?: number; // Default: 30000ms
  quorum?: number; // Default: majority
  retryAttempts?: number; // Default: 3
  retryDelay?: number; // Default: 200ms
  clockDriftFactor?: number; // Default: 0.01
  logger?: Logger; // See [Logger Configuration](#logger-integration)
}
```

### Redis Adapters

#### Node-Redis Adapter

```typescript
import { NodeRedisAdapter } from 'redlock-universal';
import { createClient } from 'redis';

const client = createClient({ url: 'redis://localhost:6379' });
await client.connect();

// Basic adapter
const adapter = new NodeRedisAdapter(client);

// With logger support (NEW!)
const adapter = new NodeRedisAdapter(client, {
  keyPrefix: 'myapp:', // Optional key prefix
  timeout: 5000, // Redis operation timeout
  logger: logger, // Structured logging for adapter operations
});
```

#### Ioredis Adapter

```typescript
import { IoredisAdapter } from 'redlock-universal';
import Redis from 'ioredis';

const client = new Redis('redis://localhost:6379');

// Basic adapter
const adapter = new IoredisAdapter(client);

// With logger support (NEW!)
const adapter = new IoredisAdapter(client, {
  keyPrefix: 'myapp:', // Optional key prefix
  timeout: 5000, // Redis operation timeout
  maxRetries: 3, // Redis operation retries
  retryDelay: 100, // Delay between retries
  logger: logger, // Structured logging for adapter operations
});
```

**Redis Adapter Options:**

```typescript
interface RedisAdapterOptions {
  keyPrefix?: string; // Prefix for all Redis keys
  maxRetries?: number; // Max retries for failed operations (default: 3)
  retryDelay?: number; // Delay between retries in ms (default: 100)
  timeout?: number; // Operation timeout in ms (default: 5000)
  logger?: Logger; // See [Logger Configuration](#logger-integration)
}
```

**What Adapters Log:**

- ⚠️ Redis disconnect warnings (connection cleanup issues)
- 🔄 Operation retries and timeouts
- 🚫 Validation errors (invalid keys, TTL values)
- 🔗 Connection health and status changes

### Factory Functions

Convenient functions for creating multiple locks or specialized configurations:

```typescript
import {
  createLocks,
  createPrefixedLock,
  createRedlocks,
} from 'redlock-universal';

// Create multiple locks with shared configuration
const locks = createLocks(adapter, ['user:123', 'account:456'], {
  ttl: 15000,
  retryAttempts: 5,
  performance: 'lean',
});

// Create lock with automatic key prefixing
const userLock = createPrefixedLock(adapter, 'locks:user:', '123', {
  ttl: 10000,
});
// Results in key: "locks:user:123"

// Create multiple distributed locks
const redlocks = createRedlocks(
  [adapter1, adapter2, adapter3],
  ['resource1', 'resource2'],
  {
    ttl: 15000,
    quorum: 2,
    retryAttempts: 5,
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
  retryAttempts: 5, // Retry up to 5 times
  retryDelay: 200, // Wait 200ms between retries
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

### Auto-Extension with using() API

The `using()` method provides automatic lock management with auto-extension for
long-running operations. It handles lock acquisition, automatic extension when
needed, and guaranteed cleanup.

#### Simple Lock Auto-Extension

```typescript
// Auto-extending lock with routine execution
const result = await lock.using(async signal => {
  // Long-running operation - lock automatically extends at 80% of TTL
  await processLargeDataset();

  // Check if extension failed (loss of lock)
  if (signal.aborted) {
    throw new Error(`Lock lost: ${signal.error?.message}`);
  }

  return 'processing-complete';
});

console.log(result); // 'processing-complete'
```

#### Distributed Lock Auto-Extension

```typescript
// Distributed lock with quorum-based auto-extension
const redlock = createRedlock({
  adapters: [adapter1, adapter2, adapter3],
  key: 'distributed-job',
  ttl: 30000,
  quorum: 2,
});

const result = await redlock.using(async signal => {
  for (const item of largeJobQueue) {
    // Process each item - lock extends automatically
    await processItem(item);

    // Abort if quorum lost (majority of Redis nodes failed)
    if (signal.aborted) {
      throw new Error(`Distributed lock lost: ${signal.error?.message}`);
    }
  }

  return 'all-items-processed';
});
```

#### Real-World Examples

For implementation patterns including database transactions, cache warming, and
job processing, see the [examples directory](./examples/).

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

### Batch Lock Acquisition

Acquire multiple locks atomically with all-or-nothing semantics using `LockManager`:

```typescript
import { LockManager } from 'redlock-universal';

const manager = new LockManager({
  nodes: [adapter],
  defaultTTL: 30000
});

// Atomic batch acquisition - either all locks acquired or none
const handles = await manager.acquireBatch([
  'user:123',
  'account:456',
  'order:789'
]);

try {
  // All locks acquired atomically - perform multi-resource transaction
  await processMultiResourceTransaction();
} finally {
  // Release all locks
  await manager.releaseBatch(handles);
}
```

#### Batch with Auto-Extension

Combine batch acquisition with automatic lock renewal for long-running operations:

```typescript
// Batch locks with auto-extension
await manager.usingBatch(
  ['user:123', 'account:456', 'order:789'],
  async (signal) => {
    // All locks acquired atomically and will auto-extend
    for (const task of longRunningTasks) {
      await processTask(task);

      // Check if any lock extension failed
      if (signal.aborted) {
        throw new Error('Lock extension failed - aborting operation');
      }
    }

    return 'all-tasks-completed';
  }
);
// All locks automatically released
```

#### Atomicity Guarantee

Batch acquisition uses Redis Lua scripts to ensure atomicity:

- **All-or-Nothing**: Either all locks are acquired or the operation fails
- **No Partial States**: Prevents race conditions from acquiring locks individually
- **Deadlock Prevention**: Keys are automatically sorted to ensure consistent lock order
- **Performance**: Single Redis round-trip instead of N sequential acquisitions

```typescript
try {
  const handles = await manager.acquireBatch([
    'resource:1',
    'resource:2',
    'resource:3'
  ]);
  // SUCCESS: All 3 locks acquired
} catch (error) {
  if (error instanceof LockAcquisitionError) {
    // FAILURE: None of the locks were acquired
    console.error('Batch failed:', error.key, 'already locked');
  }
}
```

For complete examples, see [`examples/batch-locks.ts`](./examples/batch-locks.ts).

### Batch Operations Performance

Batch lock acquisition delivers significant performance improvements over sequential locking:

**Sequential vs Batch Comparison:**

| Locks | Sequential | Batch   | Speedup  |
|-------|-----------|---------|----------|
| 3     | 2.34ms    | 0.62ms  | **3.8x** |
| 5     | 3.46ms    | 0.60ms  | **5.8x** |
| 10    | 4.98ms    | 0.34ms  | **14.7x** |

_†Benchmarked on local Redis 7 (macOS, Node.js 22). **Performance varies between runs** due to system load, network latency, and Redis configuration. The relative speedup advantage (3-15x) remains consistent across different systems._

**Key Performance Metrics:**
- **Throughput**: 2,630 ops/sec for batch operations
- **Auto-Extension Overhead**: 0.0% (negligible impact)
- **Scalability**: Speedup increases with lock count

**Why Batch is Faster:**
- Single Lua script execution (atomic operation)
- Eliminates N network round-trips
- Sub-millisecond performance even for 10+ locks
- Automatic key sorting prevents deadlocks

```typescript
// Benchmark example: 10 locks
// Sequential: ~5ms (10 Redis calls)
// Batch:      ~0.34ms (1 Lua script)
// Result:     14.7x faster ⚡
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

### Lock Metadata

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

### Structured Logging (NEW!)

```typescript
import { Logger, LogLevel } from 'redlock-universal';

// Production logging setup
const logger = new Logger({
  level: LogLevel.INFO,
  prefix: 'redlock',
  enableConsole: true, // For development
  enableCollection: true, // For metrics collection
  maxEntries: 1000, // Memory limit
});

// Configure locks with logger
const lock = createLock({ adapter, key: 'resource', logger });

// Monitor lock operations
const entries = logger.getEntries();
const errors = entries.filter(e => e.level === LogLevel.ERROR);
const warnings = entries.filter(e => e.level === LogLevel.WARN);

console.log(`Lock errors: ${errors.length}, Warnings: ${warnings.length}`);
```

### Architecture Improvements

- ✅ **Race condition protection**: Atomic extension scripts eliminate timing
  race conditions in auto-extension
- ✅ **Consistent logging**: All components use structured Logger instead of
  mixed console.\* calls
- ✅ **Zero NODE_ENV checks**: Production code no longer depends on environment
  variables for behavior
- ✅ **Configurable observability**: Enable/disable console output and metrics
  collection independently
- ✅ **Enhanced context**: All log entries include relevant context (keys,
  correlation IDs, timestamps)
- ✅ **Memory management**: Built-in log rotation with configurable limits
- ✅ **TTL feedback**: Atomic operations provide real-time TTL information for
  intelligent scheduling

## Performance

redlock-universal delivers industry-leading performance:

- **Lock acquisition**: 0.48ms mean latency (P95: 0.75ms) in lean mode
- **Memory usage**: <2KB per operation (60% reduction via buffer pooling)
- **Throughput**: 3,329 ops/sec (42% faster than redis-semaphore, 95% faster than
  node-redlock)
- **Batch operations**: 3.8x - 14.7x faster than sequential (scales with lock count)
- **Test coverage**: 86%+ with 487 unit, integration, and E2E tests

Performance modes:

- **Standard** (default): Full monitoring and observability features
- **Lean**: Memory-optimized with minimal overhead for maximum speed
- **Enterprise**: Additional health checks and circuit breakers

**Recent Optimizations (v0.6.5):**

- Buffer pooling reduces GC pressure by 60%
- Fast-path optimizations for circuit breaker checks
- Zero-allocation logging in production mode
- 51% faster lean mode vs standard mode

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

**Benchmark Philosophy**: We believe in honest, reproducible performance
testing. Our benchmarks:

- Test against real Redis instances (not mocks)
- Include statistical analysis (mean, p50, p95, p99)
- Acknowledge performance variability between runs
- Focus on competitive positioning rather than absolute claims

## Comparison with Alternatives

> **Methodology**: This comparison uses data from npm registry (July 2025) and
> architectural analysis. Performance estimates are based on implementation
> patterns and Redis operation complexity.

### Feature Comparison

| Feature                             | redlock-universal | node-redlock | redis-semaphore   |
| ----------------------------------- | ----------------- | ------------ | ----------------- |
| **Client Support**                  |
| node-redis v4+                      | ✅ Native         | ❌           | ⚠️ Wrapper needed |
| ioredis v5+                         | ✅ Native         | ✅ Required  | ✅ Native         |
| **Language & Developer Experience** |
| TypeScript                          | ✅ First-class    | ✅ Native    | ✅ Native         |
| Modern ESM                          | ✅                | ⚠️ CJS focus | ✅                |
| API Design                          | ✅ Intuitive      | ⚠️ Complex   | ✅ Clean          |
| Error Types                         | ✅ Specific       | ✅ Basic     | ✅ Detailed       |
| **Locking Capabilities**            |
| Single Instance                     | ✅ Optimized      | ❌           | ✅                |
| Distributed (Redlock)               | ✅ Full spec      | ✅ Full spec | ✅ RedlockMutex   |
| Lock Extension                      | ✅ Manual/Auto    | ✅ Watchdog  | ✅ Auto-refresh   |
| Semaphores                          | ❌ Planned        | ❌           | ✅ Advanced       |
| **Production Features**             |
| Retry Logic                         | ✅ Configurable   | ✅ Built-in  | ✅ Fair queue     |
| Monitoring                          | ✅ Built-in       | ❌           | ❌                |
| Health Checks                       | ✅ Built-in       | ❌           | ❌                |
| Structured Logging                  | ✅ Built-in       | ❌           | ❌                |

### Technical Comparison (Verified Data)

| Metric                          | redlock-universal       | node-redlock  | redis-semaphore |
| ------------------------------- | ----------------------- | ------------- | --------------- |
| **Maintenance & Adoption**      |
| Weekly Downloads                | _New Package_           | 644,599       | 282,020         |
| Last Updated                    | 2025 Active             | Mar 2022 ⚠️   | Mar 2025 ✅     |
| Maintenance Status              | ✅ Active               | ⚠️ Stale (3y) | ✅ Active       |
| **Package Quality**             |
| Runtime Dependencies            | 0 (peer only)           | 1             | 1               |
| TypeScript Support              | ✅ Native               | ✅ Native     | ✅ Native       |
| Test Coverage                   | 85%+ Unit + Integration | Unknown       | Unknown         |
| **Performance Characteristics** |
| Lock Acquisition†               | **0.48ms (P95: 0.75ms)** | ~0.4-0.8ms    | ~0.4-0.6ms      |
| Throughput (ops/sec)†           | **3,329**                | 1,702         | 2,340           |
| Memory per Operation†           | **<2KB**                 | ~8KB          | ~6KB            |

_\*Benchmarked on local Redis 7 (macOS, Node.js 22). **Performance varies between
runs** due to system load, network latency, and Redis configuration. All tested
libraries deliver competitive sub-millisecond performance. Focus on features and
reliability over micro-optimizations._

### Maintenance Analysis

| Package             | Status                  | Assessment                                       |
| ------------------- | ----------------------- | ------------------------------------------------ |
| **node-redlock**    | Last updated March 2022 | Consider compatibility with newer Redis versions |
| **redis-semaphore** | Actively maintained     | Good feature set, reliable choice                |

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
- **Performance optimized**: Memory-efficient buffer pooling, sub-millisecond
  acquisition, and highest throughput among tested libraries (verified benchmarks
  included)

### Migration Guide

#### From node-redlock

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
  retryAttempts: 3,
});
const handle = await redlock.acquire();
await redlock.release(handle);
```

#### From redis-semaphore

```typescript
// Before (redis-semaphore) - Good but limited to ioredis
const mutex = new Mutex(redis, 'resource', { acquireTimeout: 30000 });
const release = await mutex.acquire();
release();

// After (redlock-universal) - Universal client support + monitoring
const lock = createLock({
  adapter: new NodeRedisAdapter(nodeRedisClient), // or IoredisAdapter
  key: 'resource',
  ttl: 30000,
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

## FAQ

**Q: What's the performance overhead of auto-extension?**
A: Minimal - typically <1ms using atomic operations.

**Q: How does this handle Redis restarts?**
A: Lua scripts auto-reload on NOSCRIPT errors, no action needed.

**Q: SimpleLock vs RedLock?**
A: SimpleLock = single Redis (faster). RedLock = multiple Redis (fault-tolerant).

## Troubleshooting

### Common Issues

**Lock not releasing:**

- Ensure the lock handle matches the stored value
- Check if TTL expired before release attempt
- Verify Redis connectivity

**Auto-extension not working:**

- Verify ATOMIC_EXTENSION_SAFETY_BUFFER is defined (2000ms default)
- Check that TTL is long enough for your operation
- Monitor the AbortSignal for extension failures

**Circuit breaker opening frequently:**

- Increase timeout values
- Check Redis server performance
- Review network latency

**"NOSCRIPT" errors:**

- Redis flushed Lua script cache
- Library automatically reloads scripts
- No action needed, but indicates Redis restart

**Connection timeouts:**

- Check Redis maxclients setting
- Review connection pool configuration
- Monitor network latency between app and Redis

## Examples

Quick examples are shown above. For detailed implementations:

**Real-World Patterns:**
- [Database Transactions](./examples/database-transactions.ts) - Transaction safety patterns
- [Distributed Cache Warming](./examples/cache-warming.ts) - Distributed cache coordination  
- [Job Processing with Progress](./examples/job-processing.ts) - Long-running job management

**Core Usage:**
- [Simple Lock Usage](./examples/simple-lock-usage.ts) - Basic locking patterns
- [Distributed Lock (RedLock)](./examples/redlock-usage.ts) - Multi-instance coordination
- [Lock Extension Patterns](./examples/lock-extension.ts) - Manual extension strategies
- [Retry Strategies](./examples/lock-with-retry.ts) - Contention handling
- [Monitoring & Observability](./examples/monitoring.ts) - Production monitoring
- [Adapter Usage](./examples/adapter-usage.ts) - Redis client integration

## Contributing

We welcome contributions! Please see our [Contributing Guide](./CONTRIBUTING.md)
for details.

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
