import type { ToolInvocationContext } from "@/authz/types";
import type { KnowledgeSearch } from "@/retrieval/search";
import type {
  ApprovalRequest,
  CareTask,
  CreateApprovalRequest,
  CreateCareTask,
  Encounter,
  Patient,
} from "@/lib/domain";

import { ToolError } from "./errors";
import { hashJson } from "./hash";
import type {
  CreateCareTaskInput,
  CreateCareTaskOutput,
  DraftPatientMessageInput,
  DraftPatientMessageOutput,
  GetCarePlanOutput,
  GetPatientContextOutput,
  GetRecentEncountersInput,
  GetRecentEncountersOutput,
  RequestHumanApprovalInput,
  RequestHumanApprovalOutput,
  SearchClinicalKnowledgeInput,
  SearchClinicalKnowledgeOutput,
} from "./schemas";

export type PatientReader = {
  getById(id: string): Promise<Patient | null>;
};

export type EncounterReader = {
  listByPatientId(patientId: string): Promise<Encounter[]>;
};

export type CareTaskStore = {
  create(input: CreateCareTask): Promise<CareTask>;
  listByPatientId(patientId: string): Promise<CareTask[]>;
};

export type ApprovalStore = {
  create(input: CreateApprovalRequest): Promise<ApprovalRequest>;
};

export function createPatientContextService(patients: PatientReader) {
  return {
    async execute(_input: { patientId: string }, context: ToolInvocationContext) {
      const patient = await patients.getById(context.patientScope);
      if (!patient) {
        throw new ToolError("NOT_FOUND", "patient not found");
      }

      return {
        patientId: patient.id,
        name: patient.name,
        dateOfBirth: patient.dateOfBirth,
        conditions: patient.conditions,
        medications: patient.medications,
      } satisfies GetPatientContextOutput;
    },
  };
}

export function createRecentEncountersService(encounters: EncounterReader) {
  return {
    async execute(input: GetRecentEncountersInput, context: ToolInvocationContext) {
      const rows = await encounters.listByPatientId(context.patientScope);
      const limit = input.limit ?? 5;

      return {
        patientId: context.patientScope,
        encounters: rows.slice(0, limit).map((row) => ({
          id: row.id,
          providerId: row.providerId,
          occurredAt: row.occurredAt,
          transcript: row.transcript,
        })),
      } satisfies GetRecentEncountersOutput;
    },
  };
}

export function createCarePlanService(careTasks: CareTaskStore) {
  return {
    async execute(_input: { patientId: string }, context: ToolInvocationContext) {
      const tasks = await careTasks.listByPatientId(context.patientScope);

      return {
        patientId: context.patientScope,
        tasks: tasks.map((task) => ({
          id: task.id,
          type: task.type,
          description: task.description,
          priority: task.priority,
          status: task.status,
          assignedTo: task.assignedTo,
        })),
      } satisfies GetCarePlanOutput;
    },
  };
}

export function createClinicalKnowledgeService(search: KnowledgeSearch) {
  return {
    async execute(input: SearchClinicalKnowledgeInput) {
      return {
        query: input.query,
        results: await search.search(input),
      } satisfies SearchClinicalKnowledgeOutput;
    },
  };
}

export function createCareTaskService(careTasks: CareTaskStore) {
  return {
    async execute(input: CreateCareTaskInput, context: ToolInvocationContext) {
      const created = await careTasks.create({
        patientId: context.patientScope,
        type: input.type,
        description: input.description,
        priority: input.priority,
        assignedTo: input.assignedTo,
        status: "draft",
      });

      return {
        id: created.id,
        patientId: created.patientId,
        type: created.type,
        description: created.description,
        priority: created.priority,
        status: "draft",
        assignedTo: created.assignedTo,
      } satisfies CreateCareTaskOutput;
    },
  };
}

export function createPatientMessageDraftService(careTasks: CareTaskStore) {
  return {
    async execute(input: DraftPatientMessageInput, context: ToolInvocationContext) {
      const body = [
        "[FICTIONAL DRAFT — not sent, not clinical advice]",
        `Purpose: ${input.purpose}`,
        "",
        ...input.talkingPoints.map((point) => `- ${point}`),
      ].join("\n");

      const created = await careTasks.create({
        patientId: context.patientScope,
        type: "outreach",
        description: body,
        priority: "medium",
        status: "draft",
      });

      return {
        careTaskId: created.id,
        patientId: context.patientScope,
        body,
        status: "draft",
      } satisfies DraftPatientMessageOutput;
    },
  };
}

export function createHumanApprovalService(approvals: ApprovalStore) {
  return {
    async execute(input: RequestHumanApprovalInput, context: ToolInvocationContext) {
      const action = {
        type: input.actionType,
        payload: {
          ...input.payload,
          patientId: context.patientScope,
        },
      };
      const created = await approvals.create({
        agentRunId: context.agentRunId,
        action,
        status: "pending",
        reason: input.reason,
      });

      return {
        approvalRequestId: created.id,
        status: "pending",
        action: {
          type: input.actionType,
          payload: created.action.payload,
        },
        contentHash: hashJson(action),
      } satisfies RequestHumanApprovalOutput;
    },
  };
}

