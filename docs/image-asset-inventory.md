# Image Asset Inventory (Issue #125, Phase 2)

Status: COMPLETE.

Reference: https://github.com/Prynxle/worship_scheduler/issues/125

## 1. Purpose

Documentation of all files under `public/`, their dimensions, byte sizes, purpose, references, and optimization status. Phase 2 optimizes the one raster icon actually used by the app and records the policy for future raster images.

## 2. Raster optimization (icon-removebg-preview.png)

- File: `public/icon-removebg-preview.png`
- Before: 500x500, 166745 bytes, RGBA PNG.
- After: 256x256, 49830 bytes, RGBA PNG.
- Method: Pillow `Image.resize((256, 256), Image.LANCZOS)` then `Image.save(path, optimize=True)`.
- Alpha channel preserved (mode remains `RGBA`).
- Path and filename unchanged.

## 3. Public asset inventory

| File | Type | Dimensions | Bytes | Purpose | References | Status |
|---|---|---|---:|---|---|---|
| `public/file.svg` | SVG | 16x16 (`viewBox 0 0 16 16`) | 391 | Starter/Next.js template asset | None in `src/` | Unreferenced; retained pending approval |
| `public/globe.svg` | SVG | 16x16 (`viewBox 0 0 16 16`) | 1035 | Starter/Next.js template asset | None in `src/` | Unreferenced; retained pending approval |
| `public/icon-removebg-preview.png` | PNG | 256x256 | 49830 | App/church logo fallback for PDF export and metadata icon | `src/app/layout.tsx` metadata icons; `src/app/api/export/pdf/route.ts` fallback logo | Optimized (Phase 2) |
| `public/next.svg` | SVG | 394x80 (`viewBox 0 0 394 80`) | 1375 | Starter/Next.js template asset | None in `src/` | Unreferenced; retained pending approval |
| `public/vercel.svg` | SVG | 1155x1000 (`viewBox 0 0 1155 1000`) | 128 | Starter/Next.js template asset | None in `src/` | Unreferenced; retained pending approval |
| `public/window.svg` | SVG | 16x16 (`viewBox 0 0 16 16`) | 385 | Starter/Next.js template asset | None in `src/` | Unreferenced; retained pending approval |

Starter SVGs are unreferenced and retained pending approval. They are not deleted in Phase 2.

## 4. App fonts

- Location: `src/app/fonts/`
- File: `src/app/fonts/plus-jakarta-sans-latin.woff2`
- Loaded via `next/font/local` in `src/app/layout.tsx` as `--font-sans` with weight range `300 800`.

## 5. Future raster image policy

- Use `next/image` for all raster images rendered in UI.
- Always provide explicit `width` and `height` (or `fill` with a sized parent) to reserve dimensions and prevent CLS.
- Provide `sizes` appropriate to the rendered width.
- Use `priority` only for above-the-fold LCP images.
- Keep source assets optimized (resize to display dimensions, preserve alpha only when needed, use `optimize=True` for PNG).
- Do not add new unreferenced starter assets; remove only after approval.
- Metadata icons may use array form with `url`, `sizes`, and `type` (see `src/app/layout.tsx`).
