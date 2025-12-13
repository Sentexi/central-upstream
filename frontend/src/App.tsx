import { useEffect, useState } from "react";
import { GlassCard } from "./core/GlassCard";
import type { ModuleManifest } from "./core/types";
import { getWidgetsForSlot, matchActiveModules } from "./core/moduleRegistry";
import { SettingsPage } from "./settings/SettingsPage";

type View = "today" | "settings";

function App() {
  const [manifests, setManifests] = useState<ModuleManifest[] | null>(null);
  const [view, setView] = useState<View>("today");

  useEffect(() => {
    fetch("/api/modules")
      .then((r) => r.json())
      .then((data) => setManifests(data))
      .catch((err) => {
        console.error("Failed to load module manifests", err);
        setManifests([]);
      });
  }, []);

  const activeModules = manifests ? matchActiveModules(manifests) : [];
  const todayWidgets = getWidgetsForSlot(activeModules, "today_view");

  return (
    <div className="app-shell">
      <div className="noise-overlay" aria-hidden />
      <div className="layout-grid">
        <aside className="sidebar">
          <div className="sidebar-header">
            <span className="kicker">Central Upstream</span>
            <h2 className="sidebar-title">System Operator</h2>
          </div>
          <nav className="sidebar-nav" aria-label="Hauptnavigation">
            <button
              className={`nav-item ${view === "today" ? "active" : ""}`.trim()}
              type="button"
              onClick={() => setView("today")}
            >
              <span className="nav-icon" aria-hidden>
                ⏺
              </span>
              Today
            </button>
            <button
              className={`nav-item ${view === "settings" ? "active" : ""}`.trim()}
              type="button"
              onClick={() => setView("settings")}
            >
              <span className="nav-icon" aria-hidden>
                ⚙
              </span>
              Settings
            </button>
          </nav>
          <div className="sidebar-footer" aria-live="polite">
            <span className="signal" aria-hidden />
            {manifests === null
              ? "Module Registry lädt..."
              : `${activeModules.length} Module verbunden`}
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
          ) : (
            <SettingsPage />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
