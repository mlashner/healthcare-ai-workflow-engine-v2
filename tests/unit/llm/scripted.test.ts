import { describe, expect, it, vi } from "vitest";

import {
  createFailingModelProvider,
  createModelProvider,
  createScriptedModelProvider,
  createTimedModelProvider,
  ModelError,
  type ModelMessage,
  type ModelProvider,
} from "@/llm";

describe("createScriptedModelProvider", () => {
  it("exposes metadata, usage, and a stream of the scripted step", async () => {
    const provider = createScriptedModelProvider([{ type: "think", thought: "one" }], {
      model: "fake-v1",
    });

    expect(provider.metadata).toMatchObject({
      id: "scripted",
      model: "fake-v1",
      supportsStructuredOutput: true,
      supportsToolCalling: true,
      supportsStreaming: true,
    });

    const completion = await provider.complete({
      messages: [{ role: "user", content: "hello" }],
      schemaName: "TestStep",
    });
    expect(completion.content).toEqual({ type: "think", thought: "one" });
    expect(completion.finishReason).toBe("stop");
    expect(completion.usage.inputTokens).toBeGreaterThan(0);
    expect(completion.usage.outputTokens).toBeGreaterThan(0);
    expect(completion.usage.estimatedCostUsd).toBeGreaterThanOrEqual(0);
  });

  it("streams a completed event for the next scripted step", async () => {
    const provider = createScriptedModelProvider([{ type: "think", thought: "streamed" }]);
    const events = [];
    for await (const event of provider.stream({
      messages: [],
      schemaName: "TestStep",
    })) {
      events.push(event);
    }
    expect(events.at(-1)).toEqual({
      type: "completed",
      completion: expect.objectContaining({
        content: { type: "think", thought: "streamed" },
      }),
    });
  });

  it("returns queued steps and then fails closed", async () => {
    const provider = createScriptedModelProvider([{ type: "think", thought: "one" }]);
    await provider.complete({ messages: [], schemaName: "TestStep" });

    await expect(provider.complete({ messages: [], schemaName: "TestStep" })).rejects.toMatchObject({
      code: "EMPTY_RESPONSE",
    });
  });

  it("accepts a function step that sees prior messages", async () => {
    const provider = createScriptedModelProvider([
      (messages: ModelMessage[]) => ({
        type: "think",
        thought: JSON.stringify(messages).slice(0, 40),
      }),
    ]);
    const completion = await provider.complete({
      messages: [{ role: "system", content: "rules" }],
      schemaName: "TestStep",
    });
    expect(JSON.stringify(completion.content)).toContain("rules");
  });
});

describe("createFailingModelProvider", () => {
  it("surfaces the injected error through complete and stream", async () => {
    const provider = createFailingModelProvider(new ModelError("TIMEOUT", "provider timed out"));
    await expect(provider.complete({ messages: [], schemaName: "TestStep" })).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    const iterator = provider.stream({ messages: [], schemaName: "TestStep" })[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});

describe("createTimedModelProvider", () => {
  it("preserves metadata and times out a hanging complete", async () => {
    const hanging: ModelProvider = {
      metadata: {
        id: "failing",
        displayName: "Failing fake",
        model: "failing",
        supportsStructuredOutput: false,
        supportsToolCalling: false,
        supportsStreaming: false,
      },
      complete: () => new Promise(() => undefined),
      async *stream() {
        throw new Error("unused");
      },
    };
    const timed = createTimedModelProvider(hanging, 20);
    expect(timed.metadata.id).toBe("failing");
    await expect(timed.complete({ messages: [], schemaName: "TestStep" })).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });
});

describe("createModelProvider factory", () => {
  it("constructs a scripted provider without the caller knowing the adapter file", async () => {
    const provider = createModelProvider({
      kind: "scripted",
      script: [{ type: "finish", result: { ok: true } }],
      model: "eval-fake",
    });
    expect(provider.metadata.id).toBe("scripted");
    const completion = await provider.complete({ messages: [], schemaName: "TestStep" });
    expect(completion.content).toEqual({ type: "finish", result: { ok: true } });
  });

  it("constructs an openai-compatible provider from the same factory", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "{\"type\":\"think\",\"thought\":\"ok\"}" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = createModelProvider({
      kind: "openai_compatible",
      apiKey: "sk-test",
      model: "gpt-demo",
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(provider.metadata.id).toBe("openai_compatible");
    const completion = await provider.complete({
      messages: [{ role: "user", content: "hi" }],
      schemaName: "CareCoordinatorStep",
    });
    expect(completion.content).toEqual({ type: "think", thought: "ok" });
    expect(completion.usage.inputTokens).toBe(10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
