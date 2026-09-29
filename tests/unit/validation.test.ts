import { describe, expect, it } from "vitest";
import { newPasswordSchema, registerSchema, signInSchema } from "@/lib/validation/auth";
import {
  childProfileSchema,
  isPlausibleDateOfBirth,
  parentProfileSchema,
  readChildProfileForm,
} from "@/lib/validation/family";
import { fieldErrors } from "@/lib/validation/shared";
import { isValidTimeZone, listTimeZones } from "@/lib/validation/time-zone";

const LEVEL = "11111111-1111-4111-8111-111111111111";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

describe("auth validation", () => {
  it("normalises email and requires a password to sign in", () => {
    expect(signInSchema.parse({ email: "  Parent@Example.COM ", password: "x" }).email).toBe(
      "parent@example.com",
    );
    expect(signInSchema.safeParse({ email: "parent@example.com", password: "" }).success).toBe(false);
  });

  it("enforces password length on registration (8–72, bcrypt's limit)", () => {
    const base = { email: "p@example.com", displayName: "Sam" };
    expect(registerSchema.safeParse({ ...base, password: "short" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: "x".repeat(73) }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: "long enough" }).success).toBe(true);
  });

  it("requires a name to register", () => {
    const result = registerSchema.safeParse({
      email: "p@example.com",
      password: "long enough",
      displayName: "  ",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error)).toEqual({ displayName: "Tell us your name." });
  });

  it("requires the repeated password to match", () => {
    const result = newPasswordSchema.safeParse({
      password: "new password 1",
      confirmPassword: "new password 2",
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(fieldErrors(result.error)).toEqual({ confirmPassword: "The passwords don't match." });
  });
});

describe("child profile validation", () => {
  const valid = { name: " Mia ", avatar: "owl", gradeLevelId: LEVEL, dailyMinutes: "15" };

  it("accepts a valid profile, trimming the name and making date of birth optional", () => {
    expect(childProfileSchema.parse(valid)).toEqual({
      name: "Mia",
      avatar: "owl",
      dateOfBirth: null,
      gradeLevelId: LEVEL,
      dailyMinutes: 15,
    });
  });

  it.each([
    ["name", { name: "" }],
    ["name", { name: "x".repeat(41) }],
    ["avatar", { avatar: "dragon" }],
    ["gradeLevelId", { gradeLevelId: "KG1" }],
    ["dailyMinutes", { dailyMinutes: "12" }],
    ["dateOfBirth", { dateOfBirth: "2099-01-01" }],
  ])("rejects an invalid %s", (field, change) => {
    const result = childProfileSchema.safeParse({ ...valid, ...change });
    expect(result.success).toBe(false);
    if (!result.success) expect(Object.keys(fieldErrors(result.error))).toEqual([field]);
  });

  it("reads optional fields from a form, treating blanks as absent", () => {
    const result = readChildProfileForm(form({ ...valid, dateOfBirth: "", currentLevelId: "" }));
    expect(result.success && result.data.currentLevelId).toBeUndefined();
    const withLevel = readChildProfileForm(
      form({ ...valid, currentLevelId: LEVEL, dateOfBirth: "2021-03-04" }),
    );
    expect(withLevel.success && withLevel.data).toMatchObject({
      currentLevelId: LEVEL,
      dateOfBirth: "2021-03-04",
    });
  });

  it("checks dates of birth are real, not in the future and not implausibly old", () => {
    const today = new Date("2026-09-29T12:00:00Z");
    expect(isPlausibleDateOfBirth("2021-02-28", today)).toBe(true);
    expect(isPlausibleDateOfBirth("2021-02-30", today)).toBe(false);
    expect(isPlausibleDateOfBirth("2026-10-01", today)).toBe(false);
    expect(isPlausibleDateOfBirth("1999-12-31", today)).toBe(false);
    expect(isPlausibleDateOfBirth("03/04/2021", today)).toBe(false);
  });
});

describe("parent profile and time zones", () => {
  it("accepts real IANA time zones and rejects others", () => {
    expect(isValidTimeZone("Asia/Dubai")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("lists time zones including UTC", () => {
    const zones = listTimeZones();
    expect(zones).toContain("UTC");
    expect(zones).toContain("America/New_York");
  });

  it("validates the parent profile form", () => {
    expect(parentProfileSchema.safeParse({ displayName: "Sam", timezone: "Europe/London" }).success).toBe(
      true,
    );
    const bad = parentProfileSchema.safeParse({ displayName: "", timezone: "Nowhere" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(Object.keys(fieldErrors(bad.error)).sort()).toEqual(["displayName", "timezone"]);
  });
});
