import React, { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { GlassCard } from "../core/GlassCard";
import type {
  SettingsField,
  SettingsModuleSchema,
  SettingsValueMap,
} from "../core/types";

type StatusState = "idle" | "saving" | "error" | "success" | "syncing";

type StatusProgress = {
  processed: number;
  total: number;
  percent: number;
  stage?: string;
};

type StatusEntry = {
  state: StatusState;
  message?: string;
  progress?: StatusProgress;
};

type StatusMap = Record<string, StatusEntry>; // keyed by module_id

function getInitialValues(
  modules: SettingsModuleSchema[],
  stored: SettingsValueMap
): SettingsValueMap {
  const merged: SettingsValueMap = {};

  modules.forEach((module) => {
    const current = stored[module.module_id] ?? {};
    const next: Record<string, unknown> = { ...current };

    module.fields.forEach((field) => {
      if (next[field.key] === undefined && field.default !== undefined) {
        next[field.key] = field.default;
      }
    });

    merged[module.module_id] = next;
  });

  return merged;
}

function renderField(
  field: SettingsField,
  value: unknown,
  onChange: (value: unknown) => void
) {
  const isReadOnly = Boolean(field.read_only);
  const commonProps = {
    id: field.key,
    name: field.key,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const target = event.target;
      if (field.type === "boolean") {
        onChange((target as HTMLInputElement).checked);
      } else {
        onChange(target.value);
      }
    },
    value: typeof value === "string" || typeof value === "number" ? value : "",
  };

  if (field.type === "boolean") {
    return (
      <label className="field-boolean">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          disabled={isReadOnly}
        />
        <span>{field.label}</span>
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <select className="input" {...commonProps} disabled={isReadOnly}>
        {field.options?.map((opt) => (
          <option value={opt.value} key={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  const inputType = field.type === "password" ? "password" : "text";

  return (
    <input
      className="input"
      type={inputType}
      placeholder={field.label}
      readOnly={isReadOnly}
      {...commonProps}
    />
  );
}

export function SettingsPage() {
  const [modules, setModules] = useState<SettingsModuleSchema[]>([]);
  const [values, setValues] = useState<SettingsValueMap>({});
  const [loading, setLoading] = useState(true);
  const [statuses, setStatuses] = useState<StatusMap>({});
  const [healthUploading, setHealthUploading] = useState(false);
  const [healthUploadError, setHealthUploadError] = useState<string | null>(null);

  useEffect(() => {
    async function bootstrap() {
      try {
        setLoading(true);
        const [schemaRes, valuesRes] = await Promise.all([
          fetch("/api/settings/schema"),
          fetch("/api/settings/values"),
        ]);

        const schemaData = await schemaRes.json();
        const valueData = await valuesRes.json();

        const loadedModules: SettingsModuleSchema[] = schemaData.modules ?? [];
        setModules(loadedModules);
        setValues(getInitialValues(loadedModules, valueData));

        const successStatuses: StatusMap = {};
        loadedModules.forEach((module) => {
          if (valueData[module.module_id]) {
            successStatuses[module.module_id] = {
              state: "success",
              message: "Verbunden",
            };
          }
        });
        setStatuses((prev) => ({ ...prev, ...successStatuses }));
      } catch (err) {
        console.error("Fehler beim Laden der Settings", err);
      } finally {
        setLoading(false);
      }
    }

    bootstrap();
  }, []);

  const formatLastSync = (value: string | null) => {
    if (!value) return "noch kein Sync";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString();
  };

  const formatStatusValue = (
    statusMeta: SettingsModuleSchema["status"],
    payload: unknown
  ) => {
    if (!statusMeta) return "Status";

    const lookupValue =
      statusMeta.value_key && payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)[statusMeta.value_key]
        : payload;

    if (statusMeta.formatter === "datetime") {
      return formatLastSync((lookupValue as string | null) ?? null);
    }

    if (lookupValue === undefined || lookupValue === null) {
      return "Keine Statusdaten";
    }

    if (typeof lookupValue === "object") {
      return JSON.stringify(lookupValue);
    }

    return String(lookupValue);
  };

  const parseSyncStatus = (value: unknown): StatusProgress => {
    if (value === undefined || value === null) {
      return { processed: 0, total: 0, percent: 0, stage: undefined };
    }

    const total = Number((value as { total_records?: number }).total_records ?? 0);
    const processed = Number(
      (value as { processed_records?: number }).processed_records ?? 0
    );
    const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
    const stage = (value as { stage?: string | null }).stage ?? undefined;

    return { processed, total, percent, stage };
  };

  const fetchStatuses = useCallback(
    async (options?: { modules?: SettingsModuleSchema[] }) => {
      const sourceModules = options?.modules ?? modules;
      const modulesWithStatus = sourceModules.filter((module) => module.status?.endpoint);

      await Promise.all(
        modulesWithStatus.map(async (module) => {
          try {
            const response = await fetch(module.status!.endpoint);
            const data = await response.json();

            if (data && typeof data === "object" && (data as { syncing?: boolean }).syncing) {
              const syncStatus = parseSyncStatus((data as { sync_status?: unknown }).sync_status);

              setStatuses((prev) => ({
                ...prev,
                [module.module_id]: {
                  state: "syncing",
                  message: syncStatus.stage
                    ? `Syncing (${syncStatus.stage})`
                    : "Syncing läuft...",
                  progress: syncStatus,
                },
              }));
              return;
            }

            const messageValue = formatStatusValue(module.status, data);
            const label = module.status?.label ?? "Status";

            setStatuses((prev) => ({
              ...prev,
              [module.module_id]: {
                state: "success",
                message: `${label}: ${messageValue}`,
              },
            }));
          } catch (err) {
            console.error(`Status für Modul ${module.module_id} konnte nicht geladen werden`, err);
            setStatuses((prev) => ({
              ...prev,
              [module.module_id]: {
                state: "error",
                message: "Status konnte nicht geladen werden",
              },
            }));
          }
        })
      );
    },
    [formatStatusValue, modules]
  );

  useEffect(() => {
    if (modules.length > 0) {
      fetchStatuses();
    }
  }, [fetchStatuses, modules.length]);

  useEffect(() => {
    const syncingModules = modules.filter(
      (module) => statuses[module.module_id]?.state === "syncing"
    );

    if (syncingModules.length === 0) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      fetchStatuses({ modules: syncingModules });
    }, 1500);

    return () => window.clearInterval(interval);
  }, [fetchStatuses, modules, statuses]);

  const handleChange = (moduleId: string, key: string, nextValue: unknown) => {
    setValues((prev) => ({
      ...prev,
      [moduleId]: {
        ...(prev[moduleId] ?? {}),
        [key]: nextValue,
      },
    }));
  };

  const setStatus = (moduleId: string, status: StatusState, message?: string) => {
    setStatuses((prev) => ({ ...prev, [moduleId]: { state: status, message } }));
  };

  const handleHealthUpload = async (file: File) => {
    setHealthUploadError(null);
    setHealthUploading(true);
    setStatus("health", "saving", "Import wird vorbereitet...");

    try {
      const text = await file.text();
      const payload = JSON.parse(text);

      const response = await fetch("/api/health/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        const errorMessage = data?.error ?? "Import fehlgeschlagen";
        setHealthUploadError(errorMessage);
        setStatus("health", "error", errorMessage);
        return;
      }

      setStatus("health", "syncing", "Sync wird gestartet...");
    } catch (err) {
      console.error("Health Upload fehlgeschlagen", err);
      setHealthUploadError("Ungültige JSON-Datei oder Netzwerkfehler beim Import");
      setStatus("health", "error", "Upload fehlgeschlagen");
    } finally {
      setHealthUploading(false);
    }
  };

  const validateLocally = (module: SettingsModuleSchema) => {
    const moduleValues = values[module.module_id] ?? {};
    const missing = module.fields
      .filter((f) => f.required)
      .filter((f) => {
        const val = moduleValues[f.key];
        return val === undefined || val === null || val === "";
      });

    if (missing.length > 0) {
      return (
        false,
        "Bitte fülle alle Pflichtfelder aus: " + missing.map((m) => m.label).join(", ")
      );
    }

    return [true, ""] as const;
  };

  const validateAndSave = async (module: SettingsModuleSchema) => {
    const [valid, msg] = validateLocally(module);
    if (!valid) {
      setStatus(module.module_id, "error", msg);
      return;
    }

    setStatus(module.module_id, "saving", "Teste und speichere...");
    const moduleValues = values[module.module_id] ?? {};

    try {
      const validateRes = await fetch(`/api/settings/${module.module_id}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(moduleValues),
      });
      const validateData = await validateRes.json();

      if (!validateData.ok) {
        setStatus(module.module_id, "error", validateData.error ?? "Validierung fehlgeschlagen");
        return;
      }

      const saveRes = await fetch(`/api/settings/${module.module_id}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(moduleValues),
      });

      const saveData = await saveRes.json();
      if (!saveData.ok) {
        setStatus(module.module_id, "error", saveData.error ?? "Speichern nicht möglich");
        return;
      }

      setStatus(module.module_id, "success", "Verbunden");
      await fetchStatuses({ modules: [module] });
    } catch (err) {
      console.error("Settings Speichern fehlgeschlagen", err);
      setStatus(module.module_id, "error", "Netzwerkfehler beim Speichern");
    }
  };

  const headline = useMemo(() => {
    if (loading) return "Settings laden";
    if (modules.length === 0) return "Keine Module mit Settings gefunden";
    return "Module konfigurieren";
  }, [loading, modules.length]);

  return (
    <div className="settings-stack">
      <div className="section-heading">Settings</div>
      <div className="stack">
        <h2 className="title">{headline}</h2>
        <p className="subtitle">
          Verbinde Integrationen, teste API-Keys live und speichere validierte Einstellungen zentral.
        </p>
      </div>

      {loading && (
        <GlassCard className="loader" glow>
          <span className="kicker">Booting</span>
          <h3 className="card-title">Settings werden geladen</h3>
          <p className="card-description">Wir sammeln alle Module mit einem Settings-Provider.</p>
        </GlassCard>
      )}

      <div className="settings-grid">
        {modules.map((module) => {
          const moduleValues = values[module.module_id] ?? {};
          const status = statuses[module.module_id] ?? { state: "idle" };

          return (
            <GlassCard key={module.module_id} className="settings-card">
              <div className="settings-card__header">
                <div>
                  <span className="kicker">{module.module_id}</span>
                  <h3 className="card-title">{module.module_name}</h3>
                </div>
                <span className={`status-pill status-${status.state}`}>
                  {status.state === "success"
                    ? status.message ?? "Verbunden"
                    : status.state === "saving"
                    ? status.message ?? "Validiere..."
                    : status.state === "syncing"
                    ? status.message ?? "syncing"
                    : status.state === "error"
                    ? "Fehler"
                    : "Bereit"}
                </span>
              </div>

              <div className="stack settings-fields">
                {status.state === "syncing" && status.progress && (
                  <div className="sync-progress" role="status" aria-live="polite">
                    <div className="sync-progress__labels">
                      <span className="muted small">
                        {status.progress.stage
                          ? `Syncing (${status.progress.stage})`
                          : "Syncing läuft..."}
                      </span>
                      <span className="muted small">
                        {status.progress.processed}/{status.progress.total || "?"} (
                        {status.progress.percent}% )
                      </span>
                    </div>
                    <div className="progress-bar">
                      <div
                        className="progress-bar__fill"
                        style={{ width: `${status.progress.percent}%` }}
                      />
                    </div>
                  </div>
                )}
                {module.fields.map((field) => (
                  <label className="settings-field" key={`${module.module_id}-${field.key}`}>
                    <div className="settings-field__meta">
                      <span className="settings-label">
                        {field.label}
                        {field.required && <span className="required">*</span>}
                      </span>
                      {field.help_text && <span className="muted">{field.help_text}</span>}
                    </div>
                    {renderField(field, moduleValues[field.key], (val) =>
                      handleChange(module.module_id, field.key, val)
                    )}
                  </label>
                ))}

                {module.module_id === "health" && (
                  <div className="manual-import">
                    <div className="settings-field__meta">
                      <span className="settings-label">Manueller Import</span>
                      <span className="muted">
                        Lade einen Health Auto Export als JSON hoch. Die Datei wird direkt
                        importiert und triggert den Sync-Prozess.
                      </span>
                    </div>
                    <label className="manual-import__controls">
                      <input
                        type="file"
                        accept="application/json,.json"
                        className="input"
                        onChange={(event) => {
                          const nextFile = event.target.files?.[0];
                          if (!nextFile) return;
                          event.target.value = "";
                          handleHealthUpload(nextFile);
                        }}
                        disabled={healthUploading}
                      />
                      <span className="muted small">
                        {healthUploading
                          ? "Upload & Sync laufen..."
                          : "Maximal 1 Datei, JSON-Format"}
                      </span>
                    </label>
                    {healthUploadError && (
                      <div className="settings-error">{healthUploadError}</div>
                    )}
                  </div>
                )}
              </div>

              {status.state === "error" && status.message && (
                <div className="settings-error">{status.message}</div>
              )}
              {status.state === "success" && status.message && (
                <div className="settings-success">{status.message}</div>
              )}

              <div className="settings-actions">
                <button
                  className="button"
                  onClick={() => validateAndSave(module)}
                  type="button"
                  disabled={status.state === "saving"}
                >
                  {status.state === "saving" ? "Wird geprüft..." : "Test & Save"}
                </button>
              </div>
            </GlassCard>
          );
        })}

        {!loading && modules.length === 0 && (
          <GlassCard className="settings-card">
            <span className="kicker">Settings Registry</span>
            <h3 className="card-title">Keine Settings-Provider gefunden</h3>
            <p className="card-description">
              Installiere ein Modul mit Settings-Provider und es erscheint automatisch hier.
            </p>
          </GlassCard>
        )}
      </div>
    </div>
  );
}
