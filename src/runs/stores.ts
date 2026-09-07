import {
  agentEventSchema,
  agentRunSchema,
  createAgentEventSchema,
  createAgentRunSchema,
  updateAgentRunSchema,
  type AgentEvent,
  type AgentRun,
  type CreateAgentEvent,
  type CreateAgentRun,
  type UpdateAgentRun,
} from "@/lib/domain";

export type RunStore = {
  create(input: CreateAgentRun): Promise<AgentRun>;
  update(id: string, input: UpdateAgentRun): Promise<AgentRun | null>;
};

export type EventStore = {
  create(input: CreateAgentEvent): Promise<AgentEvent>;
  listByAgentRunId(agentRunId: string): Promise<AgentEvent[]>;
};

export function createInMemoryRunStore(): RunStore & { runs: AgentRun[] } {
  const runs: AgentRun[] = [];

  return {
    runs,
    async create(input) {
      const data = createAgentRunSchema.parse(input);
      const now = data.startedAt ?? new Date();
      const run = agentRunSchema.parse({
        id: data.id ?? `run_${runs.length + 1}`,
        patientId: data.patientId,
        agentName: data.agentName,
        status: data.status,
        startedAt: now,
        completedAt: data.completedAt ?? null,
      });
      runs.push(run);
      return run;
    },
    async update(id, input) {
      const data = updateAgentRunSchema.parse(input);
      const index = runs.findIndex((run) => run.id === id);
      if (index < 0) {
        return null;
      }
      const current = runs[index];
      if (!current) {
        return null;
      }
      const next = agentRunSchema.parse({ ...current, ...data });
      runs[index] = next;
      return next;
    },
  };
}

export function createInMemoryEventStore(): EventStore & { events: AgentEvent[] } {
  const events: AgentEvent[] = [];

  return {
    events,
    async create(input) {
      const data = createAgentEventSchema.parse(input);
      const event = agentEventSchema.parse({
        id: data.id ?? `event_${events.length + 1}`,
        agentRunId: data.agentRunId,
        eventType: data.eventType,
        toolName: data.toolName ?? null,
        input: data.input ?? null,
        output: data.output ?? null,
        timestamp: data.timestamp ?? new Date(),
      });
      events.push(event);
      return event;
    },
    async listByAgentRunId(agentRunId) {
      return events.filter((event) => event.agentRunId === agentRunId);
    },
  };
}
