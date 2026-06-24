import type { ReactNode } from 'react';
import { GlassCard } from 'central-upstream-frontend';

// The design system is dark-themed (Aqua Operator): GlassCard assumes the app's
// dark `--bg` page background and radial glow, set on `body` by the global
// stylesheet. The preview harness renders on a white body, so each story restores
// that themed backdrop with a <Frame> wrapper. This is the exact context
// GlassCard sits in inside the app (always on the dark page background), not
// extra styling.
function Frame({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        background:
          'radial-gradient(120% 70% at 84% -8%, #101638 0%, #0a0c18 50%)',
        padding: 28,
        borderRadius: 16,
      }}
    >
      {children}
    </div>
  );
}

/** Plain card. The default surface for any grouped block of content. */
export function Default() {
  return (
    <Frame>
      <GlassCard>
        <div className="kicker">Today</div>
        <h3 className="card-title">Quick Capture</h3>
        <p className="card-description">
          Schreib einen Gedanken auf, er landet sofort in der Inbox.
        </p>
        <div className="inline-fields">
          <span className="pill">
            <span className="dot" /> 3 offene Eintraege
          </span>
          <span className="status">
            <span className="signal" /> synchronisiert
          </span>
        </div>
      </GlassCard>
    </Frame>
  );
}

/** glow (low intensity, teal ring). For an active or live surface. */
export function GlowLow() {
  return (
    <Frame>
      <GlassCard glow>
        <div className="section-heading">Energy Monitor</div>
        <div className="tile-value">
          <span className="metric-value">412</span>
          <span className="unit">kcal aktiv</span>
        </div>
        <p className="card-description">Heute 18 Prozent ueber deinem 7-Tage-Schnitt.</p>
      </GlassCard>
    </Frame>
  );
}

/** glow with stressLevel="high" (danger, coral ring). For alerts and warnings. */
export function GlowHigh() {
  return (
    <Frame>
      <GlassCard glow stressLevel="high">
        <div className="section-heading">Vape Tracking</div>
        <h3 className="card-title">Tageslimit erreicht</h3>
        <p className="card-description">
          Du liegst 40 Prozent ueber dem gleitenden Wochendurchschnitt.
        </p>
        <div className="inline-fields">
          <span className="pill warning">
            <span className="dot" /> Achtung
          </span>
          <button className="button button-tertiary">Limit anpassen</button>
        </div>
      </GlassCard>
    </Frame>
  );
}

/** A richer composition: a dashboard tile built from the foundation classes. */
export function DashboardTile() {
  return (
    <Frame>
      <GlassCard>
        <div className="section-heading">Notion Tasks</div>
        <div className="dashboard-grid">
          <div className="metric-card">
            <span className="metric-label">Offen</span>
            <span className="metric-value">12</span>
            <span className="metric-sub">3 ueberfaellig</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Heute faellig</span>
            <span className="metric-value">4</span>
            <span className="metric-sub">2 in Arbeit</span>
          </div>
        </div>
        <ul className="task-list">
          <li className="task-item">Wochenreview vorbereiten</li>
          <li className="task-item">PR Review: Health Sync</li>
        </ul>
      </GlassCard>
    </Frame>
  );
}
