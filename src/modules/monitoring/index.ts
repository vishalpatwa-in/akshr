/**
 * Monitoring and Observability System
 * Request logging, error tracking, performance metrics, and health checks
 */

import { APIError, ErrorFactory } from '../errors';
import type { Config } from '../config';
import { extractClientInfo } from '../auth';

// Log levels
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

// Log entry structure
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlation_id?: string;
  request_id?: string;
  path?: string;
  method?: string;
  status_code?: number;
  duration_ms?: number;
  client_ip?: string;
  user_agent?: string;
  country?: string;
  error?: {
    type: string;
    message: string;
    stack?: string;
    details?: any;
  };
  metadata?: Record<string, any>;
}

// Metrics structure
export interface Metrics {
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  average_response_time: number;
  error_rate: number;
  rate_limit_hits: number;
  auth_failures: number;
  endpoint_metrics: Record<string, EndpointMetrics>;
}

export interface EndpointMetrics {
  request_count: number;
  error_count: number;
  average_duration: number;
  last_request_at: string;
}

// Health check response
export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  version: string;
  uptime: number;
  metrics: Partial<Metrics>;
  dependencies: {
    r2: 'up' | 'down';
    gemini_api: 'up' | 'down';
  };
}

// Logger class
export class Logger {
  private config: Config;
  private startTime: number;
  private requestCount = 0;
  private metrics: Metrics;

  constructor(config: Config) {
    this.config = config;
    this.startTime = Date.now();
    this.metrics = {
      total_requests: 0,
      successful_requests: 0,
      failed_requests: 0,
      average_response_time: 0,
      error_rate: 0,
      rate_limit_hits: 0,
      auth_failures: 0,
      endpoint_metrics: {},
    };
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const currentLevel = this.config.LOG_LEVEL as LogLevel;
    const currentLevelIndex = levels.indexOf(currentLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }

  private formatLogEntry(entry: LogEntry): string {
    const logData = {
      ...entry,
      service: 'openai-compatible-assistant',
      environment: this.config.NODE_ENV,
    };

    return JSON.stringify(logData);
  }

  log(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) return;

    const formattedEntry = this.formatLogEntry(entry);

    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(formattedEntry);
        break;
      case LogLevel.INFO:
        console.info(formattedEntry);
        break;
      case LogLevel.WARN:
        console.warn(formattedEntry);
        break;
      case LogLevel.ERROR:
        console.error(formattedEntry);
        break;
    }

    // Send to external logging service if configured
    if (this.config.ERROR_TRACKING_URL && entry.level === LogLevel.ERROR) {
      this.sendToExternalService(entry);
    }
  }

  private async sendToExternalService(entry: LogEntry): Promise<void> {
    try {
      // This would integrate with external logging services
      // For now, just log locally
      console.log(`[EXTERNAL] ${JSON.stringify(entry)}`);
    } catch (error) {
      console.error('Failed to send log to external service:', error);
    }
  }

  logRequest(
    request: Request,
    response?: Response,
    duration?: number,
    error?: APIError,
    correlationId?: string
  ): void {
    const clientInfo = extractClientInfo(request);
    const url = new URL(request.url);

    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: error ? LogLevel.ERROR : LogLevel.INFO,
      message: `${request.method} ${url.pathname}`,
      correlation_id: correlationId,
      path: url.pathname,
      method: request.method,
      status_code: response?.status,
      duration_ms: duration,
      client_ip: clientInfo.ip,
      user_agent: clientInfo.userAgent,
      country: clientInfo.country,
      ...(error && {
        error: {
          type: error.type,
          message: error.message,
          details: this.config.EXPOSE_ERROR_DETAILS ? error.details : undefined,
        },
      }),
    };

    this.log(logEntry);

    // Update metrics
    this.updateMetrics(request, response, duration, error);
  }

  private updateMetrics(
    request: Request,
    response?: Response,
    duration?: number,
    error?: APIError
  ): void {
    this.metrics.total_requests++;

    if (error) {
      this.metrics.failed_requests++;
      if (error.type === 'rate_limit_exceeded') {
        this.metrics.rate_limit_hits++;
      } else if (error.type === 'authentication_error') {
        this.metrics.auth_failures++;
      }
    } else if (response && response.status < 400) {
      this.metrics.successful_requests++;
    }

    // Update average response time
    if (duration !== undefined) {
      const totalTime = this.metrics.average_response_time * (this.metrics.total_requests - 1);
      this.metrics.average_response_time = (totalTime + duration) / this.metrics.total_requests;
    }

    // Update error rate
    this.metrics.error_rate = this.metrics.failed_requests / this.metrics.total_requests;

    // Update endpoint metrics
    const url = new URL(request.url);
    const endpoint = `${request.method} ${url.pathname}`;

    if (!this.metrics.endpoint_metrics[endpoint]) {
      this.metrics.endpoint_metrics[endpoint] = {
        request_count: 0,
        error_count: 0,
        average_duration: 0,
        last_request_at: new Date().toISOString(),
      };
    }

    const endpointMetric = this.metrics.endpoint_metrics[endpoint];
    endpointMetric.request_count++;
    endpointMetric.last_request_at = new Date().toISOString();

    if (error) {
      endpointMetric.error_count++;
    }

    if (duration !== undefined) {
      const totalTime = endpointMetric.average_duration * (endpointMetric.request_count - 1);
      endpointMetric.average_duration = (totalTime + duration) / endpointMetric.request_count;
    }
  }

  getMetrics(): Metrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      total_requests: 0,
      successful_requests: 0,
      failed_requests: 0,
      average_response_time: 0,
      error_rate: 0,
      rate_limit_hits: 0,
      auth_failures: 0,
      endpoint_metrics: {},
    };
  }
}

// Global logger instance
let globalLogger: Logger | null = null;

export function getLogger(config: Config): Logger {
  if (!globalLogger) {
    globalLogger = new Logger(config);
  }
  return globalLogger;
}

/**
 * Create request logging middleware
 */
export function createRequestLoggingMiddleware(config: Config) {
  return async (
    request: Request,
    handler: () => Promise<Response>
  ): Promise<{ response: Response; duration: number }> => {
    const startTime = Date.now();
    const logger = getLogger(config);
    const correlationId = crypto.randomUUID();

    // Add correlation ID to request for downstream use
    const requestWithCorrelation = new Request(request.url, {
      method: request.method,
      headers: new Headers(request.headers),
      body: request.body,
    });
    requestWithCorrelation.headers.set('X-Correlation-ID', correlationId);

    try {
      const response = await handler();
      const duration = Date.now() - startTime;

      logger.logRequest(request, response, duration, undefined, correlationId);

      return { response, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      const apiError = error instanceof APIError ? error : ErrorFactory.wrapError(error);

      logger.logRequest(request, undefined, duration, apiError, correlationId);

      throw apiError;
    }
  };
}

/**
 * Create health check endpoint handler
 */
export function createHealthCheckHandler(config: Config) {
  return async (): Promise<Response> => {
    const logger = getLogger(config);
    const metrics = logger.getMetrics();
    const uptime = Date.now() - logger['startTime'];

    // Check dependencies
    const dependencies: { r2: 'up' | 'down'; gemini_api: 'up' | 'down' } = {
      r2: 'up', // In a real implementation, you'd check R2 connectivity
      gemini_api: 'up', // In a real implementation, you'd check Gemini API connectivity
    };

    // Determine overall status
    const errorRate = metrics.error_rate;
    let status: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';

    if (errorRate > 0.5) {
      status = 'unhealthy';
    } else if (errorRate > 0.1) {
      status = 'degraded';
    }

    const healthResponse: HealthCheckResponse = {
      status,
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      uptime,
      metrics: {
        total_requests: metrics.total_requests,
        error_rate: metrics.error_rate,
        average_response_time: metrics.average_response_time,
      },
      dependencies,
    };

    const responseStatus = status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503;

    return new Response(JSON.stringify(healthResponse), {
      status: responseStatus,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
    });
  };
}

/**
 * Create metrics endpoint handler
 */
export function createMetricsHandler(config: Config) {
  return async (): Promise<Response> => {
    const logger = getLogger(config);
    const metrics = logger.getMetrics();

    return new Response(JSON.stringify(metrics), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
    });
  };
}

/**
 * Performance monitoring utilities
 */
export const MonitoringUtils = {
  /**
   * Measure function execution time
   */
  async measureExecutionTime<T>(
    fn: () => Promise<T>,
    label: string,
    config: Config
  ): Promise<{ result: T; duration: number }> {
    const startTime = Date.now();

    try {
      const result = await fn();
      const duration = Date.now() - startTime;

      if (config.LOG_REQUESTS) {
        console.log(`[PERF] ${label} completed in ${duration}ms`);
      }

      return { result, duration };
    } catch (error) {
      const duration = Date.now() - startTime;

      if (config.LOG_REQUESTS) {
        console.error(`[PERF] ${label} failed after ${duration}ms:`, error);
      }

      throw error;
    }
  },

  /**
   * Track custom metrics
   */
  trackMetric(name: string, value: number, config: Config): void {
    if (config.LOG_REQUESTS) {
      console.log(`[METRIC] ${name}: ${value}`);
    }
  },

  /**
   * Create performance observer
   * Note: PerformanceObserver is not available in Cloudflare Workers
   */
  createPerformanceObserver(config: Config): void {
    // Performance monitoring is handled through manual measurement in Cloudflare Workers
    if (config.LOG_REQUESTS) {
      console.log('[PERF] Performance observer not available in Cloudflare Workers');
    }
  },
};

export default {
  Logger,
  getLogger,
  createRequestLoggingMiddleware,
  createHealthCheckHandler,
  createMetricsHandler,
  MonitoringUtils,
  LogLevel,
};