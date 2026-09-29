import type { Metadata } from "next";
import Link from "next/link";
import { requireActiveChild } from "@/lib/auth/session";
import { loadChildRewards } from "@/lib/server/family-data";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "My rewards" };

export default async function RewardsPage() {
  const child = await requireActiveChild();
  const rewards = await loadChildRewards(child.id);
  return (
    <div className="space-y-6">
      <Link
        href="/child/home"
        className="bg-surface inline-flex min-h-12 items-center gap-2 rounded-full px-5 text-xl font-bold shadow-sm"
      >
        <span aria-hidden>🏠</span> Home
      </Link>
      <div className="flex flex-wrap gap-4">
        <div className="bg-surface rounded-3xl p-6 text-center shadow-sm">
          <p className="text-5xl" aria-hidden>
            ⭐
          </p>
          <p className="text-4xl font-extrabold">{rewards.stars}</p>
          <p className="text-muted text-lg font-semibold">stars</p>
        </div>
        <div className="bg-surface rounded-3xl p-6 text-center shadow-sm">
          <p className="text-5xl" aria-hidden>
            💎
          </p>
          <p className="text-4xl font-extrabold">{rewards.points}</p>
          <p className="text-muted text-lg font-semibold">points</p>
        </div>
      </div>
      <h1 className="text-3xl font-extrabold">My badges</h1>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {rewards.achievements.map((a) => (
          <li
            key={a.id}
            className={cn(
              "flex flex-col items-center gap-1 rounded-3xl p-4 text-center",
              a.earnedAt ? "bg-surface shadow-sm" : "bg-surface-muted opacity-60",
            )}
          >
            <span className={cn("text-5xl", !a.earnedAt && "grayscale")} aria-hidden>
              {a.earnedAt ? a.emoji : "🔒"}
            </span>
            <span className="text-lg font-bold">{a.title}</span>
            <span className="text-muted text-sm">{a.earnedAt ? "Earned!" : a.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
