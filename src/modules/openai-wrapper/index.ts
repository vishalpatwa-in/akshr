// OpenAI Wrapper - Main Entry Point
// Comprehensive wrapper for OpenAI API integration with GPT-5 compatibility

import { OpenAIInference } from './inference';
import { OpenAIToolConverter } from './tool-converter';
import type { OpenAITool, NormalizedResponse } from './types';

export { OpenAIClient } from './client';
export { OpenAIInference } from './inference';
export { OpenAIPromptBuilder } from './prompt-builder';
export { OpenAIToolConverter } from './tool-converter';
export { OpenAIOutputNormalizer } from './output-normalizer';

// Re-export types for convenience
export type {
  OpenAIConfig,
  OpenAIRequest,
  OpenAIResponse,
  OpenAIStreamResponse,
  OpenAIError,
  OpenAIStreamingEvent,
  OpenAIMessage,
  OpenAIContent,
  OpenAIToolCall,
  OpenAITool,
  InferenceConfig,
  NormalizedResponse,
  NormalizedToolCall,
  GPT5Config,
} from './types';

// Re-export integration functions
export {
  executeOpenAIRun,
  continueOpenAIRunWithTools,
  streamOpenAIResponse,
  validateOpenAIEnvironment,
  createOpenAIAssistant,
  migrateRunToOpenAI,
  generateOpenAIResponse,
  generateOpenAIWithTools,
  executeOpenAIRunWithToolLoop,
  type OpenAIRunConfig,
} from './integration';

/**
 * Create an OpenAI inference instance
 */
export function createOpenAIInference(apiKey: string, model?: string): OpenAIInference {
  return new OpenAIInference(apiKey, model);
}

/**
 * Quick helper to generate a response from an assistant and messages
 */
export async function generateOpenAIAssistantResponse(
  apiKey: string,
  assistant: any,
  messages: any[],
  model?: string
): Promise<NormalizedResponse> {
  const inference = new OpenAIInference(apiKey, model);
  return inference.generateAssistantResponse(assistant, messages);
}

/**
 * Validate tools for OpenAI compatibility
 */
export function validateToolsForOpenAI(tools: any[]): { valid: boolean; errors: string[]; warnings: string[] } {
  return OpenAIToolConverter.validateToolCollection(tools);
}

/**
 * Convert tools to OpenAI format
 */
export function convertToolsToOpenAI(tools: any[]): OpenAITool[] {
  return OpenAIToolConverter.convertTools(tools);
}

/**
 * Constants and defaults
 */
export const OPENAI_DEFAULTS = {
  MODEL: 'gpt-5-turbo',
  MAX_TOKENS: 4096,
  TEMPERATURE: 0.7,
  TOP_P: 1.0,
  VERBOSITY: 'medium' as const,
  REASONING_EFFORT: 'medium' as const,
} as const;

/**
 * Supported OpenAI models (including GPT-5)
 */
export const OPENAI_MODELS = {
  // GPT-5 Models
  GPT5_TURBO: 'gpt-5-turbo',
  GPT5_TURBO_PREVIEW: 'gpt-5-turbo-preview',
  GPT5_VISION: 'gpt-5-vision',
  // GPT-4 Models (for compatibility)
  GPT4_TURBO: 'gpt-4-turbo',
  GPT4_VISION: 'gpt-4-vision-preview',
  GPT4: 'gpt-4',
  GPT35_TURBO: 'gpt-3.5-turbo',
} as const;

/**
 * GPT-5 Specific Model Capabilities
 */
export const GPT5_CAPABILITIES = {
  VERBOSITY_LEVELS: ['low', 'medium', 'high'] as const,
  REASONING_EFFORT_LEVELS: ['low', 'medium', 'high'] as const,
  MAX_TOKENS: 32768,
  SUPPORTS_FUNCTION_CALLING: true,
  SUPPORTS_VISION: true,
  SUPPORTS_STREAMING: true,
} as const;

/**
 * Error types specific to OpenAI
 */
export class OpenAIWrapperError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'OpenAIWrapperError';
  }
}

/**
 * Helper to create OpenAI-specific errors
 */
export function createOpenAIError(
  message: string,
  code: string,
  statusCode?: number
): OpenAIWrapperError {
  return new OpenAIWrapperError(message, code, statusCode);
}

/**
 * Check if the model supports GPT-5 features
 */
export function supportsGPT5Features(model: string): boolean {
  return model.includes('gpt-5') || model.includes('gpt-4');
}

/**
 * Get recommended model for GPT-5 features
 */
export function getRecommendedModelForGPT5(): string {
  return OPENAI_MODELS.GPT5_TURBO;
}

/**
 * Validate API key format
 */
export function validateApiKeyFormat(apiKey: string): { valid: boolean; error?: string } {
  if (!apiKey) {
    return { valid: false, error: 'API key is required' };
  }

  if (!apiKey.startsWith('sk-')) {
    return { valid: false, error: 'API key should start with "sk-"' };
  }

  if (apiKey.length < 20) {
    return { valid: false, error: 'API key is too short' };
  }

  return { valid: true };
}