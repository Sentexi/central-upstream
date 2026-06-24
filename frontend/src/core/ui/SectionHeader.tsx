export interface SectionHeaderProps {
  label: string;
}

/**
 * Sektions-Label: Teal-Punkt (6px) + Mono-Uppercase-Label in Text-Low.
 */
export function SectionHeader({ label }: SectionHeaderProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "30px 0 13px" }}>
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "var(--teal)",
        }}
      />
      <span
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          letterSpacing: "0.2em",
          color: "var(--text-low)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
    </div>
  );
}
