import type { ModuleFrontend } from "../../core/types";
import { FitnessDashboard } from "./FitnessDashboard";

export const moduleFrontend: ModuleFrontend = {
  id: "health",
  slots: ["dashboard_view"],
  DashboardWidget: FitnessDashboard,
};
