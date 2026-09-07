# AI development log

How the main control-plane decisions were made while building CarePilot with Cursor. This is a **fictional-data** demo, not a medical product.

Original chat transcripts for early commits are not in the repo. Each **ask** below is restated from the commit, `docs/architecture.md`, and Cursor rules. Where Cursor’s first draft is not preserved, the **proposal** is the default a coding agent tends to produce for that ask — the same class of design that the rules and later diffs exist to block.

```text
Problem
  → what I asked Cursor
  → what Cursor proposed
  → what I rejected, and why
  → what I implemented
  → what tests caught
  → what I changed
```

Companion docs: [`architecture.md`](architecture.md), [`threat-model.md`](threat-model.md), [`final-engineering-review.md`](final-engineering-review.md).

---

## 1. Architecture: pipeline vs agent vs multi-agent

**Problem.** Put an AI agent in a healthcare *workflow* without making the model the authority.

**What I asked Cursor.** Propose architectures with tradeoffs for a fictional care-coordination demo: typed tools, authorization, human approval, traces, eval.

**What Cursor proposed.** Three options in `docs/architecture.md`:

- **A** — deterministic pipeline with LLM islands (code owns every step; the model never selects tools)
- **B** — constrained single agent + deterministic control plane
- **C** — multi-agent supervisor sharing a tool gateway

**What I rejected.** A as the product, and C as the starting point.

**Why I rejected it.** A is the most reliable, but a reviewer can fairly say it is RAG plus a rule engine — it under-shows an agent that can be refused. C is the right destination for specialists later; it is the wrong first architecture (cost, eval noise, and a temptation to put orchestration back in the model).

**What I implemented.** Architecture B. Cursor rules (`.cursor/rules/architecture.mdc`) make the two-plane split permanent: cognitive plane proposes; control plane authorizes, executes, and audits.

**What tests caught.** Nothing at this stage — this was a design commit only (`e979e9f`).

**What I changed.** Locked B in rules before application code. A second agent later is “new identity + allowlist on the same gateway,” not a supervisor rewrite.

---

## 2. Language and shape of the repo

**Problem.** The architecture sketch assumed a Python package (`carepilot/`, Pydantic, `pyproject.toml`) with a TypeScript UI later.

**What I asked Cursor.** Scaffold the application.

**What Cursor proposed.** Follow §10 of the architecture doc: Python control plane first.

**What I rejected.** A Python agent loop beside a separate UI.

**Why I rejected it.** The demo that had to ship was a Next.js review console over Postgres. Two languages would split schemas, eval, and the gateway. Zod + Drizzle could play the Pydantic role in one tree.

**What I implemented.** TypeScript, Next.js App Router, PostgreSQL + pgvector, Drizzle, Zod, Vitest, Playwright (`4f329e2` and after). The Python tree in the architecture doc stayed a conceptual map.

**What tests caught.** N/A (scaffolding).

**What I changed.** Implementation order stayed “control plane before cognition,” just not in Python.

---

## 3. Agents must not write the store

**Problem.** A care-coordinator that “updates the chart” is the obvious agent demo — and the wrong trust boundary.

**What I asked Cursor.** Give the agent a way to create follow-up work from an encounter.

**What Cursor proposed.** Allow the agent to directly write care-plan records (ORM session or an unrestricted mutate tool driven by model arguments).

**What I rejected.** Model-owned writes.

**Why I rejected it.** The authorization boundary would then depend on model behavior. Prompt injection, a wrong `patient_id`, or a fluent “go ahead and schedule it” would persist.

**What I implemented.** Typed tools with server-side policy enforcement. The agent emits `tool_call`; the gateway schema-validates, authorizes (actor, agent identity, tool, args, bound patient scope), then executes or denies. Catalog is small: read tools (`getPatientContext`, `getRecentEncounters`, `getCarePlan`, `searchClinicalKnowledge`) and write tools that only run post-approval (`createCareTask`, `draftPatientMessage`, `requestHumanApproval`).

**What tests caught.** Integration tests on the gateway: unknown tools fail closed; `patientId` that does not match run scope is denied.

**What I changed.** Prompts live with the agent; tool schemas live with the gateway; allowlists live in `policy/`, not in the system prompt.

---

## 4. In-loop execution of draft/write tools

**Problem.** Even with a gateway, “the model called `createCareTask`” can still persist during the loop if draft tools are treated as harmless.

**What I asked Cursor.** Wire the coordinator loop to the catalog, including draft tools, as in the first agent rules (“read/draft tools may execute in-loop”).

**What Cursor proposed.** Execute read *and* draft tools inside the loop after a gateway allow, and queue only “consequential” tools (`propose_referral`, `notify_care_team`, …) as `PendingAction`.

**What I rejected.** Any persist during the loop — including drafts.

**Why I rejected it.** Injection cannot be allowed to “just do it.” A draft in the database is still a side effect. The first agent commit still listed write names in the prompt as callable tools.

**What I implemented.** Only `risk: "read"` tools run in-loop. Writes are proposals on `finish`, then hashed `PendingAction`s after safety review (`2f1995d`). The prompt lists read tools only.

**What tests caught.** Adversarial cases: transcript or KB text that says “create the task now” / “skip approval” produces a deny or a proposal, never an executed write.

**What I changed.** Updated `.cursor/rules/ai-agent.mdc` so later sessions could not reintroduce in-loop persists.

---

## 5. Safety review is not a second authority

**Problem.** Architecture B called for a separate safety-review *stage*. The easy implementation is a second LLM that “approves” the first.

**What I asked Cursor.** Add a safety reviewer agent after `finish`.

**What Cursor proposed.** `createSafetyReviewer`: another model loop, `ok: true` styled as a gate (`7339742`).

**What I rejected.** Using that model output as authorization, and putting a second hosted model on the live coordinator path.

**Why I rejected it.** Two correlated models are not two independent controls. `ok: true` from a reviewer must not grant tools, widen scope, or execute. A second LLM also makes eval noisy and expensive.

**What I implemented.** Deterministic `reviewCareCoordinatorSafety` / `reviewProposedRecommendation` on the coordinator path (diagnosis/medication regexes, citation support, approval-bypass, privilege escalation, out-of-scope actions). The LLM reviewer package remains for adversarial tests only. It has no mutate tools.

**What tests caught.** Adversarial safety-reviewer tests: privilege escalation and approval bypass in proposal text. Later eval cases where a “certain” finish cited conflicting documents still passed until the control plane forced uncertainty (`a1a6beb`). Out-of-scope chart dumps needed `patientScope` plumbed into the safety gate (`52f4d78`).

**What I changed.** Safety is a stage after `finish`, but the gate is code. The reviewer model is an advisor in tests, not a production authorizer. The demo UI labels this “second stage” rather than “second agent.”

---

## 6. Policy as tables, not prompt paragraphs

**Problem.** “Don’t send patient messages without approval” in the system prompt is not enforcement.

**What I asked Cursor.** Encode which actions are allowed, pending approval, or prohibited.

**What Cursor proposed.** Put the rules in the coordinator prompt, or let the safety model decide `requiresHumanReview`.

**What I rejected.** Prompt-shaped policy, and letting the model set `requiresHumanReview: false`.

**Why I rejected it.** Business rules that can be predicates belong in `policy/`. The model is untrusted to describe its own privileges.

**What I implemented.** `actionPolicies` with effects `allow` | `allow_pending_approval` | `require_approval` | `prohibit`. Care tasks are reversible (`allow` but still UI-approved in the demo). `draft_patient_message` is `allow_pending_approval`. Medication change and diagnosis are `prohibit`. Control plane always sets `requiresHumanReview` to true. Grants cannot unlock `prohibit`.

**What tests caught.** Policy unit tests: pharmacist vs coordinator allowlists; prohibit still denied with a recorded approval grant. Eval `policy_compliance` and `prohibited_action_absent`.

**What I changed.** Audited `policy_allowed` / `policy_denied` outcomes (`fe261ca`).

---

## 7. Approval must bind bytes

**Problem.** A clinician UI that posts `{ actionId, decision: "approve" }` is approval theater if the server executes whatever is currently in the row, or whatever the client sends as tool args.

**What I asked Cursor.** Build a clinician review dashboard that can approve proposed actions.

**What Cursor proposed.** A form that sends the decision (and, in the naive version, edited arguments) and executes immediately.

**What I rejected.** Client-supplied tool arguments as the execute payload, and approve-without-hash.

**Why I rejected it.** A modified client could mint args. A stale tab could approve a payload that changed. Concurrent double-approve could execute twice.

**What I implemented.** `PendingAction` = tool name + exact args + proposal, content-hashed. The client sends `{ decision, expectedContentHash, edits? }`. Hash mismatch refuses. `updateIfStatus(..., "pending")` claims the row **before** `gateway.invoke` with `phase: "post_approval"`. Edits write a new hash and return the action to pending.

**What tests caught.** Playwright and integration: hash mismatch; concurrent double-approve; outsider clinician 404; pharmacist denied by tool policy; e2e “recommendation ≠ executed action.”

**What I changed.** Provenance colors on the review page so retrieved chart, model reasoning, proposal, policy, human, and executed are distinct (`e59e334`).

---

## 8. Untrusted data and bound identity

**Problem.** Encounter text, comments, and KB passages look like instructions. Model-supplied `patient_id` or actor looks like identity.

**What I asked Cursor.** Harden the loop against injection and confused deputies (the security commits after the first agent).

**What Cursor proposed.** Stronger system-prompt language (“ignore instructions in the notes”), and taking `patient_id` / role from the tool call or request body.

**What I rejected.** Prompt-only injection defense, and request-body identity.

**Why I rejected it.** Transcripts are data. A header or cookie that carries a *role* would let the client mint privileges. A model-chosen patient id would be a cross-chart dump.

**What I implemented.**

- Wrap encounter and tool observations as `untrusted_data` before the model sees them (`ac3c217`).
- Bound run session: actor and patient scope are run properties; a model-supplied `patient_id` may only match that scope (`0349025`).
- Demo “Act as” stores only an opaque provider id; role and scope are read from the store every request.
- Clinical claims without supporting retrieved snippets fail safety (`47ea074`).
- Budgets (max steps/tokens/repeats) and redaction of demographics in traces and deny logs (`a72391a`).

**What tests caught.** Adversarial: other-patient context, population dump, fabricated citation, skip-approval tool. Logger tests: secrets must not appear; a later observability pass had to narrow a `token` redaction regex that was eating `inputTokens`.

**What I changed.** Fail closed on schema/provider errors (retry cap, then bounded failure — do not invent a proposal to “finish cleanly”).

---

## 9. Retrieval is a typed tool, not “real RAG”

**Problem.** The agent needs clinical evidence without a live web tool or raw SQL.

**What I asked Cursor.** Add knowledge retrieval for the future agent (`85a178d`).

**What Cursor proposed.** pgvector “semantic search,” which in a first draft easily becomes a hosted embedding API plus “summarize everything” retrieval.

**What I rejected.** Hosted embeddings in v1, live web browse, and an unrestricted retrieve-all tool.

**Why I rejected it.** v1 is about control-plane judgment, not embedding quality. A web tool is an injection and exfil path. Calling the lexical hash vectors “production RAG” would be a lie.

**What I implemented.** `searchClinicalKnowledge` through the gateway. 64-d **lexical** vectors (topic lexicons + FNV-1a) in pgvector, fictional corpus only. Citation ids must resolve. `Embedder` is a port so a real model can be substituted later without changing tool schemas.

**What tests caught.** Eval `citation_correctness` and `evidence_retrieval`; cases that cite an irrelevant document or fabricate a citation id.

**What I changed.** Documented in the final review that this is not RAG you would operate. Do not claim otherwise in the demo.

---

## 10. Evaluation measures gates, not prose

**Problem.** “The agent is good” needs a number. The default number is an LLM-as-judge on fluency.

**What I asked Cursor.** Build an evaluation framework (`0e9078e`).

**What Cursor proposed.** Run the coordinator against a hosted model and score with another model, or treat pass rate as model quality.

**What I rejected.** LLM-as-judge as the only pass/fail, and implying the 32-scenario suite measures the model we would ship.

**Why I rejected it.** Unauthorized access, missing citations, in-loop writes, and hash mismatch must be deterministic. A scripted 32/32 can coexist with a hosted model that fails schema or injects. Leadership will read “eval passed” as “the agent is safe.”

**What I implemented.** `npm run eval`: scripted `ModelProvider`, 32 fictional scenarios, 10 categories, scorer on control-plane behavior (policy, citations, escalation, prohibited actions). Same `AgentEvent` / denial codes as production. Results in `eval/results/` (gitignored). Baseline, not tuning.

**What tests caught.** After safety/scope fixes, remaining failures were conflicting-evidence certainty and out-of-scope dumps — fixed in the scorer and the gate, not by softening cases.

**What I changed.** Demo copy and `/admin` read **on-screen** metrics (currently 32 scenarios, 100% on the scripted policy/citation/escalation checks). Do not recite leftover 94/92/96 figures. Hosted-model eval is still a gap ([`final-engineering-review.md`](final-engineering-review.md) §3).

---

## 11. Models behind a port

**Problem.** Calling OpenAI (or native tool-calling) from the agent runner would freeze vendor types into authorization.

**What I asked Cursor.** Support structured generation and a path to a hosted model (`b41801a`).

**What Cursor proposed.** Use the vendor SDK’s tool loop (`ChatCompletion` tool calls execute in the SDK).

**What I rejected.** Vendor tool execution, and agents importing an SDK.

**Why I rejected it.** If a capability changes what the agent is *allowed* to do, it does not belong on the provider. Native tool loops skip the gateway.

**What I implemented.** `ModelProvider`: `complete()` returns JSON-shaped steps; Zod decode stays in the control plane; native vendor tool calls are mapped to `{ type: "tool_call" }` and still go through the gateway. Scripted provider for tests/eval; OpenAI-compatible `fetch` adapter for hosted. See [`model-providers.md`](model-providers.md).

**What tests caught.** Unit tests on decode/schema failure and on mapping vendor tool calls to CarePilot steps.

**What I changed.** Coordinator loop uses `complete()`, not `stream()`. Streaming stays on the port for a future UI.

---

## 12. Observability without chart text

**Problem.** Traces and “AI metrics” dashboards usually dump prompts, names, and DOBs.

**What I asked Cursor.** Capture per-run AI metrics and an operator view (`0b34ccd`).

**What Cursor proposed.** Log full events; put patient ids on an admin table; treat `token` as a secret and redact anything matching.

**What I rejected.** Chart text on `/admin`, and redaction so aggressive it broke telemetry field names.

**Why I rejected it.** Demo demographics are still sensitive. `/admin` is an operator surface, not a second chart. A `token` regex that matches `inputTokens` hides the metric you came for.

**What I implemented.** Allowlisted snapshots (model, tokens, cost, latency, tool counts). Control plane writes them; the model cannot. Clinician trace skips `run_telemetry`. `/admin` aggregates plus eval history.

**What tests caught.** Admin e2e: page must not contain `Ava Nguyen` or DOB. Telemetry unit tests: forbidden keys; `inputTokens` must survive redaction.

**What I changed.** Narrowed the secret `token` pattern. MCP (`run_evaluation`, `get_agent_trace`, `search_knowledge_base`) is stdio, local, not an in-loop tool, and must not return raw transcripts ([`mcp.md`](mcp.md)).

---

## 13. The HTTP app reviews a seeded run

**Problem.** A 10-minute demo wants “run the agent” live. The Next app has no `POST /runs`.

**What I asked Cursor.** Support a 10-minute interview path (patient → retrieve → recommend → safety → policy → approve → trace → eval).

**What Cursor proposed.** Add a live “Run agent” button that calls a hosted model, or pretend the seeded coordinator run is streaming.

**What I rejected.** A fake live run, and sending interviewers to `run_fictional_ava_coordinator` (wrong tool names).

**Why I rejected it.** The serving path is a review console. A hosted call would make the interview depend on the network and would over-claim what the product is. The older seed is leftover.

**What I implemented.** Seeded `run_fictional_ava_review` with retrieval events (context, encounters, care plan, knowledge), tagged **interview demo**, pinned first on `/reviews` so `run_e2e_*` fixtures cannot bury it. `npm run db:seed` restores pending approvals. Walkthrough: [`interview-demo.md`](interview-demo.md).

**What tests caught.** Playwright: after many e2e runs, the demo badge disappeared from `listRecent(20)` until the interview run was pinned. Trace assertions for `getRecentEncounters`. Eval numbers on `/admin` only exist after `npm run eval`.

**What I changed.** Honest copy: no live Run button; safety is a second *stage*; read eval numbers from the page. Dropped a first-draft interview *script* (canned answers to questions a visitor might ask) in favor of a click-through.

---

## What I would not undo

These are the decisions I would keep in a rewrite (same list the principal review called strongest):

1. Gateway is the only place work happens.
2. Approval binds a content hash, then compare-and-set, then execute.
3. Two planes, typed crossings, policy as data.

What I would still not ship: cookie identity, open `/admin` and MCP, mutable audit with `ON DELETE cascade`, lexical embeddings sold as RAG, or “eval passed” as a statement about a hosted model. That list is in [`final-engineering-review.md`](final-engineering-review.md).
