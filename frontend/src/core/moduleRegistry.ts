import type { ModuleFrontend, ModuleManifest, ModuleSlot } from "./types";

/**
 * Automatically collect all frontend modules from src/modules/*/index.tsx
 * (intended to run with Vite/webpack).
 */
const frontendModules = import.meta.glob("../modules/*/index.tsx", {
  eager: true,
}) as Record<string, { moduleFrontend: ModuleFrontend }>;

export function getAllFrontendModules(): ModuleFrontend[] {
  return Object.values(frontendModules).map((m) => m.moduleFrontend);
}

export function matchActiveModules(
  backendManifests: ModuleManifest[]
): ModuleFrontend[] {
  const allFrontend = getAllFrontendModules();
  const map = new Map(allFrontend.map((m) => [m.id, m]));

  return backendManifests
    .filter((m) => m.ready)
    .map((m) => map.get(m.id))
    .filter((x): x is ModuleFrontend => Boolean(x));
}

export function getWidgetsForSlot(
  activeModules: ModuleFrontend[],
  slot: ModuleSlot
) {
  return activeModules.filter((m) => m.slots.includes(slot));
}
