import { GlassCard } from "../../core/GlassCard";

const FITNESS_ACTIVITIES = [
  { label: "Steps", value: "8,430", detail: "10% above baseline" },
  { label: "Workouts", value: "2 sessions", detail: "Strength + Mobility" },
  { label: "Heart Rate", value: "118 bpm", detail: "avg active" },
];

const FOCUS_STREAKS = [
  { label: "Hydration", status: "on-track" },
  { label: "Movement", status: "completed" },
  { label: "Sleep", status: "needs-review" },
];

export function FitnessOverview() {
  return (
    <GlassCard className="health-card">
      <div className="kicker">Fitness</div>
      <h3 className="card-title">Fitness View</h3>
      <p className="card-description">
        Quick overview of movement, activity streaks and how today compares to your baseline.
      </p>

      <div className="activity-grid" role="list">
        {FITNESS_ACTIVITIES.map((item) => (
          <div className="activity" key={item.label} role="listitem">
            <div className="metric-header">
              <span className="metric-label">{item.label}</span>
              <span className="metric-value">{item.value}</span>
            </div>
            <div className="metric-detail">{item.detail}</div>
          </div>
        ))}
      </div>

      <div className="streaks" aria-label="Daily streaks">
        {FOCUS_STREAKS.map((streak) => (
          <span
            key={streak.label}
            className={`streak-chip streak-${streak.status}`}
            role="status"
          >
            <span className="dot" aria-hidden />
            {streak.label}
          </span>
        ))}
      </div>
    </GlassCard>
  );
}
