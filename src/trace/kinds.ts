export const traceKinds = [
  "agent_started",
  "context_requested",
  "tool_called",
  "tool_result",
  "knowledge_retrieved",
  "model_reasoning",
  "recommendation_generated",
  "safety_review",
  "policy_evaluation",
  "approval_requested",
  "human_decision",
  "action_executed",
] as const;

export type TraceKind = (typeof traceKinds)[number];

export const traceKindLabels: Record<TraceKind, string> = {
  agent_started: "Agent started",
  context_requested: "Context requested",
  tool_called: "Tool called",
  tool_result: "Tool result",
  knowledge_retrieved: "Knowledge retrieved",
  model_reasoning: "Model reasoning",
  recommendation_generated: "Recommendation generated",
  safety_review: "Safety review",
  policy_evaluation: "Policy evaluation",
  approval_requested: "Approval requested",
  human_decision: "Human decision",
  action_executed: "Action executed",
};

export const contextToolNames = ["getPatientContext", "getRecentEncounters", "getCarePlan"] as const;
export const knowledgeToolName = "searchClinicalKnowledge";
export const writeToolNames = ["createCareTask", "draftPatientMessage", "requestHumanApproval"] as const;

export function isContextTool(name: string | null | undefined): boolean {
  return name !== null && name !== undefined && (contextToolNames as readonly string[]).includes(name);
}

export function isKnowledgeTool(name: string | null | undefined): boolean {
  return name === knowledgeToolName;
}

export function isWriteTool(name: string | null | undefined): boolean {
  return name !== null && name !== undefined && (writeToolNames as readonly string[]).includes(name);
}
