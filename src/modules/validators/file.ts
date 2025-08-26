import { z } from 'zod';

// File Zod Schemas
export const FileStatus = z.enum(["uploaded", "processed", "error"]);

export const File = z.object({
  id: z.string().min(1),
  object: z.literal("file"),
  created_at: z.number().int().positive(),
  filename: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  purpose: z.literal("assistants"),
  expires_at: z.number().int().positive(),
  status: FileStatus,
  status_details: z.string().optional(),
});

// Request/Response schemas
export const UploadFileRequest = z.object({
  file: z.any(), // File upload - would be handled by multipart/form-data
  purpose: z.literal("assistants"),
});

export const FileResponse = File;

export const ListFilesResponse = z.object({
  object: z.literal("list"),
  data: z.array(File),
});

export const DeleteFileResponse = z.object({
  id: z.string(),
  object: z.literal("file"),
  deleted: z.boolean(),
});