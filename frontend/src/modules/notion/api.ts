import type { NotionFilters, NotionTask, SyncResult, TodoResponse } from "./types";

type TodoQuery = {
  q?: string;
  status?: string[];
  project?: string;
  area?: string;
  due_from?: string;
  due_to?: string;
  archived?: boolean;
  sort?: string;
  limit?: number;
  offset?: number;
};

function buildQuery(params: TodoQuery): string {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.status && params.status.length > 0) query.set("status", params.status.join(","));
  if (params.project) query.set("project", params.project);
  if (params.area) query.set("area", params.area);
  if (params.due_from) query.set("due_from", params.due_from);
  if (params.due_to) query.set("due_to", params.due_to);
  if (params.archived) query.set("archived", "1");
  if (params.sort) query.set("sort", params.sort);
  if (params.limit) query.set("limit", String(params.limit));
  if (typeof params.offset === "number") query.set("offset", String(params.offset));
  const qs = query.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchTodos(params: TodoQuery = {}): Promise<TodoResponse> {
  const res = await fetch(`/api/modules/notion/todos${buildQuery(params)}`);
  if (!res.ok) throw new Error("Failed to fetch Notion todos");
  return res.json();
}

export async function fetchFilters(): Promise<NotionFilters> {
  const res = await fetch("/api/modules/notion/filters");
  if (!res.ok) throw new Error("Failed to fetch filters");
  return res.json();
}

export async function triggerSync(force_full = false): Promise<SyncResult> {
  const res = await fetch("/api/modules/notion/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force_full }),
  });
  if (!res.ok) {
    const statusLabel = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`;
    let errorMessage = `Sync failed (${statusLabel})`;
    const text = await res.text();
    try {
      const body = JSON.parse(text);
      if (body?.error) errorMessage = `Sync failed: ${body.error}`;
      else if (body?.message) errorMessage = `Sync failed: ${body.message}`;
      else if (text) errorMessage = `Sync failed (${statusLabel}): ${text}`;
    } catch (err) {
      if (text) errorMessage = `Sync failed (${statusLabel}): ${text}`;
    }
    throw new Error(errorMessage);
  }
  return res.json();
}

export function parseTags(tags_json?: string | null): string[] {
  if (!tags_json) return [];
  try {
    const parsed = JSON.parse(tags_json);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}
