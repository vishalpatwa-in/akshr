/**
 * Runs API Handlers
 * Implements CRUD operations for runs within threads with full execution support
 */

import { z } from 'zod';
import type { Env } from '../../../index';
import { createR2Storage } from '../../r2-helpers';
import {
  CreateRunRequest,
  UpdateRunRequest,
  RunResponse,
  ListRunsResponse,
  SubmitToolOutputsRequest
} from '../../validators';
import type { Run } from '../../models';
import { RunService } from '../../services/run';
import { RunExecutionEngine } from '../../services/run-execution-engine';
import { ToolCallingFlow } from '../../services/tool-calling-flow';
import { RunStreamingService, createStreamingResponse } from '../../services/streaming';
import { ServiceFactory } from '../../services';
import { ServiceConfig } from '../../services/types';
import { ProviderService, createDefaultProviderConfiguration } from '../../providers/provider-service';

// Service instances cache
const serviceInstances = new Map<string, {
  runService: RunService;
  executionEngine: RunExecutionEngine;
  toolCallingFlow: ToolCallingFlow;
  streamingService: RunStreamingService;
}>();

/**
 * Get or create service instances for the environment
 */
function getServices(env: Env): {
  runService: RunService;
  executionEngine: RunExecutionEngine;
  toolCallingFlow: ToolCallingFlow;
  streamingService: RunStreamingService;
} {
  const cacheKey = 'services';

  if (serviceInstances.has(cacheKey)) {
    return serviceInstances.get(cacheKey)!;
  }

  const storage = createR2Storage(env.R2_BUCKET);
  const config: ServiceConfig = {
    storage,
    bucket: env.R2_BUCKET
  };

  // Create provider configuration with API keys from environment
  const providerConfig = createDefaultProviderConfiguration();
  if (env.GEMINI_API_KEY) {
    providerConfig.providers.gemini!.config.apiKey = env.GEMINI_API_KEY;
    providerConfig.providers.gemini!.enabled = true;
  }
  if (env.OPENAI_API_KEY) {
    providerConfig.providers.openai!.config.apiKey = env.OPENAI_API_KEY;
    providerConfig.providers.openai!.enabled = true;
  }

  const providerService = new ProviderService(providerConfig);
  const runService = new RunService(config);
  const executionEngine = new RunExecutionEngine(config, providerService);
  const toolCallingFlow = new ToolCallingFlow(config);
  const streamingService = new RunStreamingService(config);

  const services = {
    runService,
    executionEngine,
    toolCallingFlow,
    streamingService
  };

  serviceInstances.set(cacheKey, services);
  return services;
}

// Create run
export const createRun = async (request: Request, env: Env, params: Record<string, string>) => {
  try {
    const threadId = params.thread_id;
    if (!threadId) {
      return new Response(JSON.stringify({
        error: { message: 'Thread ID is required' }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const validatedData = CreateRunRequest.parse(body);

    const { runService } = getServices(env);
    const result = await runService.create(threadId, validatedData);

    if (!result.success) {
      const statusCode = result.code === 'NOT_FOUND_ERROR' ? 404 : 400;
      return new Response(JSON.stringify({
        error: { message: result.error }
      }), {
        status: statusCode,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(result.data), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return new Response(JSON.stringify({
        error: { message: 'Validation failed', details: error.issues }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.error('Create run error:', error);
    return new Response(JSON.stringify({
      error: { message: 'Internal server error' }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// Get run
export const getRun = async (request: Request, env: Env, params: Record<string, string>) => {
  try {
    const threadId = params.thread_id;
    const runId = params.run_id;

    if (!threadId || !runId) {
      return new Response(JSON.stringify({
        error: { message: 'Thread ID and Run ID are required' }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { runService } = getServices(env);
    const result = await runService.getById(threadId, runId);

    if (!result.success) {
      const statusCode = result.code === 'NOT_FOUND_ERROR' ? 404 : 400;
      return new Response(JSON.stringify({
        error: { message: result.error }
      }), {
        status: statusCode,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(result.data), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Get run error:', error);
    return new Response(JSON.stringify({
      error: { message: 'Internal server error' }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// List runs (simplified implementation)
export const listRuns = async (request: Request, env: Env, params: Record<string, string>) => {
  try {
    const threadId = params.thread_id;
    if (!threadId) {
      return new Response(JSON.stringify({
        error: { message: 'Thread ID is required' }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // For now, return empty list - in production, you'd implement proper listing
    const response = {
      object: 'list' as const,
      data: [],
      first_id: null,
      last_id: null,
      has_more: false
    };

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('List runs error:', error);
    return new Response(JSON.stringify({
      error: { message: 'Internal server error' }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// Cancel run
export const cancelRun = async (request: Request, env: Env, params: Record<string, string>) => {
  try {
    const threadId = params.thread_id;
    const runId = params.run_id;

    if (!threadId || !runId) {
      return new Response(JSON.stringify({
        error: { message: 'Thread ID and Run ID are required' }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const storage = createR2Storage(env.R2_BUCKET);
    const existingRun = await storage.runs.get(threadId, runId);

    if (!existingRun) {
      return new Response(JSON.stringify({
        error: { message: 'Run not found' }
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Update run status to cancelled
    const cancelledRun: Run = {
      ...existingRun,
      status: 'cancelled'
    };

    await storage.runs.put(threadId, cancelledRun);

    return new Response(JSON.stringify(cancelledRun), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Cancel run error:', error);
    return new Response(JSON.stringify({
      error: { message: 'Internal server error' }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// Submit tool outputs
export const submitToolOutputs = async (request: Request, env: Env, params: Record<string, string>) => {
  try {
    const threadId = params.thread_id;
    const runId = params.run_id;

    if (!threadId || !runId) {
      return new Response(JSON.stringify({
        error: { message: 'Thread ID and Run ID are required' }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const validatedData = SubmitToolOutputsRequest.parse(body);

    const { runService } = getServices(env);
    const result = await runService.submitToolOutputs(threadId, runId, validatedData);

    if (!result.success) {
      const statusCode = result.code === 'NOT_FOUND_ERROR' ? 404 : 400;
      return new Response(JSON.stringify({
        error: { message: result.error }
      }), {
        status: statusCode,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(result.data), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return new Response(JSON.stringify({
        error: { message: 'Validation failed', details: error.issues }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.error('Submit tool outputs error:', error);
    return new Response(JSON.stringify({
      error: { message: 'Internal server error' }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// Execute run (new endpoint for run execution)
export const executeRun = async (request: Request, env: Env, params: Record<string, string>) => {
  try {
    const threadId = params.thread_id;
    const runId = params.run_id;

    if (!threadId || !runId) {
      return new Response(JSON.stringify({
        error: { message: 'Thread ID and Run ID are required' }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { runService, executionEngine } = getServices(env);

    // Get the run
    const runResult = await runService.getById(threadId, runId);
    if (!runResult.success || !runResult.data) {
      return new Response(JSON.stringify({
        error: { message: runResult.error || 'Run not found' }
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check if run should be executed (must be in queued state)
    if (runResult.data.status !== 'queued') {
      return new Response(JSON.stringify({
        error: { message: `Run is in ${runResult.data.status} status and cannot be executed` }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check for streaming request
    const url = new URL(request.url);
    const stream = url.searchParams.get('stream') === 'true';

    if (stream) {
      // Create streaming response
      const executionGenerator = executionEngine.streamRunExecution(runResult.data);
      return createStreamingResponse(
        { storage: createR2Storage(env.R2_BUCKET), bucket: env.R2_BUCKET },
        runId,
        executionGenerator,
        { format: 'sse' }
      );
    } else {
      // Execute synchronously
      const result = await executionEngine.executeRun(runResult.data);
      if (!result.success || !result.data) {
        return new Response(JSON.stringify({
          error: { message: result.error || 'Execution failed' }
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify(result.data), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    console.error('Execute run error:', error);
    return new Response(JSON.stringify({
      error: { message: 'Internal server error' }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};