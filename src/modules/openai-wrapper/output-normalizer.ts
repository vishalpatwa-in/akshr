import { OpenAIResponse, OpenAIChoice, OpenAIStreamResponse, NormalizedResponse, NormalizedToolCall } from './types';

export class OpenAIOutputNormalizer {
  /**
   * Normalize an OpenAI response to a consistent format
   */
  static normalizeResponse(response: OpenAIResponse): NormalizedResponse {
    if (!response.choices || response.choices.length === 0) {
      return { text: '' };
    }

    // Get the first choice (OpenAI usually returns one primary response)
    const choice = response.choices[0];
    return this.normalizeChoice(choice);
  }

  /**
   * Normalize a single choice
   */
  static normalizeChoice(choice: OpenAIChoice): NormalizedResponse {
    if (!choice.message) {
      return { text: '' };
    }

    const message = choice.message;
    let text = '';
    const toolCalls: NormalizedToolCall[] = [];

    // Extract text content
    if (typeof message.content === 'string') {
      text = message.content;
    } else if (Array.isArray(message.content)) {
      // Handle structured content (with images, etc.)
      for (const content of message.content) {
        if (content.type === 'text' && content.text) {
          text += content.text;
        }
      }
    }

    // Extract tool calls
    if (message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        toolCalls.push({
          id: toolCall.id,
          name: toolCall.function.name,
          arguments: this.parseArguments(toolCall.function.arguments),
        });
      }
    }

    // If we have tool calls, prioritize them over text
    if (toolCalls.length > 0) {
      return { toolCalls };
    }

    return { text: text.trim() };
  }

  /**
   * Normalize streaming response chunks
   */
  static normalizeStreamChunk(chunk: OpenAIStreamResponse): NormalizedResponse | null {
    if (!chunk.choices || chunk.choices.length === 0) {
      return null;
    }

    const choice = chunk.choices[0];
    return this.normalizeStreamChoice(choice);
  }

  /**
   * Normalize a streaming choice
   */
  static normalizeStreamChoice(choice: any): NormalizedResponse | null {
    if (!choice.delta) {
      return null;
    }

    const delta = choice.delta;
    let text = '';
    const toolCalls: NormalizedToolCall[] = [];

    // Extract text content from delta
    if (typeof delta.content === 'string') {
      text = delta.content;
    }

    // Extract tool calls from delta
    if (delta.tool_calls) {
      for (const toolCall of delta.tool_calls) {
        if (toolCall.function) {
          toolCalls.push({
            id: toolCall.id || this.generateToolCallId(),
            name: toolCall.function.name || '',
            arguments: toolCall.function.arguments ? this.parseArguments(toolCall.function.arguments) : {},
          });
        }
      }
    }

    // If we have tool calls, prioritize them
    if (toolCalls.length > 0) {
      return { toolCalls };
    }

    // Return text if present
    if (text) {
      return { text };
    }

    return null;
  }

  /**
   * Extract tool calls from a normalized response
   */
  static extractToolCalls(response: NormalizedResponse): NormalizedToolCall[] {
    return response.toolCalls || [];
  }

  /**
   * Check if response contains tool calls
   */
  static hasToolCalls(response: NormalizedResponse): boolean {
    return Boolean(response.toolCalls && response.toolCalls.length > 0);
  }

  /**
   * Get text content from response
   */
  static getText(response: NormalizedResponse): string {
    return response.text || '';
  }

  /**
   * Combine multiple normalized responses (useful for streaming)
   */
  static combineResponses(responses: NormalizedResponse[]): NormalizedResponse {
    let combinedText = '';
    const combinedToolCalls: NormalizedToolCall[] = [];

    for (const response of responses) {
      if (response && response.text) {
        combinedText += response.text;
      }
      if (response && response.toolCalls) {
        combinedToolCalls.push(...response.toolCalls);
      }
    }

    if (combinedToolCalls.length > 0) {
      return { toolCalls: combinedToolCalls };
    }

    return { text: combinedText };
  }

  /**
   * Format tool calls for OpenAI-compatible output
   */
  static formatToolCallsForOpenAI(toolCalls: NormalizedToolCall[]): any[] {
    return toolCalls.map(call => ({
      id: call.id,
      type: 'function',
      function: {
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      },
    }));
  }

  /**
   * Format normalized response for OpenAI-compatible assistant message
   */
  static formatForAssistantMessage(response: NormalizedResponse): {
    role: 'assistant';
    content: string | null;
    tool_calls?: any[];
  } {
    if (response.toolCalls && response.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: response.text || null,
        tool_calls: this.formatToolCallsForOpenAI(response.toolCalls),
      };
    }

    return {
      role: 'assistant',
      content: response.text || '',
    };
  }

  /**
   * Validate normalized response
   */
  static validateResponse(response: NormalizedResponse): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!response.text && (!response.toolCalls || response.toolCalls.length === 0)) {
      errors.push('Response must have either text or tool calls');
    }

    if (response.toolCalls) {
      for (let i = 0; i < response.toolCalls.length; i++) {
        const call = response.toolCalls[i];

        if (!call.id) {
          errors.push(`Tool call ${i}: Missing ID`);
        }

        if (!call.name) {
          errors.push(`Tool call ${i}: Missing function name`);
        }

        if (!call.arguments || typeof call.arguments !== 'object') {
          errors.push(`Tool call ${i}: Invalid arguments`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Generate a unique tool call ID
   */
  private static generateToolCallId(): string {
    return `call_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Parse function arguments string to object
   */
  private static parseArguments(argsString: string): Record<string, any> {
    try {
      return JSON.parse(argsString);
    } catch {
      return {};
    }
  }

  /**
   * Extract function results from tool responses
   */
  static extractFunctionResults(toolResults: any[]): Array<{ name: string; response: any }> {
    return toolResults.map(result => ({
      name: result.function_name || result.name || '',
      response: result.result || result.response || {},
    }));
  }

  /**
   * Create a tool result message for conversation flow
   */
  static createToolResultMessage(functionName: string, result: any): any {
    return {
      role: 'tool',
      content: JSON.stringify(result),
      tool_call_id: this.generateToolCallId(),
      name: functionName,
    };
  }

  /**
   * Check if a response indicates completion
   */
  static isComplete(response: OpenAIResponse): boolean {
    if (!response.choices || response.choices.length === 0) {
      return false;
    }

    const choice = response.choices[0];
    return choice.finish_reason === 'stop';
  }

  /**
   * Get finish reason from response
   */
  static getFinishReason(response: OpenAIResponse): string | null {
    if (!response.choices || response.choices.length === 0) {
      return null;
    }

    return response.choices[0].finish_reason || null;
  }

  /**
   * Handle usage information from response
   */
  static extractUsage(response: OpenAIResponse): { promptTokens: number; completionTokens: number; totalTokens: number } | null {
    if (!response.usage) {
      return null;
    }

    return {
      promptTokens: response.usage.prompt_tokens,
      completionTokens: response.usage.completion_tokens,
      totalTokens: response.usage.total_tokens,
    };
  }

  /**
   * Check if response was cut off due to length limit
   */
  static isTruncated(response: OpenAIResponse): boolean {
    if (!response.choices || response.choices.length === 0) {
      return false;
    }

    const choice = response.choices[0];
    return choice.finish_reason === 'length';
  }

  /**
   * Get response metadata
   */
  static getMetadata(response: OpenAIResponse): {
    id: string;
    model: string;
    created: number;
    systemFingerprint?: string;
  } | null {
    if (!response) {
      return null;
    }

    return {
      id: response.id,
      model: response.model,
      created: response.created,
      systemFingerprint: response.system_fingerprint,
    };
  }

  /**
   * Convert normalized response to OpenAI-compatible format
   */
  static convertToOpenAIFormat(response: NormalizedResponse): any {
    if (response.toolCalls && response.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: response.text || null,
        tool_calls: this.formatToolCallsForOpenAI(response.toolCalls),
      };
    }

    return {
      role: 'assistant',
      content: response.text || '',
    };
  }

  /**
   * Merge streaming responses into a complete response
   */
  static mergeStreamingResponses(chunks: OpenAIStreamResponse[]): NormalizedResponse {
    const allResponses: NormalizedResponse[] = [];

    for (const chunk of chunks) {
      const normalized = this.normalizeStreamChunk(chunk);
      if (normalized) {
        allResponses.push(normalized);
      }
    }

    return this.combineResponses(allResponses);
  }

  /**
   * Extract all tool calls from a streaming response sequence
   */
  static extractAllToolCallsFromStream(chunks: OpenAIStreamResponse[]): NormalizedToolCall[] {
    const allToolCalls: NormalizedToolCall[] = [];

    for (const chunk of chunks) {
      if (chunk.choices && chunk.choices[0]?.delta?.tool_calls) {
        for (const toolCall of chunk.choices[0].delta.tool_calls) {
          if (toolCall.function) {
            allToolCalls.push({
              id: toolCall.id || this.generateToolCallId(),
              name: toolCall.function.name || '',
              arguments: toolCall.function.arguments ? this.parseArguments(toolCall.function.arguments) : {},
            });
          }
        }
      }
    }

    return allToolCalls;
  }

  /**
   * Check if streaming response indicates tool call completion
   */
  static isToolCallComplete(chunk: OpenAIStreamResponse): boolean {
    if (!chunk.choices || chunk.choices.length === 0) {
      return false;
    }

    const choice = chunk.choices[0];
    return choice.finish_reason === 'tool_calls';
  }
}