import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, RefreshCw, Search } from "lucide-react";
import { Badge, Button, PageHeader, SectionHeader, SegmentedControl } from "../../core/ui";
import { Heatmap } from "../../core/charts";
import type { HeatmapMatrix } from "../../core/charts";
import {
  fetchColumns,
  fetchRows,
  fetchSyncStatus,
  fetchTaskDashboardStats,
  triggerSync,
} from "./api";
import type {
  HeatmapPoint,
  NotionColumn,
  NotionRow,
  RelationLink,
  SyncResult,
  SyncStatus,
  TaskDashboardStats,
} from "./types";

/* ------------------------------------------------------------------ */
/* Dynamisches Spalten-Mapping                                         */
/* ------------------------------------------------------------------ */

/**
 * Logische Felder, die der Work-Screen darstellt. Die echten Notion-Spalten
 * sind dynamisch, daher loesen wir sie wie das Backend (_resolve_column)
 * ueber Kandidatenlisten auf: Treffer per normalisiertem Label ODER per
 * generiertem Spalten-Key.
 */
type SemanticField = "title" | "status" | "priority" | "due" | "type" | "workspace";

const FIELD_CANDIDATES: Record<SemanticField, string[]> = {
  title: ["title", "name", "task", "aufgabe", "todo"],
  status: ["status", "state", "zustand"],
  priority: ["priority", "prio", "prioritaet", "priorität"],
  due: ["due_date", "due", "faellig", "fällig", "deadline", "due_at", "due_on", "termin"],
  type: ["type", "typ", "kind", "category", "kategorie"],
  workspace: ["workspace", "area", "team", "project", "projekt", "bereich"],
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

/** Findet den Spalten-Key (NotionColumn.key) fuer ein logisches Feld. */
function resolveField(columns: NotionColumn[], field: SemanticField): NotionColumn | undefined {
  const candidates = new Set(FIELD_CANDIDATES[field].map(normalize));
  for (const column of columns) {
    if (!column.key) continue;
    const key = normalize(column.key);
    const label = normalize(column.label || "");
    if (candidates.has(key) || candidates.has(label)) {
      return column;
    }
  }
  return undefined;
}

type FieldMap = Partial<Record<SemanticField, NotionColumn>>;

function buildFieldMap(columns: NotionColumn[]): FieldMap {
  const map: FieldMap = {};
  (Object.keys(FIELD_CANDIDATES) as SemanticField[]).forEach((field) => {
    const match = resolveField(columns, field);
    if (match) map[field] = match;
  });
  return map;
}

/* ------------------------------------------------------------------ */
/* Wert-Extraktion und Praesentation                                   */
/* ------------------------------------------------------------------ */

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Ja" : "Nein";
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === "object") {
          const rel = item as RelationLink & Record<string, unknown>;
          return String(rel.title ?? rel.id ?? "");
        }
        return stringifyValue(item);
      })
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "object") {
    const rel = value as RelationLink & Record<string, unknown>;
    return String(rel.title ?? rel.id ?? "");
  }
  return String(value);
}

function cellText(row: NotionRow, column?: NotionColumn): string {
  if (!column) return "";
  return stringifyValue(row[column.key]);
}

type StatusTone = "done" | "blocked" | "inprogress" | "open";

const DONE_KEYWORDS = ["done", "complete", "closed", "finished", "resolved", "erledigt", "fertig"];
const BLOCKED_KEYWORDS = ["block", "blockiert", "warten", "waiting", "hold", "stuck"];
const PROGRESS_KEYWORDS = ["progress", "doing", "active", "aktiv", "laufend", "wip", "started"];

function statusTone(value: string): StatusTone {
  const v = value.toLowerCase();
  if (DONE_KEYWORDS.some((k) => v.includes(k))) return "done";
  if (BLOCKED_KEYWORDS.some((k) => v.includes(k))) return "blocked";
  if (PROGRESS_KEYWORDS.some((k) => v.includes(k))) return "inprogress";
  return "open";
}

/** Status-Punkt-Farbe je Tonalitaet (8px Punkt vor der Zeile). */
const STATUS_DOT: Record<StatusTone, string> = {
  done: "var(--green)",
  blocked: "var(--error)",
  inprogress: "var(--indigo-bright)",
  open: "var(--text-low)",
};

type PriorityTone = "high" | "medium" | "low" | "none";

const PRIORITY_HIGH = ["high", "hoch", "urgent", "dringend", "critical", "1", "p1"];
const PRIORITY_MEDIUM = ["medium", "mittel", "normal", "2", "p2"];
const PRIORITY_LOW = ["low", "niedrig", "gering", "3", "p3"];

function priorityTone(value: string): PriorityTone {
  const v = value.toLowerCase().trim();
  if (!v) return "none";
  if (PRIORITY_HIGH.some((k) => v === k || v.includes(k))) return "high";
  if (PRIORITY_MEDIUM.some((k) => v === k || v.includes(k))) return "medium";
  if (PRIORITY_LOW.some((k) => v === k || v.includes(k))) return "low";
  return "none";
}

const PRIORITY_COLOR: Record<Exclude<PriorityTone, "none">, string> = {
  high: "var(--coral)",
  medium: "var(--amber)",
  low: "var(--teal)",
};

/** Faelligkeit als kurzes TT.MM, sonst Rohwert. Liefert overdue-Flag. */
function formatDue(value: string): { text: string; overdue: boolean } {
  if (!value) return { text: "—", overdue: false };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { text: value, overdue: false };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(parsed);
  due.setHours(0, 0, 0, 0);
  const text = parsed.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  return { text, overdue: due.getTime() < today.getTime() };
}

function isRowDone(row: NotionRow, fields: FieldMap): boolean {
  if (row.archived) return true;
  const status = cellText(row, fields.status);
  return status ? statusTone(status) === "done" : false;
}

/* ------------------------------------------------------------------ */
/* Heatmap-Normalisierung                                              */
/* ------------------------------------------------------------------ */

/**
 * HeatmapPoint{weekday,hour,count} -> 7x24 Matrix mit Werten 0..1 (max-basiert).
 * Backend liefert weekday im strftime('%w')-Schema (0=Sonntag). Wir mappen auf
 * Mo..So, damit Reihenfolge und Heatmap-Komponente uebereinstimmen.
 */
function buildHeatmapMatrix(points: HeatmapPoint[]): HeatmapMatrix {
  const matrix: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  if (!points || points.length === 0) return matrix;

  let max = 0;
  for (const point of points) {
    // %w: 0=So..6=Sa  ->  Mo=0..So=6
    const dayIndex = (point.weekday + 6) % 7;
    const hour = point.hour;
    if (dayIndex < 0 || dayIndex > 6 || hour < 0 || hour > 23) continue;
    matrix[dayIndex][hour] += point.count;
    if (matrix[dayIndex][hour] > max) max = matrix[dayIndex][hour];
  }

  if (max <= 0) return matrix;
  for (let d = 0; d < 7; d += 1) {
    for (let h = 0; h < 24; h += 1) {
      matrix[d][h] = matrix[d][h] / max;
    }
  }
  return matrix;
}

function hasHeatmapData(points: HeatmapPoint[] | undefined): boolean {
  return Boolean(points && points.some((p) => p.count > 0));
}

/* ------------------------------------------------------------------ */
/* Sortier-Optionen                                                    */
/* ------------------------------------------------------------------ */

type SortOption = {
  value: string;
  label: string;
  /** logisches Feld; "last_edited" nutzt die Backend-Default-Spalte. */
  field?: SemanticField;
  column?: string;
  direction: "asc" | "desc";
};

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

const TABLE_GRID = "24px 2.4fr 1.1fr 0.9fr 0.8fr 1fr 1fr";

export function NotionTodosView() {
  const [columns, setColumns] = useState<NotionColumn[]>([]);
  const [rows, setRows] = useState<NotionRow[]>([]);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sortValue, setSortValue] = useState("last_edited");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [limit] = useState(50);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [heatmapMode, setHeatmapMode] = useState<"created" | "done">("created");
  const [stats, setStats] = useState<TaskDashboardStats | null>(null);

  const syncPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);

  const fields = useMemo(() => buildFieldMap(columns), [columns]);

  /* ---- Debounce der Suche ---- */
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query), 350);
    return () => clearTimeout(handle);
  }, [query]);

  /* ---- Spalten laden ---- */
  useEffect(() => {
    fetchColumns()
      .then((data) => setColumns(data.filter((col) => Boolean(col.key))))
      .catch((err) => console.error("Failed to load columns", err));
  }, []);

  /* ---- Sortier-Optionen aus dem Mapping ableiten ---- */
  const sortOptions = useMemo<SortOption[]>(() => {
    const options: SortOption[] = [
      { value: "last_edited", label: "Zuletzt bearbeitet", direction: "desc" },
      { value: "created_desc", label: "Zuletzt erstellt", column: "created_time", direction: "desc" },
    ];
    if (fields.due) {
      options.push({ value: "due_asc", label: "Fälligkeit (nächste zuerst)", field: "due", direction: "asc" });
    }
    if (fields.title) {
      options.push({ value: "title_asc", label: "Titel (A–Z)", field: "title", direction: "asc" });
    }
    if (fields.priority) {
      options.push({ value: "priority_desc", label: "Priorität", field: "priority", direction: "desc" });
    }
    return options;
  }, [fields]);

  const activeSort = useMemo(
    () => sortOptions.find((option) => option.value === sortValue) ?? sortOptions[0],
    [sortOptions, sortValue]
  );

  /* ---- Sort-String fuer die rows-Query bauen ---- */
  const sortParam = useMemo(() => {
    if (!activeSort || activeSort.value === "last_edited") return undefined;
    const column = activeSort.column ?? (activeSort.field ? fields[activeSort.field]?.key : undefined);
    if (!column) return undefined;
    return `${column}:${activeSort.direction}`;
  }, [activeSort, fields]);

  const params = useMemo(
    () => ({ q: debouncedQuery, sort: sortParam, limit, offset }),
    [debouncedQuery, sortParam, limit, offset]
  );

  /* ---- Rows laden (mit Append bei Pagination) ---- */
  useEffect(() => {
    setLoading(true);
    fetchRows(params)
      .then((data) => {
        setRows((prev) => (params.offset === 0 ? data.items : [...prev, ...data.items]));
        setTotal(data.total);
        setError(null);
      })
      .catch((err) => {
        console.error(err);
        setError("Aufgaben konnten nicht geladen werden.");
      })
      .finally(() => setLoading(false));
  }, [params]);

  /* ---- Heatmap-Stats laden ---- */
  useEffect(() => {
    fetchTaskDashboardStats()
      .then((data) => setStats(data))
      .catch((err) => console.error("Failed to load task stats", err));
  }, []);

  /* ---- Klick ausserhalb schliesst das Sort-Menue ---- */
  useEffect(() => {
    if (!sortMenuOpen) return undefined;
    function handleClick(event: MouseEvent) {
      if (sortMenuRef.current && !sortMenuRef.current.contains(event.target as Node)) {
        setSortMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [sortMenuOpen]);

  function resetAndReload() {
    setOffset(0);
  }

  function updateSyncStatus(status: SyncStatus) {
    setSyncStatus(status);
    if (status.status === "running") setSyncResult(null);
    if (status.result) setSyncResult(status.result);
    if (status.status === "completed" && status.result?.ok) resetAndReload();
    if (status.status === "error" && status.error) setError(status.error);
  }

  function stopSyncPolling() {
    if (syncPollRef.current) {
      clearInterval(syncPollRef.current);
      syncPollRef.current = null;
    }
  }

  function startSyncPolling() {
    if (syncPollRef.current) return;
    syncPollRef.current = setInterval(async () => {
      try {
        const status = await fetchSyncStatus();
        updateSyncStatus(status);
        if (status.status !== "running") stopSyncPolling();
      } catch (err) {
        console.error(err);
        stopSyncPolling();
      }
    }, 1500);
  }

  useEffect(() => {
    fetchSyncStatus()
      .then((status) => {
        updateSyncStatus(status);
        if (status.status === "running") startSyncPolling();
      })
      .catch((err) => console.error("Failed to fetch sync status", err));

    return () => stopSyncPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSync(force_full = false) {
    try {
      setError(null);
      const status = await triggerSync(force_full);
      updateSyncStatus(status);
      if (status.status === "running") startSyncPolling();
    } catch (err) {
      console.error(err);
      setError((err as Error).message);
    }
  }

  const hasMore = offset + limit < total;
  const isSyncing = syncStatus?.status === "running";
  const syncTotal = syncStatus?.total ?? 0;
  const syncProcessed = syncStatus?.processed ?? 0;
  const syncProgress = syncTotal > 0 ? Math.min(100, Math.round((syncProcessed / syncTotal) * 100)) : 0;

  /* ---- Aktive Filter-Pills aus dem Mapping (zeigen, welche Felder die
         Tabelle strukturiert darstellt). "+N" buendelt die uebrigen Spalten. ---- */
  const mappedColumnKeys = useMemo(() => {
    const keys = new Set<string>();
    (Object.values(fields) as NotionColumn[]).forEach((col) => col && keys.add(col.key));
    return keys;
  }, [fields]);

  const filterPills = useMemo(() => {
    const pills: string[] = [];
    if (fields.status) pills.push("Status");
    if (fields.priority) pills.push("Priorität");
    if (fields.due) pills.push("Fällig");
    if (fields.type) pills.push("Typ");
    if (fields.workspace) pills.push("Workspace");
    return pills;
  }, [fields]);

  const extraColumnCount = useMemo(
    () => columns.filter((col) => col.key && !mappedColumnKeys.has(col.key)).length,
    [columns, mappedColumnKeys]
  );

  /* ---- Heatmap-Daten ---- */
  const activeHeatmapPoints = heatmapMode === "created" ? stats?.creation_heatmap : stats?.completion_heatmap;
  const heatmapMatrix = useMemo(
    () => buildHeatmapMatrix(activeHeatmapPoints ?? []),
    [activeHeatmapPoints]
  );
  const heatmapHasData = hasHeatmapData(activeHeatmapPoints);

  const headerRight = (
    <div style={{ display: "flex", gap: 10 }}>
      <Button
        variant="secondary"
        disabled={isSyncing}
        onClick={() => handleSync(false)}
        icon={<RefreshCw size={14} strokeWidth={1.7} aria-hidden />}
      >
        Refresh
      </Button>
      <Button variant="primary" disabled={isSyncing} onClick={() => handleSync(true)}>
        Full Sync
      </Button>
    </div>
  );

  return (
    <>
      <PageHeader
        eyebrow="Notion"
        title="Focus & Projects"
        subtitle="Eine zentrale Sicht auf deine synchronisierten Aufgaben."
        right={headerRight}
      />

      {isSyncing && (
        <div role="status" aria-live="polite" style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "var(--text-low)" }}>
              Sync {syncProcessed}/{syncTotal || "?"} Aufgaben
            </span>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "var(--text-low)" }}>
              {syncProgress}%
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: "var(--track)", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${syncProgress}%`,
                borderRadius: 3,
                background: "linear-gradient(90deg, var(--teal), var(--teal-bright))",
                transition: "width 200ms ease",
              }}
            />
          </div>
        </div>
      )}

      {syncResult && !isSyncing && (
        <Badge tone="success">
          Sync {syncResult.mode} · {syncResult.upserted_count} Eintraege ({syncResult.duration_ms}ms)
        </Badge>
      )}

      {error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "var(--radius-input)",
            border: "1px solid var(--error-border)",
            background: "var(--error-fill)",
            color: "var(--error-text)",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            flex: 1,
            minWidth: 220,
            padding: "10px 14px",
            borderRadius: "var(--radius-input)",
            background: "var(--panel)",
            border: "1px solid var(--border-strong)",
          }}
        >
          <Search size={15} strokeWidth={1.7} color="var(--text-low)" aria-hidden />
          <input
            value={query}
            onChange={(event) => {
              setOffset(0);
              setQuery(event.target.value);
            }}
            placeholder="Suche in allen Textspalten …"
            aria-label="Aufgaben durchsuchen"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--soft)",
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: 13,
            }}
          />
        </label>

        {/* Sortier-Dropdown */}
        <div ref={sortMenuRef} style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setSortMenuOpen((open) => !open)}
            aria-haspopup="listbox"
            aria-expanded={sortMenuOpen}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 14px",
              borderRadius: "var(--radius-input)",
              background: "var(--panel)",
              border: "1px solid var(--border-strong)",
              color: "var(--text-mid)",
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: 13,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Sortieren:{" "}
            <span style={{ color: "var(--text-high)", fontWeight: 600 }}>{activeSort?.label}</span>
            <ChevronDown size={12} strokeWidth={1.8} color="var(--text-low)" aria-hidden />
          </button>
          {sortMenuOpen && (
            <div
              role="listbox"
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                minWidth: 220,
                zIndex: 20,
                padding: 6,
                borderRadius: "var(--radius-input)",
                background: "var(--raised)",
                border: "1px solid var(--border-strong)",
                display: "grid",
                gap: 2,
              }}
            >
              {sortOptions.map((option) => {
                const isActive = option.value === sortValue;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => {
                      setOffset(0);
                      setSortValue(option.value);
                      setSortMenuOpen(false);
                    }}
                    style={{
                      textAlign: "left",
                      padding: "8px 10px",
                      borderRadius: 7,
                      border: "none",
                      background: isActive ? "var(--nav-active)" : "transparent",
                      color: isActive ? "var(--text-high)" : "var(--text-mid)",
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontSize: 13,
                      fontWeight: isActive ? 600 : 500,
                      cursor: "pointer",
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Filter-Pills (zeigen die strukturiert dargestellten Felder) */}
        {filterPills.length > 0 && (
          <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
            {filterPills.map((label) => (
              <Badge key={label} tone="teal">
                {label} ✓
              </Badge>
            ))}
            {extraColumnCount > 0 && <Badge tone="neutral">+ {extraColumnCount}</Badge>}
          </div>
        )}
      </div>

      {/* Tabelle */}
      <div
        style={{
          borderRadius: "var(--radius-card)",
          background: "var(--panel)",
          border: "1px solid var(--border)",
          overflow: "hidden",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 760 }}>
            {/* Header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: TABLE_GRID,
                gap: 14,
                padding: "13px 18px",
                borderBottom: "1px solid var(--border)",
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 9.5,
                letterSpacing: "0.08em",
                color: "var(--text-low)",
                textTransform: "uppercase",
              }}
            >
              <div />
              <div>Aufgabe</div>
              <div>Status</div>
              <div>Priorität</div>
              <div>Fällig</div>
              <div>Typ</div>
              <div>Workspace</div>
            </div>

            {/* Zeilen */}
            {rows.map((row, index) => {
              const rowId = (row.id as string | number | undefined) ?? index;
              const done = isRowDone(row, fields);
              const statusValue = cellText(row, fields.status);
              const tone = statusValue ? statusTone(statusValue) : "open";
              const dotColor = STATUS_DOT[tone];
              const title = cellText(row, fields.title) || "Ohne Titel";
              const prioValue = cellText(row, fields.priority);
              const prio = priorityTone(prioValue);
              const due = formatDue(cellText(row, fields.due));
              const typeValue = cellText(row, fields.type);
              const workspaceValue = cellText(row, fields.workspace);
              const isLast = index === rows.length - 1;

              return (
                <div
                  key={rowId}
                  className="notion-work-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: TABLE_GRID,
                    gap: 14,
                    padding: "14px 18px",
                    borderBottom: isLast ? "none" : "1px solid var(--row-divider)",
                    alignItems: "center",
                    transition: "background 120ms ease",
                  }}
                >
                  <div>
                    <span
                      style={{
                        display: "block",
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: dotColor,
                      }}
                    />
                  </div>
                  <div
                    style={{
                      fontSize: 13.5,
                      fontWeight: 500,
                      color: done ? "var(--text-mid)" : "var(--text-high)",
                      textDecoration: done ? "line-through" : "none",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={title}
                  >
                    {title}
                  </div>
                  <div>
                    {statusValue ? (
                      <Badge tone={tone}>{statusValue}</Badge>
                    ) : (
                      <span style={{ color: "var(--text-faint)", fontSize: 12 }}>—</span>
                    )}
                  </div>
                  <div>
                    {prio === "none" ? (
                      <span style={{ color: "var(--text-faint)", fontSize: 12 }}>—</span>
                    ) : (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 12,
                          color: PRIORITY_COLOR[prio],
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: PRIORITY_COLOR[prio],
                          }}
                        />
                        {prioValue}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 12,
                      whiteSpace: "nowrap",
                      color: due.overdue ? "var(--error-text)" : "var(--soft)",
                    }}
                  >
                    {due.text}
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: "var(--text-mid)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={typeValue || undefined}
                  >
                    {typeValue || "—"}
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: "var(--text-mid)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={workspaceValue || undefined}
                  >
                    {workspaceValue || "—"}
                  </div>
                </div>
              );
            })}

            {!loading && rows.length === 0 && (
              <div style={{ padding: "28px 18px", color: "var(--text-mid)", fontSize: 13.5 }}>
                {error ? "—" : "Keine Aufgaben gefunden. Starte mit einem Refresh oder Full Sync."}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Load more / Lade-Status */}
      {(hasMore || loading) && (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {hasMore && (
            <Button
              variant="secondary"
              disabled={loading}
              onClick={() => setOffset((current) => current + limit)}
            >
              Mehr laden
            </Button>
          )}
          {loading && (
            <span style={{ color: "var(--text-mid)", fontSize: 13 }}>Lädt …</span>
          )}
        </div>
      )}

      {/* Heatmap */}
      <SectionHeader label="Zeitliche Verteilung" />
      <div
        style={{
          padding: "20px 22px",
          borderRadius: "var(--radius-card)",
          background: "var(--panel)",
          border: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 18,
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-high)" }}>
            Aktivität nach Wochentag & Stunde
          </div>
          <SegmentedControl
            value={heatmapMode}
            onChange={(value) => setHeatmapMode(value as "created" | "done")}
            options={[
              { value: "created", label: "Created" },
              { value: "done", label: "Done" },
            ]}
          />
        </div>

        {heatmapHasData ? (
          <Heatmap matrix={heatmapMatrix} />
        ) : (
          <div style={{ padding: "24px 0", color: "var(--text-mid)", fontSize: 13.5 }}>
            {stats === null
              ? "Heatmap-Daten werden geladen …"
              : heatmapMode === "created"
              ? "Noch keine Erstellungsdaten für die Heatmap vorhanden."
              : "Noch keine Erledigungsdaten für die Heatmap vorhanden."}
          </div>
        )}
      </div>
    </>
  );
}
