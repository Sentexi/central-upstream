import React, { useCallback, useEffect, useState } from "react";
import { fetchSyncHistory, type SyncHistoryItem } from "./api";

interface HealthSyncHistoryProps {
  refreshKey?: string | number | null;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const diffMs = Date.now() - then.getTime();
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) return `vor ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `vor ${minutes}min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `vor ${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `vor ${days}d`;
  return then.toISOString().slice(0, 10);
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "";
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder > 0 ? `${minutes}min ${remainder}s` : `${minutes}min`;
}

function clientLabel(client: SyncHistoryItem["client"]): string {
  if (client === "iphone") return "iPhone";
  if (client === "browser") return "Browser";
  return "";
}

function statePillClass(state: SyncHistoryItem["final_state"]): string {
  if (state === "done") return "status-pill status-success";
  if (state === "error") return "status-pill status-error";
  return "status-pill status-idle";
}

function stateLabel(state: SyncHistoryItem["final_state"]): string {
  if (state === "done") return "Erfolgreich";
  if (state === "error") return "Fehler";
  return "Abgebrochen";
}

export function HealthSyncHistory({ refreshKey }: HealthSyncHistoryProps) {
  const [items, setItems] = useState<SyncHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchSyncHistory(20);
      setItems(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Konnte Historie nicht laden");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (loading && items.length === 0) {
    return (
      <div className="settings-subsection">
        <span className="settings-subsection__label">Sync Historie</span>
        <span className="settings-field__help">Historie wird geladen...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="settings-subsection">
        <span className="settings-subsection__label">Sync Historie</span>
        <div className="settings-error">{error}</div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="settings-subsection">
        <span className="settings-subsection__label">Sync Historie</span>
        <span className="settings-field__help">Noch keine Sync Versuche aufgezeichnet.</span>
      </div>
    );
  }

  return (
    <div className="settings-subsection health-history">
      <div className="health-history__header">
        <span className="settings-subsection__label">Sync Historie</span>
        <button
          type="button"
          className="settings-chip"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? "Lade..." : "Neu laden"}
        </button>
      </div>
      <table className="health-history__table">
        <thead>
          <tr>
            <th>Zeit</th>
            <th>Quelle</th>
            <th>Records</th>
            <th>Dauer</th>
            <th>Ergebnis</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const isExpanded = expandedId === item.id;
            const expandable = Boolean(item.last_error);
            return (
              <React.Fragment key={item.id}>
                <tr
                  onClick={expandable ? () => setExpandedId(isExpanded ? null : item.id) : undefined}
                  className={expandable ? "health-history__row clickable" : "health-history__row"}
                >
                  <td>{formatRelative(item.started_at)}</td>
                  <td>{clientLabel(item.client)}</td>
                  <td>
                    {item.processed_records}
                    {item.total_records ? ` / ${item.total_records}` : ""}
                  </td>
                  <td>{formatDuration(item.duration_seconds)}</td>
                  <td>
                    <span className={statePillClass(item.final_state)}>
                      {stateLabel(item.final_state)}
                    </span>
                  </td>
                </tr>
                {isExpanded && item.last_error && (
                  <tr className="health-history__detail">
                    <td colSpan={5}>
                      <code>{item.last_error}</code>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
