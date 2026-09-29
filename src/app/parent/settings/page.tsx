import type { Metadata } from "next";
import { DisplayPreferencesControls } from "@/components/layout/display-preferences";
import { SyncStatusPanel } from "@/components/parent/sync-status-panel";
import { Card, CardTitle } from "@/components/ui/card";
import { getProfile, getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [user, profile] = await Promise.all([getSessionUser(), getProfile()]);
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-3xl font-extrabold">Settings</h1>
      <Card className="space-y-2">
        <CardTitle>Account</CardTitle>
        <p>
          <span className="font-semibold">Name:</span> {profile?.display_name || "—"}
        </p>
        <p>
          <span className="font-semibold">Email:</span> {user?.email}
        </p>
        <p>
          <span className="font-semibold">Time zone:</span> {profile?.timezone}
        </p>
      </Card>
      <Card className="space-y-3">
        <CardTitle>Display on this device</CardTitle>
        <DisplayPreferencesControls />
      </Card>
      <Card className="space-y-3">
        <CardTitle>Sync</CardTitle>
        <SyncStatusPanel />
      </Card>
    </div>
  );
}
