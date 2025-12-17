export type TrafficLight = "green" | "yellow" | "red";

export interface DailyFitness {
  date: string;
  exercise_min: number;
  active_kcal: number;
  steps: number;
  distance_km: number;
  floors: number;
  walking_speed: number | null;
  step_length: number | null;
  walking_hr_avg: number | null;
  stair_up: number | null;
  stair_down: number | null;
  efficiency_index?: number | null;
}

export interface WeeklyFitness {
  week_start: string;
  week_end: string;
  iso_year: number;
  iso_week: number;
  exercise_min_week: number;
  steps_week: number;
  distance_km_week: number;
  active_kcal_week: number;
  floors_week: number;
  walking_speed_avg: number | null;
  step_length_avg: number | null;
  efficiency_index_median: number | null;
  stair_up_avg: number | null;
  stair_down_avg: number | null;
}

export interface FitnessSummaries {
  volume: {
    color: TrafficLight;
    current_week: WeeklyFitness | null;
  };
  consistency: {
    color: TrafficLight;
    active_days: number;
    range_days: number;
    current_streak: number;
    longest_streak: number;
  };
  distance: {
    color: TrafficLight;
    steps: number;
    distance_km: number;
  };
  efficiency: {
    color: TrafficLight;
    direction: "improving" | "declining" | "stable";
    change: number | null;
  };
  mobility: {
    color: TrafficLight;
    direction: "improving" | "declining" | "stable";
  };
}

export interface FitnessPayload {
  range: string;
  group: string;
  start_date: string;
  end_date: string;
  daily: DailyFitness[];
  weekly: WeeklyFitness[];
  summaries: FitnessSummaries;
  notes: string[];
}
