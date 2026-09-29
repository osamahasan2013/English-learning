import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { signUp } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Create a family account" };

export default function RegisterPage() {
  return (
    <Card className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">Create a family account</h1>
        <p className="text-muted">For parents and carers. You&apos;ll add your children next.</p>
      </div>
      <AuthForm mode="register" action={signUp} />
    </Card>
  );
}
