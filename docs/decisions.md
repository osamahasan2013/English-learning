# Architecture decisions

Each entry: context, decision, consequences. Add a new entry (don't rewrite old ones) when a
decision changes, stating what changed, why, impact and migration needs.

## ADR-001 — Separate app in its own folder of the existing repository

**Context.** The repository holds the Precast Elements Monitoring System; the owner asked
for a new, separate app. This session can only push to this repository.
**Decision.** Build the app self-contained in `english-learning/` (own `package.json`,
lockfile, Supabase migrations, docs). It shares no code or database with the precast app.
**Consequences.** It can be moved to its own repository at any time with history
(`git subtree split --prefix english-learning`). Deploy with the project root set to
`english-learning/`. Working product name "Word Garden" is a placeholder (`src/lib/app-info.ts`).

## ADR-002 — Next.js App Router + Supabase

Server Components read through the parent's RLS-scoped client; mutations are Server Actions
or one Route Handler (`/api/sync`). Same stack as the sibling app, so tooling and patterns
(Serwist via CLI under Turbopack, `proxy.ts`) are proven here.

## ADR-003 — Content as data, imported from files

**Decision.** The curriculum is authored as JSON/CSV in `content/` and upserted by natural
key (`npm run content:import`). The admin CMS (Phase 15) will call the same importer.
**Why.** Reviewable diffs, CI validation (`tests/unit/content-files.test.ts`),
reproducible environments, and bulk editing today without waiting for CMS forms.
**Consequences.** Imports never delete; removed lessons/activities/questions are archived
so history stays valid.

## ADR-004 — Self-describing questions (JSON content + answer) instead of an `answers` table

**Decision.** `questions.content` and `questions.answer` are JSON, validated per
`question_type` by Zod on import and on load.
**Why.** Activity types differ widely (choices, gaps, tile orders, sentence orders);
generic JSON with strict per-type schemas keeps one renderer contract and lets new types be
added without schema migrations.
**Consequences.** Answers are readable by signed-in users (needed for instant, offline
feedback). Correctness is never trusted from the device — the server re-evaluates.

## ADR-005 — Server writes progress with the service role after an RLS ownership check

**Decision.** Parents have SELECT-only access to progress tables. `/api/sync` verifies the
child through the parent's RLS client, then `progress-writer.ts` writes with the service
role, re-evaluating answers and deriving scores.
**Why.** Scores, stars and mastery must not be forgeable by a client calling the REST API
directly, and mastery rules stay in tested TypeScript.
**Consequences.** `SUPABASE_SERVICE_ROLE_KEY` is required on the server. The key is used in
exactly one module.

## ADR-006 — One `activity_attempts` table for all answer kinds

Instead of separate reading/spelling/writing attempt tables, one immutable table with
`question_type`, `error_type`, `word_id`, `lesson_run_id`, `assessment_attempt_id`. Views
or specialised tables can be added when a modality needs extra columns (e.g. writing stroke
metrics, read-aloud word timings).

## ADR-007 — Derived progress tables; `skill_mastery` doubles as the review queue

History is append-only; `lesson_progress`, `skill_mastery`, `word_progress` are caches
recomputed from it after each sync. The review queue is `skill_mastery` ordered by
`review_priority` / `next_review_at` rather than a separate table. Any cache can be rebuilt.

## ADR-008 — Offline-first outbox with device-generated ids

Every event is written to IndexedDB (Dexie) before sending; the server stores each id once
(`on conflict do nothing`). Only confirmed events are removed; rejected ones are kept as
failed and shown to the parent. Conflict policy: union of all devices' history.

## ADR-009 — In-memory rate limiting for `/api/sync`

Good enough for a single instance; move to a shared store (e.g. Redis/Upstash) before
horizontal scaling.

## ADR-010 — Rule-based adaptive learning in V1

Transparent rules (docs/curriculum.md) that parents can be told about; no ML. The mastery
function takes plain attempt lists, so it can be replaced without schema changes.

## ADR-011 — Browser speech synthesis behind an audio service

`src/lib/audio` plays recorded assets when present, otherwise TTS. Isolated phoneme sounds
use `say_as` approximations. Recordings can replace TTS item by item.

## ADR-012 — Child mode on the parent's session

Children do not have accounts. A parent hands the device over by choosing a child; an
httpOnly cookie remembers which child, re-verified server-side each request. A grown-up
gate (multiplication question) keeps children in the child area — a usability barrier, not
a security boundary. Keeps COPPA-sensitive data minimal: no child credentials, optional DOB,
first name/nickname only.

## ADR-013 — Emoji as V1 pictures

Zero bytes, offline, no licensing. `image_assets`/`words.image_asset_id` are ready for
illustrations; renderers will prefer an image when present.

## ADR-014 — Docker-free local stack for development and CI

Docker images could not be pulled in the authoring environment. `scripts/local-stack/`
runs PostgreSQL, the Supabase auth server (GoTrue) and PostgREST behind a small gateway,
applying the same migrations. `npx supabase start` remains the preferred path where Docker
is available; both run the same migrations and tests.

## ADR-015 — Own UI primitives instead of a component library

**Context.** The brief suggests shadcn/ui "where appropriate". **Decision.** Keep a small
set of hand-written, token-themed primitives (`src/components/ui`) and native elements
(`<dialog>` for the grown-up gate). **Why.** The child UI needs unusually large targets and
custom feedback; the parent UI needs only a handful of controls; no Radix/cva dependency is
justified yet. **Revisit** when the admin CMS needs complex widgets (combobox, data table,
dialogs with focus management) — adopt shadcn/ui components individually then.

## ADR-016 — Lazy configuration and a static offline fallback

**Configuration.** `src/lib/env.ts` used to validate at import time, which made
`next build` fail without Supabase credentials (so CI could not build and a fresh deploy
crashed). It now validates on first use; an unconfigured build renders a "not set up yet"
screen naming the missing variables, and `/api/sync` returns 503 (devices keep their
data). Impact: none for configured deployments; no migration.

**Offline fallback.** A first attempt served the Next.js `/offline` route as the service
worker fallback; served under another URL it failed to hydrate (React error #418) and could
render blank. The fallback is now `public/offline.html`, plain HTML with inline styles and
no app JavaScript. Impact: the page doesn't use the Tailwind build; keep its few colours in
sync with `globals.css` by hand.

## ADR-017 — CI scope

`.github/workflows/english-learning.yml` runs typecheck, lint (warnings fail), format
check, unit/component tests and a production build **without credentials**, only when
`english-learning/**` changes. SQL and e2e tests need a Supabase backend; they run locally
for now and move to CI with the Supabase CLI in Phase 16.
