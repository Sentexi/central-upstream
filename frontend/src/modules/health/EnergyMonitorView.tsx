import { useEffect, useState } from "react";
import { GlassCard } from "../../core/GlassCard";
import type { RangeKey, EnergyMonitorResponse, MetricPoint, ActivityPoint } from "./api";
import { fetchEnergyMonitor } from "./api";

const ranges: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Heute" },
  { key: "7d", label: "7 Tage" },
  { key: "14d", label: "14 Tage" },
  { key: "30d", label: "30 Tage" },
];

function formatValue(value?: number | null, digits = 1) {
  if (value === undefined || value === null || Number.isNaN(value)) return "–";
  return Number(value).toFixed(digits);
}

function Barometer({ color, score }: { color?: string; score?: number }) {
  const safeColor = color ?? "gray";
  const clamped = Math.max(0, Math.min(score ?? 0, 100));
  return (
    <div className={`barometer barometer--${safeColor}`} aria-label={`Score ${clamped}`}> 
      <div className="barometer__track">
        <div className="barometer__fill" style={{ width: `${clamped}%` }} />
      </div>
      <span className="barometer__value">{clamped}</span>
    </div>
  );
}

function SummaryTile({
  title,
  value,
  unit,
  delta,
  color,
  score,
  detail,
}: {
  title: string;
  value?: number | null;
  unit?: string;
  delta?: string;
  color?: string;
  score?: number;
  detail?: string;
}) {
  return (
    <GlassCard className="energy-tile">
      <div className="tile-header">
        <div className="kicker">{title}</div>
        <Barometer color={color} score={score} />
      </div>
      <div className="tile-body">
        <div className="tile-value">
          <span>{formatValue(value)}</span>
          {unit ? <span className="unit">{unit}</span> : null}
        </div>
        <div className="tile-delta">{delta ?? "–"}</div>
        {detail ? <div className="tile-detail">{detail}</div> : null}
      </div>
    </GlassCard>
  );
}

function buildPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  return points
    .map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
}

function LineChart({
  data,
  title,
  color,
  unit,
}: {
  data: MetricPoint[];
  title: string;
  color: string;
  unit?: string;
}) {
  const filtered = data.map((d) => d.value).filter((v) => v !== null) as number[];
  const min = filtered.length ? Math.min(...filtered) : 0;
  const max = filtered.length ? Math.max(...filtered) : 1;
  const padding = (max - min) * 0.1 + 1;
  const height = 220;
  const width = Math.max(360, data.length * 36);
  const margin = { top: 20, right: 24, bottom: 26, left: 48 };
  const step = (width - margin.left - margin.right) / Math.max(data.length - 1, 1);

  const scaleY = (value: number) => {
    const range = max - min || 1;
    const relative = (value - (min - padding)) / (range + padding * 2);
    return margin.top + (1 - relative) * (height - margin.top - margin.bottom);
  };

  const points = data
    .map((d, idx) =>
      d.value === null
        ? null
        : {
            x: margin.left + idx * step,
            y: scaleY(d.value),
          }
    )
    .filter((p): p is { x: number; y: number } => Boolean(p));

  const path = buildPath(points);

  return (
    <GlassCard className="chart-panel">
      <div className="chart-panel__header">
        <div>
          <span className="kicker">Trend</span>
          <h4 className="chart-title">{title}</h4>
        </div>
        {unit ? <span className="pill">{unit}</span> : null}
      </div>
      <div className="chart-shell chart-shell--centered" style={{ minHeight: height }}>
        <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label={`${title} Chart`}>
          <defs>
            <linearGradient id={`grad-${title}`} x1="0%" x2="0%" y1="0%" y2="100%">
              <stop offset="0%" stopColor={color} stopOpacity="0.6" />
              <stop offset="100%" stopColor={color} stopOpacity="0.1" />
            </linearGradient>
          </defs>
          <rect
            x={margin.left}
            y={margin.top}
            width={width - margin.left - margin.right}
            height={height - margin.top - margin.bottom}
            fill="rgba(255,255,255,0.02)"
          />
          <path d={path} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
          {points.map((p, idx) => (
            <circle key={idx} cx={p.x} cy={p.y} r={3} fill={color} />
          ))}
          <line
            x1={margin.left}
            x2={width - margin.right}
            y1={height - margin.bottom}
            y2={height - margin.bottom}
            className="chart-axis"
          />
          <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} className="chart-axis" />
          <text x={width - margin.right} y={height - 6} className="chart-tick-label" textAnchor="end">
            {data.length > 0 ? data[data.length - 1].date : ""}
          </text>
          <text x={margin.left} y={height - 6} className="chart-tick-label" textAnchor="start">
            {data.length > 0 ? data[0].date : ""}
          </text>
        </svg>
      </div>
    </GlassCard>
  );
}

function ActivityChart({ data }: { data: ActivityPoint[] }) {
  const steps = data.map((d) => d.steps ?? 0);
  const exercise = data.map((d) => d.exercise_min ?? 0);
  const maxSteps = Math.max(...steps, 1);
  const maxExercise = Math.max(...exercise, 1);
  const height = 240;
  const width = Math.max(360, data.length * 36);
  const margin = { top: 20, right: 20, bottom: 26, left: 52 };
  const stepWidth = (width - margin.left - margin.right) / Math.max(data.length, 1);

  return (
    <GlassCard className="chart-panel">
      <div className="chart-panel__header">
        <div>
          <span className="kicker">Load</span>
          <h4 className="chart-title">Aktivität &amp; Bewegung</h4>
        </div>
        <div className="chart-controls" aria-hidden>
          <span className="pill">Steps</span>
          <span className="pill">Exercise</span>
        </div>
      </div>
      <div className="chart-shell chart-shell--centered" style={{ minHeight: height }}>
        <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label="Steps and exercise chart">
          <line
            x1={margin.left}
            x2={width - margin.right}
            y1={height - margin.bottom}
            y2={height - margin.bottom}
            className="chart-axis"
          />
          <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} className="chart-axis" />
          {data.map((d, idx) => {
            const barHeight = ((d.steps ?? 0) / maxSteps) * (height - margin.top - margin.bottom - 40);
            const exHeight = ((d.exercise_min ?? 0) / maxExercise) * 50;
            const x = margin.left + idx * stepWidth + stepWidth * 0.2;
            const barWidth = stepWidth * 0.45;
            return (
              <g key={d.date}>
                <rect
                  x={x}
                  y={height - margin.bottom - barHeight}
                  width={barWidth}
                  height={barHeight}
                  fill="var(--electric-blue)"
                  opacity={0.5}
                  rx={4}
                />
                <rect
                  x={x + barWidth + 4}
                  y={height - margin.bottom - exHeight}
                  width={barWidth * 0.6}
                  height={exHeight}
                  fill="#22d3ee"
                  opacity={0.8}
                  rx={3}
                />
              </g>
            );
          })}
          <text x={margin.left} y={margin.top + 10} className="chart-tick-label" textAnchor="start">
            Steps
          </text>
          <text x={margin.left + 80} y={margin.top + 30} className="chart-tick-label" textAnchor="start">
            Exercise
          </text>
        </svg>
      </div>
    </GlassCard>
  );
}

export function EnergyMonitorView() {
  const [range, setRange] = useState<RangeKey>("14d");
  const [data, setData] = useState<EnergyMonitorResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    fetchEnergyMonitor(range)
      .then((res) => {
        if (mounted) setData(res);
      })
      .catch((err) => {
        console.error(err);
        if (mounted) setError(err.message);
      })
      .finally(() => mounted && setLoading(false));

    return () => {
      mounted = false;
    };
  }, [range]);

  const readiness = data?.tiles.readiness.score ?? 0;
  const signals = data?.signals ?? [];

  return (
    <div className="app-grid">
      <header className="app-header">
        <span className="kicker">Health</span>
        <h1 className="title">Energy Monitor</h1>
        <p className="subtitle">Aggregierte Daily Metrics mit Readiness-Barometer.</p>
        <div className="chart-controls" role="group" aria-label="Zeitraum wählen">
          {ranges.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`pill ${range === item.key ? "pill--active" : ""}`.trim()}
              onClick={() => setRange(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <section className="stack">
        <div className="section-heading">Summary</div>
        {loading && (
          <GlassCard glow className="loader">
            <span className="kicker">Loading</span>
            <h3 className="card-title">Energy Monitor wird geladen...</h3>
            <p className="card-description">Robuste Tages-Metriken und Readiness-Score werden vorbereitet.</p>
          </GlassCard>
        )}
        {error && (
          <GlassCard className="error-card">
            <h3 className="card-title">Fehler</h3>
            <p className="card-description">{error}</p>
          </GlassCard>
        )}
        {data && !loading && (
          <div className="grid-cards summary-grid">
            <SummaryTile
              title="Readiness"
              value={data.tiles.readiness.score}
              unit="/100"
              delta={data.tiles.readiness.delta_text}
              color={data.tiles.readiness.color}
              score={data.tiles.readiness.score}
              detail="Gewichtet: Schlaf 40%, HRV 35%, RHR 25%"
            />
            <SummaryTile
              title="Schlaf"
              value={data.tiles.sleep.value}
              unit={data.tiles.sleep.unit}
              delta={data.tiles.sleep.delta_text}
              color={data.tiles.sleep.color}
              score={data.tiles.sleep.score}
            />
            <SummaryTile
              title="HRV"
              value={data.tiles.hrv.value}
              unit={data.tiles.hrv.unit}
              delta={data.tiles.hrv.delta_text}
              color={data.tiles.hrv.color}
              score={data.tiles.hrv.score}
            />
            <SummaryTile
              title="Ruhepuls"
              value={data.tiles.rhr.value}
              unit={data.tiles.rhr.unit}
              delta={data.tiles.rhr.delta_text}
              color={data.tiles.rhr.color}
              score={data.tiles.rhr.score}
            />
            <SummaryTile
              title="Load & Movement"
              value={data.tiles.load.steps ?? data.tiles.load.exercise_min}
              unit={data.tiles.load.steps ? "Steps" : "Min"}
              delta={data.tiles.load.delta_text}
              color={data.tiles.load.color}
              score={readiness}
              detail={`Steps: ${formatValue(data.tiles.load.steps, 0)} · Exercise: ${formatValue(
                data.tiles.load.exercise_min,
                0
              )}min`}
            />
          </div>
        )}
      </section>

      {data && !loading && (
        <section className="stack">
          <div className="section-heading">Trends</div>
          <div className="grid-cards charts-grid">
            <LineChart data={data.series.hrv} title="HRV" color="#67e8f9" unit="ms" />
            <LineChart data={data.series.rhr} title="Ruhepuls" color="#a855f7" unit="bpm" />
            <LineChart data={data.series.sleep_total} title="Schlafdauer" color="#38bdf8" unit="min" />
            <ActivityChart data={data.series.activity} />
          </div>
        </section>
      )}

      {data && (
        <section className="stack">
          <div className="section-heading">Signals</div>
          <GlassCard>
            <h4 className="card-title">Automatische Hinweise</h4>
            {signals.length === 0 ? (
              <p className="card-description">Alle Kernsignale liegen im Rahmen der Baseline.</p>
            ) : (
              <ul className="signal-list">
                {signals.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            )}
          </GlassCard>
        </section>
      )}
    </div>
  );
}
