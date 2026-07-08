import { useEffect, useMemo, useState } from "react";
import type {
  FitnessDashboardResponse,
  FitnessSeries,
  FitnessTile,
  GroupKey,
  RangeKey,
} from "./api";
import { fetchFitnessDashboard } from "./api";
import {
  PageHeader,
  SegmentedControl,
  StatCard,
  SectionHeader,
  ProgressBar,
  Badge,
  Card,
} from "../../core/ui";
import type { SegmentedControlOption, BadgeTone, DeltaTone } from "../../core/ui";
import {
  ZoneLineChart,
  BarChart,
  ComboChart,
  DualLineChart,
  StackedBarLineChart,
  CHART_COLORS,
} from "../../core/charts";

// ── Akzentfarben (Tokens) ─────────────────────────────────────────────────────
// Nur teal wird im Layout direkt referenziert (ProgressBar). Die uebrigen Akzente
// kommen ueber CHART_COLORS in die Charts, deshalb haelt ACCENT bewusst nur teal.
const ACCENT = {
  teal: "var(--teal)",
} as const;

// ── VO2-Zonengrenzen (aus Fitness-Mockup-Script: zoneLine(vo2, 24, 64, …)) ─────
const VO2_MIN = 24;
const VO2_MAX = 64;
const VO2_FAIR_FROM = 35;
const VO2_GOOD_FROM = 45;
const VO2_ZONES = [
  { from: VO2_MIN, to: VO2_FAIR_FROM, tone: "low" as const },
  { from: VO2_FAIR_FROM, to: VO2_GOOD_FROM, tone: "fair" as const },
  { from: VO2_GOOD_FROM, to: VO2_MAX, tone: "good" as const },
];

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

function formatValue(value?: number | null, digits = 1): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "–";
  return Number(value).toFixed(digits);
}

/** Tausender-Trennung mit schmalem Leerzeichen (z. B. 45354 -> "45 354"). */
function formatThousands(value?: number | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "–";
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Datumskuerzung fuer X-Achse: "2026-06-23" -> "23.06". */
function shortDate(d: string): string {
  const parts = d.split("-");
  if (parts.length !== 3) return d;
  return `${parts[2]}.${parts[1]}`;
}

/** Wochen-Label kuerzen: "2026-W26" -> "W26", sonst Datum kuerzen. */
function shortWeek(label: string): string {
  const match = label.match(/W\d{1,2}$/);
  if (match) return match[0];
  return shortDate(label);
}

function deltaTone(text?: string): DeltaTone {
  if (!text) return "neutral";
  if (text.startsWith("+") || text.startsWith("▲")) return "pos";
  if (text.startsWith("-") || text.startsWith("▼") || text.startsWith("−")) return "neg";
  return "neutral";
}

function makeDelta(tile: FitnessTile) {
  return tile.delta_text
    ? { text: tile.delta_text, tone: deltaTone(tile.delta_text) }
    : undefined;
}

/** Letzter Punkt einer Serie mit gueltigem Wert. */
function lastValue(series: FitnessSeries[]): number | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const v = series[i]?.value;
    if (typeof v === "number" && !Number.isNaN(v)) return v;
  }
  return null;
}

/** VO2-Einstufung anhand der Zonengrenzen (low/fair/good). */
function vo2Class(value: number | null): { label: string; tone: BadgeTone } | null {
  if (value == null) return null;
  if (value >= VO2_GOOD_FROM) return { label: "good", tone: "success" };
  if (value >= VO2_FAIR_FROM) return { label: "fair", tone: "warning" };
  return { label: "low", tone: "error" };
}

/**
 * Mappt eine FitnessSeries auf Recharts-Daten. Bei weekly wird das week_label
 * (z. B. "2026-W26") als X-Achsen-Wert genutzt, sonst das gekuerzte Datum.
 */
function xLabel(p: { date?: string | null; label?: string | null }, idx: number, weekly: boolean): string {
  if (weekly) return shortWeek(p.label ?? p.date ?? `${idx}`);
  return shortDate(p.date ?? `${idx}`);
}

function toChartData(series: FitnessSeries[], group: GroupKey): Array<Record<string, unknown>> {
  const weekly = group === "weekly";
  return series.map((p, idx) => ({
    x: xLabel(p, idx, weekly),
    value: p.value,
  }));
}

/** 7-Tage gleitender Durchschnitt (fuer den Gewicht-Dual-Line). */
function movingAverage(series: FitnessSeries[], windowSize = 7): Array<number | null> {
  if (windowSize <= 1) return series.map((p) => p.value);
  return series.map((_, idx) => {
    const start = Math.max(0, idx - windowSize + 1);
    const windowValues = series
      .slice(start, idx + 1)
      .map((item) => item.value)
      .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
    if (!windowValues.length) return null;
    return windowValues.reduce((sum, v) => sum + v, 0) / windowValues.length;
  });
}

// ── Range-/Group-Optionen ─────────────────────────────────────────────────────

const RANGE_OPTIONS = [
  { value: "today", label: "Heute" },
  { value: "7d", label: "7 Tage" },
  { value: "14d", label: "14 Tage" },
  { value: "30d", label: "30 Tage" },
] satisfies SegmentedControlOption[];

const GROUP_OPTIONS = [
  { value: "daily", label: "Täglich" },
  { value: "weekly", label: "Wöchentlich" },
] satisfies SegmentedControlOption[];

// ── Mono-Caption ──────────────────────────────────────────────────────────────

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        marginTop: 9,
        fontSize: 11,
        color: "var(--text-mid)",
      }}
    >
      {children}
    </p>
  );
}

// ── Chart-Legende (Swatch + Label) ────────────────────────────────────────────

function LegendSwatch({ color, line }: { color: string; line?: boolean }) {
  return (
    <span
      style={{
        width: line ? 11 : 9,
        height: line ? 2 : 9,
        borderRadius: 2,
        background: color,
        flex: "none",
      }}
    />
  );
}

function LegendItem({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-mid)" }}>
      <LegendSwatch color={color} line={line} />
      {label}
    </span>
  );
}

// ── Mono-Einheiten-Badge ──────────────────────────────────────────────────────

function UnitBadge({ unit }: { unit: string }) {
  return (
    <span
      style={{
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
        padding: "3px 9px",
        borderRadius: 7,
        border: "1px solid var(--border-strong)",
        color: "var(--text-mid)",
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
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card style={{ padding: "17px 17px 9px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 15,
            fontWeight: 600,
            color: "var(--text-high)",
          }}
        >
          {title}
        </span>
        {right ? <div style={{ display: "flex", alignItems: "center", gap: 12 }}>{right}</div> : null}
      </div>
      {children}
    </Card>
  );
}

function EmptyChart() {
  return (
    <p style={{ color: "var(--text-mid)", fontSize: 13, padding: "24px 0" }}>
      Keine Daten im aktuellen Zeitraum.
    </p>
  );
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────

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
  }, [range, group]);

  const weekly = group === "weekly";

  // ── Serien je nach Granularitaet (daily/weekly) ──────────────────────────────
  const exerciseSeries = weekly
    ? data?.charts.exercise.weekly ?? []
    : data?.charts.exercise.daily ?? [];
  const stepsSeries = weekly
    ? data?.charts.steps_distance.steps_weekly ?? []
    : data?.charts.steps_distance.steps ?? [];
  const distanceSeries = weekly
    ? data?.charts.steps_distance.distance_weekly ?? []
    : data?.charts.steps_distance.distance ?? [];
  const weightSeries = weekly ? data?.charts.weight.weekly ?? [] : data?.charts.weight.daily ?? [];
  const vo2Series = weekly ? data?.charts.vo2max.weekly ?? [] : data?.charts.vo2max.daily ?? [];

  // ── VO2-Chart + Karte ────────────────────────────────────────────────────────
  const vo2ChartData = useMemo(() => toChartData(vo2Series, group), [vo2Series, group]);
  const vo2Latest = useMemo(() => lastValue(vo2Series), [vo2Series]);
  const vo2Badge = vo2Class(vo2Latest);

  // ── Exercise-Chart ───────────────────────────────────────────────────────────
  const exerciseChartData = useMemo(() => toChartData(exerciseSeries, group), [exerciseSeries, group]);

  // ── Steps & Distanz Combo ────────────────────────────────────────────────────
  const stepsComboData = useMemo(() => {
    const length = Math.max(stepsSeries.length, distanceSeries.length);
    return Array.from({ length }, (_, idx) => {
      const s = stepsSeries[idx];
      const d = distanceSeries[idx];
      const src = s ?? d ?? {};
      return {
        x: xLabel(src, idx, weekly),
        steps: s?.value ?? null,
        distance: d?.value ?? null,
      };
    });
  }, [stepsSeries, distanceSeries, weekly]);

  // ── Gewicht Dual-Line (kg + 7-Tage-Ø) ────────────────────────────────────────
  const weightChartData = useMemo(() => {
    const ma = movingAverage(weightSeries, 7);
    return weightSeries.map((p, idx) => ({
      x: xLabel(p, idx, weekly),
      weight: p.value,
      avg: ma[idx],
    }));
  }, [weightSeries, weekly]);

  // ── Sekundaere Sektion: Bestandsdaten (Mobility, Floors, Efficiency) ──────────

  // Mobility-Kennzahl (Walking-Speed) aus tiles.mobility.
  const mobilityTile = data?.tiles.mobility;

  // Aktivitaet & Floors: resting/active kcal (gestapelt) + floors als Linie.
  // Granularitaet respektieren (daily vs. weekly), wie bei den uebrigen Charts.
  const activeKcalSeries = weekly
    ? data?.charts.active_floors.active_kcal_weekly ?? []
    : data?.charts.active_floors.active_kcal ?? [];
  const restingKcalSeries = weekly
    ? data?.charts.active_floors.resting_kcal_weekly ?? []
    : data?.charts.active_floors.resting_kcal ?? [];
  const floorsSeries = weekly
    ? data?.charts.active_floors.floors_weekly ?? []
    : data?.charts.active_floors.floors ?? [];

  const activeFloorsData = useMemo(() => {
    const length = Math.max(restingKcalSeries.length, activeKcalSeries.length, floorsSeries.length);
    return Array.from({ length }, (_, idx) => {
      const resting = restingKcalSeries[idx];
      const active = activeKcalSeries[idx];
      const floors = floorsSeries[idx];
      const src = resting ?? active ?? floors ?? {};
      return {
        x: xLabel(src, idx, weekly),
        resting_kcal: resting?.value ?? null,
        active_kcal: active?.value ?? null,
        floors: floors?.value ?? null,
      };
    });
  }, [restingKcalSeries, activeKcalSeries, floorsSeries, weekly]);

  // Efficiency-Trend: efficiency_index (Linie, rechte Achse) + stair_up/stair_down
  // (gruppierte Balken). Diese Serien haben kein weekly-Pendant, daher daily.
  const efficiencyIndexSeries = data?.charts.efficiency.efficiency_index ?? [];
  const stairUpSeries = data?.charts.efficiency.stair_up ?? [];
  const stairDownSeries = data?.charts.efficiency.stair_down ?? [];

  const efficiencyData = useMemo(() => {
    const length = Math.max(
      efficiencyIndexSeries.length,
      stairUpSeries.length,
      stairDownSeries.length,
    );
    return Array.from({ length }, (_, idx) => {
      const eff = efficiencyIndexSeries[idx];
      const up = stairUpSeries[idx];
      const down = stairDownSeries[idx];
      const src = eff ?? up ?? down ?? {};
      return {
        // efficiency_index/stairs sind immer daily (kein weekly-Pendant in der API).
        x: xLabel(src, idx, false),
        efficiency_index: eff?.value ?? null,
        stair_up: up?.value ?? null,
        stair_down: down?.value ?? null,
      };
    });
  }, [efficiencyIndexSeries, stairUpSeries, stairDownSeries]);

  return (
    <div className="app-grid">
      {/* ── PageHeader ──────────────────────────────────────────────────────── */}
      <PageHeader
        eyebrow="HEALTH"
        title="Fitness Dashboard"
        subtitle="Weekly Volume, Consistency, Efficiency-Proxy und Mobility-Trends."
        right={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <SegmentedControl
              options={RANGE_OPTIONS}
              value={range}
              onChange={(v) => setRange(v as RangeKey)}
            />
            <SegmentedControl
              options={GROUP_OPTIONS}
              value={group}
              onChange={(v) => setGroup(v as GroupKey)}
            />
          </div>
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
            Fitness Dashboard wird geladen…
          </p>
        </Card>
      )}
      {error && (
        <Card style={{ borderTop: "2px solid var(--coral)" }}>
          <p style={{ color: "var(--coral)", fontWeight: 600 }}>Fehler</p>
          <p style={{ marginTop: 6, color: "var(--text-mid)", fontSize: 13 }}>{error}</p>
        </Card>
      )}

      {data && !loading && (
        <>
          {/* ── Summary-Karten ──────────────────────────────────────────────── */}
          <SectionHeader label="Summary" />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))",
              gap: 14,
            }}
          >
            {/* Weekly Volume */}
            <StatCard
              eyebrow="Weekly Volume"
              value={formatValue(data.tiles.volume.value, 1)}
              unit={data.tiles.volume.unit ?? "min"}
              delta={makeDelta(data.tiles.volume)}
            >
              {data.tiles.volume.detail ? <Caption>{data.tiles.volume.detail}</Caption> : null}
            </StatCard>

            {/* Consistency */}
            {(() => {
              const tile = data.tiles.consistency;
              // Annahme: die Einheit kodiert das Wochen-Soll als "/7" (aktive Tage von 7).
              // Ziffern aus der Unit ziehen ("/7" -> 7), Fallback 7 falls kein Wert da ist.
              const total = Number((tile.unit ?? "/7").replace(/[^\d]/g, "")) || 7;
              const active = tile.value ?? 0;
              const pct = total > 0 ? (active / total) * 100 : 0;
              return (
                <StatCard eyebrow="Consistency" value={formatValue(active, 1)} unit={tile.unit ?? "/7"}>
                  <ProgressBar value={pct} from={ACCENT.teal} to="var(--teal-bright)" />
                  <Caption>
                    Streak {tile.streak ?? 0} · Longest {tile.longest ?? 0}
                  </Caption>
                </StatCard>
              );
            })()}

            {/* Distance & Steps */}
            <StatCard
              eyebrow="Distance & Steps"
              value={formatValue(data.tiles.distance.value, 1)}
              unit={data.tiles.distance.unit ?? "km"}
              delta={makeDelta(data.tiles.distance)}
            >
              {data.tiles.distance.secondary != null ? (
                <Caption>
                  {formatThousands(data.tiles.distance.secondary)}{" "}
                  {data.tiles.distance.secondary_unit ?? "Steps"} gesamt
                </Caption>
              ) : null}
            </StatCard>

            {/* Efficiency Proxy */}
            <StatCard
              eyebrow="Efficiency Proxy"
              value={formatValue(data.tiles.efficiency.value, 1)}
              unit={data.tiles.efficiency.unit ?? "HR/Speed"}
              delta={makeDelta(data.tiles.efficiency)}
            >
              {data.tiles.efficiency.detail ? (
                <Caption>{data.tiles.efficiency.detail}</Caption>
              ) : (
                <Caption>Baseline wird aufgebaut</Caption>
              )}
            </StatCard>

            {/* VO2 Max (aus charts.vo2max abgeleitet, Badge nach Zonengrenzen) */}
            <StatCard eyebrow="VO₂ Max" value={formatValue(vo2Latest, 1)} unit="ml/kg">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {vo2Badge ? <Badge tone={vo2Badge.tone}>{vo2Badge.label}</Badge> : null}
                <span style={{ fontSize: 11, color: "var(--text-mid)" }}>Altersnorm 35–45</span>
              </div>
            </StatCard>
          </div>

          {/* ── Trends ──────────────────────────────────────────────────────── */}
          <SectionHeader label="Trends" />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
              gap: 16,
            }}
          >
            {/* VO2 Max ── Zonen-Linie */}
            <ChartPanel
              title="VO₂ Max"
              right={
                <>
                  <LegendItem color={CHART_COLORS.green} label="good" />
                  <LegendItem color={CHART_COLORS.amber} label="fair" />
                  <LegendItem color={CHART_COLORS.coral} label="low" />
                </>
              }
            >
              {vo2ChartData.length ? (
                <ZoneLineChart
                  data={vo2ChartData}
                  xKey="x"
                  dataKey="value"
                  zones={VO2_ZONES}
                  color={CHART_COLORS.teal}
                  height={210}
                  yMin={VO2_MIN}
                  yMax={VO2_MAX}
                  unit="ml/kg/min"
                  valueFormatter={(v) => v.toFixed(0)}
                />
              ) : (
                <EmptyChart />
              )}
            </ChartPanel>

            {/* Exercise-Minuten ── Teal-Balken */}
            <ChartPanel title="Exercise-Minuten" right={<UnitBadge unit={weekly ? "min/W" : "min"} />}>
              {exerciseChartData.length ? (
                <BarChart
                  data={exerciseChartData}
                  dataKey="value"
                  xKey="x"
                  color={CHART_COLORS.teal}
                  height={210}
                  unit="min"
                  valueFormatter={(v) => v.toFixed(0)}
                />
              ) : (
                <EmptyChart />
              )}
            </ChartPanel>

            {/* Steps & Distanz ── Combo (Indigo-Balken + Teal-Linie) */}
            <ChartPanel
              title="Steps & Distanz"
              right={
                <>
                  <LegendItem color={CHART_COLORS.indigo} label="Steps" />
                  <LegendItem color={CHART_COLORS.teal} label="km" line />
                </>
              }
            >
              {stepsComboData.length ? (
                <ComboChart
                  data={stepsComboData}
                  xKey="x"
                  bars={[{ dataKey: "steps", name: "Steps", color: CHART_COLORS.indigo }]}
                  line={{ dataKey: "distance", name: "km", color: CHART_COLORS.teal }}
                  height={210}
                  leftFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${Math.round(v)}`)}
                />
              ) : (
                <EmptyChart />
              )}
            </ChartPanel>

            {/* Gewicht ── Dual-Line (Amber kg + Violet gestrichelt 7T-Ø) */}
            <ChartPanel
              title="Gewicht"
              right={
                <>
                  <LegendItem color={CHART_COLORS.amber} label="kg" line />
                  <LegendItem color={CHART_COLORS.violet} label="7D Ø" line />
                </>
              }
            >
              {weightChartData.length ? (
                <DualLineChart
                  data={weightChartData}
                  xKey="x"
                  primary={{ dataKey: "weight", name: "kg", color: CHART_COLORS.amber }}
                  secondary={{ dataKey: "avg", name: "7D Ø", color: CHART_COLORS.violet, dashed: true }}
                  height={210}
                  unit="kg"
                  valueFormatter={(v) => v.toFixed(1)}
                />
              ) : (
                <EmptyChart />
              )}
            </ChartPanel>
          </div>

          {/* ── Weitere Metriken (Bestandsdaten im Aqua-Operator-Look) ──────── */}
          <SectionHeader label="Weitere Metriken" />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))",
              gap: 14,
            }}
          >
            {/* Mobility (Walking-Speed) ── StatCard mit Delta */}
            <StatCard
              eyebrow={mobilityTile?.label ?? "Mobility"}
              value={formatValue(mobilityTile?.value, 1)}
              unit={mobilityTile?.unit ?? "km/h"}
              delta={mobilityTile ? makeDelta(mobilityTile) : undefined}
            >
              {mobilityTile?.detail ? (
                <Caption>{mobilityTile.detail}</Caption>
              ) : (
                <Caption>Walking-Speed im Zeitraum</Caption>
              )}
            </StatCard>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
              gap: 16,
            }}
          >
            {/* Aktivitaet & Floors ── gestapelte kcal-Balken + Floors-Linie */}
            <ChartPanel
              title="Aktivität & Floors"
              right={
                <>
                  <LegendItem color={CHART_COLORS.indigo} label="Ruhe kcal" />
                  <LegendItem color={CHART_COLORS.amber} label="Aktiv kcal" />
                  <LegendItem color={CHART_COLORS.teal} label="Floors" line />
                </>
              }
            >
              {activeFloorsData.length ? (
                <StackedBarLineChart
                  data={activeFloorsData}
                  xKey="x"
                  bars={[
                    { dataKey: "resting_kcal", name: "Ruhe kcal", color: CHART_COLORS.indigo },
                    { dataKey: "active_kcal", name: "Aktiv kcal", color: CHART_COLORS.amber },
                  ]}
                  line={{ dataKey: "floors", name: "Floors", color: CHART_COLORS.teal }}
                  height={210}
                  valueFormatter={(v) => v.toFixed(0)}
                />
              ) : (
                <EmptyChart />
              )}
            </ChartPanel>

            {/* Efficiency-Trend ── Index (rechte Achse) + Stairs (Balken) */}
            <ChartPanel
              title="Efficiency-Trend"
              right={
                <>
                  <LegendItem color={CHART_COLORS.violet} label="Stairs ▲" />
                  <LegendItem color={CHART_COLORS.coral} label="Stairs ▼" />
                  <LegendItem color={CHART_COLORS.teal} label="Index" line />
                </>
              }
            >
              {efficiencyData.length ? (
                <ComboChart
                  data={efficiencyData}
                  xKey="x"
                  dualAxis
                  bars={[
                    { dataKey: "stair_up", name: "Stairs ▲", color: CHART_COLORS.violet },
                    { dataKey: "stair_down", name: "Stairs ▼", color: CHART_COLORS.coral },
                  ]}
                  line={{ dataKey: "efficiency_index", name: "Index", color: CHART_COLORS.teal }}
                  height={210}
                  leftFormatter={(v) => v.toFixed(0)}
                  rightFormatter={(v) => v.toFixed(1)}
                />
              ) : (
                <EmptyChart />
              )}
            </ChartPanel>
          </div>

          {/* ── Progress Notes ──────────────────────────────────────────────── */}
          {data.notes && (
            <>
              <SectionHeader label="Progress Notes" />
              <Card>
                {data.notes.length === 0 ? (
                  <p style={{ color: "var(--text-mid)", fontSize: 13 }}>
                    Keine datengetriebenen Hinweise im aktuellen Zeitraum.
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
                    {data.notes.map((note) => (
                      <li
                        key={note}
                        style={{
                          padding: "8px 12px",
                          borderRadius: "var(--radius-card)",
                          background: "var(--raised)",
                          color: "var(--soft)",
                          fontSize: 13,
                          borderLeft: "3px solid var(--teal)",
                        }}
                      >
                        {note}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
