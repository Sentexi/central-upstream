import type { ModuleFrontend } from "../../core/types";
import { NotionTodosView } from "./NotionTodosView";

export const moduleFrontend: ModuleFrontend = {
  id: "notion",
  slots: ["work_dashboard"],
  WorkWidget: NotionTodosView,
};
