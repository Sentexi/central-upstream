import type { PropsWithChildren } from "react";

interface GlassCardProps extends PropsWithChildren {
  className?: string;
  glow?: boolean;
  stressLevel?: "low" | "high";
}

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
