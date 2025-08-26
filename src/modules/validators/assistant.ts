import { z } from 'zod';

// Provider Validation Schemas
export const ProviderType = z.enum(["gemini", "openai"]);

export const GeminiProviderConfig = z.object({
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  model: z.string().min(1),
});

export const OpenAIProviderConfig = z.object({
  verbosity: z.enum(["low", "medium", "high"]).optional(),
  reasoning_effort: z.enum(["low", "medium", "high"]).optional(),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
});

export const ProviderConfig = z.object({
  gemini: GeminiProviderConfig.optional(),
  openai: OpenAIProviderConfig.optional(),
});

// Assistant Zod Schemas
export const FunctionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  parameters: z.record(z.string(), z.any()).optional(),
});

export const Tool = z.object({
  type: z.literal("function"),
  function: FunctionSchema,
});

export const Assistant = z.object({
  id: z.string().min(1),
  object: z.literal("assistant"),
  created_at: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().optional(),
  instructions: z.string().min(1),
  model: z.string().min(1),
  tools: z.array(Tool),
  file_ids: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  primaryProvider: ProviderType.optional(),
  fallbackProvider: ProviderType.optional(),
  providerConfig: ProviderConfig.optional(),
}).refine((data) => {
  // Ensure fallback provider is different from primary provider if both are specified
  if (data.primaryProvider && data.fallbackProvider && data.primaryProvider === data.fallbackProvider) {
    return false;
  }
  return true;
}, {
  message: "Fallback provider must be different from primary provider",
  path: ["fallbackProvider"]
});

// Request/Response schemas
export const CreateAssistantRequest = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  instructions: z.string().min(1),
  model: z.string().min(1),
  tools: z.array(Tool).optional().default([]),
  file_ids: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  primaryProvider: ProviderType.optional(),
  fallbackProvider: ProviderType.optional(),
  providerConfig: ProviderConfig.optional(),
}).refine((data) => {
  // Ensure fallback provider is different from primary provider if both are specified
  if (data.primaryProvider && data.fallbackProvider && data.primaryProvider === data.fallbackProvider) {
    return false;
  }
  return true;
}, {
  message: "Fallback provider must be different from primary provider",
  path: ["fallbackProvider"]
});

export const UpdateAssistantRequest = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  instructions: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  tools: z.array(Tool).optional(),
  file_ids: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  primaryProvider: ProviderType.optional(),
  fallbackProvider: ProviderType.optional(),
  providerConfig: ProviderConfig.optional(),
}).refine((data) => {
  // Ensure fallback provider is different from primary provider if both are specified
  if (data.primaryProvider && data.fallbackProvider && data.primaryProvider === data.fallbackProvider) {
    return false;
  }
  return true;
}, {
  message: "Fallback provider must be different from primary provider",
  path: ["fallbackProvider"]
});

export const AssistantResponse = Assistant;

export const ListAssistantsResponse = z.object({
  object: z.literal("list"),
  data: z.array(Assistant),
  first_id: z.string().optional(),
  last_id: z.string().optional(),
  has_more: z.boolean(),
});