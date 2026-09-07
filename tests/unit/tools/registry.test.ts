import { describe, expect, it } from "vitest";

import { createGetPatientContextTool } from "@/tools/definitions";
import { ToolRegistry } from "@/tools/registry";

describe("ToolRegistry", () => {
  it("registers and resolves tools by name", () => {
    const registry = new ToolRegistry().register(
      createGetPatientContextTool({
        getById: async () => null,
      }),
    );

    expect(registry.has("getPatientContext")).toBe(true);
    expect(registry.resolve("getPatientContext")?.name).toBe("getPatientContext");
    expect(registry.names()).toEqual(["getPatientContext"]);
  });

  it("returns undefined for an unregistered tool", () => {
    expect(new ToolRegistry().resolve("executeSql")).toBeUndefined();
  });

  it("refuses duplicate registration", () => {
    const tool = createGetPatientContextTool({ getById: async () => null });
    const registry = new ToolRegistry().register(tool);

    expect(() => registry.register(tool)).toThrow(/already registered/);
  });
});
