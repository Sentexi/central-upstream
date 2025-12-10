import type { ModuleFrontend } from "../../core/types";
import { QuickCaptureWidget } from "./QuickCaptureWidget";

export const moduleFrontend: ModuleFrontend = {
  id: "quick_capture",
  slots: ["today_view"],
  TodayWidget: QuickCaptureWidget,
};
