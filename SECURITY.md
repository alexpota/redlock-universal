# Security Policy

## Supported Versions

Security fixes are released for the latest minor version.

| Version | Supported          |
| ------- | ------------------ |
| 0.8.x   | :white_check_mark: |
| < 0.8   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in redlock-universal, please help us maintain the security of the project by reporting it responsibly.

### How to Report

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**, or go directly to [github.com/alexpota/redlock-universal/security/advisories/new](https://github.com/alexpota/redlock-universal/security/advisories/new).

Include the following information:
- Description of the vulnerability
- Steps to reproduce the issue
- Potential impact assessment
- Any suggested fixes or mitigations

### Response Timeline

- **Initial Response**: Within 48 hours of receiving your report
- **Status Update**: Weekly updates on investigation progress
- **Resolution**: Security fixes are prioritized and typically released within 7-14 days

### Disclosure Policy

- We will acknowledge receipt of your vulnerability report within 2 business days
- We will provide regular updates on our investigation and remediation timeline
- We will notify you when the vulnerability has been fixed
- We will publicly disclose the vulnerability details after a fix has been released and deployed

### Security Best Practices

When using redlock-universal in production:

1. **Redis Security**: Ensure your Redis instances are properly secured with authentication and network isolation
2. **Network Security**: Use TLS connections to Redis in production environments
3. **Access Control**: Limit Redis access to only necessary applications and services
4. **Monitoring**: Implement proper logging and monitoring of lock operations
5. **Updates**: Keep redlock-universal and its dependencies up to date

For what a lock does and does not guarantee, see [SAFETY.md](SAFETY.md).

### Security Features

- **Random lock values:** every lock type, the `lean` performance mode included, generates lock values with Node.js `crypto.randomUUID` (122 random bits).
- **Owner-checked release and extension:** a lock is only released or extended when its stored value matches the handle's value, checked atomically in a Lua script.
- **Expiring locks:** every lock is written with a TTL, so a lock held by a crashed process expires.
- **No lock values in logs:** lock values are not passed to the logger.
- **No runtime dependencies:** the Redis clients are optional peer dependencies.
- **Signed releases:** releases are published from GitHub Actions with npm trusted publishing and carry npm provenance attestations.

Thank you for helping keep redlock-universal and the Node.js ecosystem secure.
