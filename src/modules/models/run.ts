import { ProviderType, ProviderConfig } from './assistant';

// Run Model
export interface Run {
  id: string;
  object: "run";
  created_at: number;
  thread_id: string;
  assistant_id: string;
  status: RunStatus;
  required_tool_actions?: RequiredToolAction[];
  last_error?: RunError;
  expires_at: number;
  started_at?: number;
  completed_at?: number;
  model: string;
  instructions: string;
  tools: Tool[];
  file_ids?: string[];
  metadata?: Record<string, any>;
  currentProvider?: ProviderType;
  fallbackAttempted?: boolean;
  providerConfig?: ProviderConfig;
}

export type RunStatus =
  | "queued"
  | "in_progress"
  | "requires_tool_actions"
  | "completed"
  | "failed"
  | "cancelled";

export interface RequiredToolAction {
  tool_call_id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface RunError {
  code: string;
  message: string;
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