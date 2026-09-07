import { cookies, headers } from "next/headers";
import Link from "next/link";

import {
  CLINICIAN_COOKIE,
  CLINICIAN_HEADER,
  getReviewContext,
  resolveRequestClinician,
} from "@/app/review-context";
import { seedIds } from "@/lib/db/seed";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const { repos } = getReviewContext();

  const headerList = await headers();
  const cookieStore = await cookies();
  const clinicianId =
    headerList.get(CLINICIAN_HEADER) ?? cookieStore.get(CLINICIAN_COOKIE)?.value ?? null;
  const clinician = await resolveRequestClinician(repos, clinicianId);

  if (!clinician) {
    const providers = await repos.providers.list();

    return (
      <main className="review-shell">
        <p className="demo-banner">
          FICTIONAL DEMONSTRATION DATA. CarePilot is not a medical product and is not for clinical
          use.
        </p>
        <h1>Clinician review</h1>
        <p className="muted">
          This demo has no authentication. Choose a fictional clinician; their role and patient
          scope are then read from the store, not from your selection.
        </p>
        <form method="post" action="/api/clinician-session">
          <label htmlFor="clinicianId">Act as</label>
          <select
            id="clinicianId"
            name="clinicianId"
            data-testid="clinician-select"
            defaultValue={seedIds.providers.blake}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name} — {provider.role}
              </option>
            ))}
          </select>
          <div className="decision-controls">
            <button type="submit">Continue</button>
          </div>
        </form>
      </main>
    );
  }

  const recent = await repos.agentRuns.listRecent(20);
  const interviewRun = await repos.agentRuns.getById(seedIds.agentRuns.avaReview);
  const others = recent.filter((run) => run.id !== seedIds.agentRuns.avaReview);
  const runs = interviewRun ? [interviewRun, ...others] : others;
  const visible = runs.filter((run) => clinician.authorizedPatientIds.includes(run.patientId));
  const providers = await repos.providers.list();

  return (
    <main className="review-shell">
      <p className="demo-banner">
        FICTIONAL DEMONSTRATION DATA. CarePilot is not a medical product and is not for clinical
        use.
      </p>
      <h1>Clinician review</h1>
      <p className="muted">
        Reviewing as {clinician.name} ({clinician.actor.role}). Runs for patients outside your
        scope are not listed and cannot be opened. The 10-minute walkthrough uses the run tagged{" "}
        <strong>interview demo</strong> (listed first).
      </p>

      {visible.length === 0 ? (
        <p className="muted" data-testid="no-runs">
          No agent runs are in your patient scope.
        </p>
      ) : (
        <ul className="run-list">
          {visible.map((run) => (
            <li key={run.id}>
              <Link href={`/reviews/${run.id}`}>
                {run.agentName} &middot; {run.status}
              </Link>
              {run.id === seedIds.agentRuns.avaReview ? (
                <>
                  {" "}
                  <span className="status-chip" data-status="pending" data-testid="interview-demo-badge">
                    interview demo
                  </span>
                </>
              ) : null}
              {" · "}
              <Link href={`/reviews/${run.id}/trace`}>Trace</Link>
              <p className="hash">
                {run.id} &middot; patient {run.patientId} &middot;{" "}
                {run.startedAt.toISOString()}
              </p>
            </li>
          ))}
        </ul>
      )}

      <form method="post" action="/api/clinician-session">
        <label htmlFor="clinicianId">Switch clinician</label>
        <select
          id="clinicianId"
          name="clinicianId"
          data-testid="clinician-select"
          defaultValue={clinician.actor.id}
        >
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name} — {provider.role}
            </option>
          ))}
        </select>
        <div className="decision-controls">
          <button type="submit">Continue</button>
        </div>
      </form>
    </main>
  );
}
