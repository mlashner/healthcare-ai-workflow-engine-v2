import { afterAll, describe, expect, it } from "vitest";

import { closeDb, getDb, pingDatabase } from "@/lib/db";
import { schemaInfo } from "@/lib/db/schema";

describe("database connection", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("pings PostgreSQL", async () => {
    await expect(pingDatabase()).resolves.toBeUndefined();
  });

  it("reads control-plane schema_info after migrations", async () => {
    const rows = await getDb().select().from(schemaInfo);
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row.value]));

    expect(byKey.app_name).toBe("carepilot");
    expect(byKey.data_classification).toBe("fictional");
  });
});
