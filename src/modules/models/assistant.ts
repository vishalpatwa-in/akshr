// Assistant Model
export type ProviderType = "gemini" | "openai";

export interface GeminiProviderConfig {
  temperature?: number;
  max_tokens?: number;
  model: string;
}

export interface OpenAIProviderConfig {
  verbosity?: "low" | "medium" | "high";
  reasoning_effort?: "low" | "medium" | "high";
  model: string;
  temperature?: number;
  max_tokens?: number;
}

export interface ProviderConfig {
  gemini?: GeminiProviderConfig;
  openai?: OpenAIProviderConfig;
}

export interface Assistant {
  id: string;
  object: "assistant";
  created_at: number;
  name: string;
  description?: string;
  instructions: string;
  model: string;
  tools: Tool[];
  file_ids?: string[];
  metadata?: Record<string, any>;
  primaryProvider?: ProviderType;
  fallbackProvider?: ProviderType;
  providerConfig?: ProviderConfig;
}

export interface Tool {
  type: "function";
  function: FunctionSchema;
}

export interface FunctionSchema {
  name: string;
  description?: string;
  parameters?: Record<string, any>;
}