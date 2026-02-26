import React, { useEffect, useMemo, useState } from "react";
import { GlassCard } from "../../core/GlassCard";

const TYPE_LABELS: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  softdrink: "Drinks",
  snack: "Snack",
};

const TYPE_COLORS: Record<string, string> = {
  breakfast: "#60a5fa",
  lunch: "#34d399",
  dinner: "#f59e0b",
  softdrink: "#a855f7",
  snack: "#f472b6",
};

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

type VapeDay = { date: string; delta: number; coil_change?: boolean };
type VapeSeries = {
  days: VapeDay[];
  total: number;
  average: number;
  events: string[];
  latest: { counter: number; timestamp: string } | null;
};

type ImportBatch = {
  import_batch_id: string;
  count: number;
  first_date?: string;
  last_date?: string;
  created_at?: string;
};

type KeyStatus = { has_key: boolean; is_valid: boolean; last_checked_at?: string | null };

const RANGE_OPTIONS = ["today", "7d", "14d", "30d"] as const;

const todayString = () => new Date().toISOString().slice(0, 10);

const formatNumber = (value?: number | null, unit = "") =>
  value === undefined || value === null ? "–" : `${Math.round(value)}${unit}`;

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

function PercentBar({
  day,
  maxKcal,
  onSelect,
  selected,
}: {
  day: SummaryDay;
  maxKcal: number;
  onSelect: (date: string) => void;
  selected: boolean;
}) {
  const total = day.total_kcal || 0;
  const height = maxKcal > 0 ? Math.max(12, (total / maxKcal) * 180) : 12;

  return (
    <button
      type="button"
      className={`stacked-bar ${selected ? "is-active" : ""}`}
      onClick={() => onSelect(day.date)}
      aria-label={`Details für ${day.date}`}
    >
      <div className="stacked-bar__stack" style={{ height }}>
        {Object.entries(TYPE_COLORS).map(([key, color]) => {
          const value = day.types[key] ?? 0;
          const pct = total > 0 ? (value / total) * 100 : 0;
          return (
            <span
              key={key}
              className="stacked-bar__segment"
              style={{ height: `${pct}%`, background: color }}
              title={`${TYPE_LABELS[key] ?? key}: ${Math.round(value)} kcal`}
            />
          );
        })}
      </div>
      <span className="stacked-bar__label">{day.date.slice(5)}</span>
      <span className="stacked-bar__value">{Math.round(total)} kcal</span>
    </button>
  );
}

function VapeBar({
  day,
  maxDelta,
  average,
}: {
  day: VapeDay;
  maxDelta: number;
  average: number;
}) {
  const height = maxDelta > 0 ? Math.max(10, (day.delta / maxDelta) * 140) : 10;
  const isCoil = Boolean(day.coil_change);
  const avgBottom = average > 0 ? (average / (maxDelta || average)) * 140 : 0;
  return (
    <div className="vape-bar" title={`${day.date}: +${day.delta}`}>
      <div
        className={`vape-bar__fill ${isCoil ? "is-coil" : ""}`}
        style={{ height }}
        aria-label={`Vape Delta ${day.delta}`}
      />
      {average > 0 && (
        <div
          className="vape-bar__avg"
          style={{ bottom: `${avgBottom}px` }}
          aria-hidden
        />
      )}
      <span className="vape-bar__label">{day.date.slice(5)}</span>
    </div>
  );
}

export function CaloriesView() {
  const [text, setText] = useState("");
  const [dateValue, setDateValue] = useState(todayString());
  const [useTimestamp, setUseTimestamp] = useState(false);
  const [drafts, setDrafts] = useState<MealEntry[]>([]);
  const [dayEntries, setDayEntries] = useState<MealEntry[]>([]);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [range, setRange] = useState<(typeof RANGE_OPTIONS)[number]>("7d");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vapeCounter, setVapeCounter] = useState("");
  const [vapeSeries, setVapeSeries] = useState<VapeSeries | null>(null);
  const [imports, setImports] = useState<ImportBatch[]>([]);
  const [importError, setImportError] = useState<string | null>(null);

  const disableInput = status ? !status.is_valid : false;

  const maxKcal = useMemo(
    () => (summary ? Math.max(...summary.days.map((d) => d.total_kcal || 0), 0) : 0),
    [summary]
  );
  const maxVapeDelta = useMemo(
    () => (vapeSeries ? Math.max(...vapeSeries.days.map((d) => d.delta || 0), 0) : 0),
    [vapeSeries]
  );

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

  const loadVape = async (nextRange = range) => {
    try {
      const res = await fetch(`/api/vape/series?range=${nextRange}`);
      const data = await res.json();
      setVapeSeries(data);
    } catch (err) {
      console.error("Failed to load vape series", err);
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
    loadVape();
    loadImports();
  }, []);

  useEffect(() => {
    loadSummary(range);
    loadVape(range);
  }, [range]);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { text, date: dateValue };
      if (useTimestamp) payload.timestamp = new Date().toISOString();
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

  const acceptDraft = async (id: number) => {
    await fetch(`/api/calories/drafts/${id}/accept`, { method: "POST" });
    await Promise.all([loadDrafts(), loadSummary()]);
    if (selectedDay) {
      loadDayEntries(selectedDay);
    }
  };

  const deleteDraft = async (id: number) => {
    if (!window.confirm("Diesen Entwurf wirklich löschen?")) return;
    await fetch(`/api/calories/drafts/${id}`, { method: "DELETE" });
    await loadDrafts();
  };

  const deleteEntry = async (id: number) => {
    if (!window.confirm("Diesen Eintrag wirklich löschen?")) return;
    await fetch(`/api/calories/entry/${id}`, { method: "DELETE" });
    if (selectedDay) {
      loadDayEntries(selectedDay);
    }
    loadSummary();
  };

  const handleImportFile = async (file: File) => {
    setImportError(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
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

  const submitVape = async () => {
    if (!vapeCounter) return;
    try {
      await fetch("/api/vape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ counter: Number(vapeCounter) }),
      });
      setVapeCounter("");
      loadVape();
    } catch (err) {
      console.error("Vape submit failed", err);
    }
  };

  const dailyDeltaToday = useMemo(() => {
    const today = todayString();
    return vapeSeries?.days.find((d) => d.date === today)?.delta ?? null;
  }, [vapeSeries]);

  return (
    <div className="stack">
      <GlassCard className="capture-card" glow>
        <div className="capture-grid">
          <div className="stack">
            <label className="settings-label">Food/Drink Text</label>
            <textarea
              className="input input--textarea"
              rows={4}
              placeholder="z.B. 2 Scheiben Brot mit Erdnussbutter und 1 Cappuccino"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={disableInput}
            />
            {error && <div className="settings-error">{error}</div>}
            {!status?.is_valid && (
              <div className="settings-error">
                LLM Key fehlt oder ist ungültig. Bitte in den Settings testen &amp; speichern.
              </div>
            )}
          </div>
          <div className="stack">
            <label className="settings-label">Datum &amp; Zeit</label>
            <div className="inline-fields">
              <input
                type="date"
                className="input"
                value={dateValue}
                onChange={(e) => setDateValue(e.target.value)}
              />
              <label className="field-boolean">
                <input
                  type="checkbox"
                  checked={useTimestamp}
                  onChange={(e) => setUseTimestamp(e.target.checked)}
                />
                <span>Timestamp auf jetzt setzen</span>
              </label>
            </div>
            <div className="inline-fields">
              <button
                className="button"
                type="button"
                onClick={handleSubmit}
                disabled={submitting || disableInput}
              >
                {submitting ? "Wird verarbeitet..." : "Analysieren & Entwürfe erstellen"}
              </button>
              <button className="button secondary" type="button" onClick={loadDrafts}>
                Entwürfe aktualisieren
              </button>
            </div>
          </div>
        </div>
      </GlassCard>

      <div className="grid-cards">
        <GlassCard className="chart-panel">
          <div className="chart-panel__header">
            <div>
              <span className="kicker">Entwürfe</span>
              <h3 className="card-title">Extrahierte Einträge</h3>
            </div>
          </div>
          {drafts.length === 0 ? (
            <p className="muted">Keine Entwürfe vorhanden.</p>
          ) : (
            <div className="draft-grid">
              {drafts.map((draft) => (
                <div className="draft-card" key={draft.id}>
                  <div className="draft-card__header">
                    <div>
                      <div className="kicker">{draft.type ?? "unbekannt"}</div>
                      <h4 className="card-title">{draft.name ?? "Ohne Name"}</h4>
                      <div className="muted small">{draft.raw_text}</div>
                    </div>
                    <div className="pill">{draft.status}</div>
                  </div>
                  <div className="metric-split">
                    <div>
                      <div className="metric-label">Kcal</div>
                      <div className="metric-value">{formatNumber(draft.kcal)}</div>
                    </div>
                    <div>
                      <div className="metric-label">Makros</div>
                      <div className="muted small">
                        C {formatNumber(draft.carbs_g, "g")} · F {formatNumber(draft.fat_g, "g")} ·
                        P {formatNumber(draft.protein_g, "g")}
                      </div>
                    </div>
                    <div>
                      <div className="metric-label">Zeit</div>
                      <div className="muted small">
                        {draft.date} {formatTime(draft.timestamp)}
                      </div>
                    </div>
                  </div>
                  <div className="inline-fields">
                    <button className="button" onClick={() => acceptDraft(draft.id)} type="button">
                      Übernehmen
                    </button>
                    <button
                      className="button tertiary"
                      onClick={() => deleteDraft(draft.id)}
                      type="button"
                    >
                      Löschen
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        <GlassCard className="chart-panel">
          <div className="chart-panel__header">
            <div>
              <span className="kicker">Kalorien</span>
              <h3 className="card-title">Tagesübersicht</h3>
            </div>
            <div className="chart-controls">
              {RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  className={`chip ${range === opt ? "is-active" : ""}`}
                  onClick={() => setRange(opt)}
                  type="button"
                >
                  {opt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          {!summary || summary.days.length === 0 ? (
            <p className="muted">Keine gespeicherten Einträge im Zeitraum.</p>
          ) : (
            <>
              <div className="legend">
                {Object.entries(TYPE_COLORS).map(([key, color]) => (
                  <span key={key} className="legend-item">
                    <span className="legend-dot" style={{ background: color }} aria-hidden />
                    {TYPE_LABELS[key] ?? key}
                  </span>
                ))}
              </div>
              <div className="stacked-bars">
                {summary.days.map((day) => (
                  <PercentBar
                    key={day.date}
                    day={day}
                    maxKcal={maxKcal}
                    onSelect={(d) => {
                      setSelectedDay(d);
                      loadDayEntries(d);
                    }}
                    selected={selectedDay === day.date}
                  />
                ))}
              </div>
              <div className="metric-split">
                <div>
                  <div className="metric-label">Totals</div>
                  <div className="metric-value">{formatNumber(summary.totals.kcal)} kcal</div>
                </div>
                <div>
                  <div className="metric-label">Makros</div>
                  <div className="muted small">
                    C {formatNumber(summary.totals.carbs_g, "g")} · F{" "}
                    {formatNumber(summary.totals.fat_g, "g")} · P{" "}
                    {formatNumber(summary.totals.protein_g, "g")}
                  </div>
                </div>
                <div>
                  <div className="metric-label">Caffeine</div>
                  <div className="muted small">{formatNumber(summary.totals.caffeine_mg, "mg")}</div>
                </div>
              </div>
            </>
          )}
        </GlassCard>
      </div>

      {selectedDay && (
        <GlassCard className="chart-panel">
          <div className="chart-panel__header">
            <div>
              <span className="kicker">Einträge</span>
              <h3 className="card-title">Einträge am {formatDate(selectedDay)}</h3>
            </div>
            <button className="button tertiary" onClick={() => setSelectedDay(null)} type="button">
              Schließen
            </button>
          </div>
          {dayEntries.length === 0 ? (
            <p className="muted">Keine Einträge für diesen Tag.</p>
          ) : (
            <div className="table">
              <div className="table-head">
                <div>Bezeichnung</div>
                <div>Kcal</div>
                <div>Makros</div>
                <div>Status</div>
                <div />
              </div>
              {dayEntries.map((entry) => (
                <div className="table-row" key={entry.id}>
                  <div>
                    <div className="card-title small">{entry.name ?? "Ohne Name"}</div>
                    <div className="muted small">{entry.raw_text}</div>
                  </div>
                  <div>{formatNumber(entry.kcal)}</div>
                  <div className="muted small">
                    C {formatNumber(entry.carbs_g, "g")} · F {formatNumber(entry.fat_g, "g")} · P{" "}
                    {formatNumber(entry.protein_g, "g")}
                  </div>
                  <div className="pill">
                    {entry.status} / {entry.source}
                  </div>
                  <div>
                    <button
                      className="button tertiary"
                      type="button"
                      onClick={() => deleteEntry(entry.id)}
                    >
                      Löschen
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      )}

      <div className="grid-cards">
        <GlassCard className="chart-panel">
          <div className="chart-panel__header">
            <div>
              <span className="kicker">Vape</span>
              <h3 className="card-title">Deltas &amp; Coil Changes</h3>
            </div>
            <div className="inline-fields">
              <input
                className="input"
                type="number"
                placeholder="Aktueller Counter"
                value={vapeCounter}
                onChange={(e) => setVapeCounter(e.target.value)}
              />
              <button className="button" type="button" onClick={submitVape}>
                Speichern
              </button>
            </div>
          </div>
          {!vapeSeries || vapeSeries.days.length === 0 ? (
            <p className="muted">Noch keine Vape-Einträge vorhanden.</p>
          ) : (
            <>
              <div className="legend">
                <span className="legend-dot legend-dot--blue" aria-hidden /> Tages-Deltas
                <span className="legend-dot legend-dot--red" aria-hidden /> Coil Change
              </div>
              <div className="vape-chart">
                {vapeSeries.days.map((day) => (
                  <VapeBar
                    key={day.date}
                    day={day}
                    maxDelta={maxVapeDelta}
                    average={vapeSeries.average}
                  />
                ))}
              </div>
              <div className="metric-split">
                <div>
                  <div className="metric-label">Average</div>
                  <div className="metric-value">{formatNumber(vapeSeries.average)}</div>
                </div>
                <div>
                  <div className="metric-label">Last Counter</div>
                  <div className="muted small">
                    {vapeSeries.latest?.counter ?? "–"} @{" "}
                    {vapeSeries.latest ? formatTime(vapeSeries.latest.timestamp) : "–"}
                  </div>
                </div>
                <div>
                  <div className="metric-label">Delta heute</div>
                  <div className="muted small">{dailyDeltaToday ?? "–"}</div>
                </div>
              </div>
              {vapeSeries.events.length > 0 && (
                <div className="pill warning">
                  Coil change detected: {vapeSeries.events.join(", ")}
                </div>
              )}
            </>
          )}
        </GlassCard>

        <GlassCard className="chart-panel">
          <div className="chart-panel__header">
            <div>
              <span className="kicker">Importe</span>
              <h3 className="card-title">JSON-Datei hochladen</h3>
            </div>
          </div>
          <label className="manual-import__controls">
            <input
              type="file"
              accept="application/json,.json"
              className="input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  handleImportFile(file);
                }
                event.target.value = "";
              }}
            />
            <span className="muted small">Lade eine JSON-Datei mit Einträgen hoch.</span>
          </label>
          {importError && <div className="settings-error">{importError}</div>}
          <div className="table import-table">
            <div className="table-head">
              <div>Import-ID</div>
              <div>Anzahl</div>
              <div>Zeitraum</div>
            </div>
            {imports.length === 0 ? (
              <div className="muted small">Noch keine Importe vorhanden.</div>
            ) : (
              imports.map((imp) => (
                <div className="table-row" key={imp.import_batch_id}>
                  <div className="card-title small">{imp.import_batch_id}</div>
                  <div>{imp.count}</div>
                  <div className="muted small">
                    {imp.first_date ?? "?"} – {imp.last_date ?? "?"}
                  </div>
                </div>
              ))
            )}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
