import { useCallback, useEffect, useState } from "react";
import { GlassCard } from "./core/GlassCard";
import type { ModuleManifest } from "./core/types";
import { getWidgetsForSlot, matchActiveModules } from "./core/moduleRegistry";
import { SettingsPage } from "./settings/SettingsPage";

type View = "today" | "work" | "dashboard" | "health" | "fitness" | "calories" | "settings";
type AuthStatus = "checking" | "unauthenticated" | "authenticated";

type HealthSyncStatus = {
  syncing: boolean;
  stage?: string;
};

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

  return (
    <div className="app-shell">
      <div className="noise-overlay" aria-hidden />
      <div className={`layout-grid ${isSidebarOpen ? "" : "sidebar-collapsed"}`}>
        <aside className={`sidebar ${isSidebarOpen ? "is-open" : "is-collapsed"}`}>
          <button
            className="sidebar-toggle"
            type="button"
            onClick={() => setIsSidebarOpen((open) => !open)}
            aria-expanded={isSidebarOpen}
            aria-label={isSidebarOpen ? "Sidebar einklappen" : "Sidebar ausklappen"}
          >
            <span aria-hidden>{isSidebarOpen ? "⟨" : "⟩"}</span>
          </button>
          <div className="sidebar-header">
            <span className="kicker">Central Upstream</span>
            <h2 className="sidebar-title">System Operator</h2>
          </div>
          <nav className="sidebar-nav" aria-label="Hauptnavigation">
            <button
              className={`nav-item ${view === "today" ? "active" : ""}`.trim()}
              type="button"
              onClick={() => setView("today")}
              aria-label="Today"
            >
              <span className="nav-icon" aria-hidden>
                ⏺
              </span>
              <span className="nav-label">Today</span>
            </button>
            <button
              className={`nav-item ${view === "work" ? "active" : ""}`.trim()}
              type="button"
              onClick={() => setView("work")}
              aria-label="Work"
            >
              <span className="nav-icon" aria-hidden>
                ✅
              </span>
              <span className="nav-label">Work</span>
            </button>
            <button
              className={`nav-item ${view === "dashboard" ? "active" : ""}`.trim()}
              type="button"
              onClick={() => setView("dashboard")}
              aria-label="Dashboard"
            >
              <span className="nav-icon" aria-hidden>
                📊
              </span>
              <span className="nav-label">Dashboard</span>
            </button>
            <button
              className={`nav-item ${view === "health" ? "active" : ""} ${healthStatus.syncing ? "is-syncing" : ""}`.trim()}
              type="button"
              onClick={() => setView("health")}
              aria-label="Health"
            >
              <span className="nav-icon" aria-hidden>
                ❤️
              </span>
              <span className="nav-label">Health</span>
              {healthStatus.syncing && (
                <span className="nav-status">
                  Syncing{healthStatus.stage ? ` (${healthStatus.stage})` : ""}
                </span>
              )}
            </button>
            <button
              className={`nav-item ${view === "fitness" ? "active" : ""}`.trim()}
              type="button"
              onClick={() => setView("fitness")}
              aria-label="Fitness"
            >
              <span className="nav-icon" aria-hidden>
                🏃
              </span>
              <span className="nav-label">Fitness</span>
            </button>
            <button
              className={`nav-item ${view === "calories" ? "active" : ""}`.trim()}
              type="button"
              onClick={() => setView("calories")}
              aria-label="Calories"
            >
              <span className="nav-icon" aria-hidden>
                🥗
              </span>
              <span className="nav-label">Calories</span>
            </button>
            <button
              className={`nav-item ${view === "settings" ? "active" : ""}`.trim()}
              type="button"
              onClick={() => setView("settings")}
              aria-label="Settings"
            >
              <span className="nav-icon" aria-hidden>
                ⚙
              </span>
              <span className="nav-label">Settings</span>
            </button>
          </nav>
          <div className="sidebar-footer" aria-live="polite">
            <span className="signal" aria-hidden />
            <span className="sidebar-status-text">
              {manifests === null
                ? "Module Registry lädt..."
                : `${activeModules.length} Module verbunden`}
            </span>
          </div>
        </aside>

        <main className="content-area">
          {view === "today" ? (
            <div className="app-grid">
              <header className="app-header">
                <span className="kicker">Central Upstream</span>
                <h1 className="title">System Operator</h1>
                <p className="subtitle">
                  Dark Glass UI mit Electric-Blue Akzenten. Dein Control Center für heutige
                  Tasks.
                </p>
                <div className="status" aria-live="polite">
                  <span className="signal" aria-hidden />
                  <span>
                    {manifests === null
                      ? "Module Registry lädt..."
                      : `${activeModules.length} Module verbunden`}
                  </span>
                </div>
              </header>

              <section className="stack">
                <div className="section-heading">Today</div>
                <div className="grid-cards">
                  {manifests === null && (
                    <GlassCard glow className="loader">
                      <span className="kicker">Booting</span>
                      <h3 className="card-title">Module Registry wird geladen</h3>
                      <p className="card-description">
                        Wir synchronisieren die aktiven Slots. Glass Cards pulsen statt Spinner.
                      </p>
                    </GlassCard>
                  )}

                  {manifests && todayWidgets.length === 0 && (
                    <GlassCard>
                      <div className="kicker">Keine Module aktiv</div>
                      <h3 className="card-title">Installiere dein erstes Modul</h3>
                      <p className="card-description">
                        Verbinde Integrationen, aktiviere ein Modul und es erscheint hier in der
                        Today-Ansicht.
                      </p>
                      <div className="pill">
                        <span className="dot" aria-hidden />
                        Quick Capture, Health, Mail
                      </div>
                    </GlassCard>
                  )}

                  {todayWidgets.map((mod, i) =>
                    mod.TodayWidget ? <mod.TodayWidget key={i} /> : null
                  )}
                </div>
              </section>
            </div>
          ) : view === "work" ? (
            <div className="app-grid">
              <header className="app-header">
                <span className="kicker">Work</span>
                <h1 className="title">Focus &amp; Projects</h1>
                <p className="subtitle">Eine zentrale Sicht auf deine synchronisierten Aufgaben.</p>
              </header>
              <section className="stack">
                <div className="section-heading">Work Dashboard</div>
                <div className="grid-cards">
                  {manifests === null && (
                    <GlassCard glow className="loader">
                      <span className="kicker">Booting</span>
                      <h3 className="card-title">Module Registry wird geladen</h3>
                      <p className="card-description">
                        Wir synchronisieren die aktiven Slots. Glass Cards pulsen statt Spinner.
                      </p>
                    </GlassCard>
                  )}
                  {manifests && workWidgets.length === 0 && (
                    <GlassCard>
                      <div className="kicker">Keine Work-Module aktiv</div>
                      <h3 className="card-title">Aktiviere die Notion Sync</h3>
                      <p className="card-description">
                        Nach der Konfiguration erscheinen hier deine synchronisierten Aufgaben.
                      </p>
                    </GlassCard>
                  )}
                  {workWidgets.map((mod, i) =>
                    mod.WorkWidget ? <mod.WorkWidget key={i} /> : null
                  )}
                </div>
              </section>
            </div>
          ) : view === "dashboard" ? (
            <div className="app-grid">
              <header className="app-header">
                <span className="kicker">Dashboard</span>
                <h1 className="title">Flow &amp; Trends</h1>
                <p className="subtitle">
                  Überblick über Erledigungen, Inflow und aktive Arbeitszeiten deiner Aufgaben.
                </p>
              </header>
              <section className="stack">
                <div className="section-heading">Task Dashboards</div>
                <div className="grid-cards">
                  {manifests === null && (
                    <GlassCard glow className="loader">
                      <span className="kicker">Booting</span>
                      <h3 className="card-title">Module Registry wird geladen</h3>
                      <p className="card-description">
                        Wir synchronisieren die aktiven Slots. Glass Cards pulsen statt Spinner.
                      </p>
                    </GlassCard>
                  )}
                  {manifests && dashboardWidgets.length === 0 && (
                    <GlassCard>
                      <div className="kicker">Keine Dashboard-Module aktiv</div>
                      <h3 className="card-title">Aktiviere eine Integration</h3>
                      <p className="card-description">
                        Verbinde ein Modul mit Dashboard-Slot, um hier Daten zu sehen.
                      </p>
                    </GlassCard>
                  )}
                  {dashboardWidgets.map((mod, i) =>
                    mod.DashboardWidget ? <mod.DashboardWidget key={i} /> : null
                  )}
                </div>
              </section>
            </div>
          ) : view === "health" ? (
            <div className="app-grid">
              <header className="app-header">
                <span className="kicker">Health</span>
                <h1 className="title">Energy Monitor</h1>
                <p className="subtitle">Verdichtete Tagesmetrik, Readiness-Barometer &amp; Trends.</p>
              </header>
              <section className="stack">
                <div className="section-heading">Energy Monitor</div>
                <div className="grid-cards">
                  {manifests === null && (
                    <GlassCard glow className="loader">
                      <span className="kicker">Booting</span>
                      <h3 className="card-title">Module Registry wird geladen</h3>
                      <p className="card-description">
                        Wir synchronisieren die aktiven Slots. Glass Cards pulsen statt Spinner.
                      </p>
                    </GlassCard>
                  )}
                  {manifests && healthWidgets.length === 0 && (
                    <GlassCard>
                      <div className="kicker">Kein Health-Modul aktiv</div>
                      <h3 className="card-title">Aktiviere den Energy Monitor</h3>
                      <p className="card-description">
                        Nach der Health-Sync erscheint hier die neue Energy Monitor Ansicht.
                      </p>
                    </GlassCard>
                  )}
                  {healthWidgets.map((mod, i) =>
                    mod.HealthWidget ? <mod.HealthWidget key={i} /> : null
                  )}
                </div>
              </section>
            </div>
          ) : view === "fitness" ? (
            <div className="app-grid">
              <header className="app-header">
                <span className="kicker">Health</span>
                <h1 className="title">Fitness Dashboard</h1>
                <p className="subtitle">
                  Weekly Volume, Consistency, Efficiency und Mobility Trends mit einem Toggle nach Range.
                </p>
              </header>
              <section className="stack">
                <div className="section-heading">Fitness Dashboard</div>
                <div className="grid-cards">
                  {manifests === null && (
                    <GlassCard glow className="loader">
                      <span className="kicker">Booting</span>
                      <h3 className="card-title">Module Registry wird geladen</h3>
                      <p className="card-description">
                        Wir synchronisieren die aktiven Slots. Glass Cards pulsen statt Spinner.
                      </p>
                    </GlassCard>
                  )}
                  {manifests && fitnessWidgets.length === 0 && (
                    <GlassCard>
                      <div className="kicker">Kein Fitness-Dashboard aktiv</div>
                      <h3 className="card-title">Aktiviere das Health-Modul</h3>
                      <p className="card-description">
                        Nach der Health-Sync erscheint hier das neue Fitness Dashboard mit Volume, Consistency und
                        Efficiency.
                      </p>
                    </GlassCard>
                  )}
                  {fitnessWidgets.map((mod, i) =>
                    mod.FitnessWidget ? <mod.FitnessWidget key={i} /> : null
                  )}
                </div>
              </section>
            </div>
          ) : view === "calories" ? (
            <div className="app-grid">
              <header className="app-header">
                <span className="kicker">Wellbeing</span>
                <h1 className="title">Calories &amp; Vape</h1>
                <p className="subtitle">
                  Plain-Text Capture, Draft Review, Importe und Vape-Counter in einer konsolidierten Ansicht.
                </p>
              </header>
              <section className="stack">
                <div className="section-heading">Calories</div>
                <div className="grid-cards">
                  {manifests === null && (
                    <GlassCard glow className="loader">
                      <span className="kicker">Booting</span>
                      <h3 className="card-title">Module Registry wird geladen</h3>
                      <p className="card-description">
                        Wir synchronisieren die aktiven Slots. Glass Cards pulsen statt Spinner.
                      </p>
                    </GlassCard>
                  )}
                  {manifests && caloriesWidgets.length === 0 && (
                    <GlassCard>
                      <div className="kicker">Kein Calories-Modul aktiv</div>
                      <h3 className="card-title">Aktiviere das Calories-Modul</h3>
                      <p className="card-description">
                        Hinterlege einen LLM-Key in den Settings, um Kalorien und Vape zu erfassen.
                      </p>
                    </GlassCard>
                  )}
                  {caloriesWidgets.map((mod, i) =>
                    mod.CaloriesWidget ? <mod.CaloriesWidget key={i} /> : null
                  )}
                </div>
              </section>
            </div>
          ) : (
            <SettingsPage />
          )}
        </main>
      </div>
    </div>
  );
}

type AuthFormProps = {
  onSubmit: (username: string, password: string) => void;
  error: string | null;
};

function AuthLoginForm({ onSubmit, error }: AuthFormProps) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");

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
  const [currentPassword, setCurrentPassword] = useState("admin");
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
