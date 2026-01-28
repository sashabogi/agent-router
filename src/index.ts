/**
 * AgentRouter - MCP server for multi-agent orchestration
 * Entry point
 */

import { createServer, startServer } from "./server.js";

export const VERSION = "3.0.0";

/**
 * Main entry point - creates and starts the MCP server
 */
async function main(): Promise<void> {
  const server = await createServer();
  await startServer(server);
}

// Graceful shutdown handling
function setupShutdownHandlers(): void {
  const shutdown = (signal: string): void => {
    console.error(`\nReceived ${signal}, shutting down gracefully...`);
    process.exit(0);
  };

  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
}

// Setup handlers before starting
setupShutdownHandlers();

// Start the server
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Failed to start AgentRouter:", message);
  process.exit(1);
});
