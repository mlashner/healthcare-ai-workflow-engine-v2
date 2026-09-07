import { describe, expect, it } from "vitest";

import { isSameOriginRequest } from "@/authz/origin";

function requestAt(path: string, headers: Record<string, string>): Request {
  return new Request(`http://localhost:3000${path}`, { method: "POST", headers });
}

describe("isSameOriginRequest", () => {
  it("accepts an Origin that matches the request URL", () => {
    expect(
      isSameOriginRequest(requestAt("/api/reviews/run/actions/a", { origin: "http://localhost:3000" })),
    ).toBe(true);
  });

  it("rejects a cross-site Origin", () => {
    expect(
      isSameOriginRequest(requestAt("/api/reviews/run/actions/a", { origin: "https://evil.example" })),
    ).toBe(false);
  });

  it("accepts a Referer on the same origin when Origin is absent", () => {
    expect(
      isSameOriginRequest(
        requestAt("/api/reviews/run/actions/a", { referer: "http://localhost:3000/reviews/run" }),
      ),
    ).toBe(true);
  });

  it("rejects a cookie-authenticated request with neither Origin nor Referer", () => {
    expect(isSameOriginRequest(requestAt("/api/reviews/run/actions/a", {}))).toBe(false);
  });
});
