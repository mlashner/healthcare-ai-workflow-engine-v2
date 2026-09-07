# 10-minute demo walkthrough

CarePilot is a **fictional-data** care-coordination demo, not a medical product. This is a click-through of one completed run: retrieve → propose → safety → policy → approve → trace → eval.

There is no live “Run agent” button. The UI reviews a seeded run so the path is deterministic.

Open only the run tagged **interview demo** (`run_fictional_ava_review`). Ignore `run_fictional_ava_coordinator` and any `run_e2e_*` rows.

## Setup

```bash
cp .env.example .env          # first time only
npm install
npm run db:migrate
npm run db:seed
npm run eval
npm run dev
```

Postgres must already be up with the `vector` extension and `DATABASE_URL` from `.env` (`postgres://carepilot:carepilot@localhost:5432/carepilot`). Docker is optional: `docker compose up -d` only if you use the Compose image and `docker` is on your PATH. Homebrew Postgres on this machine is enough.

- App: [http://localhost:3000](http://localhost:3000)
- Health: [http://localhost:3000/api/health](http://localhost:3000/api/health) should report `"database":"ok"`
- If **Approve** is already used: `npm run db:seed` again. For a full reset of a Compose volume: `docker compose down -v`, then migrate, seed, and eval. On Homebrew Postgres, drop and recreate the `carepilot` database instead.

## Walkthrough

### 1. Home — [http://localhost:3000](http://localhost:3000)

Architecture line on the page:

`Agent → Tools → Policy → Human → Action`

Open **Clinician review dashboard**.

### 2. Choose clinician — [http://localhost:3000/reviews](http://localhost:3000/reviews)

Act as **Jordan Blake (FICTIONAL) — care_coordinator**, then Continue.

If you are already signed in as someone else, use **Switch clinician** at the bottom of the page.

### 3. Open the demo run

Open the first row, tagged **interview demo**. Click the run name, not Trace.

You should land on [http://localhost:3000/reviews/run_fictional_ava_review](http://localhost:3000/reviews/run_fictional_ava_review).

### 4. Patient and encounter

Banner: **AI recommendation ≠ executed action**.

- **1. Patient** — Ava Nguyen (FICTIONAL), retrieved chart fields
- **2. Encounter** — unplanned-visit transcript (untrusted data)

### 5. Retrieval timeline

Header link: **Agent trace**.

Look for these tools, in order:

| Label | Tool |
|---|---|
| Context requested | `getPatientContext` |
| Context requested | `getRecentEncounters` |
| Context requested | `getCarePlan` |
| Knowledge retrieved | `searchClinicalKnowledge` |

This is a completed run, not a live model call. Back to **Clinician review**.

### 6. Recommendation

- **3. Agent summary**
- **4. Identified concerns**
- **5. Evidence and citations** — retrieved passage and a resolved citation id
- **6. Proposed actions** — a care task and a draft patient message (still proposals)

### 7. Safety review

**7. Safety review (second stage)**

- Decision `approved`
- Required approvals includes `draft_patient_message requires human approval before send`

This stage cannot execute tools. The live coordinator path uses deterministic checks after the model finishes; this seeded event is the same gate, shown as a reviewer payload.

### 8. Policy

**8. Policy decision and 9. Approval status**

Skip the care-task card. On the **draft patient message** card:

1. Would call `draftPatientMessage`
2. **Permitted by policy — human approval required**
3. Content hash bound to this payload

### 9. Approve

On that card: **Approve and execute**.

**Human decisions** and **Executed actions** at the bottom of the page should update.

### 10. Trace after approval

**Agent trace** again. The earlier retrieval events should still be there, plus:

- Human decision
- Action executed

### 11. Evaluation — [http://localhost:3000/admin](http://localhost:3000/admin)

Numeric metrics only (no patient chart text). Under **Evaluation score over time**:

- Scenarios
- Policy compliance
- Citation accuracy
- Escalation accuracy

Read the values on the page. `npm run eval` writes `eval/results/latest.md` if admin is empty.

## If something is missing

| What you see | What to do |
|---|---|
| No **interview demo** badge | `npm run db:seed`. Act as Jordan Blake. |
| Wrong clinician | `/reviews` → Switch clinician → Jordan Blake. |
| Approve already recorded | `npm run db:seed` |
| Trace missing `getRecentEncounters` | `npm run db:seed` (older DBs lacked that event) |
| Admin has no eval numbers | `npm run eval`, refresh `/admin` |
| Health check fails | `docker compose up -d`, then `npm run db:migrate` |
