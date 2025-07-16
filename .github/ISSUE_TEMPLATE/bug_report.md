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
1. Go to '...'
2. Click on '....'
3. Scroll down to '....'
4. See error

## Expected Behavior
A clear and concise description of what you expected to happen.

## Actual Behavior
A clear and concise description of what actually happened.

## Environment
- **OS**: [e.g. macOS, Ubuntu, Windows]
- **Node.js version**: [e.g. 18.17.0]
- **Package version**: [e.g. 0.1.0]
- **Redis client**: [e.g. node-redis 4.7.0, ioredis 5.3.0]
- **Redis version**: [e.g. 7.0.0]

## Code Sample
```typescript
// Minimal code sample that reproduces the issue
const lock = createLock({
  client: redisClient,
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