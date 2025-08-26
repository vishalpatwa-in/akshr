import { z } from 'zod';

// Tool Zod Schemas
export const FunctionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  parameters: z.record(z.string(), z.any()).optional(),
});

export const Tool = z.object({
  type: z.literal("function"),
  function: FunctionSchema,
});

export const ToolCall = z.object({
  id: z.string().min(1),
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1),
    arguments: z.string(),
  }),
});

export const ToolOutput = z.object({
  tool_call_id: z.string().min(1),
  output: z.string(),
});