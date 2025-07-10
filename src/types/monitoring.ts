/**
 * Monitoring and metrics types
 */

/**
 * Lock operation metrics
 */
export interface LockMetrics {
  /** Total number of lock acquisition attempts */
  readonly acquisitionAttempts: number;
  
  /** Total number of successful acquisitions */
  readonly acquisitionSuccesses: number;
  
  /** Total number of failed acquisitions */
  readonly acquisitionFailures: number;
  
  /** Success rate as percentage (0-100) */
  readonly successRate: number;
  
  /** Average acquisition time in milliseconds */
  readonly avgAcquisitionTime: number;
  
  /** 95th percentile acquisition time in milliseconds */
  readonly p95AcquisitionTime: number;
  
  /** 99th percentile acquisition time in milliseconds */
  readonly p99AcquisitionTime: number;
  
  /** Total number of lock releases */
  readonly releases: number;
  
  /** Total number of lock extensions */
  readonly extensions: number;
  
  /** Currently active locks */
  readonly activeLocks: number;
}

/**
 * Health check status
 */
export interface HealthStatus {
  /** Overall health status */
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  
  /** Health check timestamp */
  readonly timestamp: number;
  
  /** Individual adapter health */
  readonly adapters: readonly AdapterHealth[];
  
  /** Any error messages */
  readonly errors?: readonly string[];
}

/**
 * Health status for individual Redis adapter
 */
export interface AdapterHealth {
  /** Adapter identifier */
  readonly id: string;
  
  /** Adapter type */
  readonly type: 'node-redis' | 'ioredis';
  
  /** Connection status */
  readonly connected: boolean;
  
  /** Response time in milliseconds */
  readonly responseTime: number;
  
  /** Last error (if any) */
  readonly lastError?: string;
}

/**
 * Event emitted during lock operations
 */
export interface LockEvent {
  /** Event type */
  readonly type: 'acquisition_started' | 'acquisition_success' | 'acquisition_failed' | 'released' | 'extended';
  
  /** Lock key */
  readonly key: string;
  
  /** Event timestamp */
  readonly timestamp: number;
  
  /** Time taken for the operation (ms) */
  readonly duration?: number;
  
  /** Error information (for failed operations) */
  readonly error?: string;
  
  /** Additional metadata */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Configuration for monitoring features
 */
export interface MonitoringConfig {
  /** Enable metrics collection */
  readonly enabled: boolean;
  
  /** Metrics collection interval in milliseconds */
  readonly metricsInterval?: number;
  
  /** Health check interval in milliseconds */
  readonly healthCheckInterval?: number;
  
  /** Event listener for lock operations */
  readonly onEvent?: (event: LockEvent) => void;
  
  /** Custom logger function */
  readonly logger?: (level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void;
}