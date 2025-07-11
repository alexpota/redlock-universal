import { randomBytes, timingSafeEqual } from 'crypto';

/**
 * Generate a cryptographically secure random lock value
 * Uses Node.js crypto.randomBytes for security
 */
export function generateLockValue(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Generate a unique lock ID combining timestamp and random data
 * Format: timestamp-random (e.g., "1703123456789-a1b2c3d4e5f6")
 */
export function generateLockId(): string {
  const timestamp = Date.now();
  const random = randomBytes(6).toString('hex');
  return `${timestamp}-${random}`;
}

/**
 * Compare two strings using timing-safe comparison
 * Prevents timing attacks on lock value verification
 */
export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');

  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Create a lock value with embedded metadata
 * Format: nodeId:timestamp:random
 */
export function createLockValueWithMetadata(nodeId?: string): string {
  const timestamp = Date.now();
  const random = randomBytes(8).toString('hex');
  const node = nodeId || 'node';

  return `${node}:${timestamp}:${random}`;
}

/**
 * Parse lock value metadata if it was created with createLockValueWithMetadata
 */
export function parseLockValue(value: string): {
  nodeId: string;
  timestamp: number;
  random: string;
} | null {
  const parts = value.split(':');

  if (parts.length !== 3) {
    return null;
  }

  const [nodeId, timestampStr, random] = parts;

  if (!nodeId || !timestampStr || !random) {
    return null;
  }

  if (!/^\d+$/.test(timestampStr)) {
    return null;
  }

  const timestamp = parseInt(timestampStr, 10);

  if (isNaN(timestamp)) {
    return null;
  }

  return { nodeId, timestamp, random };
}

/**
 * Validate that a lock value is properly formatted
 */
export function isValidLockValue(value: string): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }

  if (value.length < 8 || value.length > 256) {
    return false;
  }

  if (value.includes('\n') || value.includes('\r') || value.includes('\0')) {
    return false;
  }

  return true;
}
