import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { loadEnv, resetEnvCache } from "@/lib/env";
import { applyDotenvFile } from "@/lib/load-dotenv";

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

describe("applyDotenvFile", () => {
  const previousUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (previousUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousUrl;
    }
    delete process.env.CAREPILOT_DOTENV_PROBE;
  });

  it("fills unset keys from the file and does not override existing ones", () => {
    const directory = join(tmpdir(), `carepilot-dotenv-${Date.now()}`);
    mkdirSync(directory, { recursive: true });
    const filePath = join(directory, ".env");
    writeFileSync(
      filePath,
      [
        "# comment",
        "DATABASE_URL=postgres://from-file/carepilot",
        "CAREPILOT_DOTENV_PROBE=from-file",
        "",
      ].join("\n"),
    );

    process.env.DATABASE_URL = "postgres://already-set/carepilot";
    delete process.env.CAREPILOT_DOTENV_PROBE;

    applyDotenvFile(filePath);

    expect(process.env.DATABASE_URL).toBe("postgres://already-set/carepilot");
    expect(process.env.CAREPILOT_DOTENV_PROBE).toBe("from-file");
  });
});
