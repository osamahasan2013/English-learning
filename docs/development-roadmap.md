# Development roadmap

Status after Phase 4 (phonics engine). ✅ done · 🟡 partial · ⬜ not started.

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
| Phonics lesson loads from database  | ✅     | `lesson-loader.ts`; lessons imported from `content/`           |
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

## Phase 3 — learning engine ✅ (completed 2026-10-01)

The project plan's Phase 3 (the reusable, data-driven learning engine — not the full phonics
programme) maps to row 4 below and parts of rows 8, 9, 11, 12 and 13:

| Area                         | Where                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Hierarchy and content models | migrations `…100400`, `20261001100100`; `lesson_catalog` view; subjects/levels as data                                                 |
| Activity system              | 12 scored types + intro, typed content and config schemas, registry, 6 new renderers                                                   |
| Answers                      | server-only `questions.answer`, digest answer keys, server re-evaluation (ADR-021)                                                     |
| Progress                     | attempts with scores; activity, lesson, skill, subject and level progress; learning sessions                                           |
| Mastery and review           | configurable bands, repeated evidence, review queue (ADR-022), prerequisites with preview                                              |
| Services                     | `getNextLesson`, `getRecommendedLessons`, `getWeakSkills`, `getReviewItems`, `getLessonReadiness`                                      |
| Lesson player                | intro → activities → summary, back/next/exit, configurable feedback, resume after closing                                              |
| Dashboards                   | child: level, recommended lesson, subjects, recent lessons, skills; parent: activities, average score, learning time, subject progress |
| Tests                        | unit, SQL (`004_learning_engine.sql`), integration (`learning-engine.test.ts`), e2e (`learning-engine.spec.ts`)                        |

## Phase 4 — phonics engine ✅

Built on the Phase 3 engine (no separate mastery, progress or assessment system):

| Area               | Where                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phonics model      | migration `20261002100100`; phonemes, stages, pattern sounds as phonemes, relations, word segments, review flags (ADR-024, ADR-026)                                |
| Word decomposition | `src/lib/learning/phonics.ts` (graphemes → phonemes, CVC shape, decodable), authored overrides in the words CSV                                                    |
| Activity types     | `BLEND_SOUNDS`, `SEGMENT_WORD`, `FIND_PATTERN` + 13 phonics templates over existing types                                                                          |
| Lessons            | blueprints `letter_sound`, `cvc_blending`, `phonics_pattern` (ADR-025); 26 letters, 5 short vowels, digraphs → suffixes                                            |
| Assessment         | Phonics Check (12 areas) in the lesson player; server scoring per area; mastery + `last_assessed_at` (ADR-027)                                                     |
| Screens            | `/child/phonics` (Letters, Sounds, Blend, Read Words, Practice, Mastery; stars), parent/admin pattern search, dashboard percentages                                |
| Audio              | Listen / Slow / Again everywhere, visible no-sound fallback                                                                                                        |
| Tests              | unit (`phonics`, `phonics-engine`, content files), SQL `005_phonics_engine.sql`, integration `phonics.test.ts`, e2e `phonics.spec.ts` on phone, tablet and desktop |

## Phases

| #   | Phase                       | Status | Notes / next steps                                                                                                                                                      |
| --- | --------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Project foundation          | ✅     | Next 16, TS, Tailwind, lint, tests, docs                                                                                                                                |
| 2   | Database and authentication | ✅     | Schema, RLS, email/password auth, password reset, parent profile (name, time zone), levels seeded by migration, DB-enforced family rules                                |
| 3   | Multi-child system          | ✅     | Create/edit/archive (max 12), switcher, child mode + grown-up gate, forged child ids rejected                                                                           |
| 4   | Learning/content engine     | ✅     | Hierarchy, typed questions and activity config, registry (13 renderers), importer, templates, answer keys, engine services (Phase 3)                                    |
| 5   | Phonics                     | ✅     | Phase 4: phoneme model, word splits, 3 new activity types, blueprints, Phonics screen, Phonics Check. Next: recorded audio, more lessons per pattern, decodable readers |
| 6   | Vocabulary                  | 🟡     | Word bank + My Words data. Next: Word Explorer (`/child/words/[id]`), My Words screen, manual save, search                                                              |
| 7   | Spelling                    | 🟡     | SPELLING type + error classification. Next: spelling sessions, error-type analytics                                                                                     |
| 8   | Reading                     | 🟡     | READING renderer (passage + comprehension) done. Next: story library screens, read-aloud with optional speech recognition + self-check                                  |
| 9   | Writing                     | 🟡     | TRACING (canvas, coverage scoring) and WRITING (word bank) done. Next: undo/eraser, stroke order and direction metrics                                                  |
| 10  | Assessment                  | 🟡     | Phonics Check playable and scored per area; placement config + scoring logic. Next: placement UI, reassessment timeline                                                 |
| 11  | Adaptive learning           | 🟡     | Mastery bands, prerequisites, review queue, next lesson and recommendations, daily plan. Next: mixed review sessions across skills, SRS                                 |
| 12  | Parent dashboard            | 🟡     | Stats, activities, average score, learning time, subject progress, skills, recommendations, badges. Next: monthly view, words list                                      |
| 13  | Games and rewards           | 🟡     | Stars, points, badges, streaks; MATCH, SORT, DRAG_DROP renderers. Next: MEMORY_MATCH, PHONICS_CLASSIFICATION                                                            |
| 14  | PWA/offline/sync            | 🟡     | Outbox, idempotent sync, SW. Next: fully client-side offline lesson loader from IndexedDB; background sync                                                              |
| 15  | Admin CMS                   | 🟡     | Guarded area, overview, word search. Next: reusable Zod-driven edit forms, CSV upload in UI, media upload with type/size validation                                     |
| 16  | Testing and optimisation    | 🟡     | CI for static checks and build. Next: DB + e2e tests in CI (Supabase CLI), axe accessibility checks, Lighthouse budget                                                  |

## Known limitations

- Isolated phonics sounds use speech-synthesis approximations (`say_as`) until recorded
  audio is added; voice quality depends on the device.
- Drag-and-drop works with a mouse; on touch screens tiles are tapped into place (drag on
  touch is on the Phase 13 list).
- Answer keys stop answers being read from the page, but small option sets can always be
  tried one by one on a modified client; the server's re-evaluation is what protects
  progress (ADR-021).
- Tracing is scored on coverage of the letter only (no stroke order or direction yet).
- VOCABULARY, SPELLING and LISTENING are defined subjects without units of their own yet
  (spelling and listening activities sit inside phonics and reading lessons).
- The rate limiter is per server instance.
- Placement ("Find My Level") has data and logic but no UI yet; parents set the level
  manually. The Phonics Check is playable.
- Word splits are rule-based: four words are flagged for review on purpose; unusual
  spellings need an authored `segments` value.
- Phonics lessons are one per pattern (a blueprint); extra practice comes from the review
  queue and replays rather than more lessons.
- Pictures are emoji (render slightly differently per platform); `image_assets` is ready
  for illustrated images.

## Future extensions (not in scope yet)

British English, Arabic parent interface, professional audio, AI pronunciation and reading
feedback, more grades and languages, teacher accounts and classrooms, homework, printable
worksheets, notifications, email/PDF reports.
