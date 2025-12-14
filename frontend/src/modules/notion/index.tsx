import type { ModuleFrontend } from "../../core/types";
import { NotionDashboardView } from "./NotionDashboardView";
import { NotionWorkView } from "./NotionWorkView";

export const moduleFrontend: ModuleFrontend = {
  id: "notion",
  slots: ["work_dashboard", "dashboard_view"],
  WorkWidget: NotionWorkView,
  DashboardWidget: NotionDashboardView,
};
