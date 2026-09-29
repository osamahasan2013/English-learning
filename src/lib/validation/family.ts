import { z } from "zod";
import { AVATAR_KEYS } from "@/lib/avatars";
import { DAILY_MINUTE_OPTIONS } from "@/lib/learning/daily-plan";
import { isValidTimeZone } from "@/lib/validation/time-zone";

// Child and parent profile validation, shared by Server Actions and unit tests. The
// database enforces the essentials again (constraints, triggers, RLS).

// Mirrors public.enforce_child_rules() (migration 20260930100100).
export const MAX_CHILDREN_PER_FAMILY = 12;

const OLDEST_DATE_OF_BIRTH = "2000-01-02";

export function isPlausibleDateOfBirth(value: string, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  return value >= OLDEST_DATE_OF_BIRTH && date <= today;
}

export const childProfileSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(40, "Use 40 characters or fewer."),
  avatar: z.enum(AVATAR_KEYS as [string, ...string[]], { message: "Choose an avatar." }),
  dateOfBirth: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || isPlausibleDateOfBirth(v), { message: "Enter a valid date of birth." }),
  gradeLevelId: z.string().uuid("Choose a grade."),
  // Only on edit: the level lessons come from (defaults to the grade on create).
  currentLevelId: z.string().uuid("Choose a level.").optional(),
  dailyMinutes: z.coerce.number().refine((n) => (DAILY_MINUTE_OPTIONS as readonly number[]).includes(n), {
    message: "Choose a daily time.",
  }),
});
export type ChildProfileInput = z.infer<typeof childProfileSchema>;

export function readChildProfileForm(formData: FormData) {
  const optional = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" && value !== "" ? value : undefined;
  };
  // A select left on its disabled placeholder is not submitted at all: read missing
  // required fields as "" so the parent gets the field's own message.
  return childProfileSchema.safeParse({
    name: formData.get("name") ?? "",
    avatar: formData.get("avatar") ?? "",
    dateOfBirth: optional("dateOfBirth"),
    gradeLevelId: formData.get("gradeLevelId") ?? "",
    currentLevelId: optional("currentLevelId"),
    dailyMinutes: formData.get("dailyMinutes"),
  });
}

export const parentProfileSchema = z.object({
  displayName: z.string().trim().min(1, "Enter your name.").max(80, "Use 80 characters or fewer."),
  timezone: z.string().trim().refine(isValidTimeZone, { message: "Choose a valid time zone." }),
});
