/**
 * Z.AI Provider Implementation
 *
 * Z.AI (GLM models) uses an OpenAI-compatible API format.
 * This provider extends OpenAIProvider with the correct name identifier.
 */

import { OpenAIProvider } from './openai.js';
import type { ProviderConfig } from '../types.js';

/**
 * Z.AI (GLM) API provider adapter.
 *
 * Uses OpenAI-compatible API format but with Z.AI endpoints.
 * Default base URL: https://api.z.ai/api/paas/v4
 */
export class ZAIProvider extends OpenAIProvider {
  public override readonly name = 'zai';

  constructor(config: ProviderConfig) {
    super(config);
  }
}
