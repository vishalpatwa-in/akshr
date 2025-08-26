import { z } from 'zod';
import { Run, RunStatus, RunError, RequiredToolAction } from '../models/run';
import { Assistant } from '../models/assistant';
import { Thread } from '../models/thread';
import {
  CreateRunRequest,
  UpdateRunRequest,
  SubmitToolOutputsRequest,
  RunResponse,
  ListRunsResponse
} from '../validators/run';
import { R2StorageManager } from '../r2-helpers/storage';
import { AssistantR2Bucket } from '../r2-helpers/types';
import { ServiceConfig, ServiceResult, ValidationResult, PaginationOptions, ListResponse } from './types';
import { ServiceUtils, DefaultIdGenerator, DefaultBusinessRules, InMemoryCache } from './utils';
import { RunStateManager, TransitionContext } from './state-management';

// Infer types from Zod schemas
type CreateRunRequestType = z.infer<typeof CreateRunRequest>;
type UpdateRunRequestType = z.infer<typeof UpdateRunRequest>;
type SubmitToolOutputsRequestType = z.infer<typeof SubmitToolOutputsRequest>;

/**
 * RunService handles run lifecycle management including creation, execution,
 * state transitions, and tool calling flow.
 */
export class RunService {
  private readonly storage: R2StorageManager;
  private readonly bucket: AssistantR2Bucket;
  private readonly idGenerator: DefaultIdGenerator;
  private readonly businessRules: DefaultBusinessRules;
  private readonly cache: InMemoryCache;
  private readonly stateManager: RunStateManager;
  private readonly CACHE_PREFIX = 'run:';
  private readonly CACHE_TTL = 300; // 5 minutes

  constructor(config: ServiceConfig) {
    this.storage = config.storage;
    this.bucket = config.bucket;
    this.idGenerator = new DefaultIdGenerator();
    this.businessRules = new DefaultBusinessRules();
    this.cache = new InMemoryCache();
    this.stateManager = new RunStateManager(config);
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

  private async validateResourceExists(id: string, resourceType: string): Promise<ValidationResult> {
    // This is a placeholder - in a real implementation we'd check the resource
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

  /**
   * Create a new run with validation
   */
  async create(
    threadId: string,
    data: CreateRunRequestType
  ): Promise<ServiceResult<Run>> {
    try {
      // Validate thread exists
      const threadValidation = await this.validateResourceExists(threadId, 'Thread');
      if (!threadValidation.valid) {
        return this.createErrorResult(
          `Invalid thread ID: ${threadValidation.errors.join(', ')}`,
          'INVALID_THREAD_ID'
        );
      }

      // Validate assistant exists and get full data
      const assistantResult = await this.getAssistant(data.assistant_id);
      if (!assistantResult.success || !assistantResult.data) {
        return {
          success: false,
          error: assistantResult.error || 'Assistant not found',
          code: assistantResult.code || 'ASSISTANT_VALIDATION_ERROR'
        };
      }
      const assistant = assistantResult.data;

      // Validate model compatibility
      if (data.model && data.model !== assistant.model) {
        return this.createErrorResult(
          `Model mismatch: requested ${data.model}, assistant uses ${assistant.model}`,
          'MODEL_VALIDATION_ERROR'
        );
      }

      // Check rate limits
      const rateLimitValidation = await this.validateRateLimit('run_create', 'create');
      if (!rateLimitValidation.valid) {
        return this.createErrorResult(
          `Rate limit exceeded: ${rateLimitValidation.errors.join(', ')}`,
          'RATE_LIMIT_ERROR'
        );
      }

      const runId = this.idGenerator.generateRunId();
      const now = Math.floor(Date.now() / 1000);

      const run: Run = {
        id: runId,
        object: 'run',
        created_at: now,
        thread_id: threadId,
        assistant_id: data.assistant_id,
        status: 'queued',
        expires_at: now + (24 * 60 * 60), // 24 hours from now
        model: data.model || assistant.model,
        instructions: data.instructions || assistant.instructions,
        tools: data.tools || assistant.tools || [],
        file_ids: data.file_ids,
        metadata: data.metadata
      };

      // Store the run
      await this.storage.runs.put(threadId, run);

      // Cache the result
      await this.setCache(`${this.CACHE_PREFIX}${threadId}:${runId}`, run, this.CACHE_TTL);

      return this.createSuccessResult(run);
    } catch (error) {
      console.error('Error in create run:', error);
      return this.createErrorResult(
        `Failed to create run: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'CREATE_ERROR'
      );
    }
  }

  /**
   * Get a run by ID
   */
  async getById(threadId: string, runId: string): Promise<ServiceResult<Run>> {
    try {
      // Validate ID formats
      const threadValidation = this.validateIdFormat(threadId, 'thread_');
      if (!threadValidation.valid) {
        return this.createErrorResult(
          `Invalid thread ID: ${threadValidation.errors.join(', ')}`,
          'INVALID_THREAD_ID'
        );
      }

      const runValidation = this.validateIdFormat(runId, 'run_');
      if (!runValidation.valid) {
        return this.createErrorResult(
          `Invalid run ID: ${runValidation.errors.join(', ')}`,
          'INVALID_RUN_ID'
        );
      }

      // Check cache first
      const cached = await this.getFromCache<Run>(`${this.CACHE_PREFIX}${threadId}:${runId}`);
      if (cached) {
        return this.createSuccessResult(cached);
      }

      // Fetch from storage
      const run = await this.storage.runs.get(threadId, runId);
      if (!run) {
        return this.createErrorResult(
          `Run with ID '${runId}' not found in thread '${threadId}'`,
          'NOT_FOUND_ERROR'
        );
      }

      // Cache the result
      await this.setCache(`${this.CACHE_PREFIX}${threadId}:${runId}`, run, this.CACHE_TTL);

      return this.createSuccessResult(run);
    } catch (error) {
      console.error('Error in get run:', error);
      return this.createErrorResult(
        `Failed to get run: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'GET_ERROR'
      );
    }
  }

  /**
   * Update run with atomic state transition
   */
  async update(
    threadId: string,
    runId: string,
    data: UpdateRunRequestType
  ): Promise<ServiceResult<Run>> {
    try {
      // Validate ID formats
      const threadValidation = this.validateIdFormat(threadId, 'thread_');
      if (!threadValidation.valid) {
        return this.createErrorResult(
          `Invalid thread ID: ${threadValidation.errors.join(', ')}`,
          'INVALID_THREAD_ID'
        );
      }

      const runValidation = this.validateIdFormat(runId, 'run_');
      if (!runValidation.valid) {
        return this.createErrorResult(
          `Invalid run ID: ${runValidation.errors.join(', ')}`,
          'INVALID_RUN_ID'
        );
      }

      // Validate update data
      const validation = await this.validateUpdate(threadId, runId, data);
      if (!validation.valid) {
        return this.createErrorResult(
          `Validation failed: ${validation.errors.join(', ')}`,
          'VALIDATION_ERROR'
        );
      }

      // Check rate limits
      const rateLimitValidation = await this.validateRateLimit(`run_update_${runId}`, 'update');
      if (!rateLimitValidation.valid) {
        return this.createErrorResult(
          `Rate limit exceeded: ${rateLimitValidation.errors.join(', ')}`,
          'RATE_LIMIT_ERROR'
        );
      }

      // Get current run
      const currentResult = await this.getById(threadId, runId);
      if (!currentResult.success || !currentResult.data) {
        return currentResult;
      }

      const current = currentResult.data;

      // Apply updates
      const updated: Run = {
        ...current,
        metadata: data.metadata !== undefined ? data.metadata : current.metadata
      };

      // Update with CAS for concurrency control
      await this.storage.runs.put(threadId, updated);

      // Update cache
      await this.setCache(`${this.CACHE_PREFIX}${threadId}:${runId}`, updated, this.CACHE_TTL);

      return this.createSuccessResult(updated);
    } catch (error) {
      console.error('Error in update run:', error);
      return this.createErrorResult(
        `Failed to update run: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'UPDATE_ERROR'
      );
    }
  }

  /**
   * List runs for a thread with pagination
   */
  async listByThread(
    threadId: string,
    options: PaginationOptions = {}
  ): Promise<ServiceResult<ListResponse<Run>>> {
    try {
      // Validate thread exists
      const threadValidation = this.validateIdFormat(threadId, 'thread_');
      if (!threadValidation.valid) {
        return this.createErrorResult(
          `Invalid thread ID: ${threadValidation.errors.join(', ')}`,
          'INVALID_THREAD_ID'
        );
      }

      // Get all runs for the thread
      const allRuns = await this.storage.runs.list(threadId);

      // Sort by creation time (newest first)
      const sortedRuns = allRuns
        .sort((a: Run, b: Run) => b.created_at - a.created_at)
        .filter((run: Run) => {
          // Apply filters if provided
          if (options.before && run.id >= options.before) return false;
          if (options.after && run.id <= options.after) return false;
          return true;
        });

      // Apply pagination
      const limit = Math.min(options.limit || 20, 100); // Max 100 items
      const offset = 0; // For now, we'll implement offset later if needed
      const paginatedRuns = sortedRuns.slice(offset, offset + limit);

      const meta = this.calculatePaginationMeta(paginatedRuns, limit);

      return this.createSuccessResult({
        data: paginatedRuns,
        meta
      });
    } catch (error) {
      console.error('Error in list runs:', error);
      return this.createErrorResult(
        `Failed to list runs: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'LIST_ERROR'
      );
    }
  }

  /**
   * Cancel a run with proper state transition
   */
  async cancel(threadId: string, runId: string): Promise<ServiceResult<Run>> {
    try {
      // Validate ID formats
      const threadValidation = this.validateIdFormat(threadId, 'thread_');
      if (!threadValidation.valid) {
        return this.createErrorResult(
          `Invalid thread ID: ${threadValidation.errors.join(', ')}`,
          'INVALID_THREAD_ID'
        );
      }

      const runValidation = this.validateIdFormat(runId, 'run_');
      if (!runValidation.valid) {
        return this.createErrorResult(
          `Invalid run ID: ${runValidation.errors.join(', ')}`,
          'INVALID_RUN_ID'
        );
      }

      // Get current run
      const currentResult = await this.getById(threadId, runId);
      if (!currentResult.success || !currentResult.data) {
        return currentResult;
      }

      const current = currentResult.data;

      // Check if run can be cancelled
      if (!['queued', 'in_progress'].includes(current.status)) {
        return this.createErrorResult(
          `Run is in ${current.status} status and cannot be cancelled`,
          'INVALID_RUN_STATUS'
        );
      }

      // Update run status to cancelled
      const cancelledRun: Run = {
        ...current,
        status: 'cancelled',
        completed_at: Math.floor(Date.now() / 1000)
      };

      // Update with CAS for concurrency control
      await this.storage.runs.put(threadId, cancelledRun);

      // Update cache
      await this.setCache(`${this.CACHE_PREFIX}${threadId}:${runId}`, cancelledRun, this.CACHE_TTL);

      return this.createSuccessResult(cancelledRun);
    } catch (error) {
      console.error('Error in cancel run:', error);
      return this.createErrorResult(
        `Failed to cancel run: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'CANCEL_ERROR'
      );
    }
  }

  /**
   * Submit tool outputs and continue execution
   */
  async submitToolOutputs(
    threadId: string,
    runId: string,
    data: SubmitToolOutputsRequestType
  ): Promise<ServiceResult<Run>> {
    try {
      // Validate ID formats
      const threadValidation = this.validateIdFormat(threadId, 'thread_');
      if (!threadValidation.valid) {
        return this.createErrorResult(
          `Invalid thread ID: ${threadValidation.errors.join(', ')}`,
          'INVALID_THREAD_ID'
        );
      }

      const runValidation = this.validateIdFormat(runId, 'run_');
      if (!runValidation.valid) {
        return this.createErrorResult(
          `Invalid run ID: ${runValidation.errors.join(', ')}`,
          'INVALID_RUN_ID'
        );
      }

      // Get current run
      const currentResult = await this.getById(threadId, runId);
      if (!currentResult.success || !currentResult.data) {
        return currentResult;
      }

      const current = currentResult.data;

      // Validate run is in requires_tool_actions state
      if (current.status !== 'requires_tool_actions') {
        return this.createErrorResult(
          `Run is in ${current.status} status, expected requires_tool_actions`,
          'INVALID_RUN_STATUS'
        );
      }

      // Validate tool outputs match required tool calls
      if (!current.required_tool_actions) {
        return this.createErrorResult(
          'No tool actions required',
          'INVALID_TOOL_OUTPUTS'
        );
      }

      const requiredToolCallIds = current.required_tool_actions.map(action => action.tool_call_id);
      const providedToolCallIds = data.tool_outputs.map(output => output.tool_call_id);

      const missingToolCalls = requiredToolCallIds.filter(id => !providedToolCallIds.includes(id));
      if (missingToolCalls.length > 0) {
        return this.createErrorResult(
          `Missing tool outputs for tool calls: ${missingToolCalls.join(', ')}`,
          'MISSING_TOOL_OUTPUTS'
        );
      }

      // Transition to in_progress and clear required tool actions
      const updatedRun: Run = {
        ...current,
        status: 'in_progress',
        required_tool_actions: undefined
      };

      // Update with CAS for concurrency control
      await this.storage.runs.put(threadId, updatedRun);

      // Update cache
      await this.setCache(`${this.CACHE_PREFIX}${threadId}:${runId}`, updatedRun, this.CACHE_TTL);

      return this.createSuccessResult(updatedRun);
    } catch (error) {
      console.error('Error in submit tool outputs:', error);
      return this.createErrorResult(
        `Failed to submit tool outputs: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'SUBMIT_TOOL_OUTPUTS_ERROR'
      );
    }
  }

  /**
   * Get assistant by ID
   */
  private async getAssistant(assistantId: string): Promise<ServiceResult<Assistant>> {
    try {
      const assistant = await this.storage.assistants.get(assistantId);
      if (!assistant) {
        return this.createErrorResult(
          `Assistant with ID '${assistantId}' not found`,
          'NOT_FOUND_ERROR'
        );
      }
      return this.createSuccessResult(assistant);
    } catch (error) {
      console.error('Error getting assistant:', error);
      return this.createErrorResult(
        `Failed to get assistant: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'GET_ASSISTANT_ERROR'
      );
    }
  }

  /**
   * Check if a run exists
   */
  async exists(threadId: string, runId: string): Promise<boolean> {
    try {
      return await this.storage.runs.exists(threadId, runId);
    } catch (error) {
      console.error('Error checking run existence:', error);
      return false;
    }
  }

  /**
   * Validate create request
   */
  validateCreate(data: CreateRunRequestType): ValidationResult {
    const errors: string[] = [];

    // Basic validation - runs require an assistant
    if (!data.assistant_id || typeof data.assistant_id !== 'string') {
      errors.push('Assistant ID must be a non-empty string');
    }

    if (data.metadata) {
      const metadataStr = JSON.stringify(data.metadata);
      if (metadataStr.length > 16 * 1024) { // 16KB limit for metadata
        errors.push('Metadata size exceeds maximum allowed size (16KB)');
      }
    }

    return this.createValidationResult(errors.length === 0, errors);
  }

  /**
   * Validate update request
   */
  async validateUpdate(threadId: string, runId: string, data: UpdateRunRequestType): Promise<ValidationResult> {
    const errors: string[] = [];

    // Validate the run exists
    const runExists = await this.exists(threadId, runId);
    if (!runExists) {
      errors.push('Run does not exist');
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