import { randomFillSync, timingSafeEqual } from 'crypto';

/**
 * Buffer pool for crypto operations to reduce allocations
 * Reuses pre-allocated buffers with fresh random data on each call
 */
const LOCK_VALUE_BUFFER = Buffer.allocUnsafe(16);
const LOCK_ID_BUFFER = Buffer.allocUnsafe(6);

/**
 * Generate a cryptographically secure random lock value
 * Uses buffer pool with randomFillSync for zero-allocation crypto
 */
export function generateLockValue(): string {
  randomFillSync(LOCK_VALUE_BUFFER);
  return LOCK_VALUE_BUFFER.toString('hex');
}

/**
 * Generate a unique lock ID combining timestamp and random data
 * Format: timestamp-random (e.g., "1703123456789-a1b2c3d4e5f6")
 */
export function generateLockId(): string {
  const timestamp = Date.now();
  randomFillSync(LOCK_ID_BUFFER);
  const random = LOCK_ID_BUFFER.toString('hex');
  return `${timestamp}-${random}`;
}

/**
 * Buffer pool for safe comparison (max lock value length is 256 chars)
 */
const COMPARE_BUFFER_A = Buffer.allocUnsafe(256);
const COMPARE_BUFFER_B = Buffer.allocUnsafe(256);

/**
 * Compare two strings using timing-safe comparison
 * Prevents timing attacks on lock value verification
 * Uses buffer pool to reduce allocations
 */
export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const len = a.length;
  if (len > 256) {
    return false;
  }

  COMPARE_BUFFER_A.write(a, 0, len, 'utf8');
  COMPARE_BUFFER_B.write(b, 0, len, 'utf8');

  return timingSafeEqual(COMPARE_BUFFER_A.subarray(0, len), COMPARE_BUFFER_B.subarray(0, len));
}

/**
 * Buffer pool for metadata lock values
 */
const METADATA_LOCK_VALUE_BUFFER = Buffer.allocUnsafe(8);

/**
 * Create a lock value with embedded metadata
 * Format: nodeId:timestamp:random
 * Uses buffer pool to reduce allocations
 */
export function createLockValueWithMetadata(nodeId?: string): string {
  const timestamp = Date.now();
  randomFillSync(METADATA_LOCK_VALUE_BUFFER);
  const random = METADATA_LOCK_VALUE_BUFFER.toString('hex');
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
