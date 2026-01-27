/**
 * Default Configuration for AgentRouter
 *
 * Provides fallback configuration values when no config files are present
 * and utility functions for determining config file locations.
 */

import { homedir, platform } from 'os';
import { join } from 'path';

import type { Config } from '../types.js';

/**
 * Default configuration object.
 * Applied as the base layer before merging user/project configs.
 */
export const DEFAULT_CONFIG: Config = {
  version: '1.0',

  defaults: {
    temperature: 0.7,
    max_tokens: 4096,
    timeout_ms: 60000,
  },

  roles: {
    coder: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      system_prompt: `You are an expert software engineer. Write clean, efficient, well-documented code.
Follow best practices, use appropriate design patterns, and consider edge cases.
Provide explanations for complex logic.`,
    },

    critic: {
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.3,
      system_prompt: `You are a skeptical senior architect and technical reviewer. Your job is to:

1. **Challenge Assumptions**: Don't accept claims at face value. Ask "Why?" and "What if?"
2. **Identify Risks**: Find failure modes, edge cases, and potential issues
3. **Question Scope**: Is the solution over-engineered? Under-specified?
4. **Check Completeness**: What's missing? What hasn't been considered?
5. **Push for Excellence**: "Good enough" isn't good enough. Find ways to improve.

Be constructive but rigorous. Your goal is to make plans better, not to tear them down.
Provide specific, actionable feedback.`,
      fallback: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      },
    },

    designer: {
      provider: 'google',
      model: 'gemini-2.5-pro',
      system_prompt: `You are a senior UI/UX designer and frontend architect. Focus on:

1. **User Experience**: Is it intuitive? Accessible? Delightful?
2. **Visual Hierarchy**: Does the layout guide the user's eye?
3. **Component Architecture**: Are components reusable? Maintainable?
4. **Design Systems**: Does it follow established patterns?
5. **Responsive Design**: How does it work across devices?
6. **Accessibility**: WCAG compliance, keyboard navigation, screen readers

Provide specific feedback with examples and alternatives where applicable.`,
    },

    researcher: {
      provider: 'google',
      model: 'gemini-2.5-pro',
      system_prompt: `You are a research analyst. Provide well-researched, factual information.
When possible, cite sources or indicate confidence levels.
If you're uncertain, say so. Prefer accuracy over completeness.`,
    },

    reviewer: {
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.2,
      system_prompt: `You are a senior code reviewer. Review code for:

1. **Correctness**: Does it work? Are there bugs?
2. **Security**: SQL injection, XSS, auth issues, data exposure
3. **Performance**: N+1 queries, unnecessary computations, memory leaks
4. **Maintainability**: Is it readable? Well-structured? Documented?
5. **Best Practices**: Follows language/framework conventions?
6. **Testing**: Is it testable? Are there missing tests?

Be specific. Reference line numbers. Suggest improvements with code examples.`,
    },
  },

  providers: {
    anthropic: {
      api_key: '${ANTHROPIC_API_KEY}',
      base_url: 'https://api.anthropic.com',
    },
    openai: {
      api_key: '${OPENAI_API_KEY}',
      base_url: 'https://api.openai.com/v1',
    },
    google: {
      api_key: '${GEMINI_API_KEY}',
    },
    zai: {
      api_key: '${ZAI_API_KEY}',
      base_url: 'https://api.z.ai/api/anthropic',
    },
    ollama: {
      base_url: 'http://localhost:11434',
    },
  },
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
