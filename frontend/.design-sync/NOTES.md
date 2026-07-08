# design-sync notes — central-upstream-frontend

## What is synced and why

This repo is a React **application**, not a component library. The sync is
deliberately scoped to the design **foundation** plus the one genuinely
reusable component:

- Tokens and the full utility/semantic CSS class vocabulary live in
  `src/index.css` (wired via `cfg.cssEntry`).
- `GlassCard` (`src/core/GlassCard.tsx`) is the only reusable React component.

The module views (Health, Notion, Calories, Settings, chart widgets) are
**intentionally excluded**: they are coupled to the live backend API and do not
render in isolation, so they would make poor design-system components.

## Build specifics (so a re-sync just works)

- **No library build exists.** The converter runs with
  `--entry src/core/GlassCard.tsx` (a real source file that exports exactly
  `{ GlassCard }`), NOT synth-entry mode. This keeps `main.tsx`'s top-level
  `createRoot().render()` side effect and the backend-coupled views out of the
  bundle, and makes PKG_DIR resolve to `repo/frontend`.
- The component list is pinned via `cfg.componentSrcMap`.
- `GlassCardProps` is pinned via `cfg.dtsPropsFor` because there is no shipped
  `.d.ts` and `@types/react` is not a frontend devDependency, so ts-morph
  extraction would be unreliable. The pinned body matches the source exactly.
- Run all commands from `repo/frontend` (PKG_DIR == cwd).
- `--node-modules node_modules` (react/react-dom 18.3.1 live there; the bundle
  externalizes react via a shim, and `vendorReact` copies React into `_vendor/`
  from here).

## Fonts (known render warns)

- `src/index.css` line 1 `@import`s Google Fonts (Geist, Geist Mono) remotely
  → `[FONT_REMOTE]`, loads at runtime. Expected, no action.
- Pre-existing quirk: `body` uses `font-family: 'Geist Sans'` but the Google
  import provides the family **`Geist`** (not `Geist Sans`). Body text therefore
  falls back to `system-ui` in both the app and any synced design. Not fixed
  here (ship what the repo built); revisit only if upstream fixes it.

## Toolchain

- Playwright pinned to **1.60.0** (chromium build **1223**) to match the local
  `~/AppData/Local/ms-playwright` cache. Playwright 1.61 pins build 1228, which
  is not cached, and would fail the render check with "Executable doesn't
  exist". On a fresh machine, re-check the cache and pin accordingly.

## Re-sync risks (what can silently go stale)

- New reusable primitives added under `src/core/` will not sync until added to
  `cfg.componentSrcMap`.
- If the app ever gains a real component-library build (an exports entry), switch
  `--entry` to it and drop the direct `GlassCard.tsx` entry; `dtsPropsFor` can
  then be removed in favor of extracted types.
- The `GlassCard` preview and the conventions header reference class names from
  `src/index.css`. Renaming classes there requires updating both.
- The `'Geist Sans'` vs `'Geist'` font-name mismatch is upstream.
