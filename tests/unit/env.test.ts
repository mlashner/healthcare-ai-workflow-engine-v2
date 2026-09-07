import { afterEach, describe, expect, it } from "vitest";

import { loadEnv, resetEnvCache } from "@/lib/env";

afterEach(() => {
  resetEnvCache();
});

describe("loadEnv", () => {
  it("accepts a valid postgres connection string", () => {
    const env = loadEnv({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://carepilot:carepilot@localhost:5432/carepilot",
      LOG_LEVEL: "debug",
    });

    expect(env.DATABASE_URL).toContain("postgres://");
    expect(env.LOG_LEVEL).toBe("debug");
    expect(env.NODE_ENV).toBe("test");
  });

  it("defaults NODE_ENV and LOG_LEVEL", () => {
    const env = loadEnv({
      DATABASE_URL: "postgresql://carepilot:carepilot@localhost:5432/carepilot",
    });

    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => loadEnv({ NODE_ENV: "test" })).toThrow(/DATABASE_URL/);
  });

  it("rejects a non-postgres DATABASE_URL", () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: "mysql://localhost/carepilot",
      }),
    ).toThrow(/postgres/);
  });
});
