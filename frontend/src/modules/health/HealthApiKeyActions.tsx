import React, { useState } from "react";
import { revealApiKey, rotateApiKey, type ApiKeyReveal } from "./api";

export function HealthApiKeyActions() {
  const [revealed, setRevealed] = useState<ApiKeyReveal | null>(null);
  const [busy, setBusy] = useState<"reveal" | "rotate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rotated, setRotated] = useState(false);

  const onReveal = async () => {
    setBusy("reveal");
    setError(null);
    setRotated(false);
    try {
      setRevealed(await revealApiKey());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Anzeigen fehlgeschlagen");
    } finally {
      setBusy(null);
    }
  };

  const onRotate = async () => {
    const confirmed = window.confirm(
      "Beim Rotieren wird der bisherige API Key sofort ungueltig. Auto Export muss danach mit dem neuen Key neu konfiguriert werden. Fortfahren?"
    );
    if (!confirmed) return;
    setBusy("rotate");
    setError(null);
    try {
      setRevealed(await rotateApiKey());
      setRotated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rotieren fehlgeschlagen");
    } finally {
      setBusy(null);
    }
  };

  const onHide = () => {
    setRevealed(null);
    setRotated(false);
  };

  const copy = (text: string) => {
    if (!navigator?.clipboard) return;
    void navigator.clipboard.writeText(text);
  };

  return (
    <div className="health-api-key">
      <div className="health-api-key__header">
        <span className="settings-label">API Key</span>
        <div className="health-api-key__buttons">
          <button
            type="button"
            className="button button-secondary"
            onClick={onReveal}
            disabled={busy !== null}
          >
            {busy === "reveal" ? "Lade..." : revealed ? "Neu anzeigen" : "Anzeigen"}
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={onRotate}
            disabled={busy !== null}
          >
            {busy === "rotate" ? "Rotiere..." : "Rotieren"}
          </button>
          {revealed && (
            <button
              type="button"
              className="button button-tertiary"
              onClick={onHide}
              disabled={busy !== null}
            >
              Verbergen
            </button>
          )}
        </div>
      </div>

      {error && <div className="settings-error">{error}</div>}

      {revealed && (
        <div className="health-api-key__panel">
          {rotated && (
            <div className="settings-success">
              Neuer Key generiert. Bisheriger Key ist ab sofort ungueltig.
            </div>
          )}

          <label className="health-api-key__field">
            <span className="muted small">{revealed.auth_header}</span>
            <div className="health-api-key__row">
              <input
                type="text"
                readOnly
                className="input"
                value={revealed.auth_key}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                type="button"
                className="button button-tertiary"
                onClick={() => copy(revealed.auth_key)}
              >
                Kopieren
              </button>
            </div>
          </label>

          {revealed.curl_example && (
            <label className="health-api-key__field">
              <span className="muted small">curl Beispiel</span>
              <div className="health-api-key__row">
                <textarea
                  readOnly
                  className="input"
                  rows={3}
                  value={revealed.curl_example}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button
                  type="button"
                  className="button button-tertiary"
                  onClick={() => copy(revealed.curl_example)}
                >
                  Kopieren
                </button>
              </div>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
