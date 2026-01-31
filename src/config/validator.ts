/**
 * Configuration Validator for AgentRouter
 *
 * Validates configuration objects against a JSON Schema using AJV.
 * Provides detailed, human-readable error messages on validation failure.
 */

import AjvDefault, { type ErrorObject, type ValidateFunction, type Ajv as AjvType } from 'ajv';

import { ConfigurationError ,type  Config } from '../types.js';

// Handle ESM/CJS interop - AJV exports both default and named export
const Ajv = AjvDefault.default ?? AjvDefault;

/**
 * JSON Schema for AgentRouter configuration.
 * Defines the structure and constraints for config files.
 */
const CONFIG_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['version', 'defaults', 'roles', 'providers'],
  additionalProperties: false,
  properties: {
    version: {
      type: 'string',
      pattern: '^\\d+\\.\\d+$',
      description: 'Configuration schema version (e.g., "1.0")',
    },
    defaults: {
      type: 'object',
      required: ['temperature', 'max_tokens', 'timeout_ms'],
      additionalProperties: false,
      properties: {
        temperature: {
          type: 'number',
          minimum: 0,
          maximum: 2,
          description: 'Default temperature for LLM requests (0-2)',
        },
        max_tokens: {
          type: 'integer',
          minimum: 1,
          maximum: 200000,
          description: 'Default maximum tokens for LLM responses',
        },
        timeout_ms: {
          type: 'integer',
          minimum: 1000,
          maximum: 600000,
          description: 'Default timeout in milliseconds (1s-10min)',
        },
      },
    },
    roles: {
      type: 'object',
      minProperties: 1,
      additionalProperties: {
        $ref: '#/$defs/roleConfig',
      },
      description: 'Role definitions mapping role names to configurations',
    },
    providers: {
      type: 'object',
      minProperties: 1,
      additionalProperties: {
        $ref: '#/$defs/providerConfig',
      },
      description: 'Provider configurations',
    },
  },
  $defs: {
    roleConfig: {
      type: 'object',
      required: ['provider', 'model'],
      additionalProperties: false,
      properties: {
        provider: {
          type: 'string',
          minLength: 1,
          description: 'Provider name (must match a key in providers)',
        },
        model: {
          type: 'string',
          minLength: 1,
          description: 'Model identifier',
        },
        system_prompt: {
          type: 'string',
          description: 'System prompt / persona for this role',
        },
        temperature: {
          type: 'number',
          minimum: 0,
          maximum: 2,
          description: 'Temperature override (0-2)',
        },
        max_tokens: {
          type: 'integer',
          minimum: 1,
          maximum: 200000,
          description: 'Max tokens override',
        },
        timeout_ms: {
          type: 'integer',
          minimum: 1000,
          maximum: 600000,
          description: 'Timeout override in milliseconds',
        },
        fallback: {
          $ref: '#/$defs/fallbackConfig',
        },
      },
    },
    fallbackConfig: {
      type: 'object',
      required: ['provider', 'model'],
      additionalProperties: false,
      properties: {
        provider: {
          type: 'string',
          minLength: 1,
          description: 'Fallback provider name',
        },
        model: {
          type: 'string',
          minLength: 1,
          description: 'Fallback model identifier',
        },
      },
    },
    providerConfig: {
      type: 'object',
      additionalProperties: false,
      properties: {
        api_key: {
          type: 'string',
          description: 'API key (supports ${ENV_VAR} interpolation)',
        },
        base_url: {
          type: 'string',
          format: 'uri',
          description: 'Base URL for the provider API',
        },
        organization: {
          type: 'string',
          description: 'Organization ID (OpenAI)',
        },
        project: {
          type: 'string',
          description: 'Project ID (Google Cloud)',
        },
        location: {
          type: 'string',
          description: 'Region/location (Google Cloud)',
        },
        headers: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Additional headers for API requests',
        },
        access_mode: {
          type: 'string',
          enum: ['api', 'subscription'],
          description: 'Access mode: "api" for pay-per-token or "subscription" for CLI tools',
        },
        default_model: {
          type: 'string',
          description: 'Default model for this provider',
        },
      },
    },
  },
} as const;

/**
 * Schema for partial configuration (used during merging).
 * All top-level fields are optional.
 */
const PARTIAL_CONFIG_SCHEMA = {
  ...CONFIG_SCHEMA,
  required: [],
  properties: {
    ...CONFIG_SCHEMA.properties,
    defaults: {
      type: 'object',
      additionalProperties: false,
      properties: CONFIG_SCHEMA.properties.defaults.properties,
    },
  },
} as const;

/**
 * Validation result returned by the validator.
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Array of error messages (empty if valid) */
  errors: string[];
  /** Detailed error objects from AJV */
  details?: ErrorObject[];
}

/**
 * Configuration validator using AJV.
 */
export class ConfigValidator {
  private ajv: AjvType;
  private validateFull: ValidateFunction;
  private validatePartial: ValidateFunction;

  constructor() {
    this.ajv = new Ajv({
      allErrors: true,
      verbose: true,
      strict: true,
      formats: {
        uri: /^https?:\/\/.+/,
      },
    });

    this.validateFull = this.ajv.compile(CONFIG_SCHEMA);
    this.validatePartial = this.ajv.compile(PARTIAL_CONFIG_SCHEMA);
  }

  /**
   * Validate a complete configuration object.
   * Throws ConfigurationError if validation fails.
   *
   * @param config - Configuration object to validate
   * @returns The validated config (typed as Config)
   * @throws ConfigurationError if validation fails
   */
  validate(config: unknown): Config {
    const result = this.validateConfig(config, false);

    if (!result.valid) {
      throw new ConfigurationError(
        `Invalid configuration:\n${result.errors.map((e) => `  - ${e}`).join('\n')}`
      );
    }

    // Additional semantic validation
    this.validateSemantics(config as Config);

    return config as Config;
  }

  /**
   * Validate a partial configuration object (for merging).
   * Throws ConfigurationError if validation fails.
   *
   * @param config - Partial configuration object to validate
   * @returns The validated partial config
   * @throws ConfigurationError if validation fails
   */
  validatePartialConfig(config: unknown): Partial<Config> {
    const result = this.validateConfig(config, true);

    if (!result.valid) {
      throw new ConfigurationError(
        `Invalid partial configuration:\n${result.errors.map((e) => `  - ${e}`).join('\n')}`
      );
    }

    return config as Partial<Config>;
  }

  /**
   * Validate configuration and return a result object instead of throwing.
   *
   * @param config - Configuration object to validate
   * @param partial - Whether to validate as partial config
   * @returns ValidationResult with valid flag and any errors
   */
  validateConfig(config: unknown, partial = false): ValidationResult {
    const validator = partial ? this.validatePartial : this.validateFull;
    const valid = validator(config);

    if (valid) {
      return { valid: true, errors: [] };
    }

    const errors = this.formatErrors(validator.errors ?? []);
    const details = validator.errors ?? undefined;

    if (details) {
      return {
        valid: false,
        errors,
        details,
      };
    }

    return {
      valid: false,
      errors,
    };
  }

  /**
   * Perform semantic validation beyond schema validation.
   * Checks for logical consistency like provider references.
   *
   * @param config - Config object that passed schema validation
   * @throws ConfigurationError if semantic validation fails
   */
  private validateSemantics(config: Config): void {
    const errors: string[] = [];
    const providerNames = new Set(Object.keys(config.providers));

    // Check that all role providers exist
    for (const [roleName, roleConfig] of Object.entries(config.roles)) {
      if (!providerNames.has(roleConfig.provider)) {
        errors.push(
          `Role "${roleName}" references undefined provider "${roleConfig.provider}"`
        );
      }

      // Check fallback provider exists
      if (roleConfig.fallback && !providerNames.has(roleConfig.fallback.provider)) {
        errors.push(
          `Role "${roleName}" fallback references undefined provider "${roleConfig.fallback.provider}"`
        );
      }
    }

    if (errors.length > 0) {
      throw new ConfigurationError(
        `Configuration semantic errors:\n${errors.map((e) => `  - ${e}`).join('\n')}`
      );
    }
  }

  /**
   * Format AJV errors into human-readable messages.
   *
   * @param errors - Array of AJV error objects
   * @returns Array of formatted error strings
   */
  private formatErrors(errors: ErrorObject[]): string[] {
    return errors.map((error) => {
      const path = error.instancePath || 'root';
      const message = this.getErrorMessage(error);
      return `${path}: ${message}`;
    });
  }

  /**
   * Get a human-readable message for an AJV error.
   *
   * @param error - AJV error object
   * @returns Human-readable error message
   */
  private getErrorMessage(error: ErrorObject): string {
    const params = error.params as Record<string, unknown>;

    switch (error.keyword) {
      case 'required':
        return `missing required property "${params['missingProperty']}"`;

      case 'additionalProperties':
        return `unexpected property "${params['additionalProperty']}"`;

      case 'type':
        return `expected ${params['type']}, got ${typeof error.data}`;

      case 'minimum':
        return `value ${error.data} is less than minimum ${params['limit']}`;

      case 'maximum':
        return `value ${error.data} is greater than maximum ${params['limit']}`;

      case 'minLength':
        return `string is too short (minimum ${params['limit']} characters)`;

      case 'pattern':
        return `string does not match required pattern "${params['pattern']}"`;

      case 'format':
        return `invalid format, expected ${params['format']}`;

      case 'minProperties':
        return `object must have at least ${params['limit']} properties`;

      case 'enum':
        return `must be one of: ${(params['allowedValues'] as string[]).join(', ')}`;

      default:
        return error.message ?? 'validation failed';
    }
  }
}

/**
 * Convenience function to validate a configuration object.
 * Creates a new validator instance and validates the config.
 *
 * @param config - Configuration object to validate
 * @returns The validated config
 * @throws ConfigurationError if validation fails
 */
export function validateConfig(config: unknown): Config {
  const validator = new ConfigValidator();
  return validator.validate(config);
}

/**
 * Convenience function to check if a config is valid without throwing.
 *
 * @param config - Configuration object to check
 * @returns True if valid, false otherwise
 */
export function isValidConfig(config: unknown): config is Config {
  const validator = new ConfigValidator();
  const result = validator.validateConfig(config, false);
  return result.valid;
}

/**
 * Export the schema for external use (e.g., generating schema.json).
 */
export const configSchema = CONFIG_SCHEMA;
