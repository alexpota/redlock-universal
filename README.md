# redlock-universal

> Universal distributed locks for Redis and Valkey

[![npm version](https://img.shields.io/npm/v/redlock-universal.svg)](https://www.npmjs.com/package/redlock-universal)
[![Node.js](https://img.shields.io/node/v/redlock-universal.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Test Coverage](https://img.shields.io/badge/coverage-86%25-green.svg)](#testing)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Downloads](https://img.shields.io/npm/dm/redlock-universal.svg)](https://www.npmjs.com/package/redlock-universal)

The only distributed lock library supporting **all three** Redis clients:

**node-redis** &bull; **ioredis** &bull; **Valkey GLIDE**

> <img src="https://nestjs.com/img/logo-small.svg" width="18" height="18" alt="NestJS" style="vertical-align: middle;"> **NestJS Integration:** Check out [nestjs-redlock-universal](https://www.npmjs.com/package/nestjs-redlock-universal) for decorator-based integration with dependency injection.

## Quick Start

```typescript
import { createLock, IoredisAdapter } from 'redlock-universal';
import Redis from 'ioredis';

const lock = createLock({
  adapter: new IoredisAdapter(new Redis()),
  key: 'my-resource',
  ttl: 30000,
});

// Automatic lock management with auto-extension
await lock.using(async () => {
  // Critical section - lock auto-extends and releases
});
```

```bash
npm install redlock-universal
```

## Why redlock-universal?

Same performance as the fastest libraries, with universal client support they lack.

| Library | Latency | node-redis | ioredis | Valkey | Monitoring |
|---------|---------|:----------:|:-------:|:------:|:----------:|
| redis-semaphore | 0.369ms | ❌ | ✅ | ❌ | ❌ |
| **redlock-universal** | **0.377ms** | **✅** | **✅** | **✅** | **✅** |
| node-redlock | 0.398ms | ❌ | ✅ | ❌ | ❌ |

<sub>Benchmarked on local Redis 7 (macOS, Node.js 22). Results vary with system load, network, and Redis configuration. All libraries deliver competitive sub-millisecond performance.</sub>

## Installation

```bash
npm install redlock-universal

# Install your preferred Redis client
npm install ioredis        # or
npm install redis          # or
npm install @valkey/valkey-glide
```

## Core API

### using() - Recommended

Auto-extends lock and guarantees cleanup:

```typescript
const result = await lock.using(async (signal) => {
  // Long-running operation
  await processData();

  // Check if lock was lost (optional)
  if (signal.aborted) {
    throw new Error('Lock lost');
  }

  return 'done';
});
```

### acquire() / release() - Manual Control

```typescript
const handle = await lock.acquire();
try {
  await doWork();
} finally {
  await lock.release(handle);
}
```

### extend() - Extend Lock TTL

```typescript
const handle = await lock.acquire();
// Extend lock by 10 seconds
const extended = await lock.extend(handle, 10000);
if (extended) {
  // Continue working with extended TTL
}
await lock.release(handle);
```

<details>
<summary><strong>Extending locks acquired via LockManager</strong></summary>

When using `LockManager`, you can extend locks by creating a lock instance from the handle:

```typescript
const manager = new LockManager({ nodes: [adapter], defaultTTL: 30000 });
const handle = await manager.acquireLock('my-resource');

// Create a lock instance using the handle's strategy
const lock = handle.metadata?.strategy === 'redlock'
  ? manager.createRedLock(handle.key)
  : manager.createSimpleLock(handle.key);

const extended = await lock.extend(handle, 30000);
```

This also works across processes — `LockHandle` is fully serializable:

```typescript
// Process A: acquire and pass handle to another process
const handle = await manager.acquireLock('my-resource');
queue.publish(JSON.stringify(handle));

// Process B: receive handle and extend
const handle = JSON.parse(message);
const lock = handle.metadata?.strategy === 'redlock'
  ? manager.createRedLock(handle.key)
  : manager.createSimpleLock(handle.key);

await lock.extend(handle, 30000);
```

`createSimpleLock` and `createRedLock` don't acquire anything — they create a lock object wired to the right adapter. The actual Redis operation only happens when you call `.extend()`.

</details>

### isLocked() - Check Lock Status

```typescript
const locked = await lock.isLocked('my-resource');
if (!locked) {
  // Safe to acquire
}
```

### Distributed Lock (Redlock Algorithm)

For fault-tolerant locking across multiple Redis instances using the [Redlock algorithm](https://redis.io/docs/manual/patterns/distributed-locks/):

```typescript
import { createRedlock, IoredisAdapter } from 'redlock-universal';

const redlock = createRedlock({
  adapters: [
    new IoredisAdapter(redis1),
    new IoredisAdapter(redis2),
    new IoredisAdapter(redis3),
  ],
  key: 'distributed-resource',
  ttl: 30000,
  quorum: 2,
});

await redlock.using(async () => {
  // Distributed consensus - survives node failures
});
```

## Adapters & Cluster Support

Fully supports Redis Cluster via both ioredis and node-redis.

```typescript
// ioredis
import Redis from 'ioredis';
const adapter = new IoredisAdapter(new Redis());

// ioredis Cluster
import { Cluster } from 'ioredis';
const cluster = new Cluster([{ host: 'node-1', port: 6379 }]);
const adapter = new IoredisAdapter(cluster);

// node-redis
import { createClient } from 'redis';
const client = createClient();
await client.connect();
const adapter = new NodeRedisAdapter(client);

// node-redis Cluster
import { createCluster } from 'redis';
const cluster = createCluster({ rootNodes: [{ url: 'redis://node-1:6379' }] });
await cluster.connect();
const adapter = new NodeRedisAdapter(cluster);

// Valkey GLIDE
import { GlideClient } from '@valkey/valkey-glide';
const client = await GlideClient.createClient({ addresses: [{ host: 'localhost', port: 6379 }] });
const adapter = new GlideAdapter(client);
```

> **Valkey Users:** See [VALKEY.md](VALKEY.md) for detailed Valkey setup guide.

> [!IMPORTANT]
> **Cluster vs Redlock:**
> - **Redis Cluster**: Provides High Availability (HA). If a master fails, a replica takes over. *Warning: Locks can be lost during failover (eventual consistency).*
> - **Redlock**: Provides Consensus. Locks are safe even if nodes crash. Use for critical consistency.
>
> See [Cluster Usage Examples](./examples/redis-cluster-usage.ts) for details.

## Configuration

```typescript
interface CreateLockConfig {
  adapter: RedisAdapter;
  key: string;
  ttl?: number;              // Default: 30000ms
  retryAttempts?: number;    // Default: 3
  retryDelay?: number;       // Default: 100ms
  performance?: 'standard' | 'lean' | 'enterprise';
  logger?: ILogger;          // Optional structured logging
}

interface CreateRedlockConfig {
  adapters: RedisAdapter[];
  key: string;
  ttl?: number;              // Default: 30000ms
  retryAttempts?: number;    // Default: 3
  retryDelay?: number;       // Default: 200ms
  quorum?: number;           // Default: Math.floor(adapters.length / 2) + 1
  clockDriftFactor?: number; // Default: 0.01
  logger?: ILogger;          // Optional structured logging
}
```

<details>
<summary><strong>Advanced: Batch Lock Acquisition</strong></summary>

Acquire multiple locks atomically (all-or-nothing):

```typescript
import { LockManager } from 'redlock-universal';

const manager = new LockManager({ nodes: [adapter] });

// Atomic batch - prevents deadlocks via automatic key sorting
const handles = await manager.acquireBatch(['user:1', 'user:2', 'order:3']);
try {
  await processTransaction();
} finally {
  await manager.releaseBatch(handles);
}

// Or with auto-extension (supports retryAttempts, retryDelay options)
await manager.usingBatch(['key1', 'key2'], async (signal) => {
  // All locks auto-extend and release
});
```

</details>

<details>
<summary><strong>Advanced: Logger Integration</strong></summary>

```typescript
import { Logger, LogLevel } from 'redlock-universal';

const logger = new Logger({
  level: LogLevel.INFO,
  prefix: 'redlock',
  enableConsole: true,
});

const lock = createLock({ adapter, key: 'resource', logger });
```

**External loggers:**

| Logger  | Works Directly | Adapter Needed          |
|---------|:--------------:|-------------------------|
| Winston | Yes            | No                      |
| Console | Yes            | No                      |
| Pino    | Via Adapter    | `createPinoAdapter()`   |
| Bunyan  | Via Adapter    | `createBunyanAdapter()` |

```typescript
// Pino
import { createPinoAdapter } from 'redlock-universal';
const logger = createPinoAdapter(pinoLogger);

// Bunyan
import { createBunyanAdapter } from 'redlock-universal';
const logger = createBunyanAdapter(bunyanLogger);
```

</details>

<details>
<summary><strong>Advanced: Lock Inspection</strong></summary>

Debug stuck locks:

```typescript
const inspection = await adapter.inspect('my-resource');
if (inspection) {
  console.log('Owner:', inspection.value);
  console.log('TTL:', inspection.ttl, 'ms');
}
```

</details>

<details>
<summary><strong>Advanced: Testing with MemoryAdapter</strong></summary>

Unit tests without Redis:

```typescript
import { MemoryAdapter, createLock } from 'redlock-universal';

const adapter = new MemoryAdapter();
const lock = createLock({ adapter, key: 'test', ttl: 5000 });

// Use in tests
const handle = await lock.acquire();
await lock.release(handle);

// Cleanup
adapter.clear();
await adapter.disconnect();
```

> [!WARNING]
> MemoryAdapter is for testing only. Not suitable for production.

</details>

<details>
<summary><strong>Advanced: Factory Functions</strong></summary>

Create multiple locks or specialized configurations:

```typescript
import { createLocks, createPrefixedLock, createRedlocks } from 'redlock-universal';

// Multiple locks with shared config
const locks = createLocks(adapter, ['user:123', 'account:456'], {
  ttl: 15000,
  retryAttempts: 5,
});

// Lock with automatic key prefixing
const userLock = createPrefixedLock(adapter, 'locks:user:', '123', {
  ttl: 10000,
});
// Key: "locks:user:123"

// Multiple distributed locks
const redlocks = createRedlocks(
  [adapter1, adapter2, adapter3],
  ['resource1', 'resource2'],
  { ttl: 15000, quorum: 2 }
);
```

</details>

<details>
<summary><strong>Advanced: Performance Modes</strong></summary>

Choose the optimal mode for your use case:

```typescript
// Standard (default) - full monitoring and observability
const lock = createLock({ adapter, key: 'resource', performance: 'standard' });

// Lean - memory-optimized, minimal overhead (~3% faster)
const lock = createLock({ adapter, key: 'resource', performance: 'lean' });

// Enterprise - standard + circuit breakers + advanced observability
const lock = createLock({ adapter, key: 'resource', performance: 'enterprise' });
```

</details>

## Error Handling

```typescript
import {
  LockAcquisitionError,
  LockReleaseError,
  LockExtensionError,
} from 'redlock-universal';

try {
  const handle = await lock.acquire();
  await lock.extend(handle, 10000);
  await lock.release(handle);
} catch (error) {
  if (error instanceof LockAcquisitionError) {
    // Lock is held by another process
  } else if (error instanceof LockExtensionError) {
    // Extension failed (lock expired or lost)
  } else if (error instanceof LockReleaseError) {
    // Release failed (handle mismatch or connection issue)
  }
}
```

## FAQ

**Q: SimpleLock vs RedLock?**
SimpleLock = single Redis (faster). RedLock = multiple Redis instances (fault-tolerant).

**Q: What happens if Redis restarts?**
Lua scripts auto-reload on NOSCRIPT errors. No action needed.

**Q: Performance overhead of auto-extension?**
Minimal (<1ms). Uses atomic Lua scripts.

## Best Practices

- **Use `using()` over manual acquire/release** - guarantees cleanup, handles auto-extension
- **Set appropriate TTL** - long enough for work, short enough for quick recovery
- **Handle `signal.aborted`** - gracefully exit when lock is lost during long operations
- **Use unique lock keys** - namespace by resource type (e.g., `user:123:cart`)
- **Monitor lock metrics** - track acquisition failures and extension patterns

## Testing

```bash
npm test                    # Unit tests
npm run test:integration    # Integration tests (requires Redis)
npm run test:coverage       # Coverage report
npm run test:docker         # Docker-based tests (all services)
```

## Troubleshooting

> [!WARNING]
> **Lock not releasing?** Ensure handle matches stored value. Check if TTL expired before release.

> [!WARNING]
> **High P99 latency?** Check Redis server load. Consider `performance: 'lean'` mode.

## Migration

<details>
<summary><strong>From node-redlock</strong></summary>

```typescript
// Before (node-redlock)
const redlock = new Redlock([ioredis], { retryCount: 3 });
const lock = await redlock.acquire(['resource'], 30000);
await lock.release();

// After (redlock-universal)
const redlock = createRedlock({
  adapters: [new IoredisAdapter(ioredis)],
  key: 'resource',
  ttl: 30000,
  retryAttempts: 3,
});
const handle = await redlock.acquire();
await redlock.release(handle);
```

</details>

<details>
<summary><strong>From redis-semaphore</strong></summary>

```typescript
// Before (redis-semaphore)
const mutex = new Mutex(ioredis, 'resource');
await mutex.acquire();
await mutex.release();

// After (redlock-universal)
const lock = createLock({
  adapter: new IoredisAdapter(ioredis),
  key: 'resource',
});
const handle = await lock.acquire();
await lock.release(handle);
```

</details>

## Links

- [Examples](./examples/)
- [Valkey Setup Guide](./VALKEY.md)
- [Redis Cluster Examples](./examples/redis-cluster-usage.ts)
- [Changelog](./CHANGELOG.md)
- [Issue Tracker](https://github.com/alexpota/redlock-universal/issues)
- [Discussions](https://github.com/alexpota/redlock-universal/discussions)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Issues and PRs welcome.

## License

[MIT](./LICENSE)
