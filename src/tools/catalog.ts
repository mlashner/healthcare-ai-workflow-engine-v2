import type { Repositories } from "@/lib/db/repositories";

import {
  createCreateCareTaskTool,
  createDraftPatientMessageTool,
  createGetCarePlanTool,
  createGetPatientContextTool,
  createGetRecentEncountersTool,
  createRequestHumanApprovalTool,
  createSearchClinicalKnowledgeTool,
} from "./definitions";
import { ToolRegistry } from "./registry";

export function createToolRegistry(repos: Repositories): ToolRegistry {
  return new ToolRegistry()
    .register(createGetPatientContextTool(repos.patients))
    .register(createGetRecentEncountersTool(repos.encounters))
    .register(createGetCarePlanTool(repos.careTasks))
    .register(createSearchClinicalKnowledgeTool(repos.clinicalDocuments))
    .register(createCreateCareTaskTool(repos.careTasks))
    .register(createDraftPatientMessageTool(repos.careTasks))
    .register(createRequestHumanApprovalTool(repos.approvalRequests));
}
