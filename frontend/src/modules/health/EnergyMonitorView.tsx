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

function formatDuration(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return "–";
  const totalMinutes = Math.round(value * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

function generateTicks(minValue: number, maxValue: number, count = 4) {
  if (count < 2) return [maxValue];

  if (minValue === maxValue) {
    const wiggle = minValue === 0 ? 1 : Math.abs(minValue) * 0.25;
    minValue -= wiggle;
    maxValue += wiggle;
  }

  const span = maxValue - minValue || 1;
  const roughStep = span / (count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(roughStep, 1)));
  const step = Math.ceil(roughStep / magnitude) * magnitude;
  const start = Math.floor(minValue / step) * step;
  const end = Math.ceil(maxValue / step) * step;

  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }

  return ticks;
}

function formatTickLabel(value: number) {
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(2);
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

function BaselineBar({
  value,
  baseline,
  min,
  max,
  unit,
}: {
  value?: number | null;
  baseline?: number | null;
  min?: number | null;
  max?: number | null;
  unit?: string;
}) {
  if (min === undefined || max === undefined || min === null || max === null) return null;
  if (max <= min) return null;

  const span = max - min;
  const clamp = (v: number) => Math.min(Math.max(v, min), max);
  const baselinePct = baseline === undefined || baseline === null ? null : ((clamp(baseline) - min) / span) * 100;
  const valuePct = value === undefined || value === null ? null : ((clamp(value) - min) / span) * 100;

  return (
    <div className="baseline-bar" role="presentation">
      <div className="baseline-bar__track">
        <div className="baseline-bar__range" />
        {baselinePct !== null && (
          <div
            className="baseline-bar__marker"
            style={{ left: `${baselinePct}%` }}
            title={`Baseline ${formatValue(baseline)}`}
          />
        )}
        {valuePct !== null && (
          <div
            className="baseline-bar__value"
            style={{ left: `${valuePct}%` }}
            title={`Aktuell ${formatValue(value)}${unit ? ` ${unit}` : ""}`}
          />
        )}
      </div>
      <div className="baseline-bar__labels">
        <span>Low: {formatValue(min)}</span>
        <span>Baseline: {baselinePct !== null ? formatValue(baseline) : "–"}</span>
        <span>High: {formatValue(max)}</span>
      </div>
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
  displayValue,
  baseline,
  rangeMin,
  rangeMax,
}: {
  title: string;
  value?: number | null;
  unit?: string;
  delta?: string;
  color?: string;
  score?: number;
  detail?: string;
  displayValue?: string | null;
  baseline?: number | null;
  rangeMin?: number | null;
  rangeMax?: number | null;
}) {
  const hasRange =
    rangeMin !== undefined &&
    rangeMax !== undefined &&
    rangeMin !== null &&
    rangeMax !== null &&
    rangeMax > rangeMin;

  return (
    <GlassCard className="energy-tile">
      <div className="tile-header">
        <div className="kicker">{title}</div>
        <Barometer color={color} score={score} />
      </div>
      <div className="tile-body">
        <div className="tile-value">
          <span>{displayValue ?? formatValue(value)}</span>
          {unit ? <span className="unit">{unit}</span> : null}
        </div>
        <div className="tile-delta">{delta ?? "–"}</div>
        {detail ? <div className="tile-detail">{detail}</div> : null}
        {hasRange ? (
          <BaselineBar value={value} baseline={baseline} min={rangeMin ?? undefined} max={rangeMax ?? undefined} unit={unit} />
        ) : null}
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
  const sortedData = [...data].sort((a, b) => a.date.localeCompare(b.date));

  const filtered = sortedData.map((d) => d.value).filter((v) => v !== null) as number[];
  const min = filtered.length ? Math.min(...filtered) : 0;
  const max = filtered.length ? Math.max(...filtered) : 1;
  const padding = (max - min) * 0.1 + 1;
  const height = 220;
  const width = Math.max(360, sortedData.length * 36);
  const margin = { top: 20, right: 24, bottom: 26, left: 48 };
  const step = (width - margin.left - margin.right) / Math.max(sortedData.length - 1, 1);

  const domainMin = min - padding;
  const domainMax = max + padding;
  const yTicks = generateTicks(domainMin, domainMax, 5);
  const xTickCount = Math.min(5, sortedData.length || 1);
  const xTickStep =
    xTickCount > 1 ? Math.max(1, Math.floor((sortedData.length - 1) / (xTickCount - 1))) : 1;
  const xTickIndices = Array.from({ length: sortedData.length }, (_, idx) => idx).filter(
    (idx) => idx % xTickStep === 0 || idx === sortedData.length - 1
  );

  const scaleY = (value: number) => {
    const range = domainMax - domainMin || 1;
    const relative = (value - domainMin) / range;
    return margin.top + (1 - relative) * (height - margin.top - margin.bottom);
  };

  const points = sortedData
    .map((d, idx) =>
      d.value === null
        ? null
        : {
            x: margin.left + idx * step,
            y: scaleY(d.value),
            idx,
          }
    )
    .filter((p): p is { x: number; y: number; idx: number } => Boolean(p));

  const path = buildPath(points.map(({ x, y }) => ({ x, y })));

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
          {yTicks.map((tick) => {
            const y = scaleY(tick);
            return (
              <g key={tick}>
                <line x1={margin.left} x2={width - margin.right} y1={y} y2={y} className="chart-grid" />
                <text x={margin.left - 10} y={y + 4} className="chart-tick-label" textAnchor="end">
                  {formatTickLabel(tick)}
                </text>
              </g>
            );
          })}
          <path d={path} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
          {points.map((p) => (
            <g key={sortedData[p.idx].date}>
              <circle cx={p.x} cy={p.y} r={3} fill={color} />
              <title>
                {sortedData[p.idx].date}: {formatValue(sortedData[p.idx].value)}
                {unit ? ` ${unit}` : ""}
              </title>
            </g>
          ))}
          <line
            x1={margin.left}
            x2={width - margin.right}
            y1={height - margin.bottom}
            y2={height - margin.bottom}
            className="chart-axis"
          />
          <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} className="chart-axis" />
          {xTickIndices.map((idx) => {
            const x = margin.left + idx * step;
            return (
              <g key={sortedData[idx].date + idx}>
                <line x1={x} x2={x} y1={height - margin.bottom} y2={height - margin.bottom + 4} className="chart-axis" />
                <text x={x} y={height - 6} className="chart-tick-label" textAnchor="middle">
                  {sortedData[idx].date}
                </text>
              </g>
            );
          })}
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
  const margin = { top: 20, right: 56, bottom: 26, left: 52 };
  const stepWidth = (width - margin.left - margin.right) / Math.max(data.length, 1);
  const innerHeight = height - margin.top - margin.bottom - 40;

  const yTicks = generateTicks(0, maxSteps, 5);
  const exerciseTicks = generateTicks(0, maxExercise, 5);
  const xTickCount = Math.min(5, data.length || 1);
  const xTickStep = xTickCount > 1 ? Math.max(1, Math.floor((data.length - 1) / (xTickCount - 1))) : 1;
  const xTickIndices = Array.from({ length: data.length }, (_, idx) => idx).filter(
    (idx) => idx % xTickStep === 0 || idx === data.length - 1
  );

  const valueToY = (value: number) => height - margin.bottom - (value / maxSteps) * innerHeight;
  const exerciseToY = (value: number) => height - margin.bottom - (value / maxExercise) * innerHeight;

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
          {yTicks.map((tick) => {
            const y = valueToY(tick);
            return (
              <g key={`y-${tick}`}>
                <line x1={margin.left} x2={width - margin.right} y1={y} y2={y} className="chart-grid" />
                <text x={margin.left - 10} y={y + 4} className="chart-tick-label" textAnchor="end">
                  {formatTickLabel(tick)}
                </text>
              </g>
            );
          })}
          {exerciseTicks.map((tick) => {
            const y = exerciseToY(tick);
            return (
              <g key={`ex-${tick}`}>
                <line x1={margin.left} x2={width - margin.right} y1={y} y2={y} className="chart-grid" opacity={0.15} />
                <text x={width - margin.right + 6} y={y + 4} className="chart-tick-label" textAnchor="start">
                  {formatTickLabel(tick)}
                </text>
              </g>
            );
          })}
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
            const exHeight = height - margin.bottom - exerciseToY(d.exercise_min ?? 0);
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
                >
                  <title>
                    {d.date}: {formatValue(d.steps, 0)} Steps
                  </title>
                </rect>
                <rect
                  x={x + barWidth + 4}
                  y={height - margin.bottom - exHeight}
                  width={barWidth * 0.6}
                  height={exHeight}
                  fill="#22d3ee"
                  opacity={0.8}
                  rx={3}
                >
                  <title>
                    {d.date}: {formatValue(d.exercise_min, 0)} min Exercise
                  </title>
                </rect>
              </g>
            );
          })}
          {xTickIndices.map((idx) => {
            const x = margin.left + idx * stepWidth + stepWidth / 2;
            return (
              <g key={`x-${data[idx].date}-${idx}`}>
                <line x1={x} x2={x} y1={height - margin.bottom} y2={height - margin.bottom + 4} className="chart-axis" />
                <text x={x} y={height - 6} className="chart-tick-label" textAnchor="middle">
                  {data[idx].date}
                </text>
              </g>
            );
          })}
          <text x={margin.left} y={margin.top + 10} className="chart-tick-label" textAnchor="start">
            Steps (links)
          </text>
          <text x={width - margin.right} y={margin.top + 10} className="chart-tick-label" textAnchor="end">
            Exercise (rechts)
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
  const restingHeartRateSeries: MetricPoint[] =
    data?.series.rhr.map((point) => ({
      date: point.date,
      value: point.avg ?? point.value ?? null,
    })) ?? [];
  const sortedRestingHeartRateSeries = [...restingHeartRateSeries].sort((a, b) => a.date.localeCompare(b.date));
  const previousRestingHeartRate =
    sortedRestingHeartRateSeries.length > 1
      ? sortedRestingHeartRateSeries[sortedRestingHeartRateSeries.length - 2]?.value ?? null
      : null;
  const restingHeartRateValue = data?.tiles.rhr.avg ?? data?.tiles.rhr.value ?? previousRestingHeartRate;

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
              detail="Gewichtet: Schlaf 30%, HRV 45%, RHR 25%"
            />
            <SummaryTile
              title="Schlaf"
              value={data.tiles.sleep.value}
              displayValue={data.tiles.sleep.display_value ?? formatDuration(data.tiles.sleep.value)}
              unit={data.tiles.sleep.display_value ? undefined : data.tiles.sleep.unit}
              delta={data.tiles.sleep.delta_text}
              color={data.tiles.sleep.color}
              score={data.tiles.sleep.score}
              detail="66% diese Nacht, 33% letzte 3 Nächte"
            />
            <SummaryTile
              title="HRV"
              value={data.tiles.hrv.value}
              unit={data.tiles.hrv.unit}
              delta={data.tiles.hrv.delta_text}
              color={data.tiles.hrv.color}
              score={data.tiles.hrv.score}
              baseline={data.tiles.hrv.baseline}
              rangeMin={data.tiles.hrv.range_min}
              rangeMax={data.tiles.hrv.range_max}
            />
            <SummaryTile
              title="Ruhepuls"
              value={restingHeartRateValue}
              unit={data.tiles.rhr.unit}
              delta={data.tiles.rhr.delta_text}
              color={data.tiles.rhr.color}
              score={data.tiles.rhr.score}
              baseline={data.tiles.rhr.baseline}
              rangeMin={data.tiles.rhr.range_min}
              rangeMax={data.tiles.rhr.range_max}
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
            <LineChart data={restingHeartRateSeries} title="Ruhepuls" color="#a855f7" unit="bpm" />
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
