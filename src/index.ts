/**
 * OpenAI-Compatible Assistant API
 * Enhanced Cloudflare Worker implementation with comprehensive security and validation
 */

import { z } from 'zod';
import { router } from './modules/routing';
import { createEnhancedMiddleware } from './modules/routing/middleware';
import { loadConfig } from './modules/config';
import { ErrorFactory } from './modules/errors';
import { addCORSHeaders } from './modules/security';
import { getLogger } from './modules/monitoring';
import {
	ProviderService,
	createDefaultProviderConfiguration,
	ProviderConfiguration,
	ProviderType
} from './modules/providers';

// Environment interface with our bindings
export interface Env {
	R2_BUCKET: R2Bucket;
	GEMINI_API_KEY: string;
	OPENAI_API_KEY?: string;
	API_KEY: string;
	// Provider configuration
	PROVIDER_OPENAI_ENABLED?: string;
	PROVIDER_GEMINI_ENABLED?: string;
	PROVIDER_OPENAI_BASE_URL?: string;
	PROVIDER_GEMINI_BASE_URL?: string;
	PROVIDER_TIMEOUT?: string;
	PROVIDER_MAX_RETRIES?: string;
	// Fallback configuration
	PROVIDER_FALLBACK_ENABLED?: string;
	PROVIDER_FALLBACK_MAX_RETRIES?: string;
	PROVIDER_FALLBACK_RETRY_DELAY?: string;
	[key: string]: any; // Allow additional configuration
}

// Request validation schemas
const ChatMessageSchema = z.object({
	role: z.enum(['user', 'assistant', 'system']),
	content: z.string(),
});

const ChatRequestSchema = z.object({
	model: z.string(),
	messages: z.array(ChatMessageSchema),
	temperature: z.number().optional(),
	max_tokens: z.number().optional(),
	stream: z.boolean().optional(),
});

const CompletionRequestSchema = z.object({
	model: z.string(),
	prompt: z.string(),
	temperature: z.number().optional(),
	max_tokens: z.number().optional(),
});

/**
 * Create provider configuration from environment variables
 */
function createProviderConfig(env: Env): ProviderConfiguration {
	const baseConfig = createDefaultProviderConfiguration();

	// Configure OpenAI provider
	if (env.OPENAI_API_KEY) {
		baseConfig.providers[ProviderType.OPENAI]!.enabled =
			env.PROVIDER_OPENAI_ENABLED !== 'false'; // Default to true if API key is provided
		baseConfig.providers[ProviderType.OPENAI]!.config.apiKey = env.OPENAI_API_KEY;

		if (env.PROVIDER_OPENAI_BASE_URL) {
			baseConfig.providers[ProviderType.OPENAI]!.config.baseUrl = env.PROVIDER_OPENAI_BASE_URL;
		}
	}

	// Configure Gemini provider
	if (env.GEMINI_API_KEY) {
		baseConfig.providers[ProviderType.GEMINI]!.enabled =
			env.PROVIDER_GEMINI_ENABLED !== 'false'; // Default to true if API key is provided
		baseConfig.providers[ProviderType.GEMINI]!.config.apiKey = env.GEMINI_API_KEY;

		if (env.PROVIDER_GEMINI_BASE_URL) {
			baseConfig.providers[ProviderType.GEMINI]!.config.baseUrl = env.PROVIDER_GEMINI_BASE_URL;
		}
	}

	// Configure common provider settings
	const timeout = env.PROVIDER_TIMEOUT ? parseInt(env.PROVIDER_TIMEOUT) : undefined;
	const maxRetries = env.PROVIDER_MAX_RETRIES ? parseInt(env.PROVIDER_MAX_RETRIES) : undefined;

	if (timeout !== undefined) {
		Object.values(baseConfig.providers).forEach(provider => {
			if (provider) {
				provider.config.timeout = timeout;
			}
		});
	}

	if (maxRetries !== undefined) {
		Object.values(baseConfig.providers).forEach(provider => {
			if (provider) {
				provider.config.maxRetries = maxRetries;
			}
		});
	}

	// Configure fallback settings
	if (env.PROVIDER_FALLBACK_ENABLED) {
		baseConfig.fallback.enabled = env.PROVIDER_FALLBACK_ENABLED === 'true';
	}

	if (env.PROVIDER_FALLBACK_MAX_RETRIES) {
		baseConfig.fallback.maxRetries = parseInt(env.PROVIDER_FALLBACK_MAX_RETRIES);
	}

	if (env.PROVIDER_FALLBACK_RETRY_DELAY) {
		baseConfig.fallback.retryDelay = parseInt(env.PROVIDER_FALLBACK_RETRY_DELAY);
	}

	return baseConfig;
}

// Global provider service instance (will be initialized in handleRequest)
let providerService: ProviderService | null = null;

/**
 * Get or create provider service instance
 */
function getProviderService(env: Env): ProviderService {
	if (!providerService) {
		const config = createProviderConfig(env);
		providerService = new ProviderService(config);
	}
	return providerService;
}

// Simple health check handler for basic functionality
async function handleHealthCheck(env: Env): Promise<Response> {
  const healthResponse = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    worker: 'openai-compatible-assistant',
    environment: env.NODE_ENV || 'production',
    message: 'OpenAI Compatible Assistant API is running successfully',
  };

  return new Response(JSON.stringify(healthResponse), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// Simple request handler for basic functionality
async function handleRequest(request: Request, env: Env): Promise<Response> {
  const startTime = Date.now();
  const correlationId = crypto.randomUUID();

  try {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle health check endpoint - bypass all middleware
    if (path === '/health' && request.method === 'GET') {
      return await handleHealthCheck(env);
    }

    // Handle root path for static files
    if (path === '/' && request.method === 'GET') {
      return await fetch(new URL('/index.html', request.url));
    }

    // For other endpoints, return a simple response
    const response = {
      status: 'ok',
      message: 'OpenAI Compatible Assistant API',
      path: path,
      method: request.method,
      timestamp: new Date().toISOString(),
    };

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const errorResponse = {
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Enhanced handlers with validation
async function handleChatCompletions(request: Request, env: Env, middleware: any): Promise<Response> {
  const config = loadConfig(env);

  // Validate payload
  const validationResult = await middleware.validatePayload(ChatRequestSchema)(request, config);
  if (validationResult instanceof Error || validationResult.valid === false) {
    const error = validationResult instanceof Error ? validationResult : validationResult.error;
    return error.toHTTPResponse(config);
  }

  const validatedRequest = validationResult.data;

  try {
    // Get provider service instance
    const provider = getProviderService(env);

    // Convert OpenAI format to unified format
    const unifiedRequest = {
      model: validatedRequest.model,
      messages: validatedRequest.messages.map((msg: any) => ({
        role: msg.role,
        content: msg.content,
      })),
      stream: validatedRequest.stream || false,
      max_tokens: validatedRequest.max_tokens,
      temperature: validatedRequest.temperature,
    };

    // Generate response using provider service
    const response = await provider.generateResponse(unifiedRequest, {}, crypto.randomUUID());

    // Convert unified response back to OpenAI format
    const openaiResponse = {
      id: response.id,
      object: 'chat.completion',
      created: response.created,
      model: response.model,
      choices: response.choices.map(choice => ({
        index: choice.index,
        message: {
          role: choice.message.role,
          content: typeof choice.message.content === 'string' ? choice.message.content :
                  choice.message.content?.map(c => c.text || '').join('') || '',
        },
        finish_reason: choice.finish_reason,
      })),
      usage: response.usage,
    };

    return new Response(JSON.stringify(openaiResponse), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const apiError = ErrorFactory.wrapError(error);
    return apiError.toHTTPResponse(config);
  }
}

async function handleCompletions(request: Request, env: Env, middleware: any): Promise<Response> {
  const config = loadConfig(env);

  // Validate payload
  const validationResult = await middleware.validatePayload(CompletionRequestSchema)(request, config);
  if (validationResult instanceof Error || validationResult.valid === false) {
    const error = validationResult instanceof Error ? validationResult : validationResult.error;
    return error.toHTTPResponse(config);
  }

  const validatedRequest = validationResult.data;

  try {
    // Get provider service instance
    const provider = getProviderService(env);

    // Convert OpenAI format to unified format
    const unifiedRequest = {
      model: validatedRequest.model,
      messages: [{
        role: 'user' as const,
        content: validatedRequest.prompt,
      }],
      stream: false,
      max_tokens: validatedRequest.max_tokens,
      temperature: validatedRequest.temperature,
    };

    // Generate response using provider service
    const response = await provider.generateResponse(unifiedRequest, {}, crypto.randomUUID());

    // Convert unified response back to OpenAI format
    const openaiResponse = {
      id: response.id,
      object: 'text_completion',
      created: response.created,
      model: response.model,
      choices: response.choices.map(choice => ({
        text: typeof choice.message.content === 'string' ? choice.message.content :
              choice.message.content?.map(c => c.text || '').join('') || '',
        index: choice.index,
        finish_reason: choice.finish_reason,
      })),
      usage: response.usage,
    };

    return new Response(JSON.stringify(openaiResponse), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const apiError = ErrorFactory.wrapError(error);
    return apiError.toHTTPResponse(config);
  }
}

async function handleModels(request: Request, env: Env, middleware: any): Promise<Response> {
  try {
    // Get provider service instance
    const provider = getProviderService(env);

    // Get provider health to determine available models
    const health = await provider.healthCheck();

    const models: any[] = [];

    // Add models based on healthy providers
    if (health.providers.get(ProviderType.OPENAI)?.status === 'available') {
      models.push({
        id: 'gpt-4-turbo',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'openai',
      });
      models.push({
        id: 'gpt-4',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'openai',
      });
      models.push({
        id: 'gpt-3.5-turbo',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'openai',
      });
    }

    if (health.providers.get(ProviderType.GEMINI)?.status === 'available') {
      models.push({
        id: 'gemini-pro',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'google',
      });
      models.push({
        id: 'gemini-pro-vision',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'google',
      });
    }

    const modelsResponse = {
      object: 'list',
      data: models,
    };

    return new Response(JSON.stringify(modelsResponse), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const config = loadConfig(env);
    const apiError = ErrorFactory.wrapError(error);
    return apiError.toHTTPResponse(config);
  }
}

// Scheduled handler for cron-triggered GC operations
async function handleScheduled(controller: ScheduledController, env: Env): Promise<void> {
  console.log(`Scheduled event triggered: ${controller.cron}`);

  try {
    // Import and run scheduled GC
    const { scheduledGC } = await import('./modules/routing/handlers/gc');
    await scheduledGC(env);
  } catch (error) {
    console.error('Scheduled GC operation failed:', error);
    throw error; // Re-throw to ensure proper logging
  }
}

// Main handler
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return handleRequest(request, env);
	},

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    await handleScheduled(controller, env);
  },
} satisfies ExportedHandler<Env>;
