export type VapeGranularity = "day" | "week" | "month";
export type VapeRange = "14d" | "30d" | "90d" | "6m" | "12m";

export type VapeEntry = {
  id: number;
  date: string;
  timestamp: string;
  counter: number;
  delta: number;
  note: string | null;
  event_type: "reading" | "coil_change" | "baseline";
  usage_date: string | null;
  created_at: string;
};

export type VapeBucket = {
  period_start: string;
  period_end: string;
  total_puffs: number;
  average_per_day: number;
  days: number;
  observed_days: number;
  coil_changes: number;
};

export type VapeOverview = {
  ok: true;
  range: {
    date_from: string;
    date_to: string;
  };
  granularity: VapeGranularity;
  buckets: VapeBucket[];
  summary: {
    total_puffs: number;
    average_per_day: number;
    period_days: number;
    days_with_data: number;
    coil_changes: number;
    today_puffs: number;
    previous_average_per_day: number | null;
    change_percent: number | null;
  };
  latest: VapeEntry | null;
  entries: VapeEntry[];
};

type ApiError = {
  ok?: false;
  error?: string;
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = (await response.json()) as T & ApiError;
  if (!response.ok || data.ok === false) {
    throw new Error(data.error ?? "Vape Tracker konnte die Anfrage nicht verarbeiten.");
  }
  return data;
}

export function fetchVapeOverview(
  granularity: VapeGranularity,
  range: VapeRange,
): Promise<VapeOverview> {
  const params = new URLSearchParams({ granularity, range });
  return requestJson<VapeOverview>(`/api/vape/overview?${params.toString()}`);
}

export function saveVapeCounter(counter: number): Promise<{ ok: true; entry: VapeEntry }> {
  return requestJson("/api/vape", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ counter }),
  });
}

export function saveCoilChange(
  counter: number,
): Promise<{ ok: true; final_reading: VapeEntry; reset: VapeEntry }> {
  return requestJson("/api/vape/coil-change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ counter }),
  });
}
