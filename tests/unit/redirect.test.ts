import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/redirect";

describe("safeNextPath", () => {
  it.each([
    ["/child/home", "/child/home"],
    ["/parent/dashboard?child=1", "/parent/dashboard?child=1"],
    ["//evil.example", "/fallback"],
    ["/\\evil.example", "/fallback"],
    ["https://evil.example", "/fallback"],
    ["", "/fallback"],
    [null, "/fallback"],
  ])("%j → %s", (input, expected) => {
    expect(safeNextPath(input, "/fallback")).toBe(expected);
  });
});
