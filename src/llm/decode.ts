import type { z } from "zod";

import { ModelError } from "./errors";

export function decodeStructured<T>(
  content: unknown,
  schema: z.ZodType<T>,
  schemaName: string,
): T {
  const value = normalizeContent(content);
  if (value === undefined) {
    throw new ModelError("EMPTY_RESPONSE", `${schemaName} response was empty`);
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ModelError("SCHEMA_FAILURE", `${schemaName} failed schema validation`, {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  return parsed.data;
}

function normalizeContent(content: unknown): unknown {
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new ModelError("SCHEMA_FAILURE", "model response was not valid JSON");
    }
  }

  return content;
}
