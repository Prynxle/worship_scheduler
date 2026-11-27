# Response Header Matrix (Issue #128, Phase 5)

Status: COMPLETE for local production-server observation.

Reference: https://github.com/Prynxle/worship_scheduler/issues/128

## 1. Purpose

This document records the expected and observed HTTP response headers for the JOHIA worship scheduler after the Phase 5 browser-caching and asset-delivery changes. It verifies that hashed static assets are immutable, authenticated API responses are never cached, and HTML documents do not inherit the immutable static-asset policy.

## 2. Build and observation metadata

| Item | Value |
|---|---|
| Branch | `perf/issue-128-browser-caching-asset-delivery` |
| Build command | `npm run build` |
| Production server | `npm start -- --hostname 127.0.0.1 --port 3000` |
| Observation tool | PowerShell `Invoke-WebRequest` |
| Observed date | `2026-11-27` |
| Node | v26.x (local environment) |

## 3. Header policy

| Route class | Source pattern | Expected `Cache-Control` | Additional headers |
|---|---|---|---|
| Hashed static assets | `/_next/static/:path*` | `public, max-age=31536000, immutable` | None added |
| API responses | `/api/:path*` | `private, no-store, no-cache, max-age=0, must-revalidate` | `Pragma: no-cache`; `Expires: 0`; `Vary: Authorization` (plus Next.js router Vary values) |
| HTML documents | All non-asset, non-API paths | `no-cache` | Next.js router Vary values only |

Public, non-hashed files under `public/` are not assigned an immutable policy; they keep Next.js/Vercel defaults unless a future versioned asset policy is approved.

## 4. Observed headers

| Route | Status | Observed `Cache-Control` | Observed `Pragma` | Observed `Expires` | Observed `Vary` | Notes |
|---|---:|---|---|---|---|---|
| `/` | 200 | `no-cache` | not set by policy | not set by policy | `rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding` | HTML document; no longer `s-maxage=31536000` |
| `/dashboard` | 200 | `no-cache` | not set by policy | not set by policy | `rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding` | Authenticated shell document |
| `/login` | 200 | `no-cache` | not set by policy | not set by policy | `rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding` | Public auth document |
| `/_next/static/chunks/<hash>.js` | 200 | `public, max-age=31536000, immutable` | none | none | `Accept-Encoding` | Hashed immutable asset |
| `/api/auth/me` | 401 without session / 200 with session | `private, no-store, no-cache, max-age=0, must-revalidate` | `no-cache` | `0` | `Authorization, rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch` | Tenant-scoped API response; `Vary` includes `Authorization` |

## 5. Font preload rationale

Fonts are configured in `src/app/layout.tsx` with `next/font`.

| Font | Variable | Preload | Rationale |
|---|---|---|---|
| Plus Jakarta Sans (local) | `--font-sans` | default (`true`) | Default preload retained pending LCP measurement; no preload changes made. |
| Geist Mono | `--font-geist-mono` | default (`true`) | Default preload retained pending LCP measurement; no preload changes made. |
| Fraunces | `--font-display` | default (`true`) | Default preload retained pending LCP measurement; no preload changes made. |

Default preload is retained for all fonts pending LCP measurement; no preload changes were made.

## 6. Verification

| Check | Result | Evidence |
|---|---|---|
| `npm run lint` | PASS (0 errors, 5 pre-existing warnings) | Local run |
| `npm test` | PASS (58 files, 802 tests) | Local run |
| `npm run build` | PASS | Local run |
| `git diff --check` | PASS (no whitespace errors) | Local run |
| Header capture | PASS | Observed values in section 4 |

## 7. Notes and limitations

- Observed values are from the local production server. Vercel may add or normalize CDN headers in deployment; this matrix should be re-checked against the deployed URL when available.
- `/api/auth/me` was observed without a session for header verification; authenticated responses use the same route-level policy.
- No scheduling, auth, database, or tenant-scope behavior was changed in this phase.