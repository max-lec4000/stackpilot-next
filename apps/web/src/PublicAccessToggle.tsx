import { useCallback, useEffect, useRef, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";

type Status = { available: boolean; public?: boolean | null; message?: string | null };

/**
 * Kopfleiste → „Public access“: öffentliche Erreichbarkeit (Tailscale Funnel) ein/aus.
 * Erscheint erst, wenn Funnel unter System → Zugriff & Netzwerk vollständig geprüft und einmal
 * freigegeben wurde. Einschalten fragt nach; der Server prüft alle Voraussetzungen erneut.
 */
export function PublicAccessToggle() {
  const [status, setStatus] = useState<Status | null>(null),
    [busy, setBusy] = useState(false), [error, setError] = useState(""), [asking, setAsking] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const load = useCallback(async () => {
    try { setStatus(await get<Status>("/api/remote-access/public")); } catch { setStatus(null); }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (document.visibilityState !== "hidden") void load(); }, 60000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    const d = dialog.current;
    if (asking) d?.showModal(); else d?.close();
  }, [asking]);
  if (!status?.available) return null;
  const on = status.public === true;
  async function change(enabled: boolean) {
    setAsking(false); setBusy(true); setError("");
    try {
      await action("/api/remote-access/public", { enabled, confirmation: "OK" });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); await load(); }
  }
  return (
    <span className="public-access">
      <label className={"switch public-access-switch" + (on ? " on" : "")}
        title={status.message || (on ? "Jellyfin ist öffentlich erreichbar (Funnel an)" : "Nur im Heimnetz und Tailnet (Funnel aus)")}>
        <input type="checkbox" role="switch" checked={on} disabled={busy} aria-label="Public access"
          onChange={() => (on ? void change(false) : setAsking(true))} />
        <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
        <span className="switch-text"><b>Public access</b>{busy ? <span>…</span> : status.public === null ? <span>teilweise</span> : null}</span>
      </label>
      {error && <span className="error public-access-error" role="alert">{error}</span>}
      <dialog ref={dialog} className="public-access-dialog" aria-labelledby="public-access-title"
        onCancel={(e) => { e.preventDefault(); setAsking(false); }}>
        <h2 id="public-access-title">Bist du dir sicher?</h2>
        <p>Jellyfin und die Anmeldung werden öffentlich über das Internet erreichbar (Tailscale Funnel).
          Vorher prüft StackPilot alle Schutzvoraussetzungen erneut.</p>
        <div className="row">
          <button className="primary" onClick={() => void change(true)}>Ja</button>
          <button onClick={() => setAsking(false)} autoFocus>Nein</button>
        </div>
      </dialog>
    </span>
  );
}
