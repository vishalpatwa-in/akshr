import { z } from 'zod';

// Message Zod Schemas
export const TextAnnotation = z.object({
  type: z.enum(["file_citation", "file_path"]),
  text: z.string(),
  file_citation: z.object({
    file_id: z.string(),
    quote: z.string().optional(),
  }).optional(),
  file_path: z.object({
    file_id: z.string(),
  }).optional(),
  start_index: z.number().int().nonnegative(),
  end_index: z.number().int().nonnegative(),
});

export const TextContent = z.object({
  type: z.literal("text"),
  text: z.object({
    value: z.string(),
    annotations: z.array(TextAnnotation).optional(),
  }),
});

export const ImageContent = z.object({
  type: z.literal("image_url"),
  image_url: z.object({
    url: z.string().url(),
    detail: z.enum(["low", "high", "auto"]).optional().default("auto"),
  }),
});

export const ToolCall = z.object({
  id: z.string().min(1),
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1),
    arguments: z.string(),
  }),
});

export const ToolCallContent = z.object({
  type: z.literal("tool_call"),
  tool_call: ToolCall,
});

export const MessageContent = z.discriminatedUnion("type", [
  TextContent,
  ImageContent,
  ToolCallContent,
]);

export const Message = z.object({
  id: z.string().min(1),
  object: z.literal("message"),
  created_at: z.number().int().positive(),
  thread_id: z.string().min(1),
  role: z.enum(["user", "assistant", "tool"]),
  content: z.array(MessageContent),
  file_ids: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  assistant_id: z.string().optional(),
  run_id: z.string().optional(),
  tool_call_id: z.string().optional(),
});

// Request/Response schemas
export const CreateMessageRequest = z.object({
  role: z.enum(["user", "assistant", "tool"]),
  content: z.array(MessageContent),
  file_ids: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  assistant_id: z.string().optional(),
  run_id: z.string().optional(),
  tool_call_id: z.string().optional(),
});

export const UpdateMessageRequest = z.object({
  metadata: z.record(z.string(), z.any()).optional(),
});

export const MessageResponse = Message;

export const ListMessagesResponse = z.object({
  object: z.literal("list"),
  data: z.array(Message),
  first_id: z.string().optional(),
  last_id: z.string().optional(),
  has_more: z.boolean(),
});