# Migrating from node-redlock

How the API of node-redlock (the [`redlock`](https://www.npmjs.com/package/redlock) package, version 5) maps to redlock-universal.

## What changes

- **One lock object per key.** `new Redlock(clients)` gives you one object that locks whatever resources you name later. `createLock()` and `createRedlock()` return a lock for one key, with the key and the TTL set when you create it. Creating a lock object sends nothing to Redis, so create one wherever you know the key.
- **One server or several.** Use `createLock()` with one Redis or Valkey server, or with one Cluster client. Use `createRedlock()` with several independent servers.
- **Any client.** node-redlock takes ioredis clients. redlock-universal takes node-redis, ioredis or Valkey GLIDE clients, wrapped in an adapter.
- **Handles.** `acquire()` returns a handle that you pass to `release(handle)` and `extend(handle, ttl)`. Both resolve `false` when the lock is gone, instead of rejecting.

## API

| node-redlock | redlock-universal |
| --- | --- |
| `new Redlock([client], settings)` | `createLock({ adapter: new IoredisAdapter(client), key, ttl })` |
| `new Redlock([client1, client2, client3], settings)` | `createRedlock({ adapters, key, ttl })` |
| `redlock.acquire([key], ttl)` | `lock.acquire()` |
| `redlock.acquire([key1, key2], ttl)`, one server | `manager.acquireBatch([key1, key2], { ttl })` |
| `lock.release()` or `redlock.release(lock)` | `lock.release(handle)` |
| `lock.extend(ttl)` or `redlock.extend(lock, ttl)` | `lock.extend(handle, ttl)`; keep using the same handle |
| `redlock.using([key], ttl, routine)` | `lock.using(routine)` |
| `redlock.using([key1, key2], ttl, routine)`, one server | `manager.usingBatch([key1, key2], routine, { ttl })` |
| `redlock.on('error', listener)` | No events. A failed `acquire()` rejects, and `error.cause` says why |
| `redlock.quit()` | Quit the clients yourself |

node-redlock 4 calls `acquire` and `release` `lock` and `unlock`, and its error event is `clientError`. They map the same way.

## Settings

| node-redlock (default) | redlock-universal (default) |
| --- | --- |
| `retryCount` (10) | `retryAttempts` (3). Both count the retries after the first attempt. There is no equivalent of `retryCount: -1`, which retries forever |
| `retryDelay` (200 ms) | `retryDelay` (100 ms for `createLock()`, 200 ms for `createRedlock()`) |
| `retryJitter` (100 ms) | None: retries are `retryDelay` apart |
| `driftFactor` (0.01) | `clockDriftFactor` (0.01), `createRedlock()` only |
| `automaticExtensionThreshold` (500 ms) | Not configurable: `using()` extends the lock when 20% of its TTL remains |
| A majority of the clients must agree | `quorum` (a majority of the adapters), `createRedlock()` only |

node-redlock also takes settings per call, as in `acquire(resources, ttl, settings)`. In redlock-universal they are set once per lock object.

## Errors

| node-redlock | redlock-universal |
| --- | --- |
| `acquire()` rejects with `ExecutionError` | `acquire()` rejects with `LockAcquisitionError` (`code` `'LOCK_ACQUISITION_FAILED'`); `error.cause` says why |
| `release()` rejects with `ExecutionError` when it cannot release on a quorum | `release()` resolves `false` when the lock is gone, and rejects with `LockReleaseError` when Redis fails |
| `extend()` rejects when the lock has expired or no quorum extends it | `extend()` resolves `false` when the lock is gone, and rejects with `LockExtensionError` when Redis fails |
| `using()` sets `signal.aborted` and `signal.error` when an extension fails | The same |

## One server

node-redlock:

```typescript
import Redlock from 'redlock';
import { Redis } from 'ioredis';

const redlock = new Redlock([new Redis()], { retryCount: 3 });

const lock = await redlock.acquire(['orders:42'], 30_000);
try {
  // Critical section
} finally {
  await lock.release();
}
```

redlock-universal:

```typescript
import { Redis } from 'ioredis';
import { createLock, IoredisAdapter } from 'redlock-universal';

const lock = createLock({
  adapter: new IoredisAdapter(new Redis()),
  key: 'orders:42',
  ttl: 30_000,
  retryAttempts: 3,
});

const handle = await lock.acquire();
try {
  // Critical section
} finally {
  await lock.release(handle);
}
```

## Several servers

node-redlock:

```typescript
import Redlock from 'redlock';
import { Redis } from 'ioredis';

const redlock = new Redlock([new Redis(6379), new Redis(6380), new Redis(6381)]);

await redlock.using(['orders:42'], 30_000, async (signal) => {
  // Critical section
  if (signal.aborted) throw signal.error;
});
```

redlock-universal:

```typescript
import { Redis } from 'ioredis';
import { createRedlock, IoredisAdapter } from 'redlock-universal';

const lock = createRedlock({
  adapters: [new Redis(6379), new Redis(6380), new Redis(6381)].map(
    (client) => new IoredisAdapter(client)
  ),
  key: 'orders:42',
  ttl: 30_000,
});

await lock.using(async (signal) => {
  // Critical section
  if (signal.aborted) throw signal.error ?? new Error('Lock lost');
});
```

`createRedlock()` retries 3 times by default, where node-redlock retries 10 times. Pass `retryAttempts` to keep the old behavior.

## A lock per call

node-redlock code usually names the resource per call. Create the lock object in the same place:

```typescript
import { Redis } from 'ioredis';
import { createLock, IoredisAdapter } from 'redlock-universal';

const adapter = new IoredisAdapter(new Redis());

async function processOrder(orderId: string): Promise<void> {
  const lock = createLock({ adapter, key: `orders:${orderId}`, ttl: 30_000 });
  await lock.using(async () => {
    // Critical section
  });
}

await processOrder('42');
```

## Several keys

On one server, `LockManager` takes several keys in one script, all of them or none:

```typescript
import { Redis } from 'ioredis';
import { IoredisAdapter, LockManager } from 'redlock-universal';

const manager = new LockManager({ nodes: [new IoredisAdapter(new Redis())] });

await manager.usingBatch(
  ['account:1', 'account:2'],
  async (signal) => {
    // Both keys are held
    if (signal.aborted) throw signal.error ?? new Error('Lock lost');
  },
  { ttl: 30_000 }
);
```

On Redis Cluster, the keys of one batch must hash to one slot. Give them a shared hash tag, such as `{order:42}:payment` and `{order:42}:stock`.

`createRedlock()` locks one key. To hold several keys on several servers, nest one lock per key, and take the keys in the same order everywhere so that two callers never wait for each other:

```typescript
import { Redis } from 'ioredis';
import { createRedlock, IoredisAdapter } from 'redlock-universal';

const adapters = [new Redis(6379), new Redis(6380), new Redis(6381)].map(
  (client) => new IoredisAdapter(client)
);
const lockFor = (key: string) => createRedlock({ adapters, key, ttl: 30_000 });

await lockFor('account:1').using(async (first) => {
  await lockFor('account:2').using(async (second) => {
    // Both keys are held
    if (first.aborted || second.aborted) {
      throw first.error ?? second.error ?? new Error('Lock lost');
    }
  });
});
```

## Running both during the migration

Neither library adds a prefix to the key by default: both store a lock under the resource name. A lock taken by one therefore blocks the other on the same key, and both compare the stored value before they release or extend, so neither removes the other's lock. Old and new code can run side by side during a rolling deploy, as long as they use the same servers.

Both libraries issue no fencing tokens. Before you rely on a lock to protect data, read the [safety guide](SAFETY.md).
