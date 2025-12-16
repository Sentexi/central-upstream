import { useEffect, useMemo, useState } from "react";
import { GlassCard } from "../../core/GlassCard";
import { fetchTaskDashboardStats } from "./api";
import type { DailyFlow, HeatmapPoint, TaskDashboardStats, WorkspaceOpen } from "./types";

const palette = ["#4ade80", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#34d399", "#fb7185"];

type FlowView = "7d" | "14d" | "30d" | "60d" | "90d" | "ytd" | "previous-years";

const flowViewOptions: { key: FlowView; label: string }[] = [
  { key: "7d", label: "7d" },
  { key: "14d", label: "14d" },
  { key: "30d", label: "30d" },
  { key: "60d", label: "60d" },
  { key: "90d", label: "90d" },
  { key: "ytd", label: "YTD" },
  { key: "previous-years", label: "Vorjahre" },
];

const flowViewLabels: Record<FlowView, string> = {
  "7d": "7 Tage",
  "14d": "14 Tage",
  "30d": "30 Tage",
  "60d": "60 Tage",
  "90d": "90 Tage",
  ytd: "Aktuelles Jahr (YTD)",
  "previous-years": "Frühere Jahre",
};

function formatNumber(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "–";
  }

  return value.toLocaleString("de-DE");
}

type FlowChartDatum = {
  id: string;
  label: string;
  tooltipLabel: string;
  created: number;
  completed: number;
};

type FlowEntry = DailyFlow;

function formatDateLabel(date: string) {
  const d = new Date(date);
  return d.toLocaleDateString("de-DE", { month: "short", day: "numeric" });
}

function startOfWeek(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day + 6) % 7; // Monday as start of week
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatWeekLabel(start: Date) {
  return start.toLocaleDateString("de-DE", { month: "short", day: "numeric" });
}

function formatWeekTooltip(start: Date) {
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const startLabel = start.toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
  const endLabel = end.toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
  return `${startLabel} – ${endLabel}`;
}

function formatMonthLabel(date: Date) {
  return date.toLocaleDateString("de-DE", { month: "short", year: "numeric" });
}

function groupFlowByWeek(flow: FlowEntry[]): FlowChartDatum[] {
  const buckets = new Map<
    string,
    { created: number; completed: number; start: Date }
  >();

  flow.forEach((entry) => {
    const start = startOfWeek(new Date(entry.date));
    const key = start.toISOString().slice(0, 10);
    const bucket = buckets.get(key) || { created: 0, completed: 0, start };
    bucket.created += entry.created;
    bucket.completed += entry.completed;
    buckets.set(key, bucket);
  });

  return Array.from(buckets.entries())
    .map(([key, bucket]) => ({
      id: key,
      label: formatWeekLabel(bucket.start),
      tooltipLabel: formatWeekTooltip(bucket.start),
      created: bucket.created,
      completed: bucket.completed,
    }))
    .sort((a, b) => new Date(a.id).getTime() - new Date(b.id).getTime());
}

function groupFlowByMonth(flow: FlowEntry[]): FlowChartDatum[] {
  const buckets = new Map<
    string,
    { created: number; completed: number; start: Date }
  >();

  flow.forEach((entry) => {
    const d = new Date(entry.date);
    const start = new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1));
    const key = start.toISOString().slice(0, 7);
    const bucket = buckets.get(key) || { created: 0, completed: 0, start };
    bucket.created += entry.created;
    bucket.completed += entry.completed;
    buckets.set(key, bucket);
  });

  return Array.from(buckets.entries())
    .map(([key, bucket]) => ({
      id: key,
      label: formatMonthLabel(bucket.start),
      tooltipLabel: formatMonthLabel(bucket.start),
      created: bucket.created,
      completed: bucket.completed,
    }))
    .sort((a, b) => new Date(a.id).getTime() - new Date(b.id).getTime());
}

function CombinedFlowChart({ data }: { data: FlowChartDatum[] }) {
  const height = 300;
  const margin = { top: 28, right: 18, bottom: 78, left: 60 };
  const barGroupWidth = 52;
  const barWidth = 18;
  const chartWidth = Math.max(data.length * barGroupWidth + margin.left + margin.right, 560);
  const innerHeight = height - margin.top - margin.bottom;

  let cumulativeNet = 0;
  let netMin = 0;
  let netMax = 0;
  const netPoints = data.map((entry, idx) => {
    cumulativeNet += entry.created - entry.completed;
    netMin = Math.min(netMin, cumulativeNet);
    netMax = Math.max(netMax, cumulativeNet);
    const x = margin.left + idx * barGroupWidth + barGroupWidth / 2;
    return { x, y: cumulativeNet, value: cumulativeNet, label: entry.tooltipLabel };
  });

  const maxCompleted = Math.max(...data.map((d) => d.completed), 0);
  const maxCreated = Math.max(...data.map((d) => d.created), 0);
  const maxAboveZero = Math.max(maxCompleted, netMax, 0);
  const maxBelowZero = Math.max(maxCreated, Math.abs(Math.min(netMin, 0)), 0);
  const rangeSpan = maxAboveZero + maxBelowZero || 1;
  const zeroY = margin.top + (maxAboveZero / rangeSpan) * innerHeight;

  const valueToY = (value: number) => zeroY - (value / rangeSpan) * innerHeight;

  const yTicks = [maxAboveZero || null, 0, maxBelowZero ? -maxBelowZero : null].filter(
    (tick, idx, arr) => tick !== null && arr.indexOf(tick) === idx,
  ) as number[];

  return (
    <div className="chart-shell chart-shell--centered" style={{ minHeight: height }}>
      <svg
        viewBox={`0 0 ${chartWidth} ${height}`}
        className="chart-svg"
        role="img"
        aria-label="Flow & Net"
        style={{ minWidth: chartWidth, width: chartWidth }}
      >
        <line x1={margin.left} x2={chartWidth - margin.right} y1={zeroY} y2={zeroY} className="chart-axis" />
        <line x1={margin.left} x2={margin.left} y1={height - margin.bottom} y2={margin.top} className="chart-axis" />

        {yTicks.map((tick) => {
          const y = valueToY(tick);
          return (
            <g key={tick}>
              <line x1={margin.left} x2={chartWidth - margin.right} y1={y} y2={y} className="chart-grid" />
              <text x={margin.left - 10} y={y + 4} className="chart-tick-label" textAnchor="end">
                {formatNumber(tick)}
              </text>
            </g>
          );
        })}

        {data.map((entry, idx) => {
          const groupX = margin.left + idx * barGroupWidth;
          const barX = groupX + (barGroupWidth - barWidth) / 2;
          const completedY = valueToY(entry.completed);
          const completedHeight = zeroY - completedY;
          const createdHeight = valueToY(-entry.created) - zeroY;
          return (
            <g key={entry.id}>
              <rect
                x={barX}
                y={completedY}
                width={barWidth}
                height={completedHeight}
                rx={3}
                className="bar bar--green"
              >
                <title>{`${entry.tooltipLabel}: Done ${entry.completed}`}</title>
              </rect>
              <rect
                x={barX}
                y={zeroY}
                width={barWidth}
                height={createdHeight}
                rx={3}
                className="bar bar--red"
              >
                <title>{`${entry.tooltipLabel}: Created ${entry.created}`}</title>
              </rect>
            </g>
          );
        })}

        {netPoints.length > 1 && (
          <polyline
            fill="none"
            stroke="#fbbf24"
            strokeWidth={2.5}
            points={netPoints.map((point) => `${point.x},${valueToY(point.y)}`).join(" ")}
            className="line-connector"
          />
        )}
        {netPoints.map((point) => (
          <g key={point.x}>
            <circle cx={point.x} cy={valueToY(point.y)} r={4} className="line-dot line-dot--amber" />
            <title>{`${point.label}: Net ${formatNumber(point.value)}`}</title>
          </g>
        ))}

        {data.map((entry, idx) => {
          const labelX = margin.left + idx * barGroupWidth + barGroupWidth / 2;
          return (
            <text key={`label-${entry.id}`} x={labelX} y={height - margin.bottom + 22} className="chart-date-label" textAnchor="middle">
              {entry.label}
            </text>
          );
        })}

          <text x={chartWidth / 2} y={height - 14} className="chart-axis-title" textAnchor="middle">
          Datum
        </text>
        <text x={-height / 2} y={18} transform="rotate(-90)" className="chart-axis-title" textAnchor="middle">
          Anzahl Tasks
        </text>
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
    const [view, setView] = useState<FlowView>("30d");
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

    const filteredFlow = useMemo<DailyFlow[]>(() => {
      if (!stats) return [];
      const today = new Date();
      const daily = stats.daily_flow;

      if (view === "previous-years") {
        return daily.filter((entry) => new Date(entry.date).getFullYear() < today.getFullYear());
      }

      if (view === "ytd") {
        const startOfYear = new Date(today.getFullYear(), 0, 1);
        return daily.filter((entry) => new Date(entry.date) >= startOfYear);
      }

      const daysLookup: Record<Exclude<FlowView, "ytd" | "previous-years">, number> = {
        "7d": 7,
        "14d": 14,
        "30d": 30,
        "60d": 60,
        "90d": 90,
      };
      const days = daysLookup[view] || 30;
      const cutoff = new Date(today);
      cutoff.setDate(today.getDate() - days);
      return daily.filter((entry) => new Date(entry.date) >= cutoff);
    }, [stats, view]);

    const periodTotals = useMemo(() => {
      return filteredFlow.reduce(
        (acc, entry) => {
          acc.created += entry.created;
          acc.completed += entry.completed;
          return acc;
        },
        { created: 0, completed: 0 },
      );
    }, [filteredFlow]);

    const buildChartData = useMemo(() => {
      return (flow: FlowEntry[], currentView: FlowView): FlowChartDatum[] => {
        if (!flow.length) return [];

        if (currentView === "7d" || currentView === "14d") {
          return flow.map((entry) => ({
            id: entry.date,
            label: formatDateLabel(entry.date),
            tooltipLabel: new Date(entry.date).toLocaleDateString("de-DE", {
              weekday: "short",
              day: "numeric",
              month: "long",
              year: "numeric",
            }),
            created: entry.created,
            completed: entry.completed,
          }));
        }

      if (currentView === "previous-years") {
        return groupFlowByMonth(flow);
      }

      if (currentView === "ytd") {
        return groupFlowByMonth(flow);
      }

      return groupFlowByWeek(flow);
    };
  }, []);

    const chartData = useMemo<FlowChartDatum[]>(() => buildChartData(filteredFlow, view), [buildChartData, filteredFlow, view]);
    const minutesFlow = useMemo<FlowEntry[]>(
      () =>
        filteredFlow.map((entry) => ({
          date: entry.date,
          created: entry.created_minutes ?? 0,
          completed: entry.completed_minutes ?? 0,
        })),
      [filteredFlow],
    );
    const minutesChartData = useMemo<FlowChartDatum[]>(() => buildChartData(minutesFlow, view), [buildChartData, minutesFlow, view]);

    const netFlowValue = periodTotals.created - periodTotals.completed;
    const netFlowClass = netFlowValue <= 0 ? "text-green" : "text-red";

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
    const activeHeatmapColor = heatmapMode === "created" ? "#ef4444" : "#4ade80";
    const hasHeatmapData = creationHeatmap.length > 0 || completionHeatmap.length > 0;
    const periodLabel = flowViewLabels[view];

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
          {flowViewOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`chip ${view === option.key ? "is-active" : ""}`.trim()}
              onClick={() => setView(option.key)}
            >
              {option.label}
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
            <div className="metric-split">
              <div>
                <div className="metric-sub">Tatsächlich offen</div>
                <div className="metric-value">{formatNumber(stats.summary.open_active)}</div>
              </div>
              <div>
                <div className="metric-sub">Extern (Outbound)</div>
                <div className="metric-value">{formatNumber(stats.summary.open_outbound)}</div>
              </div>
            </div>
            <div className="metric-sub">
              Gesamt: {formatNumber(stats.summary.open_active + stats.summary.open_outbound)}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Erledigt ({periodLabel})</div>
            <div className="metric-value text-green">{formatNumber(periodTotals.completed)}</div>
            <div className="metric-sub">Gesamt: {formatNumber(stats.summary.completed)}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Erstellt ({periodLabel})</div>
            <div className="metric-value text-red">{formatNumber(periodTotals.created)}</div>
            <div className="metric-sub">Gesamt: {formatNumber(stats.summary.created)}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Aktueller Net-Flow</div>
            <div className={`metric-value ${netFlowClass}`.trim()}>{formatNumber(netFlowValue)}</div>
            <div className="metric-sub">Ansicht: {periodLabel}</div>
          </div>
        </div>
      )}

      {(chartData.length > 0 || minutesChartData.length > 0) && (
        <div className="chart-row">
          {chartData.length > 0 && (
            <div className="chart-panel">
              <div className="chart-panel__header">
                <div>
                  <div className="muted small">Inflow vs. Done</div>
                  <h4 className="chart-title">Durchsatz &amp; Net-Flow</h4>
                </div>
                <div className="legend">
                  <span className="legend-dot legend-dot--green" /> Done
                  <span className="legend-dot legend-dot--red" /> Created
                  <span className="legend-dot legend-dot--amber" /> Net-Flow (kumuliert)
                </div>
              </div>
              <CombinedFlowChart data={chartData} />
            </div>
          )}

          {minutesChartData.length > 0 && (
            <div className="chart-panel">
              <div className="chart-panel__header">
                <div>
                  <div className="muted small">Inflow vs. Done (Minuten)</div>
                  <h4 className="chart-title">Geschätzter Aufwand &amp; Net-Flow</h4>
                </div>
                <div className="legend">
                  <span className="legend-dot legend-dot--green" /> Done (Minuten)
                  <span className="legend-dot legend-dot--red" /> Created (Minuten)
                  <span className="legend-dot legend-dot--amber" /> Net-Flow (Minuten, kumuliert)
                </div>
              </div>
              <CombinedFlowChart data={minutesChartData} />
            </div>
          )}
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
