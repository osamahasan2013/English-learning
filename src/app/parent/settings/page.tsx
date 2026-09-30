import type { Metadata } from "next";
import Link from "next/link";
import { DisplayPreferencesControls } from "@/components/layout/display-preferences";
import { ProfileForm } from "@/components/parent/profile-form";
import { SyncStatusPanel } from "@/components/parent/sync-status-panel";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { updateParentProfile } from "@/app/parent/profile-actions";
import { getProfile, requireParentMode } from "@/lib/auth/session";
import { listTimeZones } from "@/lib/validation/time-zone";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireParentMode("/parent/settings");
  const profile = await getProfile();
  const timeZones = listTimeZones();
  const current = profile?.timezone ?? "UTC";

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-3xl font-extrabold">Settings</h1>
      <Card className="space-y-4">
        <CardTitle>Your profile</CardTitle>
        <ProfileForm
          action={updateParentProfile}
          displayName={profile?.display_name ?? ""}
          timezone={current}
          timeZones={timeZones.includes(current) ? timeZones : [current, ...timeZones]}
        />
      </Card>
      <Card className="space-y-3">
        <CardTitle>Sign-in</CardTitle>
        <p>
          <span className="font-semibold">Email:</span> {user.email}
        </p>
        <Link href="/update-password" className={buttonClasses("secondary", "md")}>
          Change password
        </Link>
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
