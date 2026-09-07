import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  CLINICIAN_COOKIE,
  CLINICIAN_HEADER,
  getReviewContext,
  resolveRequestClinician,
} from "@/app/review-context";
import { loadAgentTrace } from "@/trace/assemble";

import { TraceView, type SerializedTraceEvent } from "./trace-view";

export const dynamic = "force-dynamic";

export default async function AgentTracePage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const { repos } = getReviewContext();

  const headerList = await headers();
  const cookieStore = await cookies();
  const clinicianId =
    headerList.get(CLINICIAN_HEADER) ?? cookieStore.get(CLINICIAN_COOKIE)?.value ?? null;
  const clinician = await resolveRequestClinician(repos, clinicianId);

  if (!clinician) {
    return (
      <main className="review-shell">
        <h1>Agent trace</h1>
        <p className="muted">
          No clinician identity on this request. <Link href="/reviews">Choose a clinician</Link> to
          continue.
        </p>
      </main>
    );
  }

  const trace = await loadAgentTrace(repos, runId, {
    actor: clinician.actor,
    authorizedPatientIds: clinician.authorizedPatientIds,
  });

  if (!trace) {
    notFound();
  }

  const events: SerializedTraceEvent[] = trace.events.map((event) => ({
    ...event,
    at: event.at.toISOString(),
  }));

  return (
    <main className="review-shell">
      <p className="demo-banner">
        FICTIONAL DEMONSTRATION DATA. CarePilot is not a medical product and is not for clinical
        use.
      </p>

      <h1>Agent trace</h1>
      <p className="muted">
        Chronological control-plane record of run <span className="hash">{trace.run.id}</span>.
        Secrets and chart demographics are redacted.{" "}
        <Link href={`/reviews/${trace.run.id}`}>Clinician review</Link>
      </p>

      <TraceView events={events} />
    </main>
  );
}
