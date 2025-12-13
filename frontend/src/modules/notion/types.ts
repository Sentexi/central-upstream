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
