import { describe, expect, it } from "vitest";

import { buildHealthStatus } from "@/lib/health";

describe("buildHealthStatus", () => {
  it("reports ok when the database ping succeeds", async () => {
    const status = await buildHealthStatus(async () => undefined);

    expect(status.status).toBe("ok");
    expect(status.service).toBe("carepilot");
    expect(status.checks.database).toBe("ok");
    expect(status.timestamp).toEqual(expect.any(String));
  });

  it("reports degraded when the database ping fails", async () => {
    const status = await buildHealthStatus(async () => {
      throw new Error("connection refused");
    });

    expect(status.status).toBe("degraded");
    expect(status.checks.database).toBe("error");
  });
});
