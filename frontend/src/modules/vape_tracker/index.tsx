import type { ModuleFrontend } from "../../core/types";
import { VapeTrackerView } from "./VapeTrackerView";
import "./vapeTracker.css";

export const moduleFrontend: ModuleFrontend = {
  id: "vape_tracker",
  slots: ["vape_tracker_view"],
  VapeTrackerWidget: VapeTrackerView,
};
