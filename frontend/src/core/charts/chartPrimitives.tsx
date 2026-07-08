import type { TooltipProps } from "recharts";
import type {
  NameType,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";
import { MONO, tooltipContainerStyle, type GradientStop } from "./chartTheme";

export interface LinearGradientDefProps {
  id: string;
  stops: GradientStop[];
}

/** Vertikaler linearGradient fuer Balken/Flaechen (x1=y1=0, x2=0, y2=1). */
export function LinearGradientDef({ id, stops }: LinearGradientDefProps) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      {stops.map((stop) => (
        <stop
          key={stop.offset}
          offset={stop.offset}
          stopColor={stop.color}
          stopOpacity={stop.opacity}
        />
      ))}
    </linearGradient>
  );
}

export interface ChartTooltipProps extends TooltipProps<ValueType, NameType> {
  /** Optionaler Formatter fuer die Werte. */
  valueFormatter?: (value: number) => string;
  /** Optionale Einheit hinter dem Wert. */
  unit?: string;
  /** Formatter fuer Serien auf der rechten (Dual-Axis-)Achse. */
  rightFormatter?: (value: number) => string;
  /** dataKeys, die auf der rechten Achse liegen und rightFormatter nutzen. */
  rightKeys?: string[];
}

/**
 * Custom-Tooltip im Aqua-Operator-Stil (BG Panel, Border-Strong, Mono).
 * Zeigt Label + je Serie einen Farbpunkt, Namen und Wert.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  valueFormatter,
  unit,
  rightFormatter,
  rightKeys,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div style={tooltipContainerStyle}>
      {label !== undefined && label !== null ? (
        <div style={{ color: "#7E84A8", marginBottom: 4, fontFamily: MONO }}>{label}</div>
      ) : null}
      {payload.map((entry, index) => {
        const raw = entry.value;
        const numeric = typeof raw === "number" ? raw : Number(raw);
        const onRight =
          rightKeys != null &&
          entry.dataKey != null &&
          rightKeys.includes(String(entry.dataKey));
        const fmt = onRight ? rightFormatter ?? valueFormatter : valueFormatter;
        const display =
          fmt && !Number.isNaN(numeric) ? fmt(numeric) : String(raw ?? "");
        return (
          <div
            key={`${entry.dataKey ?? entry.name ?? index}`}
            style={{ display: "flex", alignItems: "center", gap: 7 }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: (entry.color as string) ?? "#1FC3D6",
              }}
            />
            {entry.name ? (
              <span style={{ color: "#9499B6" }}>{entry.name}</span>
            ) : null}
            <span style={{ color: "#E9ECF7", marginLeft: "auto" }}>
              {display}
              {unit ? ` ${unit}` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
