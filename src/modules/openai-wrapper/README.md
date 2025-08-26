# OpenAI Wrapper

A comprehensive OpenAI API wrapper with GPT-5 compatibility, designed for integration with the existing OpenAI-compatible assistant system. This wrapper provides the same interface as the Gemini wrapper, ensuring seamless provider abstraction.

## Features

- **GPT-5 Compatibility**: Full support for GPT-5 models including `verbosity` and `reasoning_effort` parameters
- **Unified Interface**: Same interface as Gemini wrapper for easy provider switching
- **Streaming Support**: Real-time streaming responses with unified event handling
- **Tool Calling**: Advanced function calling with structured parameters
- **Error Handling**: Comprehensive error handling with retry logic
- **TypeScript Support**: Full TypeScript support with detailed type definitions
- **R2 Integration**: Seamless integration with Cloudflare R2 for conversation persistence

## Installation

The OpenAI SDK is already included as a dependency in the project:

```bash
npm install openai --legacy-peer-deps
```

## Quick Start

```typescript
import {
  createOpenAIInference,
  generateOpenAIResponse,
  OPENAI_MODELS
} from './src/modules/openai-wrapper';

// Create an inference instance
const inference = createOpenAIInference('your-api-key', OPENAI_MODELS.GPT5_TURBO);

// Generate a simple response
const response = await inference.generateResponse([
  { role: 'user', content: 'Hello, how are you?' }
]);

console.log(response.text);
```

## GPT-5 Features

### Verbosity Control

Control the verbosity level of GPT-5 responses:

```typescript
const response = await inference.generateResponse(messages, {
  verbosity: 'low',    // Concise responses
  verbosity: 'medium', // Balanced responses (default)
  verbosity: 'high'    // Detailed responses
});
```

### Reasoning Effort

Adjust the reasoning effort for complex tasks:

```typescript
const response = await inference.generateResponse(messages, {
  reasoning_effort: 'low',    // Fast responses
  reasoning_effort: 'medium', // Balanced reasoning (default)
  reasoning_effort: 'high'    // Deep reasoning
});
```

## Core Components

### OpenAIClient

Low-level API client for direct OpenAI API interactions:

```typescript
import { OpenAIClient } from './src/modules/openai-wrapper';

const client = new OpenAIClient({
  apiKey: 'your-api-key',
  model: 'gpt-5-turbo'
});

const response = await client.generate({
  model: 'gpt-5-turbo',
  messages: [{ role: 'user', content: 'Hello!' }]
});
```

### OpenAIInference

High-level inference class with the same interface as GeminiInference:

```typescript
import { OpenAIInference } from './src/modules/openai-wrapper';

const inference = new OpenAIInference('your-api-key', 'gpt-5-turbo');

// Generate response
const response = await inference.generateResponse(messages);

// Generate with tools
const response = await inference.generateWithTools(messages, tools);

// Generate for assistant
const response = await inference.generateAssistantResponse(assistant, messages);

// Stream response
for await (const chunk of inference.streamResponse(messages, tools)) {
  console.log(chunk.text);
}
```

### OpenAIPromptBuilder

Build and format prompts for OpenAI API:

```typescript
import { OpenAIPromptBuilder } from './src/modules/openai-wrapper';

// Build messages from assistant and thread messages
const messages = OpenAIPromptBuilder.buildMessages(assistant, threadMessages, true);

// Create individual message types
const userMessage = OpenAIPromptBuilder.createUserMessage('Hello!');
const systemMessage = OpenAIPromptBuilder.createSystemMessage('You are a helpful assistant.');

// Add tool results to conversation
const updatedMessages = OpenAIPromptBuilder.addToolResult(
  messages,
  'call_123',
  'get_weather',
  { temperature: 72, condition: 'sunny' }
);
```

### OpenAIToolConverter

Convert and validate tool schemas:

```typescript
import { OpenAIToolConverter } from './src/modules/openai-wrapper';

// Validate tools
const validation = OpenAIToolConverter.validateToolCollection(tools);
if (!validation.valid) {
  console.error('Tool validation failed:', validation.errors);
}

// Convert tools to OpenAI format
const openaiTools = OpenAIToolConverter.convertTools(tools);
```

### OpenAIOutputNormalizer

Normalize OpenAI responses to unified format:

```typescript
import { OpenAIOutputNormalizer } from './src/modules/openai-wrapper';

// Normalize response
const normalized = OpenAIOutputNormalizer.normalizeResponse(openaiResponse);

// Extract tool calls
const toolCalls = OpenAIOutputNormalizer.extractToolCalls(normalized);

// Check for tool calls
if (OpenAIOutputNormalizer.hasToolCalls(normalized)) {
  // Handle tool calls
}
```

## Integration with Existing Architecture

### Run Execution

```typescript
import { executeOpenAIRun } from './src/modules/openai-wrapper/integration';

const result = await executeOpenAIRun(
  run,
  assistant,
  messages,
  {
    apiKey: 'your-api-key',
    model: 'gpt-5-turbo',
    temperature: 0.7,
    verbosity: 'medium',
    reasoning_effort: 'high'
  },
  env // Cloudflare Workers environment
);

if (result.success) {
  if (result.toolCalls) {
    // Handle tool calls
    console.log('Tool calls:', result.toolCalls);
  } else {
    // Handle text response
    console.log('Response:', result.response?.text);
  }
}
```

### Streaming Responses

```typescript
import { streamOpenAIResponse } from './src/modules/openai-wrapper/integration';

for await (const event of streamOpenAIResponse(run, assistant, messages, config)) {
  switch (event.type) {
    case 'chunk':
      console.log('Text chunk:', event.content);
      break;
    case 'tool_call':
      console.log('Tool call:', event.toolCall);
      break;
    case 'complete':
      console.log('Stream complete');
      break;
  }
}
```

### Tool Calling Loop

```typescript
import { executeOpenAIRunWithToolLoop } from './src/modules/openai-wrapper/integration';

const result = await executeOpenAIRunWithToolLoop(
  run,
  assistant,
  messages,
  config,
  env,
  5 // max iterations
);

console.log(`Completed in ${result.iterations} iterations`);
```

## Configuration

### Environment Variables

```bash
OPENAI_API_KEY=sk-your-api-key-here
```

### Configuration Object

```typescript
interface OpenAIRunConfig {
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  verbosity?: 'low' | 'medium' | 'high';
  reasoning_effort?: 'low' | 'medium' | 'high';
}
```

## Supported Models

| Model | GPT-5 Features | Vision | Tool Calling |
|-------|----------------|--------|--------------|
| gpt-5-turbo | ✅ | ❌ | ✅ |
| gpt-5-turbo-preview | ✅ | ❌ | ✅ |
| gpt-5-vision | ✅ | ✅ | ✅ |
| gpt-4-turbo | ❌ | ✅ | ✅ |
| gpt-4 | ❌ | ❌ | ✅ |
| gpt-3.5-turbo | ❌ | ❌ | ✅ |

## Error Handling

The wrapper includes comprehensive error handling:

```typescript
try {
  const response = await inference.generateResponse(messages);
} catch (error) {
  if (error instanceof OpenAIWrapperError) {
    console.error(`OpenAI error [${error.code}]:`, error.message);
  } else {
    console.error('Unexpected error:', error);
  }
}
```

## Best Practices

### 1. API Key Security
- Store API keys in environment variables
- Use Cloudflare Workers secrets for production
- Rotate keys regularly

### 2. Tool Schema Validation
- Always validate tool schemas before use
- Use descriptive names and descriptions
- Keep parameter schemas simple and focused

### 3. GPT-5 Feature Usage
- Use `verbosity: 'low'` for concise responses
- Use `reasoning_effort: 'high'` for complex reasoning tasks
- Test different combinations for your use case

### 4. Streaming
- Handle streaming events appropriately
- Implement proper cleanup for long-running streams
- Use streaming for better user experience

### 5. Error Handling
- Implement retry logic for transient failures
- Handle rate limits gracefully
- Log errors for debugging

## Migration from Gemini

If you're migrating from the Gemini wrapper:

1. **Update imports**:
   ```typescript
   // Before
   import { createGeminiInference } from './gemini-wrapper';

   // After
   import { createOpenAIInference } from './openai-wrapper';
   ```

2. **Update configuration**:
   ```typescript
   // Before
   const config = { apiKey: 'gemini-key', model: 'gemini-pro' };

   // After
   const config = {
     apiKey: 'openai-key',
     model: 'gpt-5-turbo',
     verbosity: 'medium',
     reasoning_effort: 'medium'
   };
   ```

3. **Update model references**:
   ```typescript
   // Before
   model: 'gemini-pro'

   // After
   model: 'gpt-5-turbo'
   ```

## Contributing

When contributing to this wrapper:

1. Follow the existing code style
2. Add TypeScript types for new features
3. Update tests for new functionality
4. Update documentation for API changes
5. Ensure compatibility with existing interface

## License

This wrapper is part of the OpenAI-compatible assistant system and follows the same license terms.