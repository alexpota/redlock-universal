# Contributing to redlock-universal

We love your input! We want to make contributing to redlock-universal as easy and transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features
- Becoming a maintainer

## Development Process

We use GitHub to host code, to track issues and feature requests, as well as accept pull requests.

### Pull Requests

Pull requests are the best way to propose changes to the codebase. We actively welcome your pull requests:

1. **Fork the repo** and create your branch from `main`
2. **Install dependencies**: `npm install`
3. **Make your changes** following our coding standards
4. **Add tests** if you've added code that should be tested
5. **Ensure the test suite passes**: `npm test`
6. **Run linting**: `npm run lint`
7. **Update documentation** if needed
8. **Submit your pull request**

### Development Setup

```bash
# Clone your fork
git clone https://github.com/your-username/redlock-universal.git
cd redlock-universal

# Install dependencies
npm install

# Start Redis for testing (using Docker)
docker run -d -p 6379:6379 redis:7-alpine

# Run tests
npm test

# Run integration tests
npm run test:integration

# Start development mode
npm run dev
```

## Code Style

### TypeScript Guidelines

- **Strict Mode**: All code must pass TypeScript strict mode
- **No `any`**: Use `unknown` or proper types instead
- **Explicit Types**: For public APIs, be explicit about types
- **Readonly**: Use `readonly` for configuration objects

```typescript
// ✅ Good
interface LockConfig {
  readonly key: string;
  readonly ttl?: number;
}

// ❌ Bad
interface LockConfig {
  key: any;
  ttl: number;
}
```

### Code Quality

- **Single Responsibility**: Each function/class should do one thing well
- **No Side Effects**: Functions should be pure when possible
- **Error Handling**: Always handle errors explicitly
- **Performance**: Consider memory allocations and hot paths

```typescript
// ✅ Good: Clear, single purpose
async function acquireLock(key: string, ttl: number): Promise<LockHandle> {
  const result = await this.adapter.setNX(key, this.value, ttl);
  if (result !== 'OK') {
    throw new LockAcquisitionError(key);
  }
  return new LockHandle(key, this.value);
}

// ❌ Bad: Multiple responsibilities, unclear
async function doLockStuff(params: any): Promise<any> {
  // Multiple operations mixed together
}
```

### Testing Standards

- **Test Behavior**: Test what the code does, not how it does it
- **Descriptive Names**: Test names should describe the scenario
- **Independent Tests**: Each test should be able to run in isolation
- **Mock External Dependencies**: Use mocks for Redis in unit tests

```typescript
// ✅ Good test
describe('SimpleLock', () => {
  it('should acquire lock when Redis SET NX succeeds', async () => {
    const mockAdapter = createMockAdapter({ setNX: () => 'OK' });
    const lock = new SimpleLock(mockAdapter, { key: 'test', ttl: 1000 });
    
    const handle = await lock.acquire();
    
    expect(handle).toBeDefined();
    expect(mockAdapter.setNX).toHaveBeenCalledWith('test', expect.any(String), 1000);
  });
});
```

## Testing

### Running Tests

```bash
# Unit tests only (fast)
npm test

# All tests including integration
npm run test:all

# Tests with coverage
npm run test:coverage

# Integration tests with Redis
npm run test:integration

# Docker-based comprehensive tests
npm run test:docker
```

### Test Categories

1. **Unit Tests** (`tests/unit/`): Fast tests with mocked dependencies
2. **Integration Tests** (`tests/integration/`): Tests with real Redis instances  
3. **E2E Tests** (`tests/e2e/`): Full system tests with multiple Redis nodes

### Writing New Tests

- **Unit tests** for core logic and error handling
- **Integration tests** for Redis adapter functionality
- **E2E tests** for distributed lock scenarios

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

feat(locks): add lock extension functionality
fix(adapters): handle connection errors gracefully
docs(readme): update installation instructions
test(redis): add integration tests for RedLock
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Adding or updating tests
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `style`: Code style changes
- `ci`: CI/CD changes

## Issue Reporting

### Bug Reports

Great bug reports include:

1. **Summary**: Clear, specific description
2. **Environment**: Node.js version, Redis version, OS
3. **Steps to reproduce**: Minimal code example
4. **Expected behavior**: What should happen
5. **Actual behavior**: What actually happens
6. **Additional context**: Logs, screenshots, etc.

**Bug Report Template**:
```markdown
## Bug Description
Brief description of the issue

## Environment
- Node.js version: 
- Redis version:
- OS:
- Library version:

## Reproduction Steps
1. Step one
2. Step two
3. Step three

## Expected Behavior
What should happen

## Actual Behavior
What actually happens

## Code Example
```typescript
// Minimal code to reproduce the issue
```

## Feature Requests

Feature requests should include:

1. **Problem**: What problem does this solve?
2. **Solution**: Proposed solution or API
3. **Alternatives**: Other solutions considered
4. **Additional context**: Use cases, examples

## Code Review Process

### For Contributors

- Respond to feedback within a reasonable time
- Keep discussions focused and constructive
- Update your PR based on feedback
- Ensure CI passes before requesting review

### For Maintainers

- Review PRs within 48 hours when possible
- Provide constructive, specific feedback
- Focus on code quality, performance, and maintainability
- Ensure tests and documentation are adequate

## Performance Guidelines

### Optimization Principles

- **Measure first**: Profile before optimizing
- **Hot path focus**: Optimize common operations
- **Memory conscious**: Avoid unnecessary allocations
- **Async best practices**: Proper promise handling

### Benchmarking

```bash
# Run performance benchmarks
npm run benchmark

# Profile specific operations
npm run profile:locks
```

## Documentation

### API Documentation

- Use TSDoc for all public APIs
- Include code examples
- Document error conditions
- Explain complex algorithms

```typescript
/**
 * Acquires a distributed lock using the Redlock algorithm.
 * 
 * @param key - Unique identifier for the resource to lock
 * @param ttl - Time to live in milliseconds
 * @returns Promise that resolves with lock handle
 * @throws {LockAcquisitionError} When unable to acquire majority consensus
 * 
 * @example
 * ```typescript
 * const handle = await redlock.acquire('user:123', 30000);
 * try {
 *   // Critical section
 * } finally {
 *   await redlock.release(handle);
 * }
 * ```
 */
async acquire(key: string, ttl: number): Promise<LockHandle>
```

### README Updates

When adding features:
- Update installation instructions if needed
- Add API documentation
- Include usage examples
- Update feature comparison table

## Release Process

### Version Bumping

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

### Release Checklist

- [ ] All tests pass
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
- [ ] Version bumped in package.json
- [ ] Git tag created
- [ ] npm package published

## Getting Help

### Resources

- **Documentation**: Comprehensive API docs in README
- **Examples**: Check `examples/` directory
- **Tests**: Look at test files for usage patterns
- **Issues**: Search existing issues first

### Communication

- **GitHub Issues**: Bug reports and feature requests
- **GitHub Discussions**: General questions and ideas
- **Email**: Maintainer contact for security issues

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Recognition

Contributors will be recognized in:
- Repository contributors list
- Release notes for significant contributions
- Documentation credits

Thank you for contributing to redlock-universal! 🚀