"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/field";
import type { AuthFormState } from "./actions";

type Props = {
  mode: "login" | "register";
  action: (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  next?: string;
};

export function AuthForm({ mode, action, next }: Props) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  // The family's time zone (for streaks and "today"), detected once mounted in the browser.
  const [timezone, setTimezone] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- only knowable in the browser
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone ?? "");
  }, []);

  if (state.status === "check_email") {
    return (
      <FormMessage tone="success">
        Almost done! We sent you an email. Open the link in it to confirm your account, then come back and log
        in.
      </FormMessage>
    );
  }

  const error = (name: string) => state.fieldErrors?.[name];
  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.message ? <FormMessage tone="error">{state.message}</FormMessage> : null}
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {mode === "register" ? <input type="hidden" name="timezone" value={timezone} /> : null}
      {mode === "register" ? (
        <Field label="Your name" htmlFor="displayName" error={error("displayName")}>
          <Input
            id="displayName"
            name="displayName"
            autoComplete="name"
            required
            aria-invalid={!!error("displayName")}
          />
        </Field>
      ) : null}
      <Field label="Email" htmlFor="email" error={error("email")}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={!!error("email")}
        />
      </Field>
      <Field
        label="Password"
        htmlFor="password"
        error={error("password")}
        hint={mode === "register" ? "At least 8 characters." : undefined}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          required
          minLength={mode === "register" ? 8 : undefined}
          maxLength={72}
          aria-invalid={!!error("password")}
        />
      </Field>
      {mode === "login" ? (
        <p className="-mt-2 text-right">
          <Link href="/forgot-password" className="text-primary text-sm font-semibold underline">
            Forgot password?
          </Link>
        </p>
      ) : null}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Please wait…" : mode === "register" ? "Create account" : "Log in"}
      </Button>
      <p className="text-center">
        {mode === "register" ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="text-primary font-semibold underline">
              Log in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href="/register" className="text-primary font-semibold underline">
              Create a family account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
