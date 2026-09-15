---
name: 00-worship-scheduler
description: Repository-wide operating context and strict development workflow for the Worship Scheduler Next.js and Supabase codebase. Read this before any other skill or repository change.
metadata:
  short-description: Canonical Worship Scheduler repository context and safe workflow
---

# Worship Scheduler: canonical repository skill

## Mandatory precedence

You are working in the Worship Scheduler repository. Read this file before loading or applying any other skill. Treat it as the repository's operating contract.

You MUST:

1. Inspect the current branch, working tree, relevant files, and existing tests before editing.
2. Make the smallest coherent change that satisfies the request. Preserve unrelated user work.
3. Follow the project's existing framework, data model, TypeScript types, route conventions, and visual language before introducing abstractions or dependencies.
4. Run the full verification gate (`npm run lint`, `npm test`, and `npm run build`) after implementation and before every push.
5. Report every command that was run, its result, and any remaining limitation.
6. Ask the developer before any merge, rebase, cherry-pick, branch switch, conflict resolution that could discard work, or automatic incorporation of commits from another branch. Never perform these actions autonomously.
7. Never hide, revert, reset, overwrite, or delete existing work without explicit permission. Do not use destructive Git commands as a shortcut.

If a request conflicts with these rules, stop before the conflicting action and ask the developer for direction.

## Product context

Worship Scheduler is a multi-tenant church ministry scheduling application. It helps coordinators manage members, roles, instruments, availability, worship services, assignments, devotion rotation, conflicts, fairness, analytics, and exports. The core domain is a worship ministry schedule, but the schema is designed to support configurable ministries and roles.

The central data boundary is `church_id`. Every tenant-owned read, write, validation, schedule generation operation, API response, and UI query must remain scoped to the authenticated user's church. Do not add a query that trusts a client-provided tenant ID without validating it against the authenticated user and database policy.

## Technical baseline

- Framework: Next.js `16.2.12`, App Router, React `19.2.4`, TypeScript.
- Styling/UI: Tailwind CSS v4, shadcn-style components under `src/components/ui`, `lucide-react`, and the project's existing design system in `src/app/globals.css`.
- Data/auth: Supabase via `@supabase/supabase-js` and `@supabase/ssr`; migrations live in `supabase/migrations`.
- Tests: Vitest, Node environment, tests included by `src/**/*.test.ts`.
- Deployment target: Vercel-compatible Next.js deployment.
- Path alias: `@/*` resolves to `src/*`.
- Package manager: npm; use the committed `package-lock.json` and prefer `npm ci` for clean installs.

Do not upgrade Next.js, React, Supabase, Tailwind, or other major dependencies as part of an unrelated feature. Dependency upgrades require an explicit request and their own verification.

## Repository map

```text
src/app/
  (auth)/                         Login, registration, password reset
  (dashboard)/                    Protected dashboard shell and pages
    dashboard/                    Overview and upcoming services
    schedule/                     Schedule management
    members/                      Member management
    availability/                 Unavailability management
    ministries/                   Ministry configuration
    analytics/                    Workload, fairness, and availability analytics
    exports/                      Export center
    settings/                     Church settings
  api/
    auth/name/                    Roster name-login/session provisioning
    members/                      Member API
    availability/                 Availability API
    schedule/                     Schedule API
    validation/                   Validation API
    devotion/                     Devotion rotation API
    export/                       Schedule export API
src/components/                   Feature and shared UI components
src/lib/scheduling/                Scheduling engine, validator, rules, fairness, replacements
src/lib/supabase/                  Supabase client factories
src/lib/types/                    Database and scheduling domain types
supabase/migrations/               Ordered schema, policies, triggers, and seed migrations
docs/                              Architecture and MCP setup documentation
zed/agents/                        Repository-specific planning/QA/orchestration prompts
```

Use `src/lib/scheduling` for domain decisions. Do not duplicate assignment eligibility or validation logic in a page or route handler when the scheduling library can own it.

## Data and authentication invariants

There are two Supabase client modes in `src/lib/supabase/client.ts`:

- Browser code uses `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` only.
- Server code uses `SUPABASE_SERVICE_ROLE_KEY` through server-only client factories.

Never expose the service role key through a `NEXT_PUBLIC_*` variable, client component, browser bundle, response payload, log, README, test fixture, or commit. Treat any discovered secret as an incident: stop, avoid printing it, remove only with developer approval, and tell the developer to rotate it.

Authentication currently includes the roster name-login flow at `/api/auth/name`. It looks up an active roster member, creates or reuses a synthetic Supabase Auth identity, synchronizes the application `users` row, and returns session tokens for the browser to establish a session. Preserve its error handling, rate limiting expectations, and cleanup behavior when changing it. Do not weaken roster membership or active-status checks.

The database migration sequence is ordered by timestamp and currently establishes:

1. churches, departments, ministries, roles, instruments;
2. users, members, member_roles, member_skills;
3. services and schedule_assignments;
4. availability;
5. devotion_rotation;
6. ministry_rules;
7. audit_logs and notifications;
8. RLS policies;
9. functions/triggers for week numbers, auditing, assignment counters, and devotion advancement;
10. seed data and later name-auth migrations.

When changing the database, add a new timestamped migration. Never edit an already-applied migration unless the developer explicitly requests a repair. Keep schema changes, TypeScript interfaces, route behavior, and tests synchronized.

## Scheduling rules: hard constraints and preferences

The following rules are product behavior, not suggestions:

1. Never assign unavailable members, including weekly, date-specific, vacation, leave, and applicable recurring records.
2. Do not exceed a member's monthly assignment limit; default is 3 unless configured per member/church.
3. Do not assign the same member to duplicate roles in one service unless the ministry explicitly allows dual roles.
4. Respect the configured backup count. The current default is minimum 3 and maximum 3; configuration may change this.
5. Every service has exactly one worship leader.
6. Inactive members are never eligible.
7. Only members with the Worship Leader qualification may be assigned as leader.
8. Fairness is an optional preference: distribute assignments toward an even workload without violating hard constraints.
9. Cooldown is an optional warning/preference: avoid scheduling the same person in consecutive weeks.
10. Leader rotation is an optional warning/preference: avoid repeatedly selecting the same leader.

Validation severity matters:

- `critical`: blocks publication or indicates an invalid schedule.
- `warning`: schedule may be usable but violates an enabled preference or upper advisory bound.
- `suggestion`: optimization opportunity only.

Do not silently convert a critical conflict into a warning, silently assign an ineligible replacement, or claim a schedule is valid without running the validator. Replacement suggestions must independently pass active status, availability, monthly limit, duplicate-role, qualification, and instrument-skill checks.

## Application architecture rules

- Prefer Server Components by default. Add `'use client'` only for interactivity, browser APIs, local state, or client-side session behavior.
- Keep route handlers thin: parse and validate input, enforce auth/tenant scope, call domain/data logic, and return stable JSON errors.
- Use the typed interfaces in `src/lib/types`; update them when schema behavior changes. Avoid `any` and unchecked casts.
- Keep scheduling calculations deterministic and testable. Use the date utilities in `src/lib/utils/date-utils.ts` for date/week behavior instead of ad hoc date math.
- Preserve accessible controls, labels, keyboard behavior, loading states, empty states, and actionable error states in UI changes.
- Reuse existing components before adding a new primitive. Keep feature components in their existing feature folder and shared primitives in `src/components/ui`.
- Do not put secrets, service-role calls, or privileged mutations in Client Components.
- Keep API response shapes backward-compatible unless the request explicitly includes an API change.
- Avoid changing generated/build artifacts such as `.next`, `next-env.d.ts`, and `tsconfig.tsbuildinfo` by hand.

## Required development workflow

### Before editing

Run:

```powershell
git status --short --branch
git diff --stat
```

Read the nearest relevant route/component, its imported domain logic/types, and the related test/migration before editing. If the task crosses auth, Supabase, migrations, or Vercel behavior, load the relevant specialized skill after this skill.

### During editing

- Use `apply_patch` for intentional file edits.
- Keep changes focused and explain non-obvious decisions in code comments only where they protect an invariant.
- Add or update unit tests for scheduling rules, validation, date behavior, API parsing, and other changed logic.
- For migrations, verify ordering, constraints, RLS, triggers, rollback implications, and tenant scope.
- For UI changes, verify mobile behavior and accessibility; do not use placeholder claims in product copy.

### Verification before push

Run all three commands from the repository root, in this order:

```powershell
npm run lint
npm test
npm run build
```

All three must pass before pushing. If a command fails, fix the cause and rerun the complete gate. Do not push with a known lint, test, TypeScript, or production-build failure. If an external dependency or environment prevents verification, do not claim success; report the exact command and blocker to the developer.

After the gate, inspect:

```powershell
git diff --check
git status --short --branch
git diff --stat
```

Before `git push`, show the developer the branch, intended remote/ref, changed-file summary, and verification results. Push only the current branch and only when the developer's request authorizes it. Never merge another branch automatically.

## Git and collaboration safety

- Work on the current branch unless the developer explicitly asks to create or switch branches.
- Never run `git merge`, `git rebase`, `git cherry-pick`, `git reset --hard`, `git checkout --`, or broad deletion commands without explicit developer approval for that exact operation.
- If another branch contains a likely fix, tell the developer which branch/commit you found and ask whether to merge, cherry-pick, or manually reimplement it.
- Preserve uncommitted changes, including changes you did not create. If a conflict exists, stop and ask rather than resolving by preference.
- Do not amend, squash, force-push, or change commit history unless explicitly requested.
- Never assume a green local build authorizes a merge or deployment.

## Completion report

Every implementation response must state:

- what changed and why;
- files added/modified;
- tests and verification commands with outcomes;
- migration/auth/security implications, if any;
- whether anything remains blocked or requires developer approval;
- whether no branch merge or automatic cross-branch incorporation was performed.
