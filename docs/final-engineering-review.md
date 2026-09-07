# CarePilot — final engineering review

**Role:** Principal engineer, production-readiness review  
**Date:** 7 September 2026  
**Verdict:** **Not production-ready.** This is an unusually disciplined **architecture demonstration**. The control-plane ideas are the right ones. The running application is a review console over seeded fictional data, with an in-memory eval harness and a scripted model. Shipping it as a care-coordination service would be a category error.

CarePilot is **fictional data only** and **not a medical product**. This review still treats the design as if it were asked to hold real charts, because that is the only way the security and evaluation claims can be judged.

No code was changed for this document.

---

## Scorecard

Ratings are relative to a production healthcare-adjacent agent, not relative to a weekend demo.

| Area | Rating | One-line read |
|---|---|---|
| Architecture | Strong (design) / Incomplete (product) | Two-plane split is correct; the HTTP app does not run agents. |
| Security | Fail for production | Cookie identity, open `/admin` and MCP, mutable audit. |
| AI agent design | Strong for a constrained loop | Typed steps, budgets, fail-closed. Scripted in eval. |
| Tool design | Strong | Small catalog, Zod I/O, gateway-only execute. |
| Authorization | Strong core, weak edge | Bound scope and allowlists work; demo auth does not. |
| Policy enforcement | Strong | Tables, not prompts. Grants cannot unlock `prohibit`. |
| Prompt injection resistance | Strong on execution, weak on persuasion | Writes cannot run in-loop; finish text can still steer a human. |
| RAG quality | Not production | 64-d lexical hash vectors; citation “support” is token overlap. |
| Evaluation methodology | Strong harness, wrong model | 32 cases, 10 categories, deterministic scorer — all against a fake. |
| Observability | Adequate demo | Allowlisted per-run metrics; no metrics backend, no SLO burn. |
| Testing | Strong for the control plane | Unit, integration, adversarial, e2e, concurrency. No CI. |
| Reliability | Partial | Timeouts and budgets exist; limiter is process-local; no workers. |
| Failure handling | Strong in the loop | Schema/provider retries then fail-closed; CAS on approval. |
| Cost | Bounded in demo, unproven in prod | Caps exist; hosted provider is not the eval path. |
| Latency | Acceptable for sequential loop | Hard timeouts; no streaming in the loop; p95 is run duration. |
| Database design | Fine for a demo store | Cascading audit delete, no vector index, `agent_name` as text. |
| API design | Narrow and careful | One consequential POST, well-shaped errors. No run-create API. |
| Frontend | Good review UX, not a product | Provenance and hash-bound decisions. No start-run flow. |
| Developer experience | Good locally | `npm` scripts, Docker Postgres, MCP. Architecture doc is stale. |
| Documentation | Strong intent, some drift | Architecture, threat model, providers, observability, MCP. Header of `architecture.md` still says no application code. |

---

## The 10 most important weaknesses

Severity: **Critical** (cannot ship) · **High** (ship-blocker for this domain) · **Medium** (must have a dated plan).

### 1. There is no authentic identity — and ops surfaces are wide open

**Issue.** Clinician identity is an unguessable-in-theory, forgeable-in-practice cookie (`carepilot_clinician`) or header (`x-carepilot-clinician`). Role and patient scope are correctly read from the store, not from the client body — but anyone who can name a provider id *is* that clinician. `/admin` has no operator role. The MCP server (`run_evaluation`, `get_agent_trace`, `search_knowledge_base`) is a local stdio process with no authz. The session cookie is `HttpOnly; SameSite=Lax` and not `Secure`.

**Why it matters.** Every downstream control (scope checks, approval hash, policy tables) assumes the actor string is true. In production that assumption is authentication. An open admin page and an MCP trace tool are the same class of defect: an unscoped read of operational and run data.

**Severity:** **Critical**

**Solution.** Replace the cookie with a real IdP. Bind session to a server-side subject. Put `/admin` and MCP behind an operator role distinct from care-team roles. `Secure; HttpOnly; SameSite=Strict` (or CSRF tokens) on any cookie. Random, non-mnemonic run ids.

**Tradeoff.** Demo friction: reviewers can no longer “Act as Blake” from a dropdown. You will need a seeded IdP or a documented mock SSO for local and CI. That is cheaper than explaining a PHI dump from `/admin`.

---

### 2. The product cannot start an agent run

**Issue.** `createCareCoordinatorRunner` is used by the eval harness and tests. The Next.js app has no route that creates a bound session, starts a run, or persists a live coordinator result. `/reviews` lists seeded runs. The interesting loop — model → gateway → safety → pending actions — is not on the serving path.

**Why it matters.** Production readiness is about the system patients and clinicians would hit. Today that system is a **review console**. The control plane is proven in-process, not as a service (queue, idempotent start, authn, retries, multi-instance). You cannot put this behind an API gateway and call it CarePilot.

**Severity:** **Critical** (as a product) / expected (as a demo)

**Solution.** Add an authenticated `POST /runs` (or worker consumer) that: binds scope from the session, creates `agent_runs`, runs the coordinator against a hosted `ModelProvider`, persists events, materializes hashed `PendingAction`s. Put the runner on a worker, not in the Next request thread.

**Tradeoff.** You take on queueing, occupancy, and a hosted-model bill. The demo stays cheap if you keep “review seeded runs” as the UI default and gate live runs behind a flag.

---

### 3. Evaluation does not measure the model you would ship

**Issue.** `npm run eval` drives a **scripted** `ModelProvider` with a per-scenario finish function. The scorer then asserts control-plane behavior (denials, citations, no in-loop writes). That is the right unit for *gates*. It is the wrong unit for *model quality*. The CLI exits 0 unless `scenarioCount === 0`, so a 0% pass rate is still a green process. There is no CI workflow to run eval on PR.

**Why it matters.** A 32/32 scripted score can coexist with a hosted model that injects, over-calls tools, or fails schema 40% of the time. Leadership will read “eval passed” as “the agent is safe.” It is not. Also: eval uses an in-memory tool store; production uses Postgres. That is a classic eval/prod split.

**Severity:** **High**

**Solution.** Keep the scripted suite as a **gate** (must stay 32/32 on control-plane invariants). Add a hosted-model nightly with the same scenarios, same scorer, fail CI on pass-rate or prohibited-action regressions. Make `npm run eval` exit non-zero when `passRate < 1` for the gate suite (or a configured threshold for the hosted suite). Wire GitHub Actions: unit → integration → eval gate.

**Tradeoff.** Nightlies cost money and flake. Do not let hosted-model flake block merge of a policy fix; keep two jobs. Determinism of the gate suite is the asset — do not “improve” it by calling GPT in PR CI.

---

### 4. Retrieval is not RAG you can operate

**Issue.** Embeddings are 64-dimensional **lexical** vectors (topic lexicons + FNV-1a bag-of-words), stored in pgvector, queried with cosine similarity and **no ANN index**. Citation support is `snippetSupportsClaim`: ≥2 overlapping tokens. Knowledge search in eval rebuilds the corpus in memory; production search hits Postgres. Chunking is naive. There is no hybrid BM25, no rerank, no document-level ACL beyond “the whole demo corpus.”

**Why it matters.** Wrong neighbors → wrong citations → a fluent, “cited” recommendation. Token overlap will accept a poisoned chunk that shares “diabetes” and “follow-up.” Indirect prompt injection rides this path. At any real corpus size, a sequential 64-d scan is the least of your problems; the representation will not generalize.

**Severity:** **High** (for any claim of clinical-knowledge retrieval)

**Solution.** Swap the `Embedder` port to a real embedding model (or on-box equivalent) without changing tool schemas. Add hybrid retrieval + rerank. Store model id + embedding version on chunks. Tighten citation support (entailment or at least passage-level overlap with negation). Add an HNSW index when N warrants it. Version the corpus and sign it.

**Tradeoff.** Cost, latency, and a new eval slice (retrieval quality vs control-plane quality). The `Embedder` port already exists so this is a substitution, not a rewrite — that is the good news.

---

### 5. Prompt injection cannot execute writes — it can still win the reviewer

**Issue.** The architecture gets the hard part right: transcripts and KB are wrapped as `untrusted_data`; in-loop `risk !== "read"` is `POLICY_DENIED`; `patientId` cannot widen scope. Residual attack: a poisoned snippet or transcript steers `finish` (summary, proposedActions, citations that lexically “support” the claim). Safety checks are **regexes** (`DIAGNOSIS_CLAIM`, medication-change, approval-bypass). The LLM safety-reviewer package is **not on the coordinator serving path**; `reviewCareCoordinatorSafety` is deterministic only.

**Why it matters.** The product’s last gate is a human looking at fluent text with citation ids. Injection that cannot `just do it` can still `just get approved`. Regexes fail closed on phrasing they know and fail open on everything else.

**Solution.** Keep the execution invariant forever. In the UI, visually mark retrieved vs inferred vs proposal (already started) and highlight instruction-like retrieved text. Add a chunk classifier for “this passage is an instruction.” Put a **deterministic** safety stage in front of pending-action materialization (already there) and treat any LLM reviewer as advisory only (already documented — wire it or delete it from the architecture story). Expand eval `prompt_injection` to score **whether the proposal followed the injected ask**, not only whether a write executed.

**Tradeoff.** More false uncertainty (over-refusal). That is the correct bias for this domain. An LLM-as-judge safety reviewer will correlate with the coordinator model; do not let it grant privileges.

---

### 6. The audit log is not an audit log

**Issue.** `audit_events` are append-only **by convention**. The table has a normal primary key, a repository `create`, and `ON DELETE cascade` from `agent_runs`. There is no row-level immutability, no hash chain, no separate retention, no “deny delete” role. Agent events that actually contain tool args (including `patientId`) live in the same lifecycle.

**Why it matters.** The architecture’s integrity story is “the model cannot write the audit log.” True. A DBA, a `DELETE FROM agent_runs`, a buggy admin tool, or a restoration from a writable replica can still rewrite history. In a real incident, cascade-deleting the run **erases the evidence**.

**Solution.** Move audit to an append-only store (or Postgres with REVOKE UPDATE/DELETE, a trigger, and a hash chain). Decouple retention from run deletion. Redact `input` at write time more aggressively. Export to an external SIEM.

**Tradeoff.** Operational complexity and storage cost. Demo seed/reset becomes harder. For a teaching repo you can keep cascade; for production you cannot.

---

### 7. No CI, and the eval gate cannot fail the build

**Issue.** There is no `.github/workflows` (or equivalent). `package.json` has the right scripts (`typecheck`, `lint`, `test`, `test:integration`, `test:e2e`, `eval`) but nothing enforces them. Eval’s process exit ignores failed scenarios.

**Why it matters.** Production readiness is a **process**. A control plane this careful will rot the first time someone merges a gateway change on a Friday without eval. The testing.mdc rule (“a behavior change without a case is incomplete”) is unenforced.

**Solution.** PR CI: typecheck + lint + unit + adversarial. Nightly: integration + e2e + eval gate. Fail eval on `passedCount !== scenarioCount` for the scripted suite. Require coverage of new policy/tool paths.

**Tradeoff.** CI minutes and a Playwright browser install in CI (already a local pain). Worth it. Keep integration tests off the default PR path if Postgres-in-CI is flaky, but then you must have a scheduled job.

---

### 8. The hosted model path would export chart text with almost no production wiring

**Issue.** `createOpenAiCompatibleProvider` sends messages (including tool observations) to `baseUrl` with a bearer key. `src/lib/env.ts` knows `DATABASE_URL` and `LOG_LEVEL` only. `.env.example` has no model key, no allowlisted base URL, no timeout/retry at the HTTP layer beyond the runner’s `withTimeout`. There is no TLS pin, no output filter before the vendor, no DPA/BAA story (correctly out of scope for fiction — still a ship blocker if anyone points this at real notes).

**Why it matters.** The day someone sets `kind: "openai_compatible"` in a composition root, encounter text and KB snippets leave the trust boundary. The threat model already ranks this residual **high**. The factory exists; the production controls do not.

**Solution.** Env schema: `MODEL_KIND`, `MODEL_BASE_URL` allowlist, `MODEL_API_KEY`. Default `scripted` in non-prod. Strip or hash chart fields in the adapter if you ever leave fiction. Log destination host, never the key. Separate “demo hosted” from “production hosted.”

**Tradeoff.** Less “just paste an OpenAI key.” That is the point. Portability of `ModelProvider` remains; configuration becomes explicit.

---

### 9. Reliability is single-process

**Issue.** `createRunRateLimiter` is an in-memory map. Next.js `dev`/`start` is a multi-instance-capable server with no shared occupancy control. Health checks only ping Postgres. There is no job queue, no poison-message handling, no idempotency key on `care_tasks` beyond UUID primary keys. Budgets and timeouts on the loop are real and good; they do not survive a second replica or a hung `fetch` to a vendor that ignores `AbortSignal` (the timed wrapper uses `Promise.race`, not a provider-side cancel).

**Why it matters.** Two app instances × 30 runs/window = 60. A replayed `POST /runs` (once it exists) creates a second coordinator pass. Timeouts can leave a run `running` until someone notices. Health “ok” with a dead model looks healthy.

**Solution.** Redis (or Postgres) rate limits and leases. Run state machine with a sweeper for stale `running`. Idempotency keys on run create and on care-task create. Health: database + queue + optional provider probe. Worker pool for `complete()`.

**Tradeoff.** Infra you do not need for `npm run eval`. Add it when you add weakness #2’s HTTP runner, not before.

---

### 10. Documented architecture and the wired system have drifted

**Issue.** `docs/architecture.md` still opens as a “design proposal (no application code yet)” and describes a **separate safety-review stage** as part of the golden path. In code, the coordinator loop calls `reviewCareCoordinatorSafety` (deterministic). `createSafetyReviewer` is tests/adversarial only. `testing.mdc` refers to `tests/eval/` and `eval/cases/` that are not the actual layout (`src/eval/`, 32-scenario dataset). `agent_name` is unconstrained text in Postgres while the domain enum is two identities.

**Why it matters.** Production reviews fail on split-brain. New contributors will implement the doc (second model, nested runs) or the code (one loop). Eval layout drift means the “golden traces” rule is hard to follow. A third `agent_name` can be inserted without a migration.

**Solution.** Rewrite the architecture status line. Either wire the safety-reviewer as an advisory stage after `finish` (no tools, no privileges) or state clearly that v1’s safety gate is deterministic-only. Align AGENTS/testing paths. Check `agent_name` with the domain enum in schema.

**Tradeoff.** Docs work is cheaper than a second model in the live path. If you wire the reviewer, you pay latency and must keep it advisory — the threat model already forbids using it as authorization.

---

## Three architectural decisions that are strongest

These are the pieces I would **not** give up in a rewrite, and the reason this repo is worth learning from even though it must not ship as-is.

### 1. The tool gateway is the only place work happens

Schema-validate → `authorizeToolCall` (actor, **agent identity**, tool, args, **bound patient scope**, phase) → policy → execute or deny, with an audit row either way.

The model never receives a store handle. In-loop writes are a **risk class**, not a prompt instruction. `patientId` in args may only match `context.patientScope`. Unknown tools fail closed. That is the difference between an agent demo and an agent product. Keep it even when you add HTTP, queues, and a real embedder.

### 2. Approval binds bytes, then compare-and-set, then execute

`PendingAction` is a tool name plus exact args plus proposal, hashed. The client may send only `{ decision, expectedContentHash, edits? }`. The API refuses hash mismatch, already-decided, and out-of-scope. `updateIfStatus(..., "pending")` claims the row **before** `gateway.invoke` with `phase: "post_approval"`. Concurrent double-approve is tested. A grant still cannot unlock `prohibit` (medication, diagnosis).

This is how you avoid approval theater. Most agent UIs skip it. Do not.

### 3. Two planes, typed crossings, deterministic rules as data

Cognitive plane proposes structured `think | tool_call | finish`. Control plane owns allowlists, `actionPolicies`, safety predicates, budgets, and audit. Business rules are tables (`toolPolicies`, `actionPolicies`), not system-prompt paragraphs. The `ModelProvider` port keeps vendors out of agents. Eval speaks the same `AgentEvent` / denial codes as production.

That split is why injection is an **integrity** problem (can it execute?) rather than a **prompt** problem (did we say “please don’t”?). It is the decision that makes weaknesses 3–5 fixable without throwing away the system.

---

## Dimension notes (compressed)

**Frontend.** The review UI is the best product surface in the repo: provenance colors, “not executed” banner, hash in the client, decisions that cannot mint args. It is not an accessibility or design-system review; it is enough. Missing: start-run, empty states for live failures, operator auth on `/admin`.

**API.** One mutating route, JSON error envelopes with codes, CSRF origin check for cookie POSTs. No versioning, pagination, or run lifecycle API. That is appropriate until weakness #2 is closed; then design the run API as carefully as the decision API.

**Cost / latency.** Caps (`maxIterations: 10`, `maxTokens: 16_000`, 15s provider / 60s run) are serious. Cost in telemetry is an estimate, not an invoice. Loop is sequential `complete()` — tail latency is “number of retrieval hops × model p95.” Streaming is on the port and unused. Fine for v1 if live runs stay off the request thread.

**Database.** Drizzle + pgvector + UUID text ids is a reasonable demo. Fix cascade-on-audit, enum `agent_name`, and add indexes when listRecent grows. Do not build a data lake in `jsonb` event blobs without redaction and TTL.

**DX.** `tsx` eval/MCP, Docker Postgres, Cursor MCP, Cursor rules that match the architecture — this is how you want a teaching repo to feel. Fix the stale architecture header and add CI so the feeling survives contact with a second engineer.

---

## What “ready” would mean

A later review could pass if all of the following are true:

1. Real authentication and an operator role; `/admin` and MCP are not anonymous.
2. An authenticated run API or worker, with the same gateway and hash-bound approval.
3. Scripted eval as a merge gate (fail on any scenario fail) **and** a hosted-model eval with a published baseline.
4. A real `Embedder` and citation check you would defend to a clinical safety officer.
5. Immutable audit with retention independent of run deletion.
6. Shared rate limits, stale-run sweeper, health that includes the model path.

Until then, CarePilot should be presented honestly: **a control-plane reference for constrained agents**, not a system that is one Dockerfile away from clinic traffic.

The strongest compliment I can give: the mistakes this repo *refuses* to make (model as orchestrator, in-loop writes, client-supplied role, unhashed approval) are exactly the mistakes most “healthcare agent” demos make. Hold that line. Build the production envelope around it; do not loosen the line to look more like a product.
