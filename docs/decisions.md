# Architecture decisions

Each entry: context, decision, consequences. Add a new entry (don't rewrite old ones) when a
decision changes, stating what changed, why, impact and migration needs.

## ADR-001 — Separate app in its own folder of the existing repository (superseded by ADR-020)

**Context.** The repository holds the Precast Elements Monitoring System; the owner asked
for a new, separate app. This session can only push to this repository.
**Decision.** Build the app self-contained in `english-learning/` (own `package.json`,
lockfile, Supabase migrations, docs). It shares no code or database with the precast app.
**Consequences.** It can be moved to its own repository at any time with history
(`git subtree split --prefix english-learning`). Deploy with the project root set to
`english-learning/`. Working product name "Word Garden" is a placeholder (`src/lib/app-info.ts`).

## ADR-002 — Next.js App Router + Supabase

Server Components read through the parent's RLS-scoped client; mutations are Server Actions
or one Route Handler (`/api/sync`). Serwist runs via its CLI under Turbopack, and
`proxy.ts` refreshes the Supabase session.

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

## ADR-007 — Derived progress tables; `skill_mastery` doubles as the review queue (review queue superseded by ADR-022)

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

`.github/workflows/ci.yml` (originally `english-learning.yml`, see ADR-020) runs
typecheck, lint (warnings fail), format check, unit/component tests and a production build
**without credentials**. SQL and e2e tests need a Supabase backend; they run locally
for now and move to CI with the Supabase CLI in Phase 16.

## ADR-018 — Family rules and levels live in the database

**Context.** Parents hold a session that can call the REST API directly, so rules checked
only in Server Actions can be bypassed. **Decision.** Migration
`20260930100100_parent_profiles_and_family_rules.sql` enforces them in Postgres: published
levels only, at most 12 active children per family, valid IANA time zones, trimmed names.
The app keeps its own (friendlier) validation in `src/lib/validation`, and maps the
database's error codes (`CHILD_LIMIT_REACHED`, `LEVEL_NOT_AVAILABLE`, `INVALID_TIME_ZONE`)
to messages. The five learning levels are seeded by migration
(`20260930100200_seed_levels.sql`) because the app cannot onboard a family without them;
all other content stays in `content/` and the importer, which treats the seeded levels as
unchanged. **Impact:** a fresh database works without a content import (verified).

## ADR-019 — Password reset and relative auth redirects

Password reset uses Supabase's recovery email → `/auth/confirm` (recovery session) →
`/update-password`. Requests always answer "if an account exists…" to avoid revealing
accounts. `/auth/confirm` redirects with relative `Location` headers: an absolute URL
built from `request.url` pointed at `localhost` while the browser used `127.0.0.1`, which
dropped the session cookie (found by the e2e test; the same would happen behind a proxy
with a different internal host).

## ADR-020 — Own repository

**What changed.** The app moved out of the Precast Elements Monitoring System (PEMS)
repository into this repository, `English-learning`, with its full commit history
(`git subtree split`), and the folder was removed from the PEMS repository.
**Why.** The owner asked for a completely separate app. As a folder inside the PEMS
repository, it was type-checked by the PEMS build (whose `tsconfig` includes every `.ts`
file in the repository) and broke the PEMS Vercel preview deployments. PEMS production was
never affected.
**Impact.** The app lives at the repository root; CI moved to `.github/workflows/ci.yml`
without path filters; deploy with the repository root as the project root. It shares no
code, database, Supabase project or deployment with PEMS.

## ADR-021 — Answers stay on the server; the device gets digest answer keys

**Context.** Offline-first feedback (ADR-008) meant each lesson payload carried the correct
answers, and `questions.answer` was readable by every signed-in user. The Phase 3 brief:
do not expose correct answers to the client before submission; evaluate on the server
where possible.
**Decision.** Signed-in users (admins included) have no SELECT on `questions.answer`. The
lesson loader reads answers with the service role — only for the published question ids
the parent's RLS query returned — and ships an _answer key_: salted SHA-256 digests of the
answer's canonical forms (one per accepted value or sequence, one per pair, one per
position for near-miss detection; tracing ships its public coverage threshold). The
device verifies a response offline by hashing it the same way; after the last try it
recovers the answer to show only by testing what is on screen. `evaluate.ts` and
`answer-key.ts` share the canonical forms, and a unit test checks every shipped question
gives the same verdict both ways. The server still re-evaluates every stored answer
against the real answer.
**Consequences.** No plaintext answer in the page, the lesson cache or the REST API.
Small option sets can still be brute-forced on a modified client (four options = four
tries); that only affects the child's own instant feedback, never stored progress. The
lesson loader is a second, narrowly scoped user of the service-role client. Content
tooling reads answers with the service role (the importer already did).

## ADR-022 — Explicit review queue and a progress model per hierarchy level

**Decision.** Replace "`skill_mastery` doubles as the review queue" (ADR-007) with a
`review_items` table: one open item per skill or word, with priority, due date and reason,
resolved rather than deleted. Add derived `activity_progress`, `subject_progress`,
`level_progress` and `learning_sessions`, and give `lesson_progress` a status, answer
counts and accuracy. All of them are recomputed from append-only history by the progress
writer, like the existing caches. Sessions are identified by a device-generated id
carried on every event (a new one after 30 minutes idle); the server never lets one child's
session id collect another child's events.
**Why.** The Phase 3 brief asks for progress at every level of the hierarchy, a session
model and a review queue that can reference words and patterns as well as skills — and a
queue table is what later spaced-repetition work will extend.
**Consequences.** More derived rows per sync (bounded by the lessons touched); every cache
can still be rebuilt from history.

## ADR-023 — Engine rules and feedback words are data

**Decision.** Mastery bands and evidence, prerequisite readiness, review, player
(`maxTries`, session timeout) and scoring numbers live in `src/lib/learning/rules.ts` as
Zod-validated defaults that the `learning_rules` table can override per rule set; an
invalid override is ignored and logged. Feedback words are `feedback_messages` rows. The
subject list became the nine content categories of the brief (PHONICS … ASSESSMENT); the
Phase 2 subjects LETTERS, BLENDING, SIGHT_WORDS and SENTENCES were folded into PHONICS,
READING and SENTENCE_BUILDING and archived (units were re-pointed by the importer).
**Why.** The brief requires configurable thresholds and feedback without strings in
components, and subjects as content categories.
**Consequences.** Changing a band is a data change, reviewed like content. The defaults
stay in code so a fresh database works without any rule rows.
