// Gemini API Types and Interfaces

// Configuration
export interface GeminiConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

// Gemini Message Types
export interface GeminiMessage {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface GeminiPart {
  text?: string;
  inlineData?: GeminiInlineData;
  functionCall?: GeminiFunctionCall;
  functionResponse?: GeminiFunctionResponse;
}

export interface GeminiInlineData {
  mimeType: string;
  data: string; // base64 encoded
}

export interface GeminiFunctionCall {
  name: string;
  args: Record<string, any>;
}

export interface GeminiFunctionResponse {
  name: string;
  response: Record<string, any>;
}

// Gemini Function Declaration (for tool schemas)
export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters?: GeminiSchema;
}

export interface GeminiSchema {
  type: string;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  description?: string;
  items?: GeminiSchema;
  enum?: string[];
}

// Request/Response Types
export interface GeminiRequest {
  contents: GeminiMessage[];
  tools?: GeminiTool[];
  generationConfig?: GeminiGenerationConfig;
  systemInstruction?: GeminiMessage;
}

export interface GeminiTool {
  functionDeclarations: GeminiFunctionDeclaration[];
}

export interface GeminiGenerationConfig {
  temperature?: number;
  topK?: number;
  topP?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
}

export interface GeminiResponse {
  candidates: GeminiCandidate[];
  promptFeedback?: GeminiPromptFeedback;
}

export interface GeminiCandidate {
  content: GeminiMessage;
  finishReason: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER';
  index: number;
}

export interface GeminiPromptFeedback {
  blockReason?: 'BLOCKED_REASON_UNSPECIFIED' | 'SAFETY' | 'OTHER';
  safetyRatings: GeminiSafetyRating[];
}

export interface GeminiSafetyRating {
  category: string;
  probability: string;
}

// Streaming Response Types
export interface GeminiStreamResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: GeminiPromptFeedback;
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

// Error Types
export interface GeminiError {
  code: number;
  message: string;
  status: string;
}

// Configuration for inference
export interface InferenceConfig {
  temperature?: number;
  maxTokens?: number;
  topK?: number;
  topP?: number;
  model?: string;
}