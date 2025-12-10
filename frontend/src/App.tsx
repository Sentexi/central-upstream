import { useEffect, useState } from "react";
import type { ModuleManifest } from "./core/types";
import { matchActiveModules, getWidgetsForSlot } from "./core/moduleRegistry";

function App() {
  const [manifests, setManifests] = useState<ModuleManifest[] | null>(null);

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
    <div>
      <header>
        <h1>Central Upstream</h1>
        <p>Shell ohne aktive Module (Skeleton)</p>
      </header>

      <main>
        <section>
          <h2>Today</h2>
          {manifests === null && <p>Lade Module...</p>}

          {manifests && todayWidgets.length === 0 && (
            <div>
              <p>Noch keine Module aktiv.</p>
              <ul>
                <li>Später: Integrationen verbinden.</li>
                <li>Später: Module installieren / aktivieren.</li>
              </ul>
            </div>
          )}

          {todayWidgets.length > 0 &&
            todayWidgets.map((mod, i) =>
              mod.TodayWidget ? <mod.TodayWidget key={i} /> : null
            )}
        </section>
      </main>
    </div>
  );
}

export default App;
