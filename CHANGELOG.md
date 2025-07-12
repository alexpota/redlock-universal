# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial implementation of RedLock Universal library
- Support for both node-redis v4+ and ioredis v5+ clients
- Distributed locking using Redlock algorithm
- Single instance locking with SimpleLock
- Comprehensive test suite with 95%+ coverage
- TypeScript-first with strict type checking
- ESLint rules for code quality and deprecation detection
- Docker-based integration testing
- Performance benchmarks
- Retry mechanisms and error handling
- Lock extension and TTL management
- Health checks and monitoring infrastructure
- Cross-client compatibility testing

### Features
- **SimpleLock**: Single Redis instance locking
- **RedLock**: Distributed locking across multiple Redis instances
- **Universal adapters**: Works with node-redis and ioredis
- **Production-ready**: Error handling, retries, monitoring
- **Developer Experience**: TypeScript, clear APIs, comprehensive docs

## [0.1.0] - Initial Development

### Added
- Project setup and initial architecture
- Core lock implementations
- Test infrastructure
- Build and development tooling