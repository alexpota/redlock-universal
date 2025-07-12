# Security Policy

## Supported Versions

We take security seriously and provide security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in redlock-universal, please help us maintain the security of the project by reporting it responsibly.

### How to Report

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please send an email to: **alex.potapenko.dev@gmail.com**

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

### Security Features

redlock-universal includes several security-conscious design decisions:

- **Cryptographically secure lock identifiers** using Node.js crypto module
- **Time-based lock expiration** to prevent indefinite resource locking
- **No sensitive data logging** in production builds
- **Zero runtime dependencies** to minimize supply chain risks
- **Strict TypeScript** compilation to catch potential issues at build time

Thank you for helping keep redlock-universal and the Node.js ecosystem secure.