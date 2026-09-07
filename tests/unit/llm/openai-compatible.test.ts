import { describe, expect, it, vi } from "vitest";

import { createOpenAiCompatibleProvider, ModelError } from "@/llm";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createOpenAiCompatibleProvider", () => {
  it("maps a JSON chat completion into structured content and usage", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify({ type: "think", thought: "gather context" }) },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
      });
    });

    const provider = createOpenAiCompatibleProvider({
      apiKey: "sk-test",
      model: "demo-mini",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const completion = await provider.complete({
      messages: [
        { role: "system", content: { rules: true } },
        { role: "tool", name: "getPatientContext", content: { ok: true } },
      ],
      schemaName: "CareCoordinatorStep",
      jsonSchema: { type: "object" },
    });

    expect(completion.content).toEqual({ type: "think", thought: "gather context" });
    expect(completion.finishReason).toBe("stop");
    expect(completion.usage).toMatchObject({
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
    });
    expect(completion.usage.estimatedCostUsd).toBeGreaterThan(0);
    expect(provider.metadata.supportsStreaming).toBe(true);

    expect(requestBody?.response_format).toEqual(
      expect.objectContaining({ type: "json_schema" }),
    );
    const sentMessages = requestBody?.messages as Array<{ role: string; content: string }>;
    expect(sentMessages[1]?.content).toMatch(/^Tool observation/);
  });

  it("maps native tool calls into CarePilot tool_call content", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  function: {
                    name: "getPatientContext",
                    arguments: JSON.stringify({ patientId: "pat_s01" }),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }),
    );

    const provider = createOpenAiCompatibleProvider({
      apiKey: "sk-test",
      model: "demo-mini",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const completion = await provider.complete({
      messages: [{ role: "user", content: "context" }],
      schemaName: "CareCoordinatorStep",
      tools: [
        {
          name: "getPatientContext",
          description: "Read the bound patient chart.",
          parameters: { type: "object" },
        },
      ],
    });

    expect(completion.finishReason).toBe("tool_call");
    expect(completion.toolCalls).toEqual([
      { id: "call_1", name: "getPatientContext", arguments: { patientId: "pat_s01" } },
    ]);
    expect(completion.content).toEqual({
      type: "tool_call",
      toolName: "getPatientContext",
      arguments: { patientId: "pat_s01" },
    });
  });

  it("maps HTTP 429 to RATE_LIMITED and never includes the API key in the error", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { message: "rate limited" } }, 429),
    );
    const provider = createOpenAiCompatibleProvider({
      apiKey: "sk-secret-key",
      model: "demo-mini",
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(
      provider.complete({ messages: [], schemaName: "CareCoordinatorStep" }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ModelError);
      expect(error).toMatchObject({ code: "RATE_LIMITED" });
      expect(String(error)).not.toContain("sk-secret-key");
      return true;
    });
  });

  it("streams deltas then a completed event", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"{\\"type\\":\\"think\\""}}]}',
      'data: {"choices":[{"delta":{"content":",\\"thought\\":\\"x\\"}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}',
      "data: [DONE]",
    ].join("\n");

    const fetchMock = vi.fn(async () => new Response(sse, { status: 200 }));
    const provider = createOpenAiCompatibleProvider({
      apiKey: "sk-test",
      model: "demo-mini",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const events = [];
    for await (const event of provider.stream({
      messages: [{ role: "user", content: "hi" }],
      schemaName: "CareCoordinatorStep",
    })) {
      events.push(event);
    }

    expect(events.some((event) => event.type === "delta")).toBe(true);
    const completed = events.at(-1);
    expect(completed).toMatchObject({ type: "completed" });
    if (completed && completed.type === "completed") {
      expect(completed.completion.content).toEqual({ type: "think", thought: "x" });
      expect(completed.completion.usage.inputTokens).toBe(1);
    }
  });
});
