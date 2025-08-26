import { z } from 'zod';
import { ProviderType, ProviderConfig } from './assistant';

// Run Zod Schemas
export const RunStatus = z.enum([
  "queued",
  "in_progress",
  "requires_tool_actions",
  "completed",
  "failed",
  "cancelled"
]);

export const RunError = z.object({
  code: z.string(),
  message: z.string(),
});

export const FunctionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  parameters: z.record(z.string(), z.any()).optional(),
});

export const Tool = z.object({
  type: z.literal("function"),
  function: FunctionSchema,
});

export const RequiredToolAction = z.object({
  tool_call_id: z.string().min(1),
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1),
    arguments: z.string(),
  }),
});

export const Run = z.object({
  id: z.string().min(1),
  object: z.literal("run"),
  created_at: z.number().int().positive(),
  thread_id: z.string().min(1),
  assistant_id: z.string().min(1),
  status: RunStatus,
  required_tool_actions: z.array(RequiredToolAction).optional(),
  last_error: RunError.optional(),
  expires_at: z.number().int().positive(),
  started_at: z.number().int().positive().optional(),
  completed_at: z.number().int().positive().optional(),
  model: z.string().min(1),
  instructions: z.string().min(1),
  tools: z.array(Tool),
  file_ids: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  currentProvider: ProviderType.optional(),
  fallbackAttempted: z.boolean().optional(),
  providerConfig: ProviderConfig.optional(),
});

// Request/Response schemas
export const CreateRunRequest = z.object({
  assistant_id: z.string().min(1),
  model: z.string().min(1).optional(),
  instructions: z.string().min(1).optional(),
  tools: z.array(Tool).optional(),
  file_ids: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  currentProvider: ProviderType.optional(),
  fallbackAttempted: z.boolean().optional(),
  providerConfig: ProviderConfig.optional(),
});

export const UpdateRunRequest = z.object({
  metadata: z.record(z.string(), z.any()).optional(),
  currentProvider: ProviderType.optional(),
  fallbackAttempted: z.boolean().optional(),
  providerConfig: ProviderConfig.optional(),
});

export const RunResponse = Run;

export const ListRunsResponse = z.object({
  object: z.literal("list"),
  data: z.array(Run),
  first_id: z.string().optional(),
  last_id: z.string().optional(),
  has_more: z.boolean(),
});

// Tool output submission
export const ToolOutput = z.object({
  tool_call_id: z.string().min(1),
  output: z.string(),
});

export const SubmitToolOutputsRequest = z.object({
  tool_outputs: z.array(ToolOutput),
});