# Nisa Al-Huda

Learning-management app for the Nisa Al-Huda institute: a public catalogue and
enrolment funnel on the front, and role-scoped dashboards (student, instructor,
treasurer, admin) behind login — lessons and progress, live-session schedules,
announcements, and the monthly fee cycle with receipt upload and payment
blocking.

**Stack:** Next.js 16 (App Router, React 19) · Supabase (Postgres + Auth +
Storage + RLS) · Tailwind 4 · Vitest · Playwright · Resend for transactional
email. Deployed on Railway; the two cron jobs are driven by `vercel.json`.

---

## Prerequisites

| Tool | Version used | Notes |
| --- | --- | --- |
| Node | 20+ (24 works) | Railway builds on Node 20 — see `nixpacks.toml` |
| npm | 10+ | `.npmrc` pins `legacy-peer-deps=true`; the tree will not install without it |
| Docker | running | only for the local Supabase stack |
| Supabase CLI | 2.x | `brew install supabase/tap/supabase` |

---

## Quick start

```bash
npm ci                 # legacy-peer-deps comes from .npmrc, no flag needed
npm run db:start       # boots Postgres/Auth/Storage in Docker, applies all 32 migrations
npm run env:local      # points .env.local at that stack
npm run seed           # programme, subjects, lessons, admin + instructor
npx tsx scripts/seed-instructors.ts
npx tsx scripts/seed-student.ts
npx tsx scripts/seed-tajweed-class.ts
npm run seed:e2e       # the account the Playwright specs log in as
npm run dev            # http://localhost:3000
```

Useful local URLs once the stack is up:

| What | URL |
| --- | --- |
| App | http://localhost:3000 |
| Supabase Studio | http://127.0.0.1:54323 |
| Mailpit (every auth email lands here) | http://127.0.0.1:54324 |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |

### Seeded accounts

| Role | Email | Password |
| --- | --- | --- |
| Admin | admin@nisaalhuda.com | `Admin@123` |
| Instructor | instructor@nisaalhuda.com | `Instructor@123` |
| Student | student@nisaalhuda.com | `Student@123` |

`seed-instructors.ts` adds the real teaching staff as additional instructor
accounts.

---

## Two backends, one command

Next.js only ever loads `.env.local`. Rather than hand-editing it, keep one
profile per backend and switch:

```bash
npm run env:local      # .env.stack-local  -> .env.local   (Docker stack)
npm run env:hosted     # .env.stack-hosted -> .env.local   (real project)
```

`.env.stack-local` is written for you by the setup. For the hosted project,
fill in `.env.stack-hosted` from **Supabase dashboard → Project Settings → API
Keys**. The switcher refuses to activate a profile with a blank required key,
so you get a clear error instead of an opaque failure three screens into the
app. Restart the dev server after switching.

> The hosted profile points at **real student, enrolment and payment rows**, and
> `SUPABASE_SERVICE_ROLE_KEY` bypasses every RLS policy. Treat a session on that
> profile as production access.

`.env.example` documents all seven variables. Only `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and
`NEXT_PUBLIC_SITE_URL` are required; without `RESEND_API_KEY` email is skipped
with a console warning and nothing throws.

---

## Database

Migrations live in `supabase/migrations/` as plain SQL, applied in filename
order.

```bash
npm run db:reset       # drop, re-apply every migration (destructive, local only)
npm run db:status      # ports and keys
npm run db:studio      # open Studio
npm run db:stop        # free the ~1.5GB of RAM
```

**Naming matters.** The Supabase CLI only applies files whose prefix is purely
numeric. A file called `011b_…sql` is *skipped with a warning you will scroll
past*, and the database comes up quietly missing whatever it defined. That
already happened once here: `011b_email_lookup_function.sql` was never applied
to any fresh database even though five call-sites depend on
`get_profile_by_email()` and `email_exists()`. It now lives at
`032_email_lookup_function.sql`. Name new migrations `NNN_snake_case.sql`,
digits only.

**Migrations must not assume rows exist.** `016` seeds an offering against a
specific instructor UUID; on a fresh database that profile does not exist and
the foreign key aborted the whole migration run. It is now an
`INSERT … SELECT … FROM profiles WHERE id = …`, which yields zero rows instead
of failing. Follow that pattern for any data seed inside a migration.

### Local stack memory

`supabase/config.toml` disables `[analytics]` and `[edge_runtime]`. Logflare and
its vector collector are OOM-killed on a Docker VM with ~2GB, taking the whole
`supabase start` down with them, and nothing in this app reads either service.
Re-enable them only if you also give Docker more memory.

---

## Scripts

```bash
npm run dev            # dev server
npm run build          # production build
npm run start          # serve the build

npm run verify         # typecheck + lint + unit tests
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run lint:fix

npm run test           # vitest, watch
npm run test:run       # vitest, once
npm run test:coverage
npm run test:e2e       # playwright (builds and serves automatically)
npm run test:e2e:ui
```

One-off maintenance scripts (`backfill-user-names`, `cleanup-bad-enrollments`,
`diagnose-orphan-students`, …) sit in `scripts/` and run with
`npx tsx scripts/<name>.ts`. They read `.env.local`, so **they hit whichever
backend is currently active** — check `npm run env:local` has been run before
using any of them casually.

---

## Layout

```
src/
  app/
    (public)/        catalogue, offering detail, enrolment funnel
    (auth)/          login, register, forgot/reset password
    dashboard/       student · instructor · admin · treasurer
    api/
      cron/          roll-published-window, roll-monthly-cycles,
                     send-payment-reminders  (Bearer CRON_SECRET)
      email/  health/
    auth/callback/   Supabase OAuth/magic-link landing
  components/        ui/ (shadcn) + feature folders
  lib/
    supabase/        client (browser) · server (RSC) · admin (service role) · middleware
    db/              query layer
  proxy.ts           session refresh + route protection
                     (Next 16 renamed middleware.ts → proxy.ts)
supabase/migrations/ 32 SQL migrations
__tests__/           vitest unit tests
tests/e2e/           playwright specs
```

Three Supabase clients, and picking the wrong one is the easiest security
mistake in this codebase:

- `lib/supabase/client.ts` — browser, anon key, RLS applies.
- `lib/supabase/server.ts` — Server Components/Actions, anon key + user cookie,
  RLS applies as that user.
- `lib/supabase/admin.ts` — **service role, RLS bypassed.** Server-only, and
  only for work that genuinely has no user context (guest enrolment, creating
  accounts on approval, cron).

---

## Testing

`npm run test:run` is fast and hermetic — 37 unit tests, no database.

`npm run test:e2e` builds the app, serves it on :3000 and drives Chromium
against **whatever backend `.env.local` points at** — keep that on the local
stack. Current state: **150 passed, 29 skipped, 0 failed** in under 3 minutes.

Every spec hard-codes one login, and that account only ever existed in the
hosted project. Seed it before the first local run:

```bash
npm run seed:e2e
```

Without it the suite does not fail fast — each test burns its own 60s
`waitForURL` timeout, which is 127 failures over half an hour. The script
refuses to run against a non-local backend, since it writes a known password.

It seeds three things the specs need, and each one is load-bearing:

- **The account is an admin**, not a student. The spec headers say so
  ("uses engineer.awaismoeen@gmail.com (admin)") and the navigation specs
  assert admin-only chrome. Neither `/dashboard/student` nor the learning hub
  is gated on role — both are gated on an approved enrollment — so one admin
  account with an enrollment satisfies both halves of the suite.
- **The enrollment is in a monthly-fee offering.** The billing-statement card
  renders only for `fee_type = 'monthly'`; without one those specs self-skip.
- **Its lessons carry a `scheduled_at`.** `partitionLessons()` files a lesson
  with neither a schedule nor a live link under downloadable *resources* rather
  than *classes*, so unscheduled lessons never reach the lesson list — the
  progress ring has nothing to draw and the ring specs fail on a missing
  element.

The 29 skips are specs that guard their own preconditions (`test.skip()` when
no rejected payment cycle, no pending financial-assistance request, and so on).
They are honest skips, not silent passes; seeding that data would turn them
into real assertions.

> The specs commit a real personal email and password in plaintext. See
> [Known rough edges](#known-rough-edges).

---

## Deployment

Railway builds via `nixpacks.toml` (Node 20, `npm ci`, `npm run build`) and
serves `next start -p $PORT -H 0.0.0.0`, health-checked at `/api/health`.
Set all seven environment variables in the Railway service — `NEXT_PUBLIC_*`
ones are baked in at build time, so changing them needs a redeploy, not a
restart.

`vercel.json` declares the two schedules that must hit the cron routes with
`Authorization: Bearer $CRON_SECRET`:

| Path | Schedule |
| --- | --- |
| `/api/cron/roll-published-window` | `0 3 * * 1` (Mondays) |
| `/api/cron/roll-monthly-cycles` | `0 3 * * *` (daily) |

---

## Known rough edges

- `npm run lint` reports ~76 errors and ~42 warnings on a clean checkout, mostly
  `no-explicit-any` and unescaped apostrophes. Pre-existing; `npm run verify`
  will stay red until they are cleared.
- **`tests/e2e/*.spec.ts` commit a real personal email and password in
  plaintext**, repeated across ten spec files. Anyone with repo access has
  working credentials for whatever that account can reach in the hosted
  project — and it is an admin. Worth rotating the password, and moving the
  pair into `process.env` with a test-only address.
- The `Tabseer ul Quran` offering does not appear locally. Its migration is
  pinned to a production instructor UUID that no local seed creates, so the
  guarded insert correctly matches nothing.
