# Gemini Wrapper

A comprehensive wrapper for Google's Gemini API integration with the OpenAI-compatible assistant platform. This module provides seamless integration with the existing Cloudflare Workers-based assistant system.

## Features

- **Full Gemini API Integration**: Complete client for Gemini Pro models with authentication and error handling
- **Prompt Construction**: Automatic conversion from OpenAI-style messages to Gemini format
- **Tool Schema Conversion**: Seamless conversion from OpenAI function schemas to Gemini function declarations
- **Inference Functions**: High-level functions for text generation, tool calling, and streaming
- **Output Normalization**: Consistent response format across different Gemini outputs
- **Error Handling**: Comprehensive error handling with retry logic
- **R2 Integration**: Built-in integration with Cloudflare R2 for conversation persistence

## Quick Start

```typescript
import { createGeminiInference } from './gemini-wrapper';
import { Assistant, Message } from '../models';

// Create inference instance
const inference = createGeminiInference(process.env.GEMINI_API_KEY!);

// Generate a response
const response = await inference.generateAssistantResponse(assistant, messages);

// Generate with tools
const responseWithTools = await inference.generateWithTools(messages, tools);
```

## API Reference

### Core Classes

#### `GeminiInference`

Main class for Gemini API interactions.

```typescript
const inference = new GeminiInference(apiKey, model?);
```

**Methods:**

- `generateResponse(messages, config?)`: Generate text response from message history
- `generateWithTools(messages, tools, config?)`: Generate response with tool calling support
- `generateAssistantResponse(assistant, messages, config?)`: Generate response for complete assistant setup
- `streamResponse(messages, tools?, config?)`: Stream response generation
- `continueWithToolResults(messages, toolCalls, toolResults, config?)`: Continue conversation with tool results
- `healthCheck()`: Check API connectivity

#### `GeminiClient`

Low-level API client for direct Gemini API access.

```typescript
const client = new GeminiClient({ apiKey, model, timeout });
```

**Methods:**

- `generate(request)`: Make generateContent API call
- `generateStream(request)`: Make streaming generateContent API call

### Utility Classes

#### `GeminiPromptBuilder`

Handles conversion from OpenAI-style messages to Gemini format.

```typescript
// Build messages from assistant and thread messages
const geminiMessages = GeminiPromptBuilder.buildMessages(assistant, messages);

// Create individual messages
const userMessage = GeminiPromptBuilder.createUserMessage('Hello');
const modelMessage = GeminiPromptBuilder.createModelMessage('Hi there!');
```

#### `GeminiToolConverter`

Converts OpenAI tool schemas to Gemini format.

```typescript
// Convert tools
const geminiTools = GeminiToolConverter.convertTools(openaiTools);

// Validate compatibility
const validation = GeminiToolConverter.validateToolSchema(toolSchema);
```

#### `GeminiOutputNormalizer`

Normalizes Gemini responses to consistent format.

```typescript
// Normalize response
const normalized = GeminiOutputNormalizer.normalizeResponse(geminiResponse);

// Check for tool calls
if (GeminiOutputNormalizer.hasToolCalls(normalized)) {
  const toolCalls = GeminiOutputNormalizer.extractToolCalls(normalized);
}
```

## Integration Examples

### Basic Response Generation

```typescript
import { createGeminiInference } from './gemini-wrapper';

export async function handleRun(request, env) {
  const inference = createGeminiInference(env.GEMINI_API_KEY);

  // Load assistant and messages from R2
  const storage = createR2Storage(env.ASSISTANT_R2);
  const assistant = await storage.assistants.get(assistantId);
  const messages = await loadMessagesFromThread(storage, threadId);

  // Generate response
  const response = await inference.generateAssistantResponse(assistant, messages);

  // Store response message
  const responseMessage = createResponseMessage(response);
  await storage.messages.put(threadId, responseMessage);

  return response;
}
```

### Tool Calling Flow

```typescript
export async function handleToolCall(request, env) {
  const inference = createGeminiInference(env.GEMINI_API_KEY);

  // Load current conversation
  const storage = createR2Storage(env.ASSISTANT_R2);
  const messages = await loadMessagesFromThread(storage, threadId);

  // Execute tools
  const toolResults = await executeToolCalls(toolCalls);

  // Continue conversation with results
  const response = await inference.continueWithToolResults(
    messages,
    toolCalls,
    toolResults
  );

  return response;
}
```

### Streaming Response

```typescript
export async function handleStreamingRun(request, env) {
  const inference = createGeminiInference(env.GEMINI_API_KEY);

  // Load conversation
  const messages = await loadMessagesFromThread(storage, threadId);

  // Stream response
  const stream = inference.streamResponse(messages, assistant.tools);

  for await (const chunk of stream) {
    if (chunk.toolCalls) {
      // Handle tool calls
      await handleToolCalls(chunk.toolCalls);
    } else if (chunk.text) {
      // Send text chunk to client
      await sendToClient(chunk.text);
    }
  }
}
```

## Configuration

### Environment Variables

```bash
GEMINI_API_KEY=your_api_key_here
ASSISTANT_R2=your_r2_bucket
```

### Configuration Options

```typescript
interface InferenceConfig {
  temperature?: number;    // 0.0 - 2.0
  maxTokens?: number;      // Maximum output tokens
  topK?: number;          // Top-k sampling
  topP?: number;          // Nucleus sampling
}

const config: InferenceConfig = {
  temperature: 0.7,
  maxTokens: 4096,
  topK: 40,
  topP: 0.95
};
```

## Error Handling

The wrapper includes comprehensive error handling:

```typescript
try {
  const response = await inference.generateAssistantResponse(assistant, messages);
} catch (error) {
  if (error instanceof GeminiWrapperError) {
    console.error(`Gemini API Error: ${error.message}`, error.code);
  } else {
    console.error('Unexpected error:', error);
  }
}
```

## Supported Models

- `gemini-pro` (default)
- `gemini-pro-vision` (for image inputs)
- `gemini-ultra` (high-performance model)

## Tool Schema Compatibility

### Supported OpenAI Features

- ✅ Function names and descriptions
- ✅ Parameter schemas (string, number, boolean, array, object)
- ✅ Required parameters
- ✅ Enum values
- ✅ Nested object structures

### Limitations

- ⚠️ Maximum 64 characters for function names
- ⚠️ Maximum 512 characters for descriptions
- ⚠️ Maximum 5 levels of nested parameters

## Best Practices

1. **Validate Tools**: Always validate tool schemas before use
2. **Handle Errors**: Implement proper error handling and retries
3. **Monitor Usage**: Track API usage and costs
4. **Cache Results**: Use R2 for conversation persistence
5. **Stream for UX**: Use streaming for better user experience

## Migration from OpenAI

To migrate from OpenAI to Gemini:

1. Update model names in assistant configurations
2. Replace OpenAI client calls with Gemini wrapper
3. Update tool schemas if needed
4. Test tool calling flows
5. Update error handling for Gemini-specific errors

## Performance Considerations

- Use streaming for real-time responses
- Cache conversation history in R2
- Implement rate limiting for API calls
- Use appropriate TTL settings for cached data
- Monitor API latency and error rates