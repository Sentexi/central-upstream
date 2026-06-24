import type { ReactNode } from "react";

export type BadgeTone =
  | "inprogress"
  | "open"
  | "blocked"
  | "done"
  | "success"
  | "warning"
  | "error"
  | "neutral"
  | "teal";

export interface BadgeProps {
  tone: BadgeTone;
  children: ReactNode;
}

interface ToneStyle {
  background: string;
  color: string;
  border?: string;
}

const TONE_STYLES: Record<BadgeTone, ToneStyle> = {
  inprogress: { background: "rgba(79,91,214,0.16)", color: "#AAB2F5" },
  open: { background: "rgba(148,153,182,0.12)", color: "var(--text-mid)" },
  neutral: { background: "rgba(148,153,182,0.12)", color: "var(--text-mid)" },
  blocked: { background: "rgba(255,93,82,0.15)", color: "#FF9A91" },
  done: { background: "rgba(70,207,146,0.15)", color: "#88E6B6" },
  success: { background: "rgba(70,207,146,0.15)", color: "#88E6B6" },
  warning: { background: "var(--warning-fill)", color: "var(--warning-text)" },
  error: { background: "var(--error-fill)", color: "var(--error-text)" },
  teal: {
    background: "rgba(31,195,214,0.12)",
    color: "var(--teal)",
    border: "1px solid rgba(31,195,214,0.3)",
  },
};

/**
 * Status-Pill mit festem Ton-Vokabular (Radius 20px). Farbwerte exakt nach Spec.
 */
export function Badge({ tone, children }: BadgeProps) {
  const toneStyle = TONE_STYLES[tone];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11.5,
        padding: "4px 10px",
        borderRadius: "var(--radius-pill)",
        background: toneStyle.background,
        color: toneStyle.color,
        border: toneStyle.border ?? "1px solid transparent",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
