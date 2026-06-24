import React, {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PageHeader } from "../core/ui";
import type {
  SettingsField,
  SettingsModuleSchema,
  SettingsValueMap,
} from "../core/types";
import { HealthApiKeyActions } from "../modules/health/HealthApiKeyActions";
import { HealthForceClearButton } from "../modules/health/HealthForceClearButton";
import { HealthSyncHistory } from "../modules/health/HealthSyncHistory";

const REDACTED_PLACEHOLDER = "__stored__";

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

// Rohe Status-Payloads pro Modul: speisen die Status-Pillen und die
// Alert-Banner-Bedingung (Calories LLM-Key) aus echten Daten.
type StatusPayloadMap = Record<string, unknown>;

type StoredSecretsMap = Record<string, Set<string>>;

// Anzeige-Titel pro Modul laut Mockup (Eyebrow bleibt module_name uppercase).
const MODULE_DISPLAY_TITLES: Record<string, string> = {
  calories: "Kalorien-KI",
  health: "Health-Ingest",
  notion: "Notion-Sync",
};

// Footer-Button-Label pro Modul (Calories testet live, Rest speichert).
const MODULE_SAVE_LABELS: Record<string, string> = {
  calories: "Test & Speichern",
};

function getInitialValues(
  modules: SettingsModuleSchema[],
  stored: SettingsValueMap
): { values: SettingsValueMap; stored_secrets: StoredSecretsMap } {
  const values: SettingsValueMap = {};
  const stored_secrets: StoredSecretsMap = {};

  modules.forEach((module) => {
    const current = stored[module.module_id] ?? {};
    const next: Record<string, unknown> = { ...current };
    const secretFlags = new Set<string>();

    module.fields.forEach((field) => {
      const isPassword = field.type === "password";
      const incoming = next[field.key];
      const looksRedacted =
        typeof incoming === "string" && incoming === REDACTED_PLACEHOLDER;

      if (isPassword && looksRedacted) {
        secretFlags.add(field.key);
        next[field.key] = "";
      } else if (next[field.key] === undefined && field.default !== undefined) {
        if (isPassword && field.default === REDACTED_PLACEHOLDER) {
          secretFlags.add(field.key);
          next[field.key] = "";
        } else {
          next[field.key] = field.default;
        }
      }
    });

    values[module.module_id] = next;
    stored_secrets[module.module_id] = secretFlags;
  });

  return { values, stored_secrets };
}

function renderField(
  field: SettingsField,
  value: unknown,
  onChange: (value: unknown) => void,
  onFileSelect?: (file: File) => void,
  hasStoredSecret = false
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
      <label className="settings-field-boolean">
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
      <select className="settings-input" {...commonProps} disabled={isReadOnly}>
        {field.options?.map((opt) => (
          <option value={opt.value} key={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "file") {
    return (
      <input
        className="settings-input"
        type="file"
        accept={field.accept?.join(",") ?? undefined}
        onChange={(event) => {
          const nextFile = event.target.files?.[0];
          if (!nextFile) return;
          event.target.value = "";
          onFileSelect?.(nextFile);
        }}
        disabled={isReadOnly}
      />
    );
  }

  const inputType = field.type === "password" ? "password" : "text";

  let placeholder = field.label;
  if (field.type === "password" && hasStoredSecret) {
    placeholder = "gespeichert, leer lassen um nicht zu ändern";
  }

  return (
    <input
      className="settings-input"
      type={inputType}
      placeholder={placeholder}
      readOnly={isReadOnly}
      autoComplete={field.type === "password" ? "new-password" : undefined}
      {...commonProps}
    />
  );
}

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

const parseSyncStatus = (
  value: unknown,
  stageLabels?: Record<string, string>
): StatusProgress => {
  if (value === undefined || value === null) {
    return { processed: 0, total: 0, percent: 0, stage: undefined };
  }

  const total = Number((value as { total_records?: number }).total_records ?? 0);
  const processed = Number(
    (value as { processed_records?: number }).processed_records ?? 0
  );
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const stageKey = (value as { stage?: string | null }).stage ?? undefined;
  const stage = stageKey ? stageLabels?.[stageKey] ?? stageKey : undefined;

  return { processed, total, percent, stage };
};

// Erkennt einen fehlenden/ungueltigen Calories-LLM-Key aus dem rohen
// Status-Payload (kein Hardcoding). Nutzt sowohl das explizite status-Feld
// als auch is_valid/has_key, falls vorhanden.
function isCaloriesKeyMissing(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  if (record.status === "missing_or_invalid") return true;
  if (record.status === "valid") return false;
  if ("is_valid" in record || "has_key" in record) {
    return !(record.is_valid === true && record.has_key !== false);
  }
  return false;
}

type StatusPill = {
  tone: "success" | "error" | "teal" | "neutral";
  label: string;
  spinning?: boolean;
};

// Leitet die Status-Pille im Modul-Header aus State + rohem Payload ab.
function deriveStatusPill(
  module: SettingsModuleSchema,
  status: StatusEntry,
  payload: unknown
): StatusPill {
  if (status.state === "error") {
    return { tone: "error", label: "Fehler" };
  }
  if (status.state === "saving") {
    return { tone: "teal", label: "Prüfe...", spinning: true };
  }
  if (status.state === "syncing") {
    return {
      tone: "teal",
      label: status.progress?.stage ?? "Sync läuft",
      spinning: true,
    };
  }

  // Calories: echter Key-Status entscheidet ueber Erfolg/Fehler.
  if (module.module_id === "calories" && payload && typeof payload === "object") {
    if (isCaloriesKeyMissing(payload)) {
      return { tone: "error", label: "Ungültig" };
    }
    return { tone: "success", label: "Verbunden" };
  }

  // Health: letzter Sync-Zeitpunkt als Pille (Erfolg), sonst neutral.
  if (
    module.module_id === "health" &&
    module.status &&
    payload &&
    typeof payload === "object"
  ) {
    const formatted = formatStatusValue(module.status, payload);
    if (formatted && formatted !== "noch kein Sync" && formatted !== "Keine Statusdaten") {
      return { tone: "success", label: `Sync ${formatStatusTime(payload, module)}` };
    }
    return { tone: "neutral", label: "Kein Sync" };
  }

  if (status.state === "success") {
    return { tone: "success", label: "Verbunden" };
  }
  return { tone: "neutral", label: "Bereit" };
}

// Kurzform HH:MM fuer die Health-Sync-Pille (faellt auf das Datum zurueck).
function formatStatusTime(payload: unknown, module: SettingsModuleSchema): string {
  const meta = module.status;
  if (!meta || !payload || typeof payload !== "object") return "";
  const raw = meta.value_key
    ? (payload as Record<string, unknown>)[meta.value_key]
    : payload;
  if (typeof raw !== "string") return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function SettingsPage() {
  const [modules, setModules] = useState<SettingsModuleSchema[]>([]);
  const [values, setValues] = useState<SettingsValueMap>({});
  const [storedSecrets, setStoredSecrets] = useState<StoredSecretsMap>({});
  const [loading, setLoading] = useState(true);
  const [statuses, setStatuses] = useState<StatusMap>({});
  const [statusPayloads, setStatusPayloads] = useState<StatusPayloadMap>({});
  const [uploadingModule, setUploadingModule] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<Record<string, string | null>>({});

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

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
        const initial = getInitialValues(loadedModules, valueData);
        setValues(initial.values);
        setStoredSecrets(initial.stored_secrets);

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

  const fetchStatuses = useCallback(
    async (options?: { modules?: SettingsModuleSchema[] }) => {
      const sourceModules = options?.modules ?? modules;
      const modulesWithStatus = sourceModules.filter((module) => module.status?.endpoint);

      await Promise.all(
        modulesWithStatus.map(async (module) => {
          try {
            const response = await fetch(module.status!.endpoint);
            const data = await response.json();

            // Rohen Payload merken (fuer Pille + Alert-Banner).
            setStatusPayloads((prev) => ({ ...prev, [module.module_id]: data }));

            if (data && typeof data === "object" && (data as { syncing?: boolean }).syncing) {
              const stageLabels =
                module.status?.stage_labels ?? (data as { stages?: Record<string, string> }).stages;
              const syncStatus = parseSyncStatus(
                (data as { sync_status?: unknown }).sync_status,
                stageLabels
              );

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
    [modules]
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

  const handleFileUpload = async (module: SettingsModuleSchema, file: File) => {
    if (!module.manual_import?.endpoint) return;

    const label = module.manual_import.label ?? module.module_name;
    setUploadError((prev) => ({ ...prev, [module.module_id]: null }));
    setUploadingModule(module.module_id);
    setStatus(module.module_id, "saving", "Import wird vorbereitet...");

    try {
      let body: BodyInit | null = null;
      let headers: Record<string, string> | undefined;

      if (module.manual_import.upload_kind === "json") {
        const text = await file.text();
        try {
          JSON.parse(text);
        } catch (err) {
          throw new Error("Ungültige JSON-Datei");
        }
        body = text;
        headers = { "Content-Type": "application/json" };
      } else {
        const formData = new FormData();
        formData.append("file", file);
        body = formData;
      }

      const response = await fetch(module.manual_import.endpoint, {
        method: (module.manual_import as { method?: string }).method ?? "POST",
        headers,
        body,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || (data && typeof data === "object" && (data as { ok?: boolean }).ok === false)) {
        const errorMessage =
          (data as { error?: string }).error ??
          module.manual_import.error_message ??
          "Import fehlgeschlagen";
        setUploadError((prev) => ({ ...prev, [module.module_id]: errorMessage }));
        setStatus(module.module_id, "error", errorMessage);
        return;
      }

      setStatus(
        module.module_id,
        "syncing",
        module.manual_import.success_message ?? `${label}: Import gestartet`
      );
    } catch (err) {
      console.error("File Upload fehlgeschlagen", err);
      const errorMessage =
        err instanceof Error
          ? err.message
          : module.manual_import?.error_message ?? "Upload fehlgeschlagen";
      setUploadError((prev) => ({ ...prev, [module.module_id]: errorMessage }));
      setStatus(module.module_id, "error", errorMessage);
    } finally {
      setUploadingModule(null);
    }
  };

  const validateLocally = (module: SettingsModuleSchema) => {
    const moduleValues = values[module.module_id] ?? {};
    const moduleSecrets = storedSecrets[module.module_id] ?? new Set<string>();
    const missing = module.fields
      .filter((f) => f.required)
      .filter((f) => {
        const val = moduleValues[f.key];
        const isEmpty = val === undefined || val === null || val === "";
        if (!isEmpty) return false;
        return !moduleSecrets.has(f.key);
      });

    if (missing.length > 0) {
      return [
        false,
        "Bitte fuelle alle Pflichtfelder aus: " + missing.map((m) => m.label).join(", "),
      ] as const;
    }

    return [true, ""] as const;
  };

  const buildPayload = (module: SettingsModuleSchema): Record<string, unknown> => {
    const moduleValues = { ...(values[module.module_id] ?? {}) };
    const moduleSecrets = storedSecrets[module.module_id] ?? new Set<string>();
    module.fields.forEach((field) => {
      if (field.type !== "password") return;
      const incoming = moduleValues[field.key];
      const isEmpty =
        incoming === undefined ||
        incoming === null ||
        (typeof incoming === "string" && incoming.trim() === "");
      if (isEmpty && moduleSecrets.has(field.key)) {
        moduleValues[field.key] = REDACTED_PLACEHOLDER;
      }
    });
    return moduleValues;
  };

  const validateAndSave = async (module: SettingsModuleSchema) => {
    const [valid, msg] = validateLocally(module);
    if (!valid) {
      setStatus(module.module_id, "error", msg);
      return;
    }

    setStatus(module.module_id, "saving", "Teste und speichere...");
    const payload = buildPayload(module);

    try {
      const validateRes = await fetch(`/api/settings/${module.module_id}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const validateData = await validateRes.json();

      if (!validateData.ok) {
        setStatus(module.module_id, "error", validateData.error ?? "Validierung fehlgeschlagen");
        return;
      }

      const saveRes = await fetch(`/api/settings/${module.module_id}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

  // Alert-Banner nur, wenn der Calories-LLM-Key wirklich fehlt/ungueltig ist
  // (aus dem echten Status-Payload, kein Hardcoding).
  const caloriesModule = useMemo(
    () => modules.find((m) => m.module_id === "calories"),
    [modules]
  );
  const showCaloriesAlert = Boolean(
    caloriesModule &&
      statuses["calories"]?.state !== "saving" &&
      statuses["calories"]?.state !== "syncing" &&
      isCaloriesKeyMissing(statusPayloads["calories"])
  );

  const focusCaloriesCard = () => {
    const node = cardRefs.current["calories"];
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "start" });
    const firstInput = node.querySelector<HTMLElement>(
      "input:not([readonly]):not([type=file]), select"
    );
    firstInput?.focus({ preventScroll: true });
  };

  const subtitle =
    "Verbinde Integrationen, teste API-Keys live und speichere validierte Einstellungen zentral.";

  return (
    <div className="settings-stack">
      <PageHeader eyebrow="SETTINGS" title="Module konfigurieren" subtitle={subtitle} />

      {loading && (
        <div className="panel" style={{ marginTop: 22 }}>
          <span className="kicker">Booting</span>
          <h3 className="card-title" style={{ marginTop: 8 }}>
            Settings werden geladen
          </h3>
          <p className="card-description" style={{ marginBottom: 0 }}>
            Wir sammeln alle Module mit einem Settings-Provider.
          </p>
        </div>
      )}

      {showCaloriesAlert && (
        <div className="settings-alert" role="alert">
          <span className="settings-alert__badge">!</span>
          <div className="settings-alert__text">
            <span className="settings-alert__module">Calories</span>
            {" — LLM-Key fehlt oder ist ungültig. Die Kalorien-Extraktion ist pausiert."}
          </div>
          <button
            type="button"
            className="settings-alert__action"
            onClick={focusCaloriesCard}
          >
            Jetzt beheben
          </button>
        </div>
      )}

      <div className="settings-grid">
        {modules.map((module) => {
          const moduleValues = values[module.module_id] ?? {};
          const status = statuses[module.module_id] ?? { state: "idle" as StatusState };
          const payload = statusPayloads[module.module_id];
          const pill = deriveStatusPill(module, status, payload);
          const title = MODULE_DISPLAY_TITLES[module.module_id] ?? module.module_name;
          const saveLabel = MODULE_SAVE_LABELS[module.module_id] ?? "Speichern";
          const isFlagged = module.module_id === "calories" && showCaloriesAlert;

          return (
            <div
              key={module.module_id}
              className={`settings-card${isFlagged ? " is-flagged" : ""}`}
              ref={(node) => {
                cardRefs.current[module.module_id] = node;
              }}
            >
              <div className="settings-card__header">
                <div>
                  <div className="settings-card__eyebrow">{module.module_name}</div>
                  <div className="settings-card__title">{title}</div>
                </div>
                <span
                  className={`settings-status settings-status--${pill.tone}${
                    pill.spinning ? " is-spinning" : ""
                  }`}
                >
                  <span className="settings-status__dot" />
                  {pill.label}
                </span>
              </div>

              <div className="settings-card__body">
                {status.state === "syncing" && status.progress && (
                  <div className="sync-progress" role="status" aria-live="polite">
                    <div className="sync-progress__labels">
                      <span className="settings-field__help">
                        {status.progress.stage
                          ? `Syncing (${status.progress.stage})`
                          : "Syncing läuft..."}
                      </span>
                      <span className="settings-field__help">
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

                {module.fields.map((field) => {
                  const moduleSecrets = storedSecrets[module.module_id];
                  const hasStoredSecret = Boolean(
                    field.type === "password" && moduleSecrets?.has(field.key)
                  );
                  return (
                    <div className="settings-field" key={`${module.module_id}-${field.key}`}>
                      {field.type !== "boolean" && (
                        <div className="settings-field__meta">
                          <label className="settings-label" htmlFor={field.key}>
                            {field.label}
                            {field.required && <span className="required">*</span>}
                          </label>
                          {field.help_text && (
                            <span className="settings-field__help">{field.help_text}</span>
                          )}
                        </div>
                      )}
                      {renderField(
                        field,
                        moduleValues[field.key],
                        (val) => handleChange(module.module_id, field.key, val),
                        field.type === "file" ? (file) => handleFileUpload(module, file) : undefined,
                        hasStoredSecret
                      )}
                    </div>
                  );
                })}

                {module.manual_import && (
                  <div className="manual-import">
                    <div className="settings-field__meta">
                      <span className="settings-label">{module.manual_import.label}</span>
                      {module.manual_import.help_text && (
                        <span className="settings-field__help">{module.manual_import.help_text}</span>
                      )}
                      {module.status?.upload_hint && (
                        <span className="settings-field__help">{module.status.upload_hint}</span>
                      )}
                    </div>
                    <label className="manual-import__controls">
                      <input
                        type="file"
                        accept={module.manual_import.accept?.join(",") ?? undefined}
                        className="settings-input"
                        onChange={(event) => {
                          const nextFile = event.target.files?.[0];
                          if (!nextFile) return;
                          event.target.value = "";
                          handleFileUpload(module, nextFile);
                        }}
                        disabled={uploadingModule === module.module_id}
                      />
                      <span className="settings-field__help">
                        {uploadingModule === module.module_id
                          ? "Upload & Sync laufen..."
                          : "Maximal 1 Datei"}
                      </span>
                    </label>
                    {uploadError[module.module_id] && (
                      <div className="settings-error">{uploadError[module.module_id]}</div>
                    )}
                    {module.module_id === "health" && (
                      <HealthForceClearButton
                        visible={status.state === "syncing" || status.state === "error"}
                        onCleared={() => fetchStatuses({ modules: [module] })}
                      />
                    )}
                  </div>
                )}

                {module.module_id === "health" && (
                  <HealthSyncHistory refreshKey={status.state} />
                )}

                {module.module_id === "health" && <HealthApiKeyActions />}

                {status.state === "error" && status.message && (
                  <div className="settings-error">{status.message}</div>
                )}
              </div>

              <div className="settings-card__footer">
                <button
                  className={
                    module.module_id === "calories" ? "button" : "button button-secondary"
                  }
                  onClick={() => validateAndSave(module)}
                  type="button"
                  disabled={status.state === "saving"}
                >
                  {status.state === "saving" ? "Wird geprüft..." : saveLabel}
                </button>
              </div>
            </div>
          );
        })}

        {!loading && modules.length === 0 && (
          <div className="panel">
            <span className="kicker">Settings Registry</span>
            <h3 className="card-title" style={{ marginTop: 8 }}>
              Keine Settings-Provider gefunden
            </h3>
            <p className="card-description" style={{ marginBottom: 0 }}>
              Installiere ein Modul mit Settings-Provider und es erscheint automatisch hier.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
