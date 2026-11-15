import { useState } from "react";
import { action } from "./RetirementPanel";
import { get } from "./ServerCheck";
type Plan = {
  ready: boolean; review: string | null; active: boolean; complete?: boolean;
  canDisable: boolean; blockers: string[];
  routes: { name: string; url: string }[];
};
const checks = [
  ["browserMfa", "Im Browser als Zuschauer über Authentik mit MFA angemeldet; richtige Bibliotheken sichtbar."],
  ["quickConnect", "Handy per Quick Connect aus dieser Zuschauersitzung angemeldet."],
  ["playback", "Wiedergabe und Spulen auf dem vorgesehenen Gerät getestet."],
  ["revocation", "Eine Test-Gerätesitzung widerrufen und geprüft, dass sie keinen Zugriff mehr hat."],
  ["recovery", "MFA-Wiederherstellungscodes sicher offline gespeichert."],
] as const;
export function FunnelPreview() {
  const [plan, setPlan] = useState<Plan | null>(null),
    [busy, setBusy] = useState(false), [error, setError] = useState(""),
    [message, setMessage] = useState(""), [password, setPassword] = useState(""),
    [accepted, setAccepted] = useState<Record<string, boolean>>({}),
    [confirmed, setConfirmed] = useState(false);
  async function refresh() {
    setBusy(true); setError(""); setPlan(null); setConfirmed(false);
    try { setPlan(await get<Plan>("/api/remote-access/funnel")); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function change(enable: boolean) {
    setBusy(true); setError(""); setMessage("");
    try {
      const r = await action<{ok: boolean; message: string}>(
        "/api/remote-access/funnel/" + (enable ? "enable" : "disable"),
        { review: plan?.review, password, confirmation: "OK", acceptance: accepted });
      setMessage(r.message);
      setPassword(""); setConfirmed(false);
      await refresh();
    } catch (e) { setError((e as Error).message); setPlan(null); }
    finally { setBusy(false); setPassword(""); }
  }
  return <div className="tile">
    <h3>Jellyfin ohne Tailscale-App erreichen</h3>
    <p>Funnel veröffentlicht ausschließlich das geschützte Jellyfin und die nötige
      Authentik-Anmeldung. Server, StackPilot und Dienste bleiben lokal wie bisher erreichbar.
      Verwaltungsoberflächen werden durch diesen Ablauf nicht veröffentlicht.</p>
    <button disabled={busy} onClick={() => void refresh()}>
      {busy ? "Wird geprüft …" : "Freigabe und Voraussetzungen prüfen"}
    </button>
    {error && <p role="alert" className="error">{error}</p>}
    {message && <p role="status" className="notice">{message}</p>}
    {plan && <>
      <p className={plan.active ? "notice" : "muted"}>
        {plan.active ? plan.complete ? "Beide öffentlichen Routen sind in Tailscale aktiv."
          : "Mindestens eine öffentliche Route ist aktiv; Einrichtung unvollständig."
          : "Keine öffentliche Funnel-Freigabe aktiv."}
        {" "}Das bestätigt noch keinen Zugriff aus einem fremden Netz.
      </p>
      {plan.routes.map((r) => <p key={r.name}><b>{r.name}</b>:{" "}
        <a href={r.url} target="_blank" rel="noreferrer">{r.url}</a></p>)}
      {plan.blockers.length > 0 && <div className="warning">
        <b>Vor der Aktivierung noch erledigen</b>
        <ul>{plan.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
      </div>}
      {plan.ready && !plan.complete && <fieldset disabled={busy}>
        <legend>Deine persönlichen Tests bestätigen</legend>
        <p>Diese Tests kann die Serverprüfung nicht für dich durchführen.
          Smart-TV ist vorerst nicht erforderlich.</p>
        {checks.map(([id, label]) => <label key={id}>
          <input type="checkbox" checked={!!accepted[id]}
            onChange={(e) => setAccepted({...accepted, [id]: e.target.checked})} /> {label}
        </label>)}
      </fieldset>}
      {(plan.canDisable || (plan.ready && !plan.complete)) && <>
        <label>StackPilot-Passwort
          <input type="password" autoComplete="current-password" value={password}
            disabled={busy} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label><input type="checkbox" checked={confirmed} disabled={busy}
          onChange={(e) => setConfirmed(e.target.checked)} />
          Änderung des öffentlichen Zugriffs bestätigen</label>
        <div className="row">
          {plan.ready && !plan.complete && <button className="primary"
            disabled={busy || !password || !confirmed || !checks.every(([id]) => accepted[id])}
            onClick={() => void change(true)}>Jellyfin und Anmeldung öffentlich freigeben</button>}
          {plan.canDisable && <button disabled={busy || !password || !confirmed}
            onClick={() => void change(false)}>Öffentlichen Zugriff abschalten · privat behalten</button>}
        </div>
      </>}
      {plan.complete && <div className="notice">
        <b>Jetzt über Mobilfunk testen</b>
        <ol><li>Am Handy WLAN und Tailscale vorübergehend ausschalten.</li>
          <li>Jellyfin öffnen, als Zuschauer über Authentik mit MFA anmelden.</li>
          <li>Bibliothek, Wiedergabe und Spulen testen.</li></ol>
        <p>Quick Connect wird in einer bereits per MFA angemeldeten
          Jellyfin-Browsersitzung bestätigt. Bei verlorenen Geräten die Sitzung widerrufen.</p>
      </div>}
    </>}
    <details><summary>Grenzen und lokale Erreichbarkeit</summary>
      <p>Es werden keine LAN-Ports, Firewall-, SSH- oder Tailnet-Zugriffsregeln verändert.
        Vorhandene lokale Adressen bleiben erhalten. Das eingeschränkte Gateway blockiert
        Passwortanmeldung und Administratorsitzungen auf dem externen Weg.</p>
      <p>Tailscale muss Funnel für diesen Server erlauben. Eine fehlende lokale
        Berechtigung wird angezeigt; StackPilot startet kein sudo.
        Funnel hat Bandbreitenlimits und ersetzt keine garantierte Streaming-Anbindung.</p>
      <p>Während StackPilot läuft, wird die eigene Freigabe nach dem Start und
        alle fünf Minuten erneut geprüft. Nicht mehr bestätigte Voraussetzungen
        führen zur Rücknahme der eigenen Freigabe. Das ist keine lückenlose
        Überwachung; fremde Konfigurationsänderungen werden nicht überschrieben.</p>
    </details>
  </div>;
}
