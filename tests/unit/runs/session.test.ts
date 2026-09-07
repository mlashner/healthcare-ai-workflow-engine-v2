import { describe, expect, it } from "vitest";

import { bindRunSession, isBoundRunSession } from "@/runs";

describe("bindRunSession", () => {
  it("rejects a patient the actor is not allowed to see", () => {
    expect(() =>
      bindRunSession({
        actor: { id: "actor_1", role: "care_coordinator" },
        patientId: "patient_other",
        allowedPatientIds: ["patient_in_scope"],
      }),
    ).toThrow(/allowed scope/);
  });

  it("rejects system actors", () => {
    expect(() =>
      bindRunSession({
        actor: { id: "system", role: "system" },
        patientId: "patient_in_scope",
        allowedPatientIds: ["patient_in_scope"],
      }),
    ).toThrow(/system/);
  });

  it("does not treat a crafted object as a bound session", () => {
    expect(
      isBoundRunSession({
        actor: { id: "actor_1", role: "care_coordinator" },
        patientId: "patient_in_scope",
      }),
    ).toBe(false);
  });
});
