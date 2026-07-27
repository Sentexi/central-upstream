import type { ModuleFrontend } from "../../core/types";
import { EnergyMonitorView } from "./EnergyMonitorView";
import { FitnessModuleView } from "./FitnessModuleView";

export const moduleFrontend: ModuleFrontend = {
  id: "health",
  slots: ["health_view", "fitness_view"],
  HealthWidget: EnergyMonitorView,
  FitnessWidget: FitnessModuleView,
};
