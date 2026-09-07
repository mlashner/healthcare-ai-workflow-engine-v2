import { describe, expect, it } from "vitest";

import { createCarepilotMcpServer } from "@/mcp/server";

describe("createCarepilotMcpServer", () => {
  it("registers the four development tools", () => {
    const server = createCarepilotMcpServer();
    const registered = (
      server as unknown as { _registeredTools: Record<string, { title?: string }> }
    )._registeredTools;

    expect(Object.keys(registered).sort()).toEqual([
      "get_agent_trace",
      "get_evaluation_failures",
      "run_evaluation",
      "search_knowledge_base",
    ]);
    expect(registered.run_evaluation?.title).toBe("Run evaluation suite");
  });
});
