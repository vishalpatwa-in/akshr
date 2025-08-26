// Unified Provider Abstraction Layer Types
// Provides a consistent interface across all LLM providers (OpenAI, Gemini, etc.)

export enum ProviderType {
  OPENAI = 'openai',
  GEMINI = 'gemini'
}

export enum ProviderStatus {
  AVAILABLE = 'available',
  UNAVAILABLE = 'unavailable',
  RATE_LIMITED = 'rate_limited',
  ERROR = 'error'
}

export enum ProviderCapability {
  TEXT_GENERATION = 'text_generation',
  TOOL_CALLING = 'tool_calling',
  STREAMING = 'streaming',
  VISION = 'vision',
  MULTIMODAL = 'multimodal'
}

// Unified Message Types (compatible with OpenAI format)
export interface UnifiedMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | UnifiedContent[];
  tool_call_id?: string;
  tool_calls?: UnifiedToolCall[];
  name?: string;
}

export interface UnifiedContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
}

export interface UnifiedToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface UnifiedTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
    strict?: boolean;
  };
}

// Unified Request/Response Types
export interface UnifiedRequest {
  model: string;
  messages: UnifiedMessage[];
  tools?: UnifiedTool[];
  tool_choice?: 'none' | 'auto' | { type: 'function'; function: { name: string } };
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  user?: string;
}

export interface UnifiedResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: UnifiedChoice[];
  usage: UnifiedUsage;
  system_fingerprint?: string;
}

export interface UnifiedChoice {
  index: number;
  message: UnifiedMessage;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null;
}

export interface UnifiedUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// Streaming Response Types
export interface UnifiedStreamResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: UnifiedStreamChoice[];
  usage?: UnifiedUsage;
}

export interface UnifiedStreamChoice {
  index: number;
  delta: UnifiedDelta;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null;
}

export interface UnifiedDelta {
  role?: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: UnifiedToolCall[];
}

// Provider Configuration
export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  model?: string;
  organization?: string;
  // Provider-specific configuration
  [key: string]: any;
}

// Provider Health and Metrics
export interface ProviderHealth {
  status: ProviderStatus;
  lastChecked: number;
  responseTime?: number;
  errorCount: number;
  consecutiveErrors: number;
  rateLimitReset?: number;
}

export interface ProviderMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  rateLimitHits: number;
  lastRequestTime: number;
}

// Unified Error Types
export enum ProviderErrorType {
  NETWORK_ERROR = 'network_error',
  RATE_LIMIT_ERROR = 'rate_limit_error',
  AUTHENTICATION_ERROR = 'authentication_error',
  INVALID_REQUEST = 'invalid_request',
  SERVER_ERROR = 'server_error',
  TIMEOUT_ERROR = 'timeout_error',
  UNKNOWN_ERROR = 'unknown_error'
}

export interface UnifiedProviderError extends Error {
  type: ProviderErrorType;
  code?: string;
  statusCode?: number;
  retryable: boolean;
  provider: ProviderType;
  originalError?: any;
}

// Core Provider Interface
export interface Provider {
  readonly type: ProviderType;
  readonly capabilities: ProviderCapability[];
  readonly config: ProviderConfig;

  // Core methods
  generateResponse(request: UnifiedRequest): Promise<UnifiedResponse>;
  generateWithTools(request: UnifiedRequest): Promise<UnifiedResponse>;
  streamResponse(request: UnifiedRequest): AsyncIterableIterator<UnifiedStreamResponse>;

  // Health and monitoring
  healthCheck(): Promise<ProviderHealth>;
  getMetrics(): ProviderMetrics;

  // Configuration
  updateConfig(config: Partial<ProviderConfig>): void;
  validateConfig(): Promise<boolean>;
}

// Provider Registry Types
export interface ProviderRegistration {
  type: ProviderType;
  provider: Provider;
  priority: number;
  fallbackFor?: ProviderType[];
  enabled: boolean;
}

export interface ProviderSelectionCriteria {
  requiredCapabilities?: ProviderCapability[];
  preferredProvider?: ProviderType;
  excludeProviders?: ProviderType[];
  allowFallback?: boolean;
}

// Fallback Configuration
export interface FallbackConfig {
  enabled: boolean;
  maxRetries: number;
  retryDelay: number;
  exponentialBackoff: boolean;
  timeout: number;
  retryableErrors: ProviderErrorType[];
  circuitBreakerThreshold: number;
  circuitBreakerTimeout: number;
}

// Circuit Breaker States
export enum CircuitBreakerState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open'
}

export interface CircuitBreaker {
  state: CircuitBreakerState;
  failureCount: number;
  lastFailureTime: number;
  successCount: number;
}

// Monitoring and Observability
export interface ProviderEvent {
  timestamp: number;
  provider: ProviderType;
  eventType: 'request' | 'success' | 'error' | 'fallback' | 'circuit_opened' | 'circuit_closed';
  duration?: number;
  error?: UnifiedProviderError;
  requestId?: string;
}

export interface ProviderStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  uptimePercentage: number;
  currentHealth: ProviderHealth;
}

// Configuration Management
export interface ProviderConfiguration {
  providers: {
    [key in ProviderType]?: {
      enabled: boolean;
      config: ProviderConfig;
      priority: number;
      fallbackFor?: ProviderType[];
    };
  };
  fallback: FallbackConfig;
  monitoring: {
    enabled: boolean;
    metricsInterval: number;
    healthCheckInterval: number;
  };
}

// Constants and Defaults
export const PROVIDER_DEFAULTS = {
  TIMEOUT: 30000,
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
  CIRCUIT_BREAKER_THRESHOLD: 5,
  CIRCUIT_BREAKER_TIMEOUT: 60000,
  HEALTH_CHECK_INTERVAL: 30000,
  METRICS_INTERVAL: 60000,
  PROVIDER_PRIORITY: {
    [ProviderType.OPENAI]: 1,
    [ProviderType.GEMINI]: 2,
  }
} as const;

export const PROVIDER_CAPABILITIES = {
  [ProviderType.OPENAI]: [
    ProviderCapability.TEXT_GENERATION,
    ProviderCapability.TOOL_CALLING,
    ProviderCapability.STREAMING,
    ProviderCapability.VISION,
  ],
  [ProviderType.GEMINI]: [
    ProviderCapability.TEXT_GENERATION,
    ProviderCapability.TOOL_CALLING,
    ProviderCapability.STREAMING,
    ProviderCapability.VISION,
    ProviderCapability.MULTIMODAL,
  ],
} as const;

export const RETRYABLE_ERRORS = [
  ProviderErrorType.NETWORK_ERROR,
  ProviderErrorType.TIMEOUT_ERROR,
  ProviderErrorType.SERVER_ERROR,
  ProviderErrorType.RATE_LIMIT_ERROR,
] as const;