import { describe, expect, it } from "vitest";

import { hashJson, stableStringify } from "@/tools/hash";

describe("stableStringify", () => {
  it("hashes the same object regardless of insertion order", () => {
    const left = { patientId: "p", priority: "medium", type: "follow_up" };
    const right = { type: "follow_up", patientId: "p", priority: "medium" };

    expect(hashJson(left)).toBe(hashJson(right));
    expect(stableStringify(left)).toBe(stableStringify(right));
  });

  it("orders keys by code unit, independent of locale collation", () => {
    const precomposed = "\u00e1";
    const decomposed = "a\u0301";
    expect(precomposed.localeCompare(decomposed)).toBe(0);

    const first: Record<string, number> = {};
    first[precomposed] = 1;
    first[decomposed] = 2;
    const second: Record<string, number> = {};
    second[decomposed] = 2;
    second[precomposed] = 1;

    expect(stableStringify(first)).toBe(stableStringify(second));
    expect(hashJson(first)).toBe(hashJson(second));
  });

  it("omits undefined-valued properties, matching JSON/jsonb storage", () => {
    const withUndefined = { a: 1, b: undefined as unknown as string };
    const stored = JSON.parse(JSON.stringify(withUndefined)) as { a: number };

    expect(stableStringify(withUndefined)).toBe(stableStringify(stored));
    expect(hashJson(withUndefined)).toBe(hashJson(stored));
    expect(stableStringify(withUndefined)).toBe('{"a":1}');
  });

  it("treats an explicit undefined array slot like JSON null", () => {
    expect(stableStringify([1, undefined, 2])).toBe("[1,null,2]");
  });
});
