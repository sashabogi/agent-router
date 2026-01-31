/**
 * Kimi Code Provider Implementation
 *
 * Kimi Code uses an OpenAI-compatible API format optimized for coding tasks.
 * This provider extends OpenAIProvider with the correct name and base URL.
 *
 * API docs: https://www.kimi.com/code/docs/en/more/third-party-agents.html
 *
 * IMPORTANT: Kimi Code API requires a recognized coding agent User-Agent header.
 */

import { OpenAIProvider } from './openai.js';
import type { ProviderConfig } from '../types.js';

/**
 * Kimi Code API provider adapter.
 *
 * Uses OpenAI-compatible API format with Kimi's coding-specific endpoint.
 * Default base URL: https://api.kimi.com/coding/v1
 * Model: kimi-for-coding (262K context, 32K output)
 *
 * Requires User-Agent header identifying as a coding agent (e.g., claude-code).
 */
export class KimiProvider extends OpenAIProvider {
  public override readonly name = 'kimi';

  constructor(config: ProviderConfig) {
    // Ensure the correct base URL if not specified
    const kimiConfig = {
      ...config,
      base_url: config.base_url || 'https://api.kimi.com/coding/v1',
    };
    super(kimiConfig);
  }

  /**
   * Build headers for Kimi Code API requests.
   * Adds required User-Agent header for coding agent identification.
   */
  protected override buildHeaders(): Record<string, string> {
    const headers = super.buildHeaders();
    // Kimi Code API requires a recognized coding agent User-Agent
    headers['User-Agent'] = 'claude-code/1.0';
    return headers;
  }
}
