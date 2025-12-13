import { useEffect, useMemo, useState } from "react";
import { GlassCard } from "../../core/GlassCard";
import { fetchFilters, fetchTodos, parseTags, triggerSync } from "./api";
import type { NotionFilters, NotionTask, SyncResult } from "./types";

const SORT_OPTIONS = [
  { value: "due_date_asc", label: "Due date ↑" },
  { value: "due_date_desc", label: "Due date ↓" },
  { value: "last_edited_desc", label: "Last edited" },
  { value: "title_asc", label: "Title" },
];

export function NotionTodosView() {
  const [todos, setTodos] = useState<NotionTask[]>([]);
  const [filters, setFilters] = useState<NotionFilters | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [status, setStatus] = useState<string[]>([]);
  const [project, setProject] = useState<string | undefined>();
  const [area, setArea] = useState<string | undefined>();
  const [sort, setSort] = useState("due_date_asc");
  const [offset, setOffset] = useState(0);
  const [limit] = useState(50);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query), 350);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    fetchFilters()
      .then(setFilters)
      .catch((err) => console.error("Failed to load filters", err));
  }, []);

  const params = useMemo(
    () => ({ q: debouncedQuery, status, project, area, sort, limit, offset }),
    [debouncedQuery, status, project, area, sort, limit, offset]
  );

  useEffect(() => {
    setLoading(true);
    fetchTodos(params)
      .then((data) => {
        setTodos((prev) => (params.offset === 0 ? data.items : [...prev, ...data.items]));
        setTotal(data.total);
        setError(null);
      })
      .catch((err) => {
        console.error(err);
        setError("Failed to load todos");
      })
      .finally(() => setLoading(false));
  }, [params]);

  function resetAndReload() {
    setOffset(0);
  }

  async function handleSync(force_full = false) {
    try {
      setLoading(true);
      const result = await triggerSync(force_full);
      setSyncResult(result);
      resetAndReload();
    } catch (err) {
      console.error(err);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const hasMore = offset + limit < total;

  return (
    <GlassCard glow className="notion-todos">
      <div className="card-header">
        <div>
          <span className="kicker">Notion</span>
          <h3 className="card-title">Notion ToDos</h3>
        </div>
        <div className="actions">
          <button className="button secondary" type="button" onClick={() => handleSync(false)}>
            Refresh
          </button>
          <button className="button" type="button" onClick={() => handleSync(true)}>
            Full Sync
          </button>
        </div>
      </div>

      <div className="filters-grid">
        <input
          className="input"
          placeholder="Search title"
          value={query}
          onChange={(e) => {
            setOffset(0);
            setQuery(e.target.value);
          }}
        />
        <select
          className="input"
          value={status.join(",")}
          onChange={(e) => {
            setOffset(0);
            const value = e.target.value;
            setStatus(value ? value.split(",") : []);
          }}
        >
          <option value="">Status</option>
          {filters?.statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={project || ""}
          onChange={(e) => {
            setOffset(0);
            setProject(e.target.value || undefined);
          }}
        >
          <option value="">Project</option>
          {filters?.projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={area || ""}
          onChange={(e) => {
            setOffset(0);
            setArea(e.target.value || undefined);
          }}
        >
          <option value="">Area</option>
          {filters?.areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {syncResult && (
        <p className="badge-info" aria-live="polite">
          Sync {syncResult.mode} – {syncResult.upserted_count} items ({syncResult.duration_ms}ms)
        </p>
      )}

      {error && <p className="badge-alert">{error}</p>}

      {!loading && todos.length === 0 && !error && (
        <p className="muted">Keine Aufgaben gefunden. Starte mit einem Refresh.</p>
      )}

      <ul className="task-list scrollable" aria-live="polite">
        {todos.map((task) => (
          <li key={task.id} className="task-item">
            <div className="task-title">
              {task.url ? (
                <a href={task.url} target="_blank" rel="noreferrer">
                  {task.title || "(Untitled)"}
                </a>
              ) : (
                task.title || "(Untitled)"
              )}
            </div>
            <div className="task-meta">
              {task.status && <span className="pill">{task.status}</span>}
              {task.due_date && <span className="pill subtle">Due: {task.due_date}</span>}
              {task.project && <span className="pill subtle">Project: {task.project}</span>}
              {task.area && <span className="pill subtle">Area: {task.area}</span>}
              {parseTags(task.tags_json).map((t) => (
                <span key={t} className="pill subtle">
                  #{t}
                </span>
              ))}
              {task.last_edited_time && (
                <span className="muted small">Edited {new Date(task.last_edited_time).toLocaleString()}</span>
              )}
            </div>
          </li>
        ))}
      </ul>

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
