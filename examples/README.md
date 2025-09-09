# redlock-universal Examples

This directory contains practical examples demonstrating how to use redlock-universal in various scenarios.

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

### Real-World Implementation Patterns

#### 1. Database Transactions (`database-transactions.ts`)

Protecting critical database operations from concurrent modifications.

```bash
npx tsx examples/database-transactions.ts
```

**Demonstrates**:
- Account balance protection during transfers
- Long-running validation with auto-extension
- Business logic error handling
- Signal monitoring for lock failures

#### 2. Distributed Cache Warming (`cache-warming.ts`)

Coordinated cache warming across multiple Redis instances.

```bash
npx tsx examples/cache-warming.ts
```

**Demonstrates**:
- Distributed lock coordination with quorum
- Long-running operations with auto-extension
- Graceful handling of quorum loss
- Progress tracking across multiple data sources

**Requirements**: Multiple Redis instances on ports 6379, 6380, 6381

#### 3. Job Processing (`job-processing.ts`)

Background job processing with progress tracking and cancellation.

```bash
npx tsx examples/job-processing.ts
```

**Demonstrates**:
- Lock-protected job processing
- Progress tracking and error recovery
- Graceful cancellation handling
- Performance monitoring and statistics

### Core Usage Patterns

#### 4. Simple Lock Usage (`simple-lock-usage.ts`)

Basic single-instance locking patterns.

```bash
npx tsx examples/simple-lock-usage.ts
```

**Demonstrates**:
- Creating locks with NodeRedisAdapter
- Basic acquire/release patterns
- Error handling strategies

#### 5. Distributed Lock (RedLock) (`redlock-usage.ts`)

Multi-instance distributed locking using the Redlock algorithm.

```bash
npx tsx examples/redlock-usage.ts
```

**Demonstrates**:
- Creating distributed locks across multiple Redis instances
- Quorum-based consensus mechanisms
- Handling partial failures gracefully

**Requirements**: Multiple Redis instances running

#### 6. Lock Extension Patterns (`lock-extension.ts`)

Manual extension strategies for long-running operations.

```bash
npx tsx examples/lock-extension.ts
```

**Demonstrates**:
- Manual lock extension during long operations
- Extension timing strategies
- Preventing lock expiration during work

#### 7. Retry Strategies (`lock-with-retry.ts`)

Handling contested resources with sophisticated retry logic.

```bash
npx tsx examples/lock-with-retry.ts
```

**Demonstrates**:
- Configuring retry attempts and delays
- Handling lock contention effectively
- Simulating multiple competing processes

#### 8. Monitoring & Observability (`monitoring.ts`)

Production monitoring and observability features.

```bash
npx tsx examples/monitoring.ts
```

**Demonstrates**:
- Metrics collection and analysis
- Health checking for adapters
- Structured logging integration
- Performance monitoring techniques

#### 9. Adapter Usage (`adapter-usage.ts`)

Redis client integration patterns.

```bash
npx tsx examples/adapter-usage.ts
```

**Demonstrates**:
- NodeRedisAdapter configuration
- IoredisAdapter usage patterns
- Client connection management
- Adapter-specific optimizations

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