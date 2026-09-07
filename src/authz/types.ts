import type { ActorRole, AgentIdentity } from "@/lib/domain";

export type ToolActor = {
  id: string;
  role: ActorRole;
};

export type ToolInvocationContext = {
  actor: ToolActor;
  agentName: AgentIdentity;
  patientScope: string;
  agentRunId: string;
};

export type AuthzDecision =
  | { allowed: true }
  | { allowed: false; code: "UNAUTHORIZED" | "POLICY_DENIED"; reason: string };
