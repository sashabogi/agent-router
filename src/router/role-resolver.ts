/**
 * Role Resolver
 *
 * Maps role names to their configured agent settings by merging
 * role-specific configuration with default values.
 */

import type { AgentConfig, RoleConfig, Config, DefaultConfig } from '../types.js';

/**
 * RoleResolver maps role names to fully resolved AgentConfig objects.
 *
 * It handles:
 * - Looking up role configurations by name
 * - Merging role-specific overrides with defaults
 * - Providing helpful error messages for unknown roles
 * - Hot reload support via updateConfig()
 */
export class RoleResolver {
  private roles: Map<string, RoleConfig>;
  private defaults: DefaultConfig;

  /**
   * Create a new RoleResolver with the given configuration.
   *
   * @param config - The full AgentRouter configuration
   */
  constructor(config: Config) {
    this.roles = new Map(Object.entries(config.roles));
    this.defaults = config.defaults;
  }

  /**
   * Resolve a role name to its full agent configuration.
   *
   * Merges the role's specific settings with default values, where
   * role-specific values take precedence over defaults.
   *
   * @param role - The role name to resolve (e.g., "coder", "critic")
   * @returns The fully resolved AgentConfig
   * @throws Error if the role is not found in configuration
   */
  resolve(role: string): AgentConfig {
    const roleConfig = this.roles.get(role);

    if (!roleConfig) {
      const availableRoles = this.listRoles();
      const roleList = availableRoles.length > 0
        ? availableRoles.join(', ')
        : '(none configured)';
      throw new Error(
        `Unknown role: "${role}". Available roles: ${roleList}`
      );
    }

    // Merge role config with defaults
    // Role-specific values take precedence over defaults
    const agentConfig: AgentConfig = {
      provider: roleConfig.provider,
      model: roleConfig.model,
      temperature: roleConfig.temperature ?? this.defaults.temperature,
      max_tokens: roleConfig.max_tokens ?? this.defaults.max_tokens,
      timeout_ms: roleConfig.timeout_ms ?? this.defaults.timeout_ms,
    };

    // Only add optional properties if they are defined
    // This respects exactOptionalPropertyTypes
    if (roleConfig.system_prompt !== undefined) {
      agentConfig.system_prompt = roleConfig.system_prompt;
    }
    if (roleConfig.fallback !== undefined) {
      agentConfig.fallback = roleConfig.fallback;
    }

    return agentConfig;
  }

  /**
   * Check if a role exists in the configuration.
   *
   * @param role - The role name to check
   * @returns true if the role exists, false otherwise
   */
  hasRole(role: string): boolean {
    return this.roles.has(role);
  }

  /**
   * Get a list of all configured role names.
   *
   * @returns Array of role names
   */
  listRoles(): string[] {
    return Array.from(this.roles.keys());
  }

  /**
   * Update the resolver with a new configuration.
   *
   * Used for hot reload when the config file changes.
   *
   * @param config - The new configuration to use
   */
  updateConfig(config: Config): void {
    this.roles = new Map(Object.entries(config.roles));
    this.defaults = config.defaults;
  }
}
