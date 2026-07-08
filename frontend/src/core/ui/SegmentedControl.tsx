export interface SegmentedControlOption {
  value: string;
  label: string;
}

export interface SegmentedControlProps {
  options: SegmentedControlOption[];
  value: string;
  onChange: (value: string) => void;
}

/**
 * Segmentierter Umschalter. Aktives Segment Teal/Text-on-Teal, inaktiv Text-Mid.
 * Auch als 2-Wege-Toggle nutzbar (Created/Done, Taeglich/Woechentlich).
 */
export function SegmentedControl({ options, value, onChange }: SegmentedControlProps) {
  return (
    <div
      style={{
        display: "flex",
        flex: "none",
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius-input)",
        overflow: "hidden",
        background: "var(--panel)",
      }}
    >
      {options.map((option, index) => {
        const isActive = option.value === value;
        const isLast = index === options.length - 1;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            style={{
              padding: "8px 12px",
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: 12.5,
              fontWeight: isActive ? 600 : 500,
              color: isActive ? "var(--text-on-teal)" : "var(--text-mid)",
              background: isActive ? "var(--teal)" : "transparent",
              border: "none",
              borderRight: isLast ? "none" : "1px solid var(--border-strong)",
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "color 120ms ease, background 120ms ease",
            }}
            onMouseEnter={(event) => {
              if (!isActive) event.currentTarget.style.color = "var(--soft)";
            }}
            onMouseLeave={(event) => {
              if (!isActive) event.currentTarget.style.color = "var(--text-mid)";
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
