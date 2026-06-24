import { useId } from "react";
import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
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

export interface BarChartProps {
  data: Array<Record<string, unknown>>;
  dataKey: string;
  xKey: string;
  color?: string;
  height?: number;
  unit?: string;
  valueFormatter?: (value: number) => string;
  xTickFormatter?: (value: string) => string;
}

/**
 * Gradient-Balken (Radius 2.5, vertikaler Verlauf 0.95 -> 0.4).
 */
export function BarChart({
  data,
  dataKey,
  xKey,
  color = CHART_COLORS.teal,
  height = 220,
  unit,
  valueFormatter,
  xTickFormatter,
}: BarChartProps) {
  const gradientId = useId().replace(/:/g, "");

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart data={data} margin={CHART_MARGIN}>
        <defs>
          <LinearGradientDef id={gradientId} stops={barGradientStops(color, 0.4)} />
        </defs>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey={xKey} {...axisProps} tickFormatter={xTickFormatter} minTickGap={24} />
        <YAxis {...axisProps} width={36} tickFormatter={valueFormatter} />
        <Tooltip
          cursor={{ fill: "rgba(31,195,214,0.06)" }}
          content={<ChartTooltip valueFormatter={valueFormatter} unit={unit} />}
        />
        <Bar
          dataKey={dataKey}
          fill={`url(#${gradientId})`}
          radius={[2.5, 2.5, 0, 0]}
          isAnimationActive={false}
        />
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
