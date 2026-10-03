# Development guide

## Prerequisites

Node.js 20.9+ (22 LTS recommended), npm, and a Supabase backend: a hosted project, the
Supabase CLI (`npx supabase start`, needs Docker), or the Docker-free local stack below.

## First run (local stack, no Docker)

```bash
npm install
# One-time: get the auth server and PostgREST binaries (see "Local stack" below)
LOCAL_STACK_BIN_DIR=/path/to/bin npm run stack:start   # Postgres :54322, API :54321, writes .env.local
npm run content:import                                 # load the curriculum
npm run dev                                            # http://127.0.0.1:3000
```

Register a parent account (email confirmation is off locally), add a child, and press
"Start learning". To make yourself an admin:

```sql
update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'you@example.com');
```

## With a hosted Supabase project

1. Create a project; copy URL, anon key and service-role key into `.env.local`
   (see `.env.example`).
2. Apply migrations: `npx supabase link --project-ref <ref> && npx supabase db push`
   (or run the files in `supabase/migrations/` in order).
3. `npm run content:import`.
4. Auth settings: enable email/password; set the site URL and add `<site>/auth/confirm`
   to the redirect URLs. `/auth/confirm` accepts both the default confirmation link
   (`?code=`) and a custom template link
   (`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding`).

## Local stack

`scripts/local-stack/start.sh` needs:

- PostgreSQL 15+ server binaries (`PG_BIN`, default `/usr/lib/postgresql/16/bin`)
- `LOCAL_STACK_BIN_DIR` containing:
  - `gotrue` — build from https://github.com/supabase/auth (`git clone --branch v2.180.0 …`,
    `go build -o gotrue .`); its `migrations/` directory must be at
    `$LOCAL_STACK_BIN_DIR/gotrue-src/migrations` or set `GOTRUE_MIGRATIONS_DIR`
  - `postgrest` — static binary from https://github.com/PostgREST/postgrest/releases (v13)

It is idempotent: re-running applies only new migrations. `npm run stack:stop` stops it;
delete `LOCAL_STACK_DIR` (default `/tmp/english-learning-stack`) to reset.

## Checks before pushing

```bash
npm run typecheck && npm run lint && npm test && npm run test:db && npm run build
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run e2e
E2E_PROD=1 npm run e2e    # after build: also runs the PWA/offline test against `next start`
```

`npm run check` runs typecheck, lint, format check and unit tests in one go; CI
(`.github/workflows/ci.yml`) runs those plus a production build without
credentials.

`npm run test:integration` exercises sign-up, login, logout, password recovery, profiles
and family RLS through the real auth server and REST API (needs `npm run stack:start` or a
Supabase project in `.env.local`).

### Pronunciation audit

`npm run audio:audit` prints what every phonics sound and letter name resolves to
(recording / synthesis / keyword). If `espeak-ng` is installed (`apt-get install
espeak-ng`), it also prints the phonemes a real engine produces for that text. Output such
as `'Es` (ess) or `'eItS` (aitch) for a _sound_ means letter names: fix the rendering in
`content/phonics.json`. See [audio.md](audio.md).

The PWA test starts its own production server on port 3200 and kills it to simulate being
offline: Playwright's `setOffline()` does not reliably block requests made by the service
worker itself, so it cannot prove a page came from the cache.

## Schema changes

Add a new migration file (timestamped), include explicit grants and RLS, run
`npm run stack:start` to apply it, then `npm run db:types`, and extend
`supabase/tests/*.sql`.

## Deploying

Any Node.js host, or Vercel with the default settings (Next.js, repository root). Set the
three environment variables. `npm run build` also generates `public/sw.js`.
