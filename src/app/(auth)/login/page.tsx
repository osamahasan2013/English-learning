import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { signIn } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const { next } = await props.searchParams;
  return (
    <Card className="space-y-5">
      <h1 className="text-2xl font-extrabold">Parent log in</h1>
      <AuthForm mode="login" action={signIn} next={typeof next === "string" ? next : undefined} />
    </Card>
  );
}
