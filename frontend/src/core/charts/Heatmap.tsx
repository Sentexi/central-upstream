/** 7 Zeilen (Mo-So) x 24 Spalten (Stunden), Werte 0..1. */
export type HeatmapMatrix = number[][];

export interface HeatmapProps {
  matrix: HeatmapMatrix;
}

const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const GRID_COLS = "30px repeat(24, 1fr)";

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * CSS-Grid-Heatmap (keine Recharts). Zelle = rgba(31,195,214, 0.06 + 0.9*t),
 * Hoehe 15px, Radius 3px. Stundenachse alle 3h, Wochentage Mo-So.
 * Mathematik-Referenz: Work-Mockup Script-Block.
 */
export function Heatmap({ matrix }: HeatmapProps) {
  return (
    <div style={{ width: "100%" }}>
      {/* Stundenachse */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: GRID_COLS,
          gap: 3,
          marginBottom: 4,
        }}
      >
        <div />
        {Array.from({ length: 24 }, (_, hour) => (
          <div
            key={`h-${hour}`}
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 9,
              color: "var(--text-low)",
              textAlign: "left",
            }}
          >
            {hour % 3 === 0 ? (hour < 10 ? `0${hour}` : `${hour}`) : ""}
          </div>
        ))}
      </div>

      {/* Tag-Zeilen */}
      {DAYS.map((day, dayIndex) => {
        const row = matrix[dayIndex] ?? [];
        return (
          <div
            key={`d-${dayIndex}`}
            style={{
              display: "grid",
              gridTemplateColumns: GRID_COLS,
              gap: 3,
              marginBottom: 3,
            }}
          >
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10.5,
                color: "var(--text-mid)",
                alignSelf: "center",
              }}
            >
              {day}
            </div>
            {Array.from({ length: 24 }, (_, hour) => {
              const t = clamp01(row[hour] ?? 0);
              return (
                <div
                  key={`c-${hour}`}
                  title={`${day} ${hour}:00`}
                  style={{
                    height: 15,
                    borderRadius: 3,
                    background: `rgba(31,195,214,${(0.06 + 0.9 * t).toFixed(3)})`,
                  }}
                />
              );
            })}
          </div>
        );
      })}

      {/* Legende */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
        <span style={{ fontSize: 11, color: "var(--text-low)" }}>Niedrig</span>
        <div
          style={{
            flex: 1,
            height: 7,
            borderRadius: 4,
            background: "linear-gradient(90deg, rgba(31,195,214,0.10), #1FC3D6)",
          }}
        />
        <span style={{ fontSize: 11, color: "var(--text-low)" }}>Hoch</span>
      </div>
    </div>
  );
}
