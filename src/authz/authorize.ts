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

  return { allowed: true };
}

export function extractPatientIds(value: unknown): string[] {
  if (value === null || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const ids: string[] = [];

  if (typeof record.patientId === "string" && record.patientId.length > 0) {
    ids.push(record.patientId);
  }

  if (record.payload && typeof record.payload === "object" && record.payload !== null) {
    const payload = record.payload as Record<string, unknown>;
    if (typeof payload.patientId === "string" && payload.patientId.length > 0) {
      ids.push(payload.patientId);
    }
  }

  return ids;
}
