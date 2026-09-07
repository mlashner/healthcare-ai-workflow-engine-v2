import { describe, expect, it } from "vitest";

import { imposePatientScope } from "@/review/patient-scope";

describe("imposePatientScope", () => {
  const bound = "patient_bound";

  it("rebinds a top-level patientId that the original args already had", () => {
    const original = { patientId: bound, description: "Follow up." };
    const scoped = imposePatientScope(
      original,
      { ...original, patientId: "patient_other", description: "Edited." },
      bound,
    );

    expect(scoped.patientId).toBe(bound);
    expect(scoped.description).toBe("Edited.");
  });

  it("drops a top-level patientId that the original args never had", () => {
    const original = {
      actionType: "notify_care_team",
      payload: { patientId: bound },
      reason: "Original.",
    };
    const scoped = imposePatientScope(
      original,
      { ...original, patientId: "patient_other" },
      bound,
    );

    expect(scoped).not.toHaveProperty("patientId");
    expect((scoped.payload as { patientId: string }).patientId).toBe(bound);
  });

  it("rebinds a nested payload patientId even when the payload is replaced", () => {
    const original = {
      actionType: "notify_care_team",
      payload: { patientId: bound },
      reason: "Original.",
    };
    const scoped = imposePatientScope(
      original,
      { ...original, payload: { patientId: "patient_other", message: "hi" } },
      bound,
    );

    expect(scoped.payload).toEqual({ patientId: bound, message: "hi" });
  });
});
