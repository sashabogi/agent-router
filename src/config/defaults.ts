/**
 * Default Configuration for AgentRouter
 *
 * AgentRouter provides EXTERNAL LLM providers for second opinions in Claude Code.
 * Since Claude Code already IS Anthropic, the defaults here configure available providers.
 * 
 * Note: Roles are NOT pre-configured - users choose which roles they want during setup.
 */

import { homedir, platform } from 'os';
import { join } from 'path';

import type { Config } from '../types.js';

/**
 * Default configuration object.
 * Applied as the base layer before merging user/project configs.
 * 
 * Note: Anthropic is NOT included because Claude Code already provides it.
 * These are EXTERNAL providers for second opinions and critiques.
 * Roles are empty by default - users configure them during setup.
 */
export const DEFAULT_CONFIG: Config = {
  version: '1.0',

  defaults: {
    temperature: 0.7,
    max_tokens: 4096,
    timeout_ms: 60000,
  },

  // Roles are configured by the user during setup
  // They choose which roles they want and assign providers
  roles: {},

  // Provider configurations (templates - user adds their own keys)
  // Only EXTERNAL providers - Anthropic is NOT included
  providers: {},
};

/**
 * Configuration file search paths in priority order.
 * Higher priority paths are listed first.
 */
export interface ConfigPaths {
  /** Project-level config paths (highest priority) */
  project: string[];
  /** User-level config paths */
  user: string[];
  /** System-level config paths (lowest priority) */
  system: string[];
}

/**
 * Get standard configuration file search paths.
 * Returns paths organized by scope (project, user, system).
 *
 * @returns Object containing config paths by scope
 */
export function getConfigPaths(): ConfigPaths {
  const cwd = process.cwd();
  const home = homedir();
  const isWindows = platform() === 'win32';

  const projectPaths = [
    join(cwd, '.agent-router.yaml'),
    join(cwd, '.agent-router.yml'),
    join(cwd, 'agent-router.yaml'),
    join(cwd, 'agent-router.yml'),
  ];

  const userPaths = isWindows
    ? [
        join(home, 'AppData', 'Roaming', 'agent-router', 'config.yaml'),
        join(home, 'AppData', 'Roaming', 'agent-router', 'config.yml'),
        join(home, '.config', 'agent-router', 'config.yaml'),
        join(home, '.config', 'agent-router', 'config.yml'),
      ]
    : [
        join(home, '.config', 'agent-router', 'config.yaml'),
        join(home, '.config', 'agent-router', 'config.yml'),
      ];

  const systemPaths = isWindows
    ? [join(process.env['PROGRAMDATA'] ?? 'C:\\ProgramData', 'agent-router', 'config.yaml')]
    : ['/etc/agent-router/config.yaml', '/etc/agent-router/config.yml'];

  return {
    project: projectPaths,
    user: userPaths,
    system: systemPaths,
  };
}

/**
 * Get all config paths as a flat array in priority order (highest first).
 *
 * @returns Array of config file paths
 */
export function getAllConfigPaths(): string[] {
  const paths = getConfigPaths();
  return [...paths.project, ...paths.user, ...paths.system];
}

/**
 * Get the default user config directory path.
 * This is where user-specific config should be created.
 *
 * @returns Path to user config directory
 */
export function getUserConfigDir(): string {
  const home = homedir();
  const isWindows = platform() === 'win32';

  return isWindows
    ? join(home, 'AppData', 'Roaming', 'agent-router')
    : join(home, '.config', 'agent-router');
}

/**
 * Get the default user config file path.
 *
 * @returns Path to user config file
 */
export function getUserConfigPath(): string {
  return join(getUserConfigDir(), 'config.yaml');
}
