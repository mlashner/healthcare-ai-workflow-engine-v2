import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { evalCategories } from "@/eval/types";

import {
  getAgentTrace,
  getEvaluationFailures,
  parseCategories,
  runEvaluation,
  searchKnowledgeBase,
} from "./tools";

/**
 * CarePilot development MCP server. Stdio only — stdout is the protocol.
 * These tools are operator/eval helpers, not in-loop agent tools, and they
 * do not execute write tools or return raw chart demographics.
 */
export function createCarepilotMcpServer(): McpServer {
  const server = new McpServer({
    name: "carepilot",
    version: "0.1.0",
  });

  server.registerTool(
    "run_evaluation",
    {
      title: "Run evaluation suite",
      description:
        "Run the CarePilot in-memory evaluation suite (same as npm run eval) and compare which scenario failures are new versus the previous stored run. Fictional data only. Can take up to a minute.",
      inputSchema: {
        categories: z
          .array(z.enum(evalCategories))
          .optional()
          .describe("Optional subset of eval categories. Omit to run all 32 scenarios."),
      },
    },
    async ({ categories }) => jsonResult(await runEvaluation({ categories: parseCategories(categories) })),
  );

  server.registerTool(
    "get_evaluation_failures",
    {
      title: "Get evaluation failures",
      description:
        "Read the latest stored eval suite (eval/results/latest.json) and list failing scenarios, including which failures increased compared with the previous run. Does not re-run the suite.",
    },
    async () => jsonResult(getEvaluationFailures()),
  );

  server.registerTool(
    "get_agent_trace",
    {
      title: "Get agent trace",
      description:
        "Load a redacted clinician-facing agent trace for a stored run (Postgres). Omits patient identifiers. If runId is omitted, uses the most recent run.",
      inputSchema: {
        runId: z.string().min(1).optional().describe("Agent run id. Omit for the most recent run."),
      },
    },
    async ({ runId }) => jsonResult(await getAgentTrace({ runId })),
  );

  server.registerTool(
    "search_knowledge_base",
    {
      title: "Search knowledge base",
      description:
        "Search the fictional clinical knowledge corpus used by eval (not a patient chart). Returns citation ids and snippets.",
      inputSchema: {
        query: z.string().min(1).describe("Lexical search query, e.g. diabetes follow-up after unplanned visit."),
        limit: z.number().int().min(1).max(10).optional().describe("Max hits (default 5)."),
      },
    },
    async ({ query, limit }) => jsonResult(await searchKnowledgeBase({ query, limit })),
  );

  return server;
}

function jsonResult(value: unknown): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  const record = value as { error?: unknown };
  return {
    isError: typeof record.error === "string",
    content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}\n` }],
  };
}
