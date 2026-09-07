import { describe, expect, it } from "vitest";

import { authorizeToolCall } from "@/authz/authorize";
import type { ToolInvocationContext } from "@/authz/types";

const scoped: ToolInvocationContext = {
  actor: { id: "provider_fictional_blake", role: "care_coordinator" },
  agentName: "care_coordinator",
  patientScope: "patient_fictional_ava",
  agentRunId: "run_fictional_ava_coordinator",
};

describe("authorizeToolCall", () => {
  it("allows an in-scope read for the coordinator agent", () => {
    expect(
      authorizeToolCall(scoped, "getPatientContext", { patientId: "patient_fictional_ava" }),
    ).toEqual({ allowed: true });
  });

  it("denies a different patientId even when the caller claims to be an admin", () => {
    const decision = authorizeToolCall(scoped, "getPatientContext", {
      patientId: "patient_fictional_marcus",
      role: "admin",
      skipApproval: true,
    });

    expect(decision).toMatchObject({ allowed: false, code: "UNAUTHORIZED" });
  });

  it("denies a payload.patientId that widens scope", () => {
    const decision = authorizeToolCall(scoped, "requestHumanApproval", {
      actionType: "propose_referral",
      payload: { patientId: "patient_fictional_priya" },
    });

    expect(decision).toMatchObject({ allowed: false, code: "UNAUTHORIZED" });
  });

  it("denies mutate tools for the safety_reviewer agent", () => {
    const decision = authorizeToolCall(
      { ...scoped, agentName: "safety_reviewer" },
      "createCareTask",
      { patientId: "patient_fictional_ava", type: "follow_up", description: "no" },
    );

    expect(decision).toMatchObject({ allowed: false, code: "POLICY_DENIED" });
  });

  it("denies mutate tools for a reviewer actor", () => {
    const decision = authorizeToolCall(
      { ...scoped, actor: { id: "provider_fictional_patel", role: "reviewer" } },
      "draftPatientMessage",
      {
        patientId: "patient_fictional_ava",
        purpose: "follow up",
        talkingPoints: ["Fictional"],
      },
    );

    expect(decision).toMatchObject({ allowed: false, code: "POLICY_DENIED" });
  });

  it("denies write tools during the agent loop and allows them after approval", () => {
    const write = {
      patientId: "patient_fictional_ava",
      type: "follow_up" as const,
      description: "Fictional",
    };
    expect(authorizeToolCall(scoped, "createCareTask", write)).toMatchObject({
      allowed: false,
      code: "POLICY_DENIED",
    });
    expect(
      authorizeToolCall({ ...scoped, phase: "post_approval" }, "createCareTask", write),
    ).toEqual({ allowed: true });
  });

  it("does not let args.agentName replace the bound agent identity", () => {
    const decision = authorizeToolCall(
      { ...scoped, agentName: "safety_reviewer" },
      "requestHumanApproval",
      {
        actionType: "propose_referral",
        payload: { patientId: "patient_fictional_ava" },
        agentName: "care_coordinator",
      },
    );

    expect(decision).toMatchObject({ allowed: false, code: "POLICY_DENIED" });
  });
});
