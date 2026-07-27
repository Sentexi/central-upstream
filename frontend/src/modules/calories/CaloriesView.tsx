import React, { useEffect, useMemo, useState } from "react";
import {
  PageHeader,
  SegmentedControl,
  StatCard,
  SectionHeader,
  ProgressBar,
  Badge,
  Button,
  Card,
} from "../../core/ui";
import type { SegmentedControlOption } from "../../core/ui";
import {
  StackedBarLineChart,
  LineAreaChart,
  CHART_COLORS,
} from "../../core/charts";

// ── Mahlzeit-Typen ─────────────────────────────────────────────────────────────
const TYPE_LABELS: Record<string, string> = {
  breakfast: "Frühstück",
  lunch: "Mittag",
  dinner: "Abendessen",
  softdrink: "Drinks",
  snack: "Snack",
};

// Daten-Spektrum-Farben (Hex aus den Tokens, fuer Charts/Swatches).
const TYPE_COLORS: Record<string, string> = {
  breakfast: CHART_COLORS.teal,
  lunch: CHART_COLORS.green,
  dinner: CHART_COLORS.amber,
  softdrink: CHART_COLORS.indigo,
  snack: CHART_COLORS.coral,
};

// Schnell-Pills setzen den Mahlzeit-Typ vor (Praefix im Freitext).
const QUICK_PILLS: Array<{ type: keyof typeof TYPE_LABELS; label: string }> = [
  { type: "breakfast", label: "+ Frühstück" },
  { type: "lunch", label: "+ Mittag" },
  { type: "snack", label: "+ Snack" },
  { type: "dinner", label: "+ Abendessen" },
];

// Tagesziel (Default). Das Calories-Backend liefert kein Ziel, daher konstanter
// Referenzwert wie im Mockup ("Ziel 2.200").
const DAILY_GOAL = 2200;

type MealEntry = {
  id: number;
  date: string;
  timestamp?: string | null;
  raw_text: string;
  name?: string | null;
  amount_g?: number | null;
  kcal?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  protein_g?: number | null;
  caffeine_mg?: number | null;
  type?: keyof typeof TYPE_LABELS | null;
  status: "draft" | "saved" | "import";
  source: "manual" | "llm" | "upload";
  llm_model?: string | null;
  import_batch_id?: string | null;
  created_at: string;
  updated_at: string;
};

type SummaryDay = {
  date: string;
  types: Record<string, number>;
  total_kcal: number;
  macros: {
    carbs_g: number;
    fat_g: number;
    protein_g: number;
    caffeine_mg: number;
  };
};

type SummaryResponse = {
  days: SummaryDay[];
  totals: SummaryDay["macros"] & { kcal: number };
  range: { date_from: string; date_to: string };
};

type ImportBatch = {
  import_batch_id: string;
  count: number;
  first_date?: string;
  last_date?: string;
  created_at?: string;
};

type KeyStatus = { has_key: boolean; is_valid: boolean; last_checked_at?: string | null };

const RANGE_OPTIONS = [
  { value: "today", label: "Heute" },
  { value: "7d", label: "7 Tage" },
  { value: "14d", label: "14 Tage" },
  { value: "30d", label: "30 Tage" },
] satisfies SegmentedControlOption[];

const todayString = () => new Date().toISOString().slice(0, 10);

const formatNumber = (value?: number | null, unit = "") =>
  value === undefined || value === null ? "–" : `${Math.round(value)}${unit}`;

/** Tausender-Trennung mit Punkt (z. B. 1840 -> "1.840"). */
const formatKcal = (value?: number | null): string => {
  if (value === undefined || value === null || Number.isNaN(value)) return "–";
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

/** Vorzeichenbehaftete Tausender-Trennung (z. B. -540 -> "−540"). */
const formatSignedKcal = (value: number): string => {
  const sign = value < 0 ? "−" : value > 0 ? "+" : "";
  return `${sign}${formatKcal(Math.abs(value))}`;
};

const formatTime = (ts?: string | null) => {
  if (!ts) return "";
  const parsed = new Date(ts);
  if (Number.isNaN(parsed.getTime())) return ts;
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const formatDate = (dateValue: string) => {
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return dateValue;
  return parsed.toLocaleDateString();
};

/** X-Achsen-Label: "2026-06-23" -> "23.6". */
const shortDate = (d: string): string => {
  const parts = d.split("-");
  if (parts.length !== 3) return d;
  return `${Number(parts[2])}.${Number(parts[1])}`;
};

// ── Kleine Bausteine (Aqua-Operator-Look) ──────────────────────────────────────

function Caption({ children }: { children: React.ReactNode }) {
  return <p style={{ marginTop: 9, fontSize: 11, color: "var(--text-mid)" }}>{children}</p>;
}

function LegendItem({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-mid)" }}>
      <span
        style={{
          width: line ? 11 : 9,
          height: line ? 2 : 9,
          borderRadius: 2,
          background: color,
          flex: "none",
        }}
      />
      {label}
    </span>
  );
}

function DashedLegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-mid)" }}>
      <span style={{ width: 13, borderTop: `2px dashed ${color}`, flex: "none" }} />
      {label}
    </span>
  );
}

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
        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-high)" }}>{title}</span>
        {right ? <div style={{ display: "flex", alignItems: "center", gap: 13 }}>{right}</div> : null}
      </div>
      {children}
    </Card>
  );
}

function EmptyChart() {
  return (
    <p style={{ color: "var(--text-mid)", fontSize: 13, padding: "24px 0" }}>
      Keine gespeicherten Einträge im Zeitraum.
    </p>
  );
}

/** Mono-Label mit Teal-Punkt (z. B. "QUICK CAPTURE · KI-EXTRAKTION"). */
function MonoDotLabel({ children, color = "var(--teal)" }: { children: React.ReactNode; color?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 9.5,
        letterSpacing: "0.1em",
        color,
        textTransform: "uppercase",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flex: "none" }} />
      {children}
    </div>
  );
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────

export function CaloriesView() {
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<MealEntry[]>([]);
  const [dayEntries, setDayEntries] = useState<MealEntry[]>([]);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [range, setRange] = useState<(typeof RANGE_OPTIONS)[number]["value"]>("today");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imports, setImports] = useState<ImportBatch[]>([]);
  const [importError, setImportError] = useState<string | null>(null);

  const disableInput = status ? !status.is_valid : false;

  const loadStatus = async () => {
    try {
      const res = await fetch("/api/calories/settings/status");
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      console.error("Key status failed", err);
      setStatus({ has_key: false, is_valid: false, last_checked_at: undefined });
    }
  };

  const loadDrafts = async () => {
    try {
      const res = await fetch("/api/calories/drafts");
      const data = await res.json();
      setDrafts(data.drafts ?? []);
    } catch (err) {
      console.error("Drafts failed", err);
    }
  };

  const loadSummary = async (nextRange = range) => {
    try {
      const res = await fetch(`/api/calories/summary?range=${nextRange}`);
      const data = await res.json();
      setSummary(data);
    } catch (err) {
      console.error("Summary failed", err);
    }
  };

  const loadImports = async () => {
    try {
      const res = await fetch("/api/calories/imports?limit=5");
      const data = await res.json();
      setImports(data.imports ?? []);
    } catch (err) {
      console.error("Import batches failed", err);
    }
  };

  const loadDayEntries = async (day: string) => {
    try {
      const res = await fetch(`/api/calories/day/${day}`);
      const data = await res.json();
      if (data.ok) {
        setDayEntries(data.entries ?? []);
      }
    } catch (err) {
      console.error("Day entries failed", err);
    }
  };

  useEffect(() => {
    loadStatus();
    loadDrafts();
    loadSummary();
    loadImports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadSummary(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { text, date: todayString() };
      const res = await fetch("/api/calories/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Eingabe konnte nicht verarbeitet werden");
        return;
      }
      setText("");
      await loadDrafts();
      setError(data.llm_error ?? null);
    } catch (err) {
      console.error("Submit failed", err);
      setError("Netzwerkfehler bei der Eingabe");
    } finally {
      setSubmitting(false);
    }
  };

  /** Schnell-Pill: Mahlzeit-Typ als Praefix in den Freitext setzen. */
  const applyQuickPill = (label: string) => {
    const prefix = `${label.replace(/^\+\s*/, "")}: `;
    setText((prev) => (prev.startsWith(prefix) ? prev : prefix + prev.replace(/^[^:]+:\s*/, "")));
  };

  const acceptDraft = async (id: number) => {
    await fetch(`/api/calories/drafts/${id}/accept`, { method: "POST" });
    await Promise.all([loadDrafts(), loadSummary()]);
    if (selectedDay) {
      loadDayEntries(selectedDay);
    }
  };

  const deleteDraft = async (id: number) => {
    await fetch(`/api/calories/drafts/${id}`, { method: "DELETE" });
    await loadDrafts();
  };

  const deleteEntry = async (id: number) => {
    await fetch(`/api/calories/entry/${id}`, { method: "DELETE" });
    if (selectedDay) {
      loadDayEntries(selectedDay);
    }
    loadSummary();
  };

  const handleImportFile = async (file: File) => {
    setImportError(null);
    try {
      const fileText = await file.text();
      const json = JSON.parse(fileText);
      const res = await fetch("/api/calories/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setImportError(data.error ?? "Import fehlgeschlagen");
        return;
      }
      loadImports();
      loadSummary();
    } catch (err) {
      console.error("Import failed", err);
      setImportError("Ungültige Datei oder Netzwerkfehler");
    }
  };

  // ── Abgeleitete Werte ─────────────────────────────────────────────────────────

  const days = summary?.days ?? [];

  /** Letzter Tag der Serie (oder der heutige, falls vorhanden). */
  const todayDay = useMemo<SummaryDay | null>(() => {
    if (!days.length) return null;
    const today = todayString();
    return days.find((d) => d.date === today) ?? days[days.length - 1];
  }, [days]);

  const intakeToday = todayDay?.total_kcal ?? 0;
  const intakePct = DAILY_GOAL > 0 ? (intakeToday / DAILY_GOAL) * 100 : 0;
  const balanceToday = intakeToday - DAILY_GOAL; // negativ = Defizit gegen Ziel

  /** Ø Aufnahme pro Tag im Zeitraum (totals.kcal / Anzahl Tage). */
  const avgIntake = useMemo(() => {
    if (!summary || !days.length) return null;
    return summary.totals.kcal / days.length;
  }, [summary, days]);

  // Makros heute (gestapelter Balken Protein/Carbs/Fett + Werte).
  const macrosToday = todayDay?.macros ?? { protein_g: 0, carbs_g: 0, fat_g: 0, caffeine_mg: 0 };
  const macroSum = macrosToday.protein_g + macrosToday.carbs_g + macrosToday.fat_g;
  const macroPct = (g: number) => (macroSum > 0 ? (g / macroSum) * 100 : 0);

  // Stacked-Chart: Mahlzeit-Typen je Tag (gestapelt) + Intake-Linie (teal).
  // Das Calories-Backend liefert keine Ruhe/Aktiv-Burn-Werte, daher stapeln wir
  // die realen Mahlzeit-Typen statt Ruhe/Aktiv. Intake bleibt die Teal-Linie.
  const presentTypes = useMemo(() => {
    const keys = Object.keys(TYPE_LABELS).filter((t) =>
      days.some((d) => (d.types?.[t] ?? 0) > 0),
    );
    return keys.length ? keys : Object.keys(TYPE_LABELS);
  }, [days]);

  const stackData = useMemo(
    () =>
      days.map((d) => {
        const row: Record<string, unknown> = { x: shortDate(d.date), intake: d.total_kcal };
        for (const t of presentTypes) row[t] = d.types?.[t] ?? 0;
        return row;
      }),
    [days, presentTypes],
  );

  // Goal-Chart: Intake-Flaeche/-Linie (amber) + Ziel als Referenz.
  const goalData = useMemo(
    () => days.map((d) => ({ x: shortDate(d.date), intake: d.total_kcal, goal: DAILY_GOAL })),
    [days],
  );

  // Letzte Mahlzeiten (aus dem heutigen/letzten Tag via day-Endpunkt).
  const [recentMeals, setRecentMeals] = useState<MealEntry[]>([]);
  useEffect(() => {
    const day = todayDay?.date;
    if (!day) {
      setRecentMeals([]);
      return;
    }
    let mounted = true;
    fetch(`/api/calories/day/${day}`)
      .then((res) => res.json())
      .then((data) => {
        if (mounted && data.ok) setRecentMeals(data.entries ?? []);
      })
      .catch((err) => console.error("Recent meals failed", err));
    return () => {
      mounted = false;
    };
  }, [todayDay?.date]);

  // Burn ist in diesem Modul nicht verfuegbar -> Bilanz gegen Tagesziel.
  const balanceTone: "pos" | "neg" | "neutral" =
    balanceToday < 0 ? "pos" : balanceToday > 0 ? "neg" : "neutral";
  const balanceLabel = balanceToday < 0 ? "Defizit" : balanceToday > 0 ? "Überschuss" : "Im Ziel";

  return (
    <div className="app-grid">
      {/* ── PageHeader ─────────────────────────────────────────────────────────── */}
      <PageHeader
        eyebrow="NUTRITION"
        title="Kalorien"
        subtitle="Intake per Sprache erfassen, Bilanz und Makros im Blick."
        right={
          <SegmentedControl
            options={RANGE_OPTIONS}
            value={range}
            onChange={(v) => setRange(v as (typeof RANGE_OPTIONS)[number]["value"])}
          />
        }
      />

      {/* ── Quick Capture ──────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: "16px 18px",
          borderRadius: "var(--radius-card)",
          background: "linear-gradient(120deg, var(--panel), var(--nav-active))",
          border: "1px solid var(--border-strong)",
        }}
      >
        <div style={{ marginBottom: 11 }}>
          <MonoDotLabel>Quick Capture · KI-Extraktion</MonoDotLabel>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div
            style={{
              flex: 1,
              minWidth: 260,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 12px",
              borderRadius: "var(--radius-input)",
              background: "var(--sidebar-bg)",
              border: "1px solid var(--border-strong)",
              opacity: disableInput ? 0.6 : 1,
            }}
          >
            {/* Mikro-Icon */}
            <svg
              width="16"
              height="16"
              viewBox="0 0 18 18"
              fill="none"
              stroke="var(--text-low)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flex: "none" }}
            >
              <path d="M9 2v9" />
              <path d="M6 5a3 3 0 0 0 6 0" />
              <rect x="6" y="11" width="6" height="5" rx="2" />
            </svg>
            <input
              className="input"
              type="text"
              placeholder={"Mahlzeit beschreiben – z. B. „2 Eier, Vollkorntoast, schwarzer Kaffee“"}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={disableInput}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !submitting && !disableInput) handleSubmit();
              }}
              style={{
                border: "none",
                background: "transparent",
                padding: 0,
                fontSize: 13.5,
                color: "var(--text-high)",
              }}
            />
          </div>
          <Button onClick={handleSubmit} disabled={submitting || disableInput}>
            {submitting ? "Wird verarbeitet…" : "Erfassen"}
          </Button>
        </div>

        {/* Schnell-Pills (Mahlzeit-Typ vorsetzen) */}
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {QUICK_PILLS.map((pill) => (
            <button
              key={pill.type}
              type="button"
              onClick={() => applyQuickPill(pill.label)}
              disabled={disableInput}
              style={{
                fontSize: 11.5,
                color: "var(--soft)",
                padding: "5px 11px",
                borderRadius: "var(--radius-pill)",
                background: "var(--nav-hover)",
                border: "1px solid var(--border-strong)",
                cursor: disableInput ? "not-allowed" : "pointer",
                fontFamily: "'Space Grotesk', sans-serif",
              }}
            >
              {pill.label}
            </button>
          ))}
        </div>

        {/* Fehler-/LLM-Status */}
        {error && (
          <div className="settings-error" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
        {status && !status.is_valid && (
          <div className="settings-error" style={{ marginTop: 12 }}>
            LLM Key fehlt oder ist ungültig. Bitte in den Settings testen &amp; speichern.
          </div>
        )}
      </div>

      {/* ── Heute-Summary ──────────────────────────────────────────────────────── */}
      <SectionHeader label="Heute" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(195px, 1fr))", gap: 14 }}>
        {/* Aufgenommen (Amber) */}
        <StatCard eyebrow="Aufgenommen" value={formatKcal(intakeToday)} unit="kcal" accent="var(--amber)">
          <ProgressBar value={intakePct} from="var(--amber)" to="var(--amber-bright)" />
          <Caption>
            Ziel {formatKcal(DAILY_GOAL)} · {Math.round(intakePct)} %
          </Caption>
        </StatCard>

        {/* Verbrannt (Indigo) ── keine Burn-Daten im Calories-Modul */}
        <StatCard eyebrow="Verbrannt" value="–" unit="kcal" accent="var(--indigo)">
          <Caption>Keine Burn-Daten in diesem Modul</Caption>
        </StatCard>

        {/* Bilanz (Green) ── Aufnahme gegen Tagesziel */}
        <StatCard
          eyebrow="Bilanz"
          value={formatSignedKcal(balanceToday)}
          unit="kcal"
          accent="var(--green)"
          delta={{ text: balanceLabel, tone: balanceTone }}
        >
          <Caption>
            {balanceToday < 0 ? "Im Zielkorridor" : "Gegen Tagesziel"}
          </Caption>
        </StatCard>

        {/* Ø 7 Tage (Teal) */}
        <StatCard eyebrow="Ø Zeitraum" value={avgIntake == null ? "–" : formatKcal(avgIntake)} unit="kcal" accent="var(--teal)">
          <Caption>Aufnahme pro Tag</Caption>
        </StatCard>
      </div>

      {/* ── Verlauf (2 Charts) ─────────────────────────────────────────────────── */}
      <SectionHeader label="Verlauf" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 16 }}>
        {/* Kalorienuebersicht ── gestapelte Mahlzeit-Typen + Intake-Linie */}
        <ChartPanel
          title="Kalorienübersicht"
          right={
            <>
              {presentTypes.map((t) => (
                <LegendItem key={t} color={TYPE_COLORS[t] ?? CHART_COLORS.indigo} label={TYPE_LABELS[t] ?? t} />
              ))}
              <LegendItem color={CHART_COLORS.teal} label="Intake" line />
            </>
          }
        >
          {stackData.length ? (
            <StackedBarLineChart
              data={stackData}
              xKey="x"
              bars={presentTypes.map((t) => ({
                dataKey: t,
                name: TYPE_LABELS[t] ?? t,
                color: TYPE_COLORS[t] ?? CHART_COLORS.indigo,
              }))}
              line={{ dataKey: "intake", name: "Intake", color: CHART_COLORS.teal }}
              height={210}
              valueFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`)}
            />
          ) : (
            <EmptyChart />
          )}
        </ChartPanel>

        {/* Aufnahme vs. Ziel ── Amber-Flaeche+Linie + Ziel (gestrichelt, Text-Low) */}
        <ChartPanel
          title="Aufnahme vs. Ziel"
          right={
            <>
              <LegendItem color={CHART_COLORS.amber} label="Intake" line />
              <DashedLegendItem color={CHART_COLORS.textLow} label={`Ziel ${formatKcal(DAILY_GOAL)}`} />
            </>
          }
        >
          {goalData.length ? (
            <LineAreaChart
              data={goalData}
              dataKey="intake"
              xKey="x"
              color={CHART_COLORS.amber}
              height={210}
              unit="kcal"
              valueFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`)}
              referenceY={DAILY_GOAL}
              referenceColor={CHART_COLORS.textLow}
            />
          ) : (
            <EmptyChart />
          )}
        </ChartPanel>
      </div>

      {/* ── Makros & Mahlzeiten ────────────────────────────────────────────────── */}
      <SectionHeader label="Makros & Mahlzeiten" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16 }}>
        {/* Makros heute ── gestapelter Balken + 3 Werte */}
        <Card style={{ padding: "20px 22px" }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-high)" }}>Makros heute</div>
          <div style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", marginTop: 16, background: "var(--track)" }}>
            <div style={{ width: `${macroPct(macrosToday.protein_g)}%`, background: CHART_COLORS.teal }} />
            <div style={{ width: `${macroPct(macrosToday.carbs_g)}%`, background: CHART_COLORS.amber }} />
            <div style={{ width: `${macroPct(macrosToday.fat_g)}%`, background: CHART_COLORS.coral }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, gap: 12 }}>
            <MacroValue color={CHART_COLORS.teal} label="Protein" grams={macrosToday.protein_g} />
            <MacroValue color={CHART_COLORS.amber} label="Carbs" grams={macrosToday.carbs_g} />
            <MacroValue color={CHART_COLORS.coral} label="Fett" grams={macrosToday.fat_g} />
          </div>
          {macrosToday.caffeine_mg > 0 && (
            <Caption>Koffein {formatNumber(macrosToday.caffeine_mg, " mg")}</Caption>
          )}
        </Card>

        {/* Letzte Mahlzeiten ── Mono-Zeit | Beschreibung | kcal (Amber) */}
        <Card style={{ padding: "20px 22px" }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-high)", marginBottom: 14 }}>
            Letzte Mahlzeiten
          </div>
          {recentMeals.length === 0 ? (
            <p style={{ color: "var(--text-mid)", fontSize: 13 }}>Keine Mahlzeiten für diesen Tag.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {recentMeals.map((meal) => (
                <div key={meal.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      color: "var(--text-low)",
                      width: 44,
                      flex: "none",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {meal.timestamp ? formatTime(meal.timestamp) : "—"}
                  </span>
                  <div style={{ flex: 1, fontSize: 13, color: "var(--soft)" }}>
                    {meal.name ?? meal.raw_text}
                  </div>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 12.5,
                      color: "var(--amber)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatNumber(meal.kcal)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ════════════════════════════════════════════════════════════════════════
           Bestandsfunktionen (Entscheidung 2): vollstaendig erhalten, neuer Look.
         ════════════════════════════════════════════════════════════════════════ */}

      {/* ── Draft-Review ───────────────────────────────────────────────────────── */}
      <SectionHeader label="Entwürfe (KI-Extraktion)" />
      <Card>
        {drafts.length === 0 ? (
          <p style={{ color: "var(--text-mid)", fontSize: 13 }}>Keine Entwürfe vorhanden.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
            {drafts.map((draft) => (
              <div
                key={draft.id}
                style={{
                  padding: 16,
                  borderRadius: "var(--radius-card)",
                  background: "var(--raised)",
                  border: "1px solid var(--border)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div>
                    <div
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 9.5,
                        letterSpacing: "0.1em",
                        color: "var(--text-low)",
                        textTransform: "uppercase",
                      }}
                    >
                      {draft.type ? TYPE_LABELS[draft.type] ?? draft.type : "unbekannt"}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-high)", marginTop: 4 }}>
                      {draft.name ?? "Ohne Name"}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-mid)", marginTop: 3 }}>{draft.raw_text}</div>
                  </div>
                  <Badge tone="warning">{draft.status}</Badge>
                </div>
                <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                  <MiniMetric label="Kcal" value={formatNumber(draft.kcal)} />
                  <MiniMetric
                    label="Makros"
                    value={`C ${formatNumber(draft.carbs_g, "g")} · F ${formatNumber(draft.fat_g, "g")} · P ${formatNumber(draft.protein_g, "g")}`}
                  />
                  <MiniMetric label="Zeit" value={`${draft.date} ${formatTime(draft.timestamp)}`.trim()} />
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <Button onClick={() => acceptDraft(draft.id)}>Übernehmen</Button>
                  <Button variant="secondary" onClick={() => deleteDraft(draft.id)}>
                    Verwerfen
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Tagesbearbeitung ───────────────────────────────────────────────────── */}
      <SectionHeader label="Tagesbearbeitung" />
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: selectedDay ? 14 : 0 }}>
          <span style={{ fontSize: 13, color: "var(--text-mid)" }}>Tag wählen:</span>
          <input
            type="date"
            className="input"
            value={selectedDay ?? todayString()}
            onChange={(e) => {
              setSelectedDay(e.target.value);
              loadDayEntries(e.target.value);
            }}
            style={{ width: "auto" }}
          />
          {selectedDay && (
            <Button variant="secondary" onClick={() => setSelectedDay(null)}>
              Schließen
            </Button>
          )}
        </div>

        {selectedDay &&
          (dayEntries.length === 0 ? (
            <p style={{ color: "var(--text-mid)", fontSize: 13 }}>
              Keine Einträge für {formatDate(selectedDay)}.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {dayEntries.map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "12px 0",
                    borderTop: "1px solid var(--row-divider)",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, color: "var(--text-high)" }}>{entry.name ?? "Ohne Name"}</div>
                    <div style={{ fontSize: 12, color: "var(--text-mid)" }}>{entry.raw_text}</div>
                  </div>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 12.5,
                      color: "var(--amber)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatNumber(entry.kcal)}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-mid)", whiteSpace: "nowrap" }}>
                    C {formatNumber(entry.carbs_g, "g")} · F {formatNumber(entry.fat_g, "g")} · P{" "}
                    {formatNumber(entry.protein_g, "g")}
                  </span>
                  <Badge tone="neutral">
                    {entry.status} / {entry.source}
                  </Badge>
                  <Button variant="secondary" onClick={() => deleteEntry(entry.id)}>
                    Löschen
                  </Button>
                </div>
              ))}
            </div>
          ))}
      </Card>

      {/* ── Importe ────────────────────────────────────────────────────────────── */}
      <SectionHeader label="Importe" />
      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          <MonoDotLabel>JSON-Upload</MonoDotLabel>
          <label style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
            <input
              type="file"
              accept="application/json,.json"
              className="input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleImportFile(file);
                event.target.value = "";
              }}
              style={{ width: "auto" }}
            />
            <span style={{ fontSize: 12, color: "var(--text-mid)" }}>Array von Entries hochladen (JSON).</span>
          </label>
          {importError && <div className="settings-error">{importError}</div>}
        </div>

        {imports.length === 0 ? (
          <p style={{ color: "var(--text-mid)", fontSize: 13 }}>Noch keine Importe vorhanden.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 0.6fr 1.2fr",
                gap: 14,
                padding: "0 0 8px",
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 9.5,
                letterSpacing: "0.1em",
                color: "var(--text-low)",
                textTransform: "uppercase",
              }}
            >
              <div>Batch</div>
              <div>Anzahl</div>
              <div>Zeitraum</div>
            </div>
            {imports.map((imp) => (
              <div
                key={imp.import_batch_id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 0.6fr 1.2fr",
                  gap: 14,
                  padding: "10px 0",
                  borderTop: "1px solid var(--row-divider)",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 12,
                    color: "var(--text-high)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {imp.import_batch_id}
                </div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: "var(--text-mid)" }}>
                  {imp.count}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-mid)" }}>
                  {imp.first_date ?? "?"} – {imp.last_date ?? "?"}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Mini-Bausteine fuer Bestands-Sektionen ─────────────────────────────────────

function MacroValue({ color, label, grams }: { color: string; label: string; grams: number }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: color, flex: "none" }} />
        <span style={{ fontSize: 12, color: "var(--text-mid)" }}>{label}</span>
      </div>
      <div
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 19,
          fontWeight: 600,
          color: "var(--text-high)",
          marginTop: 5,
        }}
      >
        {formatNumber(grams)} g
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 9.5,
          letterSpacing: "0.1em",
          color: "var(--text-low)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13, color: "var(--soft)", marginTop: 5 }}>{value}</div>
    </div>
  );
}
