import type { ToolActor } from "@/authz/types";

const boundSessions = new WeakSet<object>();

export type BoundRunSession = {
  readonly actor: ToolActor;
  readonly patientId: string;
};

/**
 * The only supported way to attach an actor to a patient for a coordinator run.
 * Plain `{ actor, patientId }` objects are rejected so request bodies cannot
 * mint a session.
 */
export function bindRunSession(input: {
  actor: ToolActor;
  patientId: string;
  allowedPatientIds: readonly string[];
}): BoundRunSession {
  if (input.actor.role === "system") {
    throw new Error("system actors cannot bind a care-coordinator session");
  }
  if (!input.allowedPatientIds.includes(input.patientId)) {
    throw new Error("patientId is outside the actor's allowed scope");
  }

  const session = Object.freeze({
    actor: Object.freeze({ ...input.actor }),
    patientId: input.patientId,
  });
  boundSessions.add(session);
  return session;
}

export function isBoundRunSession(value: unknown): value is BoundRunSession {
  return typeof value === "object" && value !== null && boundSessions.has(value);
}
