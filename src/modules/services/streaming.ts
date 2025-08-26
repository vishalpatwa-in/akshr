import { Run } from '../models/run';
import { RunExecutionEvent } from './run-execution-engine';
import { ServiceConfig, ServiceResult } from './types';

/**
 * Streaming formats supported
 */
export type StreamingFormat = 'sse' | 'ndjson' | 'jsonl';

/**
 * Streaming options
 */
export interface StreamingOptions {
  format: StreamingFormat;
  includeData?: boolean;
  heartbeatInterval?: number;
  maxDuration?: number;
}

/**
 * Streaming event types
 */
export interface StreamingEvent {
  event: string;
  data: any;
  id?: string;
  retry?: number;
}

/**
 * RunStreamingService handles real-time streaming of run execution events
 */
export class RunStreamingService {
  private readonly config: ServiceConfig;
  private activeStreams = new Map<string, AbortController>();
  private heartbeatIntervals = new Map<string, number>();

  constructor(config: ServiceConfig) {
    this.config = config;
  }

  /**
   * Create a streaming response for run execution
   */
  async createStreamingResponse(
    runId: string,
    executionGenerator: AsyncGenerator<RunExecutionEvent, void, unknown>,
    options: StreamingOptions = { format: 'sse' }
  ): Promise<Response> {
    const streamId = `stream_${runId}_${Date.now()}`;
    const abortController = new AbortController();
    this.activeStreams.set(streamId, abortController);

    // Create a TransformStream to handle the streaming
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Start the streaming process
    this.startStreaming(
      streamId,
      executionGenerator,
      writer,
      encoder,
      options,
      abortController.signal
    );

    // Set up heartbeat if requested
    if (options.heartbeatInterval && options.heartbeatInterval > 0) {
      this.setupHeartbeat(streamId, writer, encoder, options.heartbeatInterval);
    }

    // Set up max duration timeout if specified
    if (options.maxDuration && options.maxDuration > 0) {
      setTimeout(() => {
        this.endStream(streamId, writer, 'Stream timeout');
      }, options.maxDuration);
    }

    // Create appropriate response headers based on format
    const headers = this.createResponseHeaders(options.format);

    return new Response(readable, {
      headers,
      status: 200
    });
  }

  /**
   * Start the streaming process
   */
  private async startStreaming(
    streamId: string,
    executionGenerator: AsyncGenerator<RunExecutionEvent, void, unknown>,
    writer: WritableStreamDefaultWriter,
    encoder: TextEncoder,
    options: StreamingOptions,
    abortSignal: AbortSignal
  ): Promise<void> {
    try {
      // Send initial connection event
      await this.sendEvent(writer, encoder, {
        event: 'stream.connected',
        data: { streamId, format: options.format }
      }, options.format);

      // Process execution events
      for await (const executionEvent of executionGenerator) {
        if (abortSignal.aborted) {
          break;
        }

        const streamingEvent = this.convertExecutionEvent(executionEvent);
        await this.sendEvent(writer, encoder, streamingEvent, options.format);

        // If run is completed or failed, end the stream
        if (executionEvent.type === 'run.completed' || executionEvent.type === 'run.failed') {
          break;
        }
      }

      // Send stream completion event
      await this.sendEvent(writer, encoder, {
        event: 'stream.completed',
        data: { streamId }
      }, options.format);

    } catch (error) {
      console.error('Error in streaming:', error);
      await this.sendEvent(writer, encoder, {
        event: 'stream.error',
        data: {
          streamId,
          error: error instanceof Error ? error.message : 'Unknown streaming error'
        }
      }, options.format);
    } finally {
      this.endStream(streamId, writer);
    }
  }

  /**
   * Send an event through the stream
   */
  private async sendEvent(
    writer: WritableStreamDefaultWriter,
    encoder: TextEncoder,
    event: StreamingEvent,
    format: StreamingFormat
  ): Promise<void> {
    try {
      let message: string;

      switch (format) {
        case 'sse':
          message = this.formatSSE(event);
          break;
        case 'ndjson':
        case 'jsonl':
          message = this.formatJSON(event);
          break;
        default:
          message = this.formatSSE(event);
      }

      await writer.write(encoder.encode(message));
    } catch (error) {
      console.error('Error sending event:', error);
    }
  }

  /**
   * Format event as SSE (Server-Sent Events)
   */
  private formatSSE(event: StreamingEvent): string {
    let sseMessage = `event: ${event.event}\n`;

    if (event.id) {
      sseMessage += `id: ${event.id}\n`;
    }

    if (event.retry) {
      sseMessage += `retry: ${event.retry}\n`;
    }

    sseMessage += `data: ${JSON.stringify(event.data)}\n\n`;
    return sseMessage;
  }

  /**
   * Format event as JSON (for NDJSON/JSONL)
   */
  private formatJSON(event: StreamingEvent): string {
    return JSON.stringify({
      event: event.event,
      data: event.data,
      id: event.id,
      timestamp: Date.now()
    }) + '\n';
  }

  /**
   * Convert execution event to streaming event
   */
  private convertExecutionEvent(executionEvent: RunExecutionEvent): StreamingEvent {
    return {
      event: executionEvent.type,
      data: executionEvent.data,
      id: `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
  }

  /**
   * Create response headers based on streaming format
   */
  private createResponseHeaders(format: StreamingFormat): HeadersInit {
    const baseHeaders = {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    };

    switch (format) {
      case 'sse':
        return {
          ...baseHeaders,
          'Content-Type': 'text/event-stream',
        };
      case 'ndjson':
      case 'jsonl':
        return {
          ...baseHeaders,
          'Content-Type': 'application/x-ndjson',
        };
      default:
        return baseHeaders;
    }
  }

  /**
   * Set up heartbeat for the stream
   */
  private setupHeartbeat(
    streamId: string,
    writer: WritableStreamDefaultWriter,
    encoder: TextEncoder,
    interval: number
  ): void {
    const heartbeatInterval = setInterval(async () => {
      try {
        await this.sendEvent(writer, encoder, {
          event: 'stream.heartbeat',
          data: { timestamp: Date.now() }
        }, 'sse'); // Heartbeat always uses SSE format
      } catch (error) {
        console.error('Error sending heartbeat:', error);
        this.endStream(streamId, writer);
      }
    }, interval);

    this.heartbeatIntervals.set(streamId, heartbeatInterval);
  }

  /**
   * End a stream and clean up resources
   */
  private async endStream(
    streamId: string,
    writer: WritableStreamDefaultWriter,
    reason?: string
  ): Promise<void> {
    try {
      // Clear heartbeat interval
      const heartbeatInterval = this.heartbeatIntervals.get(streamId);
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        this.heartbeatIntervals.delete(streamId);
      }

      // Abort the stream
      const abortController = this.activeStreams.get(streamId);
      if (abortController) {
        abortController.abort();
        this.activeStreams.delete(streamId);
      }

      // Close the writer
      await writer.close();
    } catch (error) {
      console.error('Error ending stream:', error);
    }
  }

  /**
   * Cancel a specific stream
   */
  cancelStream(runId: string): void {
    // Find and cancel streams for this run
    for (const [streamId, abortController] of this.activeStreams.entries()) {
      if (streamId.includes(runId)) {
        abortController.abort();
        this.activeStreams.delete(streamId);

        // Clear heartbeat
        const heartbeatInterval = this.heartbeatIntervals.get(streamId);
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          this.heartbeatIntervals.delete(streamId);
        }
      }
    }
  }

  /**
   * Get active stream count
   */
  getActiveStreamCount(): number {
    return this.activeStreams.size;
  }

  /**
   * Clean up all active streams
   */
  cleanup(): void {
    for (const [streamId, abortController] of this.activeStreams.entries()) {
      abortController.abort();

      const heartbeatInterval = this.heartbeatIntervals.get(streamId);
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
    }

    this.activeStreams.clear();
    this.heartbeatIntervals.clear();
  }

  /**
   * Health check for the streaming service
   */
  healthCheck(): { healthy: boolean; activeStreams: number; error?: string } {
    try {
      return {
        healthy: true,
        activeStreams: this.activeStreams.size
      };
    } catch (error) {
      return {
        healthy: false,
        activeStreams: 0,
        error: error instanceof Error ? error.message : 'Health check failed'
      };
    }
  }
}

/**
 * Utility function to create a streaming response
 */
export function createStreamingResponse(
  config: ServiceConfig,
  runId: string,
  executionGenerator: AsyncGenerator<RunExecutionEvent, void, unknown>,
  options?: StreamingOptions
): Promise<Response> {
  const streamingService = new RunStreamingService(config);
  return streamingService.createStreamingResponse(runId, executionGenerator, options);
}

/**
 * Stream event types for type safety
 */
export const StreamEventTypes = {
  STREAM_CONNECTED: 'stream.connected',
  STREAM_COMPLETED: 'stream.completed',
  STREAM_ERROR: 'stream.error',
  STREAM_HEARTBEAT: 'stream.heartbeat',
  RUN_CREATED: 'run.created',
  RUN_IN_PROGRESS: 'run.in_progress',
  RUN_REQUIRES_TOOL_ACTIONS: 'run.requires_tool_actions',
  RUN_COMPLETED: 'run.completed',
  RUN_FAILED: 'run.failed'
} as const;