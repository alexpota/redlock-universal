/**
 * Batch Lock Acquisition Examples
 *
 * Demonstrates atomic multi-resource locking with all-or-nothing semantics.
 */

import { createClient } from 'redis';
import { LockManager, NodeRedisAdapter, LockAcquisitionError } from '../src/index.js';

async function main() {
  const client = createClient({ url: 'redis://localhost:6379' });
  await client.connect();

  const adapter = new NodeRedisAdapter(client);
  const manager = new LockManager({
    nodes: [adapter],
    defaultTTL: 30000,
  });

  // Example 1: Basic batch acquisition
  console.log('\n=== Basic Batch Acquisition ===\n');

  const handles = await manager.acquireBatch(['user:123', 'account:456', 'order:789']);
  console.log(`Acquired ${handles.length} locks atomically`);

  await processTransaction();

  await manager.releaseBatch(handles);
  console.log('Released all locks');

  // Example 2: Batch with auto-extension
  console.log('\n=== Batch with Auto-Extension ===\n');

  await manager.usingBatch(['inventory:item1', 'inventory:item2'], async signal => {
    // Locks acquired and will auto-extend during long operations
    await processLongRunningTask();

    if (signal.aborted) {
      throw new Error('Lock extension failed');
    }

    return 'complete';
  });
  // Locks automatically released

  // Example 3: Atomic failure handling
  console.log('\n=== Atomic Failure (All-or-Nothing) ===\n');

  const blocker = await manager.acquireLock('payment:gateway');

  try {
    await manager.acquireBatch(['user:789', 'payment:gateway', 'transaction:456']);
  } catch (error) {
    if (error instanceof LockAcquisitionError) {
      console.log(`Failed: "${error.key}" already locked`);
      console.log('None of the locks were acquired (atomic guarantee)');
    }
  }

  await manager.releaseLock(blocker);

  // Example 4: Multi-account transfer
  console.log('\n=== Multi-Account Transfer ===\n');

  await multiAccountTransfer(manager, 'account:alice', 'account:bob', 100);

  // Example 5: Performance comparison
  console.log('\n=== Performance: Sequential vs Batch ===\n');

  await performanceComparison(manager);

  await client.disconnect();
}

async function multiAccountTransfer(
  manager: LockManager,
  from: string,
  to: string,
  amount: number
): Promise<void> {
  // Sort keys to prevent deadlocks
  const keys = [from, to].sort();

  await manager.usingBatch(keys, async signal => {
    // Check balances
    await checkBalance(from, amount);

    // Perform transfer
    await debitAccount(from, amount);
    await creditAccount(to, amount);

    if (signal.aborted) {
      throw new Error('Transfer aborted');
    }

    console.log(`Transferred $${amount} from ${from} to ${to}`);
  });
}

async function performanceComparison(manager: LockManager): Promise<void> {
  const keys = Array.from({ length: 5 }, (_, i) => `perf:${i}`);

  // Sequential: N round-trips
  const t1 = Date.now();
  const seq = [];
  for (const key of keys) {
    seq.push(await manager.acquireLock(key));
  }
  const seqTime = Date.now() - t1;
  await Promise.all(seq.map(h => manager.releaseLock(h)));

  // Batch: 1 round-trip (atomic Lua script)
  const t2 = Date.now();
  const batch = await manager.acquireBatch(keys);
  const batchTime = Date.now() - t2;
  await manager.releaseBatch(batch);

  console.log(`Sequential (${keys.length} locks): ${seqTime}ms`);
  console.log(`Batch (${keys.length} locks):      ${batchTime}ms`);
  console.log(`Speedup: ${(seqTime / batchTime).toFixed(2)}x`);
}

// Mock functions
async function processTransaction(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 100));
}

async function processLongRunningTask(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 2000));
}

async function checkBalance(_account: string, _amount: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 50));
}

async function debitAccount(_account: string, _amount: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 50));
}

async function creditAccount(_account: string, _amount: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 50));
}

main().catch(console.error);
