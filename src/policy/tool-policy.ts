import {
  actorRoles,
  type ActorRole,
  type AgentIdentity,
} from "@/lib/domain";

export const toolNames = [
  "getPatientContext",
  "getRecentEncounters",
  "getCarePlan",
  "searchClinicalKnowledge",
  "createCareTask",
  "draftPatientMessage",
  "requestHumanApproval",
] as const;

export type ToolName = (typeof toolNames)[number];
export type ToolRisk = "read" | "draft" | "consequential";

export type ToolPolicy = {
  risk: ToolRisk;
  agents: readonly AgentIdentity[];
  roles: readonly ActorRole[];
};

const allRoles = actorRoles;
const chartRoles = actorRoles.filter((role) => role !== "reviewer");

export const toolPolicies = {
  getPatientContext: {
    risk: "read",
    agents: ["care_coordinator", "safety_reviewer"],
    roles: allRoles,
  },
  getRecentEncounters: {
    risk: "read",
    agents: ["care_coordinator", "safety_reviewer"],
    roles: allRoles,
  },
  getCarePlan: {
    risk: "read",
    agents: ["care_coordinator", "safety_reviewer"],
    roles: allRoles,
  },
  searchClinicalKnowledge: {
    risk: "read",
    agents: ["care_coordinator", "safety_reviewer"],
    roles: allRoles,
  },
  createCareTask: {
    risk: "draft",
    agents: ["care_coordinator"],
    roles: chartRoles,
  },
  draftPatientMessage: {
    risk: "draft",
    agents: ["care_coordinator"],
    roles: chartRoles,
  },
  requestHumanApproval: {
    risk: "consequential",
    agents: ["care_coordinator"],
    roles: chartRoles,
  },
} as const satisfies Record<ToolName, ToolPolicy>;

export function getToolPolicy(toolName: string): ToolPolicy | undefined {
  if (!isToolName(toolName)) {
    return undefined;
  }
  return toolPolicies[toolName];
}

export function isToolName(value: string): value is ToolName {
  return (toolNames as readonly string[]).includes(value);
}
