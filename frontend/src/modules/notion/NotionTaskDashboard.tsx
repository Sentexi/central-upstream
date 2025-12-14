import { useEffect, useMemo, useState } from "react";
import { GlassCard } from "../../core/GlassCard";
import { fetchTaskDashboardStats } from "./api";
import type { HeatmapPoint, TaskDashboardStats, WeeklyFlow, WorkspaceOpen } from "./types";

const palette = ["#4ade80", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#34d399", "#fb7185"];

function formatNumber(value: number) {
  return value.toLocaleString("de-DE");
}

function formatDateLabel(date: string) {
  const d = new Date(date);
  return d.toLocaleDateString("de-DE", { month: "short", day: "numeric" });
}

function DailyFlowChart({
  data,
  rangeLabel,
}: {
  data: { date: string; created: number; completed: number }[];
  rangeLabel: string;
}) {
  const width = Math.max(data.length * 34 + 40, 360);
  const height = 240;
  const baseline = height - 36;
  const maxValue = Math.max(...data.map((d) => Math.max(d.created, d.completed, 1)));
  const scale = (value: number) => (value / maxValue) * (height - 80);

  return (
    <div className="chart-shell">
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label={`Daily flow ${rangeLabel}`}>
        <line x1="32" x2={width - 12} y1={baseline} y2={baseline} className="chart-axis" />
        {data.map((entry, idx) => {
          const x = 32 + idx * 34;
          const completedHeight = scale(entry.completed);
          const createdHeight = scale(entry.created);
          return (
            <g key={entry.date} transform={`translate(${x}, 0)`}>
              <rect
                x={4}
                y={baseline - completedHeight}
                width={12}
                height={completedHeight}
                rx={3}
                className="bar bar--green"
              >
                <title>{`${formatDateLabel(entry.date)}: Done ${entry.completed}`}</title>
              </rect>
              <rect
                x={20}
                y={baseline - createdHeight}
                width={12}
                height={createdHeight}
                rx={3}
                className="bar bar--red"
              >
                <title>{`${formatDateLabel(entry.date)}: Created ${entry.created}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div className="chart-axis-labels">
        <span>0</span>
        <span>{formatNumber(maxValue)}</span>
      </div>
    </div>
  );
}

function WaterfallChart({ data }: { data: WeeklyFlow[] }) {
  const width = Math.max(data.length * 38 + 32, 360);
  const height = 220;
  const baseline = height / 2 + 20;
  const maxValue = Math.max(...data.map((d) => Math.max(d.incoming, d.completed, Math.abs(d.net), 1)));
  const scale = (value: number) => (value / maxValue) * (height / 2 - 30);

  return (
    <div className="chart-shell">
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label="Weekly waterfall">
        <line x1="28" x2={width - 12} y1={baseline} y2={baseline} className="chart-axis" />
        {data.map((entry, idx) => {
          const x = 28 + idx * 38;
          const incomingHeight = scale(entry.incoming);
          const completedHeight = scale(entry.completed);
          const netY = baseline - scale(entry.net);
          return (
            <g key={entry.period} transform={`translate(${x}, 0)`}>
              <rect
                x={2}
                y={baseline - incomingHeight}
                width={12}
                height={incomingHeight}
                rx={3}
                className="bar bar--blue"
              >
                <title>{`${entry.period}: Incoming ${entry.incoming}`}</title>
              </rect>
              <rect
                x={16}
                y={baseline}
                width={12}
                height={completedHeight}
                rx={3}
                className="bar bar--red"
                transform={`translate(0, 0) scale(1, -1) translate(0, ${-baseline * 2})`}
              >
                <title>{`${entry.period}: Completed ${entry.completed}`}</title>
              </rect>
              <circle cx={12} cy={netY} r={3} className="line-dot" />
              {idx > 0 && (
                <line
                  x1={-26}
                  x2={0}
                  y1={baseline - scale(data[idx - 1].net)}
                  y2={netY}
                  className="line-connector"
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const heatmapDayOrder = [1, 2, 3, 4, 5, 6, 0];
const heatmapDayLabels = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const bigint = parseInt(normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return { r, g, b };
}

function HeatmapChart({ data, color, label }: { data: HeatmapPoint[]; color: string; label: string }) {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const valueMap = new Map(data.map((entry) => [`${entry.weekday}-${entry.hour}`, entry.count]));
  const maxValue = data.length > 0 ? Math.max(...data.map((d) => d.count)) : 0;
  const { r, g, b } = hexToRgb(color);
  const normalizer = maxValue || 1;

  function cellColor(value: number) {
    const intensity = value === 0 ? 0.1 : 0.2 + (value / normalizer) * 0.65;
    return `rgba(${r}, ${g}, ${b}, ${intensity.toFixed(2)})`;
  }

  return (
    <div className="chart-shell heatmap-shell" role="img" aria-label={`${label} heatmap by day and hour`}>
      <div className="heatmap-grid">
        <div className="heatmap-hours" aria-hidden>
          <span className="heatmap-corner" />
          {hours.map((hour) => (
            <span key={hour} className="heatmap-hour">
              {hour % 3 === 0 ? `${hour.toString().padStart(2, "0")}` : ""}
            </span>
          ))}
        </div>
        {heatmapDayOrder.map((weekday, idx) => (
          <div key={weekday} className="heatmap-row">
            <span className="heatmap-day">{heatmapDayLabels[idx]}</span>
            <div className="heatmap-cells">
              {hours.map((hour) => {
                const value = valueMap.get(`${weekday}-${hour}`) || 0;
                const tooltip = `${heatmapDayLabels[idx]}, ${hour.toString().padStart(2, "0")}:00 – ${value} ${label.toLowerCase()}`;
                return (
                  <span
                    key={`${weekday}-${hour}`}
                    className="heatmap-cell"
                    style={{ backgroundColor: cellColor(value) }}
                    title={tooltip}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="heatmap-legend" aria-hidden>
        <span className="muted small">Low</span>
        <div className="heatmap-legend-bar" style={{ background: `linear-gradient(90deg, rgba(${r}, ${g}, ${b}, 0.12), rgba(${r}, ${g}, ${b}, 0.8))` }} />
        <span className="muted small">High</span>
      </div>
    </div>
  );
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    "M",
    start.x,
    start.y,
    "A",
    r,
    r,
    0,
    largeArcFlag,
    0,
    end.x,
    end.y,
  ].join(" ");
}

function polarToCartesian(cx: number, cy: number, r: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;

  return {
    x: cx + r * Math.cos(angleInRadians),
    y: cy + r * Math.sin(angleInRadians),
  };
}

function WorkspacePie({
  data,
  selected,
  onSelect,
}: {
  data: WorkspaceOpen[];
  selected: string | null;
  onSelect: (workspace: string | null) => void;
}) {
  const size = 240;
  const radius = size / 2 - 10;
  const center = size / 2;
  const total = data.reduce((acc, curr) => acc + curr.count, 0) || 1;

  let startAngle = 0;

  return (
    <div className="workspace-chart">
      <svg viewBox={`0 0 ${size} ${size}`} className="chart-svg" role="img" aria-label="Open tasks by workspace">
        {data.map((slice, idx) => {
          const angle = (slice.count / total) * 360;
          const endAngle = startAngle + angle;
          const path = describeArc(center, center, radius, startAngle, endAngle);
          const pathEl = (
            <path
              key={slice.workspace}
              d={path}
              className="pie-slice"
              stroke={palette[idx % palette.length]}
              strokeWidth={14}
              fill="none"
              opacity={selected && selected !== slice.workspace ? 0.4 : 1}
            >
              <title>{`${slice.workspace}: ${slice.count}`}</title>
            </path>
          );
          startAngle = endAngle;
          return pathEl;
        })}
      </svg>
      <div className="workspace-list">
        {data.map((slice, idx) => (
          <button
            key={slice.workspace}
            type="button"
            className={`workspace-row ${selected === slice.workspace ? "is-active" : ""}`.trim()}
            onClick={() => onSelect(selected === slice.workspace ? null : slice.workspace)}
          >
            <span className="legend-dot" style={{ background: palette[idx % palette.length] }} />
            <span className="workspace-name">{slice.workspace}</span>
            <span className="workspace-count">{formatNumber(slice.count)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

  export function NotionTaskDashboard() {
    const [stats, setStats] = useState<TaskDashboardStats | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [rangeDays, setRangeDays] = useState(30);
    const [focusedWorkspace, setFocusedWorkspace] = useState<string | null>(null);
    const [heatmapMode, setHeatmapMode] = useState<"created" | "completed">("created");

    useEffect(() => {
      setLoading(true);
      fetchTaskDashboardStats()
        .then((data) => {
          setStats(data);
          setError(null);
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
      if (!stats) return;
      if (stats.creation_heatmap.length === 0 && stats.completion_heatmap.length > 0) {
        setHeatmapMode("completed");
      } else {
        setHeatmapMode("created");
      }
    }, [stats]);

    const filteredDailyFlow = useMemo(() => {
      if (!stats) return [];
      const today = new Date();
      const cutoff = new Date(today);
      cutoff.setDate(today.getDate() - rangeDays);
      return stats.daily_flow.filter((entry) => new Date(entry.date) >= cutoff);
    }, [stats, rangeDays]);

    const waterfallData = useMemo(() => stats?.weekly_flow || [], [stats]);

    const pieData = useMemo(() => {
      const data = stats?.open_by_workspace || [];
      if (!data.length) return data;
      const maxSlices = 6;
      if (data.length <= maxSlices) return data;
      const top = data.slice(0, maxSlices - 1);
      const rest = data.slice(maxSlices - 1);
      const otherTotal = rest.reduce((acc, item) => acc + item.count, 0);
      return [...top, { workspace: "Other", count: otherTotal }];
    }, [stats]);

    const selectedWorkspace =
      focusedWorkspace && pieData.find((p) => p.workspace === focusedWorkspace) ? focusedWorkspace : null;

    const creationHeatmap = stats?.creation_heatmap || [];
    const completionHeatmap = stats?.completion_heatmap || [];
    const activeHeatmap = heatmapMode === "created" ? creationHeatmap : completionHeatmap;
    const activeHeatmapLabel = heatmapMode === "created" ? "Created" : "Done";
    const activeHeatmapColor = heatmapMode === "created" ? "#60a5fa" : "#4ade80";
    const hasHeatmapData = creationHeatmap.length > 0 || completionHeatmap.length > 0;

  return (
    <GlassCard glow className="notion-dashboard-card">
      <div className="card-header">
        <div>
          <span className="kicker">Notion</span>
          <h3 className="card-title">Task Dashboard</h3>
          <p className="card-description">
            Live-Einblicke aus der Notion-SQLite: eingehende vs. erledigte Tasks, Net-Flow und offene Arbeit
            pro Workspace.
          </p>
        </div>
        <div className="chart-controls" role="group" aria-label="Zeitraum filtern">
          {[14, 30, 60, 90].map((days) => (
            <button
              key={days}
              type="button"
              className={`chip ${rangeDays === days ? "is-active" : ""}`.trim()}
              onClick={() => setRangeDays(days)}
            >
              {days}d
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="muted">Dashboard lädt...</p>}
      {error && <p className="badge-alert">{error}</p>}

      {stats && (
        <div className="dashboard-grid">
          <div className="metric-card">
            <div className="metric-label">Offene Tasks</div>
            <div className="metric-value">{formatNumber(stats.summary.open)}</div>
            <div className="metric-sub">{formatNumber(stats.summary.incoming_last_7d)} eingehend (7d)</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Erledigt gesamt</div>
            <div className="metric-value text-green">{formatNumber(stats.summary.completed)}</div>
            <div className="metric-sub">{formatNumber(stats.summary.completed_last_7d)} erledigt (7d)</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Aktueller Net-Flow</div>
            <div className="metric-value">
              {formatNumber(stats.summary.incoming_last_7d - stats.summary.completed_last_7d)}
            </div>
            <div className="metric-sub">Letzte 7 Tage</div>
          </div>
        </div>
      )}

      {filteredDailyFlow.length > 0 && (
        <div className="chart-panel">
          <div className="chart-panel__header">
            <div>
              <div className="muted small">Inflow vs. Done</div>
              <h4 className="chart-title">Täglicher Durchsatz</h4>
            </div>
            <div className="legend">
              <span className="legend-dot legend-dot--green" /> Done
              <span className="legend-dot legend-dot--red" /> Created
            </div>
          </div>
          <DailyFlowChart data={filteredDailyFlow} rangeLabel={`${rangeDays} Tage`} />
        </div>
      )}

      {hasHeatmapData && (
        <div className="chart-panel">
          <div className="chart-panel__header">
            <div>
              <div className="muted small">Zeitliche Verteilung</div>
              <h4 className="chart-title">Aktivität nach Wochentag &amp; Stunde</h4>
            </div>
            <div className="chart-controls" role="group" aria-label="Heatmap Modus">
              {[
                { key: "created", label: "Created" },
                { key: "completed", label: "Done" },
              ].map((mode) => (
                <button
                  key={mode.key}
                  type="button"
                  className={`chip ${heatmapMode === mode.key ? "is-active" : ""}`.trim()}
                  onClick={() => setHeatmapMode(mode.key as "created" | "completed")}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
          {activeHeatmap.length > 0 ? (
            <HeatmapChart data={activeHeatmap} color={activeHeatmapColor} label={activeHeatmapLabel} />
          ) : (
            <p className="muted small">Keine Daten für diesen Modus verfügbar.</p>
          )}
        </div>
      )}

      {waterfallData.length > 0 && (
        <div className="chart-panel">
          <div className="chart-panel__header">
            <div>
              <div className="muted small">Weekly Waterfall</div>
              <h4 className="chart-title">Tasks rein vs. raus</h4>
            </div>
            <div className="legend">
              <span className="legend-dot legend-dot--blue" /> Incoming
              <span className="legend-dot legend-dot--red" /> Completed
            </div>
          </div>
          <WaterfallChart data={waterfallData} />
        </div>
      )}

      {pieData.length > 0 && (
        <div className="chart-panel">
          <div className="chart-panel__header">
            <div>
              <div className="muted small">Open tasks</div>
              <h4 className="chart-title">Verteilung nach Workspace</h4>
            </div>
          </div>
          <WorkspacePie data={pieData} selected={selectedWorkspace} onSelect={setFocusedWorkspace} />
        </div>
      )}
    </GlassCard>
  );
}
