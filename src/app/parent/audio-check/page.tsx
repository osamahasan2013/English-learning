import type { Metadata } from "next";
import { AudioCheck } from "@/components/parent/audio-check";
import { resolveAudioPacing } from "@/lib/audio/pacing";
import { requireParentMode } from "@/lib/auth/session";
import { loadLearningRules } from "@/lib/server/learning-rules";
import { getSoundTable } from "@/lib/server/sound-table";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Audio check" };

// A listening test for grown-ups on the device a child uses (iPhone, Android, computer):
// the same audio service, voices and pacing as the lessons. docs/audio-engine.md.
export default async function AudioCheckPage() {
  await requireParentMode("/parent/audio-check");
  const [sounds, rules] = await Promise.all([getSoundTable(), loadLearningRules(await createClient())]);
  const pacing = Object.fromEntries(
    Object.keys(rules.audio.levels).map((level) => [level, resolveAudioPacing(rules.audio, level)]),
  );
  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-extrabold">Audio check</h1>
        <p>
          Open this page on the phone, tablet or computer your child uses, turn the sound up, and play each
          line. Mark whether it sounds right. The timings show what the device&apos;s voice actually did. Copy
          the results to share them.
        </p>
      </div>
      <AudioCheck sounds={sounds} pacing={pacing} />
    </div>
  );
}
