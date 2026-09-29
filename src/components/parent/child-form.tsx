"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { AVATARS, type AvatarKey } from "@/lib/avatars";
import { DAILY_MINUTE_OPTIONS } from "@/lib/learning/daily-plan";
import { cn } from "@/lib/utils";
import type { ChildFormState } from "@/app/parent/child-actions";

type Level = {
  id: string;
  name: string;
  short_name: string;
  min_age: number;
  max_age: number;
  theme_emoji: string;
};

type Props = {
  action: (prev: ChildFormState, formData: FormData) => Promise<ChildFormState>;
  levels: Level[];
  submitLabel: string;
  initial?: {
    name: string;
    avatar: string;
    dateOfBirth: string | null;
    gradeLevelId: string;
    currentLevelId: string;
    dailyMinutes: number;
  };
};

export function ChildForm({ action, levels, submitLabel, initial }: Props) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const [avatar, setAvatar] = useState<string>(initial?.avatar ?? "fox");
  const error = (name: string) => state.fieldErrors?.[name];

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {state.message ? <FormMessage tone="error">{state.message}</FormMessage> : null}

      <Field
        label="Child's first name or nickname"
        htmlFor="name"
        error={error("name")}
        hint="Shown to your child. No surname needed."
      >
        <Input
          id="name"
          name="name"
          defaultValue={initial?.name}
          maxLength={40}
          autoComplete="off"
          required
          aria-invalid={!!error("name")}
        />
      </Field>

      <fieldset>
        <legend className="font-semibold">Avatar</legend>
        <input type="hidden" name="avatar" value={avatar} />
        <div className="mt-2 grid grid-cols-6 gap-2 sm:grid-cols-12">
          {(Object.entries(AVATARS) as [AvatarKey, string][]).map(([key, emoji]) => (
            <button
              key={key}
              type="button"
              onClick={() => setAvatar(key)}
              aria-pressed={avatar === key}
              aria-label={key}
              className={cn(
                "flex aspect-square items-center justify-center rounded-2xl border-2 text-3xl transition",
                avatar === key ? "border-primary bg-accent-soft" : "border-border bg-surface",
              )}
            >
              <span aria-hidden>{emoji}</span>
            </button>
          ))}
        </div>
        {error("avatar") ? <p className="text-danger mt-1 text-sm font-semibold">{error("avatar")}</p> : null}
      </fieldset>

      <Field
        label="Date of birth (optional)"
        htmlFor="dateOfBirth"
        error={error("dateOfBirth")}
        hint="Used only to show age on your dashboard."
      >
        <Input
          id="dateOfBirth"
          name="dateOfBirth"
          type="date"
          defaultValue={initial?.dateOfBirth ?? ""}
          aria-invalid={!!error("dateOfBirth")}
        />
      </Field>

      <Field label="School grade" htmlFor="gradeLevelId" error={error("gradeLevelId")}>
        <Select
          id="gradeLevelId"
          name="gradeLevelId"
          defaultValue={initial?.gradeLevelId ?? ""}
          required
          aria-invalid={!!error("gradeLevelId")}
        >
          <option value="" disabled>
            Choose a grade
          </option>
          {levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.theme_emoji} {l.name} (ages {l.min_age}–{l.max_age})
            </option>
          ))}
        </Select>
      </Field>

      {initial ? (
        <Field
          label="Learning level"
          htmlFor="currentLevelId"
          error={error("currentLevelId")}
          hint="The level lessons come from. Usually the same as the grade; change it if lessons feel too easy or too hard."
        >
          <Select id="currentLevelId" name="currentLevelId" defaultValue={initial.currentLevelId}>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.theme_emoji} {l.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <Field label="Daily learning time" htmlFor="dailyMinutes" error={error("dailyMinutes")}>
        <Select id="dailyMinutes" name="dailyMinutes" defaultValue={String(initial?.dailyMinutes ?? 15)}>
          {DAILY_MINUTE_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m} minutes a day
            </option>
          ))}
        </Select>
      </Field>

      <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
