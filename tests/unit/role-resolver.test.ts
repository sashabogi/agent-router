/**
 * Unit tests for RoleResolver
 *
 * Tests the role resolution logic including:
 * - Resolving roles to full AgentConfig
 * - Merging role config with defaults
 * - Error handling for unknown roles
 * - Listing and checking roles
 * - Config updates for hot reload
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RoleResolver } from '../../src/router/role-resolver.js';
import type { Config } from '../../src/types.js';

describe('RoleResolver', () => {
  let resolver: RoleResolver;
  let baseConfig: Config;

  beforeEach(() => {
    baseConfig = {
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
          system_prompt: 'You are an expert software engineer.',
        },
        critic: {
          provider: 'openai',
          model: 'gpt-4o',
          temperature: 0.3,
          max_tokens: 8192,
        },
        reviewer: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          fallback: {
            provider: 'openai',
            model: 'gpt-4o',
          },
        },
      },
      providers: {
        anthropic: {
          api_key: 'test-key',
        },
        openai: {
          api_key: 'test-key',
        },
      },
    };

    resolver = new RoleResolver(baseConfig);
  });

  describe('resolve()', () => {
    it('should return correct AgentConfig for a role', () => {
      const config = resolver.resolve('coder');

      expect(config.provider).toBe('anthropic');
      expect(config.model).toBe('claude-sonnet-4-20250514');
      expect(config.system_prompt).toBe('You are an expert software engineer.');
    });

    it('should merge role config with defaults correctly', () => {
      const config = resolver.resolve('coder');

      // Should use default values when not specified in role
      expect(config.temperature).toBe(0.7);
      expect(config.max_tokens).toBe(4096);
      expect(config.timeout_ms).toBe(60000);
    });

    it('should allow role to override default values', () => {
      const config = resolver.resolve('critic');

      // Critic has custom temperature and max_tokens
      expect(config.temperature).toBe(0.3);
      expect(config.max_tokens).toBe(8192);
      // timeout_ms not overridden, should use default
      expect(config.timeout_ms).toBe(60000);
    });

    it('should include fallback config when defined', () => {
      const config = resolver.resolve('reviewer');

      expect(config.fallback).toBeDefined();
      expect(config.fallback?.provider).toBe('openai');
      expect(config.fallback?.model).toBe('gpt-4o');
    });

    it('should not include fallback when not defined', () => {
      const config = resolver.resolve('coder');

      expect(config.fallback).toBeUndefined();
    });

    it('should throw for unknown roles', () => {
      expect(() => resolver.resolve('unknown-role')).toThrow(
        'Unknown role: "unknown-role"'
      );
    });

    it('should list available roles in error message for unknown role', () => {
      expect(() => resolver.resolve('nonexistent')).toThrow(
        /Available roles:.*coder.*critic.*reviewer/
      );
    });

    it('should handle role with all optional properties undefined', () => {
      const minimalConfig: Config = {
        version: '1.0',
        defaults: {
          temperature: 0.5,
          max_tokens: 2048,
          timeout_ms: 30000,
        },
        roles: {
          minimal: {
            provider: 'anthropic',
            model: 'claude-3-haiku',
          },
        },
        providers: {
          anthropic: { api_key: 'test' },
        },
      };

      const minimalResolver = new RoleResolver(minimalConfig);
      const config = minimalResolver.resolve('minimal');

      expect(config.provider).toBe('anthropic');
      expect(config.model).toBe('claude-3-haiku');
      expect(config.temperature).toBe(0.5);
      expect(config.max_tokens).toBe(2048);
      expect(config.timeout_ms).toBe(30000);
      expect(config.system_prompt).toBeUndefined();
      expect(config.fallback).toBeUndefined();
    });
  });

  describe('listRoles()', () => {
    it('should return all configured role names', () => {
      const roles = resolver.listRoles();

      expect(roles).toContain('coder');
      expect(roles).toContain('critic');
      expect(roles).toContain('reviewer');
      expect(roles).toHaveLength(3);
    });

    it('should return empty array when no roles configured', () => {
      const emptyConfig: Config = {
        version: '1.0',
        defaults: {
          temperature: 0.7,
          max_tokens: 4096,
          timeout_ms: 60000,
        },
        roles: {},
        providers: {},
      };

      const emptyResolver = new RoleResolver(emptyConfig);
      const roles = emptyResolver.listRoles();

      expect(roles).toEqual([]);
    });
  });

  describe('hasRole()', () => {
    it('should return true for existing roles', () => {
      expect(resolver.hasRole('coder')).toBe(true);
      expect(resolver.hasRole('critic')).toBe(true);
      expect(resolver.hasRole('reviewer')).toBe(true);
    });

    it('should return false for non-existing roles', () => {
      expect(resolver.hasRole('unknown')).toBe(false);
      expect(resolver.hasRole('CODER')).toBe(false); // Case sensitive
      expect(resolver.hasRole('')).toBe(false);
    });
  });

  describe('updateConfig()', () => {
    it('should update resolver with new configuration', () => {
      // Initial state
      expect(resolver.hasRole('coder')).toBe(true);
      expect(resolver.hasRole('designer')).toBe(false);

      // Update config
      const newConfig: Config = {
        version: '1.0',
        defaults: {
          temperature: 0.9,
          max_tokens: 8192,
          timeout_ms: 120000,
        },
        roles: {
          designer: {
            provider: 'openai',
            model: 'gpt-4o',
          },
        },
        providers: {
          openai: { api_key: 'test' },
        },
      };

      resolver.updateConfig(newConfig);

      // Verify updated state
      expect(resolver.hasRole('coder')).toBe(false);
      expect(resolver.hasRole('designer')).toBe(true);
    });

    it('should use new defaults after update', () => {
      const newConfig: Config = {
        version: '1.0',
        defaults: {
          temperature: 0.1,
          max_tokens: 1024,
          timeout_ms: 10000,
        },
        roles: {
          test: {
            provider: 'anthropic',
            model: 'claude-3-opus',
          },
        },
        providers: {
          anthropic: { api_key: 'test' },
        },
      };

      resolver.updateConfig(newConfig);
      const config = resolver.resolve('test');

      expect(config.temperature).toBe(0.1);
      expect(config.max_tokens).toBe(1024);
      expect(config.timeout_ms).toBe(10000);
    });

    it('should replace all roles on update', () => {
      // Get initial role list
      const initialRoles = resolver.listRoles();
      expect(initialRoles).toHaveLength(3);

      // Update with single role
      const newConfig: Config = {
        version: '1.0',
        defaults: {
          temperature: 0.5,
          max_tokens: 2048,
          timeout_ms: 30000,
        },
        roles: {
          single: {
            provider: 'openai',
            model: 'gpt-4',
          },
        },
        providers: {
          openai: { api_key: 'test' },
        },
      };

      resolver.updateConfig(newConfig);
      const updatedRoles = resolver.listRoles();

      expect(updatedRoles).toHaveLength(1);
      expect(updatedRoles).toContain('single');
      expect(updatedRoles).not.toContain('coder');
    });
  });

  describe('error message formatting', () => {
    it('should show (none configured) when no roles exist', () => {
      const emptyConfig: Config = {
        version: '1.0',
        defaults: {
          temperature: 0.7,
          max_tokens: 4096,
          timeout_ms: 60000,
        },
        roles: {},
        providers: {},
      };

      const emptyResolver = new RoleResolver(emptyConfig);

      expect(() => emptyResolver.resolve('any')).toThrow(
        'Available roles: (none configured)'
      );
    });
  });
});
