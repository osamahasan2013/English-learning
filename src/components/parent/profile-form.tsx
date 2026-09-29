"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import type { ProfileFormState } from "@/app/parent/profile-actions";

export function ProfileForm({
  action,
  displayName,
  timezone,
  timeZones,
}: {
  action: (prev: ProfileFormState, formData: FormData) => Promise<ProfileFormState>;
  displayName: string;
  timezone: string;
  timeZones: string[];
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const error = (name: string) => state.fieldErrors?.[name];
  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.status === "saved" ? <FormMessage tone="success">Profile saved.</FormMessage> : null}
      {state.message ? <FormMessage tone="error">{state.message}</FormMessage> : null}
      <Field label="Your name" htmlFor="displayName" error={error("displayName")}>
        <Input
          id="displayName"
          name="displayName"
          defaultValue={displayName}
          autoComplete="name"
          maxLength={80}
          required
          aria-invalid={!!error("displayName")}
        />
      </Field>
      <Field
        label="Time zone"
        htmlFor="timezone"
        error={error("timezone")}
        hint="Used to count days for streaks and daily learning time."
      >
        <Select id="timezone" name="timezone" defaultValue={timezone} aria-invalid={!!error("timezone")}>
          {timeZones.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replaceAll("_", " ")}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save profile"}
      </Button>
    </form>
  );
}
