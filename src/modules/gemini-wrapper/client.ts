import { GeminiConfig, GeminiRequest, GeminiResponse, GeminiStreamResponse, GeminiError } from './types';

export class GeminiClient {
  private config: Required<GeminiConfig>;

  constructor(config: GeminiConfig) {
    this.config = {
      apiKey: config.apiKey,
      model: config.model || 'gemini-pro',
      baseUrl: config.baseUrl || 'https://generativelanguage.googleapis.com',
      timeout: config.timeout || 30000,
      maxRetries: config.maxRetries || 3,
    };
  }

  /**
   * Generate a response from the Gemini API
   */
  async generate(request: GeminiRequest): Promise<GeminiResponse> {
    const url = `${this.config.baseUrl}/v1/models/${this.config.model}:generateContent?key=${this.config.apiKey}`;

    return this.makeRequest<GeminiResponse>(url, request);
  }

  /**
   * Generate a streaming response from the Gemini API
   */
  async *generateStream(request: GeminiRequest): AsyncGenerator<GeminiStreamResponse, void, unknown> {
    const url = `${this.config.baseUrl}/v1/models/${this.config.model}:streamGenerateContent?key=${this.config.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw await this.handleError(response);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Failed to get response reader');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        // Keep the last potentially incomplete line in buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;

          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              yield data;
            } catch (e) {
              // Skip malformed JSON lines
              console.warn('Failed to parse streaming response:', e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Make an HTTP request with retry logic
   */
  private async makeRequest<T>(url: string, body: any, attempt = 1): Promise<T> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        throw await this.handleError(response);
      }

      return await response.json();
    } catch (error) {
      if (attempt < this.config.maxRetries && this.isRetryableError(error)) {
        const delay = this.calculateBackoffDelay(attempt);
        await this.sleep(delay);
        return this.makeRequest<T>(url, body, attempt + 1);
      }
      throw error;
    }
  }

  /**
   * Handle API errors and convert to GeminiError
   */
  private async handleError(response: Response): Promise<GeminiError> {
    let errorData: any;

    try {
      errorData = await response.json();
    } catch {
      errorData = { message: 'Unknown error' };
    }

    const geminiError: GeminiError = {
      code: response.status,
      message: errorData.error?.message || errorData.message || 'Unknown error',
      status: errorData.error?.status || response.statusText,
    };

    return geminiError;
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: any): boolean {
    // Retry on network errors, timeouts, and 5xx server errors
    if (error && typeof error === 'object' && 'code' in error) {
      return (error as GeminiError).code >= 500;
    }

    // Retry on fetch network errors or timeouts
    return error.name === 'TypeError' || error.name === 'AbortError';
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(attempt: number): number {
    const baseDelay = 1000; // 1 second
    const maxDelay = 30000; // 30 seconds
    const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
    return delay + Math.random() * 1000; // Add jitter
  }

  /**
   * Sleep for a given number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<GeminiConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration (without sensitive data)
   */
  getConfig(): Omit<GeminiConfig, 'apiKey'> {
    const { apiKey, ...safeConfig } = this.config;
    return safeConfig;
  }
}