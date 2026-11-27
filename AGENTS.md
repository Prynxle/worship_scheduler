# Repository instructions

Read `.agents/skills/00-worship-scheduler/SKILL.md` before anything else. It is the canonical operating contract for this repository: product context, tenant/security invariants, architecture, scheduling rules, the verification gate, and Git safety. This file adds only details that are easy to miss; if the two conflict, the skill wins.

`CLAUDE.md` imports this file, so keep this as the single entrypoint.

## Commands

```powershell
npm ci                  # clean install from the committed package-lock.json
npm run dev             # Next.js dev server on http://localhost:3000
npm run lint            # eslint, no --fix
npm test                # vitest run, one pass (not watch)
npm run build           # production build + TypeScript checking
npx vitest run src/lib/scheduling/validator.test.ts                         # one test file
npx vitest run -t "defers" src/lib/scheduling/validator.test.ts             # one test by name
```

Verification gate before every push, in this order: `npm run lint`, `npm test`, `npm run build`, then `git diff --check`. CI (`.github/workflows/ci.yml`) runs the same three as separate jobs on Node 22.

## Test quirks

- Vitest only includes `src/**/*.test.ts`; files named `.test.tsx` are ignored.
- The environment is `node` with alias `@` -> `src`. There is no jsdom or Testing Library.
- Component tests render markup with `react-dom/server`; see `src/components/members/member-card.test.ts`. Do not use DOM APIs or `render()`.

## Architecture

- App Router under `src/app`; Server Components by default, `'use client'` only for interactivity, browser APIs, or session behavior.
- Domain logic lives in `src/lib/scheduling`, `src/lib/api`, and `src/lib/<feature>`. Routes and UI orchestrate it; do not reimplement eligibility or validation in a page or route.
- Route-handler flow: `getAuthContext`/`requireStaff` (`src/lib/auth/server.ts`) -> tenant-scoped Supabase read -> pure domain object (`ScheduleValidator`, engine, report builder) -> SQL RPC for schedule state changes. Return failures through `toErrorResponse` (`src/lib/api/errors.ts`); it is the only place that decides status and prevents raw Postgres messages leaking. `api/availability/reset` intentionally carries its own SQLSTATE map.
- Scheduling rules are enforced twice. `src/lib/scheduling/validator.ts` and the SQL gate `assert_service_meets_publication_rules` (called from `validate_service_schedule`, `publish_service_schedule`, and `persist_month_schedule`) must both enforce a rule change. The SQL gate is the last line of defence and must never be weaker than the TypeScript layer.
- Validation stages: `draft` downgrades only four gap criticals (`leader_count_missing`, `backup_count_min`, `devotion_missing`, `required_instrument_missing`) to warnings; `final` (validate/publish) downgrades none. Only `availability` and `instrument_qualification` are overridable, via stored `active_overrides`. Severity handling is centralized in `ScheduleValidator.report`; do not add ad hoc relaxations.
- The schedule lifecycle is versioned: `draft -> validated -> published -> archived`, guarded by `schedule_version`, `validated_version`, and `expected_version`. Preserve the 409/403/422 semantics and do not bypass the RPCs with direct table writes.
- Role identity is name-based: `src/lib/scheduling/role-classifier.ts` and SQL (`lower(trim(name)) = 'worship leader'`, `~ '(vocal|singer|backup)'`, etc.). Predicates may only widen (see the guard-rail comment in that file); renaming a role can break matching.
- Supabase: `getSupabaseClient()` uses the anon key in the browser and `SUPABASE_SERVICE_ROLE_KEY` on the server; `createServerClient()` is service-role only. Never call either from a Client Component, and never move the service-role key into a `NEXT_PUBLIC_*` variable.

## Scheduling rules

Hard constraints (never violate):

1. Never assign an unavailable member. Weekly, date, vacation, temporary/emergency leave, and recurring records all count.
2. Respect the monthly assignment limit: default 3; a member's `max_monthly_assignments` overrides the church setting.
3. One role per member per service unless the ministry explicitly allows dual roles.
4. Keep backups within the configured min/max; current default is 3–3.
5. Exactly one worship leader per service.
6. Active members only.
7. The worship leader must hold the ministry's Worship Leader role.

Fairness, cooldown, and leader rotation are preferences/warnings; they never override a hard constraint. Critical findings block validation and publication. Never downgrade a critical to make a schedule pass, and never claim a schedule is valid without running the validator.

## Data and migrations

- Scope every tenant-owned read, write, validation, and response to `auth.churchId`. RLS is the backstop, not a replacement for route scoping.
- Add a new timestamped migration under `supabase/migrations`; never edit an applied migration. Keep schema, `src/lib/types`, route behavior, and tests synchronized.
- There is no `supabase/config.toml` and no Supabase CLI on PATH here. Apply migrations through the reviewed/manual process described in `docs/mcp-setup.md`.
- Song lineups are additive and their migration is not applied automatically; read `docs/song-lineups.md` before enabling or changing that flow.
- Gitignored/local-only: `.env*`, `opencode.json`, `zed/`, `.codex/`. Do not commit them or assume a fresh checkout has them.
- Generated files: `.next/`, `next-env.d.ts`, `*.tsbuildinfo`; do not hand-edit.

## Git and collaboration

- Work on the current branch unless asked. Never commit directly to `main` or `master`.
- Never `merge`, `rebase`, `cherry-pick`, `reset --hard`, `checkout --`, force-push, or amend without explicit approval for that exact operation. Preserve uncommitted work, including work you did not create.
- Commit format: `<type>(<scope>): <description>` with `feat`, `fix`, `docs`, `refactor`, `test`, or `chore`. No AI attribution in commits, PR descriptions, or issues.
- Before editing, run `git status --short --branch` and `git diff --stat`. After the gate, run `git diff --check` and report the branch, changed files, commands/results, and any remaining blocker.
