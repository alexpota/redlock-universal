---
name: Bug Report
about: Create a report to help us improve
title: '[BUG] '
labels: bug
assignees: alexpota
---

## Bug Description
A clear and concise description of what the bug is.

## Steps to Reproduce
1. Create the client and adapter (see Code Sample)
2. Call '...'
3. See error

## Expected Behavior
A clear and concise description of what you expected to happen.

## Actual Behavior
A clear and concise description of what actually happened.

## Environment
- **OS**: [e.g. macOS, Ubuntu, Windows]
- **Node.js version**: [e.g. 22.12.0]
- **Package version**: [e.g. 0.8.5]
- **Redis client**: [e.g. node-redis 5.9.0, ioredis 5.11.1, @valkey/valkey-glide 2.4.2]
- **Server version**: [e.g. Redis 7.4.3, Valkey 8.1.0]

## Code Sample
```typescript
// Minimal code sample that reproduces the issue
const lock = createLock({
  adapter: new NodeRedisAdapter(redisClient),
  key: 'test-key',
  ttl: 30000
});

// What you did that caused the bug
```

## Error Messages
```
// Any error messages or stack traces
```

## Additional Context
Add any other context about the problem here.