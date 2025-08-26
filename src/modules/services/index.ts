// Service exports
export { AssistantService } from './assistant';
export { ThreadService } from './thread';
export { MessageService } from './message';
export { FileService } from './file';
export { RunService } from './run';
export { RunExecutionEngine } from './run-execution-engine';
export { ToolCallingFlow } from './tool-calling-flow';
export { RunStreamingService } from './streaming';

// Utility exports
export {
  DefaultIdGenerator,
  DefaultBusinessRules,
  InMemoryCache,
  ServiceUtils
} from './utils';

// Base service exports
export {
  BaseService,
  BaseRepositoryImpl
} from './base';

// Type exports
export type {
  ServiceConfig,
  ServiceResult,
  ValidationResult,
  PaginationOptions,
  ListResponse,
  IdGenerator,
  BusinessRules,
  CacheService,
  BaseRepository,
  ListRepository
} from './types';

/**
 * Service factory for creating all services with shared configuration
 */
import { R2StorageManager } from '../r2-helpers/storage';
import { AssistantR2Bucket } from '../r2-helpers/types';
import { AssistantService } from './assistant';
import { ThreadService } from './thread';
import { MessageService } from './message';
import { FileService } from './file';
import type { ServiceConfig } from './types';

export class ServiceFactory {
  private config: ServiceConfig;

  constructor(bucket: AssistantR2Bucket) {
    const storage = new R2StorageManager(bucket);

    this.config = {
      storage,
      bucket
    };
  }

  createAssistantService(): AssistantService {
    return new AssistantService(this.config);
  }

  createThreadService(): ThreadService {
    return new ThreadService(this.config);
  }

  createMessageService(): MessageService {
    return new MessageService(this.config);
  }

  createFileService(): FileService {
    return new FileService(this.config);
  }

  /**
   * Create all services at once
   */
  createAllServices() {
    return {
      assistants: this.createAssistantService(),
      threads: this.createThreadService(),
      messages: this.createMessageService(),
      files: this.createFileService()
    };
  }
}

/**
 * Default export for convenience
 */
const Services = {
  AssistantService,
  ThreadService,
  MessageService,
  FileService,
  ServiceFactory
};

export default Services;