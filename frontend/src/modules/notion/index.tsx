import type { ModuleFrontend } from "../../core/types";
import { NotionWorkView } from "./NotionWorkView";

export const moduleFrontend: ModuleFrontend = {
  id: "notion",
  slots: ["work_dashboard"],
  WorkWidget: NotionWorkView,
};
