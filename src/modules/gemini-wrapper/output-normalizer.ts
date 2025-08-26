import { GeminiResponse, GeminiCandidate, NormalizedResponse, NormalizedToolCall } from './types';

export class GeminiOutputNormalizer {
  /**
   * Normalize a Gemini response to a consistent format
   */
  static normalizeResponse(response: GeminiResponse): NormalizedResponse {
    if (!response.candidates || response.candidates.length === 0) {
      return { text: '' };
    }

    // Get the first candidate (Gemini usually returns one primary response)
    const candidate = response.candidates[0];
    return this.normalizeCandidate(candidate);
  }

  /**
   * Normalize a single candidate
   */
  static normalizeCandidate(candidate: GeminiCandidate): NormalizedResponse {
    if (!candidate.content || !candidate.content.parts) {
      return { text: '' };
    }

    let text = '';
    const toolCalls: NormalizedToolCall[] = [];

    for (const part of candidate.content.parts) {
      if (part.text) {
        text += part.text;
      }

      if (part.functionCall) {
        toolCalls.push({
          id: this.generateToolCallId(),
          name: part.functionCall.name,
          arguments: part.functionCall.args,
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
  static normalizeStreamChunk(chunk: any): NormalizedResponse | null {
    if (!chunk.candidates || chunk.candidates.length === 0) {
      return null;
    }

    const candidate = chunk.candidates[0];
    return this.normalizeCandidate(candidate);
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
      if (response.text) {
        combinedText += response.text;
      }
      if (response.toolCalls) {
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
  static isComplete(response: GeminiResponse): boolean {
    if (!response.candidates || response.candidates.length === 0) {
      return false;
    }

    const candidate = response.candidates[0];
    return candidate.finishReason === 'STOP';
  }

  /**
   * Get finish reason from response
   */
  static getFinishReason(response: GeminiResponse): string | null {
    if (!response.candidates || response.candidates.length === 0) {
      return null;
    }

    return response.candidates[0].finishReason || null;
  }

  /**
   * Handle safety ratings from response
   */
  static handleSafetyRatings(response: GeminiResponse): { blocked: boolean; ratings: any[] } {
    const blocked = response.promptFeedback?.blockReason !== undefined;
    const ratings = response.promptFeedback?.safetyRatings || [];

    return { blocked, ratings };
  }
}