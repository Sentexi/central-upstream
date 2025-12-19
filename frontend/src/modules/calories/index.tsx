import type { ModuleFrontend } from "../../core/types";
import { CaloriesView } from "./CaloriesView";

export const moduleFrontend: ModuleFrontend = {
  id: "calories",
  slots: ["calories_view"],
  CaloriesWidget: CaloriesView,
};
