import type { ReactNode } from "react";
import { Card } from "./Card";

export type DeltaTone = "pos" | "neg" | "neutral";

export interface StatCardDelta {
  text: string;
  tone: DeltaTone;
}

export interface StatCardProps {
  eyebrow: string;
  value: ReactNode;
  unit?: string;
  /** border-top-Akzent + Farbe der grossen Zahl. */
  accent?: string;
  delta?: StatCardDelta;
  children?: ReactNode;
}

const DELTA_STYLES: Record<DeltaTone, { background: string; color: string }> = {
  pos: { background: "rgba(70,207,146,0.15)", color: "#88E6B6" },
  neg: { background: "rgba(255,93,82,0.15)", color: "#FF9A91" },
  neutral: { background: "rgba(148,153,182,0.12)", color: "var(--text-mid)" },
};

/**
 * KPI-Karte: Mono-Eyebrow + optionale Delta-Badge, grosse Mono-Zahl + Einheit,
 * optional Progress/Range/Caption als children. accent setzt border-top + Zahlfarbe.
 */
export function StatCard({ eyebrow, value, unit, accent, delta, children }: StatCardProps) {
  return (
    <Card accent={accent}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 9.5,
            letterSpacing: "0.1em",
            color: "var(--text-low)",
            textTransform: "uppercase",
          }}
        >
          {eyebrow}
        </span>
        {delta ? (
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              padding: "3px 8px",
              borderRadius: "var(--radius-pill)",
              background: DELTA_STYLES[delta.tone].background,
              color: DELTA_STYLES[delta.tone].color,
              whiteSpace: "nowrap",
            }}
          >
            {delta.text}
          </span>
        ) : null}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 12 }}>
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontWeight: 600,
            fontSize: 34,
            lineHeight: 1.05,
            color: accent ?? "var(--text-high)",
            whiteSpace: "nowrap",
          }}
        >
          {value}
        </span>
        {unit ? (
          <span style={{ fontSize: 12, color: "var(--text-low)" }}>{unit}</span>
        ) : null}
      </div>

      {children ? <div style={{ marginTop: 14 }}>{children}</div> : null}
    </Card>
  );
}
