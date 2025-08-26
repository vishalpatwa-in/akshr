// Message Model
export interface Message {
  id: string;
  object: "message";
  created_at: number;
  thread_id: string;
  role: "user" | "assistant" | "tool";
  content: MessageContent[];
  file_ids?: string[];
  metadata?: Record<string, any>;
  assistant_id?: string;
  run_id?: string;
  tool_call_id?: string;
}

export type MessageContent =
  | TextContent
  | ImageContent
  | ToolCallContent;

export interface TextContent {
  type: "text";
  text: {
    value: string;
    annotations?: TextAnnotation[];
  };
}

export interface ImageContent {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "low" | "high" | "auto";
  };
}

export interface ToolCallContent {
  type: "tool_call";
  tool_call: ToolCall;
}

export interface TextAnnotation {
  type: "file_citation" | "file_path";
  text: string;
  file_citation?: {
    file_id: string;
    quote?: string;
  };
  file_path?: {
    file_id: string;
  };
  start_index: number;
  end_index: number;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}