import {
  Provider,
  ProviderType,
  ProviderSelectionCriteria,
  ProviderCapability,
  UnifiedRequest,
  UnifiedResponse,
  UnifiedStreamResponse,
  UnifiedProviderError
} from './types';
import { ProviderRegistry } from './registry';
import { FallbackManager } from './fallback-manager';

/**
 * Provider Selection Strategy
 * Handles intelligent provider selection based on various criteria
 */
export class ProviderSelectionStrategy {
  private registry: ProviderRegistry;
  private fallbackManager: FallbackManager;

  constructor(registry: ProviderRegistry, fallbackManager: FallbackManager) {
    this.registry = registry;
    this.fallbackManager = fallbackManager;
  }

  /**
   * Select and execute with the best provider
   */
  async executeWithBestProvider<T>(
    request: UnifiedRequest,
    operation: (provider: Provider) => Promise<T>,
    criteria: ProviderSelectionCriteria = {},
    requestId?: string
  ): Promise<T> {
    // Get candidate providers
    const candidateProviders = await this.getCandidateProviders(request, criteria);

    if (candidateProviders.length === 0) {
      throw new Error('No suitable providers available');
    }

    // Execute with fallback logic
    return this.fallbackManager.executeWithFallback(
      candidateProviders,
      operation,
      requestId
    );
  }

  /**
   * Select and stream with the best provider
   */
  async *streamWithBestProvider(
    request: UnifiedRequest,
    operation: (provider: Provider) => AsyncIterableIterator<UnifiedStreamResponse>,
    criteria: ProviderSelectionCriteria = {},
    requestId?: string
  ): AsyncIterableIterator<UnifiedStreamResponse> {
    // Get candidate providers
    const candidateProviders = await this.getCandidateProviders(request, criteria);

    if (candidateProviders.length === 0) {
      throw new Error('No suitable providers available');
    }

    // Stream with fallback logic
    yield* this.fallbackManager.streamWithFallback(
      candidateProviders,
      operation,
      requestId
    );
  }

  /**
   * Get candidate providers based on request and criteria
   */
  private async getCandidateProviders(
    request: UnifiedRequest,
    criteria: ProviderSelectionCriteria
  ): Promise<Provider[]> {
    const allProviders = this.registry.getAllProviders();

    if (allProviders.size === 0) {
      return [];
    }

    // Start with all available providers
    let candidates = Array.from(allProviders.values());

    // Filter by preferred provider if specified
    if (criteria.preferredProvider) {
      const preferredProvider = candidates.find(p => p.type === criteria.preferredProvider);
      if (preferredProvider) {
        candidates = [preferredProvider];
      }
    }

    // Filter by excluded providers
    if (criteria.excludeProviders && criteria.excludeProviders.length > 0) {
      candidates = candidates.filter(p => !criteria.excludeProviders!.includes(p.type));
    }

    // Filter by required capabilities
    if (criteria.requiredCapabilities && criteria.requiredCapabilities.length > 0) {
      candidates = candidates.filter(provider =>
        this.hasRequiredCapabilities(provider, criteria.requiredCapabilities!)
      );
    }

    // Check if request requires specific capabilities
    const requestCapabilities = this.getRequestCapabilities(request);
    candidates = candidates.filter(provider =>
      this.hasRequiredCapabilities(provider, requestCapabilities)
    );

    // Sort by health and priority
    const sortedCandidates = await this.sortCandidatesByHealth(candidates);

    return sortedCandidates;
  }

  /**
   * Sort candidates by health and priority
   */
  private async sortCandidatesByHealth(candidates: Provider[]): Promise<Provider[]> {
    const candidatesWithHealth = await Promise.all(
      candidates.map(async (provider) => {
        const health = await this.registry.getProviderHealth(provider.type);
        return {
          provider,
          health
        };
      })
    );

    // Sort by: health status, response time, and provider type priority
    return candidatesWithHealth
      .sort((a, b) => {
        // Prefer available providers
        if (a.health.status === 'available' && b.health.status !== 'available') return -1;
        if (b.health.status === 'available' && a.health.status !== 'available') return 1;

        // Then by response time (faster is better)
        const aTime = a.health.responseTime || Infinity;
        const bTime = b.health.responseTime || Infinity;
        if (aTime !== bTime) return aTime - bTime;

        // Finally by provider type (OpenAI preferred over Gemini)
        const typePriority = { [ProviderType.OPENAI]: 1, [ProviderType.GEMINI]: 2 };
        return typePriority[a.provider.type] - typePriority[b.provider.type];
      })
      .map(item => item.provider);
  }

  /**
   * Check if provider has required capabilities
   */
  private hasRequiredCapabilities(
    provider: Provider,
    requiredCapabilities: ProviderCapability[]
  ): boolean {
    return requiredCapabilities.every(cap => provider.capabilities.includes(cap));
  }

  /**
   * Determine capabilities required by the request
   */
  private getRequestCapabilities(request: UnifiedRequest): ProviderCapability[] {
    const capabilities: ProviderCapability[] = [
      ProviderCapability.TEXT_GENERATION
    ];

    // Check if streaming is required
    if (request.stream) {
      capabilities.push(ProviderCapability.STREAMING);
    }

    // Check if tools are used
    if (request.tools && request.tools.length > 0) {
      capabilities.push(ProviderCapability.TOOL_CALLING);
    }

    // Check if multimodal content is present
    const hasMultimodal = request.messages.some(message => {
      if (typeof message.content === 'string') return false;
      return message.content.some(content => content.type === 'image_url');
    });

    if (hasMultimodal) {
      capabilities.push(ProviderCapability.VISION);
    }

    return capabilities;
  }

  /**
   * Get provider recommendations for a request
   */
  async getProviderRecommendations(
    request: UnifiedRequest,
    criteria: ProviderSelectionCriteria = {}
  ): Promise<{
    recommended: Provider | null;
    alternatives: Provider[];
    reasoning: string[];
  }> {
    const candidates = await this.getCandidateProviders(request, criteria);

    if (candidates.length === 0) {
      return {
        recommended: null,
        alternatives: [],
        reasoning: ['No suitable providers available']
      };
    }

    const recommended = candidates[0];
    const alternatives = candidates.slice(1);

    const reasoning = await this.generateReasoning(recommended, request, criteria);

    return {
      recommended,
      alternatives,
      reasoning
    };
  }

  /**
   * Generate reasoning for provider recommendation
   */
  private async generateReasoning(
    provider: Provider,
    request: UnifiedRequest,
    criteria: ProviderSelectionCriteria
  ): Promise<string[]> {
    const reasoning: string[] = [];

    // Health-based reasoning
    const health = await this.registry.getProviderHealth(provider.type);
    if (health.status === 'available') {
      reasoning.push(`${provider.type} is currently healthy and available`);
    }

    if (health.responseTime) {
      reasoning.push(`Fast response time: ${health.responseTime}ms`);
    }

    // Capability-based reasoning
    const requestCapabilities = this.getRequestCapabilities(request);
    const hasAllCapabilities = requestCapabilities.every(cap =>
      provider.capabilities.includes(cap)
    );

    if (hasAllCapabilities) {
      reasoning.push(`Supports all required capabilities: ${requestCapabilities.join(', ')}`);
    }

    // Preference-based reasoning
    if (criteria.preferredProvider === provider.type) {
      reasoning.push(`Matches preferred provider: ${provider.type}`);
    }

    // Model-specific reasoning
    if (request.model) {
      reasoning.push(`Supports requested model: ${request.model}`);
    }

    return reasoning;
  }

  /**
   * Get provider performance comparison
   */
  async getProviderComparison(
    request: UnifiedRequest,
    criteria: ProviderSelectionCriteria = {}
  ): Promise<Map<ProviderType, {
    provider: Provider;
    health: any;
    metrics: any;
    suitable: boolean;
    reasoning: string[];
  }>> {
    const allProviders = this.registry.getAllProviders();
    const comparison = new Map();

    for (const [type, provider] of allProviders) {
      const health = await this.registry.getProviderHealth(type);
      const metrics = provider.getMetrics();

      const requiredCapabilities = this.getRequestCapabilities(request);
      const suitable = this.hasRequiredCapabilities(provider, requiredCapabilities);

      const reasoning: string[] = [];

      if (suitable) {
        reasoning.push('Supports all required capabilities');
      } else {
        reasoning.push('Missing required capabilities');
      }

      if (health.status === 'available') {
        reasoning.push('Currently healthy');
      } else {
        reasoning.push(`Health status: ${health.status}`);
      }

      comparison.set(type, {
        provider,
        health,
        metrics,
        suitable,
        reasoning
      });
    }

    return comparison;
  }

  /**
   * Validate provider suitability for a request
   */
  async validateProviderSuitability(
    provider: Provider,
    request: UnifiedRequest
  ): Promise<{
    suitable: boolean;
    issues: string[];
    warnings: string[];
  }> {
    const issues: string[] = [];
    const warnings: string[] = [];

    // Check health
    const health = await this.registry.getProviderHealth(provider.type);
    if (health.status !== 'available') {
      issues.push(`Provider is not available: ${health.status}`);
    }

    // Check capabilities
    const requiredCapabilities = this.getRequestCapabilities(request);
    for (const capability of requiredCapabilities) {
      if (!provider.capabilities.includes(capability)) {
        issues.push(`Missing required capability: ${capability}`);
      }
    }

    // Check configuration
    try {
      const configValid = await provider.validateConfig();
      if (!configValid) {
        issues.push('Provider configuration is invalid');
      }
    } catch (error) {
      issues.push(`Configuration validation failed: ${error}`);
    }

    // Performance warnings
    if (health.responseTime && health.responseTime > 5000) {
      warnings.push(`Slow response time: ${health.responseTime}ms`);
    }

    return {
      suitable: issues.length === 0,
      issues,
      warnings
    };
  }
}