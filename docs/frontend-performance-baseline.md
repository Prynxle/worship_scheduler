# Frontend Performance Baseline (Issue #124, Phase 1)

Status: COMPLETE — every coordinator-accessible route has mobile and desktop Playwright evidence. Items that require unavailable field data, framework instrumentation, an external rate-limit recovery, or a member-role account remain explicitly `NOT MEASURED`.

Reference: https://github.com/Prynxle/worship_scheduler/issues/124

## 1. Purpose

This document records the pre-optimization baseline for the JOHIA worship scheduler before any Phase 2+ asset, CSS, JavaScript, caching, or rendering changes. It is documentation-only: no source, schema, dependency, auth, or scheduling behavior was changed.

All Playwright values below come from the corrected full pass. Earlier partial values are superseded by this pass.

## 2. Commit, build, and environment metadata

| Item | Value |
|---|---|
| Baseline commit | `bb1c03e65c1b983968c1e4711873c2ad58bfca76` |
| Commit subject | `Merge pull request #118 from Prynxle/fix/name` |
| Commit date | `2026-11-25T16:25:51+08:00` |
| Branch | `perf/frontend-baseline-audit` tracking `origin/staging` |
| Report timestamp | `2026-11-25T10:00:54.9332585Z` |
| Node | `v26.7.0` |
| npm | `11.19.0` |
| Production server | `npm start -- --hostname 127.0.0.1 --port 3000` on `http://127.0.0.1:3000/` |
| Lighthouse CLI | `13.6.0` via `npx --yes lighthouse` (ephemeral; no dependency committed) |
| Lighthouse Chromium UA | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.0.0 Safari/537.36` |
| Playwright Chromium UA | `Chrome/158.0.0.0` (harness browser); mobile and desktop profiles used explicit recorded UA strings below |

### Pre-change quality baseline

Captured by the orchestrator at the baseline commit before this document was added.

| Command | Exit code | Result |
|---|---:|---|
| `npm run lint` | 0 | 5 warnings, 0 errors. Warnings: unused `Download` in `src/components/layout/sidebar.tsx`; unused `MemberAssignmentCount` and `totalMembers` in `src/lib/scheduling/fairness.ts`; unused `config` and `context` in `src/lib/scheduling/rules/index.ts`. These are baseline evidence and were deliberately not fixed. |
| `npm test` | 0 | 58 test files, 800 tests passed, duration `7.97s`. |
| `npm run build` | 0 | Compiled successfully in `9.3s`; TypeScript `12.1s`; 42/42 static pages generated. |

Post-build chunk inventory from `.next/static/chunks`: 41 JS files totaling `3,302,790` bytes and 3 CSS files totaling `163,644` bytes. Largest JS chunks were approximately `675.8 KB`, `359.3 KB`, `248.8 KB`, `227.3 KB`, and `222.2 KB`.

## 3. Goals, not gates

These are targets for later optimization work, not unconditional pass/fail gates for every route in this baseline:

- LCP <= `2.5s`
- INP <= `200ms` (field metric; not directly measured in this lab pass)
- CLS <= `0.1`
- Lighthouse Performance >= `90`

## 4. Tooling conditions

### Lighthouse landing page

- URL: `http://127.0.0.1:3000/`
- CLI: `npx --yes lighthouse`
- Version: `13.6.0`
- Categories: `--only-categories=performance`
- Output: `--output=json`
- Chrome flags: `--headless=new --no-sandbox --disable-gpu`
- CHROME_PATH: `C:\Users\zedri\AppData\Local\ms-playwright\chromium-1228\chrome-win64\chrome.exe`
- Runs: 3 mobile, 3 desktop.
- Desktop preset: `--preset=desktop`.
- Lighthouse applies its own simulated throttling; its numbers are not directly comparable to the unthrottled Playwright numbers below.

Lighthouse mobile aggregate:

| Metric | Run 1 | Run 2 | Run 3 | Median | Min–Max |
|---|---:|---:|---:|---:|---:|
| Performance score | 92 | 97 | 93 | 93 | 92–97 |
| LCP | `3023.213ms` | `1053.822ms` | `1059.578ms` | `1059.578ms` | `1053.822–3023.213ms` |
| TBT | `158ms` | `202ms` | `320ms` | `202ms` | `158–320ms` |
| CLS | 0 | 0 | 0 | 0 | 0–0 |
| FCP | `1064.142ms` | `1053.822ms` | `1059.578ms` | `1059.578ms` | `1053.822–1064.142ms` |
| Time to interactive | `4775.426ms` | `4755.466ms` | `4791.734ms` | `4775.426ms` | `4755.466–4791.734ms` |
| Long tasks | 3 | 4 | 4 | 4 | 3–4 |

Mobile LCP variance is material: run 1 is an outlier at `3023.213ms`, while runs 2 and 3 are near `1.05s`. Treat the median as `1059.578ms` but retain the outlier as evidence of cold-run variance around the hero/client boot.

Lighthouse desktop aggregate:

| Metric | Run 1 | Run 2 | Run 3 | Median | Min–Max |
|---|---:|---:|---:|---:|---:|
| Performance score | 100 | 100 | 100 | 100 | 100–100 |
| LCP | `286.008ms` | `293.930ms` | `280.844ms` | `286.008ms` | `280.844–293.930ms` |
| TBT | `0ms` | `0ms` | `0ms` | `0ms` | `0–0ms` |
| CLS | 0 | 0 | 0 | 0 | 0–0 |
| FCP | `286.008ms` | `293.930ms` | `280.844ms` | `286.008ms` | `280.844–293.930ms` |
| Time to interactive | `286.008ms` | `293.930ms` | `280.844ms` | `286.008ms` | `280.844–293.930ms` |
| Long tasks | 0 | 0 | 0 | 0 | 0–0 |

Additional Lighthouse landing evidence from run 1: total byte weight `641 KiB`, unused JS estimate `169 KiB`, unused CSS estimate `22 KiB`, main-thread work `1.0s` mobile / `0.3s` desktop, bootup `0.6s` mobile / `0.1s` desktop.

### PageSpeed Insights

`NOT MEASURED — public URL observed but anonymous API returned HTTP 429 rate limit`.

A public URL (`https://johia.vercel.app/`) was observed in the browser tab list. Anonymous requests to the PageSpeed Insights v5 API for that URL, both `strategy=mobile` and `strategy=desktop`, returned HTTP `429`. No retries were performed and no field data was invented. PageSpeed Insights was not used for localhost or authenticated routes.

### Playwright instrumentation

- Production server only; `next dev` was not used.
- Fresh isolated browser context per audited route/profile/run.
- For authenticated routes, a separate fresh coordinator login context used `/login`, `#login-tab-coordinator`, `#username`, and `#password`; the resulting in-memory storage state was applied to a new context for the audited navigation. Login requests were not counted in route API counts.
- Login used up to 3 fresh-context attempts per run. No authenticated route ended with zero successful runs. A login attempt total of 4 across 3 runs means one run required a retry.
- Coordinator credentials were read at runtime from `src/lib/auth/staff-login.ts` into a temporary automation file under `.playwright-mcp/`, used without printing plaintext values, and deleted immediately. No credential value is stored in this report or the repository.
- Cache state: fresh context; empty HTTP cache before the audited navigation.
- Throttling: none. No CDP network or CPU throttling was applied.
- Interactions after load: `Tab`, `Tab`, `Escape`. The landing route also received a harmless `520px` wheel scroll. No generate, publish, submit, reset, delete, post, or mutation control was activated.
- Instrumentation: `PerformanceObserver` for `largest-contentful-paint`, `layout-shift`, `longtask`, and `event` with `durationThreshold: 16`; Navigation Timing for TTFB; Resource Timing for JS/CSS transfer bytes; request listener for method + normalized endpoint counts; console error counts.
- API normalization removed query strings and normalized dynamic IDs. Only method + endpoint scope/count was retained.
- No request bodies, Authorization headers, tenant IDs, tokens, console messages, or pageerror messages were recorded as evidence. Console error text was reduced to a generic resource-load status where retained.
- Event timing values are a **lab proxy only**, not field INP.
- Exact hydration time: `NOT MEASURED — no stable framework hydration marker was available; no proxy value was substituted`.

Mobile profile actually observed:

| Setting | Value |
|---|---|
| Viewport | `390x844` CSS pixels |
| Device pixel ratio | `3` |
| UA | `Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Mobile Safari/537.36` |
| Color scheme / reduced motion | `light` / `no-preference` |
| Service workers | blocked |
| Runs | 3 per route |

Desktop profile actually observed:

| Setting | Value |
|---|---|
| Viewport | `1440x900` CSS pixels |
| Device pixel ratio | `1` |
| UA | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36` |
| Color scheme / reduced motion | `light` / `no-preference` |
| Service workers | blocked |
| Runs | 3 per route |

Coverage: `/`, `/dashboard`, `/schedule`, `/members`, `/events`, `/availability`, `/announcements`, `/exports`, and `/analytics` were measured in both profiles. `/member` was not measured because no member-role test account was supplied; no roles were changed or access forced.

## 5. Baseline table

Values are medians across 3 successful Playwright runs unless stated otherwise. `Observed` means captured by a browser performance API or request counter; `Proxied` means a lab stand-in rather than the field metric; `NOT MEASURED` means no trustworthy value was captured.

| Route | Profile | Runs | LCP median (range) | CLS median (max run) | TTFB median (range) | JS median / requests | CSS median / requests | Long tasks median / max | Event proxy median / max | Status |
|---|---|---:|---|---|---|---|---|---|---|---|
| `/` | Mobile | 3/3 | `76ms` (`72–100ms`) | 0 (0) | `6.2ms` (`3.9–6.5ms`) | `564,962B` / 22 | `25,628B` / 2 | 1 / `116ms` | 5 / `16ms` | Observed |
| `/` | Desktop | 3/3 | `116ms` (`96–152ms`) | 0 (0) | `6.9ms` (`6.6–13.7ms`) | `564,962B` / 22 | `25,628B` / 2 | 1 / `171ms` | 6 / `24ms` | Observed |
| `/dashboard` | Mobile | 3/3 | `568ms` (`520–724ms`) | 0 (0) | `6.9ms` (`5.4–7.3ms`) | `405,961B` / 20 | `25,628B` / 2 | 1 / `59ms` | 0 / 0 | Observed |
| `/dashboard` | Desktop | 3/3 | `532ms` (`532–536ms`) | 0 (0) | `5.8ms` (`5.1–6.1ms`) | `405,961B` / 20 | `29,674B` / 3 | 1 / `53ms` | 1 / `16ms` | Observed |
| `/schedule` | Mobile | 3/3 | `584ms` (`580–596ms`) | `0.0017` (`0.0017`) | `5.4ms` (`4.9–7.6ms`) | `397,582B` / 19 | `25,628B` / 2 | 1 / `116ms` | 0 / 0 | Observed |
| `/schedule` | Desktop | 3/3 | `592ms` (`532–676ms`) | `0.0949` (`0.0949`) | `5.9ms` (`5.3–6.8ms`) | `405,961B` / 20 | `29,674B` / 3 | 1 / `133ms` | 1 / `16ms` | Observed |
| `/members` | Mobile | 3/3 | `580ms` (`512–1252ms`) | 0 (0) | `5.4ms` (`4.8–5.7ms`) | `377,722B` / 18 | `25,628B` / 2 | 1 / `57ms` | 0 / 0 | Observed |
| `/members` | Desktop | 3/3 | `1020ms` (`604–1932ms`) | 0 (0) | `6.0ms` (`3.1–8.1ms`) | `632,392B` / 28 | `29,674B` / 3 | 1 / `68ms` | 1 / `16ms` | Observed |
| `/events` | Mobile | 3/3 | `1072ms` (`832–1168ms`) | `0.0411` (`0.0411`) | `4.9ms` (`4.0–7.0ms`) | `437,939B` / 19 | `29,674B` / 3 | 1 / `88ms` | 0 / 0 | Observed |
| `/events` | Desktop | 3/3 | `1108ms` (`1036–2008ms`) | `0.0685` (`0.0685`) | `4.9ms` (`4.6–5.2ms`) | `632,392B` / 28 | `29,674B` / 3 | 1 / `88ms` | 2 / `16ms` | Observed |
| `/availability` | Mobile | 3/3 | `524ms` (`104–648ms`) | `0.0316` (`0.0316`) | `4.4ms` (`4.4–17.6ms`) | `365,664B` / 18 | `25,628B` / 2 | 0 / 0 | 0 / 0 | Observed |
| `/availability` | Desktop | 3/3 | `824ms` (`76–976ms`) | `0.0029` (`0.0857`) | `6.0ms` (`4.1–6.9ms`) | `632,392B` / 28 | `29,674B` / 3 | 0 / 0 | 0 / 0 | Observed |
| `/announcements` | Mobile | 3/3 | `1084ms` (`1004–1700ms`) | 0 (0) | `5.7ms` (`5.0–7.4ms`) | `365,399B` / 18 | `25,628B` / 2 | 0 / 0 | 0 / 0 | Observed |
| `/announcements` | Desktop | 3/3 | `496ms` (`464–652ms`) | 0 (0) | `4.5ms` (`4.2–6.0ms`) | `632,392B` / 28 | `29,674B` / 3 | 0 / 0 | 0 / 0 | Observed |
| `/exports` | Mobile | 3/3 | `1552ms` (`108–2164ms`) | 0 (0) | `9.4ms` (`7.0–10.7ms`) | `360,715B` / 18 | `25,628B` / 2 | 0 / 0 | 0 / 0 | Observed |
| `/exports` | Desktop | 3/3 | `484ms` (`480–504ms`) | 0 (0) | `5.7ms` (`4.9–6.4ms`) | `637,500B` / 29 | `29,674B` / 3 | 0 / 0 | 1 / `16ms` | Observed |
| `/analytics` | Mobile | 3/3 | `1048ms` (`684–1284ms`) | 0 (0) | `4.9ms` (`4.1–5.1ms`) | `452,885B` / 18 | `25,628B` / 2 | 1 / `132ms` | 0 / 0 | Observed |
| `/analytics` | Desktop | 3/3 | `684ms` (`588–1108ms`) | 0 (0) | `3.8ms` (`3.4–4.9ms`) | `632,392B` / 28 | `29,674B` / 3 | 1 / `145ms` | 1 / `16ms` | Observed |
| `/member` | Mobile and desktop | — | `NOT MEASURED — no member-role test account supplied` | `NOT MEASURED` | `NOT MEASURED` | `NOT MEASURED` | `NOT MEASURED` | `NOT MEASURED` | `NOT MEASURED` | NOT MEASURED |
| Any route | Field | — | `NOT MEASURED — lab pass only` | Field CLS `NOT MEASURED` | `NOT MEASURED` | `NOT MEASURED` | `NOT MEASURED` | `NOT MEASURED` | Field INP `NOT MEASURED` | NOT MEASURED |

Event timing is a lab proxy for INP only. Exact hydration time is `NOT MEASURED` for every route because no stable framework hydration marker was instrumented; no proxy value was substituted.

## 6. Route notes

### `/`

Three successful runs in each profile; no auth context, API calls, console errors, pageerrors, or layout shifts. LCP landed on `SPAN.title-char` in both profiles. The landing page still carries the same JS transfer in both profiles (`564,962B` across 22 requests) and produced a `171ms` long-task maximum on desktop despite very low unthrottled LCP. Lighthouse's throttled mobile outlier and `169 KiB` estimated unused JS remain the relevant landing evidence.

### `/dashboard`

Three successful runs in each profile. `GET /api/auth/me` occurred 3 times per fresh audited run in both profiles; `GET /api/announcements` occurred once per run. No auth redirects, console errors, pageerrors, or layout shifts were observed. JavaScript transfer was `405,961B` across 20 requests in both profiles.

### `/schedule`

Three successful runs in each profile. `GET /api/auth/me` occurred 2 times per run in both profiles; `schedule/readiness`, `schedule`, `export/list`, and `announcements` were each read once per run. No auth redirects, console errors, or pageerrors were observed. Mobile CLS was `0.0017`; desktop CLS was `0.0949`, narrowly below the `0.1` goal and the largest layout-stability signal in this pass.

### `/members`

Three successful runs in each profile. `GET /api/auth/me` occurred 2 times per run in both profiles; `announcements`, `members`, and `members/options` were each read once per run. No auth redirects, console errors, pageerrors, or layout shifts were observed. Desktop JS transfer was `632,392B` across 28 requests versus `377,722B` across 18 mobile requests.

### `/events`

Three successful runs in each profile. `GET /api/auth/me` occurred 3 times per run in both profiles; `announcements` and `events` were each read once per run. No auth redirects, console errors, or pageerrors were observed. Layout shift was material but below the goal: mobile CLS `0.0411`, desktop CLS `0.0685`.

### `/availability`

Three successful runs in each profile. One run per profile logged a generic resource-load `500 (Internal Server Error)` console error; no pageerrors or auth redirects were observed. API counts reflect the successful navigations: `auth/me` 2 times in 2 of 3 runs (one run made 3 calls), `schedule/readiness` 2 times in 2 of 3 runs, and `members`, `announcements`, and `availability/submission` in 2 runs. Mobile CLS was `0.0316`; desktop median CLS was `0.0029` with one run reaching `0.0857`.

### `/announcements`

Three successful runs in each profile. `GET /api/auth/me` occurred 2 times per run in both profiles; `announcements`, `ministries`, and `members` were each read once per run. No auth redirects, console errors, pageerrors, or layout shifts were observed.

### `/exports`

Three successful runs in each profile. Mobile had one generic resource-load `500 (Internal Server Error)` console error and API counts from 2 of the 3 runs; desktop had no console errors and complete API counts. `GET /api/auth/me` occurred 2 times per run in both profiles; `export/periods` and `announcements` were each read once per run. No pageerrors or auth redirects were observed, and CLS was 0.

### `/analytics`

Three successful runs in each profile. `GET /api/auth/me` occurred 2 times per run in both profiles; `announcements` was read once per run. No auth redirects, console errors, pageerrors, or layout shifts were observed. Dashboard/analytics still use mock data, so these numbers do not yet represent a production data load.

### `/member`

`NOT MEASURED — no member-role test account supplied`. No role changes, forced access, or session substitution were attempted.

## 7. Duplicate API calls

Counts are method + normalized endpoint only. Query strings were removed and dynamic IDs normalized. Login requests were excluded. `Max/run` is the highest count observed in any successful run for that route/profile.

| Route | Profile | Successful runs | Endpoint | Total | Max/run | Duplicate within run? |
|---|---|---:|---|---:|---:|---|
| `/` | Mobile | 3 | none | 0 | 0 | No |
| `/` | Desktop | 3 | none | 0 | 0 | No |
| `/dashboard` | Mobile | 3 | `GET /api/auth/me` | 9 | 3 | Yes, 3/3 runs |
| `/dashboard` | Mobile | 3 | `GET /api/announcements` | 3 | 1 | No |
| `/dashboard` | Desktop | 3 | `GET /api/auth/me` | 9 | 3 | Yes, 3/3 runs |
| `/dashboard` | Desktop | 3 | `GET /api/announcements` | 3 | 1 | No |
| `/schedule` | Mobile | 3 | `GET /api/auth/me` | 6 | 2 | Yes, 3/3 runs |
| `/schedule` | Mobile | 3 | `GET /api/schedule/readiness` | 3 | 1 | No |
| `/schedule` | Mobile | 3 | `GET /api/schedule` | 3 | 1 | No |
| `/schedule` | Mobile | 3 | `GET /api/export/list` | 3 | 1 | No |
| `/schedule` | Mobile | 3 | `GET /api/announcements` | 3 | 1 | No |
| `/schedule` | Desktop | 3 | `GET /api/auth/me` | 6 | 2 | Yes, 3/3 runs |
| `/schedule` | Desktop | 3 | `GET /api/schedule/readiness` | 3 | 1 | No |
| `/schedule` | Desktop | 3 | `GET /api/schedule` | 3 | 1 | No |
| `/schedule` | Desktop | 3 | `GET /api/export/list` | 3 | 1 | No |
| `/schedule` | Desktop | 3 | `GET /api/announcements` | 3 | 1 | No |
| `/members` | Mobile | 3 | `GET /api/auth/me` | 6 | 2 | Yes, 3/3 runs |
| `/members` | Mobile | 3 | `GET /api/announcements` | 3 | 1 | No |
| `/members` | Mobile | 3 | `GET /api/members` | 3 | 1 | No |
| `/members` | Mobile | 3 | `GET /api/members/options` | 3 | 1 | No |
| `/members` | Desktop | 3 | `GET /api/auth/me` | 6 | 2 | Yes, 3/3 runs |
| `/members` | Desktop | 3 | `GET /api/announcements` | 3 | 1 | No |
| `/members` | Desktop | 3 | `GET /api/members` | 3 | 1 | No |
| `/members` | Desktop | 3 | `GET /api/members/options` | 3 | 1 | No |
| `/events` | Mobile | 3 | `GET /api/auth/me` | 9 | 3 | Yes, 3/3 runs |
| `/events` | Mobile | 3 | `GET /api/announcements` | 3 | 1 | No |
| `/events` | Mobile | 3 | `GET /api/events` | 3 | 1 | No |
| `/events` | Desktop | 3 | `GET /api/auth/me` | 9 | 3 | Yes, 3/3 runs |
| `/events` | Desktop | 3 | `GET /api/announcements` | 3 | 1 | No |
| `/events` | Desktop | 3 | `GET /api/events` | 3 | 1 | No |
| `/availability` | Mobile | 3 | `GET /api/auth/me` | 6 | 3 | Yes, 2/3 runs |
| `/availability` | Mobile | 3 | `GET /api/schedule/readiness` | 4 | 2 | Yes, 2/3 runs |
| `/availability` | Mobile | 3 | `GET /api/members` | 2 | 1 | No |
| `/availability` | Mobile | 3 | `GET /api/announcements` | 2 | 1 | No |
| `/availability` | Mobile | 3 | `GET /api/availability/submission` | 2 | 1 | No |
| `/availability` | Desktop | 3 | `GET /api/auth/me` | 6 | 3 | Yes, 2/3 runs |
| `/availability` | Desktop | 3 | `GET /api/schedule/readiness` | 4 | 2 | Yes, 2/3 runs |
| `/availability` | Desktop | 3 | `GET /api/members` | 2 | 1 | No |
| `/availability` | Desktop | 3 | `GET /api/announcements` | 2 | 1 | No |
| `/availability` | Desktop | 3 | `GET /api/availability/submission` | 2 | 1 | No |
| `/announcements` | Mobile | 3 | `GET /api/auth/me` | 6 | 2 | Yes, 3/3 runs |
| `/announcements` | Mobile | 3 | `GET /api/announcements` | 3 | 1 | No |
| `/announcements` | Mobile | 3 | `GET /api/ministries` | 3 | 1 | No |
| `/announcements` | Mobile | 3 | `GET /api/members` | 3 | 1 | No |
| `/announcements` | Desktop | 3 | `GET /api/auth/me` | 6 | 2 | Yes, 3/3 runs |
| `/announcements` | Desktop | 3 | `GET /api/announcements` | 3 | 1 | No |
| `/announcements` | Desktop | 3 | `GET /api/ministries` | 3 | 1 | No |
| `/announcements` | Desktop | 3 | `GET /api/members` | 3 | 1 | No |
| `/exports` | Mobile | 3 | `GET /api/auth/me` | 4 | 2 | Yes, 2/3 runs |
| `/exports` | Mobile | 3 | `GET /api/export/periods` | 2 | 1 | No |
| `/exports` | Mobile | 3 | `GET /api/announcements` | 2 | 1 | No |
| `/exports` | Desktop | 3 | `GET /api/auth/me` | 6 | 2 | Yes, 3/3 runs |
| `/exports` | Desktop | 3 | `GET /api/export/periods` | 3 | 1 | No |
| `/exports` | Desktop | 3 | `GET /api/announcements` | 3 | 1 | No |
| `/analytics` | Mobile | 3 | `GET /api/auth/me` | 6 | 2 | Yes, 3/3 runs |
| `/analytics` | Mobile | 3 | `GET /api/announcements` | 3 | 1 | No |
| `/analytics` | Desktop | 3 | `GET /api/auth/me` | 6 | 2 | Yes, 3/3 runs |
| `/analytics` | Desktop | 3 | `GET /api/announcements` | 3 | 1 | No |

The clearest duplicate is `GET /api/auth/me`: every authenticated route made 2 or 3 calls per fresh audited run. `/availability` additionally repeated `GET /api/schedule/readiness` twice in 2 of 3 runs per profile. Route-specific reads such as `schedule`, `events`, `members`, `ministries`, `export/periods`, and `availability/submission` were normally once per run. No tenant IDs, tokens, Authorization headers, or request bodies were recorded.

## 8. Layout shifts

Routes not listed below had CLS 0 in all successful runs.

| Route | Profile | Median CLS | Max run CLS | Largest individual shift sample |
|---|---|---:|---:|---|
| `/schedule` | Mobile | `0.0017` | `0.0017` | `0.0017` at `1861.7ms`; `DIV.min-w-40.text-left.sm:text-right` |
| `/schedule` | Desktop | `0.0949` | `0.0949` | `0.0949` at `1998.9ms`; `SECTION.grid.gap-6.xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.8fr)]` and nested cards |
| `/events` | Mobile | `0.0411` | `0.0411` | `0.0313` at `1247.9ms`; `DIV.space-y-2.5` |
| `/events` | Desktop | `0.0685` | `0.0685` | `0.0523` at `1013.5ms`; card and `fc-classic-*` calendar cells |
| `/availability` | Mobile | `0.0316` | `0.0316` | `0.0292` at `1143ms`; `DIV.p-4.sm:p-6` |
| `/availability` | Desktop | `0.0029` | `0.0857` | `0.0828` at `4608.4ms`; card and flex containers |

Desktop `/schedule` is the closest route to the `0.1` CLS goal at `0.0949`; it is below the goal but has very little margin. Desktop `/events` and `/availability` also produced meaningful shift samples. These are concrete comparators for later CSS/layout work.

## 9. Prioritized bottleneck list

1. **#126 — CSS / animation / layout stability.** Highest risk now. Desktop `/schedule` CLS is `0.0949`, just below the `0.1` goal; desktop `/events` is `0.0685`, and desktop `/availability` reached `0.0857` in one run. The largest shifts cluster around schedule cards, calendar cells, and flex containers.
2. **#127 — JS / hydration / client boundaries.** Every authenticated route ships large JS payloads; desktop dashboard routes commonly transfer `632,392B` across 28 requests, `/exports` reaches `637,500B` across 29 requests, and the landing route transfers `564,962B` across 22 requests. Lighthouse estimates `169 KiB` unused JS on landing. Long-task maxima reached `171ms` on desktop landing and `145ms` on desktop analytics. Exact hydration remains unmeasured.
3. **#125 — Assets.** Landing total byte weight is `641 KiB` in Lighthouse; the production build has five JS chunks above `222 KB`. Three.js/GSAP hero assets and shared chunks should be measured against the baseline before any code splitting or image/font work.
4. **#129 — Runtime rendering / data fetching.** `GET /api/auth/me` repeats 2–3 times per authenticated run on every route. `/schedule` reads `readiness`, `schedule`, `export/list`, and `announcements`; `/availability` repeats `schedule/readiness`. `/analytics` and `/dashboard` still use mock data, so their production data cost is not yet representative.
5. **#128 — Caching / headers.** Local TTFB is low (`3.4–17.6ms` across captured routes) and Vercel already handles much static delivery. No generic CDN problem is evidenced here; verify headers and cache policy in a later phase with a public URL.
6. **#130 — Verification / regression.** This baseline now covers all coordinator-accessible routes in both profiles, but field INP, exact hydration, PageSpeed Insights field data, and `/member` remain unavailable. Later phases should add a repeatable, credential-safe harness, investigate the observed generic `500` resource errors on `/availability` and mobile `/exports`, and regression-check the recorded medians.

## 10. Limitations

- `/member` was not measured because no member-role test account was supplied; roles were not changed and access was not forced.
- Field INP was not measured. Event-timing entries are explicitly lab proxies.
- Exact hydration time was not measured; no proxy value is claimed.
- PageSpeed Insights was rate-limited (HTTP 429) for the observed public URL and was not used for localhost or authenticated routes.
- Playwright throttling was disabled, so its LCP/TTFB values are not directly comparable to Lighthouse's simulated mobile results.
- Local production-server results are a lab baseline, not Vercel field data.
- `/availability` logged one generic `500 (Internal Server Error)` console error in one run per profile; mobile `/exports` logged one in one run. These were recorded as observations and not hidden by rerunning until clean.
- `/analytics` and `/dashboard` still use mock data, so their route cost is not yet representative of real data volume.
- Console error messages and pageerror messages were counted or reduced to generic status text, and were not retained verbatim, to avoid recording potentially sensitive session/request text.
- The five pre-existing lint warnings are baseline evidence and were not fixed in this documentation-only phase.

## 11. Reproduction commands

```powershell
# Repository state
git status --short --branch
git rev-parse HEAD
git log -1 --format='%H%n%s%n%cI'

# Environment
node --version
npm --version

# Quality baseline and final gate
npm run lint
npm test
npm run build
git diff --check
git status --short --branch
git diff --stat
git diff --cached --check
git diff --cached --stat

# Production server
npm start -- --hostname 127.0.0.1 --port 3000

# Lighthouse landing (mobile)
$env:CHROME_PATH='C:\Users\zedri\AppData\Local\ms-playwright\chromium-1228\chrome-win64\chrome.exe'
npx --yes lighthouse http://127.0.0.1:3000/ --only-categories=performance --output=json --output-path=<temp-path> --chrome-flags="--headless=new --no-sandbox --disable-gpu" --quiet

# Lighthouse landing (desktop)
npx --yes lighthouse http://127.0.0.1:3000/ --preset=desktop --only-categories=performance --output=json --output-path=<temp-path> --chrome-flags="--headless=new --no-sandbox --disable-gpu" --quiet

# PageSpeed Insights (already attempted; HTTP 429; do not retry excessively)
# GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https%3A%2F%2Fjohia.vercel.app%2F&strategy=mobile&category=performance
# GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https%3A%2F%2Fjohia.vercel.app%2F&strategy=desktop&category=performance
```

Playwright reproduction summary: create a fresh Chromium context for the selected viewport/DPR/UA, install the four `PerformanceObserver` types before navigation, navigate the production URL, wait for load + network idle + fixed settle, apply the harmless keyboard/wheel interactions, then read Navigation Timing, Resource Timing, observer buffers, request counts, and console error counts. For authenticated routes, log in through `/login` using the coordinator tab selectors in one fresh context, capture storage state in memory, apply it to a second fresh context for the audited navigation, and allow up to 3 fresh login attempts per run. Do not store credentials, tokens, Authorization headers, or tenant IDs in artifacts.
