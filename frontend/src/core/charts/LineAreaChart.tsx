import { useId } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  areaGradientStops,
  axisProps,
  CHART_COLORS,
  CHART_MARGIN,
  gridProps,
} from "./chartTheme";
import { ChartTooltip, LinearGradientDef } from "./chartPrimitives";

export interface LineAreaChartProps {
  data: Array<Record<string, unknown>>;
  dataKey: string;
  xKey: string;
  color?: string;
  height?: number;
  yMin?: number;
  yMax?: number;
  unit?: string;
  valueFormatter?: (value: number) => string;
  xTickFormatter?: (value: string) => string;
}

/**
 * Linie (2px, monotone, runde Caps) plus Flaechenverlauf darunter (0.18 -> 0).
 * Der letzte Punkt wird als Kreis (r 3.4) mit Panel-farbigem 2px-Stroke betont.
 */
export function LineAreaChart({
  data,
  dataKey,
  xKey,
  color = CHART_COLORS.teal,
  height = 220,
  yMin,
  yMax,
  unit,
  valueFormatter,
  xTickFormatter,
}: LineAreaChartProps) {
  const gradientId = useId().replace(/:/g, "");
  const lastIndex = data.length - 1;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={CHART_MARGIN}>
        <defs>
          <LinearGradientDef id={gradientId} stops={areaGradientStops(color)} />
        </defs>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey={xKey} {...axisProps} tickFormatter={xTickFormatter} minTickGap={24} />
        <YAxis
          {...axisProps}
          width={36}
          domain={[yMin ?? "auto", yMax ?? "auto"]}
          tickFormatter={valueFormatter}
        />
        <Tooltip
          cursor={{ stroke: CHART_COLORS.borderStrong, strokeWidth: 1 }}
          content={<ChartTooltip valueFormatter={valueFormatter} unit={unit} />}
        />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke="none"
          fill={`url(#${gradientId})`}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          isAnimationActive={false}
          dot={(props) => {
            const { cx, cy, index, key } = props as {
              cx?: number;
              cy?: number;
              index?: number;
              key?: string;
            };
            if (index !== lastIndex || cx == null || cy == null) {
              return <g key={key} />;
            }
            return (
              <circle
                key={key}
                cx={cx}
                cy={cy}
                r={3.4}
                fill={color}
                stroke={CHART_COLORS.panel}
                strokeWidth={2}
              />
            );
          }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
