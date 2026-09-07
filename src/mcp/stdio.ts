import "./preload";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createCarepilotMcpServer } from "./server";

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  const server = createCarepilotMcpServer();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "carepilot MCP server failed";
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
