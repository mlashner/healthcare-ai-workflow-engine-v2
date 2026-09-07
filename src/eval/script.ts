import {
  createScriptedModelProvider,
  isModelError,
  type ModelMessage,
  type ModelProvider,
  type ScriptedStep,
} from "@/llm";

import type { EvalScenario } from "./types";

export function buildScenarioScript(scenario: EvalScenario): ScriptedStep[] {
  const steps: ScriptedStep[] = [];
  if (scenario.script.thought) {
    steps.push({ type: "think", thought: scenario.script.thought });
  }
  for (const call of scenario.script.calls) {
    steps.push({
      type: "tool_call",
      toolName: call.toolName,
      arguments: call.arguments,
    });
  }
  const finish = scenario.script.finish;
  steps.push((messages: ModelMessage[]) => ({
    type: "finish",
    result:
      typeof finish === "function"
        ? finish(messages, {
            patientId: scenario.patient.id,
            outsiderPatientId: scenario.outsiderPatient?.id ?? "pat_out",
          })
        : finish,
  }));
  return steps;
}

/**
 * Repeats the last finish if the loop retries after a safety rejection.
 * Production scripted providers fail closed when the script is exhausted;
 * eval wants to observe the control plane's retry-then-fail-closed path.
 */
export function createEvalModelProvider(script: ScriptedStep[]): ModelProvider {
  const inner = createScriptedModelProvider(script);
  let lastFinish: unknown;

  return {
    async complete(request) {
      try {
        const completion = await inner.complete(request);
        if (isFinishStep(completion.content)) {
          lastFinish = completion.content;
        }
        return completion;
      } catch (error) {
        if (lastFinish !== undefined && isEmptyScriptError(error)) {
          return { content: lastFinish };
        }
        throw error;
      }
    },
  };
}

function isFinishStep(content: unknown): boolean {
  return (
    typeof content === "object" &&
    content !== null &&
    "type" in content &&
    (content as { type: unknown }).type === "finish"
  );
}

function isEmptyScriptError(error: unknown): boolean {
  return isModelError(error) && /no remaining steps/i.test(error.message);
}
