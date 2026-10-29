import { randomFillSync, randomUUID, timingSafeEqual } from 'crypto';

/**
 * Dash positions in a UUID string: 32 hex characters in groups of 8-4-4-4-12
 */
const UUID_DASH_1 = 8;
const UUID_DASH_2 = 13;
const UUID_DASH_3 = 18;
const UUID_DASH_4 = 23;

/**
 * Generate a cryptographically secure random lock value: 32 hex characters (122 random bits)
 * from crypto.randomUUID, which draws on a pre-generated pool of random bytes
 */
export function generateLockValue(): string {
  const uuid = randomUUID();
  return (
    uuid.slice(0, UUID_DASH_1) +
    uuid.slice(UUID_DASH_1 + 1, UUID_DASH_2) +
    uuid.slice(UUID_DASH_2 + 1, UUID_DASH_3) +
    uuid.slice(UUID_DASH_3 + 1, UUID_DASH_4) +
    uuid.slice(UUID_DASH_4 + 1)
  );
}

/**
 * Generate a unique lock ID combining timestamp and random data
 * Format: timestamp-random (e.g., "1703123456789-a1b2c3d4e5f6")
 */
export function generateLockId(): string {
  // The last UUID group is 12 random hex characters
  return `${Date.now()}-${randomUUID().slice(UUID_DASH_4 + 1)}`;
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
