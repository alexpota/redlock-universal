# RedLock Universal

> Production-ready distributed Redis locks for Node.js with support for both node-redis and ioredis

## Status: 🚧 Under Development

This library is currently in active development. Not ready for production use.

## Overview

RedLock Universal provides a modern, TypeScript-first implementation of distributed Redis locks using the Redlock algorithm. It supports both popular Redis clients (node-redis and ioredis) through a unified API.

## Features (Planned)

- 🔒 **Distributed Locks**: True Redlock algorithm for multi-instance Redis
- 🔌 **Client Universal**: Works with both node-redis and ioredis
- 🏢 **Production Ready**: Monitoring, metrics, observability
- 🚀 **Modern DX**: TypeScript-first, excellent error handling
- ⚡ **High Performance**: Optimized for low latency and high throughput
- 🛡️ **Battle-Tested**: Based on Redis official Redlock specification

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build library
npm run build

# Run in development mode
npm run dev
```

## License

MIT © Alex Potapenko