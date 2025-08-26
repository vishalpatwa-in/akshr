import { z } from 'zod';

// Error Response Schemas
export const ErrorResponse = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
    param: z.string().optional(),
    code: z.string().optional(),
  }),
});

export const ValidationError = z.object({
  error: z.object({
    message: z.string(),
    type: z.literal("validation_error"),
    param: z.string().optional(),
    code: z.string().optional(),
  }),
});

export const NotFoundError = z.object({
  error: z.object({
    message: z.string(),
    type: z.literal("not_found"),
    param: z.string().optional(),
    code: z.string().optional(),
  }),
});

export const RateLimitError = z.object({
  error: z.object({
    message: z.string(),
    type: z.literal("rate_limit_exceeded"),
    param: z.string().optional(),
    code: z.string().optional(),
  }),
});

export const InternalError = z.object({
  error: z.object({
    message: z.string(),
    type: z.literal("internal_error"),
    param: z.string().optional(),
    code: z.string().optional(),
  }),
});

// Generic error types
export type ErrorType = "validation_error" | "not_found" | "rate_limit_exceeded" | "internal_error";