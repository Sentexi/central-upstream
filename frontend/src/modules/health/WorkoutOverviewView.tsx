import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bike,
  CircleEllipsis,
  Dumbbell,
  Footprints,
  HeartPulse,
  MapPinned,
  Waves,
} from "lucide-react";
import {
  Badge,
  Card,
  PageHeader,
  SectionHeader,
  SegmentedControl,
  StatCard,
} from "../../core/ui";
import type { SegmentedControlOption } from "../../core/ui";
import type {
  WorkoutDistanceClass,
  WorkoutOverviewResponse,
  WorkoutRangeKey,
  WorkoutSportType,
  WorkoutSummary,
} from "./api";
import { fetchWorkoutOverview } from "./api";
import "./workouts.css";

const RANGE_OPTIONS = [
  { value: "90d", label: "90 Tage" },
  { value: "1y", label: "Jahr" },
  { value: "all", label: "Alle" },
] satisfies SegmentedControlOption[];

const SPORT_ICONS: Record<WorkoutSportType, LucideIcon> = {
  running: Activity,
  walking: Footprints,
  swimming: Waves,
  strength: Dumbbell,
  cycling: Bike,
  other: CircleEllipsis,
};

const SPORT_ACCENTS: Record<WorkoutSportType, string> = {
  running: "var(--teal)",
  walking: "var(--indigo-bright)",
  swimming: "var(--violet)",
  strength: "var(--amber)",
  cycling: "var(--green)",
  other: "var(--text-low)",
};

function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "-";
  return value.toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatInteger(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  return Math.round(value).toLocaleString("de-DE");
}

function formatPace(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value) || value <= 0) return "-";
  const rounded = Math.round(value);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatDuration(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value) || value < 0) return "-";
  const totalMinutes = Math.round(value / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} h ${minutes.toString().padStart(2, "0")} min`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function classRange(item: WorkoutDistanceClass): string {
  switch (item.key) {
    case "short":
      return "< 3 km";
    case "typical":
      return "3 bis 5 km";
    case "extended":
      return "> 5 bis 7,5 km";
    case "long":
      return "> 7,5 bis 10 km";
    case "very_long":
      return "> 10 km";
  }
}

function trendLabel(value: number | null): string | null {
  if (value == null || Number.isNaN(value)) return null;
  const seconds = Math.round(Math.abs(value));
  if (seconds === 0) return "stabil";
  return value < 0 ? `${seconds} s schneller` : `${seconds} s langsamer`;
}

function workoutTitle(workout: WorkoutSummary): string {
  const pieces = [formatDate(workout.start_at)];
  if (workout.distance_km != null) {
    pieces.push(`${formatNumber(workout.distance_km)} km`);
  }
  if (workout.pace_seconds_per_km != null) {
    pieces.push(`${formatPace(workout.pace_seconds_per_km)} /km`);
  }
  return pieces.join(" / ");
}

function LoadingPanel() {
  return (
    <Card>
      <span className="workout-kicker">Loading</span>
      <p className="workout-muted">Workout-Daten werden geladen.</p>
    </Card>
  );
}

function SportInventory({
  data,
}: {
  data: WorkoutOverviewResponse;
}) {
  return (
    <section>
      <SectionHeader label="Erfasste Workout-Arten" />
      {data.sports.length ? (
        <div className="workout-sport-grid">
          {data.sports.map((sport) => {
            const Icon = SPORT_ICONS[sport.sport_type];
            return (
              <Card
                key={sport.sport_type}
                className={`workout-sport-card ${
                  sport.sport_type === "running" ? "is-running" : ""
                }`.trim()}
                style={{ "--sport-accent": SPORT_ACCENTS[sport.sport_type] } as CSSProperties}
              >
                <div className="workout-sport-head">
                  <span className="workout-sport-icon" aria-hidden>
                    <Icon size={18} strokeWidth={1.8} />
                  </span>
                  <div>
                    <span className="workout-kicker">{sport.label}</span>
                    <div className="workout-sport-count">
                      {formatInteger(sport.workout_count)}{" "}
                      {sport.workout_count === 1 ? "Workout" : "Workouts"}
                    </div>
                  </div>
                </div>
                <div className="workout-sport-facts">
                  {sport.total_duration_minutes != null && (
                    <span>{formatDuration(sport.total_duration_minutes * 60)}</span>
                  )}
                  {sport.total_distance_km != null && (
                    <span>{formatNumber(sport.total_distance_km)} km</span>
                  )}
                  <span>zuletzt {formatDate(sport.last_workout_at)}</span>
                </div>
                {sport.sport_type === "running" && (
                  <Badge tone="teal">Jogging-Fokus</Badge>
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <p className="workout-muted">
            Im gewaehlten Zeitraum wurden noch keine Workout-Sitzungen importiert.
          </p>
        </Card>
      )}
    </section>
  );
}

function RunningEmptyState({ total }: { total: number }) {
  return (
    <Card className="workout-empty">
      <div className="workout-empty-icon" aria-hidden>
        <Activity size={26} strokeWidth={1.7} />
      </div>
      <div>
        <span className="workout-kicker">Jogging-Fokus</span>
        <h2>Keine Jogging-Workouts im aktuellen Bestand</h2>
        <p>
          {total > 0
            ? "Andere Workout-Arten sind vorhanden. Fuer Lauftrends fehlen jedoch echte Jogging-Sitzungen."
            : "Health Auto Export muss Workout-Sitzungen mitsenden, bevor Lauftrends berechnet werden koennen."}
        </p>
      </div>
    </Card>
  );
}

function PhaseTimeline({
  phases,
}: {
  phases: WorkoutOverviewResponse["running"]["phases"];
}) {
  return (
    <Card className="workout-timeline-card">
      <div className="workout-panel-head">
        <div>
          <span className="workout-kicker">Trainingsphasen</span>
          <h2>Laufserien und Pausen</h2>
        </div>
        <span className="workout-muted">Neue Phase nach mehr als 28 Tagen Pause</span>
      </div>
      <div className="workout-timeline-scroll">
        <div className="workout-timeline">
          {phases.map((phase, index) => (
            <div className="workout-phase-block" key={phase.id}>
              {index > 0 && phase.gap_before_days != null && (
                <div className="workout-gap" aria-label={`${phase.gap_before_days} Tage Pause`}>
                  <span>{phase.gap_before_days} Tage Pause</span>
                </div>
              )}
              <div className="workout-phase">
                <div className="workout-phase-points">
                  {phase.workouts.map((workout) => (
                    <span
                      className="workout-point"
                      key={workout.id}
                      title={workoutTitle(workout)}
                    />
                  ))}
                </div>
                <div className="workout-phase-label">
                  <span>{phase.label}</span>
                  {phase.is_current && <Badge tone="teal">Aktuell</Badge>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function DistanceClasses({
  classes,
}: {
  classes: WorkoutDistanceClass[];
}) {
  return (
    <Card>
      <div className="workout-panel-head">
        <div>
          <span className="workout-kicker">Distanzklassen</span>
          <h2>Vergleichbare Laufgruppen</h2>
        </div>
      </div>
      <div className="workout-class-grid">
        {classes.map((item) => {
          const trend = trendLabel(item.trend_seconds_per_km);
          return (
            <div
              className={`workout-class-card ${item.key === "typical" ? "is-typical" : ""}`.trim()}
              key={item.key}
            >
              <div className="workout-class-title">
                <span>{item.label}</span>
                <span>{classRange(item)}</span>
              </div>
              <strong>
                {formatInteger(item.workout_count)}{" "}
                {item.workout_count === 1 ? "Lauf" : "Laeufe"}
              </strong>
              <div className="workout-class-metrics">
                <span>
                  Median {formatPace(item.median_pace_seconds_per_km)} /km
                </span>
                <span>{formatNumber(item.total_distance_km)} km gesamt</span>
              </div>
              {trend && (
                <span
                  className={`workout-trend ${
                    (item.trend_seconds_per_km ?? 0) <= 0 ? "is-positive" : "is-negative"
                  }`.trim()}
                >
                  {trend}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function PhaseComparison({
  phases,
}: {
  phases: WorkoutOverviewResponse["running"]["phases"];
}) {
  return (
    <Card>
      <div className="workout-panel-head">
        <div>
          <span className="workout-kicker">Phasenvergleich</span>
          <h2>Entwicklung nach Laufserie</h2>
        </div>
      </div>
      <div className="workout-table-wrap">
        <table className="workout-table">
          <thead>
            <tr>
              <th>Phase</th>
              <th>Laeufe</th>
              <th>Distanz</th>
              <th>Median-Pace</th>
              <th>Median-Puls</th>
            </tr>
          </thead>
          <tbody>
            {phases
              .slice()
              .reverse()
              .map((phase) => (
                <tr key={phase.id}>
                  <td>
                    <span>{phase.label}</span>
                    {phase.is_current && <Badge tone="teal">Aktuell</Badge>}
                  </td>
                  <td>{formatInteger(phase.workout_count)}</td>
                  <td>
                    {phase.total_distance_km == null
                      ? "-"
                      : `${formatNumber(phase.total_distance_km)} km`}
                  </td>
                  <td>{formatPace(phase.median_pace_seconds_per_km)} /km</td>
                  <td>
                    {phase.median_heart_rate == null
                      ? "-"
                      : `${formatInteger(phase.median_heart_rate)} bpm`}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RecentRuns({
  workouts,
}: {
  workouts: WorkoutSummary[];
}) {
  return (
    <Card>
      <div className="workout-panel-head">
        <div>
          <span className="workout-kicker">Letzte Jogging-Workouts</span>
          <h2>Reale Sitzungsdaten</h2>
        </div>
      </div>
      <div className="workout-table-wrap">
        <table className="workout-table workout-recent-table">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Workout</th>
              <th>Distanz</th>
              <th>Dauer</th>
              <th>Pace</th>
              <th>Puls</th>
              <th>Daten</th>
            </tr>
          </thead>
          <tbody>
            {workouts.map((workout) => (
              <tr key={workout.id}>
                <td>{formatDate(workout.start_at)}</td>
                <td>{workout.name}</td>
                <td>
                  {workout.distance_km == null
                    ? "-"
                    : `${formatNumber(workout.distance_km)} km`}
                </td>
                <td>{formatDuration(workout.duration_seconds)}</td>
                <td>{formatPace(workout.pace_seconds_per_km)} /km</td>
                <td>
                  {workout.avg_heart_rate == null
                    ? "-"
                    : `${formatInteger(workout.avg_heart_rate)} bpm`}
                </td>
                <td>
                  <span className="workout-data-icons">
                    {workout.has_heart_rate && (
                      <HeartPulse size={15} aria-label="Herzfrequenz vorhanden" />
                    )}
                    {workout.has_route && (
                      <MapPinned size={15} aria-label="Route vorhanden" />
                    )}
                    {!workout.has_heart_rate && !workout.has_route && "-"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function WorkoutOverviewView({
  navigation,
}: {
  navigation?: ReactNode;
}) {
  const [range, setRange] = useState<WorkoutRangeKey>("all");
  const [data, setData] = useState<WorkoutOverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    fetchWorkoutOverview(range)
      .then((payload) => {
        if (mounted) setData(payload);
      })
      .catch((err: unknown) => {
        if (mounted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [range]);

  const qualityText = useMemo(() => {
    if (!data) return null;
    return [
      `${data.data_quality.workout_count} Sessions`,
      `${data.data_quality.with_distance} mit Distanz`,
      `${data.data_quality.with_heart_rate} mit Pulsverlauf`,
      `${data.data_quality.with_route} mit Route`,
    ].join(" / ");
  }, [data]);

  return (
    <div className="app-grid workout-overview">
      <PageHeader
        eyebrow="HEALTH"
        title="Workout Overview"
        subtitle="Phasen, Laufentwicklung und Bestand aller Workout-Arten."
        right={
          <div className="workout-header-controls">
            {navigation}
            <SegmentedControl
              options={RANGE_OPTIONS}
              value={range}
              onChange={(value) => setRange(value as WorkoutRangeKey)}
            />
          </div>
        }
      />

      {loading && <LoadingPanel />}
      {error && (
        <Card>
          <span className="workout-kicker">Fehler</span>
          <p className="workout-error">{error}</p>
        </Card>
      )}

      {!loading && !error && data && (
        <>
          <SportInventory data={data} />

          {!data.running.available ? (
            <RunningEmptyState total={data.data_quality.workout_count} />
          ) : (
            <>
              <section>
                <SectionHeader label="Jogging-Fokus" />
                <div className="workout-stat-grid">
                  <StatCard
                    eyebrow="Aktuelle Phase"
                    value={formatInteger(data.running.summary.current_phase_workouts)}
                    unit={
                      data.running.summary.current_phase_workouts === 1
                        ? "Lauf"
                        : "Laeufe"
                    }
                    accent="var(--teal)"
                  >
                    <p className="workout-stat-caption">
                      seit {formatDate(data.running.summary.current_phase_start_at)}
                    </p>
                  </StatCard>
                  <StatCard
                    eyebrow="Typische Distanz"
                    value={formatNumber(data.running.summary.typical_distance_km)}
                    unit="km"
                    accent="var(--indigo)"
                  >
                    <p className="workout-stat-caption">Median aller Jogging-Workouts</p>
                  </StatCard>
                  <StatCard
                    eyebrow="Gesamtdistanz"
                    value={formatNumber(data.running.summary.total_distance_km)}
                    unit="km"
                    accent="var(--green)"
                  >
                    <p className="workout-stat-caption">
                      {formatInteger(data.running.workout_count)}{" "}
                      {data.running.workout_count === 1
                        ? "Jogging-Workout"
                        : "Jogging-Workouts"}
                    </p>
                  </StatCard>
                  <StatCard
                    eyebrow="Median-Pace"
                    value={formatPace(data.running.summary.median_pace_seconds_per_km)}
                    unit="/km"
                    accent="var(--coral)"
                  >
                    <p className="workout-stat-caption">
                      nur Sitzungen mit Distanz und Dauer
                    </p>
                  </StatCard>
                </div>
              </section>

              <PhaseTimeline phases={data.running.phases} />

              <div className="workout-analysis-grid">
                <DistanceClasses classes={data.running.distance_classes} />
                <PhaseComparison phases={data.running.phases} />
              </div>

              <RecentRuns workouts={data.running.recent_workouts} />
            </>
          )}

          {qualityText && (
            <p className="workout-quality">Datenabdeckung / {qualityText}</p>
          )}
        </>
      )}
    </div>
  );
}
