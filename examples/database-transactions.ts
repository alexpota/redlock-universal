/**
 * Database Transaction Protection Example
 *
 * This example demonstrates how to use redlock-universal to protect
 * database transactions from concurrent modifications, ensuring data
 * consistency in distributed systems.
 */

import { createLock, NodeRedisAdapter } from 'redlock-universal';
import { createClient } from 'redis';

// Mock database functions for demonstration
async function getBalance(userId: string): Promise<number> {
  // Simulate database lookup
  console.log(`Fetching balance for user ${userId}`);
  return 1000; // Mock balance
}

async function validateTransfer(amount: number): Promise<void> {
  // Simulate business logic validation
  console.log(`Validating transfer amount: $${amount}`);
  await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second validation
}

async function updateBalance(userId: string, newBalance: number): Promise<void> {
  // Simulate database update
  console.log(`Updating user ${userId} balance to $${newBalance}`);
  await new Promise(resolve => setTimeout(resolve, 500));
}

async function protectedBankTransfer() {
  // Setup Redis client
  const client = createClient({ url: 'redis://localhost:6379' });
  await client.connect();

  const userId = '123';
  const transferAmount = 250;

  // Create lock for user's account
  const transactionLock = createLock({
    adapter: new NodeRedisAdapter(client),
    key: `user-balance:${userId}`,
    ttl: 15000, // 15 seconds initial TTL
  });

  try {
    const result = await transactionLock.using(async signal => {
      console.log('🔒 Transaction lock acquired');

      // Begin transaction
      const currentBalance = await getBalance(userId);
      console.log(`Current balance: $${currentBalance}`);

      // Check if user has sufficient funds
      if (currentBalance < transferAmount) {
        throw new Error('Insufficient funds');
      }

      // Long calculation/validation (this will trigger auto-extension)
      await validateTransfer(transferAmount);

      // Check if lock is still held after long operation
      if (signal.aborted) {
        throw new Error('Transaction aborted - lock lost during validation');
      }

      // Complete transaction
      const newBalance = currentBalance - transferAmount;
      await updateBalance(userId, newBalance);

      console.log(`✅ Transfer completed: $${transferAmount} deducted`);
      return {
        status: 'success',
        previousBalance: currentBalance,
        newBalance,
        transferAmount,
      };
    });

    console.log('Transaction result:', result);
  } catch (error) {
    console.error('❌ Transaction failed:', error);
  } finally {
    await client.disconnect();
  }
}

// Run the example
if (require.main === module) {
  protectedBankTransfer()
    .then(() => console.log('Example completed'))
    .catch(console.error);
}

export { protectedBankTransfer };
