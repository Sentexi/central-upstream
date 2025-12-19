export type RangeKey = "today" | "7d" | "14d" | "30d";
export type GroupKey = "daily" | "weekly";

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

export interface FitnessTile {
  label: string;
  value?: number | null;
  unit?: string;
  delta_text?: string;
  color?: string;
  detail?: string | null;
  secondary?: number | null;
  secondary_unit?: string | null;
  streak?: number;
  longest?: number;
}

export interface FitnessSeries {
  date: string;
  value: number | null;
  label?: string | null;
  speed?: number | null;
  hr?: number | null;
}

export interface FitnessDashboardResponse {
  range: RangeKey;
  group: GroupKey;
  tiles: {
    volume: FitnessTile;
    consistency: FitnessTile;
    distance: FitnessTile;
    efficiency: FitnessTile;
    mobility: FitnessTile;
  };
  charts: {
    exercise: { daily: FitnessSeries[]; weekly: FitnessSeries[] };
    steps_distance: {
      steps: FitnessSeries[];
      distance: FitnessSeries[];
      steps_weekly: FitnessSeries[];
      distance_weekly: FitnessSeries[];
    };
    active_floors: {
      active_kcal: FitnessSeries[];
      floors: FitnessSeries[];
      active_kcal_weekly: FitnessSeries[];
      floors_weekly: FitnessSeries[];
    };
    efficiency: {
      efficiency_index: FitnessSeries[];
      stair_up: FitnessSeries[];
      stair_down: FitnessSeries[];
    };
  };
  notes: string[];
}

export async function fetchFitnessDashboard(range: RangeKey, group: GroupKey = "daily"): Promise<FitnessDashboardResponse> {
  const res = await fetch(`/api/health/fitness?range=${range}&group=${group}`);
  if (!res.ok) {
    throw new Error("Konnte Fitness Dashboard nicht laden");
  }
  return res.json();
}
