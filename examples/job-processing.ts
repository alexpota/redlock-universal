/**
 * Job Processing with Progress Tracking Example
 *
 * This example demonstrates using locks for background job processing
 * with progress tracking, cancellation handling, and automatic
 * lock extension for long-running jobs.
 */

import { createLock, IoredisAdapter } from 'redlock-universal';
import Redis from 'ioredis';

// Mock job interfaces
interface JobItem {
  id: string;
  type: 'email' | 'report' | 'export' | 'analysis';
  data: Record<string, any>;
  priority: number;
}

interface JobProgress {
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  processed: number;
  total: number;
  currentItem?: string;
  errors: string[];
  startTime: number;
  endTime?: number;
}

async function getJobItems(jobId: string): Promise<JobItem[]> {
  // Simulate fetching job items from database
  console.log(`📋 Fetching items for job ${jobId}`);

  return Array.from({ length: 100 }, (_, i) => ({
    id: `item-${i + 1}`,
    type: ['email', 'report', 'export', 'analysis'][i % 4] as JobItem['type'],
    data: { index: i, jobId },
    priority: Math.floor(Math.random() * 5) + 1,
  }));
}

async function processJobItem(item: JobItem): Promise<void> {
  // Simulate processing different types of items
  const processingTime = {
    email: 500, // 0.5 seconds
    report: 2000, // 2 seconds
    export: 3000, // 3 seconds
    analysis: 5000, // 5 seconds
  };

  console.log(`  ⚙️  Processing ${item.type} ${item.id}`);

  // Simulate processing time
  await new Promise(resolve => setTimeout(resolve, processingTime[item.type]));

  // Simulate occasional failures (5% failure rate)
  if (Math.random() < 0.05) {
    throw new Error(`Failed to process ${item.id}: Random processing error`);
  }
}

async function jobProcessingWithProgress() {
  // Setup Redis client (using ioredis for this example)
  const client = new Redis({
    host: 'localhost',
    port: 6379,
    maxRetriesPerRequest: 3,
  });

  const jobId = `job-${Date.now()}`;

  // Create lock for job processing
  const jobLock = createLock({
    adapter: new IoredisAdapter(client),
    key: `job-processing:${jobId}`,
    ttl: 120000, // 2 minutes initial TTL (will auto-extend)
  });

  try {
    const progress = await jobLock.using(async signal => {
      console.log(`🔒 Job lock acquired for ${jobId}`);

      const items = await getJobItems(jobId);
      const jobProgress: JobProgress = {
        status: 'running',
        processed: 0,
        total: items.length,
        errors: [],
        startTime: Date.now(),
      };

      console.log(`🚀 Starting job processing: ${items.length} items to process`);

      for (const [_index, item] of items.entries()) {
        jobProgress.currentItem = item.id;

        try {
          await processJobItem(item);
          jobProgress.processed++;

          // Log progress every 10 items or on significant milestones
          if (jobProgress.processed % 10 === 0 || jobProgress.processed === items.length) {
            const percentage = Math.round((jobProgress.processed / items.length) * 100);
            console.log(`📊 Progress: ${jobProgress.processed}/${items.length} (${percentage}%)`);
          }
        } catch (error) {
          const errorMsg = `Item ${item.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          jobProgress.errors.push(errorMsg);
          console.error(`❌ ${errorMsg}`);

          // Continue processing other items (don't fail entire job)
        }

        // Check for cancellation every 10 items to avoid excessive signal checking
        if (jobProgress.processed % 10 === 0 && signal.aborted) {
          jobProgress.status = 'cancelled';
          jobProgress.endTime = Date.now();

          const elapsed = Math.round((jobProgress.endTime - jobProgress.startTime) / 1000);
          console.log(`⚠️  Job cancelled after ${elapsed}s`);
          console.log(`   Processed: ${jobProgress.processed}/${items.length} items`);
          console.log(`   Errors: ${jobProgress.errors.length}`);

          if (signal.error) {
            console.log(`   Reason: ${signal.error.message}`);
          }

          return jobProgress;
        }
      }

      // Job completed successfully
      jobProgress.status = jobProgress.errors.length > 0 ? 'completed' : 'completed';
      jobProgress.endTime = Date.now();

      const elapsed = Math.round((jobProgress.endTime - jobProgress.startTime) / 1000);
      const errorRate = Math.round((jobProgress.errors.length / items.length) * 100);

      console.log(`\n🎉 Job completed in ${elapsed}s`);
      console.log(
        `   Success: ${jobProgress.processed - jobProgress.errors.length}/${items.length}`
      );
      console.log(`   Errors: ${jobProgress.errors.length} (${errorRate}%)`);

      if (jobProgress.errors.length > 0) {
        console.log('   Error details:');
        jobProgress.errors.slice(0, 5).forEach(error => console.log(`     - ${error}`));
        if (jobProgress.errors.length > 5) {
          console.log(`     ... and ${jobProgress.errors.length - 5} more errors`);
        }
      }

      return jobProgress;
    });

    console.log('\nFinal job status:', {
      jobId,
      status: progress.status,
      processed: progress.processed,
      total: progress.total,
      errorCount: progress.errors.length,
      duration: progress.endTime ? progress.endTime - progress.startTime : 0,
    });
  } catch (error) {
    console.error('❌ Job processing failed:', error);
  } finally {
    await client.disconnect();
  }
}

// Run the example
if (require.main === module) {
  jobProcessingWithProgress()
    .then(() => console.log('Example completed'))
    .catch(console.error);
}

export { jobProcessingWithProgress };
