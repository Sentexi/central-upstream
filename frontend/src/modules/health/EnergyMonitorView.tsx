import { useEffect, useState } from "react";
import type { RangeKey, EnergyMonitorResponse, MetricPoint, ActivityPoint } from "./api";
import { fetchEnergyMonitor } from "./api";
import {
  PageHeader,
  SegmentedControl,
  StatCard,
  SectionHeader,
  ProgressBar,
  RangeBar,
  Card,
} from "../../core/ui";
import type { SegmentedControlOption } from "../../core/ui";
import { LineAreaChart, ComboChart, CHART_COLORS } from "../../core/charts";

// ── Akkzentfarben (Tokens) ────────────────────────────────────────────────────
const ACCENT = {
  amber: "var(--amber)",
  violet: "var(--violet)",
  teal: "var(--teal)",
  coral: "var(--coral)",
  indigo: "var(--indigo)",
} as const;

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

function formatValue(value?: number | null, digits = 1): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "–";
  return Number(value).toFixed(digits);
}

function formatDuration(value?: number | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "–";
  const totalMinutes = Math.round(value * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

/** Berechnet Prozent eines Werts innerhalb [lo, hi]. Klemmt auf 0–100. */
function toPct(value: number | null | undefined, lo: number, hi: number): number {
  if (value == null || hi <= lo) return 0;
  return Math.min(100, Math.max(0, ((value - lo) / (hi - lo)) * 100));
}

function rangeBarProps(
  curValue: number | null | undefined,
  baseline: number | null | undefined,
  lo: number | null | undefined,
  hi: number | null | undefined,
): { value: number; baseline: number; marker: number } {
  const loN = lo ?? 0;
  const hiN = hi ?? 100;
  const fillPct = toPct(curValue, loN, hiN);
  const basePct = toPct(baseline, loN, hiN);
  return { value: fillPct, baseline: basePct, marker: fillPct };
}

function deltaTone(text?: string): "pos" | "neg" | "neutral" {
  if (!text) return "neutral";
  if (text.startsWith("+") || text.startsWith("▲")) return "pos";
  if (text.startsWith("-") || text.startsWith("▼") || text.startsWith("−")) return "neg";
  return "neutral";
}

/** Schnelle Datumskürzung für X-Achse: "2024-06-03" -> "03.06" */
function shortDate(d: string): string {
  const parts = d.split("-");
  if (parts.length !== 3) return d;
  return `${parts[2]}.${parts[1]}`;
}

// ── Range-Optionen ────────────────────────────────────────────────────────────

const RANGE_OPTIONS = [
  { value: "today", label: "Heute" },
  { value: "7d",    label: "7 Tage" },
  { value: "14d",   label: "14 Tage" },
  { value: "30d",   label: "30 Tage" },
] satisfies SegmentedControlOption[];

// ── Mono-Einheiten-Badge ──────────────────────────────────────────────────────

function UnitBadge({ unit }: { unit: string }) {
  return (
    <span
      style={{
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 10,
        letterSpacing: "0.05em",
        padding: "3px 8px",
        borderRadius: "var(--radius-pill)",
        border: "1px solid var(--border-strong)",
        color: "var(--text-low)",
        whiteSpace: "nowrap",
      }}
    >
      {unit}
    </span>
  );
}

// ── Chart-Panel-Wrapper ───────────────────────────────────────────────────────

function ChartPanel({
  title,
  unit,
  children,
}: {
  title: string;
  unit?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <span
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-high)",
          }}
        >
          {title}
        </span>
        {unit ? <UnitBadge unit={unit} /> : null}
      </div>
      {children}
    </Card>
  );
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────

export function EnergyMonitorView() {
  const [range, setRange] = useState<RangeKey>("7d");
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
      .catch((err: unknown) => {
        console.error(err);
        if (mounted) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [range]);

  // ── RHR-Wert (wie vorher: avg > letzter Punkt > tile.value) ─────────────
  const rhrSeries: MetricPoint[] = (data?.series.rhr ?? []).map((p) => ({
    date: p.date,
    value: p.avg ?? p.value ?? null,
  }));
  const sortedRhr = [...rhrSeries].sort((a, b) => a.date.localeCompare(b.date));
  const prevRhr =
    sortedRhr.length > 1 ? (sortedRhr[sortedRhr.length - 2]?.value ?? null) : null;
  const rhrValue = data?.tiles.rhr.avg ?? data?.tiles.rhr.value ?? prevRhr;

  const signals = data?.signals ?? [];

  // ── Chart-Daten ──────────────────────────────────────────────────────────
  const hrvChartData = (data?.series.hrv ?? [])
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => ({ date: shortDate(p.date), value: p.value }));

  const rhrChartData = rhrSeries
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => ({ date: shortDate(p.date), value: p.value }));

  const sleepChartData = (data?.series.sleep_total ?? [])
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => ({ date: shortDate(p.date), value: p.value }));

  const activityChartData: Array<Record<string, unknown>> = (data?.series.activity ?? [])
    .slice()
    .sort((a: ActivityPoint, b: ActivityPoint) => a.date.localeCompare(b.date))
    .map((p: ActivityPoint) => ({
      date: shortDate(p.date),
      steps: p.steps ?? 0,
      exercise: p.exercise_min ?? 0,
    }));

  return (
    <div className="app-grid">
      {/* ── PageHeader ─────────────────────────────────────────────────────── */}
      <PageHeader
        eyebrow="HEALTH"
        title="Energy Monitor"
        subtitle="Aggregierte Tages-Metriken mit Readiness-Barometer."
        right={
          <SegmentedControl
            options={RANGE_OPTIONS}
            value={range}
            onChange={(v) => setRange(v as RangeKey)}
          />
        }
      />

      {/* ── Loading / Error ─────────────────────────────────────────────────── */}
      {loading && (
        <Card>
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              letterSpacing: "0.15em",
              color: "var(--text-low)",
              textTransform: "uppercase",
            }}
          >
            Loading
          </span>
          <p style={{ marginTop: 8, color: "var(--text-mid)", fontSize: 14 }}>
            Energy Monitor wird geladen…
          </p>
        </Card>
      )}
      {error && (
        <Card style={{ borderTop: "2px solid var(--coral)" }}>
          <p style={{ color: "var(--coral)", fontWeight: 600 }}>Fehler</p>
          <p style={{ marginTop: 6, color: "var(--text-mid)", fontSize: 13 }}>{error}</p>
        </Card>
      )}

      {/* ── Summary-Karten ──────────────────────────────────────────────────── */}
      {data && !loading && (
        <>
          <SectionHeader label="Summary" />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
              gap: 14,
            }}
          >
            {/* Readiness ── Amber */}
            <StatCard
              eyebrow="Readiness"
              value={formatValue(data.tiles.readiness.score, 0)}
              unit="/100"
              accent={ACCENT.amber}
              delta={
                data.tiles.readiness.delta_text
                  ? {
                      text: data.tiles.readiness.delta_text,
                      tone: deltaTone(data.tiles.readiness.delta_text),
                    }
                  : undefined
              }
            >
              <ProgressBar value={data.tiles.readiness.score ?? 0} color={ACCENT.amber} />
              <p
                style={{
                  marginTop: 8,
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  color: "var(--text-low)",
                }}
              >
                Gewichtet: Schlaf 30 · HRV 45 · RHR 25
              </p>
            </StatCard>

            {/* Schlaf ── Violet */}
            <StatCard
              eyebrow="Schlaf"
              value={data.tiles.sleep.display_value ?? formatDuration(data.tiles.sleep.value)}
              accent={ACCENT.violet}
              delta={
                data.tiles.sleep.delta_text
                  ? {
                      text: data.tiles.sleep.delta_text,
                      tone: deltaTone(data.tiles.sleep.delta_text),
                    }
                  : undefined
              }
            >
              <ProgressBar value={data.tiles.sleep.score ?? 0} color={ACCENT.violet} />
              {data.tiles.sleep.avg != null && (
                <p
                  style={{
                    marginTop: 8,
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    color: "var(--text-low)",
                  }}
                >
                  Ø {formatDuration(data.tiles.sleep.avg)}
                </p>
              )}
            </StatCard>

            {/* HRV ── Teal */}
            {(() => {
              const lo = data.tiles.hrv.range_min;
              const hi = data.tiles.hrv.range_max;
              const hasRange =
                lo != null && hi != null && hi > lo;
              const rbp = hasRange
                ? rangeBarProps(data.tiles.hrv.value, data.tiles.hrv.baseline, lo, hi)
                : null;
              return (
                <StatCard
                  eyebrow="HRV"
                  value={formatValue(data.tiles.hrv.value, 0)}
                  unit={data.tiles.hrv.unit ?? "ms"}
                  accent={ACCENT.teal}
                  delta={
                    data.tiles.hrv.delta_text
                      ? {
                          text: data.tiles.hrv.delta_text,
                          tone: deltaTone(data.tiles.hrv.delta_text),
                        }
                      : undefined
                  }
                >
                  {rbp ? (
                    <RangeBar
                      value={rbp.value}
                      baseline={rbp.baseline}
                      marker={rbp.marker}
                      color={CHART_COLORS.teal}
                    />
                  ) : (
                    <ProgressBar value={data.tiles.hrv.score ?? 0} color={ACCENT.teal} />
                  )}
                  <p
                    style={{
                      marginTop: 8,
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 10,
                      color: "var(--text-low)",
                    }}
                  >
                    Lo {formatValue(lo, 0)} · Bsl {formatValue(data.tiles.hrv.baseline, 0)} · Hi {formatValue(hi, 0)}
                  </p>
                </StatCard>
              );
            })()}

            {/* Ruhepuls ── Coral */}
            {(() => {
              const lo = data.tiles.rhr.range_min;
              const hi = data.tiles.rhr.range_max;
              const hasRange = lo != null && hi != null && hi > lo;
              const rbp = hasRange
                ? rangeBarProps(rhrValue, data.tiles.rhr.baseline, lo, hi)
                : null;
              return (
                <StatCard
                  eyebrow="Ruhepuls"
                  value={formatValue(rhrValue, 0)}
                  unit={data.tiles.rhr.unit ?? "bpm"}
                  accent={ACCENT.coral}
                  delta={
                    data.tiles.rhr.delta_text
                      ? {
                          text: data.tiles.rhr.delta_text,
                          tone: deltaTone(data.tiles.rhr.delta_text),
                        }
                      : undefined
                  }
                >
                  {rbp ? (
                    <RangeBar
                      value={rbp.value}
                      baseline={rbp.baseline}
                      marker={rbp.marker}
                      color={CHART_COLORS.coral}
                    />
                  ) : (
                    <ProgressBar value={data.tiles.rhr.score ?? 0} color={ACCENT.coral} />
                  )}
                  <p
                    style={{
                      marginTop: 8,
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 10,
                      color: "var(--text-low)",
                    }}
                  >
                    Lo {formatValue(lo, 0)} · Bsl {formatValue(data.tiles.rhr.baseline, 0)} · Hi {formatValue(hi, 0)}
                  </p>
                </StatCard>
              );
            })()}

            {/* Load & Movement ── Indigo */}
            <StatCard
              eyebrow="Load & Movement"
              value={formatValue(data.tiles.load.steps, 0)}
              unit="Steps"
              accent={ACCENT.indigo}
              delta={
                data.tiles.load.delta_text
                  ? {
                      text: data.tiles.load.delta_text,
                      tone: deltaTone(data.tiles.load.delta_text),
                    }
                  : undefined
              }
            >
              <ProgressBar value={data.tiles.load.score ?? 0} color={ACCENT.indigo} />
              <p
                style={{
                  marginTop: 8,
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  color: "var(--text-low)",
                }}
              >
                {formatValue(data.tiles.load.exercise_min, 0)} min Exercise · Ziel 10 000
              </p>
            </StatCard>
          </div>

          {/* ── Trends 2×2 ─────────────────────────────────────────────────── */}
          <SectionHeader label="Trends" />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 16,
            }}
          >
            {/* HRV */}
            <ChartPanel title="HRV" unit="ms">
              <LineAreaChart
                data={hrvChartData}
                dataKey="value"
                xKey="date"
                color={CHART_COLORS.teal}
                height={200}
                xTickFormatter={shortDate}
              />
            </ChartPanel>

            {/* Ruhepuls */}
            <ChartPanel title="Ruhepuls" unit="bpm">
              <LineAreaChart
                data={rhrChartData}
                dataKey="value"
                xKey="date"
                color={CHART_COLORS.coral}
                height={200}
                xTickFormatter={shortDate}
              />
            </ChartPanel>

            {/* Schlafdauer */}
            <ChartPanel title="Schlafdauer" unit="min">
              <LineAreaChart
                data={sleepChartData}
                dataKey="value"
                xKey="date"
                color={CHART_COLORS.violet}
                height={200}
                yMin={3}
                xTickFormatter={shortDate}
              />
            </ChartPanel>

            {/* Aktivität & Bewegung */}
            <ChartPanel title="Aktivität & Bewegung">
              <div style={{ marginBottom: 8, display: "flex", gap: 8 }}>
                <UnitBadge unit="Steps" />
                <UnitBadge unit="Exercise min" />
              </div>
              <ComboChart
                data={activityChartData}
                xKey="date"
                bars={[
                  { dataKey: "steps", name: "Steps", color: CHART_COLORS.indigo },
                ]}
                line={{ dataKey: "exercise", name: "Exercise min", color: CHART_COLORS.teal }}
                height={200}
                xTickFormatter={shortDate}
              />
            </ChartPanel>
          </div>

          {/* ── Signals / Risiko-Hinweise ───────────────────────────────────── */}
          <SectionHeader label="Signals" />
          <Card>
            <p
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-high)",
                marginBottom: signals.length > 0 ? 12 : 0,
              }}
            >
              Automatische Hinweise
            </p>
            {signals.length === 0 ? (
              <p style={{ color: "var(--text-mid)", fontSize: 13, marginTop: 6 }}>
                Alle Kernsignale liegen im Rahmen der Baseline.
              </p>
            ) : (
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {signals.map((s) => (
                  <li
                    key={s}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "var(--radius-card)",
                      background: "var(--warning-fill)",
                      color: "var(--warning-text)",
                      fontSize: 13,
                      borderLeft: "3px solid var(--amber)",
                    }}
                  >
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
