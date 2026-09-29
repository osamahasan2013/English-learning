import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { ForgotPasswordForm } from "../password-forms";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <Card className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold">Reset your password</h1>
        <p className="text-muted">Enter the email you signed up with and we&apos;ll send you a link.</p>
      </div>
      <ForgotPasswordForm />
    </Card>
  );
}
