import { useEffect, useMemo, useState } from "react";
import { CheckIcon, TrendingUpIcon } from "lucide-react";
import { fetchTaskDashboardStats } from "./api";
import type { DailyFlow, HeatmapPoint, TaskDashboardStats, WorkspaceOpen } from "./types";
import { PageHeader, SegmentedControl, SectionHeader, Card } from "../../core/ui";
import { ComboChart } from "../../core/charts";
import { CHART_COLORS } from "../../core/charts/chartTheme";

type FlowView = "7d" | "14d" | "30d" | "60d" | "90d" | "ytd" | "previous-years";

const flowViewOptions = [
  { value: "7d", label: "7d" },
  { value: "14d", label: "14d" },
  { value: "30d", label: "30d" },
  { value: "60d", label: "60d" },
  { value: "90d", label: "90d" },
  { value: "ytd", label: "YTD" },
  { value: "previous-years", label: "Vorjahre" },
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

function formatDateLabel(date: string) {
  const d = new Date(date);
  return d.toLocaleDateString("de-DE", { month: "short", day: "numeric" });
}

function startOfWeek(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day + 6) % 7;
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
  const s = start.toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
  const e = end.toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
  return `${s} – ${e}`;
}

function formatMonthLabel(date: Date) {
  return date.toLocaleDateString("de-DE", { month: "short", year: "numeric" });
}

type ChartDatum = {
  id: string;
  label: string;
  done: number;
  created: number;
  netCumulative: number;
};

type RawBucket = {
  id: string;
  label: string;
  done: number;
  created: number;
};

function buildComboData(flow: DailyFlow[], view: FlowView, minuteMode: boolean): ChartDatum[] {
  const getDone = (e: DailyFlow) => minuteMode ? (e.completed_minutes ?? 0) : e.completed;
  const getCreated = (e: DailyFlow) => minuteMode ? (e.created_minutes ?? 0) : e.created;

  let raw: RawBucket[];

  if (view === "7d" || view === "14d") {
    raw = flow.map((entry) => ({
      id: entry.date,
      label: formatDateLabel(entry.date),
      done: getDone(entry),
      created: getCreated(entry),
    }));
  } else if (view === "previous-years" || view === "ytd") {
    const buckets = new Map<string, { done: number; created: number; start: Date }>();
    flow.forEach((entry) => {
      const d = new Date(entry.date);
      const start = new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1));
      const key = start.toISOString().slice(0, 7);
      const bucket = buckets.get(key) ?? { done: 0, created: 0, start };
      bucket.done += getDone(entry);
      bucket.created += getCreated(entry);
      buckets.set(key, bucket);
    });
    raw = Array.from(buckets.entries())
      .map(([key, b]) => ({
        id: key,
        label: formatMonthLabel(b.start),
        done: b.done,
        created: b.created,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  } else {
    const buckets = new Map<string, { done: number; created: number; start: Date }>();
    flow.forEach((entry) => {
      const start = startOfWeek(new Date(entry.date));
      const key = start.toISOString().slice(0, 10);
      const bucket = buckets.get(key) ?? { done: 0, created: 0, start };
      bucket.done += getDone(entry);
      bucket.created += getCreated(entry);
      buckets.set(key, bucket);
    });
    raw = Array.from(buckets.entries())
      .map(([key, b]) => ({
        id: key,
        label: formatWeekLabel(b.start),
        done: b.done,
        created: b.created,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  let cumulative = 0;
  return raw.map((item) => {
    cumulative += item.created - item.done;
    return { ...item, netCumulative: cumulative };
  });
}

// ---- Heatmap (retained from original) ----

const heatmapDayOrder = [1, 2, 3, 4, 5, 6, 0];
const heatmapDayLabels = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const bigint = parseInt(normalized, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

function HeatmapChart({ data, color, label }: { data: HeatmapPoint[]; color: string; label: string }) {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const valueMap = new Map(data.map((entry) => [`${entry.weekday}-${entry.hour}`, entry.count]));
  const maxValue = data.length > 0 ? Math.max(...data.map((d) => d.count)) : 0;
  const { r, g, b } = hexToRgb(color);
  const normalizer = maxValue || 1;

  function cellColor(value: number) {
    const intensity = value === 0 ? 0.06 : 0.06 + (value / normalizer) * 0.9;
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
                const value = valueMap.get(`${weekday}-${hour}`) ?? 0;
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
        <span className="muted small">Niedrig</span>
        <div
          className="heatmap-legend-bar"
          style={{
            background: `linear-gradient(90deg, rgba(${r}, ${g}, ${b}, 0.06), rgba(${r}, ${g}, ${b}, 0.9))`,
          }}
        />
        <span className="muted small">Hoch</span>
      </div>
    </div>
  );
}

// ---- Workspace bars ----

function WorkspaceBars({ data }: { data: WorkspaceOpen[] }) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
      {data.map((item) => {
        const pct = (item.count / maxCount) * 100;
        return (
          <div key={item.workspace} style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 90,
                flex: "none",
                fontSize: 13,
                color: "var(--soft)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.workspace}
            </div>
            <div
              style={{
                flex: 1,
                height: 10,
                borderRadius: 5,
                background: "var(--track)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${pct}%`,
                  borderRadius: 5,
                  background: `linear-gradient(90deg, ${CHART_COLORS.indigo}, ${CHART_COLORS.indigoBright})`,
                }}
              />
            </div>
            <div
              style={{
                width: 34,
                textAlign: "right",
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 13,
                color: "var(--text-high)",
                whiteSpace: "nowrap",
              }}
            >
              {formatNumber(item.count)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Chart legend ----

function ChartLegend({ minuteMode }: { minuteMode: boolean }) {
  return (
    <div style={{ display: "flex", gap: 13, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-mid)" }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: CHART_COLORS.green, flexShrink: 0 }} />
        Done{minuteMode ? " (geschätzte Min.)" : ""}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-mid)" }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: CHART_COLORS.coral, flexShrink: 0 }} />
        Created{minuteMode ? " (geschätzte Min.)" : ""}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-mid)" }}>
        <span style={{ width: 11, height: 2, borderRadius: 2, background: CHART_COLORS.amber, flexShrink: 0 }} />
        Net kumul.
      </span>
    </div>
  );
}

// ---- Reusable KPI card footer ----

function KpiFooter({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 14,
        paddingTop: 13,
        borderTop: "1px solid var(--border)",
        fontSize: 11.5,
        color: "var(--text-mid)",
      }}
    >
      {children}
    </div>
  );
}

function KpiValue({ color, children }: { color?: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 14,
        fontFamily: "'IBM Plex Mono', monospace",
        fontWeight: 600,
        color: color ?? "var(--text-high)",
        fontSize: 34,
        lineHeight: 1.05,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </div>
  );
}

function MonoHighlight({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ color: "var(--text-high)", fontFamily: "'IBM Plex Mono', monospace" }}>
      {children}
    </span>
  );
}

function formatKLabel(v: number) {
  if (Math.abs(v) >= 1000) return `${Math.round(v / 100) / 10}k`;
  return String(Math.round(v));
}

function formatNetLabel(v: number) {
  return (v >= 0 ? "+" : "") + Math.round(v).toLocaleString("de-DE");
}

// ---- Main component ----

export function NotionTaskDashboard() {
  const [stats, setStats] = useState<TaskDashboardStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<FlowView>("30d");
  const [heatmapMode, setHeatmapMode] = useState<"created" | "completed">("created");

  useEffect(() => {
    setLoading(true);
    fetchTaskDashboardStats()
      .then((data) => {
        setStats(data);
        setError(null);
        if (data.creation_heatmap.length === 0 && data.completion_heatmap.length > 0) {
          setHeatmapMode("completed");
        }
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

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

    const daysMap: Record<string, number> = { "7d": 7, "14d": 14, "30d": 30, "60d": 60, "90d": 90 };
    const days = daysMap[view] ?? 30;
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

  const countChartData = useMemo(
    () => buildComboData(filteredFlow, view, false),
    [filteredFlow, view],
  );

  const minuteChartData = useMemo(
    () => buildComboData(filteredFlow, view, true),
    [filteredFlow, view],
  );

  const netFlowValue = periodTotals.created - periodTotals.completed;
  const periodLabel = flowViewLabels[view];
  const openTotal = stats ? stats.summary.open_active + stats.summary.open_outbound : 0;

  const creationHeatmap = stats?.creation_heatmap ?? [];
  const completionHeatmap = stats?.completion_heatmap ?? [];
  const activeHeatmap = heatmapMode === "created" ? creationHeatmap : completionHeatmap;
  const activeHeatmapLabel = heatmapMode === "created" ? "Created" : "Done";
  const activeHeatmapColor = heatmapMode === "created" ? CHART_COLORS.coral : CHART_COLORS.green;
  const hasHeatmapData = creationHeatmap.length > 0 || completionHeatmap.length > 0;

  const workspaceData = useMemo(() => {
    const data = stats?.open_by_workspace ?? [];
    if (data.length <= 6) return data;
    const top = data.slice(0, 5);
    const rest = data.slice(5);
    const otherTotal = rest.reduce((acc, item) => acc + item.count, 0);
    return [...top, { workspace: "Sonstiges", count: otherTotal }];
  }, [stats]);

  const comboBars = [
    { dataKey: "done", name: "Done", color: CHART_COLORS.green },
    { dataKey: "created", name: "Created", color: CHART_COLORS.coral },
  ];
  const comboLine = { dataKey: "netCumulative", name: "Net kumul.", color: CHART_COLORS.amber };

  const eyebrowStyle: React.CSSProperties = {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 9.5,
    letterSpacing: "0.1em",
    color: "var(--text-low)",
    textTransform: "uppercase",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Page Header */}
      <PageHeader
        eyebrow="Notion"
        title="Task Dashboard"
        subtitle="Live-Einblicke aus der Notion-Sync: eingehende vs. erledigte Tasks, Net-Flow und offene Arbeit pro Workspace."
        right={
          <SegmentedControl
            options={flowViewOptions}
            value={view}
            onChange={(v) => setView(v as FlowView)}
          />
        }
      />

      {loading && (
        <p style={{ marginTop: 24, color: "var(--text-mid)" }}>Dashboard lädt...</p>
      )}
      {error && (
        <div
          style={{
            marginTop: 24,
            padding: "12px 16px",
            borderRadius: "var(--radius-card)",
            background: "var(--error-fill)",
            border: "1px solid var(--error-border)",
            color: "var(--error-text)",
            fontSize: 13,
            fontFamily: "'IBM Plex Mono', monospace",
          }}
        >
          {error}
        </div>
      )}

      {stats && (
        <>
          {/* KPI Grid */}
          <SectionHeader label="Überblick" />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
              gap: 14,
            }}
          >
            {/* Offene Tasks */}
            <Card accent="var(--indigo)">
              <div style={eyebrowStyle}>Offene Tasks</div>
              <div style={{ fontSize: 11.5, color: "var(--text-mid)", marginTop: 5 }}>
                Tatsächlich offen
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontWeight: 600,
                  color: "var(--text-high)",
                  fontSize: 34,
                  lineHeight: 1.05,
                  whiteSpace: "nowrap",
                }}
              >
                {formatNumber(stats.summary.open_active)}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 18,
                  marginTop: 14,
                  paddingTop: 13,
                  borderTop: "1px solid var(--border)",
                }}
              >
                <div>
                  <div style={{ fontSize: 10.5, color: "var(--text-low)" }}>Extern (Outbound)</div>
                  <div
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 18,
                      fontWeight: 600,
                      color: "var(--text-high)",
                      marginTop: 2,
                    }}
                  >
                    {formatNumber(stats.summary.open_outbound)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: "var(--text-low)" }}>Geplant</div>
                  <div
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 18,
                      fontWeight: 600,
                      color: "var(--text-mid)",
                      marginTop: 2,
                    }}
                  >
                    {formatNumber(stats.summary.scheduled ?? 0)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: "var(--text-low)" }}>Gesamt</div>
                  <div
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 18,
                      fontWeight: 600,
                      color: "var(--text-mid)",
                      marginTop: 2,
                    }}
                  >
                    {formatNumber(openTotal)}
                  </div>
                </div>
              </div>
            </Card>

            {/* Erledigt */}
            <Card accent="var(--green)">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={eyebrowStyle}>Erledigt · {periodLabel}</span>
                <CheckIcon size={15} color={CHART_COLORS.green} strokeWidth={2} />
              </div>
              <KpiValue color="var(--green)">{formatNumber(periodTotals.completed)}</KpiValue>
              <KpiFooter>
                Gesamt: <MonoHighlight>{formatNumber(stats.summary.completed)}</MonoHighlight>
              </KpiFooter>
            </Card>

            {/* Erstellt */}
            <Card accent="var(--coral)">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={eyebrowStyle}>Erstellt · {periodLabel}</span>
                <TrendingUpIcon size={15} color={CHART_COLORS.coral} strokeWidth={2} />
              </div>
              <KpiValue color="var(--coral)">{formatNumber(periodTotals.created)}</KpiValue>
              <KpiFooter>
                Gesamt: <MonoHighlight>{formatNumber(stats.summary.created)}</MonoHighlight>
              </KpiFooter>
            </Card>

            {/* Net-Flow */}
            <Card accent="var(--amber)">
              <div style={eyebrowStyle}>Aktueller Net-Flow</div>
              <KpiValue color="var(--amber)">
                {netFlowValue >= 0 ? "+" : ""}
                {formatNumber(netFlowValue)}
              </KpiValue>
              <KpiFooter>
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 2,
                      background: "var(--amber)",
                      flexShrink: 0,
                    }}
                  />
                  {netFlowValue > 0
                    ? "Backlog wächst"
                    : netFlowValue < 0
                      ? "Backlog schrumpft"
                      : "Ausgeglichen"}{" "}
                  · Ansicht {periodLabel}
                </span>
              </KpiFooter>
            </Card>
          </div>

          {/* Combo Charts */}
          {(countChartData.length > 0 || minuteChartData.length > 0) && (
            <>
              <SectionHeader label="Durchsatz" />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
                  gap: 16,
                }}
              >
                {countChartData.length > 0 && (
                  <Card>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        marginBottom: 6,
                        flexWrap: "wrap",
                        gap: 8,
                      }}
                    >
                      <div>
                        <div style={eyebrowStyle}>Inflow vs. Done</div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-high)", marginTop: 2 }}>
                          Durchsatz &amp; Net-Flow
                        </div>
                      </div>
                      <ChartLegend minuteMode={false} />
                    </div>
                    <ComboChart
                      data={countChartData}
                      xKey="label"
                      bars={comboBars}
                      line={comboLine}
                      height={220}
                      dualAxis
                      leftFormatter={(v) => String(Math.round(v))}
                      rightFormatter={formatNetLabel}
                    />
                  </Card>
                )}

                {minuteChartData.length > 0 && (
                  <Card>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        marginBottom: 6,
                        flexWrap: "wrap",
                        gap: 8,
                      }}
                    >
                      <div>
                        <div style={eyebrowStyle}>Erfüllungsaufwand (geschätzte Minuten)</div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-high)", marginTop: 2 }}>
                          Aufwand rein vs. raus &amp; Net-Flow
                        </div>
                      </div>
                      <ChartLegend minuteMode />
                    </div>
                    <ComboChart
                      data={minuteChartData}
                      xKey="label"
                      bars={comboBars}
                      line={comboLine}
                      height={220}
                      dualAxis
                      leftFormatter={formatKLabel}
                      rightFormatter={(v) => (v >= 0 ? "+" : "") + formatKLabel(v)}
                    />
                  </Card>
                )}
              </div>
            </>
          )}

          {/* Workspace Bars */}
          {workspaceData.length > 0 && (
            <>
              <SectionHeader label="Offene Tasks nach Workspace" />
              <Card>
                <WorkspaceBars data={workspaceData} />
              </Card>
            </>
          )}

          {/* Heatmap (retained) */}
          {hasHeatmapData && (
            <>
              <SectionHeader label="Aktivität nach Wochentag & Stunde" />
              <Card>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 14,
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 11.5, color: "var(--text-mid)" }}>Zeitliche Verteilung</div>
                  <SegmentedControl
                    options={[
                      { value: "created", label: "Created" },
                      { value: "completed", label: "Done" },
                    ]}
                    value={heatmapMode}
                    onChange={(v) => setHeatmapMode(v as "created" | "completed")}
                  />
                </div>
                {activeHeatmap.length > 0 ? (
                  <HeatmapChart
                    data={activeHeatmap}
                    color={activeHeatmapColor}
                    label={activeHeatmapLabel}
                  />
                ) : (
                  <p style={{ color: "var(--text-mid)", fontSize: 13 }}>
                    Keine Daten für diesen Modus verfügbar.
                  </p>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
