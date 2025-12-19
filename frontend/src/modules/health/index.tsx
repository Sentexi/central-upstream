import type { ModuleFrontend } from "../../core/types";
import { EnergyMonitorView } from "./EnergyMonitorView";
import { FitnessDashboardView } from "./FitnessDashboardView";

export const moduleFrontend: ModuleFrontend = {
  id: "health",
  slots: ["health_view", "fitness_view"],
  HealthWidget: EnergyMonitorView,
  FitnessWidget: FitnessDashboardView,
};
