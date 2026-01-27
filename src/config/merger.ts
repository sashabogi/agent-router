/**
 * Configuration Merger for AgentRouter
 *
 * Provides utilities for deep merging configuration objects.
 * Used by ConfigManager to combine configs from multiple sources.
 */

import type { Config, RoleConfig, ProviderConfig, DefaultConfig } from '../types.js';

/**
 * Configuration merger utility class.
 * Handles deep merging of configuration objects with specific merge rules.
 */
export class ConfigMerger {
  /**
   * Deep merge two configuration objects.
   * Source values override target values.
   * Objects are merged recursively, arrays are replaced.
   *
   * @param target - Base configuration
   * @param source - Configuration to merge on top
   * @returns Merged configuration
   */
  merge(target: Config, source: Partial<Config>): Config {
    return {
      version: source.version ?? target.version,
      defaults: this.mergeDefaults(target.defaults, source.defaults),
      roles: this.mergeRoles(target.roles, source.roles),
      providers: this.mergeProviders(target.providers, source.providers),
    };
  }

  /**
   * Merge default configuration values.
   *
   * @param target - Base defaults
   * @param source - Defaults to merge
   * @returns Merged defaults
   */
  private mergeDefaults(
    target: DefaultConfig,
    source?: Partial<DefaultConfig>
  ): DefaultConfig {
    if (!source) {return { ...target };}

    return {
      temperature: source.temperature ?? target.temperature,
      max_tokens: source.max_tokens ?? target.max_tokens,
      timeout_ms: source.timeout_ms ?? target.timeout_ms,
    };
  }

  /**
   * Merge role configurations.
   * Roles from source are merged into target.
   * Individual role properties are deep merged.
   *
   * @param target - Base roles
   * @param source - Roles to merge
   * @returns Merged roles
   */
  private mergeRoles(
    target: Record<string, RoleConfig>,
    source?: Record<string, RoleConfig>
  ): Record<string, RoleConfig> {
    if (!source) {return { ...target };}

    const result: Record<string, RoleConfig> = { ...target };

    for (const [roleName, roleConfig] of Object.entries(source)) {
      const existingRole = result[roleName];
      if (existingRole) {
        // Merge existing role
        result[roleName] = this.mergeRoleConfig(existingRole, roleConfig);
      } else {
        // Add new role
        result[roleName] = { ...roleConfig };
      }
    }

    return result;
  }

  /**
   * Merge a single role configuration.
   *
   * @param target - Base role config
   * @param source - Role config to merge
   * @returns Merged role config
   */
  private mergeRoleConfig(target: RoleConfig, source: Partial<RoleConfig>): RoleConfig {
    const result: RoleConfig = {
      provider: source.provider ?? target.provider,
      model: source.model ?? target.model,
    };

    // Optional fields - only set if defined in either source or target
    const systemPrompt = source.system_prompt ?? target.system_prompt;
    if (systemPrompt !== undefined) {
      result.system_prompt = systemPrompt;
    }

    const temperature = source.temperature ?? target.temperature;
    if (temperature !== undefined) {
      result.temperature = temperature;
    }

    const maxTokens = source.max_tokens ?? target.max_tokens;
    if (maxTokens !== undefined) {
      result.max_tokens = maxTokens;
    }

    const timeoutMs = source.timeout_ms ?? target.timeout_ms;
    if (timeoutMs !== undefined) {
      result.timeout_ms = timeoutMs;
    }

    // Fallback config - replace entirely if provided
    if (source.fallback !== undefined) {
      result.fallback = { ...source.fallback };
    } else if (target.fallback !== undefined) {
      result.fallback = { ...target.fallback };
    }

    return result;
  }

  /**
   * Merge provider configurations.
   * Providers from source are merged into target.
   * Individual provider properties are deep merged.
   *
   * @param target - Base providers
   * @param source - Providers to merge
   * @returns Merged providers
   */
  private mergeProviders(
    target: Record<string, ProviderConfig>,
    source?: Record<string, ProviderConfig>
  ): Record<string, ProviderConfig> {
    if (!source) {return { ...target };}

    const result: Record<string, ProviderConfig> = { ...target };

    for (const [providerName, providerConfig] of Object.entries(source)) {
      const existingProvider = result[providerName];
      if (existingProvider) {
        // Merge existing provider
        result[providerName] = this.mergeProviderConfig(existingProvider, providerConfig);
      } else {
        // Add new provider
        result[providerName] = { ...providerConfig };
      }
    }

    return result;
  }

  /**
   * Merge a single provider configuration.
   *
   * @param target - Base provider config
   * @param source - Provider config to merge
   * @returns Merged provider config
   */
  private mergeProviderConfig(
    target: ProviderConfig,
    source: Partial<ProviderConfig>
  ): ProviderConfig {
    const result: ProviderConfig = {};

    // Merge all optional fields - only set if defined
    const apiKey = source.api_key ?? target.api_key;
    if (apiKey !== undefined) {
      result.api_key = apiKey;
    }

    const baseUrl = source.base_url ?? target.base_url;
    if (baseUrl !== undefined) {
      result.base_url = baseUrl;
    }

    const organization = source.organization ?? target.organization;
    if (organization !== undefined) {
      result.organization = organization;
    }

    const project = source.project ?? target.project;
    if (project !== undefined) {
      result.project = project;
    }

    const location = source.location ?? target.location;
    if (location !== undefined) {
      result.location = location;
    }

    // Headers are merged (source overrides target keys)
    if (source.headers || target.headers) {
      result.headers = {
        ...target.headers,
        ...source.headers,
      };
    }

    return result;
  }
}

/**
 * Convenience function to merge two configs.
 *
 * @param target - Base configuration
 * @param source - Configuration to merge on top
 * @returns Merged configuration
 */
export function mergeConfigs(target: Config, source: Partial<Config>): Config {
  const merger = new ConfigMerger();
  return merger.merge(target, source);
}
