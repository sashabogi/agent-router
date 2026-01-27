/**
 * Configuration Manager for AgentRouter
 *
 * Handles loading, merging, validating, and watching configuration files.
 * Supports multiple config sources with priority-based merging and
 * environment variable interpolation.
 */

import { EventEmitter } from 'events';
import { watch, type FSWatcher } from 'fs';
import { readFile, access, constants } from 'fs/promises';

import { parse as parseYAML } from 'yaml';

import { ConfigurationError ,type 
  Config,type 
  DefaultConfig,type 
  RoleConfig,type 
  ProviderConfig,
} from '../types.js';

import { DEFAULT_CONFIG, getAllConfigPaths } from './defaults.js';
import { ConfigMerger } from './merger.js';
import { ConfigValidator } from './validator.js';

/**
 * Events emitted by ConfigManager.
 */
export interface ConfigManagerEvents {
  /** Emitted when config is reloaded due to file changes */
  change: [config: Config];
  /** Emitted when a config reload fails */
  error: [error: Error, path: string];
}

/**
 * Options for ConfigManager initialization.
 */
export interface ConfigManagerOptions {
  /** Additional config file path to load (CLI override) */
  configPath?: string;
  /** Whether to watch for config file changes (default: true) */
  watch?: boolean;
  /** Whether to allow missing environment variables (default: false) */
  allowMissingEnv?: boolean;
}

/**
 * Configuration manager with hot reload support.
 * Extends EventEmitter for change notifications.
 */
export class ConfigManager extends EventEmitter<ConfigManagerEvents> {
  private config!: Config;
  private validator: ConfigValidator;
  private merger: ConfigMerger;
  private configPaths: string[];
  private watchers: FSWatcher[] = [];
  private options: Required<ConfigManagerOptions>;
  private loadedPaths = new Set<string>();

  /**
   * Private constructor - use static load() method to create instances.
   */
  private constructor(options: ConfigManagerOptions = {}) {
    super();
    this.validator = new ConfigValidator();
    this.merger = new ConfigMerger();
    this.options = {
      configPath: options.configPath ?? '',
      watch: options.watch ?? true,
      allowMissingEnv: options.allowMissingEnv ?? false,
    };

    // Build config paths list with CLI override at highest priority
    const basePaths = getAllConfigPaths();
    this.configPaths = this.options.configPath
      ? [this.options.configPath, ...basePaths]
      : basePaths;
  }

  /**
   * Load configuration and create a ConfigManager instance.
   * This is the primary way to create a ConfigManager.
   *
   * @param options - Configuration options
   * @returns Promise resolving to initialized ConfigManager
   * @throws ConfigurationError if config loading fails
   */
  static async load(options: ConfigManagerOptions = {}): Promise<ConfigManager> {
    const manager = new ConfigManager(options);
    await manager.loadConfig();

    if (manager.options.watch) {
      manager.watchConfig();
    }

    return manager;
  }

  /**
   * Load and merge configuration from all sources.
   * Config files are loaded in reverse priority order (lowest first)
   * so that higher priority configs override lower ones.
   */
  private async loadConfig(): Promise<void> {
    // Start with default config
    let merged: Config = structuredClone(DEFAULT_CONFIG);
    this.loadedPaths.clear();

    // Load configs in reverse priority order (lowest to highest)
    // System configs first, then user configs, then project configs
    const reversedPaths = [...this.configPaths].reverse();

    for (const configPath of reversedPaths) {
      try {
        // Check if file exists
        await access(configPath, constants.R_OK);

        // Read and parse YAML
        const content = await readFile(configPath, 'utf-8');
        const parsed = parseYAML(content) as unknown;

        if (parsed === null || parsed === undefined) {
          // Empty file, skip
          continue;
        }

        // Validate as partial config (not all fields required)
        this.validator.validatePartialConfig(parsed);

        // Interpolate environment variables
        const interpolated = this.interpolateEnv(parsed) as Partial<Config>;

        // Merge into accumulated config
        merged = this.merger.merge(merged, interpolated);
        this.loadedPaths.add(configPath);
      } catch (error) {
        // ENOENT is expected for non-existent config files
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          continue;
        }

        // For explicitly provided config path, throw error
        if (configPath === this.options.configPath) {
          throw new ConfigurationError(
            `Failed to load config from ${configPath}: ${(error as Error).message}`,
            error as Error
          );
        }

        // For other paths, log warning but continue
        console.warn(
          `Warning: Failed to load config from ${configPath}:`,
          (error as Error).message
        );
      }
    }

    // Final validation of merged config
    this.config = this.validator.validate(merged);
  }

  /**
   * Interpolate environment variables in configuration values.
   * Replaces ${VAR_NAME} patterns with the corresponding env value.
   *
   * @param obj - Object to interpolate
   * @returns Object with interpolated values
   * @throws ConfigurationError if required env var is missing
   */
  private interpolateEnv(obj: unknown): unknown {
    if (typeof obj === 'string') {
      return obj.replace(/\$\{([^}]+)\}/g, (match, envVar: string) => {
        const value = process.env[envVar];

        if (value === undefined) {
          if (this.options.allowMissingEnv) {
            // Keep the placeholder for missing env vars
            return match;
          }
          throw new ConfigurationError(
            `Environment variable ${envVar} is not set`
          );
        }

        return value;
      });
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.interpolateEnv(item));
    }

    if (typeof obj === 'object' && obj !== null) {
      return Object.fromEntries(
        Object.entries(obj).map(([key, value]) => [
          key,
          this.interpolateEnv(value),
        ])
      );
    }

    return obj;
  }

  /**
   * Watch loaded config files for changes.
   * Emits 'change' event when config is successfully reloaded.
   * Emits 'error' event when reload fails.
   */
  private watchConfig(): void {
    // Watch all paths that were successfully loaded
    for (const configPath of this.loadedPaths) {
      try {
        const watcher = watch(configPath, async (eventType) => {
          if (eventType === 'change') {
            console.log(`Config file changed: ${configPath}`);

            try {
              await this.loadConfig();
              this.emit('change', this.config);
            } catch (error) {
              console.error('Failed to reload config:', (error as Error).message);
              this.emit('error', error as Error, configPath);
            }
          }
        });

        this.watchers.push(watcher);
      } catch {
        // File might not exist or be watchable, that's okay
      }
    }

    // Also watch paths that didn't exist - they might be created
    for (const configPath of this.configPaths) {
      if (this.loadedPaths.has(configPath)) {
        continue; // Already watching
      }

      try {
        const watcher = watch(configPath, async (eventType) => {
          if (eventType === 'rename' || eventType === 'change') {
            console.log(`Config file created: ${configPath}`);

            try {
              await this.loadConfig();
              this.emit('change', this.config);
              // Restart watchers to include new file
              this.stopWatching();
              this.watchConfig();
            } catch (error) {
              console.error('Failed to reload config:', (error as Error).message);
              this.emit('error', error as Error, configPath);
            }
          }
        });

        this.watchers.push(watcher);
      } catch {
        // File or directory doesn't exist, that's okay
      }
    }
  }

  /**
   * Stop watching config files.
   */
  private stopWatching(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
  }

  /**
   * Manually reload configuration.
   * Useful when programmatically updating config files.
   *
   * @returns Promise resolving when reload is complete
   * @throws ConfigurationError if reload fails
   */
  async reload(): Promise<void> {
    await this.loadConfig();
    this.emit('change', this.config);
  }

  /**
   * Close the ConfigManager and stop watching files.
   * Should be called when shutting down.
   */
  close(): void {
    this.stopWatching();
    this.removeAllListeners();
  }

  /**
   * Get the full configuration object.
   *
   * @returns Complete configuration
   */
  get(): Config {
    return this.config;
  }

  /**
   * Get the version string from config.
   *
   * @returns Config version
   */
  getVersion(): string {
    return this.config.version;
  }

  /**
   * Get all role configurations.
   *
   * @returns Map of role names to role configs
   */
  getRoles(): Record<string, RoleConfig> {
    return this.config.roles;
  }

  /**
   * Get a specific role configuration.
   *
   * @param roleName - Name of the role
   * @returns Role configuration or undefined if not found
   */
  getRole(roleName: string): RoleConfig | undefined {
    return this.config.roles[roleName];
  }

  /**
   * Get all provider configurations.
   *
   * @returns Map of provider names to provider configs
   */
  getProviders(): Record<string, ProviderConfig> {
    return this.config.providers;
  }

  /**
   * Get a specific provider configuration.
   *
   * @param providerName - Name of the provider
   * @returns Provider configuration or undefined if not found
   */
  getProvider(providerName: string): ProviderConfig | undefined {
    return this.config.providers[providerName];
  }

  /**
   * Get default configuration values.
   *
   * @returns Default config values
   */
  getDefaults(): DefaultConfig {
    return this.config.defaults;
  }

  /**
   * Get list of available role names.
   *
   * @returns Array of role names
   */
  getRoleNames(): string[] {
    return Object.keys(this.config.roles);
  }

  /**
   * Get list of available provider names.
   *
   * @returns Array of provider names
   */
  getProviderNames(): string[] {
    return Object.keys(this.config.providers);
  }

  /**
   * Check if a role exists.
   *
   * @param roleName - Name of the role to check
   * @returns True if role exists
   */
  hasRole(roleName: string): boolean {
    return roleName in this.config.roles;
  }

  /**
   * Check if a provider exists.
   *
   * @param providerName - Name of the provider to check
   * @returns True if provider exists
   */
  hasProvider(providerName: string): boolean {
    return providerName in this.config.providers;
  }

  /**
   * Get the paths of all loaded config files.
   *
   * @returns Array of loaded config file paths
   */
  getLoadedPaths(): string[] {
    return [...this.loadedPaths];
  }

  /**
   * Get all config search paths (including unloaded).
   *
   * @returns Array of all config paths that are searched
   */
  getSearchPaths(): string[] {
    return [...this.configPaths];
  }
}

/**
 * Convenience function to load configuration.
 * Creates a ConfigManager and returns the config object.
 *
 * @param options - Configuration options
 * @returns Promise resolving to the loaded Config
 */
export async function loadConfig(options: ConfigManagerOptions = {}): Promise<Config> {
  const manager = await ConfigManager.load({ ...options, watch: false });
  return manager.get();
}
