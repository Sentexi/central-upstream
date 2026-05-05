import React, { useState } from "react";
import { forceClearSync } from "./api";

interface HealthForceClearButtonProps {
  visible: boolean;
  onCleared?: () => void;
}

export function HealthForceClearButton({ visible, onCleared }: HealthForceClearButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!visible) return null;

  const onClick = async () => {
    const proceed = window.confirm(
      "Soll der aktuelle Sync Status auf Fehler gesetzt werden? Der Schritt schreibt eine Historien Zeile und gibt den Slot fuer einen neuen Upload frei."
    );
    if (!proceed) return;

    setBusy(true);
    setError(null);
    try {
      await forceClearSync();
      onCleared?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Force Clear fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="health-force-clear">
      <button
        type="button"
        className="button button-secondary"
        onClick={onClick}
        disabled={busy}
      >
        {busy ? "Raeume auf..." : "Sync Status zuruecksetzen"}
      </button>
      {error && <div className="settings-error">{error}</div>}
    </div>
  );
}
