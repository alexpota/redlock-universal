# redlock-universal

> Distributed locks for Redis and Valkey: node-redis, ioredis or Valkey GLIDE

[![npm version](https://img.shields.io/npm/v/redlock-universal.svg)](https://www.npmjs.com/package/redlock-universal)
[![Node.js](https://img.shields.io/node/v/redlock-universal.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-types%20included-blue.svg)](https://www.typescriptlang.org/)
[![Test Coverage](https://img.shields.io/badge/coverage-%E2%89%A586%25%20lines-green.svg)](#testing)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Downloads](https://img.shields.io/npm/dm/redlock-universal.svg)](https://www.npmjs.com/package/redlock-universal)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-pink?logo=github)](https://github.com/sponsors/alexpota)

Distributed locks for Node.js on the Redis or Valkey you already run, with the client you already use:

**node-redis** &bull; **ioredis** &bull; **Valkey GLIDE**

Requires Node.js 22 or later. CI runs the test suite with node-redis and ioredis against Redis 7 and Valkey 8, the Valkey GLIDE adapter tests against Valkey 8, and the cluster tests with all three clients against Redis 7 and Valkey 8 clusters.

> <img src=".github/assets/nestjs-logo.png" width="18" height="18" alt="NestJS" style="vertical-align: middle;"> **NestJS Integration:** Check out [nestjs-redlock-universal](https://www.npmjs.com/package/nestjs-redlock-universal) for decorator-based integration with dependency injection.

## Quick Start

```bash
npm install redlock-universal ioredis
```

```typescript
import { createLock, IoredisAdapter } from 'redlock-universal';
import { Redis } from 'ioredis';

const lock = createLock({
  adapter: new IoredisAdapter(new Redis()),
  key: 'my-resource',
  ttl: 30000,
});

// Acquires the lock, extends it while the callback runs, then releases it
await lock.using(async (signal) => {
  // Critical section: signal.aborted turns true if the lock is lost
});
```

A lock prevents most duplicate work, but on its own it cannot guarantee that only one process acts at a time. Read [SAFETY.md](SAFETY.md) before you rely on a lock for correctness.

## Why redlock-universal?

- **Three clients, one API.** Adapters for node-redis, ioredis and Valkey GLIDE, on Redis or Valkey, standalone or Cluster. [VALKEY.md](VALKEY.md#compatibility-matrix) lists the versions tested in CI.
- **One server or several.** `createLock()` locks on one server; `createRedlock()` runs the Redlock algorithm across independent servers.
- **Automatic extension.** `using()` extends the lock while your callback runs and aborts an `AbortSignal` when an extension fails.
- **Atomic multi-key locks.** `LockManager.acquireBatch()` takes all of the keys or none of them, on one server.
- **Operational helpers.** A circuit breaker for unreachable servers, lock statistics, a logger interface with Pino and Bunyan adapters, and an in-memory adapter for tests.
- **Packaging.** ESM and CommonJS builds with TypeScript types and no runtime dependencies. Releases are published from GitHub Actions with npm provenance.

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

Extends the lock while the callback runs and releases it when the callback settles:

```typescript
const result = await lock.using(async (signal) => {
  // Long-running operation
  await processData();

  // Stop if the lock was lost
  if (signal.aborted) {
    throw signal.error ?? new Error('Lock lost');
  }

  return 'done';
});
// using() returns the callback's value: result === 'done'
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
// Set the lock's TTL to 10 seconds from now
const extended = await lock.extend(handle, 10000);
if (extended) {
  // Continue working with extended TTL
}
await lock.release(handle);
```

`extend()` sets the remaining TTL to the given value; it does not add to it. It returns `false` when the lock has expired or another client holds it.

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
  // The key was free when it was checked
}
```

`isLocked()` is informational: another client can acquire the key right after the check, and a Redis error also reads as `false`. To take the lock, call `acquire()`.

### Distributed Lock (Redlock Algorithm)

To keep locks available while some servers are down, use the [Redlock algorithm](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/) across three or more independent Redis or Valkey servers:

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
  // Held on a quorum (here 2 of 3) of the servers
});
```

Redlock keeps working while a minority of the servers is down. It is not a consensus protocol: see [SAFETY.md](SAFETY.md) for what it does and does not guarantee.

## Adapters & Cluster Support

Works with the Redis Cluster clients of ioredis, node-redis and Valkey GLIDE. CI runs the cluster tests, covering the lock commands and script reloading, on three-primary Redis 7 and Valkey 8 clusters.

```typescript
// ioredis
import { Redis } from 'ioredis';
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

// Valkey GLIDE Cluster
import { GlideClusterClient } from '@valkey/valkey-glide';
const cluster = await GlideClusterClient.createClient({ addresses: [{ host: 'node-1', port: 6379 }] });
const adapter = new GlideAdapter(cluster);
```

On a cluster, the keys passed to `acquireBatch()` or `usingBatch()` are written by one script, so they must hash to one slot. Give them a shared hash tag, such as `{order:42}:payment` and `{order:42}:stock`.

> **Valkey Users:** See [VALKEY.md](VALKEY.md) for detailed Valkey setup guide.

> [!IMPORTANT]
> **Cluster vs Redlock:**
> - **Redis Cluster** (like Sentinel or any primary with replicas): each lock lives on one primary, and a replica takes over if that primary fails. Replication is asynchronous, so a failover can lose a lock that was just written, and another client can then acquire it.
> - **Redlock**: each lock is written to a majority of independent servers, so it survives the loss of a minority of them. It is not consensus: clock jumps, long process pauses and restarts without persistence can still let two clients hold the same lock.
>
> Neither makes a lock safe for correctness on its own. See [SAFETY.md](SAFETY.md), and the [Cluster Usage Examples](./examples/redis-cluster-usage.ts).

### Key Prefix

Every adapter accepts a `keyPrefix` option. It is prepended to each lock key exactly as given, without a separator, so include one yourself:

```typescript
const adapter = new NodeRedisAdapter(client, { keyPrefix: 'myapp:' });
// The lock key 'orders:42' is stored in Redis as 'myapp:orders:42'
```

Set the prefix on the adapter or on the client (ioredis `keyPrefix`, node-redis 6.1+ `keyPrefix`), not both: the two prefixes are combined. `IoredisAdapter` emits a one-time process warning (`REDLOCK_UNIVERSAL_DOUBLE_KEY_PREFIX`) when both are set. Errors and logs report the lock key without the adapter's prefix, except the message of `signal.error` after a failed extension, which shows the key as stored.

## Configuration

```typescript
interface CreateLockConfig {
  adapter: RedisAdapter;
  key: string;
  ttl?: number;              // Default: 30000ms
  retryAttempts?: number;    // Default: 3 (retries after the first attempt)
  retryDelay?: number;       // Default: 100ms
  performance?: 'standard' | 'lean' | 'enterprise'; // Default: 'standard'
  logger?: ILogger;          // Optional structured logging
  circuitBreaker?: boolean | CircuitBreakerConfig; // Default: enabled
}

interface CreateRedlockConfig {
  adapters: RedisAdapter[];
  key: string;
  ttl?: number;              // Default: 30000ms
  retryAttempts?: number;    // Default: 3 (retries after the first attempt)
  retryDelay?: number;       // Default: 200ms
  quorum?: number;           // Default: Math.floor(adapters.length / 2) + 1
  clockDriftFactor?: number; // Default: 0.01
  logger?: ILogger;          // Optional structured logging
}
```

Each Redis command times out after 5000 ms. To change it, pass `timeout` in the adapter options, for example `new IoredisAdapter(redis, { timeout: 2000 })`.

<details>
<summary><strong>Advanced: Batch Lock Acquisition</strong></summary>

Acquire multiple locks atomically (all-or-nothing):

```typescript
import { LockManager } from 'redlock-universal';

const manager = new LockManager({ nodes: [adapter] });

// One script takes all keys or none, so concurrent batches cannot deadlock
const handles = await manager.acquireBatch(['user:1', 'user:2', 'order:3']);
try {
  await processTransaction();
} finally {
  await manager.releaseBatch(handles);
}

// Or with auto-extension (supports ttl, retryAttempts, retryDelay options)
await manager.usingBatch(['key1', 'key2'], async (signal) => {
  // All locks auto-extend and release
});
```

On a cluster, give the keys of one batch a shared hash tag (see [Adapters & Cluster Support](#adapters--cluster-support)).

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

CI runs lock operations with Winston, Pino and Bunyan attached. It does not check the log output.

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

```typescript
// Standard (default): circuit breaker, health check and logger support
const lock = createLock({ adapter, key: 'resource', performance: 'standard' });

// Lean: a smaller lock class with fewer checks (see below)
const lock = createLock({ adapter, key: 'resource', performance: 'lean' });

// Enterprise: currently creates the same lock as 'standard'
const lock = createLock({ adapter, key: 'resource', performance: 'enterprise' });
```

`lean` keeps `using()` and auto-extension, but it has no circuit breaker, health check or logger (the `circuitBreaker` and `logger` options are ignored). It does not validate its configuration or check handles.

</details>

<details>
<summary><strong>Advanced: Circuit Breaker</strong></summary>

SimpleLock includes a built-in circuit breaker that fast-fails when Redis is persistently unavailable, avoiding long TCP timeouts on every `acquire()` call.

**States:** Closed (normal) → Open (fast-fail) → Half-Open (single probe) → Closed

```typescript
// Enabled by default — customize thresholds:
const lock = createLock({
  adapter, key: 'resource',
  circuitBreaker: {
    failureThreshold: 5,  // Consecutive failures to trip (default: 5)
    resetTimeout: 60000,  // Ms before probing recovery (default: 60000)
  }
});

// Disable entirely:
const lock = createLock({ adapter, key: 'resource', circuitBreaker: false });

// Check breaker state (getHealth() is a SimpleLock method):
const health = (lock as SimpleLock).getHealth();
// { healthy, lastCheck, connected, circuitBreaker: { state, failures, openedAt } }
```

The circuit breaker is available in `standard` and `enterprise` performance modes. The `lean` mode omits it for minimal memory overhead.

Each lock instance has its own breaker. It counts failed lock commands; there is no separate `PING`, so the first `acquire()` against a server that is down fails after one command timeout. `getHealth()` reports the outcome of the lock's latest command, and `lastCheck` is when it arrived. The `healthCheckInterval` option is still accepted but has no effect.

</details>

## Error Handling

```typescript
import { LockAcquisitionError, type LockHandle } from 'redlock-universal';

async function runExclusive(): Promise<void> {
  let handle: LockHandle;
  try {
    handle = await lock.acquire();
  } catch (error) {
    if (error instanceof LockAcquisitionError) {
      // Not acquired. error.cause says why: the key is held,
      // Redis failed or timed out, or the circuit breaker is open.
      return;
    }
    throw error;
  }

  try {
    await doWork();
  } finally {
    // false when the lock already expired or another client holds it
    await lock.release(handle);
  }
}
```

| Call | Result | When |
|------|--------|------|
| `acquire()` | throws `LockAcquisitionError` | Not acquired after `retryAttempts` retries: the key is held by another client, Redis failed or timed out (see `error.cause`), or the circuit breaker is open |
| `release()` | resolves `false` | The lock already expired, or another client holds it |
| `extend()` | resolves `false` | The lock expired, or another client holds it |
| `release()` / `extend()` | throws `LockReleaseError` / `LockExtensionError` | Redis returned an error or timed out |
| any method | throws `Error` | Invalid arguments, such as a handle for a different key (not checked in `lean` mode) |

With `createRedlock()`, `release()` and `extend()` resolve `true` when a quorum of servers succeeded. An error on one server counts as a failure on that server.

## FAQ

**Q: SimpleLock or RedLock?**
SimpleLock (`createLock()`) uses one server. RedLock (`createRedlock()`) writes to several independent servers and keeps working while a minority of them is down. Neither makes a lock safe for correctness by itself; see [SAFETY.md](SAFETY.md).

**Q: What does `using()` return, and what happens when the callback throws?**
`using()` returns whatever the callback returns. If the callback throws, `using()` waits for any extension in progress, releases the lock and rethrows the same error. A failed release is not thrown: it is logged if you passed a `logger`, and the lock expires at the end of its TTL.

**Q: How do I notice that the lock was lost?**
`using()` extends the lock when about 80% of the TTL has passed. If that extension fails, `signal.aborted` becomes `true` and `signal.error` holds the reason. The callback keeps running until it checks the signal, and `using()` still resolves with the callback's value. `signal.reason` and `signal.throwIfAborted()` carry a generic `AbortError`, so read `signal.error`. Without `using()`, nothing extends the lock, and `extend()` and `release()` return `false` once it is gone.

```typescript
await lock.using(async (signal) => {
  for (const item of items) {
    if (signal.aborted) {
      throw signal.error ?? new Error('Lock lost');
    }
    await processItem(item);
  }
});
```

**Q: Can I use a lock as a queue?**
No. A waiting `acquire()` polls: it retries `retryAttempts` times, `retryDelay` ms apart, then throws `LockAcquisitionError`. Waiters are not served in order, and nothing counts them. If callers must take turns or every job must run exactly once, use a job queue; to allow several holders at once, use a semaphore.

**Q: How do I prevent a cache stampede?**
Let one caller compute the value while the others wait for its result instead of computing it again. Lock a separate key, check the cache again after acquiring, and wait for the value while the lock is busy:

```typescript
import { setTimeout as sleep } from 'node:timers/promises';
import { Redis } from 'ioredis';
import { createLock, IoredisAdapter, LockAcquisitionError } from 'redlock-universal';

const redis = new Redis();
const adapter = new IoredisAdapter(redis);

async function getOrCompute(key: string, compute: () => Promise<string>): Promise<string> {
  const lock = createLock({
    adapter,
    key: `lock:${key}`, // never lock the cache key itself
    ttl: 10_000,
    retryAttempts: 0,
    circuitBreaker: false, // a new lock per call: skip the health-check PING
  });
  const deadline = Date.now() + 10_000;

  for (;;) {
    const cached = await redis.get(`cache:${key}`);
    if (cached !== null) return cached;

    try {
      return await lock.using(async () => {
        // The previous holder may have just stored the value
        const fresh = await redis.get(`cache:${key}`);
        if (fresh !== null) return fresh;
        const value = await compute();
        await redis.set(`cache:${key}`, value, 'EX', 60);
        return value;
      });
    } catch (error) {
      if (!(error instanceof LockAcquisitionError)) throw error;
    }

    // Another caller is computing the value: wait, then check the cache again
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${key}`);
    await sleep(100);
  }
}
```

**Q: Should I create one lock instance, or one per call?**
Either works. The lock lives in Redis under its key, and every `acquire()` generates a new lock value. With the circuit breaker on (the default), each instance health-checks the server with a `PING` before its first `acquire()` and counts failures on its own. If you create an instance per call, for example per request, pass `circuitBreaker: false` so that each call sends only the lock commands. `LockManager.acquireLock()` creates a new instance on every call.

**Q: Why does `instanceof LockAcquisitionError` return `false`?**
The package ships separate ESM and CommonJS builds, and each build has its own error classes. When both builds are loaded in one process, for example ESM application code next to a CommonJS dependency that also uses redlock-universal, an error from one build is not an instance of the other build's class. Compare the name (or `code`) instead:

```typescript
if (error instanceof Error && error.name === 'LockAcquisitionError') {
  // error.code is 'LOCK_ACQUISITION_FAILED'
}
```

**Q: What happens if Redis restarts?**
If the server lost its script cache, the adapter resends the script with `EVAL`. A restart without persistence also drops the locks, and another client can acquire them while the old holder is still running; see [SAFETY.md](SAFETY.md).

**Q: How much does auto-extension cost?**
One script call per extension (one per server with RedLock), when about 80% of the TTL has passed.

## Best Practices

- **Use `using()` over manual acquire/release** - extends the lock while the callback runs and releases it afterwards, also when the callback throws
- **Set appropriate TTL** - long enough for the work plus possible pauses, short enough for quick recovery, and well above the 5-second command timeout
- **Handle `signal.aborted`** - stop long operations when the lock is lost; `signal.error` says why
- **Use unique lock keys** - namespace by resource type (e.g., `user:123:cart`)
- **Protect the data, not only the lock** - if two holders would corrupt data, add a version check or a conditional write ([SAFETY.md](SAFETY.md))
- **Monitor lock statistics** - `LockManager.getStats()` reports acquisitions, failures and hold times

## Testing

```bash
npm test                    # Unit tests
npm run test:integration    # Integration and end-to-end tests (Redis on localhost:6379)
npm run test:coverage       # All tests with a coverage report (Redis on localhost:6379)
npm run test:docker         # Starts Redis and Valkey containers, then runs the suites
```

## Troubleshooting

> [!WARNING]
> **Lock not releasing?** `release()` returns `false` when the lock already expired or another client holds it. Release with the handle that `acquire()` returned.

> [!WARNING]
> **High P99 latency?** Check Redis server load and network latency.

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
try {
  await doWork();
} finally {
  await mutex.release();
}

// After (redlock-universal)
const lock = createLock({
  adapter: new IoredisAdapter(ioredis),
  key: 'mutex:resource', // redis-semaphore stores a Mutex under "mutex:<key>"
  ttl: 10000,            // redis-semaphore's default lockTimeout
  retryAttempts: 1000,   // with retryDelay 10: waits about 10 s, like its default acquireTimeout
  retryDelay: 10,
});
// Extends at 80% of the TTL, like the Mutex's default refreshInterval
await lock.using(async () => {
  await doWork();
});
```

With the `mutex:` prefix, both libraries use the same Redis key, so they exclude each other while you migrate.

</details>

## Links

- [Safety Guide](./SAFETY.md)
- [Examples](https://github.com/alexpota/redlock-universal/tree/main/examples)
- [Valkey Setup Guide](./VALKEY.md)
- [Redis Cluster Examples](./examples/redis-cluster-usage.ts)
- [Release Notes](https://github.com/alexpota/redlock-universal/releases)
- [Issue Tracker](https://github.com/alexpota/redlock-universal/issues)
- [Discussions](https://github.com/alexpota/redlock-universal/discussions)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Issues and PRs welcome.

## License

[MIT](./LICENSE)
