# Central Upstream design system

Central Upstream is a single-user self-hosting dashboard. Its look is a dark
glassmorphism theme: translucent cards on a near-black background, blue as the
accent, monospace kickers, and soft glows. Build every screen on this dark base.

## Setup and theming

There is no React provider and no theme switch. All styling comes from the
global stylesheet (`styles.css`, which imports `_ds_bundle.css`). That stylesheet
defines the tokens and the class vocabulary, and it styles `body` with the dark
background (`--bg`) and near-white text (`--text-main`). So:

- keep the page background dark. Render on `var(--bg)` (`#020617`); the
  stylesheet already sets this on `body`. A light background breaks the theme,
  because the near-white text disappears and the glass surfaces wash out.
- style with the class vocabulary below plus the `var(--*)` tokens. There is no
  utility framework (no Tailwind) and no inline-style convention.
- only one React component ships: `GlassCard` (`window.CentralUpstream.GlassCard`).
  Everything else is plain HTML elements carrying these classes.

## Design tokens (CSS custom properties)

`--bg` page background, `--surface` / `--surface-hover` card fills, `--border`
hairline borders, `--text-main` / `--text-muted` text, `--primary` blue accent,
`--primary-glow` / `--danger-glow` glow colors, `--card-shadow`, `--radius`
(12px). Use them as `var(--name)`.

## Class vocabulary

Layout: `app-shell`, `layout-grid`, `content-area`, `grid-cards`,
`dashboard-grid`, `stack` (vertical gap), `app-header`.
Surfaces: `glass-card` (the card GlassCard renders), `metric-card`,
`chart-panel`, `draft-card`.
Type: `kicker` (mono uppercase label), `title` / `subtitle`, `card-title` /
`card-description`, `section-heading` (mono heading with a glowing dot),
`metric-label` / `metric-value` / `metric-sub`, `tile-value` (+ `unit`), `muted`.
Controls: `button` (+ `button-secondary`, `button-tertiary`), `input`
(+ `input--textarea`), `pill` (+ `dot`, `warning`), `chip` (+ `is-active`),
`status` (+ `signal`), `status-pill`, `nav-item`.
Data: `task-list` / `task-item`, `notion-table`, `progress-bar` /
`progress-bar__fill`, `barometer`, `inline-fields` (compact flex row),
`badge-success` / `badge-alert` / `badge-work`.

Read `_ds_bundle.css` for the full definitions before composing. The `GlassCard`
API is in `components/core/GlassCard/GlassCard.d.ts`, usage in
`GlassCard.prompt.md`.

## Build snippet

```tsx
import { GlassCard } from 'central-upstream-frontend';

<div style={{ background: 'var(--bg)', padding: 28 }}>
  <GlassCard glow>
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

`GlassCard` props: `glow` (blue ring), `stressLevel="high"` with `glow` (red
ring), `className`. Group related cards in `grid-cards` or `dashboard-grid`.
