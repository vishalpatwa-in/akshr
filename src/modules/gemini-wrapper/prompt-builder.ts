import { GeminiMessage, GeminiPart } from './types';
import { Assistant, Message, Tool } from '../models/index';

export class GeminiPromptBuilder {
  /**
   * Build Gemini messages from assistant instructions and thread messages
   */
  static buildMessages(
    assistant: Assistant,
    messages: Message[],
    includeSystemInstruction = true
  ): GeminiMessage[] {
    const geminiMessages: GeminiMessage[] = [];

    // Add system instruction as the first message if requested
    if (includeSystemInstruction && assistant.instructions) {
      geminiMessages.push({
        role: 'user',
        parts: [{ text: assistant.instructions }],
      });

      // Add an empty model response to maintain conversation flow
      geminiMessages.push({
        role: 'model',
        parts: [{ text: 'Understood. I will follow these instructions.' }],
      });
    }

    // Convert thread messages to Gemini format
    for (const message of messages) {
      const geminiMessage = this.convertMessageToGemini(message);
      if (geminiMessage) {
        geminiMessages.push(geminiMessage);
      }
    }

    return geminiMessages;
  }

  /**
   * Convert a single message to Gemini format
   */
  private static convertMessageToGemini(message: Message): GeminiMessage | null {
    const parts: GeminiPart[] = [];

    for (const content of message.content) {
      switch (content.type) {
        case 'text':
          if (content.text?.value) {
            parts.push({ text: content.text.value });
          }
          break;

        case 'image_url':
          if (content.image_url?.url) {
            // For Gemini, we need to handle image data differently
            // This would need to be implemented based on how images are stored
            console.warn('Image support not fully implemented for Gemini');
          }
          break;

        case 'tool_call':
          if (content.tool_call) {
            parts.push({
              functionCall: {
                name: content.tool_call.function.name,
                args: this.parseArguments(content.tool_call.function.arguments),
              },
            });
          }
          break;
      }
    }

    if (parts.length === 0) {
      return null;
    }

    // Convert role
    const role = this.convertRole(message.role);

    return {
      role,
      parts,
    };
  }

  /**
   * Convert OpenAI role to Gemini role
   */
  private static convertRole(role: string): 'user' | 'model' {
    switch (role) {
      case 'assistant':
        return 'model';
      case 'tool':
        // Tool messages are handled as model responses with function results
        return 'model';
      default:
        return 'user';
    }
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
   * Add a tool result message to the conversation
   */
  static addToolResult(
    messages: GeminiMessage[],
    toolCallId: string,
    functionName: string,
    result: any
  ): GeminiMessage[] {
    const newMessages = [...messages];

    // Add the tool result as a model response
    newMessages.push({
      role: 'model',
      parts: [{
        functionResponse: {
          name: functionName,
          response: result,
        },
      }],
    });

    return newMessages;
  }

  /**
   * Create a user message with text
   */
  static createUserMessage(text: string): GeminiMessage {
    return {
      role: 'user',
      parts: [{ text }],
    };
  }

  /**
   * Create a model message with text
   */
  static createModelMessage(text: string): GeminiMessage {
    return {
      role: 'model',
      parts: [{ text }],
    };
  }

  /**
   * Create a tool call message
   */
  static createToolCallMessage(
    functionName: string,
    args: Record<string, any>
  ): GeminiMessage {
    return {
      role: 'model',
      parts: [{
        functionCall: {
          name: functionName,
          args,
        },
      }],
    };
  }

  /**
   * Validate message format for Gemini
   */
  static validateMessages(messages: GeminiMessage[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const prevMessage = messages[i - 1];

      // Check role alternation (Gemini expects user/model/user/model pattern)
      if (prevMessage && message.role === prevMessage.role) {
        errors.push(`Message ${i}: Role '${message.role}' cannot follow another '${message.role}'`);
      }

      // Check that messages have content
      if (!message.parts || message.parts.length === 0) {
        errors.push(`Message ${i}: Must have at least one part`);
      }

      // Validate parts
      for (const part of message.parts) {
        if (!part.text && !part.functionCall && !part.functionResponse && !part.inlineData) {
          errors.push(`Message ${i}: Part must have text, functionCall, functionResponse, or inlineData`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Optimize messages for Gemini (remove unnecessary parts, compress)
   */
  static optimizeMessages(messages: GeminiMessage[]): GeminiMessage[] {
    return messages.map(message => ({
      ...message,
      parts: message.parts.filter(part => {
        // Remove empty text parts
        if (part.text && part.text.trim() === '') {
          return false;
        }
        return true;
      }),
    })).filter(message => message.parts.length > 0);
  }
}