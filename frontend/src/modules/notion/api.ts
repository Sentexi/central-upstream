import type { NotionColumn, RowsResponse, SyncResult, SyncStatus } from "./types";

const BASE_URL = "/api/modules/notion";

type RowsQuery = {
  q?: string;
  filters?: Record<string, unknown>;
  sort?: string;
  limit?: number;
  offset?: number;
};

function buildRowsQuery(params: RowsQuery): string {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.filters) query.set("filters", JSON.stringify(params.filters));
  if (params.sort) query.set("sort", params.sort);
  if (params.limit) query.set("limit", String(params.limit));
  if (typeof params.offset === "number") query.set("offset", String(params.offset));
  const qs = query.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchColumns(): Promise<NotionColumn[]> {
  const res = await fetch(`${BASE_URL}/columns`);
  if (!res.ok) throw new Error("Failed to fetch Notion columns");
  return res.json();
}

export async function fetchRows(params: RowsQuery = {}): Promise<RowsResponse> {
  const res = await fetch(`${BASE_URL}/rows${buildRowsQuery(params)}`);
  if (!res.ok) throw new Error("Failed to fetch Notion rows");
  return res.json();
}

async function handleSyncResponse(res: Response): Promise<SyncStatus> {
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

export async function triggerSync(force_full = false): Promise<SyncStatus> {
  const res = await fetch(`${BASE_URL}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force_full }),
  });
  return handleSyncResponse(res);
}

export async function fetchSyncStatus(): Promise<SyncStatus> {
  const res = await fetch(`${BASE_URL}/sync/status`);
  return handleSyncResponse(res);
}
