/**
 * Unit tests for ConfigValidator
 *
 * Tests the configuration validation including:
 * - Valid configuration passes validation
 * - Missing required fields fail
 * - Invalid provider references fail
 * - Type mismatches fail
 * - Helpful error messages
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ConfigValidator,
  validateConfig,
  isValidConfig,
} from '../../src/config/validator.js';
import { ConfigurationError } from '../../src/types.js';

describe('ConfigValidator', () => {
  let validator: ConfigValidator;

  beforeEach(() => {
    validator = new ConfigValidator();
  });

  const validConfig = {
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
      },
    },
    providers: {
      anthropic: {
        api_key: 'test-key',
      },
    },
  };

  describe('validate()', () => {
    it('should pass validation for valid config', () => {
      const result = validator.validate(validConfig);

      expect(result).toEqual(validConfig);
    });

    it('should pass validation for config with all optional fields', () => {
      const fullConfig = {
        version: '1.0',
        defaults: {
          temperature: 0.5,
          max_tokens: 8192,
          timeout_ms: 120000,
        },
        roles: {
          coder: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-20250514',
            system_prompt: 'You are an expert software engineer.',
            temperature: 0.3,
            max_tokens: 16384,
            timeout_ms: 180000,
            fallback: {
              provider: 'openai',
              model: 'gpt-4o',
            },
          },
        },
        providers: {
          anthropic: {
            api_key: '${ANTHROPIC_API_KEY}',
            base_url: 'https://api.anthropic.com',
          },
          openai: {
            api_key: '${OPENAI_API_KEY}',
            organization: 'org-123',
          },
        },
      };

      const result = validator.validate(fullConfig);
      expect(result).toEqual(fullConfig);
    });
  });

  describe('missing required fields', () => {
    it('should fail when version is missing', () => {
      const config = { ...validConfig };
      delete (config as Record<string, unknown>)['version'];

      expect(() => validator.validate(config)).toThrow(ConfigurationError);
      expect(() => validator.validate(config)).toThrow(/missing required property "version"/);
    });

    it('should fail when defaults is missing', () => {
      const config = { ...validConfig };
      delete (config as Record<string, unknown>)['defaults'];

      expect(() => validator.validate(config)).toThrow(ConfigurationError);
      expect(() => validator.validate(config)).toThrow(/missing required property "defaults"/);
    });

    it('should fail when roles is missing', () => {
      const config = { ...validConfig };
      delete (config as Record<string, unknown>)['roles'];

      expect(() => validator.validate(config)).toThrow(ConfigurationError);
      expect(() => validator.validate(config)).toThrow(/missing required property "roles"/);
    });

    it('should fail when providers is missing', () => {
      const config = { ...validConfig };
      delete (config as Record<string, unknown>)['providers'];

      expect(() => validator.validate(config)).toThrow(ConfigurationError);
      expect(() => validator.validate(config)).toThrow(/missing required property "providers"/);
    });

    it('should fail when defaults.temperature is missing', () => {
      const config = structuredClone(validConfig);
      delete (config.defaults as Record<string, unknown>)['temperature'];

      expect(() => validator.validate(config)).toThrow(ConfigurationError);
      expect(() => validator.validate(config)).toThrow(/missing required property "temperature"/);
    });

    it('should fail when role provider is missing', () => {
      const config = structuredClone(validConfig);
      delete (config.roles.coder as Record<string, unknown>)['provider'];

      expect(() => validator.validate(config)).toThrow(ConfigurationError);
      expect(() => validator.validate(config)).toThrow(/missing required property "provider"/);
    });

    it('should fail when role model is missing', () => {
      const config = structuredClone(validConfig);
      delete (config.roles.coder as Record<string, unknown>)['model'];

      expect(() => validator.validate(config)).toThrow(ConfigurationError);
      expect(() => validator.validate(config)).toThrow(/missing required property "model"/);
    });
  });

  describe('invalid provider references', () => {
    it('should fail when role references undefined provider', () => {
      const config = structuredClone(validConfig);
      config.roles.coder.provider = 'nonexistent';

      expect(() => validator.validate(config)).toThrow(ConfigurationError);
      expect(() => validator.validate(config)).toThrow(
        /references undefined provider "nonexistent"/
      );
    });

    it('should fail when fallback references undefined provider', () => {
      const config = structuredClone(validConfig);
      config.roles.coder.fallback = {
        provider: 'nonexistent',
        model: 'some-model',
      };

      expect(() => validator.validate(config)).toThrow(ConfigurationError);
      expect(() => validator.validate(config)).toThrow(
        /fallback references undefined provider "nonexistent"/
      );
    });
  });

  describe('type mismatches', () => {
    it('should fail when version is not a string', () => {
      const config = structuredClone(validConfig);
      (config as Record<string, unknown>)['version'] = 1.0;

      expect(() => validator.validate(config)).toThrow(ConfigurationError);
      expect(() => validator.validate(config)).toThrow(/expected string/);
    });

    it('should fail when temperature is not a number', () => {
      const config = structuredClone(validConfig);
      (config.defaults as Record<string, unknown>)['temperature'] = '0.7';

      expect(() => validator.validate(config)).toThrow(ConfigurationError);
      expect(() => validator.validate(config)).toThrow(/expected number/);
    });

    it('should fail when max_tokens is not an integer', () => {
      const config = structuredClone(validConfig);
      (config.defaults as Record<string, unknown>)['max_tokens'] = 4096.5;

      expect(() => validator.validate(config)).toThrow(ConfigurationError);
      expect(() => validator.validate(config)).toThrow(/expected integer/);
    });

    it('should fail when roles is not an object', () => {
      const config = structuredClone(validConfig);
      (config as Record<string, unknown>)['roles'] = ['coder'];

      expect(() => validator.validate(config)).toThrow(ConfigurationError);
      expect(() => validator.validate(config)).toThrow(/expected object/);
    });
  });

  describe('value constraints', () => {
    it('should fail when temperature is below minimum (0)', () => {
      const config = structuredClone(validConfig);
      config.defaults.temperature = -0.1;

      expect(() => validator.validate(config)).toThrow(ConfigurationError);
      expect(() => validator.validate(config)).toThrow(/less than minimum/);
    });

    it('should fail when temperature is above maximum (2)', () => {
      const config = structuredClone(validConfig);
      config.defaults.temperature = 2.1;

      expect(() => validator.validate(config)).toThrow(ConfigurationError);
      expect(() => validator.validate(config)).toThrow(/greater than maximum/);
    });

    it('should fail when max_tokens is below minimum (1)', () => {
      const config = structuredClone(validConfig);
      config.defaults.max_tokens = 0;

      expect(() => validator.validate(config)).toThrow(ConfigurationError);
      expect(() => validator.validate(config)).toThrow(/less than minimum/);
    });

    it('should fail when timeout_ms is below minimum (1000)', () => {
      const config = structuredClone(validConfig);
      config.defaults.timeout_ms = 999;

      expect(() => validator.validate(config)).toThrow(ConfigurationError);
      expect(() => validator.validate(config)).toThrow(/less than minimum/);
    });

    it('should fail when version does not match pattern', () => {
      const config = structuredClone(validConfig);
      config.version = 'v1.0'; // Should be "1.0" not "v1.0"

      expect(() => validator.validate(config)).toThrow(ConfigurationError);
      expect(() => validator.validate(config)).toThrow(/does not match required pattern/);
    });

    it('should fail when roles is empty', () => {
      const config = structuredClone(validConfig);
      config.roles = {};

      expect(() => validator.validate(config)).toThrow(ConfigurationError);
      expect(() => validator.validate(config)).toThrow(/at least 1 properties/);
    });

    it('should fail when providers is empty', () => {
      const config = structuredClone(validConfig);
      config.providers = {};

      expect(() => validator.validate(config)).toThrow(ConfigurationError);
      expect(() => validator.validate(config)).toThrow(/at least 1 properties/);
    });
  });

  describe('additional properties', () => {
    it('should fail when config has unknown top-level property', () => {
      const config = structuredClone(validConfig);
      (config as Record<string, unknown>)['unknown_field'] = 'value';

      expect(() => validator.validate(config)).toThrow(ConfigurationError);
      expect(() => validator.validate(config)).toThrow(/unexpected property "unknown_field"/);
    });

    it('should fail when role has unknown property', () => {
      const config = structuredClone(validConfig);
      (config.roles.coder as Record<string, unknown>)['unknown'] = 'value';

      expect(() => validator.validate(config)).toThrow(ConfigurationError);
      expect(() => validator.validate(config)).toThrow(/unexpected property "unknown"/);
    });
  });

  describe('validateConfig() helper', () => {
    it('should validate and return config', () => {
      const result = validateConfig(validConfig);
      expect(result).toEqual(validConfig);
    });

    it('should throw ConfigurationError for invalid config', () => {
      expect(() => validateConfig({})).toThrow(ConfigurationError);
    });
  });

  describe('isValidConfig() helper', () => {
    it('should return true for valid config', () => {
      expect(isValidConfig(validConfig)).toBe(true);
    });

    it('should return false for invalid config', () => {
      expect(isValidConfig({})).toBe(false);
      expect(isValidConfig(null)).toBe(false);
      expect(isValidConfig({ version: 1 })).toBe(false);
    });
  });

  describe('validateConfig() method (non-throwing)', () => {
    it('should return valid: true for valid config', () => {
      const result = validator.validateConfig(validConfig);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should return valid: false with errors for invalid config', () => {
      const result = validator.validateConfig({});

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should include detailed error objects', () => {
      const result = validator.validateConfig({});

      expect(result.details).toBeDefined();
      expect(result.details?.length).toBeGreaterThan(0);
    });
  });

  describe('validatePartialConfig()', () => {
    it('should pass for partial config with only some fields', () => {
      const partialConfig = {
        defaults: {
          temperature: 0.5,
        },
      };

      // Should not throw
      const result = validator.validatePartialConfig(partialConfig);
      expect(result).toEqual(partialConfig);
    });

    it('should still validate types in partial config', () => {
      const partialConfig = {
        defaults: {
          temperature: 'invalid', // Should be number
        },
      };

      expect(() => validator.validatePartialConfig(partialConfig)).toThrow(ConfigurationError);
    });
  });

  describe('error message helpfulness', () => {
    it('should include path in error message', () => {
      const config = structuredClone(validConfig);
      (config.defaults as Record<string, unknown>)['temperature'] = 'invalid';

      try {
        validator.validate(config);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as Error).message).toContain('/defaults/temperature');
      }
    });

    it('should include role name in error path', () => {
      const config = structuredClone(validConfig);
      delete (config.roles.coder as Record<string, unknown>)['model'];

      try {
        validator.validate(config);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationError);
        expect((error as Error).message).toContain('/roles/coder');
      }
    });

    it('should collect all errors (allErrors mode)', () => {
      const config = {
        version: 123, // Wrong type
        defaults: {
          temperature: 'wrong', // Wrong type
        },
        // Missing roles and providers
      };

      const result = validator.validateConfig(config);

      // Should have multiple errors due to allErrors: true
      expect(result.errors.length).toBeGreaterThan(1);
    });
  });
});
