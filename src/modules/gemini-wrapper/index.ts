// Gemini Wrapper - Main Entry Point
// Comprehensive wrapper for Google's Gemini API integration

export { GeminiClient } from './client';
export { GeminiPromptBuilder } from './prompt-builder';
export { GeminiToolConverter } from './tool-converter';
export { GeminiOutputNormalizer } from './output-normalizer';
export { GeminiInference } from './inference';

// Re-export types for convenience
export type {
  GeminiConfig,
  GeminiMessage,
  GeminiPart,
  GeminiRequest,
  GeminiResponse,
  GeminiStreamResponse,
  GeminiTool,
  GeminiFunctionDeclaration,
  GeminiGenerationConfig,
  NormalizedResponse,
  NormalizedToolCall,
  InferenceConfig,
  GeminiError,
} from './types';

// Main factory function for easy setup
import { GeminiInference } from './inference';
import { GeminiToolConverter } from './tool-converter';
import { Assistant, Message, Tool } from '../models/index';
import { NormalizedResponse } from './types';

/**
 * Create a Gemini inference instance
 */
export function createGeminiInference(apiKey: string, model?: string): GeminiInference {
  return new GeminiInference(apiKey, model);
}

/**
 * Quick helper to generate a response from an assistant and messages
 */
export async function generateGeminiResponse(
  apiKey: string,
  assistant: Assistant,
  messages: Message[],
  model?: string
): Promise<NormalizedResponse> {
  const inference = new GeminiInference(apiKey, model);
  return inference.generateAssistantResponse(assistant, messages);
}

/**
 * Quick helper to generate a response with tools
 */
export async function generateGeminiWithTools(
  apiKey: string,
  messages: Message[],
  tools: Tool[],
  model?: string
): Promise<NormalizedResponse> {
  const inference = new GeminiInference(apiKey, model);
  return inference.generateWithTools(messages, tools);
}

/**
 * Validate tools for Gemini compatibility
 */
export function validateToolsForGemini(tools: Tool[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const tool of tools) {
    const validation = GeminiToolConverter.validateToolSchema(tool.function);
    if (!validation.valid) {
      errors.push(`Tool '${tool.function.name}': ${validation.errors.join(', ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Convert OpenAI tools to Gemini format
 */
export function convertToolsToGemini(tools: Tool[]): any[] {
  return GeminiToolConverter.convertTools(tools);
}

/**
 * Constants and defaults
 */
export const GEMINI_DEFAULTS = {
  MODEL: 'gemini-pro',
  MAX_TOKENS: 4096,
  TEMPERATURE: 0.7,
  TOP_K: 40,
  TOP_P: 0.95,
} as const;

/**
 * Supported Gemini models
 */
export const GEMINI_MODELS = {
  GEMINI_PRO: 'gemini-pro',
  GEMINI_PRO_VISION: 'gemini-pro-vision',
  GEMINI_ULTRA: 'gemini-ultra',
} as const;

/**
 * Error types specific to Gemini
 */
export class GeminiWrapperError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'GeminiWrapperError';
  }
}

/**
 * Helper to create Gemini-specific errors
 */
export function createGeminiError(
  message: string,
  code: string,
  statusCode?: number
): GeminiWrapperError {
  return new GeminiWrapperError(message, code, statusCode);
}