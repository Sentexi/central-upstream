import type { ModuleFrontend } from "../../core/types";
import { EnergyMonitorView } from "./EnergyMonitorView";

export const moduleFrontend: ModuleFrontend = {
  id: "health",
  slots: ["health_view"],
  HealthWidget: EnergyMonitorView,
};
