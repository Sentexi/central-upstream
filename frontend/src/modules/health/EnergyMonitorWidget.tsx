import { GlassCard } from "../../core/GlassCard";

const ENERGY_SEGMENTS = [
  { label: "Recovery", value: 82, detail: "Resting well" },
  { label: "Focus", value: 68, detail: "Peaks midday" },
  { label: "Sleep", value: 74, detail: "7h 20m" },
  { label: "Stress", value: 32, detail: "Balanced" },
];

export function EnergyMonitorWidget() {
  return (
    <GlassCard glow className="health-card">
      <div className="kicker">Energy</div>
      <h3 className="card-title">Energy Monitor</h3>
      <p className="card-description">
        Snapshot across recovery, focus and sleep to see how your energy flows today.
      </p>

      <div className="metric-grid" role="list">
        {ENERGY_SEGMENTS.map((segment) => (
          <div className="metric" key={segment.label} role="listitem">
            <div className="metric-header">
              <span className="metric-label">{segment.label}</span>
              <span className="metric-value">{segment.value}%</span>
            </div>
            <div className="metric-bar" aria-hidden>
              <span style={{ width: `${segment.value}%` }} />
            </div>
            <div className="metric-detail">{segment.detail}</div>
          </div>
        ))}
      </div>

      <div className="stat-chip" aria-live="polite">
        <span className="dot" aria-hidden />
        Stabilisiert durch letzte Synchronisation
      </div>
    </GlassCard>
  );
}
