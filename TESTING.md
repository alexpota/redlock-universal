# Testing Guide

This document explains how to run tests for RedLock Universal, including integration tests with real Redis instances using Docker.

## Quick Start

```bash
# Run all unit tests (no Redis required)
npm test

# Run tests with Docker (recommended for integration testing)
npm run test:docker

# Run tests with coverage
npm run test:coverage
```

## Test Types

### 1. Unit Tests
Fast tests that don't require Redis instances:

```bash
npm test tests/utils/                    # Crypto utilities
npm test tests/adapters/BaseAdapter.test.ts  # Adapter validation
```

### 2. Integration Tests
Tests that require real Redis instances:

```bash
npm test tests/adapters/integration.test.ts  # Redis adapter tests
npm test tests/locks/SimpleLock.test.ts       # SimpleLock with Redis
npm test tests/locks/RedLock.test.ts          # RedLock with Redis
```

### 3. Docker-Based Testing (Recommended)

#### Full Integration Testing
```bash
# Runs comprehensive tests with 5 Redis instances
npm run test:docker
```

This script:
- Starts 5 Redis containers (ports 6379-6383)
- Waits for all instances to be healthy
- Runs all integration tests
- Runs coverage reports
- Cleans up containers automatically

#### Manual Docker Control
```bash
# Start Redis cluster
npm run test:redis:up

# Run tests against the cluster
npm test

# Stop and cleanup
npm run test:redis:down
```

#### Using Docker Compose Directly
```bash
# Start all services including test runner
npm run test:integration

# Or run specific services
docker-compose -f docker-compose.test.yml up -d redis-1 redis-2 redis-3
```

## Test Configuration

### Environment Variables
For integration tests, you can configure Redis connections:

```bash
export REDIS_1_HOST=localhost
export REDIS_1_PORT=6379
export REDIS_2_HOST=localhost
export REDIS_2_PORT=6380
export REDIS_3_HOST=localhost
export REDIS_3_PORT=6381
export REDIS_4_HOST=localhost
export REDIS_4_PORT=6382
export REDIS_5_HOST=localhost
export REDIS_5_PORT=6383
export NODE_ENV=test

npm test
```

### Redis Cluster Setup
The Docker setup provides:
- **redis-1**: localhost:6379 (primary)
- **redis-2**: localhost:6380 (secondary)
- **redis-3**: localhost:6381 (tertiary)
- **redis-4**: localhost:6382 (quaternary)
- **redis-5**: localhost:6383 (quinary)

All instances are configured with:
- Persistence enabled (AOF)
- Health checks
- Automatic restart on failure

## Development Workflow

### 1. During Development
```bash
# Watch mode - reruns tests on file changes
npm run test:watch

# Start Redis cluster in background
npm run test:redis:up

# Run specific test files
npm test SimpleLock.test.ts
npm test RedLock.test.ts
```

### 2. Before Committing
```bash
# Full validation (automatic via pre-commit hook)
npm run validate

# Or run Docker integration tests
npm run test:docker
```

### 3. CI/CD Pipeline
GitHub Actions runs:
- Unit tests on Node.js 18, 20, 22
- Integration tests with Redis services
- Docker-based comprehensive tests
- Security and quality checks

## Test Structure

```
tests/
├── adapters/
│   ├── BaseAdapter.test.ts      # Unit tests
│   └── integration.test.ts      # Redis integration tests
├── locks/
│   ├── SimpleLock.test.ts       # Single Redis tests
│   └── RedLock.test.ts          # Distributed lock tests
├── utils/
│   └── crypto.test.ts           # Utility tests
└── benchmarks/                  # Performance tests (future)
```

## Writing Tests

### Unit Tests
Use mocks for external dependencies:

```typescript
import { vi } from 'vitest';

const mockAdapter = {
  setNX: vi.fn().mockResolvedValue('OK'),
  get: vi.fn().mockResolvedValue('test-value'),
  // ...
};
```

### Integration Tests
Use real Redis connections:

```typescript
import { createClient } from 'redis';
import { NodeRedisAdapter } from '../src/adapters/index.js';

const redis = createClient({ socket: { port: 6379 } });
await redis.connect();

const adapter = new NodeRedisAdapter(redis);
// Test with real Redis...
```

### RedLock Tests
Test distributed scenarios:

```typescript
const adapters = [
  new NodeRedisAdapter(redis1),
  new NodeRedisAdapter(redis2),
  new NodeRedisAdapter(redis3),
];

const redlock = new RedLock({
  adapters,
  key: 'test-resource',
  quorum: 2,
});
```

## Troubleshooting

### Docker Issues
```bash
# Check Redis container status
docker-compose -f docker-compose.test.yml ps

# View logs
docker-compose -f docker-compose.test.yml logs redis-1

# Reset everything
docker-compose -f docker-compose.test.yml down -v
docker system prune -f
```

### Port Conflicts
If ports 6379-6383 are in use:

```bash
# Find processes using Redis ports
lsof -i :6379
lsof -i :6380

# Kill conflicting processes
sudo kill -9 <PID>

# Or modify docker-compose.test.yml to use different ports
```

### Test Failures
```bash
# Run with verbose output
npm test -- --reporter=verbose

# Run specific test with debug info
DEBUG=* npm test RedLock.test.ts

# Check Redis connectivity
redis-cli -p 6379 ping
redis-cli -p 6380 ping
```

## Performance Testing

### Benchmarks
```bash
# Run performance benchmarks (when available)
npm run benchmark

# Compare with other libraries
npm run benchmark:compare
```

### Load Testing
```bash
# Start Redis cluster
npm run test:redis:up

# Run load tests
npm run test:load

# Monitor Redis performance
redis-cli --latency -p 6379
```

## Coverage Reports

```bash
# Generate coverage report
npm run test:coverage

# View HTML report
open coverage/index.html

# Upload to Codecov (CI)
npx codecov
```

## Best Practices

1. **Always use Docker for integration tests** - ensures consistent environment
2. **Clean up Redis state** between tests using `FLUSHALL` or separate databases
3. **Test both success and failure scenarios** - network errors, timeouts, etc.
4. **Use realistic TTL values** in tests (not too short to cause flaky tests)
5. **Test concurrent scenarios** - multiple processes trying to acquire same lock
6. **Verify lock cleanup** - ensure locks are properly released on failures

## Common Test Patterns

### Testing Lock Contention
```typescript
it('should handle lock contention', async () => {
  const lock1 = createLock({ adapter, key: 'resource' });
  const lock2 = createLock({ adapter, key: 'resource' });
  
  const handle1 = await lock1.acquire();
  
  await expect(lock2.acquire()).rejects.toThrow(LockAcquisitionError);
  
  await lock1.release(handle1);
  const handle2 = await lock2.acquire(); // Should succeed now
  
  await lock2.release(handle2);
});
```

### Testing Distributed Quorum
```typescript
it('should require quorum for acquisition', async () => {
  // Fail 2 out of 5 nodes
  adapters[3].shouldFail = true;
  adapters[4].shouldFail = true;
  
  // Should still succeed with 3/5 nodes (quorum = 3)
  const handle = await redlock.acquire();
  expect(handle.metadata.nodes).toHaveLength(3);
});
```

### Testing Clock Drift
```typescript
it('should handle clock drift', async () => {
  // Simulate slow network
  adapters.forEach(adapter => adapter.simulateLatency = 1000);
  
  const redlock = createRedlock({
    adapters,
    key: 'test',
    ttl: 2000, // Short TTL
    clockDriftFactor: 0.01,
  });
  
  await expect(redlock.acquire()).rejects.toThrow(LockAcquisitionError);
});
```