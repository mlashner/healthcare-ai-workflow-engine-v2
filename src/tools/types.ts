import type { z } from "zod";

import type { ToolInvocationContext } from "@/authz/types";

import type { StructuredToolError } from "./errors";

export interface Tool<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema: z.ZodType<TOutput>;
  execute(input: TInput, context: ToolInvocationContext): Promise<TOutput>;
}

export type ToolSuccess<TOutput> = {
  ok: true;
  toolName: string;
  output: TOutput;
};

export type ToolFailure = {
  ok: false;
  toolName: string;
  error: StructuredToolError;
};

export type ToolInvocationResult<TOutput = unknown> = ToolSuccess<TOutput> | ToolFailure;

export type { ToolInvocationContext };
