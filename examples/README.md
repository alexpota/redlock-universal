# RedLock Universal Examples

This directory contains practical examples demonstrating how to use RedLock Universal in various scenarios.

## Prerequisites

1. **Install Dependencies**:
   ```bash
   npm install redlock-universal redis
   # or for ioredis users
   npm install redlock-universal ioredis
   ```

2. **Redis Setup**:
   - Single instance: Redis running on `localhost:6379`
   - Distributed examples: Redis instances on ports `6379`, `6380`, `6381`

   Using Docker:
   ```bash
   # Single instance
   docker run -d -p 6379:6379 redis:7-alpine
   
   # Multiple instances for distributed examples
   docker run -d -p 6379:6379 redis:7-alpine
   docker run -d -p 6380:6379 redis:7-alpine  
   docker run -d -p 6381:6379 redis:7-alpine
   ```

## Examples

### 1. Simple Lock (`simple-lock.ts`)

Basic single-instance locking example.

```bash
npx tsx examples/simple-lock.ts
```

**Demonstrates**:
- Creating a simple lock with NodeRedisAdapter
- Basic acquire/release pattern
- Error handling

### 2. Distributed Lock (`distributed-lock.ts`)

Multi-instance distributed locking using the Redlock algorithm.

```bash
npx tsx examples/distributed-lock.ts
```

**Demonstrates**:
- Creating distributed locks across multiple Redis instances
- Quorum-based consensus
- Handling partial failures

**Requirements**: Multiple Redis instances running

### 3. Lock with Retry (`lock-with-retry.ts`)

Handling contested resources with retry logic.

```bash
npx tsx examples/lock-with-retry.ts
```

**Demonstrates**:
- Configuring retry attempts and delays
- Handling lock contention
- Simulating multiple competing processes

### 4. Lock Extension (`lock-extension.ts`)

Extending lock TTL for long-running operations.

```bash
npx tsx examples/lock-extension.ts
```

**Demonstrates**:
- Manual lock extension during long operations
- Automatic extension with timers
- Preventing lock expiration during work

### 5. Monitoring (`monitoring.ts`)

Using built-in monitoring and observability features.

```bash
npx tsx examples/monitoring.ts
```

**Demonstrates**:
- Metrics collection and analysis
- Health checking for adapters
- Structured logging
- Performance monitoring

## Running Examples

### Individual Examples

```bash
# Install tsx for TypeScript execution
npm install -g tsx

# Run any example
npx tsx examples/simple-lock.ts
```

### With Different Redis Clients

```bash
# Using node-redis (default in examples)
npm install redis
npx tsx examples/simple-lock.ts

# Using ioredis (modify import in examples)
npm install ioredis
# Change: import { createClient } from 'redis';
# To: import Redis from 'ioredis'; const client = new Redis('redis://localhost:6379');
```

## Example Patterns

### Basic Usage Pattern

```typescript
import { createLock, NodeRedisAdapter } from 'redlock-universal';
import { createClient } from 'redis';

const client = createClient({ url: 'redis://localhost:6379' });
await client.connect();

const lock = createLock({
  adapter: new NodeRedisAdapter(client),
  key: 'my-resource',
  ttl: 30000,
});

const handle = await lock.acquire();
try {
  // Critical section
} finally {
  await lock.release(handle);
  await client.disconnect();
}
```

### Error Handling Pattern

```typescript
import { LockAcquisitionError } from 'redlock-universal';

try {
  const handle = await lock.acquire();
  // ... work ...
  await lock.release(handle);
} catch (error) {
  if (error instanceof LockAcquisitionError) {
    console.log('Resource is busy, try again later');
  } else {
    console.error('Unexpected error:', error);
  }
}
```

### Monitoring Pattern

```typescript
import { MetricsCollector, HealthChecker } from 'redlock-universal';

const metrics = new MetricsCollector();
const health = new HealthChecker();

// Record operations
metrics.recordLockOperation({
  acquisitionTime: 150,
  attempts: 1,
  success: true,
  key: 'my-resource',
  timestamp: Date.now(),
});

// Check health
const status = await health.checkAdapterHealth('redis-main');
console.log(`Health: ${status.healthy}, Response: ${status.responseTime}ms`);
```

## Production Considerations

### Configuration

- **TTL**: Choose appropriate lock duration for your use case
- **Retry**: Configure retries based on expected contention
- **Quorum**: Use majority consensus for distributed locks
- **Monitoring**: Enable metrics collection for production systems

### Best Practices

1. **Always use try-finally** for lock release
2. **Choose appropriate TTL** based on operation duration
3. **Handle lock contention** gracefully
4. **Monitor lock performance** in production
5. **Use health checks** for system reliability

### Troubleshooting

- **Lock acquisition fails**: Check Redis connectivity and TTL
- **High contention**: Increase retry attempts or use queuing
- **Lock expires during work**: Use lock extension
- **Partial distributed failures**: Verify quorum configuration

## Next Steps

- Review the [main documentation](../README.md) for complete API reference
- Check out [CONTRIBUTING.md](../CONTRIBUTING.md) for development guidelines  
- Explore the test files in `/tests` for more usage patterns