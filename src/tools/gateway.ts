import { z } from "zod";

import { authorizeToolCall } from "@/authz/authorize";
import type { ToolInvocationContext } from "@/authz/types";
import type { AuditWriter } from "@/audit/writer";
import type { CreateAuditEvent } from "@/lib/domain";
import { logger } from "@/lib/logger";

import { ToolError, toStructuredError, type StructuredToolError } from "./errors";
import type { ToolRegistry } from "./registry";
import type { ToolFailure, ToolInvocationResult } from "./types";

export function createToolGateway(deps: { registry: ToolRegistry; audit: AuditWriter }) {
  return {
    async invoke(
      toolName: string,
      rawArgs: unknown,
      context: ToolInvocationContext,
    ): Promise<ToolInvocationResult> {
      const tool = deps.registry.resolve(toolName);
      if (!tool) {
        return failAndAudit(deps.audit, context, toolName, rawArgs, {
          code: "UNKNOWN_TOOL",
          message: `unknown tool: ${toolName}`,
        });
      }

      const parsed = tool.inputSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return failAndAudit(deps.audit, context, toolName, rawArgs, {
          code: "VALIDATION_ERROR",
          message: "invalid tool arguments",
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      }

      const decision = authorizeToolCall(context, toolName, parsed.data);
      if (!decision.allowed) {
        return failAndAudit(deps.audit, context, toolName, parsed.data, {
          code: decision.code,
          message: decision.reason,
        });
      }

      try {
        const output = await tool.execute(parsed.data, context);
        const checked = tool.outputSchema.parse(output);
        await writeAudit(deps.audit, {
          context,
          toolName,
          outcome: "executed",
          code: "OK",
          message: "tool executed",
          input: parsed.data,
        });
        return { ok: true, toolName, output: checked };
      } catch (error) {
        const structured = error instanceof z.ZodError
          ? {
              code: "EXECUTION_ERROR" as const,
              message: "tool output failed schema validation",
              details: error.issues,
            }
          : toStructuredError(error);

        return failAndAudit(deps.audit, context, toolName, parsed.data, structured);
      }
    },
  };
}

export type ToolGateway = ReturnType<typeof createToolGateway>;

async function failAndAudit(
  audit: AuditWriter,
  context: ToolInvocationContext,
  toolName: string,
  input: unknown,
  error: StructuredToolError,
): Promise<ToolFailure> {
  const outcome =
    error.code === "VALIDATION_ERROR"
      ? "validation_error"
      : error.code === "UNKNOWN_TOOL"
        ? "unknown_tool"
        : error.code === "UNAUTHORIZED" || error.code === "POLICY_DENIED"
          ? "denied"
          : "execution_error";

  await writeAudit(audit, {
    context,
    toolName,
    outcome,
    code: error.code,
    message: error.message,
    input,
    details: error.details,
  });

  logger.warn("tool.denied", {
    toolName,
    code: error.code,
    agentRunId: context.agentRunId,
  });

  return { ok: false, toolName, error };
}

async function writeAudit(
  audit: AuditWriter,
  event: {
    context: ToolInvocationContext;
    toolName: string;
    outcome: CreateAuditEvent["outcome"];
    code: string;
    message: string;
    input: unknown;
    details?: unknown;
  },
): Promise<void> {
  await audit.record({
    agentRunId: event.context.agentRunId,
    toolName: event.toolName,
    outcome: event.outcome,
    code: event.code,
    message: event.message,
    actorId: event.context.actor.id,
    agentName: event.context.agentName,
    patientScope: event.context.patientScope,
    input: event.input,
    details: event.details,
  });
}

export function isToolError(error: unknown): error is ToolError {
  return error instanceof ToolError;
}
