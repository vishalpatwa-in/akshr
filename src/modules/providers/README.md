# Provider Abstraction Layer

A comprehensive provider abstraction layer that enables seamless switching between Gemini and OpenAI providers with automatic fallback, circuit breaker pattern, and unified error handling.

## Features

- **Unified Interface**: Consistent API across all providers (OpenAI, Gemini, future providers)
- **Automatic Fallback**: Seamless fallback between providers on failures
- **Circuit Breaker**: Prevents cascading failures with configurable circuit breaker pattern
- **Provider Selection**: Intelligent provider selection based on health, capabilities, and preferences
- **Error Handling**: Unified error types and handling across all providers
- **Health Monitoring**: Real-time health checks and performance monitoring
- **Configuration Management**: Flexible configuration with environment variable support
- **Observability**: Comprehensive metrics, logging, and event emission

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Provider       │    │  Provider        │    │  Fallback       │
│  Service        │───▶│  Selection       │───▶│  Manager        │
│                 │    │  Strategy        │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Provider       │    │  Provider        │    │  Circuit        │
│  Registry       │    │  Adapters        │    │  Breaker        │
│                 │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Quick Start

```typescript
import { ProviderService, createDefaultProviderConfiguration } from './providers';

// Create configuration
const config = createDefaultProviderConfiguration();

// Configure providers
config.providers[ProviderType.OPENAI].config.apiKey = 'your-openai-key';
config.providers[ProviderType.GEMINI].config.apiKey = 'your-gemini-key';
config.providers[ProviderType.GEMINI].enabled = true;

// Create service
const providerService = new ProviderService(config);

// Use the service
const response = await providerService.generateResponse({
  model: 'gpt-4-turbo',
  messages: [{ role: 'user', content: 'Hello!' }]
});
```

## Components

### Provider Service

Main entry point that orchestrates all provider operations.

```typescript
const providerService = new ProviderService(config);

// Generate response with automatic fallback
const response = await providerService.generateResponse(request);

// Stream with fallback
for await (const chunk of providerService.streamResponse(request)) {
  console.log(chunk);
}

// Get recommendations
const recommendations = await providerService.getProviderRecommendations(request);
```

### Provider Registry

Manages provider registration, health monitoring, and availability.

```typescript
// Register custom provider
registry.register({
  type: ProviderType.CUSTOM,
  provider: customProvider,
  priority: 3,
  enabled: true
});

// Check health
const health = await registry.getProviderHealth(ProviderType.OPENAI);
```

### Fallback Manager

Handles automatic fallback with circuit breaker pattern.

```typescript
// Execute with fallback
const result = await fallbackManager.executeWithFallback(
  [provider1, provider2, provider3],
  async (provider) => provider.generateResponse(request)
);

// Stream with fallback
yield* fallbackManager.streamWithFallback(
  providers,
  async function* (provider) { yield* provider.streamResponse(request); }
);
```

### Provider Selection Strategy

Intelligent provider selection based on various criteria.

```typescript
// Select best provider
const provider = await selectionStrategy.selectProvider({
  requiredCapabilities: [ProviderCapability.TEXT_GENERATION, ProviderCapability.STREAMING],
  preferredProvider: ProviderType.GEMINI
});
```

## Configuration

### Provider Configuration

```typescript
interface ProviderConfiguration {
  providers: {
    [ProviderType.OPENAI]?: {
      enabled: boolean;
      config: ProviderConfig;
      priority: number;
      fallbackFor?: ProviderType[];
    };
    [ProviderType.GEMINI]?: {
      enabled: boolean;
      config: ProviderConfig;
      priority: number;
      fallbackFor?: ProviderType[];
    };
  };
  fallback: {
    enabled: boolean;
    maxRetries: number;
    retryDelay: number;
    exponentialBackoff: boolean;
    timeout: number;
    retryableErrors: ProviderErrorType[];
    circuitBreakerThreshold: number;
    circuitBreakerTimeout: number;
  };
  monitoring: {
    enabled: boolean;
    metricsInterval: number;
    healthCheckInterval: number;
  };
}
```

### Environment Variables

```bash
# OpenAI Configuration
OPENAI_API_KEY=your_openai_key
OPENAI_BASE_URL=https://api.openai.com/v1

# Gemini Configuration
GEMINI_API_KEY=your_gemini_key
GEMINI_BASE_URL=https://generativelanguage.googleapis.com

# Fallback Configuration
PROVIDER_FALLBACK_ENABLED=true
PROVIDER_MAX_RETRIES=3
PROVIDER_TIMEOUT=30000
```

## Error Handling

All errors are unified into `UnifiedProviderError` with consistent properties:

```typescript
interface UnifiedProviderError extends Error {
  type: ProviderErrorType;
  code?: string;
  statusCode?: number;
  retryable: boolean;
  provider: ProviderType;
  originalError?: any;
}
```

### Error Types

- `NETWORK_ERROR`: Network connectivity issues
- `RATE_LIMIT_ERROR`: Provider rate limiting
- `AUTHENTICATION_ERROR`: Invalid credentials
- `INVALID_REQUEST`: Malformed request
- `SERVER_ERROR`: Provider server errors
- `TIMEOUT_ERROR`: Request timeout
- `UNKNOWN_ERROR`: Unspecified errors

## Circuit Breaker

The circuit breaker prevents cascading failures by temporarily disabling failing providers.

### States

- **CLOSED**: Normal operation, requests flow through
- **OPEN**: Provider is failing, requests are blocked
- **HALF_OPEN**: Testing if provider has recovered

### Configuration

```typescript
{
  circuitBreakerThreshold: 5,    // Open after 5 failures
  circuitBreakerTimeout: 60000,  // Test after 60 seconds
  maxRetries: 3,                 // Retry attempts before fallback
  retryDelay: 1000,              // Initial retry delay
  exponentialBackoff: true       // Use exponential backoff
}
```

## Monitoring and Observability

### Events

Listen to provider events for monitoring:

```typescript
providerService.addEventListener((event) => {
  console.log(`${event.eventType} - ${event.provider}`, {
    duration: event.duration,
    error: event.error
  });
});
```

### Health Checks

```typescript
const health = await providerService.healthCheck();
console.log('Service healthy:', health.healthy);
console.log('Provider status:', health.providers);
```

### Metrics

```typescript
const stats = await providerService.getStats();
console.log('Request counts:', stats.providers);
console.log('Circuit breakers:', stats.circuitBreakers);
```

## Provider Capabilities

Each provider declares its capabilities:

```typescript
enum ProviderCapability {
  TEXT_GENERATION = 'text_generation',
  TOOL_CALLING = 'tool_calling',
  STREAMING = 'streaming',
  VISION = 'vision',
  MULTIMODAL = 'multimodal'
}
```

### OpenAI Capabilities
- Text generation
- Tool calling
- Streaming
- Vision

### Gemini Capabilities
- Text generation
- Tool calling
- Streaming
- Vision
- Multimodal

## Examples

### Basic Usage

```typescript
import { ProviderService, createDefaultProviderConfiguration } from './providers';

const config = createDefaultProviderConfiguration();
config.providers[ProviderType.OPENAI].config.apiKey = process.env.OPENAI_API_KEY;
config.providers[ProviderType.GEMINI].config.apiKey = process.env.GEMINI_API_KEY;
config.providers[ProviderType.GEMINI].enabled = true;

const providerService = new ProviderService(config);

async function chat(message: string) {
  try {
    const response = await providerService.generateResponse({
      model: 'gpt-4-turbo',
      messages: [{ role: 'user', content: message }]
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('Failed to generate response:', error);
    throw error;
  }
}
```

### Advanced Configuration

```typescript
const config = {
  providers: {
    [ProviderType.OPENAI]: {
      enabled: true,
      config: {
        apiKey: process.env.OPENAI_API_KEY,
        timeout: 15000,
        maxRetries: 2
      },
      priority: 1,
      fallbackFor: []
    },
    [ProviderType.GEMINI]: {
      enabled: true,
      config: {
        apiKey: process.env.GEMINI_API_KEY,
        timeout: 10000,
        model: 'gemini-pro-vision'
      },
      priority: 2,
      fallbackFor: [ProviderType.OPENAI]
    }
  },
  fallback: {
    enabled: true,
    maxRetries: 2,
    retryDelay: 500,
    timeout: 30000,
    circuitBreakerThreshold: 3,
    circuitBreakerTimeout: 30000
  }
};
```

## Integration Points

The provider abstraction layer integrates with:

- **Run Execution Engine**: Provides unified inference capabilities
- **Streaming Service**: Handles provider switching during streaming
- **Tool Calling Flow**: Maintains tool execution across provider switches
- **State Management**: Preserves conversation state during provider switches

## Best Practices

1. **Configure Timeouts**: Set appropriate timeouts for your use case
2. **Enable Fallback**: Always enable fallback for production environments
3. **Monitor Health**: Regularly check provider health and metrics
4. **Handle Errors**: Implement proper error handling for unified errors
5. **Test Fallbacks**: Test fallback scenarios in staging environments
6. **Configure Circuit Breakers**: Tune circuit breaker settings based on your traffic patterns

## Troubleshooting

### Common Issues

1. **All providers failing**: Check API keys and network connectivity
2. **Circuit breaker open**: Wait for automatic recovery or manually reset
3. **Slow responses**: Check provider health and consider timeout adjustments
4. **Rate limiting**: Implement request queuing or increase limits

### Debugging

```typescript
// Enable detailed logging
providerService.addEventListener((event) => {
  console.log(`[${event.timestamp}] ${event.eventType}`, {
    provider: event.provider,
    duration: event.duration,
    error: event.error
  });
});

// Check provider health
const health = await providerService.healthCheck();
console.log('Health status:', health);
```

## Migration Guide

### From Direct Provider Usage

Replace direct provider instantiation:

```typescript
// Before
const openai = new OpenAIClient({ apiKey: 'key' });
const response = await openai.generate(request);

// After
const providerService = new ProviderService(config);
const response = await providerService.generateResponse(request);
```

### From Single Provider

Enable fallback for improved reliability:

```typescript
// Enable multiple providers
config.providers[ProviderType.GEMINI].enabled = true;
config.fallback.enabled = true;

// Use as before, fallback happens automatically
const response = await providerService.generateResponse(request);