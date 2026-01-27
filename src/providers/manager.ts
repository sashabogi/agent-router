/**
 * Provider Manager
 *
 * Manages the registry of LLM providers, handling provider creation,
 * retrieval, and configuration updates. Provides a factory method for
 * creating provider instances based on their type.
 */

import { ConfigurationError ,type  Provider,type  ProviderConfig,type  ProviderType } from '../types.js';

/**
 * Factory function type for creating provider instances.
 */
export type ProviderFactory = (config: ProviderConfig) => Provider;

/**
 * Provider registration info including factory and current instance.
 */
interface ProviderRegistration {
  /** Factory function for creating the provider */
  factory: ProviderFactory;
  /** Current provider instance (if created) */
  instance?: Provider;
  /** Current configuration */
  config?: ProviderConfig;
}

/**
 * Manager for LLM provider instances.
 *
 * Handles:
 * - Provider registration and retrieval
 * - Provider instance creation via factory methods
 * - Configuration updates with instance recreation
 * - Lazy instantiation of providers
 *
 * @example
 * ```ts
 * const manager = new ProviderManager();
 *
 * // Register provider factories
 * manager.registerFactory('anthropic', (config) => new AnthropicProvider(config));
 * manager.registerFactory('openai', (config) => new OpenAIProvider(config));
 *
 * // Update configurations (creates instances lazily)
 * manager.updateConfig({
 *   anthropic: { api_key: 'sk-...' },
 *   openai: { api_key: 'sk-...' }
 * });
 *
 * // Get a provider instance
 * const provider = manager.get('anthropic');
 * ```
 */
export class ProviderManager {
  /** Registry of provider factories and instances by name */
  private readonly providers = new Map<string, ProviderRegistration>();

  /** Registry of active provider instances */
  private readonly instances = new Map<string, Provider>();

  /**
   * Register a provider factory for a given provider type.
   * The factory will be used to create provider instances when needed.
   *
   * @param name - Provider name (e.g., 'anthropic', 'openai')
   * @param factory - Factory function that creates provider instances
   */
  public registerFactory(name: string, factory: ProviderFactory): void {
    const existing = this.providers.get(name);

    if (existing) {
      // Update the factory but preserve existing config
      existing.factory = factory;
      // Clear instance so it will be recreated with new factory
      delete existing.instance;
      this.instances.delete(name);
    } else {
      this.providers.set(name, { factory });
    }
  }

  /**
   * Register a pre-created provider instance directly.
   * Useful for testing or custom provider implementations.
   *
   * @param name - Provider name
   * @param provider - Provider instance
   */
  public register(name: string, provider: Provider): void {
    this.instances.set(name, provider);

    // Also store in providers map with a dummy factory
    this.providers.set(name, {
      factory: () => provider,
      instance: provider,
    });
  }

  /**
   * Get a provider instance by name.
   * Creates the instance lazily if it hasn't been created yet.
   *
   * @param name - Provider name
   * @returns The provider instance
   * @throws ConfigurationError if the provider is not registered or not configured
   */
  public get(name: string): Provider {
    // Check for directly registered instance first
    const directInstance = this.instances.get(name);
    if (directInstance) {
      return directInstance;
    }

    // Check for factory-based registration
    const registration = this.providers.get(name);
    if (!registration) {
      throw new ConfigurationError(
        `Provider '${name}' is not registered. Available providers: ${this.listProviders().join(', ') || 'none'}`
      );
    }

    // Return existing instance if available
    if (registration.instance) {
      return registration.instance;
    }

    // Check if we have configuration
    if (!registration.config) {
      throw new ConfigurationError(
        `Provider '${name}' is registered but not configured. Call updateConfig() first.`
      );
    }

    // Create new instance
    registration.instance = registration.factory(registration.config);
    this.instances.set(name, registration.instance);

    return registration.instance;
  }

  /**
   * Check if a provider is registered (has a factory).
   *
   * @param name - Provider name
   * @returns True if the provider is registered
   */
  public has(name: string): boolean {
    return this.providers.has(name) || this.instances.has(name);
  }

  /**
   * Check if a provider is configured and ready to use.
   *
   * @param name - Provider name
   * @returns True if the provider is configured
   */
  public isConfigured(name: string): boolean {
    const registration = this.providers.get(name);
    return !!registration?.config || this.instances.has(name);
  }

  /**
   * Update provider configurations.
   * This will invalidate existing instances so they are recreated with new configs.
   *
   * @param configs - Map of provider name to configuration
   */
  public updateConfig(configs: Record<string, ProviderConfig>): void {
    for (const [name, config] of Object.entries(configs)) {
      const registration = this.providers.get(name);

      if (registration) {
        // Update config and clear instance to force recreation
        registration.config = config;
        delete registration.instance;
        this.instances.delete(name);
      } else {
        // Store config even if no factory registered yet
        // This allows config to be loaded before factories are registered
        this.providers.set(name, {
          factory: () => {
            throw new ConfigurationError(
              `No factory registered for provider '${name}'`
            );
          },
          config,
        });
      }
    }
  }

  /**
   * Get the configuration for a provider.
   *
   * @param name - Provider name
   * @returns The provider configuration, or undefined if not configured
   */
  public getConfig(name: string): ProviderConfig | undefined {
    return this.providers.get(name)?.config;
  }

  /**
   * List all registered provider names.
   *
   * @returns Array of provider names
   */
  public listProviders(): string[] {
    const names = new Set<string>();
    this.providers.forEach((_, name) => names.add(name));
    this.instances.forEach((_, name) => names.add(name));
    return Array.from(names);
  }

  /**
   * List all configured provider names (ready to use).
   *
   * @returns Array of configured provider names
   */
  public listConfigured(): string[] {
    return this.listProviders().filter((name) => this.isConfigured(name));
  }

  /**
   * Remove a provider from the registry.
   *
   * @param name - Provider name to remove
   */
  public remove(name: string): void {
    this.providers.delete(name);
    this.instances.delete(name);
  }

  /**
   * Clear all providers from the registry.
   */
  public clear(): void {
    this.providers.clear();
    this.instances.clear();
  }

  /**
   * Run health checks on all configured providers.
   *
   * @returns Map of provider name to health check result (true = healthy, Error = failed)
   */
  public async healthCheckAll(): Promise<Map<string, true | Error>> {
    const results = new Map<string, true | Error>();
    const configured = this.listConfigured();

    await Promise.all(
      configured.map(async (name) => {
        try {
          const provider = this.get(name);
          await provider.healthCheck();
          results.set(name, true);
        } catch (error) {
          results.set(name, error instanceof Error ? error : new Error(String(error)));
        }
      })
    );

    return results;
  }
}

/**
 * Create a provider instance based on provider type.
 * This is a factory function that maps provider types to their implementations.
 *
 * Note: This function requires the provider implementations to be imported
 * and registered. Use ProviderManager.registerFactory() to register providers.
 *
 * @param type - Provider type
 * @param config - Provider configuration
 * @param manager - Provider manager with registered factories
 * @returns Provider instance
 * @throws ConfigurationError if the provider type is not supported
 */
export function createProvider(
  type: ProviderType,
  config: ProviderConfig,
  manager: ProviderManager
): Provider {
  // Update config and get instance from manager
  manager.updateConfig({ [type]: config });
  return manager.get(type);
}

/**
 * Create a ProviderManager with default provider factories registered.
 * Provider implementations must be passed in to avoid circular dependencies.
 *
 * @param factories - Map of provider type to factory function
 * @returns Configured ProviderManager
 *
 * @example
 * ```ts
 * import { AnthropicProvider } from './anthropic.js';
 * import { OpenAIProvider } from './openai.js';
 *
 * const manager = createProviderManager({
 *   anthropic: (config) => new AnthropicProvider(config),
 *   openai: (config) => new OpenAIProvider(config),
 * });
 * ```
 */
export function createProviderManager(
  factories: Partial<Record<ProviderType, ProviderFactory>>
): ProviderManager {
  const manager = new ProviderManager();

  for (const [type, factory] of Object.entries(factories)) {
    if (factory) {
      manager.registerFactory(type, factory);
    }
  }

  return manager;
}
