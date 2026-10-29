# Valkey Support

[Valkey](https://valkey.io) is an open-source key-value store forked from Redis
7.2.4 in 2024. It is a Linux Foundation project.

redlock-universal works with Valkey through node-redis, ioredis or Valkey GLIDE.
CI runs the integration and end-to-end tests against Valkey 8 as well as Redis 7.

## Compatibility Matrix

| Client Library | Redis 7 | Valkey 8 | Versions tested in CI                           |
| -------------- | ------- | -------- | ----------------------------------------------- |
| node-redis     | Yes     | Yes      | 4.7.1; 5.12.1 and 6.3.0 in the cluster workflow |
| ioredis        | Yes     | Yes      | 5.11.1; 6.0.0 in the cluster workflow           |
| Valkey GLIDE   | Yes     | Yes      | 2.4.2; 2.5.3 in the cluster workflow            |

CI runs the `redis:7-alpine` and `valkey/valkey:8-alpine` images, standalone
and as a three-primary cluster. Other server versions are not tested. The full
GLIDE adapter suite runs against Valkey; against Redis, CI runs the GLIDE script
and cluster tests.

## Using Valkey GLIDE

[Valkey GLIDE](https://github.com/valkey-io/valkey-glide) is the Valkey
project's client library, with a Rust core and Node.js bindings.
redlock-universal wraps it with `GlideAdapter`.

### Installation

```bash
npm install redlock-universal @valkey/valkey-glide
```

`@valkey/valkey-glide` is an optional peer dependency (`>=2.0.0`). GLIDE ships
native builds for Linux (x64 and arm64, glibc and musl) and macOS, not for
Windows.

### Basic Usage

```typescript
import { GlideClient } from '@valkey/valkey-glide';
import { GlideAdapter, createLock } from 'redlock-universal';

// Create GLIDE client
const glideClient = await GlideClient.createClient({
  addresses: [{ host: 'localhost', port: 6379 }],
});

// Wrap with adapter
const adapter = new GlideAdapter(glideClient);

// Create lock
const lock = createLock({
  adapter,
  key: 'my-resource',
  ttl: 30000,
});

// Use the lock
const handle = await lock.acquire();
try {
  // Critical section
} finally {
  await lock.release(handle);
}

// Clean up
await adapter.disconnect();
```

### Cluster Mode

```typescript
import { GlideClusterClient } from '@valkey/valkey-glide';
import { GlideAdapter, LockManager } from 'redlock-universal';

// Connect to Valkey cluster
const clusterClient = await GlideClusterClient.createClient({
  addresses: [
    { host: 'node1.valkey.local', port: 6379 },
    { host: 'node2.valkey.local', port: 6379 },
    { host: 'node3.valkey.local', port: 6379 },
  ],
});

const adapter = new GlideAdapter(clusterClient);

const manager = new LockManager({
  nodes: [adapter],
  defaultTTL: 30000,
});

// Auto-extending lock with abort signal
await manager.createSimpleLock('resource-key').using(async (signal) => {
  // Critical section
});
```

Cluster mode is tested from redlock-universal 0.8.9. The keys passed to
`acquireBatch()` or `usingBatch()` are written by one script, so on a cluster
they must hash to one slot: give them a shared hash tag, such as
`{order:42}:payment` and `{order:42}:stock`.

## Using Existing Clients with Valkey

If you're already using node-redis or ioredis, you can connect to Valkey without
any code changes: Valkey uses the same protocol as Redis.

### ioredis with Valkey

```typescript
import { Redis } from 'ioredis';
import { createLock, IoredisAdapter } from 'redlock-universal';

// Connect to Valkey (same as Redis)
const client = new Redis({
  host: 'valkey.example.com',
  port: 6379,
});

const lock = createLock({
  adapter: new IoredisAdapter(client),
  key: 'resource',
  ttl: 30000,
});
```

### node-redis with Valkey

```typescript
import { createClient } from 'redis';
import { createLock, NodeRedisAdapter } from 'redlock-universal';

// Connect to Valkey (same as Redis)
const client = createClient({
  url: 'redis://valkey.example.com:6379',
});
await client.connect();

const lock = createLock({
  adapter: new NodeRedisAdapter(client),
  key: 'resource',
  ttl: 30000,
});
```

## Testing Locally with Valkey

### Docker

```bash
# Start Valkey container
docker run -d --name valkey -p 127.0.0.1:6379:6379 valkey/valkey:8-alpine

# Verify it's running
docker exec valkey valkey-cli PING
```

### Docker Compose

```yaml
services:
  valkey:
    image: valkey/valkey:8-alpine
    ports:
      - '127.0.0.1:6379:6379'
    volumes:
      - valkey-data:/data
    command: valkey-server --appendonly yes
    healthcheck:
      test: ['CMD', 'valkey-cli', 'ping']
      interval: 5s
      timeout: 3s
      retries: 3

volumes:
  valkey-data:
```

### Multi-Node Setup for Redlock Testing

```yaml
services:
  valkey1:
    image: valkey/valkey:8-alpine
    ports:
      - '127.0.0.1:6379:6379'

  valkey2:
    image: valkey/valkey:8-alpine
    ports:
      - '127.0.0.1:6380:6379'

  valkey3:
    image: valkey/valkey:8-alpine
    ports:
      - '127.0.0.1:6381:6379'
```

## Migration from Redis to Valkey

Valkey supports every command redlock-universal sends, and the same tests run
against both servers in CI. Migration requires no code changes:

1. **Update your connection URLs** to point to Valkey instances
2. **No library changes needed**: the same adapters and lock code work on both
3. **Switch all clients together.** Locks are not copied between servers: a
   client still connected to the old server and a client on the new one do not
   see each other's locks.

### Why Consider Valkey GLIDE?

ioredis and node-redis work with Valkey. GLIDE is an option when you want:

- **A client maintained by the Valkey project**
- **One Rust core** shared with GLIDE's Java, Python and Go clients

## Commands Used

redlock-universal sends these commands. Redis 7 and Valkey 8 support all of
them.

| Command                            | Usage in redlock-universal                                   |
| ---------------------------------- | ------------------------------------------------------------ |
| SET NX PX                          | Lock acquisition                                             |
| GET                                | `isLocked()`, and inside the scripts                         |
| EVALSHA / EVAL                     | Release, extend, inspect and batch scripts; EVAL resends a script the server no longer has |
| DEL, PEXPIRE, PTTL, EXISTS, SET PX | Inside the Lua scripts                                       |
| PING                               | Health checks                                                |

## Resources

- [Valkey Official Website](https://valkey.io)
- [Valkey GLIDE GitHub](https://github.com/valkey-io/valkey-glide)
- [Valkey Documentation](https://valkey.io/docs/)
- [Migration Guide: Redis to Valkey](https://valkey.io/topics/migration/)
- [Valkey Docker Hub](https://hub.docker.com/r/valkey/valkey)
