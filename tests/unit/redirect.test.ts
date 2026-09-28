import { describe, expect, it } from "vitest";
import { isSafeRedirectPath, safeRedirectPath } from "@/lib/core/redirect";

describe("a ?next= redirect only ever stays on this site", () => {
  it("accepts plain paths, with queries and fragments", () => {
    for (const p of ["/", "/jobs", "/jobs/123?tab=pay", "/book?job=abc#step-2"]) expect(isSafeRedirectPath(p), p).toBe(true);
  });

  it("rejects other origins however they are spelled", () => {
    const bad = ["//evil.com", "/\\evil.com", "\\\\evil.com", "https://evil.com", "evil.com", "/\t/evil.com", "/\n/evil.com", " /jobs", "/jobs\\x", ""];
    for (const p of bad) expect(isSafeRedirectPath(p), JSON.stringify(p)).toBe(false);
    expect(isSafeRedirectPath(null)).toBe(false);
    expect(isSafeRedirectPath(undefined)).toBe(false);
  });

  it("falls back when the value is unsafe", () => {
    expect(safeRedirectPath("//evil.com", "/jobs")).toBe("/jobs");
    expect(safeRedirectPath("/account", "/jobs")).toBe("/account");
  });
});
