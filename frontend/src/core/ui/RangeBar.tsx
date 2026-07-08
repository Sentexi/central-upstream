export interface RangeBarProps {
  /** Aktueller Wert 0..100 (%). */
  value: number;
  /** Baseline-Tick 0..100 (%). */
  baseline: number;
  /** Marker-Position 0..100 (%). */
  marker: number;
  /** Metrik-Farbe der Fuellung und des Markers. */
  color: string;
}

function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

/**
 * Wie ProgressBar, plus Baseline-Tick (1.5px, Text-Low) und runder Marker
 * (9px, Border in Panel-Farbe). Werte 0..100 %.
 */
export function RangeBar({ value, baseline, marker, color }: RangeBarProps) {
  const fillPct = clampPercent(value);
  const baselinePct = clampPercent(baseline);
  const markerPct = clampPercent(marker);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: 6,
        borderRadius: 3,
        background: "var(--track)",
      }}
    >
      <div
        style={{
          position: "absolute",
          insetBlock: 0,
          left: 0,
          width: `${fillPct}%`,
          borderRadius: 3,
          background: color,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: -2,
          left: `${baselinePct}%`,
          width: 1.5,
          height: 10,
          background: "var(--text-low)",
          transform: "translateX(-50%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: `${markerPct}%`,
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: color,
          border: "2px solid var(--panel)",
          transform: "translate(-50%, -50%)",
        }}
      />
    </div>
  );
}
