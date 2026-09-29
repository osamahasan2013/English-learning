"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { requestPasswordReset, updatePassword, type AuthFormState } from "./actions";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(requestPasswordReset, {
    status: "idle",
  });
  if (state.status === "sent") {
    return (
      <FormMessage tone="success">
        If an account exists for that email, we sent a link to reset the password. It expires after a while,
        so use it soon.
      </FormMessage>
    );
  }
  const error = state.fieldErrors?.email;
  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.message ? <FormMessage tone="error">{state.message}</FormMessage> : null}
      <Field label="Email" htmlFor="email" error={error}>
        <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={!!error} />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Please wait…" : "Send reset link"}
      </Button>
      <p className="text-center">
        <Link href="/login" className="text-primary font-semibold underline">
          Back to log in
        </Link>
      </p>
    </form>
  );
}

export function UpdatePasswordForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(updatePassword, {
    status: "idle",
  });
  const error = (name: string) => state.fieldErrors?.[name];
  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.message ? <FormMessage tone="error">{state.message}</FormMessage> : null}
      <Field label="New password" htmlFor="password" error={error("password")} hint="At least 8 characters.">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={72}
          aria-invalid={!!error("password")}
        />
      </Field>
      <Field label="Repeat new password" htmlFor="confirmPassword" error={error("confirmPassword")}>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={!!error("confirmPassword")}
        />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}
