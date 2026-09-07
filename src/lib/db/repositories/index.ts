import type { Database } from "../client";
import { createAgentEventRepository } from "./agent-event-repository";
import { createAgentRunRepository } from "./agent-run-repository";
import { createApprovalRequestRepository } from "./approval-request-repository";
import { createCareTaskRepository } from "./care-task-repository";
import { createClinicalDocumentRepository } from "./clinical-document-repository";
import { createEncounterRepository } from "./encounter-repository";
import { createPatientRepository } from "./patient-repository";
import { createProviderRepository } from "./provider-repository";

export { createAgentEventRepository } from "./agent-event-repository";
export { createAgentRunRepository } from "./agent-run-repository";
export { createApprovalRequestRepository } from "./approval-request-repository";
export { createCareTaskRepository } from "./care-task-repository";
export { createClinicalDocumentRepository } from "./clinical-document-repository";
export { createEncounterRepository } from "./encounter-repository";
export { newEntityId } from "./ids";
export { createPatientRepository } from "./patient-repository";
export { createProviderRepository } from "./provider-repository";

export function createRepositories(db: Database) {
  return {
    patients: createPatientRepository(db),
    providers: createProviderRepository(db),
    encounters: createEncounterRepository(db),
    clinicalDocuments: createClinicalDocumentRepository(db),
    careTasks: createCareTaskRepository(db),
    agentRuns: createAgentRunRepository(db),
    agentEvents: createAgentEventRepository(db),
    approvalRequests: createApprovalRequestRepository(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
