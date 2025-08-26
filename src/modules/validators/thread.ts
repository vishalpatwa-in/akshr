import { z } from 'zod';

// Thread Zod Schemas
export const Thread = z.object({
  id: z.string().min(1),
  object: z.literal("thread"),
  created_at: z.number().int().positive(),
  metadata: z.record(z.string(), z.any()).optional(),
});

// Request/Response schemas
export const CreateThreadRequest = z.object({
  messages: z.array(z.any()).optional(), // Will be defined in message validators
  metadata: z.record(z.string(), z.any()).optional(),
});

export const UpdateThreadRequest = z.object({
  metadata: z.record(z.string(), z.any()).optional(),
});

export const ThreadResponse = Thread;

export const ListThreadsResponse = z.object({
  object: z.literal("list"),
  data: z.array(Thread),
  first_id: z.string().optional(),
  last_id: z.string().optional(),
  has_more: z.boolean(),
});