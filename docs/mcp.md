# CarePilot MCP server

A local **stdio** MCP server for development and observability. It is not part of the in-loop agent catalog. Cursor (or any MCP client) can call these tools; the care-coordinator agent cannot.

Fictional data only. Tools omit patient identifiers and do not execute write tools.

## Tools

| Tool | What it does |
|---|---|
| `run_evaluation` | Runs the in-memory suite (`npm run eval`) and returns pass rate plus **which scenario failures are new vs the previous stored run**. |
| `get_evaluation_failures` | Reads `eval/results/latest.json` without re-running. Same failure delta as above. |
| `get_agent_trace` | Loads a redacted agent trace from Postgres. Pass `runId`, or omit it for the most recent run. |
| `search_knowledge_base` | Lexical search over the fictional clinical knowledge corpus used by eval. |

## Cursor setup

This repository already includes [`.cursor/mcp.json`](../.cursor/mcp.json). After `npm install`:

1. Reload the Cursor window (or restart Cursor) so it spawns the server.
2. Confirm **carepilot** is connected under Customize → MCP.
3. In Agent chat, ask: *Run the latest evaluation suite and tell me which failures increased compared with the previous run.*

Cursor should call `run_evaluation`. A second ask that should not re-run the suite can use `get_evaluation_failures`.

Start the server by hand to debug:

```bash
npm run mcp
```

Stdout is JSON-RPC only. Logs go to stderr. `LOG_LEVEL` defaults to `error` for this process.

`get_agent_trace` needs a migrated local Postgres (`DATABASE_URL` from `.env`). Eval tools do not.

## Trust boundary

These tools are for operators and eval, the same way `/admin` is. They must not become in-loop agent tools, mint privileges, or return raw transcripts or chart demographics.
