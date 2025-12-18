export type RangeKey = "today" | "7d" | "14d" | "30d";

export interface MetricPoint {
  date: string;
  value: number | null;
  avg?: number | null;
}

export interface ActivityPoint {
  date: string;
  steps: number | null;
  exercise_min: number | null;
  active_kcal: number | null;
}

export interface TileData {
  label: string;
  value?: number | null;
  avg?: number | null;
  unit?: string;
  delta_text?: string;
  color?: string;
  score?: number;
  display_value?: string;
  baseline?: number | null;
  range_min?: number | null;
  range_max?: number | null;
  components?: Record<string, number>;
  steps?: number | null;
  exercise_min?: number | null;
  active_kcal?: number | null;
}

export interface EnergyMonitorResponse {
  range: RangeKey;
  tiles: {
    readiness: TileData;
    sleep: TileData;
    hrv: TileData;
    rhr: TileData;
    load: TileData;
  };
  series: {
    hrv: MetricPoint[];
    rhr: MetricPoint[];
    sleep_total: MetricPoint[];
    activity: ActivityPoint[];
  };
  signals: string[];
  baseline: {
    sleep?: number | null;
    hrv?: number | null;
    rhr?: number | null;
    resp?: number | null;
  };
}

export async function fetchEnergyMonitor(range: RangeKey): Promise<EnergyMonitorResponse> {
  const res = await fetch(`/api/health/energy-monitor?range=${range}`);
  if (!res.ok) {
    throw new Error("Konnte Energy Monitor nicht laden");
  }
  return res.json();
}
