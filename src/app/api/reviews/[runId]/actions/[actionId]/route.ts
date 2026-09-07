import { cookies, headers } from "next/headers";

import {
  CLINICIAN_COOKIE,
  CLINICIAN_HEADER,
  getReviewContext,
  resolveRequestClinician,
} from "@/app/review-context";
import { isSameOriginRequest } from "@/authz/origin";
import { logger } from "@/lib/logger";
import { reviewDecisionRequestSchema } from "@/review/decisions";

export const runtime = "nodejs";

/**
 * Human review decision endpoint. The body carries a decision, the content
 * hash of the action the reviewer saw, and optional edits. Actor identity,
 * patient scope, tool name, and tool arguments are never taken from the body,
 * so the frontend has no path around the policy engine or the tool gateway.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string; actionId: string }> },
): Promise<Response> {
  const { runId, actionId } = await context.params;
  const { repos, decisions } = getReviewContext();

  const headerList = await headers();
  const cookieStore = await cookies();
  const headerClinicianId = headerList.get(CLINICIAN_HEADER);
  const cookieClinicianId = cookieStore.get(CLINICIAN_COOKIE)?.value ?? null;

  // Cookie-authenticated POSTs must be same-origin. The demo header is not
  // sent by a browser on a cross-site form post, so it is not a CSRF vector.
  if (!headerClinicianId && cookieClinicianId && !isSameOriginRequest(request)) {
    return Response.json(
      { error: { code: "CSRF_REJECTED", message: "origin does not match this application" } },
      { status: 403 },
    );
  }

  const clinician = await resolveRequestClinician(repos, headerClinicianId ?? cookieClinicianId);
  if (!clinician) {
    return Response.json(
      { error: { code: "UNAUTHENTICATED", message: "no known clinician identity on request" } },
      { status: 401 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json(
      { error: { code: "INVALID_JSON", message: "request body must be JSON" } },
      { status: 400 },
    );
  }

  const parsed = reviewDecisionRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
            .join("; "),
        },
      },
      { status: 400 },
    );
  }

  const outcome = await decisions.decide({
    runId,
    pendingActionId: actionId,
    clinician,
    request: parsed.data,
  });

  if (!outcome.ok) {
    logger.warn("review.decision.rejected", {
      runId,
      actionId,
      code: outcome.code,
      actorId: clinician.actor.id,
    });
    return Response.json(
      { error: { code: outcome.code, message: outcome.message } },
      { status: outcome.status },
    );
  }

  logger.info("review.decision.recorded", {
    runId,
    actionId,
    decision: outcome.decision,
    executed: outcome.executed,
    actorId: clinician.actor.id,
  });

  return Response.json(
    {
      decision: outcome.decision,
      pendingActionId: outcome.pendingActionId,
      contentHash: outcome.contentHash,
      executed: outcome.executed,
      policy: outcome.policy,
    },
    { status: outcome.status },
  );
}
