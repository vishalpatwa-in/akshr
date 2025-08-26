import { z } from 'zod';
import type { Message, MessageContent, TextContent, ImageContent, ToolCallContent } from '../models';
import {
  CreateMessageRequest,
  UpdateMessageRequest,
  MessageResponse,
  ListMessagesResponse
} from '../validators/message';
import { R2StorageManager } from '../r2-helpers/storage';
import { AssistantR2Bucket } from '../r2-helpers/types';
import type {
  ServiceResult,
  ValidationResult,
  PaginationOptions,
  ListResponse,
  ServiceConfig
} from './types';
import { ServiceUtils, DefaultIdGenerator, DefaultBusinessRules, InMemoryCache } from './utils';

// Infer types from Zod schemas
type CreateMessageRequestType = z.infer<typeof CreateMessageRequest>;
type UpdateMessageRequestType = z.infer<typeof UpdateMessageRequest>;

/**
 * Message service implementing comprehensive business logic for message management and content processing
 */
export class MessageService {
  private readonly storage: R2StorageManager;
  private readonly bucket: AssistantR2Bucket;
  private readonly idGenerator: DefaultIdGenerator;
  private readonly businessRules: DefaultBusinessRules;
  private readonly cache: InMemoryCache;
  private readonly CACHE_PREFIX = 'message:';
  private readonly CACHE_TTL = 300; // 5 minutes

  constructor(config: ServiceConfig) {
    this.storage = config.storage;
    this.bucket = config.bucket;
    this.idGenerator = new DefaultIdGenerator();
    this.businessRules = new DefaultBusinessRules();
    this.cache = new InMemoryCache();
  }

  // Helper methods for common operations
  private createSuccessResult<T>(data: T): ServiceResult<T> {
    return ServiceUtils.createSuccessResult(data);
  }

  private createErrorResult(error: string, code?: string): ServiceResult<any> {
    return ServiceUtils.createErrorResult(error, code);
  }

  private createValidationResult(valid: boolean, errors: string[] = []): ValidationResult {
    return ServiceUtils.createValidationResult(valid, errors);
  }

  private validateIdFormat(id: string, expectedPrefix: string): ValidationResult {
    if (!id || typeof id !== 'string') {
      return this.createValidationResult(false, ['ID must be a non-empty string']);
    }
    if (!id.startsWith(expectedPrefix)) {
      return this.createValidationResult(false, [`ID must start with '${expectedPrefix}'`]);
    }
    return this.createValidationResult(true);
  }

  private async validateResourceExists(threadId: string, messageId: string, resourceType: string): Promise<ValidationResult> {
    const exists = await this.exists(threadId, messageId);
    if (!exists) {
      return this.createValidationResult(false, [`${resourceType} with ID '${messageId}' does not exist`]);
    }
    return this.createValidationResult(true);
  }

  private async validateRateLimit(identifier: string, operation: string): Promise<ValidationResult> {
    return this.businessRules.validateRateLimit(identifier, operation);
  }

  private async getFromCache<T>(key: string): Promise<T | null> {
    return this.cache.get<T>(key);
  }

  private async setCache<T>(key: string, value: T, ttlSeconds: number = 300): Promise<void> {
    await this.cache.set(key, value, ttlSeconds);
  }

  private async deleteFromCache(key: string): Promise<void> {
    await this.cache.delete(key);
  }

  private calculatePaginationMeta<T extends { id: string }>(
    items: T[],
    requestedLimit: number,
    totalAvailable?: number
  ) {
    return ServiceUtils.calculatePaginationMeta(items, requestedLimit, totalAvailable);
  }

  private validateContentSize(content: string, maxSize: number = 10 * 1024 * 1024): ValidationResult {
    return ServiceUtils.validateContentSize(content, maxSize);
  }

  /**
   * Create a new message with thread validation and content processing
   */
  async create(threadId: string, data: CreateMessageRequestType): Promise<ServiceResult<Message>> {
    try {
      // Validate thread exists
      const threadExists = await this.storage.threads.exists(threadId);
      if (!threadExists) {
        return this.createErrorResult(
          `Thread with ID '${threadId}' not found`,
          'THREAD_NOT_FOUND'
        );
      }

      // Validate request data
      const validation = this.validateCreate(threadId, data);
      if (!validation.valid) {
        return this.createErrorResult(
          `Validation failed: ${validation.errors.join(', ')}`,
          'VALIDATION_ERROR'
        );
      }

      // Check rate limits
      const rateLimitValidation = await this.validateRateLimit(`message_create_${threadId}`, 'create');
      if (!rateLimitValidation.valid) {
        return this.createErrorResult(
          `Rate limit exceeded: ${rateLimitValidation.errors.join(', ')}`,
          'RATE_LIMIT_ERROR'
        );
      }

      // Process and validate content
      const processedContent = await this.processMessageContent(data.content);
      if (!processedContent.valid) {
        return this.createErrorResult(
          `Content processing failed: ${processedContent.errors.join(', ')}`,
          'CONTENT_PROCESSING_ERROR'
        );
      }

      // Generate ID and create message
      const message: Message = {
        id: this.idGenerator.generateMessageId(),
        object: 'message',
        created_at: Math.floor(Date.now() / 1000),
        thread_id: threadId,
        role: data.role,
        content: processedContent.content!,
        file_ids: data.file_ids,
        metadata: data.metadata,
        assistant_id: data.assistant_id,
        run_id: data.run_id,
        tool_call_id: data.tool_call_id
      };

      // Store message
      await this.storage.messages.put(threadId, message);

      // Cache the result
      await this.setCache(`${this.CACHE_PREFIX}${threadId}:${message.id}`, message, this.CACHE_TTL);

      return this.createSuccessResult(message);
    } catch (error) {
      console.error(`Error in create message:`, error);
      return this.createErrorResult(
        `Failed to create message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'CREATE_ERROR'
      );
    }
  }

  /**
   * Retrieve individual message with thread validation
   */
  async getById(threadId: string, messageId: string): Promise<ServiceResult<Message>> {
    try {
      // Validate IDs format
      const threadIdValidation = this.validateIdFormat(threadId, 'thread_');
      if (!threadIdValidation.valid) {
        return this.createErrorResult(
          `Invalid thread ID: ${threadIdValidation.errors.join(', ')}`,
          'INVALID_THREAD_ID_ERROR'
        );
      }

      const messageIdValidation = this.validateIdFormat(messageId, 'msg_');
      if (!messageIdValidation.valid) {
        return this.createErrorResult(
          `Invalid message ID: ${messageIdValidation.errors.join(', ')}`,
          'INVALID_MESSAGE_ID_ERROR'
        );
      }

      // Check cache first
      const cached = await this.getFromCache<Message>(`${this.CACHE_PREFIX}${threadId}:${messageId}`);
      if (cached) {
        return this.createSuccessResult(cached);
      }

      // Fetch from storage
      const message = await this.storage.messages.get(threadId, messageId);
      if (!message) {
        return this.createErrorResult(
          `Message with ID '${messageId}' not found in thread '${threadId}'`,
          'NOT_FOUND_ERROR'
        );
      }

      // Cache the result
      await this.setCache(`${this.CACHE_PREFIX}${threadId}:${messageId}`, message, this.CACHE_TTL);

      return this.createSuccessResult(message);
    } catch (error) {
      console.error(`Error in get message:`, error);
      return this.createErrorResult(
        `Failed to get message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'GET_ERROR'
      );
    }
  }

  /**
   * Update message content and metadata
   */
  async update(threadId: string, messageId: string, data: UpdateMessageRequestType): Promise<ServiceResult<Message>> {
    try {
      // Validate IDs
      const threadIdValidation = this.validateIdFormat(threadId, 'thread_');
      if (!threadIdValidation.valid) {
        return this.createErrorResult(
          `Invalid thread ID: ${threadIdValidation.errors.join(', ')}`,
          'INVALID_THREAD_ID_ERROR'
        );
      }

      const messageIdValidation = this.validateIdFormat(messageId, 'msg_');
      if (!messageIdValidation.valid) {
        return this.createErrorResult(
          `Invalid message ID: ${messageIdValidation.errors.join(', ')}`,
          'INVALID_MESSAGE_ID_ERROR'
        );
      }

      // Validate update data
      const validation = await this.validateUpdate(threadId, messageId, data);
      if (!validation.valid) {
        return this.createErrorResult(
          `Validation failed: ${validation.errors.join(', ')}`,
          'VALIDATION_ERROR'
        );
      }

      // Get current message
      const currentResult = await this.getById(threadId, messageId);
      if (!currentResult.success || !currentResult.data) {
        return currentResult;
      }

      const current = currentResult.data;

      // Apply updates
      const updated: Message = {
        ...current,
        metadata: data.metadata !== undefined ? data.metadata : current.metadata
      };

      // Update with CAS for concurrency control
      await this.storage.messages.putWithCas(threadId, updated);

      // Update cache
      await this.setCache(`${this.CACHE_PREFIX}${threadId}:${messageId}`, updated, this.CACHE_TTL);

      return this.createSuccessResult(updated);
    } catch (error) {
      console.error(`Error in update message:`, error);
      return this.createErrorResult(
        `Failed to update message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'UPDATE_ERROR'
      );
    }
  }

  /**
   * Delete message with proper cleanup
   */
  async delete(threadId: string, messageId: string): Promise<ServiceResult<void>> {
    try {
      // Validate IDs
      const threadIdValidation = this.validateIdFormat(threadId, 'thread_');
      if (!threadIdValidation.valid) {
        return this.createErrorResult(
          `Invalid thread ID: ${threadIdValidation.errors.join(', ')}`,
          'INVALID_THREAD_ID_ERROR'
        );
      }

      const messageIdValidation = this.validateIdFormat(messageId, 'msg_');
      if (!messageIdValidation.valid) {
        return this.createErrorResult(
          `Invalid message ID: ${messageIdValidation.errors.join(', ')}`,
          'INVALID_MESSAGE_ID_ERROR'
        );
      }

      // Check if message exists
      const exists = await this.exists(threadId, messageId);
      if (!exists) {
        return this.createErrorResult(
          `Message with ID '${messageId}' not found in thread '${threadId}'`,
          'NOT_FOUND_ERROR'
        );
      }

      // Delete from storage
      await this.storage.messages.delete(threadId, messageId);

      // Remove from cache
      await this.deleteFromCache(`${this.CACHE_PREFIX}${threadId}:${messageId}`);

      return this.createSuccessResult(undefined);
    } catch (error) {
      console.error(`Error in delete message:`, error);
      return this.createErrorResult(
        `Failed to delete message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'DELETE_ERROR'
      );
    }
  }

  /**
   * List messages for a thread with pagination
   */
  async listByThread(threadId: string, options: PaginationOptions = {}): Promise<ServiceResult<ListResponse<Message>>> {
    try {
      // Validate thread ID
      const threadIdValidation = this.validateIdFormat(threadId, 'thread_');
      if (!threadIdValidation.valid) {
        return this.createErrorResult(
          `Invalid thread ID: ${threadIdValidation.errors.join(', ')}`,
          'INVALID_THREAD_ID_ERROR'
        );
      }

      // Check if thread exists
      const threadExists = await this.storage.threads.exists(threadId);
      if (!threadExists) {
        return this.createErrorResult(
          `Thread with ID '${threadId}' not found`,
          'THREAD_NOT_FOUND'
        );
      }

      const limit = Math.min(options.limit || 20, 100); // Max 100 items
      const messages: Message[] = [];

      // TODO: Implement proper pagination for messages in R2 storage
      // This would require maintaining an index or using a different storage strategy

      const meta = this.calculatePaginationMeta(messages, limit);

      return this.createSuccessResult({
        data: messages,
        meta
      });
    } catch (error) {
      console.error(`Error in list messages:`, error);
      return this.createErrorResult(
        `Failed to list messages: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'LIST_ERROR'
      );
    }
  }

  /**
   * Check if message exists
   */
  async exists(threadId: string, messageId: string): Promise<boolean> {
    try {
      return await this.storage.messages.exists(threadId, messageId);
    } catch (error) {
      console.error('Error checking message existence:', error);
      return false;
    }
  }

  /**
   * Process and validate message content
   */
  private async processMessageContent(content: MessageContent[]): Promise<{ valid: boolean; content?: MessageContent[]; errors: string[] }> {
    const errors: string[] = [];
    const processedContent: MessageContent[] = [];

    for (const item of content) {
      try {
        switch (item.type) {
          case 'text':
            const textContent = item as TextContent;
            const textValidation = this.validateTextContent(textContent);
            if (!textValidation.valid) {
              errors.push(...textValidation.errors);
            } else {
              processedContent.push(textContent);
            }
            break;

          case 'image_url':
            const imageContent = item as ImageContent;
            const imageValidation = this.validateImageContent(imageContent);
            if (!imageValidation.valid) {
              errors.push(...imageValidation.errors);
            } else {
              processedContent.push(imageContent);
            }
            break;

          case 'tool_call':
            const toolCallContent = item as ToolCallContent;
            const toolValidation = this.businessRules.validateToolSchema(toolCallContent.tool_call);
            if (!toolValidation.valid) {
              errors.push(...toolValidation.errors);
            } else {
              processedContent.push(toolCallContent);
            }
            break;

          default:
            errors.push(`Unsupported content type: ${(item as any).type}`);
        }
      } catch (error) {
        errors.push(`Error processing content item: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return {
      valid: errors.length === 0,
      content: errors.length === 0 ? processedContent : undefined,
      errors
    };
  }

  /**
   * Validate text content
   */
  private validateTextContent(content: TextContent): ValidationResult {
    const errors: string[] = [];

    if (!content.text || typeof content.text.value !== 'string') {
      errors.push('Text content must have a valid text value');
    } else {
      const sizeValidation = this.validateContentSize(content.text.value);
      if (!sizeValidation.valid) {
        errors.push(...sizeValidation.errors);
      }
    }

    return this.createValidationResult(errors.length === 0, errors);
  }

  /**
   * Validate image content
   */
  private validateImageContent(content: ImageContent): ValidationResult {
    const errors: string[] = [];

    if (!content.image_url || !content.image_url.url) {
      errors.push('Image content must have a valid URL');
    } else {
      try {
        new URL(content.image_url.url);
      } catch {
        errors.push('Image URL must be a valid URL');
      }
    }

    return this.createValidationResult(errors.length === 0, errors);
  }

  /**
   * Validate create request
   */
  validateCreate(threadId: string, data: CreateMessageRequestType): ValidationResult {
    const errors: string[] = [];

    if (!data.role || !['user', 'assistant', 'tool'].includes(data.role)) {
      errors.push('Role must be one of: user, assistant, tool');
    }

    if (!data.content || !Array.isArray(data.content) || data.content.length === 0) {
      errors.push('Content must be a non-empty array');
    }

    // Validate metadata size
    if (data.metadata) {
      const metadataStr = JSON.stringify(data.metadata);
      if (metadataStr.length > 16 * 1024) { // 16KB limit for metadata
        errors.push('Metadata size exceeds maximum allowed size (16KB)');
      }
    }

    // Validate thread relationship
    if (!threadId || !threadId.startsWith('thread_')) {
      errors.push('Valid thread ID is required');
    }

    // Role-specific validations
    if (data.role === 'tool' && !data.tool_call_id) {
      errors.push('Tool messages must have a tool_call_id');
    }

    if (data.role === 'assistant' && data.tool_call_id) {
      errors.push('Assistant messages should not have a tool_call_id');
    }

    return this.createValidationResult(errors.length === 0, errors);
  }

  /**
   * Validate update request
   */
  async validateUpdate(threadId: string, messageId: string, data: UpdateMessageRequestType): Promise<ValidationResult> {
    const errors: string[] = [];

    // Validate the message exists
    const existenceValidation = await this.validateResourceExists(threadId, messageId, 'Message');
    if (!existenceValidation.valid) {
      errors.push(...existenceValidation.errors);
    }

    // Validate metadata size
    if (data.metadata) {
      const metadataStr = JSON.stringify(data.metadata);
      if (metadataStr.length > 16 * 1024) { // 16KB limit for metadata
        errors.push('Metadata size exceeds maximum allowed size (16KB)');
      }
    }

    return this.createValidationResult(errors.length === 0, errors);
  }
}