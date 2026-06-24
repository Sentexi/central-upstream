# Central Upstream design system (Aqua Operator)

Central Upstream is a single-user self-hosting dashboard. Its look is the
**Aqua Operator** theme: opaque panels on a near-black indigo background, teal as
the primary accent with an indigo/violet/coral/amber/green data spectrum, mono
labels and IDs, and depth from background steps plus hairline borders instead of
drop shadows. Build every screen on this dark base.

## Setup and theming

There is no React provider and no theme switch (dark mode only). All styling
comes from the global stylesheet (`src/index.css`). It defines the design tokens
and the class vocabulary, and it styles `body` with the dark radial-glow
background (`radial-gradient(120% 70% at 84% -8%, #101638 0%, var(--bg) 50%)`)
and near-white text. So:

- keep the page background dark. Render on `var(--bg)` (`#0A0C18`); the stylesheet
  already sets the glow on `body`. A light background breaks the theme.
- style with the class vocabulary below plus the `var(--*)` tokens. There is no
  utility framework (no Tailwind). Newer primitives in `src/core/ui/` use small
  inline-style components; the foundation classes stay in `index.css`.
- fonts: Space Grotesk for UI text, IBM Plex Mono for numbers, labels, axes and
  IDs (loaded via `<link>` in `index.html`).
- only one legacy React surface component ships here: `GlassCard`. Newer screens
  prefer the `Card`/panel primitives, but `GlassCard` keeps the same panel look.

## Design tokens (CSS custom properties)

Surfaces: `--bg` page background (`#0A0C18`), `--sidebar-bg`, `--panel` card fill,
`--raised`, `--nav-active` / `--nav-hover`, `--track`. Lines: `--border`,
`--border-strong`, `--grid-line`, `--row-divider`. Text: `--text-high` /
`--text-mid` / `--text-low` / `--text-faint`, `--soft`, `--text-on-teal`.
Accents / data spectrum: `--teal` (`#1FC3D6`, primary), `--teal-bright`,
`--indigo`, `--violet`, `--coral`, `--amber`, `--green` (+ `-bright` variants).
Status: `--success` / `--warning` / `--error` with matching `-text`, `-border`,
`-fill`. Radii: `--radius-card` (14px), `--radius-module` (16px),
`--radius-control` (9px), `--radius-pill` (20px), `--radius-input` (10px).
Use them as `var(--name)`.

## Class vocabulary

Layout: `app-shell`, `layout-grid` (flex shell), `sidebar` (+ `is-collapsed`),
`sidebar-header` / `sidebar-brand` / `sidebar-nav` / `sidebar-footer`,
`nav-item` (+ `active`, `is-syncing`), `content-area`, `slot-stack`, `panel`.
Surfaces: `glass-card` (the card GlassCard renders), `metric-card`,
`chart-panel`, `draft-card`.
Type: `kicker` (mono uppercase label), `section-heading` (mono heading with a
teal dot), `card-title` / `card-description`, `metric-label` / `metric-value` /
`metric-sub`, `tile-value` (+ `unit`), `muted`. (Legacy `title` / `subtitle`
exist for views not yet migrated; new screens use the `PageHeader` primitive.)
Controls: `button` (+ `button-secondary`, `button-tertiary`), `input`
(+ `input--textarea`), `pill` (+ `dot`, `warning`), `chip` (+ `is-active`),
`status` (+ `signal`), `status-pill`.
Data: `task-list` / `task-item`, `notion-table`, `progress-bar` /
`progress-bar__fill`, `barometer`, `inline-fields`, `badge-success` /
`badge-alert` / `badge-work`.

Newer composable primitives live in `src/core/ui/` (`PageHeader`,
`SegmentedControl`, `Button`, `Card`, `StatCard`, `SectionHeader`, `ProgressBar`,
`RangeBar`, `Badge`) and chart wrappers in `src/core/charts/`. Read `index.css`
for the full class definitions before composing.

## Build snippet

```tsx
import { GlassCard } from "../../core/GlassCard";

<div className="slot-stack">
  <GlassCard>
    <div className="section-heading">Energy Monitor</div>
    <div className="tile-value">
      <span className="metric-value">412</span>
      <span className="unit">kcal aktiv</span>
    </div>
    <div className="inline-fields">
      <span className="pill"><span className="dot" /> live</span>
      <button className="button button-tertiary">Details</button>
    </div>
  </GlassCard>
</div>
```

`GlassCard` props: `glow` (dezenter Teal-Ring), `stressLevel="high"` with `glow`
(Coral/Error-Ring), `className`. No drop shadow. Group related cards in
`slot-stack`, `grid-cards` or `dashboard-grid`.
