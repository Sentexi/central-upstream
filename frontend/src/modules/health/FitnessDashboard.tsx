import { useEffect, useMemo, useState } from "react";
import { GlassCard } from "../../core/GlassCard";
import { fetchFitness } from "./api";
import type { DailyFitness, FitnessPayload, TrafficLight, WeeklyFitness } from "./types";

const rangeOptions: { key: "today" | "7d" | "14d" | "30d"; label: string }[] = [
  { key: "today", label: "Heute" },
  { key: "7d", label: "7 Tage" },
  { key: "14d", label: "14 Tage" },
  { key: "30d", label: "30 Tage" },
];

const lightColors: Record<TrafficLight, string> = {
  green: "#22c55e",
  yellow: "#fbbf24",
  red: "#f87171",
};

function formatNumber(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return value.toLocaleString("de-DE", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function TrafficBadge({ color, label }: { color: TrafficLight; label: string }) {
  return (
    <span className="pill" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background: lightColors[color],
          boxShadow: `0 0 0 4px ${lightColors[color]}1a`,
        }}
      />
      {label}
    </span>
  );
}

function SummaryCard({
  title,
  value,
  subtitle,
  color,
}: {
  title: string;
  value: string;
  subtitle?: string;
  color: TrafficLight;
}) {
  return (
    <div className="metric-card" aria-label={title}>
      <div className="metric-label">{title}</div>
      <div className="metric-value">{value}</div>
      {subtitle && <div className="metric-sub">{subtitle}</div>}
      <TrafficBadge color={color} label={{ green: "grün", yellow: "gelb", red: "rot" }[color]} />
    </div>
  );
}

type BarDatum = { label: string; primary: number; secondary?: number; tooltip?: string };

function SimpleBarChart({
  data,
  title,
  primaryLabel,
  secondaryLabel,
  primaryColor = "#60a5fa",
  secondaryColor = "#a78bfa",
}: {
  data: BarDatum[];
  title: string;
  primaryLabel: string;
  secondaryLabel?: string;
  primaryColor?: string;
  secondaryColor?: string;
}) {
  if (!data.length) {
    return <div className="chart-shell">Keine Daten im Zeitraum.</div>;
  }

  const height = 220;
  const margin = { top: 24, right: 12, bottom: 48, left: 46 };
  const maxPrimary = Math.max(...data.map((d) => d.primary), 0);
  const maxSecondary = Math.max(...data.map((d) => d.secondary || 0), 0);
  const maxValue = Math.max(maxPrimary, maxSecondary, 1);
  const groupWidth = secondaryLabel ? 44 : 28;
  const chartWidth = Math.max(data.length * groupWidth + margin.left + margin.right, 420);
  const innerHeight = height - margin.top - margin.bottom;

  const toY = (value: number) => margin.top + innerHeight - (value / maxValue) * innerHeight;

  return (
    <div className="chart-shell chart-shell--centered" style={{ minHeight: height }}>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${chartWidth} ${height}`}
        role="img"
        aria-label={title}
        style={{ minWidth: chartWidth }}
      >
        <line x1={margin.left} x2={chartWidth - margin.right} y1={height - margin.bottom} y2={height - margin.bottom} className="chart-axis" />
        <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} className="chart-axis" />

        {data.map((entry, idx) => {
          const baseX = margin.left + idx * groupWidth;
          const primaryHeight = innerHeight * (entry.primary / maxValue);
          const primaryY = height - margin.bottom - primaryHeight;
          const secondaryHeight = secondaryLabel ? innerHeight * ((entry.secondary || 0) / maxValue) : 0;
          const secondaryY = height - margin.bottom - secondaryHeight;
          return (
            <g key={entry.label}>
              <rect
                x={baseX + (secondaryLabel ? 2 : 6)}
                width={secondaryLabel ? 14 : 16}
                y={primaryY}
                height={primaryHeight}
                rx={4}
                className="bar bar--blue"
                fill={primaryColor}
              />
              {secondaryLabel && (
                <rect
                  x={baseX + 20}
                  width={14}
                  y={secondaryY}
                  height={secondaryHeight}
                  rx={4}
                  className="bar bar--green"
                  fill={secondaryColor}
                />
              )}
              <text x={baseX + groupWidth / 2} y={height - margin.bottom + 18} className="chart-date-label" textAnchor="middle">
                {entry.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="legend" aria-hidden>
        <div className="pill" style={{ borderColor: "transparent", background: "rgba(255,255,255,0.04)" }}>
          <span className="dot" style={{ background: primaryColor }} /> {primaryLabel}
        </div>
        {secondaryLabel && (
          <div className="pill" style={{ borderColor: "transparent", background: "rgba(255,255,255,0.04)" }}>
            <span className="dot" style={{ background: secondaryColor }} /> {secondaryLabel}
          </div>
        )}
      </div>
    </div>
  );
}

type LineDatum = { label: string; primary: number | null; secondary?: number | null };

function TrendLineChart({
  data,
  title,
  primaryLabel,
  secondaryLabel,
  primaryColor = "#a78bfa",
  secondaryColor = "#60a5fa",
}: {
  data: LineDatum[];
  title: string;
  primaryLabel: string;
  secondaryLabel?: string;
  primaryColor?: string;
  secondaryColor?: string;
}) {
  const filtered = data.filter((d) => d.primary !== null || d.secondary !== null);
  if (!filtered.length) {
    return <div className="chart-shell">Keine Daten im Zeitraum.</div>;
  }

  const height = 220;
  const margin = { top: 24, right: 12, bottom: 48, left: 46 };
  const values = filtered.flatMap((d) => [d.primary ?? null, d.secondary ?? null]).filter((v): v is number => v !== null);
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values, 0);
  const span = Math.max(maxValue - minValue, 1);
  const chartWidth = Math.max(data.length * 36 + margin.left + margin.right, 420);
  const innerHeight = height - margin.top - margin.bottom;

  const toY = (value: number) => margin.top + innerHeight - ((value - minValue) / span) * innerHeight;
  const toX = (idx: number) => margin.left + idx * 36 + 12;

  const linePath = (series: (number | null | undefined)[]) =>
    series
      .map((value, idx) => (value === null || value === undefined ? null : `${toX(idx)},${toY(value)}`))
      .filter(Boolean)
      .join(" L ");

  const primaryPath = linePath(data.map((d) => d.primary));
  const secondaryPath = secondaryLabel ? linePath(data.map((d) => d.secondary)) : "";

  return (
    <div className="chart-shell chart-shell--centered" style={{ minHeight: height }}>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${chartWidth} ${height}`}
        role="img"
        aria-label={title}
        style={{ minWidth: chartWidth }}
      >
        <line x1={margin.left} x2={chartWidth - margin.right} y1={height - margin.bottom} y2={height - margin.bottom} className="chart-axis" />
        <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} className="chart-axis" />

        {secondaryLabel && secondaryPath && (
          <path d={`M ${secondaryPath}`} fill="none" stroke={secondaryColor} strokeWidth={2} className="line-connector" />
        )}
        {primaryPath && (
          <path d={`M ${primaryPath}`} fill="none" stroke={primaryColor} strokeWidth={2.4} className="line-connector" />
        )}

        {data.map((entry, idx) => {
          const x = toX(idx);
          return (
            <g key={entry.label}>
              {entry.secondary !== null && entry.secondary !== undefined && (
                <circle cx={x} cy={toY(entry.secondary)} r={4} className="line-dot line-dot--amber" fill={secondaryColor} />
              )}
              {entry.primary !== null && entry.primary !== undefined && (
                <circle cx={x} cy={toY(entry.primary)} r={4} className="line-dot" fill={primaryColor} />
              )}
              <text x={x} y={height - margin.bottom + 18} className="chart-date-label" textAnchor="middle">
                {entry.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="legend" aria-hidden>
        <div className="pill" style={{ borderColor: "transparent", background: "rgba(255,255,255,0.04)" }}>
          <span className="dot" style={{ background: primaryColor }} /> {primaryLabel}
        </div>
        {secondaryLabel && (
          <div className="pill" style={{ borderColor: "transparent", background: "rgba(255,255,255,0.04)" }}>
            <span className="dot" style={{ background: secondaryColor }} /> {secondaryLabel}
          </div>
        )}
      </div>
    </div>
  );
}

function formatDateLabel(value: string) {
  const d = new Date(value);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "short" });
}

function formatWeekLabel(week: WeeklyFitness) {
  const start = new Date(week.week_start);
  const end = new Date(week.week_end);
  const startLabel = start.toLocaleDateString("de-DE", { day: "2-digit", month: "short" });
  const endLabel = end.toLocaleDateString("de-DE", { day: "2-digit", month: "short" });
  return `${startLabel}–${endLabel}`;
}

export function FitnessDashboard() {
  const [range, setRange] = useState<(typeof rangeOptions)[number]["key"]>("7d");
  const [group, setGroup] = useState<"daily" | "weekly">("daily");
  const [data, setData] = useState<FitnessPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchFitness(range, group)
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [range, group]);

  const activeRangeDaily: DailyFitness[] = useMemo(() => data?.daily ?? [], [data]);
  const activeWeekly: WeeklyFitness[] = useMemo(() => data?.weekly ?? [], [data]);

  const exerciseData: BarDatum[] = useMemo(() => {
    if (group === "weekly") {
      return activeWeekly.map((w) => ({
        label: formatWeekLabel(w),
        primary: w.exercise_min_week,
        secondary: w.active_kcal_week,
      }));
    }
    return activeRangeDaily.map((d) => ({ label: formatDateLabel(d.date), primary: d.exercise_min, secondary: d.active_kcal }));
  }, [activeRangeDaily, activeWeekly, group]);

  const stepsData: BarDatum[] = useMemo(() => {
    if (group === "weekly") {
      return activeWeekly.map((w) => ({
        label: formatWeekLabel(w),
        primary: w.steps_week,
        secondary: w.distance_km_week,
      }));
    }
    return activeRangeDaily.map((d) => ({ label: formatDateLabel(d.date), primary: d.steps, secondary: d.distance_km }));
  }, [activeRangeDaily, activeWeekly, group]);

  const loadData: BarDatum[] = useMemo(() => {
    if (group === "weekly") {
      return activeWeekly.map((w) => ({
        label: formatWeekLabel(w),
        primary: w.active_kcal_week,
        secondary: w.floors_week,
      }));
    }
    return activeRangeDaily.map((d) => ({ label: formatDateLabel(d.date), primary: d.active_kcal, secondary: d.floors }));
  }, [activeRangeDaily, activeWeekly, group]);

  const efficiencyTrend: LineDatum[] = useMemo(() => {
    if (group === "weekly") {
      return activeWeekly.map((w) => ({
        label: formatWeekLabel(w),
        primary: w.efficiency_index_median,
        secondary: w.walking_speed_avg,
      }));
    }
    return activeRangeDaily.map((d) => ({ label: formatDateLabel(d.date), primary: d.efficiency_index ?? null, secondary: d.walking_speed }));
  }, [activeRangeDaily, activeWeekly, group]);

  const weeklyVolume = data?.summaries.volume.current_week;

  return (
    <GlassCard className="notion-dashboard-card" glow>
      <div className="card-header" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div className="kicker">Health</div>
          <h3 className="card-title" style={{ margin: "4px 0" }}>
            Fitness Dashboard
          </h3>
          <p className="card-description">Weekly Volume, Consistency & Efficiency – ohne Today-Readiness.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {rangeOptions.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`chip ${range === opt.key ? "is-active" : ""}`.trim()}
              onClick={() => setRange(opt.key)}
            >
              {opt.label}
            </button>
          ))}
          <button
            type="button"
            className={`chip chip-ghost ${group === "daily" ? "is-active" : ""}`.trim()}
            onClick={() => setGroup("daily")}
          >
            Daily
          </button>
          <button
            type="button"
            className={`chip chip-ghost ${group === "weekly" ? "is-active" : ""}`.trim()}
            onClick={() => setGroup("weekly")}
          >
            Weekly
          </button>
        </div>
      </div>

      {loading && <p className="card-description">Fitness-Daten werden geladen...</p>}
      {error && <p className="card-description text-red">{error}</p>}

      {data && (
        <div className="stack" style={{ display: "grid", gap: 12 }}>
          <div className="dashboard-grid">
            <SummaryCard
              title="Weekly Volume"
              color={data.summaries.volume.color}
              value={weeklyVolume ? `${formatNumber(weeklyVolume.exercise_min_week, 0)} min` : "–"}
              subtitle={
                weeklyVolume
                  ? `${formatNumber(weeklyVolume.distance_km_week, 1)} km • ${formatNumber(weeklyVolume.steps_week, 0)} Schritte`
                  : "Warte auf Wochenwerte"
              }
            />
            <SummaryCard
              title="Consistency"
              color={data.summaries.consistency.color}
              value={`${data.summaries.consistency.active_days}/${data.summaries.consistency.range_days} aktive Tage`}
              subtitle={`Streak ${data.summaries.consistency.current_streak} • Max ${data.summaries.consistency.longest_streak}`}
            />
            <SummaryCard
              title="Distance / Steps"
              color={data.summaries.distance.color}
              value={`${formatNumber(data.summaries.distance.distance_km, 1)} km`}
              subtitle={`${formatNumber(data.summaries.distance.steps, 0)} Schritte im Range`}
            />
            <SummaryCard
              title="Efficiency Proxy"
              color={data.summaries.efficiency.color}
              value={
                data.summaries.efficiency.change === null
                  ? "Trend"
                  : `${(data.summaries.efficiency.change * 100).toFixed(1)}%`
              }
              subtitle={{ improving: "besser", declining: "schwächer", stable: "stabil" }[data.summaries.efficiency.direction]}
            />
            <SummaryCard
              title="Mobility"
              color={data.summaries.mobility.color}
              value={{ improving: "▲", declining: "▼", stable: "→" }[data.summaries.mobility.direction]}
              subtitle="Gang-Metrik Trend"
            />
          </div>

          <div className="chart-row">
            <div className="chart-panel">
              <div className="chart-panel__header">
                <h4 className="chart-title">Exercise-Minuten &amp; Active kcal</h4>
              </div>
              <SimpleBarChart data={exerciseData} title="Exercise" primaryLabel="Exercise-Minuten" secondaryLabel="Active kcal" />
            </div>
            <div className="chart-panel">
              <div className="chart-panel__header">
                <h4 className="chart-title">Schritte &amp; Distanz</h4>
              </div>
              <SimpleBarChart data={stepsData} title="Steps" primaryLabel="Schritte" secondaryLabel="Distanz (km)" primaryColor="#34d399" secondaryColor="#60a5fa" />
            </div>
          </div>

          <div className="chart-row">
            <div className="chart-panel">
              <div className="chart-panel__header">
                <h4 className="chart-title">Active kcal &amp; Floors</h4>
              </div>
              <SimpleBarChart data={loadData} title="Load" primaryLabel="Active kcal" secondaryLabel="Floors" primaryColor="#fbbf24" secondaryColor="#a3e635" />
            </div>
            <div className="chart-panel">
              <div className="chart-panel__header">
                <h4 className="chart-title">Efficiency &amp; Walking Speed</h4>
              </div>
              <TrendLineChart data={efficiencyTrend} title="Efficiency" primaryLabel="HR/Speed Index" secondaryLabel="Walking Speed" />
            </div>
          </div>

          <div>
            <h4 className="chart-title" style={{ marginBottom: 6 }}>
              Progress Notes
            </h4>
            {data.notes.length === 0 && <p className="card-description">Keine Datenpunkte im Zeitraum.</p>}
            <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-muted)" }}>
              {data.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </GlassCard>
  );
}
