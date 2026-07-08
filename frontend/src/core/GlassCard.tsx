import type { PropsWithChildren } from "react";

interface GlassCardProps extends PropsWithChildren {
  className?: string;
  glow?: boolean;
  stressLevel?: "low" | "high";
}

/**
 * Panel-Karte im Aqua-Operator-Stil: BG var(--panel), Border var(--border),
 * Radius var(--radius-card), kein Schlagschatten (Tiefe ueber BG + Border).
 * API unveraendert: glow = dezenter Teal-Ring (glow-low), stressLevel="high"
 * zusammen mit glow = Coral/Error-Ring (glow-high). Styles in index.css unter
 * .glass-card. children werden im .stack-Wrapper gerendert.
 */
export function GlassCard({
  children,
  className = "",
  glow = false,
  stressLevel = "low",
}: GlassCardProps) {
  const glowClass = glow
    ? stressLevel === "high"
      ? "glow-high"
      : "glow-low"
    : "";

  return (
    <div className={`glass-card ${glowClass} ${className}`.trim()}>
      <div className="stack">{children}</div>
    </div>
  );
}
