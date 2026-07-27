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
      resting_kcal: FitnessSeries[];
      floors: FitnessSeries[];
      active_kcal_weekly: FitnessSeries[];
      resting_kcal_weekly: FitnessSeries[];
      floors_weekly: FitnessSeries[];
    };
    efficiency: {
      efficiency_index: FitnessSeries[];
      stair_up: FitnessSeries[];
      stair_down: FitnessSeries[];
    };
    weight: { daily: FitnessSeries[]; weekly: FitnessSeries[] };
    vo2max: { daily: FitnessSeries[]; weekly: FitnessSeries[] };
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

export type WorkoutRangeKey = "90d" | "1y" | "all";
export type WorkoutSportType =
  | "running"
  | "walking"
  | "swimming"
  | "strength"
  | "cycling"
  | "other";

export interface WorkoutSportSummary {
  sport_type: WorkoutSportType;
  label: string;
  workout_count: number;
  total_duration_minutes: number | null;
  total_distance_km: number | null;
  last_workout_at: string;
  workout_names: string[];
}

export interface WorkoutSummary {
  id: number;
  external_id: string;
  name: string;
  start_at: string;
  duration_seconds: number | null;
  distance_km: number | null;
  pace_seconds_per_km: number | null;
  avg_heart_rate: number | null;
  location: string | null;
  has_heart_rate: boolean;
  has_route: boolean;
}

export interface WorkoutPhase {
  id: string;
  label: string;
  start_at: string;
  end_at: string;
  gap_before_days: number | null;
  is_current: boolean;
  workout_count: number;
  total_distance_km: number | null;
  median_pace_seconds_per_km: number | null;
  median_heart_rate: number | null;
  workouts: WorkoutSummary[];
}

export interface WorkoutDistanceClass {
  key: "short" | "typical" | "extended" | "long" | "very_long";
  label: string;
  workout_count: number;
  median_pace_seconds_per_km: number | null;
  trend_seconds_per_km: number | null;
  total_distance_km: number;
}

export interface WorkoutOverviewResponse {
  range: WorkoutRangeKey;
  sports: WorkoutSportSummary[];
  running: {
    available: boolean;
    workout_count: number;
    summary: {
      current_phase_workouts: number;
      current_phase_start_at: string | null;
      typical_distance_km: number | null;
      total_distance_km: number | null;
      median_pace_seconds_per_km: number | null;
      last_workout_at: string | null;
    };
    phases: WorkoutPhase[];
    distance_classes: WorkoutDistanceClass[];
    recent_workouts: WorkoutSummary[];
  };
  data_quality: {
    workout_count: number;
    with_distance: number;
    with_heart_rate: number;
    with_route: number;
  };
}

export async function fetchWorkoutOverview(
  range: WorkoutRangeKey = "all",
): Promise<WorkoutOverviewResponse> {
  const res = await fetch(`/api/health/workouts/overview?range=${range}`);
  if (!res.ok) {
    throw new Error("Konnte Workout Overview nicht laden");
  }
  return res.json();
}

export type SyncFinalState = "done" | "error" | "aborted";

export interface SyncHistoryItem {
  id: number;
  batch_timestamp: number;
  started_at: string;
  finished_at: string;
  duration_seconds: number | null;
  final_state: SyncFinalState;
  total_records: number;
  processed_records: number;
  inserted: number | null;
  skipped: number | null;
  last_error: string | null;
  client: "iphone" | "browser" | null;
}

export async function fetchSyncHistory(limit = 20): Promise<SyncHistoryItem[]> {
  const res = await fetch(`/api/health/history?limit=${limit}`);
  if (!res.ok) {
    throw new Error("Konnte Sync Historie nicht laden");
  }
  const data = await res.json();
  return Array.isArray(data?.items) ? (data.items as SyncHistoryItem[]) : [];
}

export async function forceClearSync(): Promise<boolean> {
  const res = await fetch("/api/health/force_clear", { method: "POST" });
  if (!res.ok) {
    throw new Error("Force Clear fehlgeschlagen");
  }
  const data = await res.json();
  return Boolean(data?.cleared);
}

export interface ApiKeyReveal {
  auth_header: string;
  auth_key: string;
  ingest_url: string;
  curl_example: string;
}

async function postApiKeyAction(path: string): Promise<ApiKeyReveal> {
  const res = await fetch(path, { method: "POST" });
  if (!res.ok) {
    throw new Error("API Key Aktion fehlgeschlagen");
  }
  const data = await res.json();
  return {
    auth_header: String(data?.auth_header ?? ""),
    auth_key: String(data?.auth_key ?? ""),
    ingest_url: String(data?.ingest_url ?? ""),
    curl_example: String(data?.curl_example ?? ""),
  };
}

export function revealApiKey() {
  return postApiKeyAction("/api/health/settings/api-key/reveal");
}

export function rotateApiKey() {
  return postApiKeyAction("/api/health/settings/api-key/rotate");
}
