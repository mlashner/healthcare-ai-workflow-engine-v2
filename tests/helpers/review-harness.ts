import { toPendingActionDrafts } from "@/approval/pending-actions";
import type { ResolvedClinician } from "@/authz/patient-access";
import { createInMemoryAuditWriter } from "@/audit/writer";
import type {
  AgentEvent,
  AgentRun,
  ApprovalRequest,
  CareTask,
  CreateAgentEvent,
  CreateApprovalRequest,
  CreateCareTask,
  UpdateApprovalRequest,
} from "@/lib/domain";
import { createReviewDecisionService } from "@/review/decisions";
import {
  createCreateCareTaskTool,
  createDraftPatientMessageTool,
  createRequestHumanApprovalTool,
} from "@/tools/definitions";
import { createToolGateway } from "@/tools/gateway";
import { ToolRegistry } from "@/tools/registry";

export const HARNESS_PATIENT = "patient_harness";
export const HARNESS_RUN = "run_harness";

/**
 * Wires the real registry, gateway, and decision service against in-memory
 * stores so tests exercise the production enforcement path rather than a mock
 * of it.
 */
export function createReviewHarness(
  options: {
    patientId?: string;
    proposalType?: string;
    runPatientId?: string;
  } = {},
) {
  const patientId = options.patientId ?? HARNESS_PATIENT;
  const proposalType = options.proposalType ?? "create_care_task";

  const careTasks: CareTask[] = [];
  const careTaskStore = {
    async create(input: CreateCareTask): Promise<CareTask> {
      const task: CareTask = {
        id: `task_${careTasks.length}`,
        patientId: input.patientId,
        type: input.type,
        description: input.description,
        priority: input.priority ?? "medium",
        status: input.status ?? "draft",
        assignedTo: input.assignedTo ?? null,
        createdAt: new Date("2026-09-02T15:00:00.000Z"),
      };
      careTasks.push(task);
      return task;
    },
    async listByPatientId(id: string): Promise<CareTask[]> {
      return careTasks.filter((task) => task.patientId === id);
    },
  };

  const runs = new Map<string, AgentRun>();
  runs.set(HARNESS_RUN, {
    id: HARNESS_RUN,
    patientId: options.runPatientId ?? patientId,
    agentName: "care_coordinator",
    status: "completed",
    startedAt: new Date("2026-09-02T15:00:00.000Z"),
    completedAt: new Date("2026-09-02T15:00:10.000Z"),
  });

  const drafts = toPendingActionDrafts(
    {
      urgency: "medium",
      proposedActions: [
        {
          type: proposalType,
          summary: "Schedule a 14-day follow-up call.",
          rationale: "The follow-up interval has not been scheduled.",
          citationIds: ["cite:kb_diabetes_followup:1"],
        },
      ],
    },
    { patientId },
  );

  const approvals = new Map<string, ApprovalRequest>();
  drafts.forEach((draft, index) => {
    const id = `action_${index}`;
    approvals.set(id, {
      id,
      agentRunId: HARNESS_RUN,
      status: "pending",
      requestedAt: new Date("2026-09-02T15:00:11.000Z"),
      reviewedAt: null,
      reviewer: null,
      reason: null,
      action: {
        type: draft.toolName,
        payload: {
          policyActionType: draft.policyActionType,
          args: draft.args,
          proposal: draft.proposal,
        },
      },
    });
  });

  const agentEvents: AgentEvent[] = [];
  const audit = createInMemoryAuditWriter();

  function applyApprovalUpdate(id: string, input: UpdateApprovalRequest): ApprovalRequest | null {
    const current = approvals.get(id);
    if (!current) {
      return null;
    }
    const next: ApprovalRequest = {
      ...current,
      ...(input.action ? { action: input.action } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.reviewer !== undefined ? { reviewer: input.reviewer } : {}),
      ...(input.reviewedAt !== undefined ? { reviewedAt: input.reviewedAt } : {}),
      ...(input.reason !== undefined ? { reason: input.reason ?? null } : {}),
    } as ApprovalRequest;
    approvals.set(id, next);
    return next;
  }

  const repos = {
    agentRuns: {
      async getById(id: string) {
        return runs.get(id) ?? null;
      },
    },
    agentEvents: {
      async create(input: CreateAgentEvent) {
        const event: AgentEvent = {
          id: `event_${agentEvents.length}`,
          agentRunId: input.agentRunId,
          eventType: input.eventType,
          toolName: input.toolName ?? null,
          input: input.input ?? null,
          output: input.output ?? null,
          timestamp: new Date((input.timestamp as Date | undefined) ?? "2026-09-02T15:00:20.000Z"),
        };
        agentEvents.push(event);
        return event;
      },
      async listByAgentRunId(agentRunId: string) {
        return agentEvents.filter((event) => event.agentRunId === agentRunId);
      },
    },
    approvalRequests: {
      async getById(id: string) {
        return approvals.get(id) ?? null;
      },
      async listByAgentRunId(agentRunId: string) {
        return [...approvals.values()].filter((row) => row.agentRunId === agentRunId);
      },
      async create(input: CreateApprovalRequest) {
        throw new Error(`unexpected create in harness: ${JSON.stringify(input)}`);
      },
      async update(id: string, input: UpdateApprovalRequest) {
        return applyApprovalUpdate(id, input);
      },
      async updateIfStatus(
        id: string,
        expectedStatus: ApprovalRequest["status"],
        input: UpdateApprovalRequest,
      ) {
        const current = approvals.get(id);
        if (!current || current.status !== expectedStatus) {
          return null;
        }
        return applyApprovalUpdate(id, input);
      },
    },
    auditEvents: {
      async listByAgentRunId(agentRunId: string) {
        return audit.events.filter((event) => event.agentRunId === agentRunId);
      },
    },
  };

  const registry = new ToolRegistry()
    .register(createCreateCareTaskTool(careTaskStore))
    .register(createDraftPatientMessageTool(careTaskStore))
    .register(createRequestHumanApprovalTool({ create: async () => {
      throw new Error("requestHumanApproval must not execute in this harness");
    } }));
  const gateway = createToolGateway({ registry, audit });

  const decisions = createReviewDecisionService({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow in-memory doubles
    repos: repos as any,
    registry,
    gateway,
    audit,
  });

  return {
    patientId,
    runId: HARNESS_RUN,
    approvals,
    agentEvents,
    careTasks,
    audit,
    registry,
    gateway,
    decisions,
    firstActionId: [...approvals.keys()][0] ?? "action_0",
  };
}

export function clinician(
  overrides: Partial<ResolvedClinician> & { patientId?: string } = {},
): ResolvedClinician {
  return {
    actor: overrides.actor ?? { id: "provider_blake", role: "care_coordinator" },
    name: overrides.name ?? "Jordan Blake (FICTIONAL)",
    authorizedPatientIds:
      overrides.authorizedPatientIds ?? [overrides.patientId ?? HARNESS_PATIENT],
  };
}
