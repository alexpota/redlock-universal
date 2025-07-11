# Test Structure

This directory contains comprehensive tests for the RedLock Universal library, organized following Node.js best practices and the guidelines from CLAUDE.md.

## Test Organization

### 📁 `/unit` - Unit Tests (30% of tests)
Fast tests with mocked dependencies. No external services required.

- **`/adapters`** - Redis adapter unit tests
  - `BaseAdapter.test.ts` - Base adapter functionality
  - `NodeRedisAdapter.test.ts` - node-redis adapter (mocked)
  - `IoredisAdapter.test.ts` - ioredis adapter (mocked)

- **`/locks`** - Lock implementation unit tests
  - `SimpleLock.test.ts` - SimpleLock with mocked adapter
  - `RedLock.test.ts` - RedLock with mocked adapters

- **`/utils`** - Utility function tests
  - `crypto.test.ts` - Cryptographic utilities

### 📁 `/integration` - Integration Tests (50% of tests)
Tests individual components with real Redis instances. Require Docker or local Redis.

- **`/adapters`** - Real Redis adapter tests
  - `redis-adapters.integration.test.ts` - Both adapters with real Redis

- **`/locks`** - Lock tests with real Redis
  - `SimpleLock.integration.test.ts` - SimpleLock with real Redis
  - `RedLock.integration.test.ts` - Distributed locking with real Redis

### 📁 `/e2e` - End-to-End Tests (10% of tests)
Complete user workflows and developer experience tests.

- `lock-lifecycle.e2e.test.ts` - Complete lock lifecycle scenarios
- `developer-experience.e2e.test.ts` - Real-world usage patterns

### 📁 `/benchmarks` - Performance Tests (10% of tests)
Performance and benchmark tests for optimization.

- **`/locks`** - Lock performance benchmarks
  - `SimpleLock.benchmark.test.ts` - SimpleLock performance targets

## Running Tests

### Quick Commands
```bash
# All tests
npm test

# Fast unit tests only (no Redis required)
npm run test:unit

# Integration tests (requires Redis)
npm run test:integration

# End-to-end tests (requires Redis)
npm run test:e2e

# Performance benchmarks
npm run test:benchmarks

# With coverage
npm run test:coverage
```

### Docker-based Testing
```bash
# Complete test suite with Docker Redis
npm run test:docker

# Start Redis containers manually
npm run test:redis:up
npm run test:integration
npm run test:redis:down
```

### Watch Mode
```bash
# Watch unit tests during development
npm run test:unit:watch

# Watch integration tests
npm run test:integration:watch

# Watch E2E tests
npm run test:e2e:watch
```

## Test Philosophy

Following CLAUDE.md guidelines:

### 🎯 **Test Behavior, Not Implementation**
- Focus on what the code does, not how it does it
- Test public APIs and contracts
- Mock external dependencies appropriately

### ⚡ **Fast Unit Tests, Comprehensive Integration Tests**
- Unit tests: <50ms per test, mocked dependencies
- Integration tests: Real Redis, focus on correctness
- Clear separation between test types

### 📝 **Clear Test Names**
Test names describe the scenario being tested:

```typescript
// ✅ Good: Describes behavior and expected outcome
it('should return false when lock value does not match during extension')

// ❌ Bad: Describes implementation details
it('should call extendIfMatch with correct parameters')
```

### 🏗️ **Independent Tests**
- Each test can run in isolation
- Tests don't depend on other tests
- Clean setup/teardown for each test

## Test Patterns

### Unit Test Pattern
```typescript
describe('ComponentName Unit Tests', () => {
  let mockDependency: MockType;
  let component: ComponentType;

  beforeEach(() => {
    mockDependency = createMock();
    component = new ComponentType(mockDependency);
  });

  describe('methodName', () => {
    it('should do expected behavior when given valid input', async () => {
      // Arrange
      mockDependency.method.mockResolvedValue(expectedResult);
      
      // Act
      const result = await component.methodName(validInput);
      
      // Assert
      expect(result).toBe(expectedResult);
      expect(mockDependency.method).toHaveBeenCalledWith(validInput);
    });
  });
});
```

### Integration Test Pattern
```typescript
describe('ComponentName Integration Tests', () => {
  beforeAll(async () => {
    // Setup real dependencies (Redis, etc.)
  });

  afterAll(async () => {
    // Cleanup real dependencies
  });

  beforeEach(async () => {
    // Clean state for each test
  });

  it('should handle complete workflow end-to-end', async () => {
    // Test real behavior with real dependencies
  });
});
```

## Performance Targets

From CLAUDE.md requirements:

- **Lock Acquisition**: <1ms (99th percentile)
- **Throughput**: >100 operations/second
- **Memory**: No leaks during repeated operations
- **Reliability**: >99.9% success rate

## Debugging Tests

### Common Issues

1. **Redis Connection Errors**: Ensure Redis is running or use Docker
2. **Timing Issues**: Use proper async/await patterns
3. **Test Isolation**: Each test should clean up after itself

### Debug Commands
```bash
# Run specific test file
npm test -- SimpleLock.test.ts

# Run with verbose output
npm test -- --reporter=verbose

# Debug with Node.js debugger
node --inspect-brk ./node_modules/.bin/vitest --run specific.test.ts
```

## Contributing

When adding new tests:

1. **Choose the right category**: Unit vs Integration vs Benchmark
2. **Follow naming conventions**: `ComponentName.test.ts` for unit, `ComponentName.integration.test.ts` for integration
3. **Test behavior, not implementation**
4. **Keep tests fast and independent**
5. **Add performance tests for critical paths**

## Test Configuration

Tests are configured in:
- `vitest.config.ts` - Main test configuration
- `tsconfig.test.json` - TypeScript config for tests
- `package.json` - Test scripts and dependencies