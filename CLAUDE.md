@AGENTS.md

# Word Garden — English learning PWA for children (KG1–Grade 2)

A standalone application with its own repository, Supabase project and deployment. It
shares nothing with any other app. Run all commands from the repository root.

## Purpose

Teach English reading to children aged about 3–8: letter sounds, phonics, blending, sight
words, vocabulary, spelling, sentence building, reading and listening. Parents manage a
family account with several children; each child has fully independent progress. Admins
manage curriculum content. See `docs/architecture.md` for the full picture.

## Stack

Next.js 16 (App Router, Turbopack, `proxy.ts`), React 19, TypeScript (strict), Tailwind CSS
v4, Supabase (Postgres, Auth, RLS), Zod, Dexie (IndexedDB), Serwist (service worker),
Vitest, Playwright. Read `node_modules/next/dist/docs/` before using a Next.js API — this
version differs from older training data (async `params`/`searchParams`, `PageProps`
globals, `proxy.ts` instead of `middleware.ts`).

## Core rules

1. **Content is data.** Never hard-code learning content (words, patterns, lessons,
   questions) in components. It lives in the database, authored in `content/` and loaded
   with `npm run content:import`. Components are generic renderers.
2. **Activities are typed data.** A question's `question_type` selects a renderer from
   `src/features/activities/registry.tsx`; its `content`/`answer` JSON is validated by
   `src/lib/content/question-schemas.ts` and the activity's `config` by
   `src/lib/content/activity-config.ts`. New type = schemas + evaluator branch (and its
   canonical form in `answer-key.ts`) + renderer + `activity_types` row.
3. **Never trust the client.** Child ids are verified against the signed-in parent via RLS
   before anything is written; answers are re-evaluated on the server; scores, stars and
   mastery are computed server-side from stored attempts.
4. **Progress is append-only and idempotent.** Attempts and lesson runs carry
   device-generated UUIDs and are stored once. Mastery, lesson progress and My Words are
   derived caches, recomputed from history.
5. **Offline first.** Every answer goes to the IndexedDB outbox before the network
   (`src/lib/offline/outbox.ts`). Nothing is silently discarded.
6. **Child UI:** big targets, icons + few words, audio for everything, no external links,
   no technical errors ("Something went wrong. Let's try again."). Feedback never relies on
   colour alone.
7. **Audio only through `src/lib/audio`** — never call `speechSynthesis` from components.
   Phonics sounds and letter names are speech tokens (`{/SH/}`, `{@s}`) resolved by
   `src/lib/audio/pronunciation.ts`; never put letters (`sss`, `th`) in speech
   (`docs/audio.md`).
8. **Keep V1 simple**: rule-based mastery and review, browser TTS, Postgres-derived analytics.
9. **Phonics is graphemes + phonemes.** Sounds are ARPAbet phoneme codes (`phonemes`);
   words carry their grapheme split (`word_segments`, from `src/lib/learning/phonics.ts` or
   the CSV `segments` column). Sound activities are built from the split, never from
   letter counts. Letter NAME and letter SOUND are separate fields. Phonics uses the
   ordinary skill mastery, progress and assessment tables — no parallel system.

## Folder structure

```
content/                 curriculum as data (JSON + words / spelling CSV) → npm run content:import
scripts/content/         import CLI            scripts/db/     type generator, SQL test runner
scripts/local-stack/     Docker-free Supabase-compatible stack for dev/tests
supabase/migrations/     schema, RLS, grants (never edit an applied migration; add one)
supabase/tests/          SQL-level RLS/constraint tests (npm run test:db)
src/app/                 routes: (auth), onboarding, parent/*, child/*, admin/*, api/sync
src/features/            activity renderers + registry, lesson player, reading (passage reader)
src/components/          ui/ primitives (Button, Card, Field, Alert, EmptyState, Spinner, ProgressBar),
                         layout/ (AppShell, NavLink, setup screen, sync, offline, SW), parent/, child/
public/offline.html      static offline fallback served by the service worker
src/lib/learning/        pure domain logic: evaluate, mastery, scoring, daily plan, placement,
                         phonics (word split), phonics-progress (stars), assessment-scoring,
                         spelling (checker, error categories, hints, spelling mastery)…
src/lib/content/         content schemas, CSV, templates, lesson blueprints, phonics validation, importer
src/lib/offline/         Dexie DB, outbox, sync protocol, lesson cache
src/lib/server/          server-only loaders, progress writer, rate limit
src/lib/supabase/        clients (browser, server, admin/service role) + generated types
tests/unit, tests/e2e    Vitest and Playwright
```

## Conventions

- Server-only modules start with `import "server-only"`. The service-role client
  (`src/lib/supabase/admin.ts`) is used only by the progress writer (after an ownership
  check) and the lesson loader (to build digest-only answer keys; ADR-021).
- Correct answers never reach the browser in plain text: `questions.answer` is not readable
  by signed-in users, and renderers get a `reveal` from the answer key, never the answer.
- Engine numbers (mastery bands, tries, review, scoring) live in `src/lib/learning/rules.ts`
  (overridable in `learning_rules`); feedback words in `feedback_messages`. Don't hard-code
  either in components.
- Validate every external input with Zod (forms, API bodies, content files). Form schemas
  live in `src/lib/validation`; rules that protect data are also enforced in the database.
- Pure logic goes in `src/lib/learning` with unit tests; keep I/O out of it.
- Server Actions re-check auth inside the action. Redirect targets go through
  `safeNextPath`.
- Logs: `logger` from `src/lib/logging.ts`, ids and codes only — no names, emails or answers.
- Database: snake_case, uuid PKs, `status` (draft/published/archived) on content,
  `created_at`/`updated_at`, explicit grants in every migration (hosted Supabase grants
  new tables to `anon` by default). After changing the schema run `npm run db:types`.

## Commands

```
npm run dev              # dev server (needs .env.local)
npm run stack:start      # local Postgres + auth + REST without Docker (writes .env.local)
npm run content:import   # import /content (add -- --dry-run to validate only)
npm run typecheck        # next typegen + tsc (app and service worker)
npm run lint             # warnings fail
npm run format           # prettier --write (format:check in CI)
npm test                 # unit + component tests (incl. validation of every shipped content file)
npm run check            # typecheck + lint + format:check + tests
npm run test:db          # SQL RLS/constraint tests against DATABASE_URL
npm run test:integration # auth + RLS through the real auth server and REST API (needs the stack)
npm run build            # next build + service worker
npm run e2e              # Playwright (needs stack + imported content; E2E_PROD=1 after build for PWA test)
```

## Environment variables

See `.env.example`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` (server only), `DATABASE_URL` (tests/tooling only).
Read them only through `src/lib/env.ts` (lazy validation; never at module import). Without
them the app still builds and shows a setup screen. `NEXT_PUBLIC_*` are inlined at build time.

## Docs

`docs/architecture.md`, `docs/database.md`, `docs/curriculum.md`, `docs/audio.md`,
`docs/development-roadmap.md`, `docs/decisions.md`, `docs/development.md`.
Update them when behaviour or architecture changes; record decisions as ADRs.
