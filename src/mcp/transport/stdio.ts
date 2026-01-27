/**
 * stdio Transport for MCP Server
 * Provides stdin/stdout based communication for Claude Code integration
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

/**
 * Creates a stdio transport for the MCP server
 * This transport uses stdin/stdout for communication with Claude Code
 *
 * @returns StdioServerTransport instance configured for use
 */
export function createStdioTransport(): StdioServerTransport {
  return new StdioServerTransport();
}
