import type { ActorRole, AgentIdentity } from "@/lib/domain";

export type ToolActor = {
  id: string;
  role: ActorRole;
};

export const toolInvocationPhases = ["agent_loop", "post_approval"] as const;
export type ToolInvocationPhase = (typeof toolInvocationPhases)[number];

export type ToolInvocationContext = {
  actor: ToolActor;
  agentName: AgentIdentity;
  patientScope: string;
  agentRunId: string;
  /**
   * Bound by the control plane. Omitted phase is treated as `agent_loop`
   * so write tools fail closed unless a later stage opts in.
   */
  phase?: ToolInvocationPhase;
};

export type AuthzDecision =
  | { allowed: true }
  | { allowed: false; code: "UNAUTHORIZED" | "POLICY_DENIED"; reason: string };
