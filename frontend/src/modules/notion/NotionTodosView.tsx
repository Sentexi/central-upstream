import { useEffect, useMemo, useState } from "react";
import { GlassCard } from "../../core/GlassCard";
import { fetchColumns, fetchRows, fetchSyncStatus, triggerSync } from "./api";
import type { NotionColumn, NotionRow, RelationLink, SyncResult, SyncStatus } from "./types";

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map((v) => formatValue(v)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function renderRelation(value: unknown): JSX.Element | string {
  if (!Array.isArray(value) || value.length === 0) return "—";

  const items = value as RelationLink[];

  return (
    <div className="relation-chips" role="list">
      {items.map((item, index) => {
        const title = item.title || item.id || "…";
        const content = item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer">
            {title}
          </a>
        ) : (
          title
        );
        return (
          <span className="relation-chip" key={`${item.id || title}-${index}`} role="listitem">
            {content}
          </span>
        );
      })}
    </div>
  );
}

function renderCell(column: NotionColumn, row: NotionRow) {
  const value = row[column.key];

  if (column.type === "relation_labels" || column.type === "relation_links") {
    const linkKey = column.key.endsWith("__labels")
      ? `${column.key.slice(0, -"__labels".length)}__links`
      : column.key;
    const relationValue = row[linkKey] ?? value;
    return renderRelation(relationValue as RelationLink[]);
  }

  if (typeof value === "string" && column.key.toLowerCase().includes("url")) {
    return (
      <a href={value} target="_blank" rel="noreferrer">
        {value}
      </a>
    );
  }

  if (Array.isArray(value) && value.every((item) => typeof item === "object")) {
    const stringified = (value as Record<string, unknown>[]).map((item) =>
      formatValue(item.title || item.name || item.id || JSON.stringify(item))
    );
    return renderRelation(stringified.map((title) => ({ title })) as RelationLink[]);
  }

  if (Array.isArray(value)) {
    return renderRelation(value.map((val) => ({ title: formatValue(val) })) as RelationLink[]);
  }

  return formatValue(value);
}

export function NotionTodosView() {
  const [columns, setColumns] = useState<NotionColumn[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<NotionRow[]>([]);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sortColumn, setSortColumn] = useState<string | undefined>();
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [offset, setOffset] = useState(0);
  const [limit] = useState(50);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const syncPollRef = useMemo(() => ({ current: null as ReturnType<typeof setInterval> | null }), []);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query), 350);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    fetchColumns()
      .then((data) => {
        const validColumns = data.filter((col): col is NotionColumn & { key: string } => Boolean(col.key));
        setColumns(validColumns);
        setVisibleColumns((prev) => (prev.length > 0 ? prev : validColumns.map((col) => col.key)));
      })
      .catch((err) => console.error("Failed to load columns", err));
  }, []);

  const sort = useMemo(
    () => (sortColumn ? `${sortColumn}:${sortDirection}` : undefined),
    [sortColumn, sortDirection]
  );

  const params = useMemo(
    () => ({ q: debouncedQuery, sort, limit, offset }),
    [debouncedQuery, sort, limit, offset]
  );

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
        setError("Failed to load rows");
      })
      .finally(() => setLoading(false));
  }, [params]);

  function resetAndReload() {
    setOffset(0);
  }

  function updateSyncStatus(status: SyncStatus) {
    setSyncStatus(status);
    if (status.status === "running") {
      setSyncResult(null);
    }
    if (status.result) {
      setSyncResult(status.result);
    }
    if (status.status === "completed" && status.result?.ok) {
      resetAndReload();
    }
    if (status.status === "error" && status.error) {
      setError(status.error);
    }
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
        if (status.status !== "running") {
          stopSyncPolling();
        }
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
        if (status.status === "running") {
          startSyncPolling();
        }
      })
      .catch((err) => console.error("Failed to fetch sync status", err));

    return () => stopSyncPolling();
  }, []);

  async function handleSync(force_full = false) {
    try {
      setError(null);
      const status = await triggerSync(force_full);
      updateSyncStatus(status);
      if (status.status === "running") {
        startSyncPolling();
      }
    } catch (err) {
      console.error(err);
      setError((err as Error).message);
    }
  }

  function toggleColumn(key: string) {
    setVisibleColumns((prev) =>
      prev.includes(key) ? prev.filter((col) => col !== key) : [...prev, key]
    );
  }

  const visibleSet = useMemo(() => new Set(visibleColumns), [visibleColumns]);
  const displayedColumns = columns.filter((col) => col.key && visibleSet.has(col.key));
  const hasMore = offset + limit < total;
  const isSyncing = syncStatus?.status === "running";
  const syncTotal = syncStatus?.total ?? 0;
  const syncProcessed = syncStatus?.processed ?? 0;
  const syncProgress = syncTotal > 0 ? Math.min(100, Math.round((syncProcessed / syncTotal) * 100)) : 0;

  return (
    <GlassCard glow className="notion-todos">
      <div className="card-header">
        <div>
          <span className="kicker">Notion</span>
          <h3 className="card-title">Notion Table View</h3>
        </div>
        <div className="actions">
          <button
            className="button secondary"
            type="button"
            disabled={isSyncing}
            onClick={() => handleSync(false)}
          >
            Refresh
          </button>
          <button className="button" type="button" disabled={isSyncing} onClick={() => handleSync(true)}>
            Full Sync
          </button>
        </div>
      </div>

      {isSyncing && (
        <div className="sync-progress" role="status" aria-live="polite">
          <div className="sync-progress__labels">
            <span className="muted small">
              Syncing {syncProcessed}/{syncTotal || "?"} tasks
            </span>
            <span className="muted small">{syncProgress}%</span>
          </div>
          <div className="progress-bar">
            <div className="progress-bar__fill" style={{ width: `${syncProgress}%` }} />
          </div>
        </div>
      )}

      <div className="filters-grid">
        <input
          className="input"
          placeholder="Search any text column"
          value={query}
          onChange={(e) => {
            setOffset(0);
            setQuery(e.target.value);
          }}
        />

        <div className="column-visibility">
          <div className="column-visibility__header">
            <span className="muted small">Column visibility</span>
            <button
              className="button tertiary"
              type="button"
              onClick={() => setVisibleColumns(columns.map((col) => col.key))}
            >
              Show all
            </button>
          </div>
          <div className="column-toggle-list">
            {columns.map((column) => (
              <label
                key={column.key}
                className={`column-toggle ${visibleSet.has(column.key) ? "is-active" : ""}`.trim()}
              >
                <input
                  type="checkbox"
                  checked={visibleSet.has(column.key)}
                  onChange={() => toggleColumn(column.key)}
                />
                <span>{column.label || column.key}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="sort-row">
          <label className="muted small" htmlFor="sort-column">
            Sort by
          </label>
          <div className="sort-controls">
            <select
              id="sort-column"
              className="input"
              value={sortColumn || ""}
              onChange={(e) => {
                setOffset(0);
                setSortColumn(e.target.value || undefined);
              }}
            >
              <option value="">Last edited (default)</option>
              {columns.map((column) => (
                <option key={column.key} value={column.key}>
                  {column.label || column.key}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={sortDirection}
              onChange={(e) => {
                setOffset(0);
                setSortDirection(e.target.value as "asc" | "desc");
              }}
            >
              <option value="asc">Asc</option>
              <option value="desc">Desc</option>
            </select>
          </div>
        </div>
      </div>

      {syncResult && (
        <p className="badge-info" aria-live="polite">
          Sync {syncResult.mode} – {syncResult.upserted_count} items ({syncResult.duration_ms}ms)
        </p>
      )}

      {error && <p className="badge-alert">{error}</p>}

      {!loading && rows.length === 0 && !error && (
        <p className="muted">Keine Aufgaben gefunden. Starte mit einem Refresh.</p>
      )}

      {displayedColumns.length === 0 && (
        <p className="muted">No columns selected. Choose at least one to see data.</p>
      )}

      {displayedColumns.length > 0 && rows.length > 0 && (
        <div className="notion-table-wrapper">
          <table className="notion-table" aria-label="Notion table view">
            <thead>
              <tr>
                {displayedColumns.map((column) => (
                  <th key={column.key}>{column.label || column.key}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const rowId = (row.id as string | number | undefined) ?? index;
                return (
                  <tr key={rowId}>
                    {displayedColumns.map((column) => (
                      <td key={column.key}>{renderCell(column, row)}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="list-actions">
        {hasMore && (
          <button
            className="button secondary"
            type="button"
            disabled={loading}
            onClick={() => setOffset((o) => o + limit)}
          >
            Load more
          </button>
        )}
        {loading && <span className="muted">Loading...</span>}
      </div>
    </GlassCard>
  );
}
