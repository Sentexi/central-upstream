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

export type RowsResponse = {
  items: NotionRow[];
  total: number;
  limit: number;
  offset: number;
};
