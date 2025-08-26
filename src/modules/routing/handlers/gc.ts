/**
 * Garbage Collection HTTP Handler
 * Provides REST API endpoints for manual GC operations
 */

import {
  executeGCOperation,
  getGCStatsSummary,
  createGarbageCollectionHandler
} from '../../gc-handler';
import {
  GCOperationResult,
  GCTriggerRequest,
  GCMode
} from '../../gc-handler/types';
import { createGCCompleteMiddleware } from '../../gc-handler/auth';

/**
 * Handle manual GC trigger via HTTP request
 * POST /admin/gc
 */
export async function triggerGC(request: Request, env: any): Promise<Response> {
  try {
    // Apply complete GC middleware (auth, rate limiting, security)
    const middleware = createGCCompleteMiddleware(env);
    const middlewareResult = await middleware(request);

    if (middlewareResult) {
      return middlewareResult.response; // Middleware handled the request (auth failure, rate limit, etc.)
    }

    // Parse request body
    let triggerRequest: GCTriggerRequest;
    try {
      triggerRequest = await request.json();
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: { message: 'Invalid JSON in request body.' }
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Execute GC operation
    const result = await executeGCOperation(env.R2_BUCKET, triggerRequest);

    // Return formatted response
    return new Response(
      JSON.stringify({
        success: true,
        operationId: result.operationId,
        status: result.status,
        summary: getGCStatsSummary(result),
        details: result,
        timestamp: new Date().toISOString()
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('GC trigger error:', error);
    return new Response(
      JSON.stringify({
        error: {
          message: 'GC operation failed.',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

/**
 * Handle scheduled GC operations (cron triggers)
 * This is called by the Cloudflare cron trigger
 */
export async function scheduledGC(env: any): Promise<void> {
  console.log('Starting scheduled GC operation...');

  try {
    // Create GC handler with default configuration
    const gcHandler = createGarbageCollectionHandler(env.R2_BUCKET, {
      mode: GCMode.CLEANUP,
      dryRun: false, // Actually perform cleanup for scheduled operations
      continueOnErrors: true,
      timeoutSeconds: 600 // 10 minutes for scheduled operations
    });

    // Execute GC
    const result = await gcHandler.executeGC();

    // Log results
    console.log(`Scheduled GC completed:`, {
      operationId: result.operationId,
      status: result.status,
      processed: result.overallStats.totalProcessed,
      cleaned: result.overallStats.totalCleaned,
      failed: result.overallStats.totalFailed,
      duration: result.overallStats.totalDurationMs,
      errors: result.errors.length
    });

    // Log detailed summary
    console.log('GC Summary:', getGCStatsSummary(result));

    if (result.errors.length > 0) {
      console.error('GC operation had errors:', result.errors);
    }

  } catch (error) {
    console.error('Scheduled GC operation failed:', error);
    throw error; // Re-throw to ensure cron job shows as failed
  }
}

/**
 * Get GC operation status
 * GET /admin/gc/status/:operationId
 */
export async function getGCStatus(
  request: Request,
  env: any,
  params: Record<string, string>
): Promise<Response> {
  const operationId = params.operationId;
  // This is a placeholder - in a real implementation, you'd store operation
  // status in a persistent store (like R2 or D1) and retrieve it here
  return new Response(
    JSON.stringify({
      error: { message: 'Operation status tracking not implemented yet.' }
    }),
    {
      status: 501,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

/**
 * Get GC configuration and statistics
 * GET /admin/gc/config
 */
export async function getGCConfig(request: Request, env: any): Promise<Response> {
  try {
    // Apply authentication middleware
    const middleware = createGCCompleteMiddleware(env);
    const middlewareResult = await middleware(request);

    if (middlewareResult) {
      return middlewareResult.response;
    }

    // Return configuration information
    const config = {
      cronSchedule: '0 2 * * *', // Daily at 2 AM UTC
      maxRuntimeSeconds: 600,
      defaultBatchSize: 100,
      maxConcurrentBatches: 5,
      supportedResourceTypes: [
        'assistant',
        'thread',
        'message',
        'run',
        'file'
      ],
      rateLimitPerSecond: 50,
      adminKeyConfigured: !!env.GC_ADMIN_KEY,
      r2BucketConfigured: !!env.R2_BUCKET,
      features: {
        dryRun: true,
        cascadeDelete: true,
        progressTracking: false, // Not implemented yet
        errorRecovery: true,
        rateLimiting: true
      }
    };

    return new Response(
      JSON.stringify({
        success: true,
        config,
        timestamp: new Date().toISOString()
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('GC config error:', error);
    return new Response(
      JSON.stringify({
        error: { message: 'Failed to retrieve GC configuration.' }
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

/**
 * Dry run GC operation
 * POST /admin/gc/dry-run
 */
export async function dryRunGC(request: Request, env: any): Promise<Response> {
  try {
    // Apply complete GC middleware
    const middleware = createGCCompleteMiddleware(env);
    const middlewareResult = await middleware(request);

    if (middlewareResult) {
      return middlewareResult.response;
    }

    // Parse request body
    let triggerRequest: Partial<GCTriggerRequest>;
    try {
      triggerRequest = await request.json();
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: { message: 'Invalid JSON in request body.' }
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Force dry run mode
    triggerRequest.mode = GCMode.DRY_RUN;

    // Execute dry run
    const result = await executeGCOperation(env.R2_BUCKET, triggerRequest as GCTriggerRequest);

    return new Response(
      JSON.stringify({
        success: true,
        operationId: result.operationId,
        status: result.status,
        dryRun: true,
        summary: getGCStatsSummary(result),
        details: result,
        timestamp: new Date().toISOString()
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('GC dry run error:', error);
    return new Response(
      JSON.stringify({
        error: {
          message: 'GC dry run failed.',
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}