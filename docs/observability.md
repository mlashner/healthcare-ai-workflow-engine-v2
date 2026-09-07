# AI observability

CarePilot records **numeric, allowlisted** metrics for every agent run. The control plane writes them. The model cannot append or rewrite them. Snapshots never include encounter transcripts, chart demographics, retrieved passage text, tool argument bodies, or secrets.

This is a fictional-data demo, not a medical product. Treat the same fields as sensitive anyway.

## What is captured per run

On each model `complete()` the runner records a `model_invocation` input (tokens, cost, latency, model identity). Tool successes and failures stay on existing `tool_call` / `tool_result` events. At run end — success, provider failure, budget exhaustion, schema failure, or rate limit — the control plane writes a `policy_decision` whose `kind` is `run_telemetry`.

| Field | Meaning |
|---|---|
| `model` | Provider model id (`scripted`, hosted model name, …) |
| `modelVersion` | Adapter version string (hosted adapters use the model id) |
| `inputTokens` / `outputTokens` | Sum of `completion.usage` across model calls |
| `estimatedCostUsd` | Sum of provider cost estimates (not an invoice) |
| `modelLatencyMs` | Sum of `complete()` wall time |
| `modelCallCount` | Successful and failed `complete()` attempts |
| `toolCallCount` | Gateway invocations proposed by the agent |
| `failedToolCallCount` | Tool results with `ok: false` (denials, errors) |
| `runDurationMs` | `completedAt - startedAt` |
| `modelFailed` | True when the run ends in `PROVIDER_FAILURE` or a model invocation error |

The clinician trace skips `run_telemetry` events so the care narrative is not mixed with ops counters. Structured logs emit the same allowlisted fields (`agent.run.telemetry`) after redaction.

## Admin dashboard

`/admin` shows aggregates over recent runs:

- average cost per run
- p50 and p95 **run duration** (the SLO-shaped latency)
- average tool calls
- model failure rate
- evaluation pass rate over time, from `eval/results/*.json` (`latest.json` is skipped so the trend is not doubled)
- latest-suite scenario count, policy compliance, citation accuracy, and escalation accuracy (read these off the screen; do not recite leftover numbers from a script)

The page does not filter by clinician patient scope and does not render patient ids, names, dates of birth, or transcripts. In production this route needs an operator role, not a care-team login.

## Metrics that matter in production

The demo dashboard is a start. Operating a real coordinator would also watch:

**Cost and capacity**

- Cost per run, per agent, and per model version (catch a prompt or retrieval regression)
- Tokens per run vs the iteration/token budget (are loops spinning?)
- Cache hit rate / prompt prefix stability if a hosted cache is added later
- Queue depth and admission denials (`RATE_LIMITED`) vs accepted runs

**Latency SLOs**

- p50 / p95 / p99 **run duration** and **model `complete()` latency**, separately
- Tail latency by tool (retrieval vs policy denial is cheap; a hung provider is not)
- Time to first structured step, and time spent in safety retries

**Reliability of the model and tools**

- Provider error rate by code (`TIMEOUT`, `RATE_LIMITED`, `EMPTY_RESPONSE`, `SCHEMA_FAILURE`)
- Schema-retry count and eventual `SCHEMA_FAILURE` rate
- Tool error rate by tool and by denial code (`UNAUTHORIZED`, `POLICY_DENIED`, `NOT_FOUND`)
- Safety-review rejection rate and reasons (unsupported claim, missing citation, disclosure)

**Safety and policy (not on the demo charts, already in audit)**

- In-loop write attempts (should stay denied)
- Approval lag (requested → reviewed) and reject rate
- Post-approval execution mismatches (content-hash failures)
- Citation coverage: finish results with retrieved evidence vs uncertain overlay

**Quality over time**

- Eval pass rate and per-category rates after every prompt, policy, or model change
- Prohibited-action rate and unsupported-claim rate from the eval suite
- Drift: production mix vs eval mix (injection, insufficient evidence, tool failure)

**What not to log**

- Raw transcripts, names, dates of birth, medication lists, retrieved `relevantText`
- API keys, `DATABASE_URL`, authorization headers
- Full prompt messages or tool observations in metrics backends — keep those in the redacted event store with retention and access control

Rule of thumb: if a metric is useful without the chart, store the metric. If you need the chart, load it through the existing purpose-limited tools and redacted trace, not through the ops dashboard.
