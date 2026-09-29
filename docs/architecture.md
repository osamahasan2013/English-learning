# Architecture

## Overview

```
Browser (PWA)                                     Server (Next.js)                  Supabase
───────────────────────────────────────────       ──────────────────────────        ─────────────
Parent UI  /parent/*   ─ Server Components ──────▶ loaders (RLS client) ──────────▶ Postgres + RLS
Child UI   /child/*    ─ Lesson player (client)                                   Auth (GoTrue)
   │ answers                                      /api/sync route
   ▼                                                 1. getUser()
IndexedDB outbox (Dexie) ── flush ─────────────────▶ 2. child owned? (RLS client)
IndexedDB lesson cache                               3. progress writer (service role)
Service worker (Serwist): app shell + visited pages     re-evaluate, store once, derive
```

- **Parent area** (`/parent/*`, `/onboarding`): server-rendered pages reading through the
  parent's RLS-scoped Supabase client. Mutations (child profiles, entering child mode) are
  Server Actions that re-check the session.
- **Child area** (`/child/*`): requires a signed-in parent plus an "active child" httpOnly
  cookie, re-verified against the parent's account on every request. Leaving it requires a
  grown-up gate (a multiplication question — a usability barrier, not security).
- **Admin area** (`/admin/*`): `profiles.role = 'admin'` only. Admins manage content and
  have no access to family data (RLS).

## Foundation

### Route map

| Route                                                                   | Access                | Purpose                                      |
| ----------------------------------------------------------------------- | --------------------- | -------------------------------------------- |
| `/`                                                                     | public                | Landing; signed-in users go to the dashboard |
| `/login`, `/register`, `/forgot-password`                               | public                | Parent authentication                        |
| `/update-password`                                                      | signed in             | New password (after a reset link, or change) |
| `/auth/confirm`                                                         | public                | Email links (`token_hash` or `code`)         |
| `/onboarding`                                                           | parent                | First child profile                          |
| `/parent/dashboard`, `/parent/children[/new\|/:id]`, `/parent/settings` | parent                | Family area                                  |
| `/child/home`, `/child/learn/:lessonId`, `/child/rewards`               | parent + active child | Child area                                   |
| `/admin/dashboard`, `/admin/words`                                      | admin                 | Content administration                       |
| `/api/sync`                                                             | parent (POST)         | Progress sync                                |
| `/manifest.webmanifest`, `/sw.js`, `/offline.html`                      | public                | PWA                                          |

Routes from the product brief that are not built yet (`/child/words`, `/child/reading`,
`/child/writing`, `/parent/assessments`, `/admin/lessons`, …) are deliberately absent until
their phase: there are no placeholder pages. `src/proxy.ts` redirects signed-out visitors
away from `/parent`, `/child`, `/admin`, `/onboarding` and `/update-password` (UX only;
pages re-check).

### Authentication and sessions

- Supabase Auth, email + password (8–72 characters). Server Actions in
  `app/(auth)/actions.ts`: `signUp` (stores display name and the browser's time zone as
  sign-up metadata; `handle_new_user()` creates the profile), `signIn`, `signOut`,
  `requestPasswordReset`, `updatePassword`. Validation schemas: `src/lib/validation`.
- Sessions are cookies managed by `@supabase/ssr`; `proxy.ts` refreshes them on each
  request. Authorization decisions use `getUser()` (verified with the auth server), never
  the unverified cookie, and RLS is the boundary for every query.
- Messages don't reveal whether an email has an account (login failure, password reset
  request); rate-limit responses from Supabase become a "wait a minute" message.
- `/auth/confirm` verifies email links and redirects with a **relative** `Location`: an
  absolute URL built from `request.url` can name another host (localhost vs 127.0.0.1, or
  an internal host behind a proxy) and lose the new session cookie.
- Signing in or out clears the active-child cookie, so a shared device never carries one
  family's child selection into another account.

### Family model and authorization

- One parent account → up to 12 child profiles (`children`), each with its own grade,
  learning level, daily minutes and progress. Create/edit via Server Actions in
  `app/parent/child-actions.ts`; removal is a soft delete through `archive_child()`, which
  keeps history but hides the child and its progress.
- Switching: the dashboard switcher (`?child=`) changes which child's progress is shown;
  "Start learning as …" (`enterChildMode`) sets the httpOnly active-child cookie after an
  ownership check; the grown-up gate returns to the dashboard to pick another child.
- Ownership is verified server-side everywhere a child id arrives from the browser:
  `getOwnedChild()` (RLS lookup) for pages, actions and the active-child cookie, and the
  sync endpoint's RLS lookup before any write. A forged or foreign id finds nothing.

### Configuration

`src/lib/env.ts` validates configuration lazily. When the public Supabase settings are
missing, the app still builds and the root layout renders a "not set up yet" screen that
names the missing variables (never their values); `/api/sync` answers 503 so devices keep
their unsynced answers. `NEXT_PUBLIC_*` values are inlined at build time, so they must be
present for `npm run build`. The service-role key is read only on the server.

### Design system

- Tokens are CSS variables in `src/app/globals.css`, exposed to Tailwind v4 via
  `@theme inline` (`bg-primary`, `text-muted`, `bg-success-soft`, …). High-contrast and
  larger-text variants are `data-` attributes on `<html>` set per device
  (`components/layout/display-preferences.tsx`); reduced motion follows the OS.
- Primitives in `src/components/ui`: `Button` (+ `buttonClasses` for links), `Card`,
  `Field`/`Input`/`Select`, `Alert`, `EmptyState`, `Spinner`, `ProgressBar`. Feedback
  always pairs colour with an icon and words. Child-sized targets use `size="xl"` (≥ 80 px).
- No component library dependency: the primitives are small, accessible and themed by
  tokens (ADR-015).

### Shells and states

- Root layout: skip-to-content link, display-preference script, service worker registration.
  Every shell renders a `<main id="main">`.
- `AppShell` (`components/layout/app-shell.tsx`): parent and admin areas; navigation marks
  the current page with `aria-current` and scrolls horizontally on phones.
- The child layout is its own, simpler shell (avatar, offline badge, grown-up gate).
- Error boundaries: `app/error.tsx` (public pages), `app/parent/error.tsx` and
  `app/admin/error.tsx` (message + digest for grown-ups), `app/child/error.tsx`
  ("Something went wrong. Let's try again." only), `app/global-error.tsx` (root layout
  failure). Loading: `loading.tsx` in parent, child and admin. Empty states use
  `EmptyState` with a reason and, where possible, a next step.

## Data-driven learning engine

Hierarchy: LEVEL → SUBJECT → UNIT → SKILL → LESSON → ACTIVITY → QUESTION (see
`docs/database.md`). Content is authored in `content/` and imported; nothing about a
specific lesson exists in code.

A question's `question_type` picks a renderer (`src/features/activities/registry.tsx`).
`content`/`answer` are JSON validated by `src/lib/content/question-schemas.ts` at import
and again at load (`src/lib/server/lesson-loader.ts`), which skips and logs invalid
questions or types without a renderer instead of breaking the lesson.

Renderers implemented in this milestone: `INTRO` (explanation/demonstration),
`MULTIPLE_CHOICE`, `LISTEN_AND_CHOOSE`, `PICTURE_MATCH`, `MISSING_LETTER`, `WORD_BUILDER`
(with a blending demonstration), `SENTENCE_BUILDER`, `SPELLING`.

The lesson player (`src/features/lesson-player`) runs a pure state machine
(`src/lib/learning/lesson-session.ts`): answer → feedback → one retry → reveal → next.
Only first tries are scored.

## Progress pipeline

1. The child answers. The player evaluates locally for instant feedback
   (`src/lib/learning/evaluate.ts`) and writes an `attempt` event with a device-generated
   UUID to the IndexedDB outbox. At the end it writes a `lesson_run` event.
2. `SyncProvider` flushes the outbox on load, on reconnect, when the app returns to the
   foreground, after each answer and every 30 s while anything is pending.
3. `POST /api/sync` authenticates, rate-limits, validates (Zod), confirms the child belongs
   to the parent via RLS, then calls `processSyncBatch` (`src/lib/server/progress-writer.ts`).
4. The writer re-evaluates every answer against the stored question (the device never sends
   correctness), inserts attempts and runs with `on conflict (id) do nothing`, scores runs
   from their stored first tries, then recomputes lesson progress, skill mastery, My Words,
   rewards and achievements. Every step is idempotent, so retries converge.
5. The device removes only events the server confirmed (`stored`/`duplicate`). Rejected
   events are kept as `failed` with a reason and shown in parent Settings, where they can be
   retried.

Conflict policy: history is append-only, so there are no write conflicts — the union of all
devices' events is the truth. Derived tables are recomputed from that union. Device
timestamps are clamped to [now − 60 days, now + 5 min].

## Adaptive learning (V1, rule-based)

- `src/lib/learning/mastery.ts` — mastery score, status and review schedule per skill from
  the latest 30 first-try attempts (documented in `docs/curriculum.md`).
- `src/lib/learning/recommendations.ts` — weak/strong skills, review candidates,
  "Practice X" messages.
- `src/lib/learning/daily-plan.ts` — today's plan from the parent's daily minutes, weak and
  due skills first.

## Audio

`src/lib/audio/audio-service.ts` is the only audio entry point: plays a recorded asset if
one exists, otherwise speaks with browser speech synthesis (en-US, rate 0.85; "Slow" 0.55),
preferring natural voices. It never throws; without audio the app still works because all
text is shown. Replacing TTS with recordings means filling `audio_assets` — no component
changes. Phonics sounds use `phonics_pattern_sounds.say_as` as a TTS approximation until
recordings exist.

## Offline / PWA

- Manifest (`src/app/manifest.ts`), icons in `public/icons` (generated by
  `scripts/icons/generate.mjs`).
- Service worker (`src/sw.ts`, built by `serwist build`): precaches the static bundle and
  keeps network-first copies of visited pages (14 days, 80 entries). A page never opened
  on the device, requested offline, gets `public/offline.html` — plain HTML with no app
  JavaScript, because a Next.js page served under another URL fails to hydrate (ADR-016).
  Only registered in production builds.
- `OfflineNavigation` turns in-app link taps into full loads while offline so the worker
  can answer from saved pages; `useOffline` covers dropped connections during Server
  Actions and navigations.
- Lesson payloads are also cached in IndexedDB (`lessons` store) for a future fully
  client-side offline loader.
- Signing out deletes saved pages and cached lessons from the device but keeps unsynced
  answers (they can only be accepted for a child of the parent who signs in next).

## Security

- RLS on every table (`supabase/migrations/20260929100600_rls_and_grants.sql`), explicit
  grants, column-level grants for user-editable columns, no user write access to progress.
- Service-role key is server-only (`getServerEnv()` throws in the browser) and used by one
  module, after an ownership check.
- Server Actions and the sync route re-check `getUser()`; redirects are same-site only.
- Security headers in `next.config.ts`. Rate limiting on `/api/sync` (in-memory, per
  instance — see ADR-009).
- Structured logs without personal data (`src/lib/logging.ts`).

## Error handling

See "Shells and states" above. Children never see technical details; grown-ups see the
message and a digest that matches the server log line. An offline indicator is shown in
both the parent and child areas.
