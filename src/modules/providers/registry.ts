import {
  Provider,
  ProviderType,
  ProviderRegistration,
  ProviderSelectionCriteria,
  ProviderCapability,
  ProviderHealth,
  ProviderStatus,
  PROVIDER_DEFAULTS,
  PROVIDER_CAPABILITIES,
  UnifiedProviderError,
  ProviderErrorType
} from './types';

/**
 * Provider Registry
 * Manages provider registration, selection, and health monitoring
 */
export class ProviderRegistry {
  private providers: Map<ProviderType, ProviderRegistration> = new Map();
  private healthCache: Map<ProviderType, ProviderHealth> = new Map();
  private lastHealthCheck: Map<ProviderType, number> = new Map();
  private readonly healthCheckInterval: number = PROVIDER_DEFAULTS.HEALTH_CHECK_INTERVAL;

  /**
   * Register a provider
   */
  register(registration: ProviderRegistration): void {
    this.providers.set(registration.type, registration);

    // Initialize health status
    this.healthCache.set(registration.type, {
      status: ProviderStatus.AVAILABLE,
      lastChecked: Date.now(),
      errorCount: 0,
      consecutiveErrors: 0
    });
  }

  /**
   * Unregister a provider
   */
  unregister(providerType: ProviderType): void {
    this.providers.delete(providerType);
    this.healthCache.delete(providerType);
    this.lastHealthCheck.delete(providerType);
  }

  /**
   * Get a specific provider
   */
  getProvider(providerType: ProviderType): Provider | null {
    const registration = this.providers.get(providerType);
    return registration?.enabled ? registration.provider : null;
  }

  /**
   * Get all registered providers
   */
  getAllProviders(): Map<ProviderType, Provider> {
    const enabledProviders = new Map<ProviderType, Provider>();
    for (const [type, registration] of this.providers.entries()) {
      if (registration.enabled) {
        enabledProviders.set(type, registration.provider);
      }
    }
    return enabledProviders;
  }

  /**
   * Select the best provider based on criteria
   */
  async selectProvider(criteria: ProviderSelectionCriteria = {}): Promise<Provider | null> {
    const candidates = this.getProviderCandidates(criteria);

    if (candidates.length === 0) {
      return null;
    }

    // If preferred provider is specified and available, use it
    if (criteria.preferredProvider) {
      const preferredProvider = candidates.find(p => p.type === criteria.preferredProvider);
      if (preferredProvider) {
        return preferredProvider;
      }
    }

    // Sort candidates by priority and health
    const sortedCandidates = await this.sortCandidatesByHealth(candidates);

    return sortedCandidates.length > 0 ? sortedCandidates[0] : null;
  }

  /**
   * Get provider candidates based on criteria
   */
  private getProviderCandidates(criteria: ProviderSelectionCriteria): Provider[] {
    const candidates: Provider[] = [];

    for (const [type, registration] of this.providers.entries()) {
      if (!registration.enabled) continue;
      if (criteria.excludeProviders?.includes(type)) continue;

      const provider = registration.provider;

      // Check required capabilities
      if (criteria.requiredCapabilities) {
        const hasAllCapabilities = criteria.requiredCapabilities.every(cap =>
          provider.capabilities.includes(cap)
        );
        if (!hasAllCapabilities) continue;
      }

      candidates.push(provider);
    }

    return candidates;
  }

  /**
   * Sort candidates by health and priority
   */
  private async sortCandidatesByHealth(candidates: Provider[]): Promise<Provider[]> {
    const candidatesWithHealth = await Promise.all(
      candidates.map(async (provider) => {
        const health = await this.getProviderHealth(provider.type);
        const registration = this.providers.get(provider.type)!;
        return {
          provider,
          health,
          priority: registration.priority
        };
      })
    );

    // Sort by: health status, priority, response time
    return candidatesWithHealth
      .sort((a, b) => {
        // Prefer available providers
        if (a.health.status === ProviderStatus.AVAILABLE && b.health.status !== ProviderStatus.AVAILABLE) return -1;
        if (b.health.status === ProviderStatus.AVAILABLE && a.health.status !== ProviderStatus.AVAILABLE) return 1;

        // Then by priority (lower number = higher priority)
        if (a.priority !== b.priority) return a.priority - b.priority;

        // Finally by response time (faster is better)
        const aTime = a.health.responseTime || Infinity;
        const bTime = b.health.responseTime || Infinity;
        return aTime - bTime;
      })
      .map(item => item.provider);
  }

  /**
   * Get provider health with caching
   */
  async getProviderHealth(providerType: ProviderType): Promise<ProviderHealth> {
    const cached = this.healthCache.get(providerType);
    const lastCheck = this.lastHealthCheck.get(providerType) || 0;
    const now = Date.now();

    // Return cached health if still valid
    if (cached && (now - lastCheck) < this.healthCheckInterval) {
      return cached;
    }

    // Perform health check
    const provider = this.getProvider(providerType);
    if (!provider) {
      return {
        status: ProviderStatus.UNAVAILABLE,
        lastChecked: now,
        errorCount: 0,
        consecutiveErrors: 0
      };
    }

    try {
      const startTime = Date.now();
      const health = await provider.healthCheck();
      const responseTime = Date.now() - startTime;

      const updatedHealth: ProviderHealth = {
        ...health,
        lastChecked: now,
        responseTime
      };

      this.healthCache.set(providerType, updatedHealth);
      this.lastHealthCheck.set(providerType, now);

      // Reset consecutive errors on success
      if (health.status === ProviderStatus.AVAILABLE) {
        updatedHealth.consecutiveErrors = 0;
      }

      return updatedHealth;
    } catch (error) {
      console.error(`Health check failed for ${providerType}:`, error);

      const errorHealth: ProviderHealth = {
        status: ProviderStatus.ERROR,
        lastChecked: now,
        errorCount: (cached?.errorCount || 0) + 1,
        consecutiveErrors: (cached?.consecutiveErrors || 0) + 1
      };

      this.healthCache.set(providerType, errorHealth);
      this.lastHealthCheck.set(providerType, now);

      return errorHealth;
    }
  }

  /**
   * Get health status for all providers
   */
  async getAllProviderHealth(): Promise<Map<ProviderType, ProviderHealth>> {
    const healthMap = new Map<ProviderType, ProviderHealth>();

    for (const type of this.providers.keys()) {
      const health = await this.getProviderHealth(type);
      healthMap.set(type, health);
    }

    return healthMap;
  }

  /**
   * Check if a provider is healthy
   */
  async isProviderHealthy(providerType: ProviderType): Promise<boolean> {
    const health = await this.getProviderHealth(providerType);
    return health.status === ProviderStatus.AVAILABLE;
  }

  /**
   * Enable a provider
   */
  enableProvider(providerType: ProviderType): void {
    const registration = this.providers.get(providerType);
    if (registration) {
      registration.enabled = true;
    }
  }

  /**
   * Disable a provider
   */
  disableProvider(providerType: ProviderType): void {
    const registration = this.providers.get(providerType);
    if (registration) {
      registration.enabled = false;
    }
  }

  /**
   * Update provider configuration
   */
  updateProviderConfig(providerType: ProviderType, config: Partial<Provider['config']>): void {
    const provider = this.getProvider(providerType);
    if (provider) {
      provider.updateConfig(config);
    }
  }

  /**
   * Get fallback providers for a given provider
   */
  getFallbackProviders(primaryProvider: ProviderType): ProviderType[] {
    const registration = this.providers.get(primaryProvider);
    if (!registration?.fallbackFor) {
      return [];
    }

    return registration.fallbackFor.filter(type => {
      const fallbackRegistration = this.providers.get(type);
      return fallbackRegistration?.enabled;
    });
  }

  /**
   * Validate provider capabilities
   */
  validateCapabilities(providerType: ProviderType, requiredCapabilities: ProviderCapability[]): boolean {
    const provider = this.getProvider(providerType);
    if (!provider) return false;

    return requiredCapabilities.every(cap => provider.capabilities.includes(cap));
  }

  /**
   * Get provider statistics
   */
  async getProviderStats(): Promise<Map<ProviderType, any>> {
    const stats = new Map<ProviderType, any>();

    for (const [type, registration] of this.providers.entries()) {
      if (!registration.enabled) continue;

      const health = await this.getProviderHealth(type);
      const metrics = registration.provider.getMetrics();

      stats.set(type, {
        type,
        priority: registration.priority,
        health,
        metrics,
        capabilities: registration.provider.capabilities
      });
    }

    return stats;
  }

  /**
   * Cleanup and shutdown
   */
  async shutdown(): Promise<void> {
    this.providers.clear();
    this.healthCache.clear();
    this.lastHealthCheck.clear();
  }

  /**
   * Get registry summary
   */
  getSummary(): {
    totalProviders: number;
    enabledProviders: number;
    providerTypes: ProviderType[];
    healthStatus: Map<ProviderType, ProviderStatus>;
  } {
    const enabledProviders = Array.from(this.providers.values()).filter(p => p.enabled);
    const healthStatus = new Map<ProviderType, ProviderStatus>();

    for (const [type] of this.providers.entries()) {
      const health = this.healthCache.get(type);
      healthStatus.set(type, health?.status || ProviderStatus.UNAVAILABLE);
    }

    return {
      totalProviders: this.providers.size,
      enabledProviders: enabledProviders.length,
      providerTypes: Array.from(this.providers.keys()),
      healthStatus
    };
  }
}