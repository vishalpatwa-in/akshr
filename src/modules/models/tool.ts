// Tool Models
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolOutput {
  tool_call_id: string;
  output: string;
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