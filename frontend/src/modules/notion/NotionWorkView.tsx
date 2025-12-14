import { NotionTaskDashboard } from "./NotionTaskDashboard";
import { NotionTodosView } from "./NotionTodosView";

export function NotionWorkView() {
  return (
    <>
      <NotionTodosView />
      <NotionTaskDashboard />
    </>
  );
}
