import { OpenAIMessage, OpenAIContent, OpenAIToolCall } from './types';
import { Assistant, Message, Tool } from '../models/index';

export class OpenAIPromptBuilder {
  /**
   * Build OpenAI messages from assistant instructions and thread messages
   */
  static buildMessages(
    assistant: Assistant,
    messages: Message[],
    includeSystemInstruction = true
  ): OpenAIMessage[] {
    const openaiMessages: OpenAIMessage[] = [];

    // Add system instruction as the first message if requested
    if (includeSystemInstruction && assistant.instructions) {
      openaiMessages.push({
        role: 'system',
        content: assistant.instructions,
      });
    }

    // Convert thread messages to OpenAI format
    for (const message of messages) {
      const openaiMessage = this.convertMessageToOpenAI(message);
      if (openaiMessage) {
        openaiMessages.push(openaiMessage);
      }
    }

    return openaiMessages;
  }

  /**
   * Convert a single message to OpenAI format
   */
  private static convertMessageToOpenAI(message: Message): OpenAIMessage | null {
    let content: string | OpenAIContent[] = '';
    const toolCalls: OpenAIToolCall[] = [];
    let hasContent = false;

    for (const messageContent of message.content) {
      switch (messageContent.type) {
        case 'text':
          if (messageContent.text?.value) {
            if (typeof content === 'string') {
              if (content.length === 0) {
                content = messageContent.text.value;
              } else {
                // Convert to array format for mixed content
                const newContent: OpenAIContent[] = [
                  { type: 'text', text: content },
                  { type: 'text', text: messageContent.text.value },
                ];
                content = newContent;
              }
            } else {
              (content as OpenAIContent[]).push({
                type: 'text',
                text: messageContent.text.value,
              });
            }
            hasContent = true;
          }
          break;

        case 'image_url':
          if (messageContent.image_url?.url) {
            if (Array.isArray(content)) {
              content.push({
                type: 'image_url',
                image_url: {
                  url: messageContent.image_url.url,
                  detail: 'auto',
                },
              });
            } else {
              // Convert to array format
              const textContent = typeof content === 'string' ? content : '';
              const newContent: OpenAIContent[] = [];
              if (textContent) {
                newContent.push({ type: 'text', text: textContent });
              }
              newContent.push({
                type: 'image_url',
                image_url: {
                  url: messageContent.image_url.url,
                  detail: 'auto',
                },
              });
              content = newContent;
            }
            hasContent = true;
          }
          break;

        case 'tool_call':
          if (messageContent.tool_call) {
            toolCalls.push({
              id: messageContent.tool_call.id,
              type: 'function',
              function: {
                name: messageContent.tool_call.function.name,
                arguments: messageContent.tool_call.function.arguments,
              },
            });
            hasContent = true;
          }
          break;
      }
    }

    // If no content was added, return null
    if (!hasContent && toolCalls.length === 0) {
      return null;
    }

    const openaiMessage: OpenAIMessage = {
      role: this.convertRole(message.role),
      content: content,
    };

    // Add tool calls if present
    if (toolCalls.length > 0) {
      openaiMessage.tool_calls = toolCalls;
    }

    return openaiMessage;
  }

  /**
   * Convert message role to OpenAI role
   */
  private static convertRole(role: string): 'system' | 'user' | 'assistant' | 'tool' {
    switch (role) {
      case 'system':
        return 'system';
      case 'assistant':
        return 'assistant';
      case 'tool':
        return 'tool';
      default:
        return 'user';
    }
  }

  /**
   * Add a tool result message to the conversation
   */
  static addToolResult(
    messages: OpenAIMessage[],
    toolCallId: string,
    functionName: string,
    result: any
  ): OpenAIMessage[] {
    const newMessages = [...messages];

    // Add the tool result as a tool message
    newMessages.push({
      role: 'tool',
      content: typeof result === 'string' ? result : JSON.stringify(result),
      tool_call_id: toolCallId,
      name: functionName,
    });

    return newMessages;
  }

  /**
   * Create a user message with text
   */
  static createUserMessage(text: string): OpenAIMessage {
    return {
      role: 'user',
      content: text,
    };
  }

  /**
   * Create an assistant message with text
   */
  static createAssistantMessage(text: string): OpenAIMessage {
    return {
      role: 'assistant',
      content: text,
    };
  }

  /**
   * Create a system message
   */
  static createSystemMessage(text: string): OpenAIMessage {
    return {
      role: 'system',
      content: text,
    };
  }

  /**
   * Create a tool call message
   */
  static createToolCallMessage(
    toolCallId: string,
    functionName: string,
    args: Record<string, any>
  ): OpenAIMessage {
    return {
      role: 'assistant',
      content: '',
      tool_calls: [{
        id: toolCallId,
        type: 'function',
        function: {
          name: functionName,
          arguments: JSON.stringify(args),
        },
      }],
    };
  }

  /**
   * Create a tool result message
   */
  static createToolResultMessage(
    toolCallId: string,
    functionName: string,
    result: any
  ): OpenAIMessage {
    return {
      role: 'tool',
      content: typeof result === 'string' ? result : JSON.stringify(result),
      tool_call_id: toolCallId,
      name: functionName,
    };
  }

  /**
   * Validate message format for OpenAI
   */
  static validateMessages(messages: OpenAIMessage[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      // Check that messages have content (except for assistant messages with tool calls)
      if (typeof message.content === 'string' && message.content.trim() === '') {
        if (!message.tool_calls || message.tool_calls.length === 0) {
          errors.push(`Message ${i}: Must have content or tool_calls`);
        }
      } else if (Array.isArray(message.content) && message.content.length === 0) {
        if (!message.tool_calls || message.tool_calls.length === 0) {
          errors.push(`Message ${i}: Must have content or tool_calls`);
        }
      }

      // Validate tool calls
      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          if (!toolCall.id || !toolCall.function?.name) {
            errors.push(`Message ${i}: Invalid tool call structure`);
          }
        }
      }

      // Validate tool messages have tool_call_id
      if (message.role === 'tool' && !message.tool_call_id) {
        errors.push(`Message ${i}: Tool messages must have tool_call_id`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Optimize messages for OpenAI (remove unnecessary parts, compress)
   */
  static optimizeMessages(messages: OpenAIMessage[]): OpenAIMessage[] {
    return messages.map(message => {
      // Remove empty content strings but keep other properties
      if (typeof message.content === 'string' && message.content.trim() === '') {
        return {
          ...message,
          content: '',
        };
      }

      // Remove empty content arrays but keep other properties
      if (Array.isArray(message.content) && message.content.length === 0) {
        return {
          ...message,
          content: '',
        };
      }

      return message;
    }).filter(message => {
      // Keep messages that have content, tool calls, or are tool messages
      return message.content ||
             message.tool_calls?.length ||
             message.role === 'tool';
    });
  }

  /**
   * Extract tool calls from assistant messages
   */
  static extractToolCalls(messages: OpenAIMessage[]): OpenAIToolCall[] {
    const toolCalls: OpenAIToolCall[] = [];

    for (const message of messages) {
      if (message.role === 'assistant' && message.tool_calls) {
        toolCalls.push(...message.tool_calls);
      }
    }

    return toolCalls;
  }

  /**
   * Count tokens in messages (rough estimation)
   */
  static estimateTokenCount(messages: OpenAIMessage[]): number {
    let totalTokens = 0;

    for (const message of messages) {
      // Rough token estimation: ~4 characters per token for English text
      if (typeof message.content === 'string') {
        totalTokens += Math.ceil(message.content.length / 4);
      } else if (Array.isArray(message.content)) {
        for (const content of message.content) {
          if (content.type === 'text' && content.text) {
            totalTokens += Math.ceil(content.text.length / 4);
          }
        }
      }

      // Add tokens for tool calls
      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          totalTokens += Math.ceil((toolCall.function.name.length + toolCall.function.arguments.length) / 4);
        }
      }
    }

    return totalTokens;
  }
}