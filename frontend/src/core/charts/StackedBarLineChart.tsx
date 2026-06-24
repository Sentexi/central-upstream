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

export interface StackedSeries {
  dataKey: string;
  name?: string;
  color: string;
}

export interface StackedBarLineChartProps {
  data: Array<Record<string, unknown>>;
  xKey: string;
  /** Gestapelte Balken-Reihen, z. B. Ruhe (indigo) + Aktiv (amber). */
  bars: StackedSeries[];
  /** Linie ueber den Stapeln, z. B. Intake (teal). */
  line: StackedSeries;
  height?: number;
  valueFormatter?: (value: number) => string;
  xTickFormatter?: (value: string) => string;
}

/**
 * Gestapelte Gradient-Balken plus Linie mit Punkten (Calories-Uebersicht).
 */
export function StackedBarLineChart({
  data,
  xKey,
  bars,
  line,
  height = 220,
  valueFormatter,
  xTickFormatter,
}: StackedBarLineChartProps) {
  const baseId = useId().replace(/:/g, "");

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <defs>
          {bars.map((bar, index) => (
            <LinearGradientDef
              key={bar.dataKey}
              id={`${baseId}-stack-${index}`}
              stops={barGradientStops(bar.color, 0.45)}
            />
          ))}
        </defs>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey={xKey} {...axisProps} tickFormatter={xTickFormatter} minTickGap={24} />
        <YAxis {...axisProps} width={36} tickFormatter={valueFormatter} />
        <Tooltip
          cursor={{ fill: "rgba(31,195,214,0.06)" }}
          content={<ChartTooltip valueFormatter={valueFormatter} />}
        />
        {bars.map((bar, index) => (
          <Bar
            key={bar.dataKey}
            dataKey={bar.dataKey}
            name={bar.name}
            stackId="stack"
            fill={`url(#${baseId}-stack-${index})`}
            radius={index === bars.length - 1 ? [2.5, 2.5, 0, 0] : [0, 0, 0, 0]}
            isAnimationActive={false}
          />
        ))}
        <Line
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
