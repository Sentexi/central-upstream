import type { CSSProperties, ReactNode } from "react";

export interface CardProps {
  children?: ReactNode;
  /** Modul-Karte = 16px Radius statt 14px. */
  module?: boolean;
  /** Setzt einen border-top-Akzent (KPI-Variante), z. B. "var(--indigo)". */
  accent?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Panel-Wrapper: BG Panel, Border, Radius 14px (Modul 16px), Padding ~18px.
 * accent setzt border-top:2px solid <accent> fuer KPI-Karten.
 */
export function Card({ children, module = false, accent, className, style }: CardProps) {
  const baseStyle: CSSProperties = {
    padding: 18,
    borderRadius: module ? "var(--radius-module)" : "var(--radius-card)",
    background: "var(--panel)",
    border: "1px solid var(--border)",
    ...(accent ? { borderTop: `2px solid ${accent}` } : null),
    ...style,
  };

  return (
    <div className={className} style={baseStyle}>
      {children}
    </div>
  );
}
