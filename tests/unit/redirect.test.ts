import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/redirect";

describe("safeNextPath", () => {
  it.each([
    ["/child/home", "/child/home"],
    ["/parent/dashboard?child=1", "/parent/dashboard?child=1"],
    ["//evil.example", "/fallback"],
    ["/\\evil.example", "/fallback"],
    ["https://evil.example", "/fallback"],
    // Browsers drop tabs/newlines while parsing, turning these into //evil.example.
    ["/\t/evil.example", "/fallback"],
    ["/\n/evil.example", "/fallback"],
    ["/\r/evil.example", "/fallback"],
    [`/${String.fromCharCode(0)}/evil.example`, "/fallback"],
    ["/\\/evil.example", "/fallback"],
    ["/%2F/evil.example", "/%2F/evil.example"],
    ["/child/learn/abc#step-2", "/child/learn/abc#step-2"],
    ["javascript:alert(1)", "/fallback"],
    ["", "/fallback"],
    [null, "/fallback"],
  ])("%j → %s", (input, expected) => {
    expect(safeNextPath(input, "/fallback")).toBe(expected);
  });
});
