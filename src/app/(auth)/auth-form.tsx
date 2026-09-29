"use client";

import Link from "next/link";
import { useActionState } from "react";
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
          minLength={8}
          aria-invalid={!!error("password")}
        />
      </Field>
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
