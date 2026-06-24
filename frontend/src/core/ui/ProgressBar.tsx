export interface ProgressBarProps {
  /** 0..100 */
  value: number;
  /** Einfarbige Fuellung, falls kein Verlauf (from/to) gesetzt ist. */
  color?: string;
  /** Verlaufsstart. */
  from?: string;
  /** Verlaufsende. */
  to?: string;
}

function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

/**
 * Fortschrittsbalken: Track, 6px Hoehe, Radius 3px, 2-Stop-Verlauf in Metrik-Farbe.
 */
export function ProgressBar({ value, color = "var(--teal)", from, to }: ProgressBarProps) {
  const pct = clampPercent(value);
  const start = from ?? color;
  const end = to ?? color;

  return (
    <div
      style={{
        width: "100%",
        height: 6,
        borderRadius: 3,
        background: "var(--track)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${pct}%`,
          borderRadius: 3,
          background: `linear-gradient(90deg, ${start}, ${end})`,
          transition: "width 200ms ease",
        }}
      />
    </div>
  );
}
