import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { UpdatePasswordForm } from "../password-forms";

export const metadata: Metadata = { title: "Choose a new password" };

// Opened from the reset email (via /auth/confirm, which starts a recovery session) or by a
// signed-in parent from Settings.
export default async function UpdatePasswordPage() {
  await requireUser("/update-password");
  return (
    <Card className="space-y-5">
      <h1 className="text-2xl font-extrabold">Choose a new password</h1>
      <UpdatePasswordForm />
    </Card>
  );
}
