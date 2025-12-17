import type { ModuleFrontend } from "../../core/types";
import { HealthDashboard } from "./HealthDashboard";

export const moduleFrontend: ModuleFrontend = {
  id: "health",
  slots: ["health_view"],
  HealthWidget: HealthDashboard,
};
