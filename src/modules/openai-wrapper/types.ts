// OpenAI Responses API Types and Interfaces
// GPT-5 Compatible OpenAI Wrapper Types

// Configuration
export interface OpenAIConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  organization?: string;
}

// GPT-5 Specific Parameters
export interface GPT5Config {
  verbosity?: 'low' | 'medium' | 'high';
  reasoning_effort?: 'low' | 'medium' | 'high';
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  logit_bias?: Record<string, number>;
}

// OpenAI Message Types
export interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | OpenAIContent[];
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
  name?: string;
}

export interface OpenAIContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
}

// OpenAI Tool Call Types
export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// OpenAI Tool Schema
export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
    strict?: boolean;
  };
}

// OpenAI Responses API Request
export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  tool_choice?: 'none' | 'auto' | { type: 'function'; function: { name: string } };
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  logit_bias?: Record<string, number>;
  user?: string;
  // GPT-5 specific parameters
  verbosity?: 'low' | 'medium' | 'high';
  reasoning_effort?: 'low' | 'medium' | 'high';
}

// OpenAI Response Types
export interface OpenAIResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage: OpenAIUsage;
  system_fingerprint?: string;
}

export interface OpenAIChoice {
  index: number;
  message: OpenAIMessage;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null;
}

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// Streaming Response Types
export interface OpenAIStreamResponse {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: OpenAIStreamChoice[];
  usage?: OpenAIUsage;
  system_fingerprint?: string;
}

export interface OpenAIStreamChoice {
  index: number;
  delta: OpenAIDelta;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null;
}

export interface OpenAIDelta {
  role?: 'developer' | 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: any[]; // Using any for now to avoid OpenAI namespace issues
}

// Error Types
export interface OpenAIError {
  error: {
    message: string;
    type: string;
    param?: string;
    code?: string;
  };
}

// Normalized Output Types (for consistent API)
export interface NormalizedResponse {
  text?: string;
  toolCalls?: NormalizedToolCall[];
}

export interface NormalizedToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

// Configuration for inference
export interface InferenceConfig {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  model?: string;
  // GPT-5 specific
  verbosity?: 'low' | 'medium' | 'high';
  reasoning_effort?: 'low' | 'medium' | 'high';
}

// Streaming Event Types
export interface OpenAIStreamingEvent {
  type: 'run.created' | 'response.delta' | 'tool_call' | 'run.completed' | 'run.failed';
  data: any;
}

// Constants and Defaults
export const OPENAI_DEFAULTS = {
  MODEL: 'gpt-5-turbo',
  MAX_TOKENS: 4096,
  TEMPERATURE: 0.7,
  TOP_P: 1.0,
  VERBOSITY: 'medium' as const,
  REASONING_EFFORT: 'medium' as const,
} as const;

// Supported OpenAI models (including GPT-5)
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

// GPT-5 Specific Model Capabilities
export const GPT5_CAPABILITIES = {
  VERBOSITY_LEVELS: ['low', 'medium', 'high'] as const,
  REASONING_EFFORT_LEVELS: ['low', 'medium', 'high'] as const,
  MAX_TOKENS: 32768,
  SUPPORTS_FUNCTION_CALLING: true,
  SUPPORTS_VISION: true,
  SUPPORTS_STREAMING: true,
} as const;