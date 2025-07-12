/**
 * Monitoring example using RedLock Universal
 * 
 * This example demonstrates how to use the built-in monitoring features.
 */

import { 
  createLock, 
  NodeRedisAdapter, 
  MetricsCollector, 
  HealthChecker,
  Logger,
  LogLevel 
} from 'redlock-universal';
import { createClient } from 'redis';

async function monitoringExample() {
  // Setup Redis client
  const client = createClient({ url: 'redis://localhost:6379' });
  await client.connect();

  // Setup monitoring
  const metrics = new MetricsCollector(100); // Keep last 100 operations
  const health = new HealthChecker();
  const logger = new Logger({ 
    level: LogLevel.INFO, 
    enableConsole: true,
    enableCollection: true 
  });

  // Register adapter for health monitoring
  const adapter = new NodeRedisAdapter(client);
  health.registerAdapter('redis-main', adapter);

  // Create lock
  const lock = createLock({
    adapter,
    key: 'monitored-resource',
    ttl: 10000,
  });

  try {
    logger.info('Starting monitored lock operations');

    // Perform multiple lock operations to collect metrics
    for (let i = 1; i <= 5; i++) {
      logger.info(`Lock operation ${i}/5`, { operation: i });
      
      const startTime = Date.now();
      let success = false;
      let attempts = 1;

      try {
        const handle = await lock.acquire();
        success = true;
        const acquisitionTime = Date.now() - startTime;
        
        logger.info('Lock acquired', { 
          acquisitionTime, 
          attempts,
          operation: i 
        });

        // Record metrics
        metrics.recordLockOperation({
          acquisitionTime,
          attempts,
          success,
          key: 'monitored-resource',
          timestamp: Date.now(),
        });

        // Simulate work
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
        
        await lock.release(handle);
        logger.info('Lock released', { operation: i });
      } catch (error) {
        logger.error('Lock operation failed', error as Error, { operation: i });
        
        // Record failed metric
        metrics.recordLockOperation({
          acquisitionTime: Date.now() - startTime,
          attempts,
          success: false,
          key: 'monitored-resource',
          timestamp: Date.now(),
        });
      }

      // Check health periodically
      if (i % 2 === 0) {
        logger.info('Checking adapter health...');
        const healthStatus = await health.checkAdapterHealth('redis-main');
        logger.info('Health check result', { 
          healthy: healthStatus.healthy,
          responseTime: healthStatus.responseTime,
          error: healthStatus.error 
        });
      }
    }

    // Display metrics summary
    console.log('\n=== Metrics Summary ===');
    const summary = metrics.getSummary();
    console.log(`Total operations: ${summary.totalOperations}`);
    console.log(`Successful: ${summary.successfulOperations}`);
    console.log(`Failed: ${summary.failedOperations}`);
    console.log(`Success rate: ${(summary.successRate * 100).toFixed(2)}%`);
    console.log(`Average acquisition time: ${summary.averageAcquisitionTime.toFixed(2)}ms`);
    console.log(`95th percentile: ${summary.p95AcquisitionTime.toFixed(2)}ms`);
    console.log(`99th percentile: ${summary.p99AcquisitionTime.toFixed(2)}ms`);

    // Display system health
    console.log('\n=== System Health ===');
    const systemHealth = await health.checkSystemHealth();
    console.log(`Overall healthy: ${systemHealth.overall}`);
    
    for (const adapterHealth of systemHealth.adapters) {
      console.log(`${adapterHealth.adapter}: ${adapterHealth.status.healthy ? 'HEALTHY' : 'UNHEALTHY'}`);
      if (!adapterHealth.status.healthy) {
        console.log(`  Error: ${adapterHealth.status.error}`);
      }
      console.log(`  Response time: ${adapterHealth.status.responseTime}ms`);
    }

    // Display health statistics
    console.log('\n=== Health Statistics ===');
    const healthStats = health.getHealthStats('redis-main');
    console.log(`Total checks: ${healthStats.total}`);
    console.log(`Healthy: ${healthStats.healthy}`);
    console.log(`Unhealthy: ${healthStats.unhealthy}`);
    console.log(`Uptime: ${(healthStats.uptime * 100).toFixed(2)}%`);
    console.log(`Average response time: ${healthStats.averageResponseTime.toFixed(2)}ms`);

    // Display collected logs
    console.log('\n=== Recent Logs ===');
    const logEntries = logger.getEntries();
    logEntries.slice(-5).forEach(entry => {
      const timestamp = new Date(entry.timestamp).toISOString();
      const level = LogLevel[entry.level];
      console.log(`[${timestamp}] ${level}: ${entry.message}`);
      if (entry.context) {
        console.log(`  Context: ${JSON.stringify(entry.context)}`);
      }
    });

  } catch (error) {
    logger.error('Monitoring example failed', error as Error);
  } finally {
    await client.disconnect();
  }
}

// Example of monitoring with multiple adapters
async function multiAdapterMonitoring() {
  console.log('\n=== Multi-Adapter Monitoring ===');
  
  // Setup multiple Redis clients (simulating distributed setup)
  const clients = [
    createClient({ url: 'redis://localhost:6379' }),
    // Note: For this example, we'll use the same Redis instance
    // In production, these would be different Redis instances
    createClient({ url: 'redis://localhost:6379' }),
  ];

  await Promise.all(clients.map(client => client.connect()));

  const health = new HealthChecker();
  
  // Register multiple adapters
  clients.forEach((client, index) => {
    const adapter = new NodeRedisAdapter(client);
    health.registerAdapter(`redis-${index + 1}`, adapter);
  });

  // Check system health
  const systemHealth = await health.checkSystemHealth();
  console.log(`Multi-adapter system health: ${systemHealth.overall ? 'HEALTHY' : 'UNHEALTHY'}`);
  
  systemHealth.adapters.forEach(adapterHealth => {
    console.log(`  ${adapterHealth.adapter}: ${adapterHealth.status.healthy ? 'OK' : 'FAIL'} (${adapterHealth.status.responseTime}ms)`);
  });

  await Promise.all(clients.map(client => client.disconnect()));
}

// Run examples
async function main() {
  await monitoringExample();
  await multiAdapterMonitoring();
}

main().catch(console.error);