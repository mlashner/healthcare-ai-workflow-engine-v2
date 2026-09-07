export const providerRoles = [
  "physician",
  "nurse",
  "care_coordinator",
  "pharmacist",
  "social_worker",
  "reviewer",
] as const;

export const clinicalDocumentSources = [
  "knowledge_base",
  "guideline",
  "policy",
  "reference",
] as const;

export const careTaskTypes = [
  "referral",
  "outreach",
  "follow_up",
  "care_gap",
  "notify_care_team",
] as const;

export const careTaskPriorities = ["low", "medium", "high", "urgent"] as const;

export const careTaskStatuses = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "completed",
  "cancelled",
] as const;

export const agentRunStatuses = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export const agentEventTypes = [
  "think",
  "tool_call",
  "tool_result",
  "finish",
  "error",
  "safety_review",
  "policy_decision",
] as const;

export const approvalStatuses = ["pending", "approved", "rejected"] as const;

export type ProviderRole = (typeof providerRoles)[number];
export type ClinicalDocumentSource = (typeof clinicalDocumentSources)[number];
export type CareTaskType = (typeof careTaskTypes)[number];
export type CareTaskPriority = (typeof careTaskPriorities)[number];
export type CareTaskStatus = (typeof careTaskStatuses)[number];
export type AgentRunStatus = (typeof agentRunStatuses)[number];
export type AgentEventType = (typeof agentEventTypes)[number];
export type ApprovalStatus = (typeof approvalStatuses)[number];
