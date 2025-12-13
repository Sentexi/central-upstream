export type NotionTask = {
  id: string;
  title: string;
  status?: string | null;
  due_date?: string | null;
  project?: string | null;
  area?: string | null;
  priority?: string | null;
  assignee?: string | null;
  tags_json?: string | null;
  url?: string | null;
  archived: number;
  created_time?: string | null;
  last_edited_time?: string | null;
};

export type NotionFilters = {
  statuses: string[];
  projects: string[];
  areas: string[];
};

export type SyncResult = {
  ok: boolean;
  mode: string;
  fetched_count: number;
  upserted_count: number;
  duration_ms: number;
  error?: string | null;
};

export type TodoResponse = {
  items: NotionTask[];
  total: number;
  limit: number;
  offset: number;
};
