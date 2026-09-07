import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createScriptedModelProvider, decodeStructured, ModelError } from "@/llm";

const stepSchema = z
  .object({
    type: z.literal("think"),
    thought: z.string(),
  })
  .strict();

describe("decodeStructured", () => {
  it("parses JSON text into the schema", () => {
    const step = decodeStructured(
      JSON.stringify({ type: "think", thought: "gather context" }),
      stepSchema,
      "TestStep",
    );
    expect(step.thought).toBe("gather context");
  });

  it("rejects extra keys and empty responses", () => {
    expect(() =>
      decodeStructured({ type: "think", thought: "x", extra: true }, stepSchema, "TestStep"),
    ).toThrow(ModelError);

    expect(() => decodeStructured("   ", stepSchema, "TestStep")).toThrow(/empty/i);
  });
});

describe("createScriptedModelProvider", () => {
  it("returns queued steps and then fails closed", async () => {
    const provider = createScriptedModelProvider([{ type: "think", thought: "one" }]);
    const first = await provider.complete({
      messages: [],
      schemaName: "TestStep",
    });
    expect(first.content).toEqual({ type: "think", thought: "one" });

    await expect(
      provider.complete({ messages: [], schemaName: "TestStep" }),
    ).rejects.toMatchObject({ code: "EMPTY_RESPONSE" });
  });
});
