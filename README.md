# Worship Scheduler

Worship Scheduler is a multi-tenant church ministry scheduling application built for coordinators who need to plan services without violating member availability, workload limits, qualifications, or ministry rules.

It combines member and availability management with schedule generation, validation, replacement suggestions, devotion rotation, fairness analytics, and exports.

## What it does

- Manages churches, departments, ministries, roles, instruments, members, skills, and availability.
- Generates worship service schedules for a selected month and ministry.
- Enforces hard constraints such as active status, availability, monthly assignment limits, role qualifications, duplicate-role prevention, backup counts, and exactly one worship leader.
- Reports warnings and suggestions for cooldown, fairness, and leader rotation.
- Suggests qualified replacements when an assignment conflicts.
- Tracks sequential devotion rotation and assignment history.
- Provides dashboards for workload, fairness, availability, and conflict analysis.
- Supports roster-based name login backed by Supabase Auth.

## Stack

- Next.js 16 App Router and React 19
- TypeScript
- Tailwind CSS v4 and shadcn-style UI components
- Supabase for PostgreSQL, Auth, Row Level Security, triggers, and migrations
- Vitest for unit tests
- Vercel-compatible deployment

## Quick start

### Requirements

- Node.js compatible with the installed Next.js toolchain
- npm
- A Supabase project with the repository migrations applied

### Install

```bash
npm ci
```

Create `.env.local` with the values for the local Supabase project:

```env
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
ADMIN_LOGIN_USERNAME=your-local-admin-username
ADMIN_LOGIN_PASSWORD=your-local-admin-password
ADMIN_LOGIN_EMAIL=the-email-of-that-supabase-admin-user
```

Never commit `.env.local` or expose `SUPABASE_SERVICE_ROLE_KEY` to browser code. The browser uses only the public anon key; privileged server operations use the server-only service role key.

The login screen defaults to roster-name login for active ordinary members. Members are sent to a private workspace containing only their own profile and availability. Staff use the accessible **Admin login** toggle and are sent to the dashboard. Configure the admin username, password, and the email of an existing Supabase admin/coordinator account through server-only environment variables; do not place the password in source control, documentation, client code, or logs.

### Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Development commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local Next.js development server |
| `npm run lint` | Run ESLint using the Next.js ruleset |
| `npm test` | Run the Vitest suite once |
| `npm run build` | Type-check and create the production build |
| `npm run start` | Serve a completed production build |

Before every push, run the complete verification gate:

```bash
npm run lint
npm test
npm run build
```

All three commands must pass. Also run `git diff --check` and inspect the final diff before pushing.

## Architecture

```text
src/app/
├── (auth)/                         Login, registration, password reset
├── (dashboard)/                    Protected application pages
│   ├── dashboard/                  Overview
│   ├── schedule/                   Schedule management
│   ├── members/                    Member management
│   ├── availability/               Availability management
│   ├── ministries/                 Ministry configuration
│   ├── analytics/                  Fairness and workload analytics
│   ├── exports/                    Export center
│   └── settings/                   Church settings
└── api/                            Route handlers for application data
    ├── auth/name/                  Roster name authentication
    ├── members/                    Member operations
    ├── availability/               Availability operations
    ├── schedule/                   Schedule operations
    ├── validation/                 Schedule validation
    ├── devotion/                   Devotion rotation
    └── export/                     Export generation

src/components/                     Feature components and shared UI primitives
src/lib/scheduling/                  Engine, validator, rules, fairness, replacements
src/lib/types/                      Database and scheduling contracts
src/lib/supabase/                    Browser and server client factories
supabase/migrations/                 Ordered schema, RLS, triggers, and seed data
docs/                                Architecture and integration notes
```

The scheduling domain belongs in `src/lib/scheduling`. Pages and API routes should orchestrate that domain rather than reimplementing eligibility or validation rules.

## Scheduling model

Services move through `draft → validated → published → archived`. A service contains assignments to roles and optional instruments. The validator classifies findings as:

- **Critical** — invalidates the schedule and blocks publication.
- **Warning** — indicates an enabled preference or advisory issue.
- **Suggestion** — identifies a fairness or optimization opportunity.

The non-negotiable rules are:

1. Never assign unavailable members.
2. Respect each member's monthly assignment limit; the default is 3.
3. Do not duplicate a member's role in one service unless dual roles are explicitly allowed.
4. Keep backups within the configured minimum and maximum; the current default is 3–3.
5. Assign exactly one worship leader.
6. Assign active members only.
7. Assign the worship leader role only to qualified members.

Fairness, cooldown, and leader rotation are configurable preferences and must never override a hard eligibility rule.

## Database and security

The database is tenant-scoped by `church_id`. RLS policies, API queries, scheduling context, and UI data must preserve that boundary. Schema changes must be added as a new timestamped migration in `supabase/migrations`; do not rewrite an applied migration.

The migration set covers:

1. core church/ministry entities;
2. users, members, roles, and skills;
3. services and assignments;
4. availability;
5. devotion rotation;
6. ministry rules;
7. audit logs and notifications;
8. RLS policies;
9. functions and triggers;
10. seed data and roster name-auth additions.

## Contribution workflow

Read [`AGENTS.md`](AGENTS.md) and the canonical repository skill at [`.agents/skills/00-worship-scheduler/SKILL.md`](.agents/skills/00-worship-scheduler/SKILL.md) before making changes.

Keep changes focused, update tests when behavior changes, and preserve existing uncommitted work. Never automatically merge, rebase, cherry-pick, or otherwise incorporate commits from another branch. Ask the developer first and state the exact branch or commit involved.

Before pushing, report the branch, changed files, verification results, and any remaining limitation. A green local build does not authorize a merge or deployment.

## Further documentation

- [`AGENTS.md`](AGENTS.md) — scheduling rules and repository instruction entrypoint
- [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) — implementation direction and scope
- [`ROADMAP.txt`](ROADMAP.txt) — planned product work
- [`docs/frontend-architecture.html`](docs/frontend-architecture.html) — frontend architecture reference
- [`docs/backend-architecture.html`](docs/backend-architecture.html) — backend architecture reference
- [`docs/mcp-setup.md`](docs/mcp-setup.md) — local MCP setup notes
- [`vercel.md`](vercel.md) — repository Vercel platform guidance

## License

This is a private application. Licensing and deployment decisions are controlled by the repository owner.
