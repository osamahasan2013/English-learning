# Development roadmap

Status as of 2026-09-29. ✅ done · 🟡 partial · ⬜ not started.

## Milestone 1 — vertical slice ✅

Parent login → create child → select grade → child dashboard → phonics lesson from the
database → audio → interactive practice (8 activity types) → score → progress saved →
parent dashboard reads real data. Verified by `tests/e2e/vertical-slice.spec.ts`.

Definition of done:

| Item                                | Status | Evidence                                                       |
| ----------------------------------- | ------ | -------------------------------------------------------------- |
| Authentication works                | ✅     | e2e register/login; `(auth)/actions.ts`                        |
| Child creation, grade selection     | ✅     | e2e; `parent/child-actions.ts`                                 |
| Child dashboard                     | ✅     | `/child/home` with path, today's plan, stars                   |
| Phonics lesson loads from database  | ✅     | `lesson-loader.ts`; 27 lessons imported                        |
| Audio works                         | ✅     | `lib/audio` (TTS, recorded-asset ready); unit tests            |
| ≥ 3 activity types                  | ✅     | 8 renderers                                                    |
| Answers evaluated, score calculated | ✅     | client + server re-evaluation; unit tests                      |
| Progress persisted                  | ✅     | outbox → `/api/sync` → history + derived tables; e2e checks DB |
| Parent dashboard reads real data    | ✅     | e2e                                                            |
| RLS protects family data            | ✅     | `supabase/tests/001…sql`; e2e isolation test                   |
| Tests cover critical logic          | ✅     | 125 unit/component tests, 2 SQL test files, 5 e2e tests        |
| Production build succeeds           | ✅     | `npm run build`                                                |
| PWA shell works                     | ✅     | e2e `pwa.spec.ts` (installable manifest, SW, offline reopen)   |

## Phase 1 — project foundation ✅ (audited and completed 2026-09-29)

| Item                            | Where                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| TypeScript (strict), app + SW   | `tsconfig.json`, `tsconfig.sw.json`, `npm run typecheck` (runs `next typegen` first) |
| Lint (warnings fail)            | `eslint.config.mjs`, `npm run lint`                                                  |
| Formatting                      | Prettier + Tailwind plugin, `.prettierignore`, `npm run format[:check]`              |
| Tests                           | Vitest (unit/component), SQL tests, Playwright                                       |
| CI                              | `.github/workflows/ci.yml` (typecheck, lint, format, tests, build)                   |
| Environment handling            | `src/lib/env.ts` (lazy), setup screen, `.env.example`                                |
| Supabase clients                | browser / server / service-role in `src/lib/supabase`                                |
| Migrations                      | `supabase/migrations`, types via `npm run db:types`                                  |
| Design system and primitives    | tokens in `globals.css`; `src/components/ui`                                         |
| App shell and responsive layout | `AppShell`, child layout, skip link                                                  |
| Error / loading / empty states  | `error.tsx` per area, `loading.tsx`, `EmptyState`                                    |
| PWA                             | manifest, icons, Serwist service worker, `offline.html` fallback                     |

## Phases

| #   | Phase                       | Status | Notes / next steps                                                                                                                        |
| --- | --------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Project foundation          | ✅     | Next 16, TS, Tailwind, lint, tests, docs                                                                                                  |
| 2   | Database and authentication | ✅     | Schema, RLS, email/password auth, password reset, parent profile (name, time zone), levels seeded by migration, DB-enforced family rules  |
| 3   | Multi-child system          | ✅     | Create/edit/archive (max 12), switcher, child mode + grown-up gate, forged child ids rejected                                             |
| 4   | Learning/content engine     | ✅     | Hierarchy, typed questions, registry, importer, templates                                                                                 |
| 5   | Phonics                     | 🟡     | Letters, digraphs, vowel teams, r-controlled, endings authored; more lessons per pattern (only 1 each now); pattern cards outside lessons |
| 6   | Vocabulary                  | 🟡     | Word bank + My Words data. Next: Word Explorer (`/child/words/[id]`), My Words screen, manual save, search                                |
| 7   | Spelling                    | 🟡     | SPELLING type + error classification. Next: spelling sessions, error-type analytics                                                       |
| 8   | Reading                     | ⬜     | READING renderer (stories exist), read-aloud with optional speech recognition + self-check fallback                                       |
| 9   | Writing                     | ⬜     | Canvas (touch/stylus, clear/undo/eraser/example), TRACING/WRITING renderers, stroke metrics                                               |
| 10  | Assessment                  | 🟡     | Schema, placement config + scoring logic, seeded placement. Next: assessment player, results, reassessment timeline                       |
| 11  | Adaptive learning           | 🟡     | Mastery, recommendations, daily plan. Next: mixed review sessions drawing questions across skills                                         |
| 12  | Parent dashboard            | 🟡     | Stats, chart, skills, weak/strong, recommendations, recent lessons, badges. Next: monthly view, words list, assessment history charts     |
| 13  | Games and rewards           | 🟡     | Stars, points, badges, streaks. Next: MATCH, MEMORY_MATCH, SORT, PHONICS_CLASSIFICATION renderers                                         |
| 14  | PWA/offline/sync            | 🟡     | Outbox, idempotent sync, SW. Next: fully client-side offline lesson loader from IndexedDB; background sync                                |
| 15  | Admin CMS                   | 🟡     | Guarded area, overview, word search. Next: reusable Zod-driven edit forms, CSV upload in UI, media upload with type/size validation       |
| 16  | Testing and optimisation    | 🟡     | CI for static checks and build. Next: DB + e2e tests in CI (Supabase CLI), axe accessibility checks, Lighthouse budget                    |

## Known limitations

- Isolated phonics sounds use speech-synthesis approximations (`say_as`) until recorded
  audio is added; voice quality depends on the device.
- Drag-and-drop works with a mouse; on touch screens tiles are tapped into place (drag on
  touch is on the Phase 13 list).
- The rate limiter is per server instance.
- Assessment and placement have data and logic but no UI yet; parents set the level manually.
- Pictures are emoji (render slightly differently per platform); `image_assets` is ready
  for illustrated images.

## Future extensions (not in scope yet)

British English, Arabic parent interface, professional audio, AI pronunciation and reading
feedback, more grades and languages, teacher accounts and classrooms, homework, printable
worksheets, notifications, email/PDF reports.
