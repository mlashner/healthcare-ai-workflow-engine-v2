import type { ToolInvocationContext } from "@/authz/types";

import type {
  ApprovalStore,
  CareTaskStore,
  EncounterReader,
  PatientReader,
} from "./services";
import type { KnowledgeSearch } from "@/retrieval/search";
import {
  createCarePlanService,
  createCareTaskService,
  createClinicalKnowledgeService,
  createHumanApprovalService,
  createPatientContextService,
  createPatientMessageDraftService,
  createRecentEncountersService,
} from "./services";
import {
  createCareTaskInputSchema,
  createCareTaskOutputSchema,
  draftPatientMessageInputSchema,
  draftPatientMessageOutputSchema,
  getCarePlanInputSchema,
  getCarePlanOutputSchema,
  getPatientContextInputSchema,
  getPatientContextOutputSchema,
  getRecentEncountersInputSchema,
  getRecentEncountersOutputSchema,
  requestHumanApprovalInputSchema,
  requestHumanApprovalOutputSchema,
  searchClinicalKnowledgeInputSchema,
  searchClinicalKnowledgeOutputSchema,
} from "./schemas";
import type { Tool } from "./types";

function defineTool<TInput, TOutput>(tool: Tool<TInput, TOutput>): Tool<TInput, TOutput> {
  return tool;
}

export function createGetPatientContextTool(patients: PatientReader) {
  const service = createPatientContextService(patients);
  return defineTool({
    name: "getPatientContext",
    inputSchema: getPatientContextInputSchema,
    outputSchema: getPatientContextOutputSchema,
    execute: (input, context: ToolInvocationContext) => service.execute(input, context),
  });
}

export function createGetRecentEncountersTool(encounters: EncounterReader) {
  const service = createRecentEncountersService(encounters);
  return defineTool({
    name: "getRecentEncounters",
    inputSchema: getRecentEncountersInputSchema,
    outputSchema: getRecentEncountersOutputSchema,
    execute: (input, context: ToolInvocationContext) => service.execute(input, context),
  });
}

export function createGetCarePlanTool(careTasks: CareTaskStore) {
  const service = createCarePlanService(careTasks);
  return defineTool({
    name: "getCarePlan",
    inputSchema: getCarePlanInputSchema,
    outputSchema: getCarePlanOutputSchema,
    execute: (input, context: ToolInvocationContext) => service.execute(input, context),
  });
}

export function createSearchClinicalKnowledgeTool(search: KnowledgeSearch) {
  const service = createClinicalKnowledgeService(search);
  return defineTool({
    name: "searchClinicalKnowledge",
    inputSchema: searchClinicalKnowledgeInputSchema,
    outputSchema: searchClinicalKnowledgeOutputSchema,
    execute: (input) => service.execute(input),
  });
}

export function createCreateCareTaskTool(careTasks: CareTaskStore) {
  const service = createCareTaskService(careTasks);
  return defineTool({
    name: "createCareTask",
    inputSchema: createCareTaskInputSchema,
    outputSchema: createCareTaskOutputSchema,
    execute: (input, context: ToolInvocationContext) => service.execute(input, context),
  });
}

export function createDraftPatientMessageTool(careTasks: CareTaskStore) {
  const service = createPatientMessageDraftService(careTasks);
  return defineTool({
    name: "draftPatientMessage",
    inputSchema: draftPatientMessageInputSchema,
    outputSchema: draftPatientMessageOutputSchema,
    execute: (input, context: ToolInvocationContext) => service.execute(input, context),
  });
}

export function createRequestHumanApprovalTool(approvals: ApprovalStore) {
  const service = createHumanApprovalService(approvals);
  return defineTool({
    name: "requestHumanApproval",
    inputSchema: requestHumanApprovalInputSchema,
    outputSchema: requestHumanApprovalOutputSchema,
    execute: (input, context: ToolInvocationContext) => service.execute(input, context),
  });
}
