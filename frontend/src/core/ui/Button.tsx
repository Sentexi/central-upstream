import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
  icon?: ReactNode;
}

/**
 * Primaer/Sekundaer-Button im Aqua-Operator-Stil.
 * Primary: Teal-BG + Text-on-Teal + Glow. Secondary: Panel + Border-Strong + Soft.
 */
export function Button({
  variant = "primary",
  icon,
  children,
  style,
  ...rest
}: ButtonProps) {
  const isPrimary = variant === "primary";

  const baseStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 15px",
    borderRadius: "var(--radius-control)",
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 13,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "filter 150ms ease, background 150ms ease, border-color 150ms ease",
    ...(isPrimary
      ? {
          border: "1px solid var(--teal)",
          background: "var(--teal)",
          color: "var(--text-on-teal)",
          fontWeight: 700,
          boxShadow: "0 0 18px rgba(31,195,214,0.25)",
        }
      : {
          border: "1px solid var(--border-strong)",
          background: "var(--panel)",
          color: "var(--soft)",
          fontWeight: 600,
        }),
  };

  return (
    <button type="button" {...rest} style={{ ...baseStyle, ...style }}>
      {icon}
      {children}
    </button>
  );
}
