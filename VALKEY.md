# Valkey Support

[Valkey](https://valkey.io) is an open-source, high-performance key-value store
that originated as a fork of Redis. It's now maintained by the Linux Foundation
with backing from major cloud providers including AWS, Google Cloud, Oracle, and
Ericsson.

redlock-universal provides full support for Valkey through multiple client
options, ensuring you can use the same distributed locking patterns regardless
of your chosen data store.

## Compatibility Matrix

| Client Library   | Redis 7+ | Valkey 8+ | Notes                           |
| ---------------- | -------- | --------- | ------------------------------- |
| node-redis       | Yes      | Yes       | Official Redis client           |
| ioredis          | Yes      | Yes       | Popular community client        |
| Valkey GLIDE     | No       | Yes       | Official Valkey client (Rust)   |

## Using Valkey GLIDE

[Valkey GLIDE](https://github.com/valkey-io/valkey-glide) is the official
Valkey client, built with a Rust core for maximum performance. redlock-universal
provides a dedicated adapter for GLIDE integration.

### Installation

```bash
npm install redlock-universal @valkey/valkey-glide
```

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
  client: adapter,
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
glideClient.close();
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
  defaultTtl: 30000,
});

// Acquire locks
await manager.using('resource-key', async (signal) => {
  // Auto-extending lock with abort signal
});
```

## Using Existing Clients with Valkey

If you're already using node-redis or ioredis, you can connect to Valkey without
any code changes. Valkey is wire-protocol compatible with Redis.

### ioredis with Valkey

```typescript
import Redis from 'ioredis';
import { createLock } from 'redlock-universal';

// Connect to Valkey (same as Redis)
const client = new Redis({
  host: 'valkey.example.com',
  port: 6379,
});

const lock = createLock({
  client,
  key: 'resource',
  ttl: 30000,
});
```

### node-redis with Valkey

```typescript
import { createClient } from 'redis';
import { createLock } from 'redlock-universal';

// Connect to Valkey (same as Redis)
const client = createClient({
  url: 'redis://valkey.example.com:6379',
});
await client.connect();

const lock = createLock({
  client,
  key: 'resource',
  ttl: 30000,
});
```

## Testing Locally with Valkey

### Docker

```bash
# Start Valkey container
docker run -d --name valkey -p 6379:6379 valkey/valkey:8-alpine

# Verify it's running
docker exec valkey valkey-cli PING
```

### Docker Compose

```yaml
version: '3.8'

services:
  valkey:
    image: valkey/valkey:8-alpine
    ports:
      - '6379:6379'
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
version: '3.8'

services:
  valkey1:
    image: valkey/valkey:8-alpine
    ports:
      - '6379:6379'

  valkey2:
    image: valkey/valkey:8-alpine
    ports:
      - '6380:6379'

  valkey3:
    image: valkey/valkey:8-alpine
    ports:
      - '6381:6379'
```

## Migration from Redis to Valkey

Valkey maintains 100% compatibility with Redis at the protocol level. For
distributed locking with redlock-universal, migration requires no code changes:

1. **Update your connection URLs** to point to Valkey instances
2. **No library changes needed** - redlock-universal works identically
3. **All locking commands are fully supported** (see Feature Parity below)

### Why Consider Valkey GLIDE?

While ioredis and node-redis work perfectly with Valkey, you might consider
switching to GLIDE for:

- **Performance**: Rust-based core with optimized memory management
- **Official Support**: Maintained by the Valkey project itself
- **Future Features**: First to receive Valkey-specific optimizations
- **Unified API**: Same client works across multiple programming languages

## Feature Parity

All locking-related commands used by redlock-universal are fully supported:

| Command        | Redis 7+ | Valkey 8+ | Usage in redlock-universal     |
| -------------- | -------- | --------- | ------------------------------ |
| SET NX PX      | Yes      | Yes       | Lock acquisition               |
| GET            | Yes      | Yes       | Lock validation                |
| EVAL/EVALSHA   | Yes      | Yes       | Atomic release/extend scripts  |
| SCRIPT LOAD    | Yes      | Yes       | Lua script caching             |
| PTTL           | Yes      | Yes       | TTL checking                   |
| DEL            | Yes      | Yes       | Lock cleanup                   |

## Resources

- [Valkey Official Website](https://valkey.io)
- [Valkey GLIDE GitHub](https://github.com/valkey-io/valkey-glide)
- [Valkey Documentation](https://valkey.io/docs/)
- [Migration Guide: Redis to Valkey](https://valkey.io/docs/topics/migration/)
- [Valkey Docker Hub](https://hub.docker.com/r/valkey/valkey)
