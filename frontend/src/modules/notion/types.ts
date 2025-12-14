export type NotionColumn = {
  key: string;
  label: string;
  type?: string | null;
};

export type NotionRow = Record<string, unknown>;

export type SyncResult = {
  ok: boolean;
  mode: string;
  fetched_count: number;
  upserted_count: number;
  duration_ms: number;
  error?: string | null;
};

export type SyncStatus = {
  status: "idle" | "running" | "completed" | "error";
  processed: number;
  total: number;
  mode: "full" | "refresh";
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
  result?: SyncResult | null;
};

export type RowsResponse = {
  items: NotionRow[];
  total: number;
  limit: number;
  offset: number;
};

export type DailyFlow = {
  date: string;
  created: number;
  completed: number;
};

export type WeeklyFlow = {
  period: string;
  incoming: number;
  completed: number;
  net: number;
};

export type WorkspaceOpen = {
  workspace: string;
  count: number;
};

export type TaskDashboardSummary = {
  open: number;
  completed: number;
  incoming_last_7d: number;
  completed_last_7d: number;
};

export type TaskDashboardStats = {
  daily_flow: DailyFlow[];
  weekly_flow: WeeklyFlow[];
  open_by_workspace: WorkspaceOpen[];
  summary: TaskDashboardSummary;
};
