# Frontend JS Bundle / Hydration / Client Boundary Baseline (Issue #127, Phase 4/7)

Status: BASELINE AND POST-CHANGE MEASUREMENT COMPLETE — no source file was edited before the baseline was captured; the approved lazy-boundary implementation and verification gate are recorded in sections 7–13.

Reference: issue #127, approved Phase 4/7 plan and decision conditions supplied to the builder.

## 1. Repository state

| Item | Value |
|---|---|
| Branch | `feature/issue-127-js-bundle-client-boundaries` |
| Upstream | `origin/staging` |
| HEAD | `a6cf03befc16a43ed4adab38aaa732191ef70e9f` |
| Commit subject | `Merge pull request #135 from Prynxle/perf/issue-128-browser-caching-asset-delivery` |
| Commit date | `2026-11-27T17:09:08+08:00` |
| Worktree before baseline | Clean (`git status --short --branch` showed only the branch line; `git diff --stat` was empty) |
| Node | `v26.7.0` |
| npm | `11.19.0` |
| Next.js | `16.2.12` (Turbopack) |
| React | `19.2.4` |

The approved plan was treated as `READY`. No planner/decision artifact file was present in this worktree; the approved conditions were supplied directly in the builder task.

## 2. Commands used for the pre-change baseline

```powershell
git status --short --branch
git diff --stat
git rev-parse HEAD
git log -1 --format='%H%n%cI%n%s'
node --version
npm --version
npm run build
npx --no-install next experimental-analyze --output
```

`npm run build` exited `0`, compiled successfully in `6.1s`, completed TypeScript in `8.4s`, and generated `42/42` static pages in `527ms`. It emitted a warning that the custom `Cache-Control` header for `/_next/static/:path*` can break Next.js development behavior; the warning is pre-existing and not caused by this phase.

This Next.js/Turbopack build did **not** print the classic `First Load JS` summary table. Therefore the table below was derived deterministically from the prerendered HTML emitted by the same build:

1. Read each `.next/server/app/**/*.html` page document.
2. Extract every unique `<script src="*.js">` URL from that document.
3. Map `/_next/static/...` to `.next/static/...`.
4. Sum the on-disk, uncompressed byte sizes of those unique files.
5. Treat that sum as the build-time eager/first-load JS payload. Lazy chunks loaded only after hydration are excluded.

The analyzer command exited `0` and wrote `.next/diagnostics/analyze`; it was used only to confirm that the chunk inventory was produced by a standard build analysis pass.

## 3. Build First Load JS table (pre-change)

Uncompressed bytes. `Scripts` is the number of unique eager JS script URLs in the prerendered HTML. These are not network-transfer bytes; compressed transfer depends on server/br gzip/brotli behavior.

| Route | First Load JS (bytes) | First Load JS (KiB) | Scripts |
|---|---:|---:|---:|
| `/` | 1,325,377 | 1,294.3 | 11 |
| `/analytics` | 1,637,338 | 1,599.0 | 19 |
| `/announcements` | 1,321,609 | 1,290.6 | 19 |
| `/availability` | 1,326,740 | 1,295.6 | 19 |
| `/dashboard` | 1,266,515 | 1,236.8 | 18 |
| `/events` | 1,571,964 | 1,535.1 | 20 |
| `/exports` | 1,306,978 | 1,276.3 | 19 |
| `/line-up-songs` | 1,270,722 | 1,240.9 | 18 |
| `/login` | 938,539 | 916.5 | 13 |
| `/member` | 1,596,212 | 1,558.8 | 20 |
| `/members` | 1,363,496 | 1,331.5 | 19 |
| `/ministries` | 1,252,490 | 1,223.1 | 18 |
| `/register` | 696,226 | 679.9 | 12 |
| `/reset-password` | 696,226 | 679.9 | 12 |
| `/schedule` | 1,432,350 | 1,398.8 | 20 |
| `/settings` | 1,266,376 | 1,236.7 | 18 |

The `_not-found` and `_global-error` documents were excluded from this route table. Dynamic API routes have no client first-load HTML document and are not listed.

## 4. Build chunk inventory (pre-change)

| Metric | Value |
|---|---:|
| JavaScript files under `.next/static/chunks` (recursive) | 41 |
| Total uncompressed JavaScript bytes | 3,302,790 |
| Total uncompressed JavaScript MiB | 3.15 |

Largest chunks:

| Chunk | Bytes | KiB |
|---|---:|---:|
| `163d859_b-1ck.js` | 692,023 | 675.8 |
| `3idaawgcazs99.js` | 367,937 | 359.3 |
| `2h5v3bc-v564g.js` | 254,801 | 248.8 |
| `2gqgxeaiye3d0.js` | 232,781 | 227.3 |
| `0miv_87g32ga0.js` | 227,538 | 222.2 |
| `1llgxig7w-09j.js` | 138,144 | 134.9 |
| `2sb97ve6h4qem.js` | 120,734 | 117.9 |
| `0cz1d0mv5g_q7.js` | 112,594 | 110.0 |
| `2lq_gjjwv-pq-.js` | 86,566 | 84.5 |
| `1b1-g0vynzb53.js` | 84,461 | 82.5 |

## 5. Heavy-module map (pre-change)

Chunk attribution was confirmed by matching distinctive library symbols inside the generated chunks and by tracing static imports in `src/`.

| Concern | Source import(s) | Build chunk(s) observed | Routes loading it eagerly | Notes |
|---|---|---|---|---|
| Three.js + GSAP hero | `src/components/ui/horizon-hero-section.tsx`: `import * as THREE from 'three'`, `import { gsap } from 'gsap'` | `163d859_b-1ck.js` (692,023 B; symbols `WebGLRenderer`, `gsap`) | `/` | Imported directly by `src/app/page.tsx`; the largest single chunk and the main landing-page target. |
| Recharts | `src/components/analytics/workload-chart.tsx`: static `BarChart`, `Bar`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `ResponsiveContainer` import from `recharts` | `3idaawgcazs99.js` (367,937 B; symbol `recharts`) | `/analytics` | Loaded twice on the analytics page but from one module; mock-data chart behavior is preserved by the approved plan. |
| FullCalendar | `src/components/events/event-calendar.tsx`: static imports from `@fullcalendar/react`, `.../daygrid`, `.../interaction`, `.../themes/classic` | `2h5v3bc-v564g.js` (254,801 B; symbol `FullCalendar`) plus related plugin/theme chunks | `/events`, `/member` | Eagerly loaded at both calendar boundaries; keyboard/ARIA/fetch/realtime behavior must remain intact. |
| `motion/react` | `src/components/layout/sidebar.tsx`: `motion`, `MotionConfig`; `src/components/ui/tilt-card.tsx`: `motion`/layout helpers | `2sb97ve6h4qem.js` (120,734 B; motion runtime), `2h9cfpygxj6b7.js` (23,796 B; `MotionConfig` wrapper), and per-route motion helper chunks including `16ehox-d3k_qo.js`, `2iv_kbt8_6gyw.js`, `32eclimkfaor8.js` | All dashboard routes; `/login` also includes the shared runtime chunk | Removing sidebar motion alone will not remove the runtime while `TiltCard` still uses `motion/react`; that is expected and in scope only where the plan proves a boundary safe. |
| jsPDF | `src/lib/export/pdf.ts`: `import jsPDF from 'jspdf'` | Not identified in client eager chunks | None | PDF generation remains server-side. |
| html2canvas | No source import found | None | None | Dependency is unused; keep the dependency as required by the approved decision. |

## 6. Client-boundary inventory relevant to the plan

Retained client boundaries from the approved conditions:

- `SessionGuard`
- `DashboardLayout`
- `Sidebar`
- `Header`
- `NotificationBell`

All Supabase browser calls remain in effects or event handlers. No privileged import was found in a client component during baseline inspection. No source behavior was changed to produce this baseline.

## 7. Post-change implementation summary

The approved lazy boundaries were implemented without changing scheduling, auth, API, tenant, or dependency behavior:

- `/` is now a Server Component. Its hero copy, links and CSS fallback are in the prerendered HTML; `HeroSceneBoundary` fetches `horizon-hero-scene.tsx` (Three.js + GSAP) only after mount and only when the user has not requested reduced motion.
- `EventCalendar` defers `@fullcalendar/react` to `event-calendar-grid.tsx` behind an accessible, fixed-height skeleton. Auth headers, request sequencing, realtime cleanup, day-cell keyboard handlers and event dialog guards remain in the owner component or the lazy grid.
- The analytics page remains a Client Component because it fetches tenant-scoped data from `/api/analytics`; after merging main's analytics work, `WorkloadChart` still defers Recharts to `workload-chart-canvas.tsx` behind a fixed-height skeleton, and the empty/error/loading states and month selector remain intact.
- `Sidebar` no longer imports `motion/react`; equivalent entrance animations are CSS keyframes under `prefers-reduced-motion: no-preference`.
- PDF remains server-side. `jspdf` and unused `html2canvas` dependencies were retained.

## 8. Post-change measurement method

The same deterministic HTML-script method used for the baseline was applied to the rebuilt `.next` output:

```powershell
npm run lint
npm test
npm run build
# Extract unique <script src="*.js"> URLs from each prerendered route HTML document,
# map /_next/static/... to .next/static/..., and sum on-disk bytes.
git diff --check
git status --short --branch
```

The final `npm run build` exited `0`, compiled successfully in `6.0s`, completed TypeScript in `9.4s`, and generated `43/43` static pages in `543ms`. The pre-existing custom `Cache-Control` warning for `/_next/static/:path*` was still emitted; no new build warning or error was introduced.

## 9. First Load JS table (post-change)

Uncompressed bytes; derived exactly as in section 2.

| Route | First Load JS (bytes) | First Load JS (KiB) | Scripts |
|---|---:|---:|---:|
| `/` | 636,885 | 622.0 | 10 |
| `/analytics` | 1,217,929 | 1,189.4 | 20 |
| `/announcements` | 1,201,173 | 1,173.0 | 19 |
| `/availability` | 1,206,304 | 1,178.0 | 19 |
| `/dashboard` | 1,265,492 | 1,235.8 | 19 |
| `/events` | 1,211,772 | 1,183.4 | 20 |
| `/exports` | 1,186,542 | 1,158.7 | 19 |
| `/line-up-songs` | 1,150,286 | 1,123.3 | 18 |
| `/login` | 939,360 | 917.3 | 13 |
| `/member` | 1,235,906 | 1,206.9 | 19 |
| `/members` | 1,362,578 | 1,330.6 | 20 |
| `/ministries` | 1,132,054 | 1,105.5 | 18 |
| `/register` | 697,024 | 680.7 | 12 |
| `/reset-password` | 697,024 | 680.7 | 12 |
| `/schedule` | 1,431,432 | 1,397.9 | 21 |
| `/settings` | 1,145,940 | 1,119.1 | 18 |

## 10. Build chunk inventory (post-change)

| Metric | Pre-change | Post-change | Delta |
|---|---:|---:|---:|
| JavaScript files under `.next/static/chunks` (recursive) | 41 | 45 | +4 |
| Total uncompressed JavaScript bytes | 3,302,790 | 3,415,488 | +112,698 |

The total generated JS increased because heavy modules were split into separate lazy chunks and small wrapper/skeleton modules were added. First Load JS decreased because those heavy chunks are no longer in the prerendered script sets for their routes.

Largest post-change chunks:

| Chunk | Bytes | KiB | Dominant symbol |
|---|---:|---:|---|
| `2oipgouqav-3s.js` | 690,807 | 674.6 | `WebGLRenderer`, `gsap` (lazy hero) |
| `212rwql2_6iwo.js` | 356,321 | 348.0 | `recharts` (lazy chart) |
| `0ok2j6j39_4jq.js` | 244,303 | 238.6 | `FullCalendar` (lazy calendar) |
| `2gqgxeaiye3d0.js` | 232,781 | 227.3 | shared shell/runtime |
| `0miv_87g32ga0.js` | 227,538 | 222.2 | shared runtime |
| `0rk4uo-kjsg1v.js` | 137,584 | 134.4 | shared shell/runtime |
| `33qobxi0en6g5.js` | 127,561 | 124.6 | `MotionConfig` (remaining `TiltCard` use) |
| `3yti1mx_lklgd.js` | 127,561 | 124.6 | `MotionConfig` (remaining `TiltCard` use) |
| `0cz1d0mv5g_q7.js` | 112,594 | 110.0 | polyfill |
| `2lq_gjjwv-pq-.js` | 86,566 | 84.5 | shared scheduling UI |

Confirmation from the post-change HTML script sets: the hero chunk is absent from `/`; the Recharts chunk is absent from `/analytics`; the FullCalendar chunk is absent from `/events` and `/member`. The two `MotionConfig` chunks remain on routes that render `TiltCard`, which is outside the approved sidebar-only change.

## 11. First Load JS delta

Uncompressed bytes. Negative values are reductions.

| Route | Pre-change | Post-change | Delta | Change |
|---|---:|---:|---:|---:|
| `/` | 1,325,377 | 636,885 | -688,492 | -51.9% |
| `/analytics` | 1,637,338 | 1,217,929 | -419,409 | -25.6% |
| `/announcements` | 1,321,609 | 1,201,173 | -120,436 | -9.1% |
| `/availability` | 1,326,740 | 1,206,304 | -120,436 | -9.1% |
| `/dashboard` | 1,266,515 | 1,265,492 | -1,023 | -0.1% |
| `/events` | 1,571,964 | 1,211,772 | -360,192 | -22.9% |
| `/exports` | 1,306,978 | 1,186,542 | -120,436 | -9.2% |
| `/line-up-songs` | 1,270,722 | 1,150,286 | -120,436 | -9.5% |
| `/login` | 938,539 | 939,360 | +821 | +0.1% |
| `/member` | 1,596,212 | 1,235,906 | -360,306 | -22.6% |
| `/members` | 1,363,496 | 1,362,578 | -918 | -0.1% |
| `/ministries` | 1,252,490 | 1,132,054 | -120,436 | -9.6% |
| `/register` | 696,226 | 697,024 | +798 | +0.1% |
| `/reset-password` | 696,226 | 697,024 | +798 | +0.1% |
| `/schedule` | 1,432,350 | 1,431,432 | -918 | -0.1% |
| `/settings` | 1,266,376 | 1,145,940 | -120,436 | -9.5% |

The small increases on `/login`, `/register` and `/reset-password` are shared runtime chunk reshuffling from the new client wrappers; those routes do not contain any of the deferred heavy chunks.

## 12. Verification results

| Check | Result | Evidence |
|---|---|---|
| `npm run lint` | PASS (exit 0) | 4 pre-existing warnings in `src/lib/scheduling/fairness.ts` and `src/lib/scheduling/rules/index.ts`; 0 errors. No warning in any changed file. |
| `npm test` | PASS (exit 0) | 59 test files, 806 tests passed, including `src/components/client-boundaries.test.ts`. |
| `npm run build` | PASS (exit 0) | Compiled in 5.6s, TypeScript in 8.4s, 42/42 static pages in 518ms. Only the pre-existing custom `Cache-Control` warning. |
| `git diff --check` | PASS (exit 0) | No whitespace errors; Git reported LF-to-CRLF normalization notices for rewritten `.tsx` files, matching the repository's checked-in line endings. |

Logs: `%TEMP%\issue127-baseline-build.txt`, `%TEMP%\issue127-baseline-analyze.txt`, `%TEMP%\issue127-post-build.txt`, `%TEMP%\issue127-build-final.txt`, `%TEMP%\issue127-lint-final.txt`, `%TEMP%\issue127-test-final.txt`, `%TEMP%\issue127-final-routes.txt`, `%TEMP%\issue127-final-chunks.txt`.

## 13. Limitations and deferred work

- Measurements are uncompressed build-time bytes, not gzip/brotli transfer bytes.
- No browser profiling or Lighthouse run was performed; the verification gate for this phase was lint, unit tests, production build and diff hygiene.
- `TiltCard` still uses `motion/react`; the approved plan removed it only from `Sidebar`, so the motion runtime remains on routes that render stat cards.
- `html2canvas` remains an unused dependency by explicit decision; no dependency was added, removed or upgraded.
- No scheduling rule, validator severity, auth boundary, tenant scope, API response, migration, commit, merge or deployment was changed.
