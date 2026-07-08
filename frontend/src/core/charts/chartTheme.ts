/**
 * Zentrale Aqua-Operator-Chart-Konstanten. Recharts kann CSS-`var()` nicht
 * aufloesen, deshalb liegen die Hex-Werte hier (Single Source of Truth fuer
 * Charts) und spiegeln exakt die Tokens aus index.css.
 */

export const CHART_COLORS = {
  teal: "#1FC3D6",
  tealBright: "#5FE0EC",
  indigo: "#4F5BD6",
  indigoBright: "#6B77F0",
  violet: "#9B8CFA",
  coral: "#FF7A66",
  amber: "#F4B53C",
  amberBright: "#FFCE6B",
  green: "#46CF92",
  greenBright: "#5FDFA0",
  textHigh: "#E9ECF7",
  textMid: "#9499B6",
  textLow: "#7E84A8",
  panel: "#12152A",
  borderStrong: "#272C49",
} as const;

export const GRID = "#222845";
export const AXIS = "#7E84A8";
export const MONO = "'IBM Plex Mono', monospace";

/** Gemeinsame Achsen-Tick-Props (Mono 10px, Text-Low). */
export const tickProps = {
  fontFamily: MONO,
  fontSize: 10,
  fill: AXIS,
} as const;

/** Grid: nur horizontale Linien, GRID-Farbe, 1px. */
export const gridProps = {
  stroke: GRID,
  strokeWidth: 1,
  vertical: false,
} as const;

/** Achsen ohne Linie/Tick, Mono-Ticks. */
export const axisProps = {
  axisLine: false as const,
  tickLine: false as const,
  tick: tickProps,
};

/** Standard-Chart-Margin (Platz fuer Achsenbeschriftung). */
export const CHART_MARGIN = { top: 8, right: 12, bottom: 4, left: 4 } as const;

/** Stroke-Defaults fuer Linien (2px, runde Caps, monoton). */
export const lineProps = {
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  dot: false as const,
};

export interface GradientStop {
  offset: string;
  color: string;
  opacity: number;
}

/** Balken-Gradient (vertikal, 0.95 -> 0.45). */
export function barGradientStops(color: string, bottomOpacity = 0.45): GradientStop[] {
  return [
    { offset: "0%", color, opacity: 0.95 },
    { offset: "100%", color, opacity: bottomOpacity },
  ];
}

/** Flaechen-Gradient (vertikal, 0.18 -> 0). */
export function areaGradientStops(color: string): GradientStop[] {
  return [
    { offset: "0%", color, opacity: 0.18 },
    { offset: "100%", color, opacity: 0 },
  ];
}

/** Tooltip-Container-Stil (BG Panel, Border-Strong, Mono). */
export const tooltipContainerStyle: React.CSSProperties = {
  background: CHART_COLORS.panel,
  border: `1px solid ${CHART_COLORS.borderStrong}`,
  borderRadius: 8,
  padding: "8px 10px",
  fontFamily: MONO,
  fontSize: 11,
  color: CHART_COLORS.textHigh,
};
