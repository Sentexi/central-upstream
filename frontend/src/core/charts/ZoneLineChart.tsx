import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { axisProps, CHART_COLORS, CHART_MARGIN, gridProps } from "./chartTheme";
import { ChartTooltip } from "./chartPrimitives";

export interface ZoneBand {
  /** Untere Grenze des Bandes (Y). */
  from: number;
  /** Obere Grenze des Bandes (Y). */
  to: number;
  /** "good" | "fair" | "low" steuert die Farbe; freie Strings erlaubt. */
  tone: "good" | "fair" | "low";
}

export interface ZoneLineChartProps {
  data: Array<Record<string, unknown>>;
  xKey: string;
  dataKey: string;
  /** Hintergrundbaender (low coral / fair amber / good green, 12% Opacity). */
  zones: ZoneBand[];
  color?: string;
  height?: number;
  yMin?: number;
  yMax?: number;
  unit?: string;
  valueFormatter?: (value: number) => string;
  xTickFormatter?: (value: string) => string;
}

const ZONE_COLORS: Record<ZoneBand["tone"], string> = {
  good: CHART_COLORS.green,
  fair: CHART_COLORS.amber,
  low: CHART_COLORS.coral,
};

/**
 * Hintergrundbaender (ReferenceArea, 12% Opacity) mit Teal-Messlinie darueber
 * (Fitness VO2). Legende good/fair/low ueber den Zonen.
 */
export function ZoneLineChart({
  data,
  xKey,
  dataKey,
  zones,
  color = CHART_COLORS.teal,
  height = 220,
  yMin,
  yMax,
  unit,
  valueFormatter,
  xTickFormatter,
}: ZoneLineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey={xKey} {...axisProps} tickFormatter={xTickFormatter} minTickGap={24} />
        <YAxis
          {...axisProps}
          width={36}
          domain={[yMin ?? "auto", yMax ?? "auto"]}
          tickFormatter={valueFormatter}
        />
        {zones.map((zone, index) => (
          <ReferenceArea
            key={`zone-${index}`}
            y1={zone.from}
            y2={zone.to}
            fill={ZONE_COLORS[zone.tone]}
            fillOpacity={0.12}
            stroke="none"
            ifOverflow="extendDomain"
          />
        ))}
        <Tooltip
          cursor={{ stroke: CHART_COLORS.borderStrong, strokeWidth: 1 }}
          content={<ChartTooltip valueFormatter={valueFormatter} unit={unit} />}
        />
        <Line
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          isAnimationActive={false}
          dot={{ r: 2.8, fill: color, stroke: CHART_COLORS.panel, strokeWidth: 1.5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
