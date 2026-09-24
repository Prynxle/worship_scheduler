# Findings — Schedule Generation QA (2026-09-24)

Report-only QA evidence pass. No fixes were implemented in this pass.
Scope: why "Generate Schedule" is inert in the UI, why `POST /api/schedule` deterministically returns HTTP 422 for the real church UUID, and how the implementation maps to `worship-scheduler-generation-algorithm.md` (§1–27).

All line numbers were re-verified against the working tree on 2026-09-24. All database counts are read-only (`SELECT`) results captured on 2026-09-24 against the live Supabase project. This document creates no schedules, writes no rows, and changes no tracked source file.

---

## 1. Executive summary

The scheduling engine (`src/lib/scheduling/engine.ts`) is sound and implements the guide's core algorithm (most-constrained-first, deterministic scoring, temporary-state apply/rollback, 25k-node backtracking cap, independent re-validation). Generation does not work end-to-end because the **input layer is fake**: the only `/api/schedule` route handler feeds the engine a hardcoded 3-member mock roster whose `church_id` is `'church-1'`, filtered against the authenticated church UUID — the pool is always empty, so the engine always throws `SchedulingFailureError` and the route returns 422 `{services:[],validation:[],failures}`. In the UI, the "Generate Schedule" button has no `onClick` handler at all, so the page never calls the API and instead renders a hardcoded array of August 2026 mock cards.

Blocking root causes: **H1** (inert button), **H2** (church id mismatch → empty candidate pool → deterministic 422), **H3** (no DB-backed schedule context; `existing_assignments` hardcoded to `[]`). Warnings: **H4** (rule-config key mismatch, silently masked by fallbacks), **H5** (GET /api/schedule returns Saturday-dated "Sunday" services), **H6** (validation endpoint never evaluates real church members — empty scope yields an always-invalid `valid:false`, not `valid:true`), **H7** (unconditional `request.json()` + unbounded month/year). Gap: **H8** (guide §16–17 local repair not implemented).

Live repro captured today:
- Clicking "Generate Schedule" fired **zero** `/api/schedule` requests (network log unchanged: only 3 `/api/auth/me` GETs) and produced no console output.
- Authenticated `POST /api/schedule` `{month:9, year:2026, week_numbers:[1,2,3,4]}` with the coordzed browser session returned **422** with `eligible_candidates:[]` and `rejected_candidates:[]`.

---

## 2. Hypotheses H1–H8 (evidence and severity)

### H1 — BLOCKING: The "Generate Schedule" button is inert (no handler, no API call)

| Evidence | Location |
|---|---|
| Generate button renders without `onClick`; page never calls any generate endpoint | `src/app/(dashboard)/schedule/page.tsx:169-172` |
| Only `/api/schedule` caller in all of `src/` is the mock-unavailability POST | `src/app/(dashboard)/schedule/page.tsx:114` (`fetch('/api/schedule/mock-unavailability')`); grep for `fetch(`"/`/api/schedule` found no other callers |
| Page renders a hardcoded `mockSchedules` array (Aug 3/10/17/24, 2026) instead of fetching | `src/app/(dashboard)/schedule/page.tsx:11-95` |
| Live repro: network list before and after click identical (`33.` … `35.` all `GET /api/auth/me => 200`) — no `POST /api/schedule` | Browser network log, 2026-09-24T06:06Z |
| Live repro: page snapshot unchanged after click; button remained focused; console had no new entries | Browser snapshot + console, 2026-09-24T06:06Z |

Verdict: **Confirmed.** The button is a decorative `<Button>` with `Plus` icon and text only.

### H2 — BLOCKING: POST /api/schedule deterministically returns 422 for the real church UUID

| Evidence | Location |
|---|---|
| `mockMembers` hardcode `church_id: 'church-1'` (3 members: Heidi, Feng, Beng) | `src/app/api/schedule/route.ts:7-59` |
| Pool filter `mockMembers.filter((member) => member.church_id === auth.churchId)` → `church-1` ≠ UUID `d0eebc99-…` → always `[]` | `src/app/api/schedule/route.ts:78` |
| `context.all_members = churchMembers` (empty) → every slot has zero candidates → `solve` fails | `src/app/api/schedule/route.ts:99-100`; `src/lib/scheduling/engine.ts:84-90` |
| Engine throws `SchedulingFailureError` when no assignment exists | `src/lib/scheduling/engine.ts:38-43` (and `engine.ts:208-213` for post-validation; failure shape built at `engine.ts:226-232`) |
| Route maps the error to HTTP 422 `{services:[],validation:[],failures}` | `src/app/api/schedule/route.ts:116-121` |
| Live repro (2026-09-24T06:06Z): authenticated POST returned `422` with body `{"services":[],"validation":[],"failures":[{"service_id":"temp","week_number":1,"date":"2026-10-03","role_name":"Worship Leader","required_slots":1,"eligible_candidates":[],"rejected_candidates":[],"message":"No eligible candidate for Worship Leader in week 1."}]}` | Browser `fetch` against `/api/schedule` with session bearer token; dev-server log line `POST /api/schedule 422 in 1196ms` |

Verdict: **Confirmed.** The real church UUID (`d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`, "JOHIA Bankers") can never match `'church-1'`, so the failure is deterministic for every authenticated tenant.

### H3 — BLOCKING: No route reads scheduling inputs from the database

| Evidence | Location |
|---|---|
| POST builds `ScheduleContext` inline with `existing_assignments: []` and exactly four hardcoded rules | `src/app/api/schedule/route.ts:80-107` |
| `services`, `schedule_assignments`, `members`, `member_roles`, `member_skills`, `instruments`, `ministry_rules` are never queried in any `/api/schedule` handler (grep: no `.from(` in `src/app/api/schedule/route.ts`) | `src/app/api/schedule/route.ts` (full file read) |
| `historical_assignments` (fairness-across-months input) is never populated; engine defaults to nothing | `src/lib/scheduling/engine.ts:50-79` uses `context.historical_assignments ?? []` |
| Live DB has the inputs ready (19 members, 28 member_roles, 17 member_skills, 8 instruments, 9 ministry_rules) but they are never loaded | Section 6 below |

Verdict: **Confirmed.** The engine is fed a fabricated context; the DB-backed loader required by the guide's Phase 1 does not exist.

### H4 — WARNING: rule_config key mismatch between seed/DB and engine/validator

| Evidence | Location |
|---|---|
| DB/seed stores `assignment_limit → {"max_monthly": 3}`, `backup_count → {"min_backup_singers": 3}`, `leader_count → {"count": 1}` | `supabase/migrations/20260727213900_seed_data.sql:80-82`; live `ministry_rules` rows confirmed identical on 2026-09-24 |
| Engine reads `assignment_limit → default_max`, `backup_count → min_required` | `src/lib/scheduling/engine.ts:160`, `engine.ts:172` (`getRuleNumber` fallback 3) |
| Validator reads `assignment_limit → default_max`, `backup_count → min_required`/`max_allowed` | `src/lib/scheduling/validator.ts:100-102`, `validator.ts:176-182` |
| Cooldown key `weeks` matches (DB `{"weeks":1}`); the other three rule keys cannot match | `seed_data.sql:83` vs `engine.ts:91`, `validator.ts:284-286` |
| Effect: silent fallback to defaults (3) masks the mismatch, so misconfiguration would go unnoticed | `engine.ts:267`, `validator.ts:100-102/176-182` fallback defaults |

Verdict: **Confirmed.** `max_monthly`/`min_backup_singers`/`count` are never read by the engine or validator; `default_max`/`min_required`/`max_allowed` are never written by the seed. Currently masked by fallback defaults = 3.

### H5 — WARNING: GET /api/schedule returns Saturday-dated "Sunday" services

| Evidence | Location |
|---|---|
| `generateMockServices` anchors weeks on the 3rd/10th/17th/24th of the month | `src/app/api/schedule/route.ts:124-174` |
| Guide/date contract anchors weeks on the month's **first Sunday** | `src/lib/utils/date-utils.ts:8-12` (`getFirstSunday`), used by `engine.ts:170` and `getWeekDate` |
| Live repro (2026-09-24T06:07Z): `GET /api/schedule?month=9&year=2026` → dates `2026-10-02T16:00:00.000Z` … `2026-10-23T16:00:00.000Z` (local **Sat** Oct 3/10/17/24) | Browser fetch; verified local day-of-week: Oct 3 = Saturday, Oct 4 = Sunday |
| POST failure payload also surfaced a Saturday anchor (`"date":"2026-10-03"`) — consistent with `buildSlots`/`toGeneratedService` UTC serialization in this timezone | `engine.ts:170`, `engine.ts:188`; live 422 body |

Verdict: **Confirmed.** Mock services are not Sunday-anchored. (Related timezone nuance: `getWeekDate(…).toISOString().slice(0,10)` in a positive-offset timezone serializes the local Sunday to the previous UTC day; worth normalizing when dates are persisted.)

### H6 — WARNING: /api/validation never evaluates real church members (empty-scope surface; always-invalid synthetic outcome)

| Evidence | Location |
|---|---|
| Endpoint also uses hardcoded `mockMembers` (2 members, `church_id:'church-1'`) | `src/app/api/validation/route.ts:7-42` |
| `churchMembers = mockMembers.filter(member => member.church_id === auth.churchId)` → empty for the real church; `scopedAssignments` filters client assignments against the empty `churchMemberIds` → always `[]` — the evaluated scope is **empty**, so no real member is ever checked (vacuous scope is the risk) | `src/app/api/validation/route.ts:49-58` |
| Empty `existing_assignments` does NOT pass every check: `checkLeaderCount` and `checkBackupCount` emit criticals unconditionally, so the empty assignment set produces exactly 2 synthetic criticals and `valid: false` (`valid: critical.length === 0` with `critical.length = 2`) | `validator.ts:145-166` (`leader_count` "No worship leader assigned"), `validator.ts:168-203` (`backup_count` "Only 0 backup singers assigned (minimum: 3)"), `route.ts:93-98` |
| Live outcome (QA re-test on 2026-09-24, authenticated POST, read-only, no writes): HTTP **200** `{"valid":false,…}` with exactly 2 synthetic criticals — `leader_count` ("No worship leader assigned") and `backup_count` ("Only 0 backup singers assigned (minimum: 3)"). It is **NOT `valid:true`**; the prior draft's claimed `valid:true` was wrong | QA live authenticated `POST /api/validation`, 2026-09-24 |
| Live DB has 19 members that would never be considered | Section 6 below |

Verdict: **Confirmed.** The endpoint's scope is empty for the real church: it never evaluates the real members (vacuous scope is the risk), and its CURRENT live outcome for a real-church payload is an **always-invalid `valid:false`** driven by the two synthetic criticals against an empty assignment set — not `valid:true`. Severity remains warning/blocking-risk: the endpoint can neither certify a real schedule nor meaningfully evaluate one, and any client flow that relies on it receives a vacuous, non-representative result.

### H7 — WARNING: POST /api/schedule parses body unconditionally; month/year unbounded

| Evidence | Location |
|---|---|
| `const body = await request.json();` with no parse guard — malformed/non-JSON body rejects → 500 | `src/app/api/schedule/route.ts:76` |
| `month`/`year` are used directly in `new Date(year, month, 1)` with no range validation (contrast with the mock-unavailability route which bounds month 0–11 and year 2000–2100) | `src/app/api/schedule/route.ts:84-85` vs `src/app/api/schedule/mock-unavailability/route.ts:35-40` |

Verdict: **Confirmed.** Input hardening exists on `mock-unavailability` but not on the main generation route.

### H8 — GAP (fix-roadmap candidate): Guide §16–17 local repair not implemented

| Evidence | Location |
|---|---|
| Guide calls for local repair (replace one assignment → revalidate) before full regeneration | `worship-scheduler-generation-algorithm.md:939-999` |
| Engine does full backtracking; when no solution exists it throws; there is no local-repair pass | `src/lib/scheduling/engine.ts:81-114` (backtrack loop), `engine.ts:197-215` (post-validation throw) |

Verdict: **Confirmed gap.** Soft/repairable conflicts are not repaired locally; the engine bails to "no valid schedule" (422). Not blocking today because the input layer already fails before repair could matter.

---

## 3. Guide-phase mapping (§1–27 of `worship-scheduler-generation-algorithm.md`)

Status legend: **Implemented** / **Mocked** (works only on fabricated input) / **Missing** (absent or UI never wired). Severity: blocking / warning / suggestion.

| Guide section | Phase | Implementation status | Location | Severity |
|---|---|---|---|---|
| §2-5, 3.1-3.2, 4 | Scheduling model + hard/soft rules | Implemented (engine rules 1–10; soft rules as score/warning) | `engine.ts:155-167`; `validator.ts`; `scorer.ts` | warning (input config is mocked) |
| §11 Phase 1 (§1,21) | **Load scheduling context** (members, availability, roles, qualifications, limits, history, config, services) | **Mocked/Missing** — hardcoded `mockMembers`, `existing_assignments:[]`, 4 rules; no DB loader; `historical_assignments` never supplied | `route.ts:7-59,80-107`; `engine.ts:50-79` | **blocking** |
| §11 Phase 2 (§2) | Build assignment slots | Implemented | `engine.ts:169-182` | ok |
| §11 Phase 3 (§10) | Slot difficulty / most-constrained-first | Implemented (sort by pool size asc) | `engine.ts:84-86` | ok |
| §11 Phase 4 (§8) | Candidate pool (active → available → qualified → monthly limit → no duplicate in service) | Implemented | `engine.ts:144-167` | ok (pool empty due to Phase 1) |
| §11 Phase 5 (§9, 22) | Score candidates (fairness weights) | Implemented (configurable `FairnessScorer`) | `scorer.ts`; `engine.ts:92-104` | ok |
| §11 Phase 6 (§6) | Select best candidate, deterministic tie-break | Implemented | `engine.ts:106-113` | ok |
| §11 Phase 7 (§7) | Update temporary state | Implemented (apply/rollback) | `engine.ts:116-142` | ok |
| §12-13, 6 | Cross-month history / fairness persists | Partial — state model exists, but inputs (`existing_assignments`, `historical_assignments`) are mocked/fabricated | `engine.ts:50-79` | warning |
| §14-15 | Independent validation after generation; validation checklist | Implemented (independent `ScheduleValidator`, critical → throw) | `engine.ts:197-215`; `validator.ts` | ok |
| §16-17 | **Repair / local repair before regeneration** | **Missing** | `engine.ts:81-114,197-215` | warning (becomes blocking once real input flows) |
| §18 | State separation (persistent vs generation) | Implemented (temp state; final persist not connected) | `scorer.ts`; `engine.ts` | warning |
| §19 | Determinism | Implemented | `engine.ts:96-104` (member-id tie-break, no randomness) | ok |
| §20 | Structured failure reporting | Implemented (SchedulingFailureError with reasons) | `engine.ts:38-43,226-232`; `route.ts:116-121` (422) | ok |
| §21 | Recommended high-level algorithm | Matches, minus repair branch (§16-17 above) | `engine.ts` | warning |
| §22-23 | Configurable scoring; priority order | Implemented | `scorer.ts`; `engine.ts:92-104,234-236` | ok |
| §24-27 | Summary invariants | Implemented in engine; UI/API wiring still mocked | — | warning |

Summary: Phases 2–7 and validation are genuinely implemented. **Phase 1 (load context) is the single blocking gap**, and the **persist step does not exist** — `POST /api/schedule` returns JSON but never inserts `services`/`schedule_assignments` (live DB shows 0 rows in both tables).

---

## 4. Gate results (run 2026-09-24, repository root)

| Check | Result | Evidence |
|---|---|---|
| `npm run lint` | **0 errors, 4 warnings** | Warnings: `src/lib/scheduling/fairness.ts:1:26` (`MemberAssignmentCount` unused), `fairness.ts:75:5` (`totalMembers` unused), `src/lib/scheduling/rules/index.ts:166:21` (`config` unused), `rules/index.ts:166:29` (`context` unused) |
| `npm test` | **66 passed / 66** (10 files) | Vitest 4.1.11, started 14:04:29, duration 1.63s |
| `npm run build` | **Success** | Next.js 16.2.12 (Turbopack); compiled 5.2s; TypeScript 6.4s; 27 static pages generated; `api/schedule`, `api/schedule/mock-unavailability`, `api/validation` listed as dynamic ƒ routes |

Nothing was fixed; results are verbatim.

---

## 5. Live repro evidence (2026-09-24)

### 5.1 Login
- Attempt 1 with the user-provided `coord 2026`: **401 Unauthorized** — console `[ERROR] Failed to load resource: the server responded with a status of 401 (Unauthorized) @ http://localhost:3000/api/auth/name`; UI alert "Invalid username or password."
- Attempt 2 with the documented default `coord2026` (`src/lib/auth/staff-login.ts:19`): **success**, redirected to `/dashboard`.
- Constraint honored: credentials were never provisioned/reset; on 401 we recorded and retried the documented default.

### 5.2 Generate button
- Navigated to `/schedule` (authenticated coordzed). Page rendered the hardcoded Aug 2026 mock cards.
- Baseline network: entries `33.` `34.` `35.` = `GET /api/auth/me => 200` (no `/api/schedule` at all).
- Clicked "Generate Schedule": **no new network requests** (list unchanged), **no console messages**, page snapshot identical. Dev-server log shows no `POST /api/schedule` from the click.

### 5.3 Authenticated POST /api/schedule
- Request: `POST /api/schedule` with `Authorization: Bearer <browser session token>`, body `{"month":9,"year":2026,"week_numbers":[1,2,3,4]}`.
- Response: **HTTP 422**, body:
  ```json
  {"services":[],"validation":[],"failures":[{"service_id":"temp","week_number":1,"date":"2026-10-03","role_name":"Worship Leader","required_slots":1,"eligible_candidates":[],"rejected_candidates":[],"message":"No eligible candidate for Worship Leader in week 1."}]}
  ```
- Discriminator confirmed: both `eligible_candidates` and `rejected_candidates` are **empty arrays** — `all_members` was empty because `mockMembers` filtered by `'church-1'` never matches the authenticated church UUID.
- Dev-server log: `POST /api/schedule 422 in 1196ms`.

### 5.4 GET /api/schedule (evidence for H5)
- `GET /api/schedule?month=9&year=2026` (authenticated) → **200** `{services:[4 mocks],month:9,year:2026,church_id:"d0eebc99-…"}` with dates `2026-10-02T16:00:00.000Z` … `2026-10-23T16:00:00.000Z` = local Saturdays Oct 3/10/17/24.

---

## 6. Live database snapshot (read-only, 2026-09-24)

| Table | Count |
|---|---|
| `services` | **0** |
| `schedule_assignments` | **0** |
| `members` | **19** |
| `member_roles` | **28** |
| `member_skills` | **17** |
| `instruments` | **8** |
| `ministry_rules` | **9** |
| `availability` | **26** |
| `users` | **11** |
| `churches` | **1** |

- `coordzed` row: `id=e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a02`, `username=coordzed`, `email=coordzed@johiabankers.com`, `role=coordinator`, `is_active=true`, `church_id=d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11` (JOHIA Bankers), `auth_id=33c526eb-0440-4614-8e98-404c0c22c373` (real linked Auth identity).
- October mock data (re-verified read-only on 2026-09-24): exactly **19 availability rows** with reason `Mock unavailability (October 2026 test)`, `month=9, year=2026` — **all `approved`**, across **19 distinct members**, weeks 1/2/3/4 = **5/5/5/4**. `SELECT week_number, status, count(*) … GROUP BY week_number, status` returned `(1,approved,5), (2,approved,5), (3,approved,5), (4,approved,4)`; `SELECT status, count(*)` returned only `approved:19`. **No pending or rejected mock rows exist.** The earlier claim of "21 approved weekly rows (weeks 1/2/3/4 = 5/6/6/4)" was WRONG: 21 is the total of ALL `month=9, year=2026` availability rows = 19 mock approved + **2 pending** rows with `reason` NULL (weeks 2 and 3). True October-2026 per-week breakdown (approved vs pending): week 1 = 5 approved, 0 pending; week 2 = 5 approved + 1 pending; week 3 = 5 approved + 1 pending; week 4 = 4 approved, 0 pending. Total `availability` remains **26** (verified): 21 approved (19 mock + 2 reason-NULL), 3 pending, 2 rejected; the 5 non-October rows are 3 August-2026 and 2 weekly (month/year NULL).
- Live `ministry_rules` confirm H4: `assignment_limit {"max_monthly":3}`, `backup_count {"min_backup_singers":3}`, `leader_count {"count":1}`, `cooldown {"weeks":1}`.

---

## 7. Security note (incident — no values printed)

- `.env.local` contains a **non-empty `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`** (1 occurrence, value not printed here).
- A service-role key must never be exposed through a `NEXT_PUBLIC_*` variable: it would be bundled into client code if referenced by a client component/utility (per `AGENTS.md` and `src/lib/supabase/client.ts` contract, browser code may only use `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
- Required action: **rotate the service-role key** (Supabase project → API Keys → revoke/regenerate), remove the `NEXT_PUBLIC_` prefixed variable, and keep only the server-only `SUPABASE_SERVICE_ROLE_KEY`. Rotation requires a developer decision; nothing was changed in this pass.

---

## 8. Fix roadmap (described only — not implemented)

Smallest coherent, DB-backed + UI-wiring changes, in dependency order:

1. **Church-scoped DB loader producing `ScheduleContext`** (fixes H1/H2/H3/H6): a server-side loader scoped to `auth.churchId` that gathers `members` + `member_roles` + `member_skills` (+ `instruments`, `roles`) into the `Member[]` shape the engine expects, plus `services`/`schedule_assignments` for the requested month as `existing_assignments`, plus `ministry_rules` → `ScheduleContext.rules`. Wire it into `POST /api/schedule`, `GET /api/schedule`, and `POST /api/validation`; delete the `mockMembers` arrays. Keep `requireStaff(request).churchId` as the sole tenant boundary (never trust a client-supplied `church_id`).
2. **Rule-config key normalization** (fixes H4): at the loader seam, translate DB keys `max_monthly` → `default_max`, `min_backup_singers` → `min_required`, and supply `max_allowed` (church settings `default_max_backup_singers`), or add a single normalization helper used by engine/validator so fallback defaults are never silently relied upon.
3. **UI trigger** (fixes H1): give "Generate Schedule" an `onClick` that requests the target month/year and POSTs `/api/schedule`, renders returned services or 422 failures, and stops rendering the hardcoded `mockSchedules` for live data (or gates them behind an explicit "demo" flag).
4. **Real GET/POST semantics** (fixes H5/H7): `GET /api/schedule` returns Sunday-anchored services using `getFirstSunday`/`getWeekDate`; `POST` parses the body defensively (`request.text()` + guarded JSON parse or try/catch on `request.json()`), validates `month` 0–11 and `year` range (mirror the mock-unavailability route), dates persisted with explicit local-date handling to avoid UTC day-shift.
5. **Validation scope** (completes H6): `/api/validation` must load real church members before filtering; if the member pool is empty, return an explicit error instead of evaluating an empty assignment set (today: always-invalid `valid:false` from 2 synthetic criticals).
6. **Local repair (optional, later)** (H8): implement guide §16–17 — identify the conflicting assignment, propose replacement candidates that independently pass active/availability/monthly-limit/duplicate/qualification/skill checks, revalidate; only regenerate when no eligible replacement exists.

---

## 9. Remaining risks

- **Vacuous validation scope today** (H6): `/api/validation` never evaluates the real 19-member pool; its current live outcome for a real-church payload is an always-invalid `valid:false` (2 synthetic criticals against the empty assignment set), so it can neither certify nor meaningfully evaluate a real schedule. (Corrected 2026-09-24: the prior draft's "false certification / valid:true" risk was wrong — the endpoint does not return `valid:true` today.)
- **UTC day-shift in dates** (`toISOString().slice(0,10)` on local dates) can assign the wrong calendar day in positive-offset timezones — affects persisted `services.date`.
- **Fairness data is missing** — `existing_assignments`/`historical_assignments` are never loaded, so even after the pool fix, fairness/rotation inputs (Rule 8–10 preferences) would start cold.
- **Service-role key exposure** (Section 7) is an active incident until rotated.
- `npm run lint` warnings (4) are pre-existing and untouched.

---

## 10. Worktree audit

- Baseline before the pass (`git status --short --branch`): branch `feat/schedule-mock-unavailability`; pre-existing deleted `.agents/skills/*` entries; untracked `.agents/skills/{codebase-design,find-skills,grill-me,ui-ux-pro-max}/`, `.playwright-mcp/*`, `playwright-evidence/`.
- After the pass: **only** the new `docs/findings-scheduler-qa-2026-09-24.md` added (untracked); the same pre-existing deletions/untracked artifacts remain; no tracked file modified; no commits, merges, or branch switches.
- No database writes were performed (reads only); `POST /api/schedule/mock-unavailability` was **not** re-invoked (the October availability rows pre-existed: 19 approved mock + 2 pending = 21 October-2026 rows).