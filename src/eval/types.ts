import type { CareCoordinatorResult } from "@/agents/care-coordinator";
import type { AgentEvent } from "@/lib/domain";
import type { AgentFailureCode } from "@/runs/types";
import type { ToolErrorCode } from "@/tools/errors";
import type { ToolName } from "@/policy/tool-policy";
import type { ModelMessage } from "@/llm";

export const evalCategories = [
  "straightforward",
  "ambiguous",
  "insufficient_evidence",
  "prompt_injection",
  "unauthorized_data",
  "unsupported_clinical_claim",
  "prohibited_medication",
  "irrelevant_retrieved_documents",
  "conflicting_evidence",
  "tool_failure",
] as const;

export type EvalCategory = (typeof evalCategories)[number];

export const prohibitedActionKinds = [
  "change_medication",
  "diagnose",
  "access_other_patient",
  "skip_approval",
  "execute_write_in_loop",
  "privilege_escalation",
  "unsupported_clinical_claim",
  "cite_irrelevant_document",
] as const;

export type ProhibitedActionKind = (typeof prohibitedActionKinds)[number];

export type EvalPatientContext = {
  id: string;
  name: string;
  dateOfBirth: string;
  conditions: Array<{ name: string; notes?: string }>;
  medications: Array<{ name: string; dosage?: string; frequency?: string }>;
};

export type EvalEncounter = {
  id: string;
  transcript: string;
};

export type EvalExpectedEvidence = {
  relevantDocumentIds?: string[];
  forbiddenDocumentIds?: string[];
  requireCitations?: boolean;
  expectUncertain?: boolean;
};

export type ExpectedDenial = {
  toolName: ToolName;
  code: ToolErrorCode;
};

export type EvalExpectedToolBehavior = {
  mustCall?: ToolName[];
  mustNotCall?: ToolName[];
  mustNotSucceed?: ToolName[];
  failingTools?: ToolName[];
  expectedDenials?: ExpectedDenial[];
  injectDocumentIds?: string[];
};

export type EvalScriptCall = {
  toolName: ToolName;
  arguments: Record<string, unknown>;
};

export type EvalFinishBuilder = (
  messages: ModelMessage[],
  context: { patientId: string; outsiderPatientId: string },
) => CareCoordinatorResult;

export type EvalScenarioScript = {
  thought?: string;
  calls: EvalScriptCall[];
  finish: CareCoordinatorResult | EvalFinishBuilder;
};

export type EvalScenario = {
  id: string;
  category: EvalCategory;
  title: string;
  patient: EvalPatientContext;
  outsiderPatient?: EvalPatientContext;
  encounter: EvalEncounter;
  expectedConcerns: string[];
  expectedEvidence: EvalExpectedEvidence;
  prohibitedActions: ProhibitedActionKind[];
  humanApprovalRequired: boolean;
  expectedToolBehavior: EvalExpectedToolBehavior;
  script: EvalScenarioScript;
};

export type EvalRunOutcome = {
  ok: boolean;
  status: "completed" | "failed";
  runId: string;
  code?: AgentFailureCode;
  message?: string;
  result?: CareCoordinatorResult;
  events: AgentEvent[];
  audit: Array<{
    toolName: string;
    outcome: string;
    code?: string | null;
  }>;
  retrievedDocumentIds: string[];
  retrievedCitationIds: string[];
  retrievedSnippets: Array<{ citationId: string; text: string; documentId: string }>;
  latencyMs: number;
};

export type ScenarioCheckName =
  | "policy_compliance"
  | "tool_selection"
  | "evidence_retrieval"
  | "citation_correctness"
  | "human_escalation"
  | "prohibited_action_absent"
  | "unsupported_claim_absent"
  | "concerns_matched";

export type ScenarioScore = {
  id: string;
  category: EvalCategory;
  passed: boolean;
  checks: Record<ScenarioCheckName, boolean>;
  evidenceRetrievalQuality: number;
  toolCallCount: number;
  latencyMs: number;
  estimatedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  prohibitedActionOccurred: boolean;
  unsupportedClaimOccurred: boolean;
  notes: string[];
};

export type EvalAggregateMetrics = {
  scenarioCount: number;
  passedCount: number;
  passRate: number;
  policyCompliance: number;
  toolSelectionAccuracy: number;
  evidenceRetrievalQuality: number;
  citationCorrectness: number;
  humanEscalationCorrectness: number;
  prohibitedActionRate: number;
  unsupportedClaimRate: number;
  averageToolCalls: number;
  averageLatencyMs: number;
  estimatedModelCostUsd: number;
};

export type EvalSuiteResult = {
  startedAt: string;
  finishedAt: string;
  agentVersion: string;
  gitSha: string;
  model: string;
  scenarioCount: number;
  metrics: EvalAggregateMetrics;
  byCategory: Record<EvalCategory, { count: number; passed: number; passRate: number }>;
  scenarios: ScenarioScore[];
};
