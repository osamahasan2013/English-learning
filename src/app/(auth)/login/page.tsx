import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { signIn } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const { next, error } = await props.searchParams;
  return (
    <Card className="space-y-5">
      <h1 className="text-2xl font-extrabold">Parent log in</h1>
      {error === "confirmation" ? (
        <Alert tone="warning" title="That link didn't work">
          It may have expired or already been used. Log in, or{" "}
          <Link href="/forgot-password" className="underline">
            request a new password reset link
          </Link>
          .
        </Alert>
      ) : null}
      <AuthForm mode="login" action={signIn} next={typeof next === "string" ? next : undefined} />
    </Card>
  );
}
