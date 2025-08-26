// File Model
export interface File {
  id: string;
  object: "file";
  created_at: number;
  filename: string;
  bytes: number;
  purpose: "assistants";
  expires_at: number;
  status: FileStatus;
  status_details?: string;
}

export type FileStatus = "uploaded" | "processed" | "error";