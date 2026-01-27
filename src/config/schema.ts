/**
 * JSON Schema Export for AgentRouter Configuration
 *
 * Re-exports the configuration JSON Schema for external use,
 * such as IDE validation, documentation generation, or schema.json files.
 */

import { configSchema } from './validator.js';

/**
 * JSON Schema for AgentRouter configuration.
 * Can be used for:
 * - IDE validation (VS Code, JetBrains)
 * - Documentation generation
 * - External tooling
 */
export { configSchema };

/**
 * Export as default for direct import.
 */
export default configSchema;
