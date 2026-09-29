import { APP_SHORT_NAME } from "@/lib/app-info";

// Shown instead of the app when Supabase is not configured (a fresh deployment or CI
// build). Lists the missing setting names only — never values.
export function SetupRequired({ problems }: { problems: string[] }) {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-4 py-12">
      <p className="text-5xl" aria-hidden>
        🛠️
      </p>
      <h1 className="text-3xl font-extrabold">{APP_SHORT_NAME} is not set up yet</h1>
      <p className="text-muted text-lg">
        This installation has no database connection. An administrator needs to set the following environment
        variables and rebuild the app:
      </p>
      <ul className="list-disc space-y-1 pl-6 font-mono text-sm">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <p className="text-muted">
        See <code>.env.example</code> and <code>docs/development.md</code>.
      </p>
    </main>
  );
}
