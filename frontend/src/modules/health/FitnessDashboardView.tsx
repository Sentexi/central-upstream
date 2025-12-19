import { useEffect, useMemo, useState } from "react";
import { GlassCard } from "../../core/GlassCard";
import type {
  FitnessDashboardResponse,
  FitnessSeries,
  GroupKey,
  RangeKey,
} from "./api";
import { fetchFitnessDashboard } from "./api";

const ranges: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Heute" },
  { key: "7d", label: "7 Tage" },
  { key: "14d", label: "14 Tage" },
  { key: "30d", label: "30 Tage" },
];

const groups: { key: GroupKey; label: string }[] = [
  { key: "daily", label: "Täglich" },
  { key: "weekly", label: "Wöchentlich" },
];

function formatValue(value?: number | null, digits = 1) {
  if (value === undefined || value === null || Number.isNaN(value)) return "–";
  return Number(value).toFixed(digits);
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
  const clamped = Math.max(0, Math.min(score ?? 100, 100));
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
  primary,
  secondary,
  detail,
  barometerValue,
}: {
  title: string;
  primary: { value?: number | null; unit?: string; delta?: string; color?: string };
  secondary?: { value?: number | null; unit?: string } | null;
  detail?: string | null;
  barometerValue?: number;
}) {
  return (
    <GlassCard className="energy-tile">
      <div className="tile-header">
        <div className="kicker">{title}</div>
        <Barometer color={primary.color} score={barometerValue ?? (primary.value ? Math.min(100, primary.value) : 0)} />
      </div>
      <div className="tile-body">
        <div className="tile-value">
          <span>{formatValue(primary.value, 1)}</span>
          {primary.unit ? <span className="unit">{primary.unit}</span> : null}
        </div>
        <div className="tile-delta">{primary.delta ?? "–"}</div>
        {secondary && secondary.value !== undefined && secondary.value !== null ? (
          <div className="tile-detail">
            {formatValue(secondary.value, 0)} {secondary.unit ?? ""}
          </div>
        ) : null}
        {detail ? <div className="tile-detail">{detail}</div> : null}
      </div>
    </GlassCard>
  );
}

function SimpleBarChart({
  series,
  title,
  color = "var(--electric-blue)",
  unit,
}: {
  series: FitnessSeries[];
  title: string;
  color?: string;
  unit?: string;
}) {
  const values = series.map((d) => d.value ?? 0);
  const max = Math.max(...values, 1);
  const height = 240;
  const width = Math.max(360, series.length * 36);
  const margin = { top: 18, right: 16, bottom: 36, left: 52 };
  const innerHeight = height - margin.top - margin.bottom;
  const stepWidth = (width - margin.left - margin.right) / Math.max(series.length, 1);
  const yTicks = generateTicks(0, max, 5);
  const xTickCount = Math.min(5, series.length || 1);
  const xTickStep = xTickCount > 1 ? Math.max(1, Math.floor((series.length - 1) / (xTickCount - 1))) : 1;
  const xTickIndices = Array.from({ length: series.length }, (_, idx) => idx).filter(
    (idx) => idx % xTickStep === 0 || idx === series.length - 1
  );

  if (series.length === 0) {
    return (
      <GlassCard className="chart-panel">
        <div className="chart-panel__header">
          <div>
            <span className="kicker">Keine Daten</span>
            <h4 className="chart-title">{title}</h4>
          </div>
        </div>
        <p className="card-description">Keine Daten im Range.</p>
      </GlassCard>
    );
  }

  const valueToY = (value: number) => height - margin.bottom - (value / max) * innerHeight;

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
          <line
            x1={margin.left}
            x2={width - margin.right}
            y1={height - margin.bottom}
            y2={height - margin.bottom}
            className="chart-axis"
          />
          <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} className="chart-axis" />
          {series.map((d, idx) => {
            const barHeight = height - margin.bottom - valueToY(d.value ?? 0);
            const x = margin.left + idx * stepWidth + stepWidth * 0.15;
            const barWidth = stepWidth * 0.7;
            return (
              <g key={`${d.date}-${idx}`}>
                <rect
                  x={x}
                  y={height - margin.bottom - barHeight}
                  width={barWidth}
                  height={barHeight}
                  fill={color}
                  opacity={0.8}
                  rx={4}
                >
                  <title>
                    {d.label ?? d.date}: {formatValue(d.value)} {unit ?? ""}
                  </title>
                </rect>
              </g>
            );
          })}
          {xTickIndices.map((idx) => {
            const x = margin.left + idx * stepWidth + stepWidth / 2;
            return (
              <g key={`x-${idx}`}>
                <line x1={x} x2={x} y1={height - margin.bottom} y2={height - margin.bottom + 4} className="chart-axis" />
                <text x={x} y={height - 6} className="chart-tick-label" textAnchor="middle">
                  {series[idx].label ?? series[idx].date}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </GlassCard>
  );
}

function ComboChart({
  title,
  bars,
  line,
  barLabel,
  lineLabel,
  barColor = "var(--electric-blue)",
  lineColor = "#a855f7",
}: {
  title: string;
  bars: FitnessSeries[];
  line: FitnessSeries[];
  barLabel: string;
  lineLabel: string;
  barColor?: string;
  lineColor?: string;
}) {
  const series = bars.length > 0 ? bars : line;
  if (series.length === 0) {
    return (
      <GlassCard className="chart-panel">
        <div className="chart-panel__header">
          <div>
            <span className="kicker">Keine Daten</span>
            <h4 className="chart-title">{title}</h4>
          </div>
        </div>
        <p className="card-description">Keine Daten im Range.</p>
      </GlassCard>
    );
  }

  const labels = bars.map((d) => d.label ?? d.date);
  const allValues = [...bars, ...line].map((d) => d.value ?? 0);
  const maxValue = Math.max(...allValues, 1);
  const height = 260;
  const width = Math.max(380, series.length * 38);
  const margin = { top: 18, right: 56, bottom: 36, left: 52 };
  const innerHeight = height - margin.top - margin.bottom - 18;
  const stepWidth = (width - margin.left - margin.right) / Math.max(series.length, 1);
  const yTicks = generateTicks(0, maxValue, 5);

  const xTickCount = Math.min(5, series.length || 1);
  const xTickStep = xTickCount > 1 ? Math.max(1, Math.floor((series.length - 1) / (xTickCount - 1))) : 1;
  const xTickIndices = Array.from({ length: series.length }, (_, idx) => idx).filter(
    (idx) => idx % xTickStep === 0 || idx === series.length - 1
  );

  const valueToY = (value: number) => height - margin.bottom - (value / maxValue) * innerHeight;

  return (
    <GlassCard className="chart-panel">
      <div className="chart-panel__header">
        <div>
          <span className="kicker">Trend</span>
          <h4 className="chart-title">{title}</h4>
        </div>
        <div className="chart-controls" aria-hidden>
          <span className="pill">{barLabel}</span>
          <span className="pill">{lineLabel}</span>
        </div>
      </div>
      <div className="chart-shell chart-shell--centered" style={{ minHeight: height }}>
        <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label={`${title} Chart`}>
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
          <line
            x1={margin.left}
            x2={width - margin.right}
            y1={height - margin.bottom}
            y2={height - margin.bottom}
            className="chart-axis"
          />
          <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} className="chart-axis" />
          {bars.map((d, idx) => {
            const barHeight = height - margin.bottom - valueToY(d.value ?? 0);
            const x = margin.left + idx * stepWidth + stepWidth * 0.18;
            const barWidth = stepWidth * 0.5;
            return (
              <rect
                key={`bar-${d.date}-${idx}`}
                x={x}
                y={height - margin.bottom - barHeight}
                width={barWidth}
                height={barHeight}
                fill={barColor}
                opacity={0.65}
                rx={4}
              >
                <title>
                  {labels[idx]}: {formatValue(d.value)}
                </title>
              </rect>
            );
          })}

          {line.map((d, idx) => {
            const x = margin.left + idx * stepWidth + stepWidth * 0.5;
            const y = valueToY(d.value ?? 0);
            const next = line[idx + 1];
            if (!next) {
              return (
                <g key={`line-${d.date}-${idx}`}>
                  <circle cx={x} cy={y} r={3} fill={lineColor} />
                </g>
              );
            }
            const nextX = margin.left + (idx + 1) * stepWidth + stepWidth * 0.5;
            const nextY = valueToY(next.value ?? 0);
            return (
              <g key={`line-${d.date}-${idx}`}>
                <line x1={x} x2={nextX} y1={y} y2={nextY} stroke={lineColor} strokeWidth={2} />
                <circle cx={x} cy={y} r={3} fill={lineColor} />
              </g>
            );
          })}

          {xTickIndices.map((idx) => {
            const x = margin.left + idx * stepWidth + stepWidth / 2;
            return (
              <g key={`x-${idx}`}>
                <line x1={x} x2={x} y1={height - margin.bottom} y2={height - margin.bottom + 4} className="chart-axis" />
                <text x={x} y={height - 6} className="chart-tick-label" textAnchor="middle">
                  {labels[idx]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </GlassCard>
  );
}

function EfficiencyChart({
  efficiency,
  stairsUp,
  stairsDown,
}: {
  efficiency: FitnessSeries[];
  stairsUp: FitnessSeries[];
  stairsDown: FitnessSeries[];
}) {
  const labels = efficiency.map((d) => d.label ?? d.date);
  const labelIndex = new Map(labels.map((label, idx) => [label, idx]));
  if (efficiency.length === 0) {
    return (
      <GlassCard className="chart-panel">
        <div className="chart-panel__header">
          <div>
            <span className="kicker">Keine Daten</span>
            <h4 className="chart-title">Efficiency &amp; Mobility</h4>
          </div>
        </div>
        <p className="card-description">Keine Daten im Range.</p>
      </GlassCard>
    );
  }

  const values = efficiency.map((d) => d.value ?? 0);
  const maxValue = Math.max(...values, 1);
  const height = 260;
  const width = Math.max(380, efficiency.length * 38);
  const margin = { top: 18, right: 16, bottom: 36, left: 52 };
  const innerHeight = height - margin.top - margin.bottom - 18;
  const stepWidth = (width - margin.left - margin.right) / Math.max(efficiency.length, 1);
  const yTicks = generateTicks(0, maxValue, 5);

  const xTickCount = Math.min(5, efficiency.length || 1);
  const xTickStep = xTickCount > 1 ? Math.max(1, Math.floor((efficiency.length - 1) / (xTickCount - 1))) : 1;
  const xTickIndices = Array.from({ length: efficiency.length }, (_, idx) => idx).filter(
    (idx) => idx % xTickStep === 0 || idx === efficiency.length - 1
  );

  const valueToY = (value: number) => height - margin.bottom - (value / maxValue) * innerHeight;

  return (
    <GlassCard className="chart-panel">
      <div className="chart-panel__header">
        <div>
          <span className="kicker">Efficiency</span>
          <h4 className="chart-title">Efficiency &amp; Mobility</h4>
        </div>
        <div className="chart-controls" aria-hidden>
          <span className="pill">HR/Speed</span>
          <span className="pill">Stairs</span>
        </div>
      </div>
      <div className="chart-shell chart-shell--centered" style={{ minHeight: height }}>
        <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label="Efficiency Chart">
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
          <line
            x1={margin.left}
            x2={width - margin.right}
            y1={height - margin.bottom}
            y2={height - margin.bottom}
            className="chart-axis"
          />
          <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} className="chart-axis" />

          {efficiency.map((d, idx) => {
            const x = margin.left + idx * stepWidth + stepWidth * 0.5;
            const y = valueToY(d.value ?? 0);
            const next = efficiency[idx + 1];
            if (next) {
              const nextX = margin.left + (idx + 1) * stepWidth + stepWidth * 0.5;
              const nextY = valueToY(next.value ?? 0);
              return (
                <g key={`eff-${d.date}-${idx}`}>
                  <line x1={x} x2={nextX} y1={y} y2={nextY} stroke="#22d3ee" strokeWidth={2.2} />
                  <circle cx={x} cy={y} r={3} fill="#22d3ee" />
                </g>
              );
            }
            return <circle key={`eff-${d.date}-${idx}`} cx={x} cy={y} r={3} fill="#22d3ee" />;
          })}

          {stairsUp.map((d) => {
            const label = d.label ?? d.date;
            const idx = labelIndex.get(label ?? "");
            if (idx === undefined) return null;
            const barHeight = height - margin.bottom - valueToY(d.value ?? 0);
            const x = margin.left + idx * stepWidth + stepWidth * 0.1;
            const barWidth = stepWidth * 0.2;
            return (
              <rect
                key={`up-${d.date}-${idx}`}
                x={x}
                y={height - margin.bottom - barHeight}
                width={barWidth}
                height={barHeight}
                fill="#a78bfa"
                opacity={0.7}
                rx={3}
              />
            );
          })}

          {stairsDown.map((d) => {
            const label = d.label ?? d.date;
            const idx = labelIndex.get(label ?? "");
            if (idx === undefined) return null;
            const barHeight = height - margin.bottom - valueToY(d.value ?? 0);
            const x = margin.left + idx * stepWidth + stepWidth * 0.75;
            const barWidth = stepWidth * 0.2;
            return (
              <rect
                key={`down-${d.date}-${idx}`}
                x={x}
                y={height - margin.bottom - barHeight}
                width={barWidth}
                height={barHeight}
                fill="#f97316"
                opacity={0.7}
                rx={3}
              />
            );
          })}

          {xTickIndices.map((idx) => {
            const x = margin.left + idx * stepWidth + stepWidth / 2;
            return (
              <g key={`x-${idx}`}>
                <line x1={x} x2={x} y1={height - margin.bottom} y2={height - margin.bottom + 4} className="chart-axis" />
                <text x={x} y={height - 6} className="chart-tick-label" textAnchor="middle">
                  {labels[idx]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </GlassCard>
  );
}

export function FitnessDashboardView() {
  const [range, setRange] = useState<RangeKey>("7d");
  const [group, setGroup] = useState<GroupKey>("daily");
  const [data, setData] = useState<FitnessDashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    fetchFitnessDashboard(range, group)
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
  }, [range, group]);

  const exerciseData = group === "weekly" ? data?.charts.exercise.weekly ?? [] : data?.charts.exercise.daily ?? [];
  const stepsData =
    group === "weekly" ? data?.charts.steps_distance.steps_weekly ?? [] : data?.charts.steps_distance.steps ?? [];
  const distanceData =
    group === "weekly" ? data?.charts.steps_distance.distance_weekly ?? [] : data?.charts.steps_distance.distance ?? [];
  const activeData =
    group === "weekly" ? data?.charts.active_floors.active_kcal_weekly ?? [] : data?.charts.active_floors.active_kcal ?? [];
  const floorsData =
    group === "weekly" ? data?.charts.active_floors.floors_weekly ?? [] : data?.charts.active_floors.floors ?? [];

  const efficiencySeries = data?.charts.efficiency.efficiency_index ?? [];
  const stairsUp = data?.charts.efficiency.stair_up ?? [];
  const stairsDown = data?.charts.efficiency.stair_down ?? [];

  const summaryTiles = useMemo(() => {
    if (!data) return null;
    return [
      {
        title: data.tiles.volume.label,
        primary: {
          value: data.tiles.volume.value,
          unit: data.tiles.volume.unit,
          delta: data.tiles.volume.delta_text,
          color: data.tiles.volume.color,
        },
        detail: data.tiles.volume.detail,
      },
      {
        title: data.tiles.consistency.label,
        primary: {
          value: data.tiles.consistency.value,
          unit: data.tiles.consistency.unit,
          color: data.tiles.consistency.color,
          delta: data.tiles.consistency.delta_text,
        },
        detail:
          data.tiles.consistency.streak || data.tiles.consistency.longest
            ? `Streak: ${data.tiles.consistency.streak ?? 0} · Longest: ${data.tiles.consistency.longest ?? 0}`
            : undefined,
      },
      {
        title: data.tiles.distance.label,
        primary: {
          value: data.tiles.distance.value,
          unit: data.tiles.distance.unit,
          color: data.tiles.distance.color,
          delta: data.tiles.distance.delta_text,
        },
        secondary: data.tiles.distance.secondary
          ? { value: data.tiles.distance.secondary, unit: data.tiles.distance.secondary_unit ?? "Steps" }
          : undefined,
      },
      {
        title: data.tiles.efficiency.label,
        primary: {
          value: data.tiles.efficiency.value,
          unit: data.tiles.efficiency.unit,
          color: data.tiles.efficiency.color,
          delta: data.tiles.efficiency.delta_text,
        },
      },
      {
        title: data.tiles.mobility.label,
        primary: {
          value: data.tiles.mobility.value,
          unit: data.tiles.mobility.unit,
          color: data.tiles.mobility.color,
          delta: data.tiles.mobility.delta_text,
        },
      },
    ];
  }, [data]);

  return (
    <div className="app-grid">
      <header className="app-header">
        <span className="kicker">Health</span>
        <h1 className="title">Fitness Dashboard</h1>
        <p className="subtitle">Weekly Volume, Consistency, Efficiency Proxy und Mobility Trends.</p>
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
        <div className="chart-controls" role="group" aria-label="Gruppierung wählen">
          {groups.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`pill ${group === item.key ? "pill--active" : ""}`.trim()}
              onClick={() => setGroup(item.key)}
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
            <h3 className="card-title">Fitness Dashboard wird geladen...</h3>
            <p className="card-description">Fitness Volume, Consistency und Efficiency werden vorbereitet.</p>
          </GlassCard>
        )}
        {error && (
          <GlassCard className="error-card">
            <h3 className="card-title">Fehler</h3>
            <p className="card-description">{error}</p>
          </GlassCard>
        )}
        {summaryTiles && !loading && (
          <div className="grid-cards summary-grid">
            {summaryTiles.map((tile) => (
              <SummaryTile
                key={tile.title}
                title={tile.title}
                primary={tile.primary}
                secondary={tile.secondary}
                detail={tile.detail}
              />
            ))}
          </div>
        )}
      </section>

      {data && !loading && (
        <section className="stack">
          <div className="section-heading">Trends</div>
          <div className="grid-cards charts-grid">
            <SimpleBarChart series={exerciseData} title="Exercise-Minuten" color="#22d3ee" unit={group === "weekly" ? "min/W" : "min"} />
            <ComboChart
              title="Steps & Distanz"
              bars={stepsData}
              line={distanceData}
              barLabel="Steps"
              lineLabel="km"
              barColor="var(--electric-blue)"
              lineColor="#67e8f9"
            />
            <ComboChart
              title="Active kcal & Floors"
              bars={activeData}
              line={floorsData}
              barLabel="Active kcal"
              lineLabel="Floors"
              barColor="#fbbf24"
              lineColor="#a855f7"
            />
            <EfficiencyChart efficiency={efficiencySeries} stairsUp={stairsUp} stairsDown={stairsDown} />
          </div>
        </section>
      )}

      {data && data.notes && (
        <section className="stack">
          <div className="section-heading">Progress Notes</div>
          <GlassCard>
            {data.notes.length === 0 ? (
              <p className="card-description">Keine datengetriebenen Hinweise im aktuellen Range.</p>
            ) : (
              <ul className="signal-list">
                {data.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </GlassCard>
        </section>
      )}
    </div>
  );
}
