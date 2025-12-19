import { useCallback, useEffect, useState } from "react";
import { GlassCard } from "./core/GlassCard";
import type { ModuleManifest } from "./core/types";
import { getWidgetsForSlot, matchActiveModules } from "./core/moduleRegistry";
import { SettingsPage } from "./settings/SettingsPage";

type View = "today" | "work" | "dashboard" | "health" | "fitness" | "settings";

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

  useEffect(() => {
    fetch("/api/modules")
      .then((r) => r.json())
      .then((data) => setManifests(data))
      .catch((err) => {
        console.error("Failed to load module manifests", err);
        setManifests([]);
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
    fetchHealthStatus();
  }, [fetchHealthStatus]);

  useEffect(() => {
    if (!healthStatus.syncing) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      fetchHealthStatus();
    }, 1500);

    return () => window.clearInterval(interval);
  }, [fetchHealthStatus, healthStatus.syncing]);

  const activeModules = manifests ? matchActiveModules(manifests) : [];
  const todayWidgets = getWidgetsForSlot(activeModules, "today_view");
  const workWidgets = getWidgetsForSlot(activeModules, "work_dashboard");
  const dashboardWidgets = getWidgetsForSlot(activeModules, "dashboard_view");
  const healthWidgets = getWidgetsForSlot(activeModules, "health_view");
  const fitnessWidgets = getWidgetsForSlot(activeModules, "fitness_view");

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
          ) : (
            <SettingsPage />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
