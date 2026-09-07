# Comparison: CarePilot Engine vs this repository

**Date:** 7 September 2026  
**Scope:** Two sibling trees under `Development/`:

| Name in this doc | Folder | What it actually is |
|---|---|---|
| **Engine** | `healthcare-ai-workflow-engine` | Fastify workflow API + staff UI. Live **Analyze encounter**. In-memory coordination store. Deterministic TypeScript proposers behind an `AgentModel` port. |
| **Console** (this repo) | `healthcare-ai-workflow-engine-v2` | Next.js clinician **review console** over **seeded** Postgres runs. Structured LLM loop (`think` / `tool_call` / `finish`) behind `ModelProvider`. No `POST /runs`. |

Both are fictional-data demos, not medical products. Neither is production-ready. This note compares design, implementation, how each was built with Cursor, and which tree I would keep if the goal were a production system.

Engine’s own eval table uses “v1 / v2” for a **naive baseline vs current workflow**. That is unrelated to the folder suffix `-v2`. Those labels are not used below.

---

## Snapshot

| Dimension | Engine | Console (this repo) |
|---|---|---|
| Serving path | `POST /api/patients/:id/advise` runs coordinator → safety reviewer → policy pack → hold or task | Lists seeded runs. Approval is the only consequential HTTP POST. |
| Identity | Bearer `CAREPILOT_API_TOKEN` fail-closed if unset. Role from a staff directory, not `X-Actor-Role`. Patient panels. | Cookie / header provider id. Role and scope from the store (good) but anyone who knows `provider_fictional_blake` is Blake. `/admin` open. |
| Persistence | In-memory `CoordinationStore`. Optional pgvector replica for knowledge. Process restart loses runs. | Drizzle + Postgres for patients, runs, events, approvals, audit. Durable demo chart (a second chart). |
| Agent | Observe–decide–act loop. Default models are **deterministic TypeScript**, not a vendor LLM. Same loop a hosted `AgentModel` would use. | Constrained LLM loop with Zod decode, budgets, retries. Scripted provider in eval; OpenAI-compatible adapter exists and is unused on the HTTP path. |
| Safety | Second **workflow step** with different tools (`getKnowledgeChunk` only). One revision via a separate `reviewerFeedback` field. | Deterministic predicates after `finish`. LLM reviewer package exists in tests only and cannot authorize. |
| Authorization | Per-tool authz (role + patient + run + allowlist). Writes deny-by-default on advise. | Gateway: schema → actor + **agent identity** + tool + args + **bound patient scope** + **phase** (`in_loop` vs `post_approval`). |
| Approval | CAS pending → then draft/task. Failed write reverts to pending. Send disabled. | Content hash of exact `PendingAction`. Client sends `expectedContentHash`. Hash mismatch refuses. Concurrent double-approve tested. |
| Policy | Versioned pack (`anchor-pack-v1`): prohibit / require approval / allow. Classifier on action types + agent summary, not retrieved excerpts. | `actionPolicies` table: `allow` / `allow_pending_approval` / `require_approval` / `prohibit`. Grants cannot unlock prohibit. |
| Retrieval | Local hashed n-grams, cosine **floor 0.27**, lexical rerank, chunks marked untrusted. Empty hits → stop. | 64-d lexical + pgvector, citation id must resolve, token-overlap “support.” No similarity floor. |
| Eval | 50 gold cases through the **real workflow**. Scores vs a naive baseline. Citation = gold playbook slugs (README **38%**, not 100%). | 32 scripted-model scenarios. Control-plane gates currently **32/32**. Does not measure a hosted model. CLI exits 0 unless scenario count is 0. |
| UI | Live demo: Sarah Chen cough / lisinopril. Composer, policy rail, Send blocked. Review queue, Operations, hashed Agent Trace. | Provenance-colored review of a completed seed. Interview path is tagged `run_fictional_ava_review`. |
| Tests | ~30 Vitest files (HTTP identity, panels, CAS, adversarial, eval). No Playwright, no CI. | Unit + integration (Postgres) + adversarial + Playwright e2e + concurrency. No CI. |
| Docs | 18 ADRs, architecture, threat model, evals, agent-design, development log with preserved prompts. | Architecture B tradeoff, threat model, final engineering review, observability/MCP/providers, reconstructed development log. Architecture header still says “no application code.” |

---

## What each does well

### Engine

- **It is a workflow, not a slideshow.** Staff click Analyze and the same coordinator / reviewer / pack path that eval uses actually runs. `waiting_human` is a real run status, not a seeded badge.
- **Identity fails closed.** Unset token → API refuse. Spoofed `X-Actor-Role` → 403. Panels: Bob cannot open Alice-only patients. That is the smallest honest step before OIDC.
- **Domain first.** Patient, Encounter, Task, AgentRun, Approval status machines exist without a model. The EHR is declared *not* the system of record here — coordination records and pointers only.
- **Two agents with different jobs and tools**, as a fixed workflow, not a swarm. Reviewer cannot re-read the chart. Failed review retries on `reviewerFeedback`, never concatenated into `userRequest` (ADR 0018) — that is the first landmine when a vendor model is swapped in.
- **Eval can go down.** Citation accuracy is gold-slug coverage. They rejected “citation id exists in the index” when it printed 100%. 38% is an operational signal, not theater.
- **Operations metrics have denominators** (human-gate rate, citation, unsupported recommendations) on a live `/api/observability` surface.
- **Hashed public traces.** Staff HTTP cannot append events or force `succeeded`.
- **Written ADRs as the unit of change.** Eighteen accepted decisions, linked from architecture.md. A second engineer can see *why* Send is disabled.

### Console (this repo)

- **The control plane around an LLM is more complete.** `ModelProvider` keeps vendor SDKs out of agents. Native vendor tool calls are mapped to `{ type: "tool_call" }` and still hit the gateway. Schema failure retries then fail closed. Token/cost/latency caps are real.
- **Gateway binds scope and phase.** In-loop writes are a risk class, not a prompt. `patientId` in args may only match the run. Post-approval execute is a different phase. Agent identity cannot expand its allowlist.
- **Approval binds bytes.** Hash + compare-and-set + gateway execute is stricter than Engine’s CAS-then-apply on an in-memory row. Concurrent approve is tested against Postgres.
- **Untrusted data is typed.** Encounter and tool observations are `untrusted_data` envelopes, not concatenated policy.
- **Durable store for the whole demo domain.** Runs, events, pending actions, and audit survive process restart. Integration tests hit real Postgres.
- **Review UX is explicit about provenance.** Retrieved vs reasoning vs proposal vs policy vs human vs executed, plus “recommendation ≠ executed action.” That teaching surface is stronger than Engine’s static `public/` pages.
- **Playwright** covers approval, trace redaction, and the interview path. Engine has no browser suite.
- **Two-plane package layout** (`agents/` vs `policy/` / `tools/gateway.ts` / `approval/`) matches the architecture it claims.

---

## What each does poorly

### Engine

- **The store is RAM.** Production durability, multi-instance, and incident replay are not there. pgvector is optional and knowledge-only. Approval CAS is the single-process stand-in for a `pending`-only SQL predicate.
- **There is no vendor (or even scripted LLM) on the loop.** `DeterministicCoordinationModel` is a small policy. The `AgentModel` port is the right seam; it is unproven against schema drift, tool-call spam, and fluent injection. Swapping in OpenAI tomorrow would be the first time the decode/retry path meets a real model.
- **Shared bearer token is not authentication.** One env secret for all staff. Actor is still a header (`X-Actor-Id`) after the token. Not OIDC, not per-user credentials, cookie-less but also not session-bound.
- **UI is a thin static app** (`public/index.html` + `app.js`). Fine for Sarah’s letter; not an accessible product shell.
- **Citation 38%** means the lexical index often misses gold playbooks. They were honest; retrieval is still not something a clinical safety officer would defend.
- **Heuristic “cost”** on Operations is chars÷4, not an invoice — documented, easy to misread.
- **No CI, no Playwright.**

### Console (this repo)

- **The HTTP app does not run agents.** The interesting loop is eval and tests. Production readiness is about the system clinicians hit; today that is a review console over fixtures. See [`final-engineering-review.md`](final-engineering-review.md) §§1–2.
- **Cookie identity and open ops.** Forgeable clinician cookie, unscoped `/admin`, local MCP with traces. Downstream gates assume the actor string is true.
- **Eval measures the fake.** 32/32 against a scripted finish function does not constrain a hosted model. Process exit ignores failed scenarios. In-memory tools in eval vs Postgres in the app is an eval/prod split.
- **This database is a second chart** (demographics, meds, transcripts). Engine explicitly refused that. Console’s demo is richer and the wrong data-ownership story for production.
- **Audit is append-only by convention.** `ON DELETE cascade` from `agent_runs` can erase evidence.
- **Architecture doc drift.** Header still says design proposal / no application code; live safety is deterministic, not the LLM reviewer the golden path describes.
- **Lexical RAG without Engine’s later lessons.** No cosine floor, no untrusted-chunk flag on the tool, citation support is token overlap. Console did not pay down the “neighborhood citations” problem Engine hit in ADR 0010 / evidence cap.
- **Interview path is a seed.** Honest, but you cannot put this behind an API gateway and call it CarePilot.

---

## How they were built (methodology)

The interesting difference is not TypeScript vs TypeScript. It is **when** the model appears and **what Cursor is allowed to be**.

### Engine — policy first, model last, ADRs as work items

1. Architecture, agent-design, threat model, and eval strategy existed when the tree still had **no application code** (`docs/proposed-architecture.md`).
2. First vertical slice was **Alt A: durable domain + HTTP**, no model (ADR 0001). Chat-as-state and LangChain-on-day-one were rejected.
3. Each increment is an **ADR + tests + a Cursor prompt that states rejections up front** (no store handle, no vendor embedder, no Send, no OIDC costume). The development log quotes those prompts.
4. Cursor is treated as a **fast implementer behind a written policy**, not the architect. When code violated its own ADR (reviewer text folded into `userRequest`), they aligned code to the ADR rather than the convenience.
5. Eval is part of the product: fifty fixtures, naive baseline, **scores that are allowed to drop**. They regenerated the README from `npm run eval` instead of protecting 100%.
6. After a senior-style review they **ranked sixteen follow-ups and explicitly did not ask Cursor** to enable Send, call a hosted LLM, or grind ops cost. Scope was “control-plane gaps a reviewer would probe in ten minutes.”

This is closer to how a regulated team should use coding agents: specifications and fail-closed tests first, generation inside the fence.

### Console — architecture options, then agent-shaped vertical, then harden

1. Cursor proposed **three architectures (A pipeline / B constrained agent / C multi-agent)**. B was chosen so the demo *looks like* an agent (tool choice, refusal, trace) rather than “RAG plus a rule engine.” That is a different brief than Engine’s “durable workflow even if the model never runs.”
2. Standing **Cursor rules** (architecture / security / agents / testing) substitute for Engine’s ADR cadence. Decisions were committed as features, then reconstructed in `docs/ai-development-log.md` because early chats were not kept.
3. Implementation order was control plane-ish (domain, tools, pgvector) then coordinator, then a **series of security commits** (no in-loop writes, citations, untrusted wrapping, bound session, budgets). The first agent rules allowed in-loop *draft* tools; a later commit took that back. Engine forbade advise-path writes from ADR 0002.
4. A **safety-reviewer agent** was added, then correctly **not** used as authorization on the live path. Engine designed the second agent as a workflow step from the start (ADR 0005) and still refused reviewer-as-IAM (ADR 0006).
5. Product UI optimized for **explaining a completed run** (provenance, hash, interview script). Engine optimized for **doing a run**.
6. Eval was built as a **scripted ModelProvider harness** — the right unit for gateway/policy invariants, the wrong unit for “the agent is safe” if leadership reads 32/32 as model quality. Engine’s 38% citation number fights that misread.

Console learned the LLM-shaped control plane faster. Engine learned product and governance faster.

---

## Recommendation: which to continue for production

**Continue Engine (`healthcare-ai-workflow-engine`) as the application.** Port Console’s control-plane primitives into it. Do not try to grow this repo’s review console into a care-coordination service.

### Why Engine is the better trunk

Production is the system a clinician hits on a live encounter, with identity, durable workflow state, and a gate that can hold work. Engine already has that shape:

- authenticated (if crude) API
- `advise` that creates an `AgentRun` and runs the pipeline
- `waiting_human` / inbox / CAS gate / Send disabled on purpose
- patient panels
- a two-step workflow whose `AgentModel` seam is where a hosted model belongs
- eval on **that** pipeline with gold evidence, including a baseline that is supposed to fail

Console’s strongest pieces (gateway phase, hash-bound `PendingAction`, `ModelProvider`, untrusted envelopes, Postgres) are **libraries waiting for a product**. The product hole — start-run, authn, worker, durable workflow — is Engine’s existing outline. Filling Engine’s store and model port is less work and less conceptual churn than turning a seeded Next.js reviewer into an orchestrator.

Console’s Architecture B was the right demo to show “the model chose a tool and was refused.” It is the wrong production skeleton: the HTTP app never became the loop, the database became a second chart, and eval cannot fail the build.

### What to steal from this repository on day one of the merge

1. **Postgres + Drizzle (or equivalent) for AgentRun, events, approvals, audit** — replace Engine’s `InMemoryStore`. Keep Engine’s “not a second EHR” rule: store workflow artifacts and pointers, not a full chart.
2. **`ModelProvider` / OpenAI-compatible adapter** — implement Engine’s `AgentModel` with Console’s decode, timeouts, and usage metadata. Keep Engine’s deterministic proposers as the CI gate.
3. **Content-hashed pending actions** — Engine CAS is necessary but not sufficient once a clinician UI can edit a draft; bind the reviewed bytes.
4. **Gateway `phase` + bound patient scope** — in-loop vs post-approval as code, not allowlist comments.
5. **`untrusted_data` wrapping and separate reviewerFeedback** — Engine already split reviewer text; Console’s envelopes are the typed version.
6. **Playwright + provenance review UI** — keep Engine’s live Analyze; add Console’s “not executed” treatment on the inbox card.
7. **Scripted eval as a merge gate** (must stay green on denials and in-loop writes) **plus** Engine’s 50-case gold-slug pack against the hosted model on a nightly.

### What not to copy

- Cookie “Act as Blake” as production identity.
- Open `/admin` and MCP without an operator role.
- Existence-only citation scoring.
- Cascade-delete audit.
- Pretending lexical hash vectors are operated RAG.
- A live Send button.

### If the goal were only an interview demo of “an LLM agent”

Console is the better ten-minute story today (provenance, hash, seeded Ava run, 32 scripted scenarios). That is a presentation choice, not a production one. Engine’s Sarah Chen path is the better story of a **system**.

---

## Bottom line

Both repos refuse the same bad demos: model as orchestrator, in-loop EHR writes, prompt-as-policy. Engine refused them **before** writing an agent and built a live workflow. Console refused them **inside** an LLM loop and built a better fence, then never put that loop on the serving path.

For a production care-coordination system I would keep Engine as the application, give it Console’s durability and model port, and treat this `-v2` tree as a reference implementation of the gateway and approval hash — not as the codebase to ship.
