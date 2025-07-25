# [0.5.0](https://github.com/alexpota/redlock-universal/compare/v0.4.1...v0.5.0) (2025-07-19)


### Features

* Correct distributed lock usage examples in README ([81a1cf5](https://github.com/alexpota/redlock-universal/commit/81a1cf5ba5e3c9ba4ec7e7b12b3cf95031e5b4e1))

# [0.4.1](https://github.com/alexpota/redlock-universal/compare/v0.4.0...v0.4.1) (2025-07-19)


### Bug Fixes

* Correct distributed lock usage examples in README ([81a1cf5](https://github.com/alexpota/redlock-universal/commit/81a1cf5ba5e3c9ba4ec7e7b12b3cf95031e5b4e1))

# [0.4.0](https://github.com/alexpota/redlock-universal/compare/v0.3.0...v0.4.0) (2025-07-19)


### Features

* Add professional benchmark infrastructure with competitive ([#19](https://github.com/alexpota/redlock-universal/issues/19)) ([fb8670f](https://github.com/alexpota/redlock-universal/commit/fb8670f9a6d67b4430f2a6823cffe96ee9e6b08a))

# [0.3.0](https://github.com/alexpota/redlock-universal/compare/v0.2.0...v0.3.0) (2025-07-18)


### Bug Fixes

* Disable footer line length check for semantic-release compatibility ([#15](https://github.com/alexpota/redlock-universal/issues/15)) ([c1abb0b](https://github.com/alexpota/redlock-universal/commit/c1abb0bfc154c6879f40c75464fa14268468c28b))
* Remove semantic-release/git plugin to resolve branch protection conflicts ([#18](https://github.com/alexpota/redlock-universal/issues/18)) ([fd95001](https://github.com/alexpota/redlock-universal/commit/fd95001dcb7785387d639097625e55f3166013ef))
* Use GH_TOKEN for semantic-release authentication ([#17](https://github.com/alexpota/redlock-universal/issues/17)) ([e003911](https://github.com/alexpota/redlock-universal/commit/e003911c63eded32714b783e4d2c8f6fe9062b45))
* Use PAT for semantic-release with branch protection ([#16](https://github.com/alexpota/redlock-universal/issues/16)) ([1fb9a08](https://github.com/alexpota/redlock-universal/commit/1fb9a089207af51fd353d936f660e686f4952628))


### Features

* Add code of conduct file ([#14](https://github.com/alexpota/redlock-universal/issues/14)) ([4cbacd9](https://github.com/alexpota/redlock-universal/commit/4cbacd99ffb712ebd15c927acfe697b15dc80392))

# [0.2.0](https://github.com/alexpota/redlock-universal/compare/v0.1.4...v0.2.0) (2025-07-17)


### Bug Fixes

* Add minimal GitHub Actions permissions for semantic-release ([cfdfdbc](https://github.com/alexpota/redlock-universal/commit/cfdfdbcc95361cd0aeddc5afe359ca337a987e87))
* Complete Node.js 22 upgrade across all workflows ([44df85a](https://github.com/alexpota/redlock-universal/commit/44df85a2065d7943b00625abddb3d2193223d385))
* Convert semantic-release config to JSON format ([b4872ba](https://github.com/alexpota/redlock-universal/commit/b4872ba4bf7358130f8447680cfbbbded46c2c6f))
* Disable body line length check for semantic-release compatibility ([4d34972](https://github.com/alexpota/redlock-universal/commit/4d34972d9c291bbf4fc62a1ee88c23829a193b27))
* Remove registry-url from setup-node to prevent token conflicts ([9206780](https://github.com/alexpota/redlock-universal/commit/9206780260e7064f2cf275005fdbf65ad2a318cf))
* test new npm token ([ef03941](https://github.com/alexpota/redlock-universal/commit/ef0394141715b2afc202d7e1e11b2befa6f19a4a))
* Update package description to clarify client support ([c6fb29f](https://github.com/alexpota/redlock-universal/commit/c6fb29fd6d664a6896db01023ff8a29f7e487150))


### Features

* Add semantic-release for automated versioning and publishing ([945db4d](https://github.com/alexpota/redlock-universal/commit/945db4d499936bafbb72afd609855e2b93153f95))
* Upgrade to Node.js 20 LTS ([0844eb6](https://github.com/alexpota/redlock-universal/commit/0844eb60d12162f54555daef6a28102e24c9bf71))
* Upgrade to Node.js 22 LTS for maximum future-proofing ([c5c25fa](https://github.com/alexpota/redlock-universal/commit/c5c25fafe5a3c77e265d6969490afda0f813dab4))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial implementation of redlock-universal library
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
