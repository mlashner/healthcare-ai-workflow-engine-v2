# Model providers

CarePilot talks to language models through `ModelProvider` in `src/llm/`. Agents, tools, policies, domain types, and the evaluation suite depend on that port. They do not import vendor SDKs.

## Port

A provider must support:

| Capability | How it appears on the port |
|---|---|
| Structured generation | `complete({ schemaName, jsonSchema? })` returns JSON-shaped `content`. Zod validation stays in the control plane (`decodeStructured`). |
| Tool calling | Optional `request.tools`. Native vendor tool calls are mapped to CarePilot `{ type: "tool_call", toolName, arguments }` in `content`. The agent loop still executes tools only through the gateway. |
| Streaming | `stream()` yields `delta` / `tool_call_delta` / `completed`. The coordinator loop uses `complete()`; streaming is for UI or future adapters. |
| Metadata | `metadata.id`, `model`, and capability flags. |
| Token / cost | `completion.usage` (`inputTokens`, `outputTokens`, `estimatedCostUsd`). |
| Errors | `ModelError` with `PROVIDER_FAILURE`, `EMPTY_RESPONSE`, `TIMEOUT`, `SCHEMA_FAILURE`, `RATE_LIMITED`. |

Composition happens in `createModelProvider` (`src/llm/factory.ts`). Adding a second hosted vendor is a new adapter under `src/llm/providers/` plus one factory branch.

## Implementations

1. **Scripted (deterministic fake)** — `createScriptedModelProvider`. Used by unit tests, integration tests, and `npm run eval`. No network.
2. **OpenAI-compatible HTTP** — `createOpenAiCompatibleProvider`. First hosted adapter. Uses `fetch` against `/chat/completions` so OpenAI, Azure OpenAI, Groq, or a local server can sit behind the same file. No vendor SDK.

## Tradeoffs

**Provider-specific capabilities.** Native JSON Schema, prompt caching, computer-use, or vendor tool loops are richer than this port. Mapping them in would pull vendor types into agents and make a second provider a rewrite. CarePilot keeps those features inside the adapter, or omits them.

**Portability.** JSON-in / JSON-out plus optional tools is enough to swap models. Structured steps (`think` / `tool_call` / `finish`) are product types, not OpenAI types. Authorization, patient scope, and approval stay in the control plane no matter which model emits the next step.

**Abstraction complexity.** The port adds a mapping layer (messages as JSON strings, tool observations as user text, cost estimates that are not invoices). That cost is paid once. The alternative — calling OpenAI from `src/agents/runner.ts` — is simpler for one vendor and expensive for every subsequent one, and it would leak tool execution into the model SDK.

Rule of thumb: if a capability changes what the **agent is allowed to do**, it does not belong on the provider. If it only changes how tokens are requested, it belongs in an adapter.
