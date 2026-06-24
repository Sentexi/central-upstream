import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { axisProps, CHART_COLORS, CHART_MARGIN, gridProps } from "./chartTheme";
import { ChartTooltip } from "./chartPrimitives";

export interface DualLineSeries {
  dataKey: string;
  name?: string;
  color: string;
  /** Gestrichelt (z. B. 7-Tage-Durchschnitt). */
  dashed?: boolean;
}

export interface DualLineChartProps {
  data: Array<Record<string, unknown>>;
  xKey: string;
  /** Durchgezogene Linie (z. B. Gewicht, amber). */
  primary: DualLineSeries;
  /** Zweite Linie, meist gestrichelt (z. B. 7-Tage-Ø, violet). */
  secondary: DualLineSeries;
  height?: number;
  yMin?: number;
  yMax?: number;
  unit?: string;
  valueFormatter?: (value: number) => string;
  xTickFormatter?: (value: string) => string;
}

/**
 * Zwei Linien, eine durchgezogen (Amber), eine gestrichelt (Violet, 7-Tage-Ø)
 * fuer das Fitness-Gewicht.
 */
export function DualLineChart({
  data,
  xKey,
  primary,
  secondary,
  height = 220,
  yMin,
  yMax,
  unit,
  valueFormatter,
  xTickFormatter,
}: DualLineChartProps) {
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
        <Tooltip
          cursor={{ stroke: CHART_COLORS.borderStrong, strokeWidth: 1 }}
          content={<ChartTooltip valueFormatter={valueFormatter} unit={unit} />}
        />
        <Line
          type="monotone"
          dataKey={primary.dataKey}
          name={primary.name}
          stroke={primary.color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={primary.dashed ? "5 4" : undefined}
          isAnimationActive={false}
          dot={{ r: 2.8, fill: primary.color, stroke: CHART_COLORS.panel, strokeWidth: 1.5 }}
        />
        <Line
          type="monotone"
          dataKey={secondary.dataKey}
          name={secondary.name}
          stroke={secondary.color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={secondary.dashed === false ? undefined : "5 4"}
          isAnimationActive={false}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
