/**
 * OpenAI Wrapper Integration
 *
 * This module demonstrates how to integrate the OpenAI wrapper with the existing
 * OpenAI-compatible assistant system, including R2 storage and run execution flow.
 */

// Import will be added after index.ts is created
// import { createOpenAIInference, validateToolsForOpenAI } from './index';
import { OpenAIInference } from './inference';
import { OpenAIToolConverter } from './tool-converter';
import { Assistant, Message, Run, Tool } from '../models/index';
import { createR2Storage } from '../r2-helpers/index';
import { NormalizedResponse } from './types';

export interface OpenAIRunConfig {
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  verbosity?: 'low' | 'medium' | 'high';
  reasoning_effort?: 'low' | 'medium' | 'high';
}

/**
 * Execute a run using OpenAI instead of the default provider
 */
export async function executeOpenAIRun(
  run: Run,
  assistant: Assistant,
  messages: Message[],
  config: OpenAIRunConfig,
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

    // Validate tools for OpenAI compatibility
    if (assistant.tools.length > 0) {
      const validation = OpenAIToolConverter.validateToolCollection(assistant.tools);
      if (!validation.valid) {
        return {
          success: false,
          error: `Tool validation failed: ${validation.errors.join(', ')}`,
        };
      }
    }

    // Create OpenAI inference instance
    const inference = new OpenAIInference(config.apiKey, config.model);

    // Set up inference configuration
    const inferenceConfig = {
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      verbosity: config.verbosity,
      reasoning_effort: config.reasoning_effort,
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
    console.error('OpenAI run execution failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Continue a run with tool results using OpenAI
 */
export async function continueOpenAIRunWithTools(
  run: Run,
  assistant: Assistant,
  messages: Message[],
  toolCalls: Array<{ id: string; name: string; arguments: any }>,
  toolResults: Array<{ name: string; result: any }>,
  config: OpenAIRunConfig,
  env: any
): Promise<{
  success: boolean;
  response?: NormalizedResponse;
  error?: string;
}> {
  try {
    const inference = new OpenAIInference(config.apiKey, config.model);

    const inferenceConfig = {
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      verbosity: config.verbosity,
      reasoning_effort: config.reasoning_effort,
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
    console.error('OpenAI tool continuation failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Stream an OpenAI response for real-time updates
 */
export async function* streamOpenAIResponse(
  run: Run,
  assistant: Assistant,
  messages: Message[],
  config: OpenAIRunConfig
): AsyncGenerator<{
  type: 'chunk' | 'tool_call' | 'complete';
  content?: string;
  toolCall?: { id: string; name: string; arguments: any };
}, void, unknown> {
  try {
    const inference = new OpenAIInference(config.apiKey, config.model);

    const inferenceConfig = {
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      verbosity: config.verbosity,
      reasoning_effort: config.reasoning_effort,
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
    console.error('OpenAI streaming failed:', error);
    throw error;
  }
}

/**
 * Validate environment for OpenAI integration
 */
export function validateOpenAIEnvironment(env: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!env) {
    errors.push('Environment is required');
    return { valid: false, errors };
  }

  // Check for required R2 buckets
  if (!env.ASSISTANT_R2) {
    errors.push('ASSISTANT_R2 bucket is required');
  }

  // Check for OpenAI API key (this should be in environment variables)
  if (!env.OPENAI_API_KEY) {
    errors.push('OPENAI_API_KEY environment variable is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Create an OpenAI-compatible assistant configuration
 */
export function createOpenAIAssistant(baseAssistant: Assistant): Assistant {
  return {
    ...baseAssistant,
    model: baseAssistant.model.includes('gpt') ? baseAssistant.model : 'gpt-5-turbo',
  };
}

/**
 * Helper to migrate an existing run to use OpenAI
 */
export function migrateRunToOpenAI(run: Run): Run {
  return {
    ...run,
    model: run.model.includes('gpt') ? run.model : 'gpt-5-turbo',
  };
}

/**
 * Quick helper to generate a response using OpenAI
 */
export async function generateOpenAIResponse(
  messages: Message[],
  config: OpenAIRunConfig
): Promise<NormalizedResponse> {
  const inference = new OpenAIInference(config.apiKey, config.model);

  const inferenceConfig = {
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    verbosity: config.verbosity,
    reasoning_effort: config.reasoning_effort,
  };

  return inference.generateResponse(messages, inferenceConfig);
}

/**
 * Quick helper to generate a response with tools using OpenAI
 */
export async function generateOpenAIWithTools(
  messages: Message[],
  tools: Tool[],
  config: OpenAIRunConfig
): Promise<NormalizedResponse> {
  const inference = new OpenAIInference(config.apiKey, config.model);

  const inferenceConfig = {
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    verbosity: config.verbosity,
    reasoning_effort: config.reasoning_effort,
  };

  return inference.generateWithTools(messages, tools, inferenceConfig);
}

/**
 * Execute a complete run with tool calling loop
 */
export async function executeOpenAIRunWithToolLoop(
  run: Run,
  assistant: Assistant,
  messages: Message[],
  config: OpenAIRunConfig,
  env: any,
  maxToolIterations: number = 5
): Promise<{
  success: boolean;
  response?: NormalizedResponse;
  error?: string;
  iterations: number;
}> {
  let iterations = 0;
  try {
    let currentMessages = [...messages];
    let finalResponse: NormalizedResponse | null = null;

    while (iterations < maxToolIterations) {
      iterations++;

      // Execute the run
      const result = await executeOpenAIRun(run, assistant, currentMessages, config, env);

      if (!result.success) {
        return {
          success: false,
          error: result.error,
          iterations,
        };
      }

      // If no tool calls, we're done
      if (!result.toolCalls || result.toolCalls.length === 0) {
        return {
          success: true,
          response: result.response,
          iterations,
        };
      }

      // Execute tool calls (this would need to be implemented based on your tool registry)
      // For now, we'll simulate with mock results
      const toolResults = result.toolCalls.map(toolCall => ({
        name: toolCall.name,
        result: { success: true, message: `Executed ${toolCall.name}` },
      }));

      // Continue with tool results
      const continuationResult = await continueOpenAIRunWithTools(
        run,
        assistant,
        currentMessages,
        result.toolCalls,
        toolResults,
        config,
        env
      );

      if (!continuationResult.success) {
        return {
          success: false,
          error: continuationResult.error,
          iterations,
        };
      }

      if (continuationResult.response) {
        finalResponse = continuationResult.response;

        // Add the assistant's response to the message history
        if (finalResponse && finalResponse.text) {
          currentMessages.push({
            id: `msg_${Date.now()}_${Math.random().toString(36).substring(2)}`,
            object: 'message',
            created_at: Date.now(),
            thread_id: run.thread_id,
            role: 'assistant',
            content: [{
              type: 'text',
              text: {
                value: finalResponse.text,
              },
            }],
            assistant_id: assistant.id,
            run_id: run.id,
          });
        }

        // Check if we have more tool calls to execute
        if (!finalResponse || !finalResponse.toolCalls || finalResponse.toolCalls.length === 0) {
          break;
        }
      } else {
        break; // No response from continuation
      }
    }

    return {
      success: true,
      response: finalResponse || undefined,
      iterations,
    };

  } catch (error) {
    console.error('OpenAI run with tool loop failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      iterations,
    };
  }
}