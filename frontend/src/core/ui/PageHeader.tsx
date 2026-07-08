import type { ReactNode } from "react";

export interface PageHeaderProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
}

/**
 * Seiten-Kopf laut Aqua-Operator-Mockups: Eyebrow (Mono, uppercase) + H1 +
 * optionale Subtitle, rechts ein Controls-Slot.
 */
export function PageHeader({ eyebrow, title, subtitle, right }: PageHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 24,
        flexWrap: "wrap",
      }}
    >
      <div>
        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            letterSpacing: "0.2em",
            color: "var(--text-low)",
            textTransform: "uppercase",
          }}
        >
          {eyebrow}
        </div>
        <h1
          style={{
            margin: "8px 0 0",
            fontSize: 30,
            fontWeight: 700,
            color: "var(--text-high)",
            letterSpacing: "-0.02em",
          }}
        >
          {title}
        </h1>
        {subtitle ? (
          <p
            style={{
              margin: "7px 0 0",
              color: "var(--text-mid)",
              fontSize: 14,
              maxWidth: 560,
            }}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
      {right ? <div style={{ flex: "none" }}>{right}</div> : null}
    </div>
  );
}
