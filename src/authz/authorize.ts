import { getToolPolicy } from "@/policy/tool-policy";

import type { AuthzDecision, ToolInvocationContext } from "./types";

/**
 * Deterministic authorization. Context is bound by the control plane.
 * Arguments supplied by a model cannot change actor, agent, or patient scope.
 */
export function authorizeToolCall(
  context: ToolInvocationContext,
  toolName: string,
  args: unknown,
): AuthzDecision {
  const policy = getToolPolicy(toolName);
  if (!policy) {
    return { allowed: false, code: "UNAUTHORIZED", reason: `unknown tool: ${toolName}` };
  }

  if (!policy.agents.includes(context.agentName)) {
    return {
      allowed: false,
      code: "POLICY_DENIED",
      reason: `agent ${context.agentName} is not allowed to call ${toolName}`,
    };
  }

  if (!policy.roles.includes(context.actor.role)) {
    return {
      allowed: false,
      code: "POLICY_DENIED",
      reason: `role ${context.actor.role} is not allowed to call ${toolName}`,
    };
  }

  const requestedPatientIds = extractPatientIds(args);
  const mismatched = requestedPatientIds.find((id) => id !== context.patientScope);
  if (mismatched) {
    return {
      allowed: false,
      code: "UNAUTHORIZED",
      reason: "patientId is outside the bound run scope",
    };
  }

  const phase = context.phase ?? "agent_loop";
  if (phase === "agent_loop" && policy.risk !== "read") {
    return {
      allowed: false,
      code: "POLICY_DENIED",
      reason: `${toolName} cannot execute during the agent loop`,
    };
  }

  return { allowed: true };
}

export function extractPatientIds(value: unknown): string[] {
  if (value === null || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const ids: string[] = [];

  for (const key of ["patientId", "patient_id", "targetPatientId"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      ids.push(value);
    }
  }

  if (record.payload && typeof record.payload === "object" && record.payload !== null) {
    const payload = record.payload as Record<string, unknown>;
    for (const key of ["patientId", "patient_id", "targetPatientId"] as const) {
      const value = payload[key];
      if (typeof value === "string" && value.length > 0) {
        ids.push(value);
      }
    }
  }

  return ids;
}
