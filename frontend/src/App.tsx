import { useCallback, useEffect, useState } from "react";
import type { ComponentType } from "react";
import {
  Target,
  ListChecks,
  LayoutGrid,
  Heart,
  Activity,
  Soup,
  Wind,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { GlassCard } from "./core/GlassCard";
import { PageHeader } from "./core/ui";
import type { ModuleFrontend, ModuleManifest } from "./core/types";
import { getWidgetsForSlot, matchActiveModules } from "./core/moduleRegistry";
import { SettingsPage } from "./settings/SettingsPage";

/** Slot-Widget-Keys auf ModuleFrontend (nur die Komponenten-Felder). */
type WidgetKey =
  | "TodayWidget"
  | "WorkWidget"
  | "DashboardWidget"
  | "HealthWidget"
  | "FitnessWidget"
  | "CaloriesWidget"
  | "VapeTrackerWidget";

type View =
  | "today"
  | "work"
  | "dashboard"
  | "health"
  | "fitness"
  | "calories"
  | "vape"
  | "settings";
type AuthStatus = "checking" | "unauthenticated" | "authenticated";

type HealthSyncStatus = {
  syncing: boolean;
  stage?: string;
};

type NavConfig = {
  view: View;
  label: string;
  Icon: LucideIcon;
};

const NAV_ITEMS: NavConfig[] = [
  { view: "today", label: "Today", Icon: Target },
  { view: "work", label: "Work", Icon: ListChecks },
  { view: "dashboard", label: "Dashboard", Icon: LayoutGrid },
  { view: "health", label: "Health", Icon: Heart },
  { view: "fitness", label: "Fitness", Icon: Activity },
  { view: "calories", label: "Calories", Icon: Soup },
  { view: "vape", label: "Vape", Icon: Wind },
  { view: "settings", label: "Settings", Icon: SettingsIcon },
];

function parseHealthSyncStatus(value: unknown): HealthSyncStatus {
  if (!value || typeof value !== "object") {
    return { syncing: false, stage: undefined };
  }

  const data = value as {
    syncing?: boolean;
    sync_status?: { stage?: string | null } | null;
  };

  const syncing = Boolean(data.syncing);
  const stageRaw =
    data.sync_status && typeof data.sync_status === "object"
      ? (data.sync_status as { stage?: string | null }).stage
      : undefined;

  return { syncing, stage: stageRaw ?? undefined };
}

function App() {
  const [manifests, setManifests] = useState<ModuleManifest[] | null>(null);
  const [view, setView] = useState<View>("today");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [healthStatus, setHealthStatus] = useState<HealthSyncStatus>({ syncing: false });
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const [mustChangeCredentials, setMustChangeCredentials] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (r) => {
        if (!r.ok) {
          throw new Error("Unauthorized");
        }
        return r.json();
      })
      .then((data) => {
        setAuthStatus("authenticated");
        setMustChangeCredentials(Boolean(data.must_change));
      })
      .catch(() => {
        setAuthStatus("unauthenticated");
        setMustChangeCredentials(false);
      });
  }, []);

  const fetchHealthStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/health/status");
      const data = await response.json();
      const parsed = parseHealthSyncStatus(data);

      setHealthStatus(parsed.syncing ? parsed : { syncing: false });
    } catch (err) {
      console.error("Failed to load health sync status", err);
      setHealthStatus({ syncing: false });
    }
  }, []);

  useEffect(() => {
    if (authStatus !== "authenticated" || mustChangeCredentials) {
      return;
    }

    fetchHealthStatus();
  }, [authStatus, fetchHealthStatus, mustChangeCredentials]);

  useEffect(() => {
    if (authStatus !== "authenticated" || mustChangeCredentials || !healthStatus.syncing) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      fetchHealthStatus();
    }, 1500);

    return () => window.clearInterval(interval);
  }, [authStatus, fetchHealthStatus, healthStatus.syncing, mustChangeCredentials]);

  useEffect(() => {
    if (authStatus !== "authenticated" || mustChangeCredentials) {
      return;
    }

    fetch("/api/modules")
      .then((r) => r.json())
      .then((data) => setManifests(data))
      .catch((err) => {
        console.error("Failed to load module manifests", err);
        setManifests([]);
      });
  }, [authStatus, mustChangeCredentials]);

  const handleLogin = async (username: string, password: string) => {
    setAuthError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? "Login failed.");
      }

      setAuthStatus("authenticated");
      setMustChangeCredentials(Boolean(data.must_change));
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Login failed.");
      setAuthStatus("unauthenticated");
    }
  };

  const handleChangeCredentials = async (
    currentPassword: string,
    username: string,
    password: string
  ) => {
    setAuthError(null);
    try {
      const response = await fetch("/api/auth/change-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: currentPassword, username, password }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? "Update failed.");
      }

      setMustChangeCredentials(Boolean(data.must_change));
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Update failed.");
    }
  };

  if (authStatus === "checking") {
    return (
      <div className="auth-screen">
        <GlassCard className="auth-card">
          <div className="section-heading">Checking access</div>
          <p className="card-description">Authentifizierung wird geprüft…</p>
        </GlassCard>
      </div>
    );
  }

  if (authStatus === "unauthenticated") {
    return (
      <div className="auth-screen">
        <GlassCard className="auth-card" glow>
          <div className="section-heading">Login</div>
          <p className="card-description">Bitte melde dich an, um fortzufahren.</p>
          <AuthLoginForm onSubmit={handleLogin} error={authError} />
        </GlassCard>
      </div>
    );
  }

  if (mustChangeCredentials) {
    return (
      <div className="auth-screen">
        <GlassCard className="auth-card" glow stressLevel="high">
          <div className="section-heading">Passwort ändern</div>
          <p className="card-description">
            Bitte ändere den Standard-Login, bevor du fortfährst.
          </p>
          <ChangeCredentialsForm onSubmit={handleChangeCredentials} error={authError} />
        </GlassCard>
      </div>
    );
  }

  const activeModules = manifests ? matchActiveModules(manifests) : [];
  const todayWidgets = getWidgetsForSlot(activeModules, "today_view");
  const workWidgets = getWidgetsForSlot(activeModules, "work_dashboard");
  const dashboardWidgets = getWidgetsForSlot(activeModules, "dashboard_view");
  const healthWidgets = getWidgetsForSlot(activeModules, "health_view");
  const fitnessWidgets = getWidgetsForSlot(activeModules, "fitness_view");
  const caloriesWidgets = getWidgetsForSlot(activeModules, "calories_view");
  const vapeTrackerWidgets = getWidgetsForSlot(activeModules, "vape_tracker_view");

  return (
    <div className={`app-shell ${isSidebarOpen ? "" : "sidebar-collapsed"}`.trim()}>
      <div className="layout-grid">
        <aside className={`sidebar ${isSidebarOpen ? "is-open" : "is-collapsed"}`}>
          <div className="sidebar-header">
            <div className="sidebar-brand">
              <span className="kicker">Central Upstream</span>
              <h2 className="sidebar-title">System Operator</h2>
            </div>
            <button
              className="sidebar-toggle"
              type="button"
              onClick={() => setIsSidebarOpen((open) => !open)}
              aria-expanded={isSidebarOpen}
              aria-label={isSidebarOpen ? "Sidebar einklappen" : "Sidebar ausklappen"}
            >
              {isSidebarOpen ? (
                <ChevronLeft size={14} aria-hidden />
              ) : (
                <ChevronRight size={14} aria-hidden />
              )}
            </button>
          </div>

          <nav className="sidebar-nav" aria-label="Hauptnavigation">
            {NAV_ITEMS.map(({ view: itemView, label, Icon }) => {
              const isActive = view === itemView;
              const isHealthSyncing = itemView === "health" && healthStatus.syncing;

              return (
                <button
                  key={itemView}
                  className={`nav-item ${isActive ? "active" : ""} ${
                    isHealthSyncing ? "is-syncing" : ""
                  }`.trim()}
                  type="button"
                  onClick={() => setView(itemView)}
                  aria-label={label}
                  aria-current={isActive ? "page" : undefined}
                  title={isSidebarOpen ? undefined : label}
                >
                  <span className="nav-icon" aria-hidden>
                    <Icon size={16} strokeWidth={1.7} aria-hidden />
                  </span>
                  <span className="nav-label">{label}</span>
                  {isHealthSyncing && (
                    <span className="nav-status">
                      Syncing{healthStatus.stage ? ` (${healthStatus.stage})` : ""}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="sidebar-footer" aria-live="polite">
            <span className="signal" aria-hidden />
            <span className="sidebar-status-text">
              {manifests === null
                ? "Module Registry lädt…"
                : `${activeModules.length} Module verbunden`}
            </span>
          </div>
        </aside>

        <main className="content-area">
          {view === "today" ? (
            <TodayView manifests={manifests} widgets={todayWidgets} />
          ) : view === "work" ? (
            <ModuleSlot
              manifests={manifests}
              widgets={workWidgets}
              widgetKey="WorkWidget"
              emptyEyebrow="Keine Work-Module aktiv"
              emptyTitle="Aktiviere die Notion Sync"
              emptyHint="Nach der Konfiguration erscheinen hier deine synchronisierten Aufgaben."
            />
          ) : view === "dashboard" ? (
            <ModuleSlot
              manifests={manifests}
              widgets={dashboardWidgets}
              widgetKey="DashboardWidget"
              emptyEyebrow="Keine Dashboard-Module aktiv"
              emptyTitle="Aktiviere eine Integration"
              emptyHint="Verbinde ein Modul mit Dashboard-Slot, um hier Daten zu sehen."
            />
          ) : view === "health" ? (
            <ModuleSlot
              manifests={manifests}
              widgets={healthWidgets}
              widgetKey="HealthWidget"
              emptyEyebrow="Kein Health-Modul aktiv"
              emptyTitle="Aktiviere den Energy Monitor"
              emptyHint="Nach der Health-Sync erscheint hier die neue Energy Monitor Ansicht."
            />
          ) : view === "fitness" ? (
            <ModuleSlot
              manifests={manifests}
              widgets={fitnessWidgets}
              widgetKey="FitnessWidget"
              emptyEyebrow="Kein Fitness-Dashboard aktiv"
              emptyTitle="Aktiviere das Health-Modul"
              emptyHint="Nach der Health-Sync erscheint hier das neue Fitness Dashboard mit Volume, Consistency und Efficiency."
            />
          ) : view === "calories" ? (
            <ModuleSlot
              manifests={manifests}
              widgets={caloriesWidgets}
              widgetKey="CaloriesWidget"
              emptyEyebrow="Kein Calories-Modul aktiv"
              emptyTitle="Aktiviere das Calories-Modul"
              emptyHint="Hinterlege einen LLM-Key in den Settings, um Kalorien zu erfassen."
            />
          ) : view === "vape" ? (
            <ModuleSlot
              manifests={manifests}
              widgets={vapeTrackerWidgets}
              widgetKey="VapeTrackerWidget"
              emptyEyebrow="Kein Vape Tracker aktiv"
              emptyTitle="Aktiviere das Vape Tracker Modul"
              emptyHint="Danach kannst du Counterstände und Coil Wechsel protokollieren."
            />
          ) : (
            <SettingsPage />
          )}
        </main>
      </div>
    </div>
  );
}

type LoaderProps = {
  manifests: ModuleManifest[] | null;
};

/** Booting-Panel, solange die Module-Registry noch laedt. */
function RegistryLoader() {
  return (
    <div className="panel panel--muted">
      <span className="kicker">Booting</span>
      <h3 className="card-title">Module Registry wird geladen</h3>
      <p className="card-description">Wir synchronisieren die aktiven Slots.</p>
    </div>
  );
}

type EmptyStateProps = {
  eyebrow: string;
  title: string;
  hint: string;
};

/** Empty-State-Panel, wenn fuer einen Slot kein Modul aktiv ist. */
function EmptyState({ eyebrow, title, hint }: EmptyStateProps) {
  return (
    <div className="panel">
      <span className="kicker">{eyebrow}</span>
      <h3 className="card-title">{title}</h3>
      <p className="card-description">{hint}</p>
    </div>
  );
}

type ModuleSlotProps = LoaderProps & {
  widgets: ModuleFrontend[];
  widgetKey: WidgetKey;
  emptyEyebrow: string;
  emptyTitle: string;
  emptyHint: string;
};

/**
 * Rendert die Modul-Widgets eines Slots. Die Modul-Views bringen ihren eigenen
 * PageHeader mit (ab Task 3), daher gibt es hier keinen generischen App-Header
 * mehr, nur noch Loading- und Empty-States.
 */
function ModuleSlot({
  manifests,
  widgets,
  widgetKey,
  emptyEyebrow,
  emptyTitle,
  emptyHint,
}: ModuleSlotProps) {
  if (manifests === null) {
    return <RegistryLoader />;
  }

  if (widgets.length === 0) {
    return <EmptyState eyebrow={emptyEyebrow} title={emptyTitle} hint={emptyHint} />;
  }

  return (
    <div className="slot-stack">
      {widgets.map((mod, i) => {
        const Widget = mod[widgetKey] as ComponentType | undefined;
        return Widget ? <Widget key={i} /> : null;
      })}
    </div>
  );
}

type TodayViewProps = LoaderProps & {
  widgets: ModuleFrontend[];
};

/**
 * Today-Platzhalter im Aqua-Operator-Stil: PageHeader + ein Hinweis-Panel
 * (das Tagesaggregat folgt spaeter) plus die vorhandenen today_view-Widgets.
 */
function TodayView({ manifests, widgets }: TodayViewProps) {
  return (
    <div className="slot-stack">
      <PageHeader
        eyebrow="Today"
        title="Today"
        subtitle="Dein Control Center für heute. Module-Widgets und das Tagesaggregat sammeln sich hier."
      />

      <div className="panel">
        <span className="kicker">Tagesüberblick</span>
        <p className="card-description" style={{ margin: "8px 0 0" }}>
          Das verdichtete Tagesaggregat folgt in einem späteren Schritt. Bis dahin findest du hier
          deine Quick-Capture-Eingaben und die aktiven Today-Widgets.
        </p>
      </div>

      {manifests === null && <RegistryLoader />}

      {manifests && widgets.length === 0 && (
        <EmptyState
          eyebrow="Keine Module aktiv"
          title="Installiere dein erstes Modul"
          hint="Verbinde Integrationen, aktiviere ein Modul und es erscheint hier in der Today-Ansicht."
        />
      )}

      {widgets.map((mod, i) => (mod.TodayWidget ? <mod.TodayWidget key={i} /> : null))}
    </div>
  );
}

type AuthFormProps = {
  onSubmit: (username: string, password: string) => void;
  error: string | null;
};

function AuthLoginForm({ onSubmit, error }: AuthFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <form
      className="auth-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(username, password);
      }}
    >
      <label className="input-label" htmlFor="login-username">
        Benutzername
      </label>
      <input
        id="login-username"
        className="input"
        type="text"
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        autoComplete="username"
      />
      <label className="input-label" htmlFor="login-password">
        Passwort
      </label>
      <input
        id="login-password"
        className="input"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="current-password"
      />
      {error && <div className="form-error">{error}</div>}
      <button className="button" type="submit">
        Login
      </button>
    </form>
  );
}

type ChangeCredentialsFormProps = {
  onSubmit: (currentPassword: string, username: string, password: string) => void;
  error: string | null;
};

function ChangeCredentialsForm({ onSubmit, error }: ChangeCredentialsFormProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <form
      className="auth-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(currentPassword, username, password);
      }}
    >
      <label className="input-label" htmlFor="current-password">
        Aktuelles Passwort
      </label>
      <input
        id="current-password"
        className="input"
        type="password"
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
        autoComplete="current-password"
      />
      <label className="input-label" htmlFor="new-username">
        Neuer Benutzername
      </label>
      <input
        id="new-username"
        className="input"
        type="text"
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        autoComplete="username"
      />
      <label className="input-label" htmlFor="new-password">
        Neues Passwort
      </label>
      <input
        id="new-password"
        className="input"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="new-password"
      />
      {error && <div className="form-error">{error}</div>}
      <button className="button" type="submit">
        Zugang aktualisieren
      </button>
    </form>
  );
}

export default App;
