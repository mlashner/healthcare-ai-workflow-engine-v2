import type { AgentEvent, AgentRunStatus } from "@/lib/domain";

export type AgentFailureCode =
  | "BUDGET_EXHAUSTED"
  | "SCHEMA_FAILURE"
  | "PROVIDER_FAILURE"
  | "INVALID_RESULT";

export type AgentRunSuccess<TResult> = {
  ok: true;
  status: Extract<AgentRunStatus, "completed">;
  runId: string;
  result: TResult;
  events: AgentEvent[];
};

export type AgentRunFailure = {
  ok: false;
  status: Extract<AgentRunStatus, "failed">;
  runId: string;
  code: AgentFailureCode;
  message: string;
  events: AgentEvent[];
};

export type AgentRunOutcome<TResult> = AgentRunSuccess<TResult> | AgentRunFailure;
