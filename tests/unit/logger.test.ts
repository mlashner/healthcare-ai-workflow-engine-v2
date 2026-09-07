import { afterEach, describe, expect, it, vi } from "vitest";

import { log, redact } from "@/lib/logger";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("redact", () => {
  it("replaces sensitive keys and leaves other fields intact", () => {
    expect(
      redact({
        patientId: "demo-001",
        DATABASE_URL: "postgres://carepilot:carepilot@localhost:5432/carepilot",
        apiKey: "abc",
        nested: { authorization: "Bearer secret", ok: true },
      }),
    ).toEqual({
      patientId: "demo-001",
      DATABASE_URL: "[redacted]",
      apiKey: "[redacted]",
      nested: { authorization: "[redacted]", ok: true },
    });
  });

  it("leaves model token counts intact while redacting secret tokens", () => {
    expect(
      redact({
        inputTokens: 120,
        outputTokens: 40,
        access_token: "sk-secret",
        token: "session",
      }),
    ).toEqual({
      inputTokens: 120,
      outputTokens: 40,
      access_token: "[redacted]",
      token: "[redacted]",
    });
  });
});

describe("log", () => {
  it("writes a JSON line and redacts secrets in fields", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    log("info", "db.connect", {
      host: "localhost",
      password: "super-secret",
    });

    expect(info).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(info.mock.calls[0]?.[0]));
    expect(payload.message).toBe("db.connect");
    expect(payload.level).toBe("info");
    expect(payload.host).toBe("localhost");
    expect(payload.password).toBe("[redacted]");
    expect(payload.ts).toEqual(expect.any(String));
  });
});

describe("demographic redaction", () => {
  it("redacts chart demographics without blanking toolName", () => {
    expect(
      redact({
        toolName: "getPatientContext",
        name: "Ava Nguyen (FICTIONAL)",
        dateOfBirth: "1978-06-21",
        transcript: "FICTIONAL ENCOUNTER",
      }),
    ).toEqual({
      toolName: "getPatientContext",
      name: "[redacted]",
      dateOfBirth: "[redacted]",
      transcript: "[redacted]",
    });
  });
});
