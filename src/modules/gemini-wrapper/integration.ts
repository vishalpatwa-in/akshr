/**
 * Gemini Wrapper Integration
 *
 * This module demonstrates how to integrate the Gemini wrapper with the existing
 * OpenAI-compatible assistant system, including R2 storage and run execution flow.
 */

import { createGeminiInference, validateToolsForGemini } from './index';
import { Assistant, Message, Run, Tool } from '../models/index';
import { createR2Storage } from '../r2-helpers/index';
import { NormalizedResponse } from './types';

export interface GeminiRunConfig {
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Execute a run using Gemini instead of OpenAI
 */
export async function executeGeminiRun(
  run: Run,
  assistant: Assistant,
  messages: Message[],
  config: GeminiRunConfig,
  env: any // Cloudflare Workers environment
): Promise<{
  success: boolean;
  response?: NormalizedResponse;
  error?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: any }>;
}> {
  try {
    // Create R2 storage manager
    const storage = createR2Storage(env);

    // Validate tools for Gemini compatibility
    if (assistant.tools.length > 0) {
      const validation = validateToolsForGemini(assistant.tools);
      if (!validation.valid) {
        return {
          success: false,
          error: `Tool validation failed: ${validation.errors.join(', ')}`,
        };
      }
    }

    // Create Gemini inference instance
    const inference = createGeminiInference(config.apiKey, config.model);

    // Set up inference configuration
    const inferenceConfig = {
      temperature: config.temperature || assistant.model.includes('gemini') ? 0.7 : undefined,
      maxTokens: config.maxTokens,
    };

    // Generate response
    let response: NormalizedResponse;
    if (assistant.tools.length > 0) {
      response = await inference.generateWithTools(messages, assistant.tools, inferenceConfig);
    } else {
      response = await inference.generateAssistantResponse(assistant, messages, inferenceConfig);
    }

    // Handle tool calls if present
    if (response.toolCalls && response.toolCalls.length > 0) {
      return {
        success: true,
        response,
        toolCalls: response.toolCalls,
      };
    }

    // Store the response as a new message
    const responseMessage: Message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2)}`,
      object: 'message',
      created_at: Date.now(),
      thread_id: run.thread_id,
      role: 'assistant',
      content: [{
        type: 'text',
        text: {
          value: response.text || '',
        },
      }],
      assistant_id: assistant.id,
      run_id: run.id,
    };

    // Store in R2
    await storage.messages.put(run.thread_id, responseMessage);

    return {
      success: true,
      response,
    };

  } catch (error) {
    console.error('Gemini run execution failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Continue a run with tool results using Gemini
 */
export async function continueGeminiRunWithTools(
  run: Run,
  assistant: Assistant,
  messages: Message[],
  toolCalls: Array<{ id: string; name: string; arguments: any }>,
  toolResults: Array<{ name: string; result: any }>,
  config: GeminiRunConfig,
  env: any
): Promise<{
  success: boolean;
  response?: NormalizedResponse;
  error?: string;
}> {
  try {
    const inference = createGeminiInference(config.apiKey, config.model);

    const inferenceConfig = {
      temperature: config.temperature || 0.7,
      maxTokens: config.maxTokens,
    };

    // Continue with tool results
    const response = await inference.continueWithToolResults(
      messages,
      toolCalls,
      toolResults,
      inferenceConfig
    );

    // Store the final response
    const responseMessage: Message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2)}`,
      object: 'message',
      created_at: Date.now(),
      thread_id: run.thread_id,
      role: 'assistant',
      content: [{
        type: 'text',
        text: {
          value: response.text || '',
        },
      }],
      assistant_id: assistant.id,
      run_id: run.id,
    };

    // Store in R2
    const storage = createR2Storage(env);
    await storage.messages.put(run.thread_id, responseMessage);

    return {
      success: true,
      response,
    };

  } catch (error) {
    console.error('Gemini tool continuation failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Stream a Gemini response for real-time updates
 */
export async function* streamGeminiResponse(
  run: Run,
  assistant: Assistant,
  messages: Message[],
  config: GeminiRunConfig
): AsyncGenerator<{
  type: 'chunk' | 'tool_call' | 'complete';
  content?: string;
  toolCall?: { id: string; name: string; arguments: any };
}, void, unknown> {
  try {
    const inference = createGeminiInference(config.apiKey, config.model);

    const inferenceConfig = {
      temperature: config.temperature || 0.7,
      maxTokens: config.maxTokens,
    };

    let fullContent = '';

    // Stream the response
    const stream = inference.streamResponse(messages, assistant.tools, inferenceConfig);

    for await (const chunk of stream) {
      if (chunk.toolCalls && chunk.toolCalls.length > 0) {
        // Handle tool calls
        for (const toolCall of chunk.toolCalls) {
          yield {
            type: 'tool_call',
            toolCall,
          };
        }
      } else if (chunk.text) {
        // Handle text content
        fullContent += chunk.text;
        yield {
          type: 'chunk',
          content: chunk.text,
        };
      }
    }

    yield {
      type: 'complete',
    };

  } catch (error) {
    console.error('Gemini streaming failed:', error);
    throw error;
  }
}

/**
 * Validate environment for Gemini integration
 */
export function validateGeminiEnvironment(env: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!env) {
    errors.push('Environment is required');
    return { valid: false, errors };
  }

  // Check for required R2 buckets
  if (!env.ASSISTANT_R2) {
    errors.push('ASSISTANT_R2 bucket is required');
  }

  // Check for Gemini API key (this should be in environment variables)
  if (!env.GEMINI_API_KEY) {
    errors.push('GEMINI_API_KEY environment variable is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Create a Gemini-compatible assistant configuration
 */
export function createGeminiAssistant(baseAssistant: Assistant): Assistant {
  return {
    ...baseAssistant,
    model: baseAssistant.model.includes('gemini') ? baseAssistant.model : 'gemini-pro',
  };
}

/**
 * Helper to migrate an existing run to use Gemini
 */
export function migrateRunToGemini(run: Run): Run {
  return {
    ...run,
    model: run.model.includes('gemini') ? run.model : 'gemini-pro',
  };
}