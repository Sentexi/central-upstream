import { useId } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  axisProps,
  barGradientStops,
  CHART_COLORS,
  CHART_MARGIN,
  gridProps,
} from "./chartTheme";
import { ChartTooltip, LinearGradientDef } from "./chartPrimitives";

export interface ComboSeries {
  dataKey: string;
  name?: string;
  color: string;
}

export interface ComboChartProps {
  data: Array<Record<string, unknown>>;
  xKey: string;
  /** Zwei (oder mehr) gruppierte Balken-Reihen, z. B. Done (green) + Created (coral). */
  bars: ComboSeries[];
  /** Die Linie, z. B. Net kumuliert (amber). */
  line: ComboSeries;
  height?: number;
  /** Linie auf rechte (Amber-)Y-Achse legen (Dual-Axis, Dashboard). */
  dualAxis?: boolean;
  leftFormatter?: (value: number) => string;
  rightFormatter?: (value: number) => string;
  xTickFormatter?: (value: string) => string;
}

/**
 * Gruppierte Gradient-Balken plus Linie. Optional rechte Amber-Y-Achse fuer die
 * Linie (Dual-Axis). Balken-Verlauf 0.95 -> 0.45.
 */
export function ComboChart({
  data,
  xKey,
  bars,
  line,
  height = 220,
  dualAxis = false,
  leftFormatter,
  rightFormatter,
  xTickFormatter,
}: ComboChartProps) {
  const baseId = useId().replace(/:/g, "");

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <defs>
          {bars.map((bar, index) => (
            <LinearGradientDef
              key={bar.dataKey}
              id={`${baseId}-bar-${index}`}
              stops={barGradientStops(bar.color, 0.45)}
            />
          ))}
        </defs>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey={xKey} {...axisProps} tickFormatter={xTickFormatter} minTickGap={24} />
        <YAxis yAxisId="left" {...axisProps} width={36} tickFormatter={leftFormatter} />
        {dualAxis ? (
          <YAxis
            yAxisId="right"
            orientation="right"
            axisLine={false}
            tickLine={false}
            width={40}
            tick={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fill: CHART_COLORS.amber }}
            tickFormatter={rightFormatter}
          />
        ) : null}
        <Tooltip
          cursor={{ fill: "rgba(31,195,214,0.06)" }}
          content={<ChartTooltip valueFormatter={leftFormatter} />}
        />
        {bars.map((bar, index) => (
          <Bar
            key={bar.dataKey}
            yAxisId="left"
            dataKey={bar.dataKey}
            name={bar.name}
            fill={`url(#${baseId}-bar-${index})`}
            radius={[2.5, 2.5, 0, 0]}
            isAnimationActive={false}
          />
        ))}
        <Line
          yAxisId={dualAxis ? "right" : "left"}
          type="monotone"
          dataKey={line.dataKey}
          name={line.name}
          stroke={line.color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          isAnimationActive={false}
          dot={{ r: 2.8, fill: line.color, stroke: CHART_COLORS.panel, strokeWidth: 1.5 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
