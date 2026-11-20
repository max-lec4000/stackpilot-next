import { useCallback, useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { ConfirmBar, StatusBadge, useAction } from "./ui";

type Conn = { ok: boolean; error: string | null; user: string | null; ms: number | null; signedIn: boolean } | null;
type Remote = {
  live: boolean; at: string | null; version: string | null; uptimeSeconds: number | null;
  audio: { default: string | null; sinks: { name: string; description: string; kind: string }[]; volume: number | null; mute: boolean } | null;
  connections: { jellyfin: Conn; seerr: Conn; youtube: { available: boolean } | null; playing: boolean } | null;
};
const kindLabel: Record<string, string> = { airplay: "AirPlay", monitor: "Bildschirm", bluetooth: "Bluetooth", other: "Ausgang" };
const ago = (iso: string | null) => {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `vor ${s} s` : `vor ${Math.round(s / 60)} min`;
};

/** Couchdeck → Bedienung und Diagnose vom Sofa (Phase 7.6). */
export function CouchdeckRemote() {
  const [data, setData] = useState<Remote | null>(null), [volume, setVolume] = useState<number | null>(null), [restart, setRestart] = useState(false);
  const { busy, error, notice, setError, run } = useAction();
  const load = useCallback(async () => {
    try { setData(await get<Remote>("/api/couchdeck/remote")); } catch (e) { setError((e as Error).message); }
  }, [setError]);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (document.visibilityState !== "hidden") void load(); }, 10000);
    return () => clearInterval(t);
  }, [load]);
  const send = (key: string, body: Record<string, unknown>) => run(key, async () => {
    const r = await action<{ message: string }>("/api/couchdeck/remote", body);
    setTimeout(() => void load(), 1200);
    return r.message;
  });
  if (!data) return error ? <section className="tile"><p className="error" role="alert">{error}</p></section> : null;
  const conn = (label: string, c: Conn, extra?: string) => (
    <li>
      <b>{label}</b>{" "}
      {!c ? <span className="muted">unbekannt</span> : c.ok
        ? <StatusBadge tone="success">verbunden</StatusBadge>
        : <StatusBadge tone="danger">gestört</StatusBadge>}
      <span className="muted">
        {c?.user ? ` · angemeldet als ${c.user}` : ""}{c?.ms !== null && c?.ms !== undefined ? ` · ${c.ms} ms` : ""}{c?.error ? ` · ${c.error}` : ""}{extra || ""}
      </span>
    </li>
  );
  return (
    <section className="tile couchdeck-remote" aria-label="Bedienung und Diagnose">
      <div className="couchdeck-remote-head">
        <h3>Bedienung und Diagnose</h3>
        <span className="muted">{data.live ? `Stand ${ago(data.at)}${data.version ? ` · Couchdeck ${data.version}` : ""}` : ""}</span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {!data.live ? (
        <p className="muted">
          Couchdeck läuft gerade nicht{data.at ? ` (letzter Bericht ${ago(data.at)})` : ""}. Audioausgang, Testton und Diagnose gibt es,
          sobald es läuft – ab Couchdeck 0.2.11.
        </p>
      ) : (
        <>
          <h4>Verbindungen</h4>
          <ul className="couchdeck-remote-list">
            {conn("Jellyfin", data.connections?.jellyfin || null)}
            {conn("Seerr", data.connections?.seerr || null)}
            <li><b>YouTube</b> {data.connections?.youtube?.available ? <StatusBadge tone="success">bereit</StatusBadge> : <StatusBadge tone="neutral">nicht eingerichtet</StatusBadge>}</li>
            {data.connections?.playing && <li><StatusBadge tone="info">Spielt gerade etwas ab</StatusBadge></li>}
          </ul>
          <h4>Ton</h4>
          {!data.audio?.sinks.length && <p className="muted">Keine Audioausgänge gefunden.</p>}
          <ul className="couchdeck-sinks">
            {data.audio?.sinks.map((s) => (
              <li key={s.name}>
                <span><b>{s.description}</b> <span className="muted">· {kindLabel[s.kind] || s.kind}</span>{s.name === data.audio?.default && <> <StatusBadge tone="success">aktuell</StatusBadge></>}</span>
                <span className="couchdeck-actions">
                  <button disabled={!!busy} onClick={() => void send("tone:" + s.name, { action: "tone", name: s.name })}>{busy === "tone:" + s.name ? "Spielt …" : "Testton"}</button>
                  {s.name !== data.audio?.default && <button disabled={!!busy} onClick={() => void send("sink:" + s.name, { action: "set-sink", name: s.name })}>Hierhin wechseln</button>}
                </span>
              </li>
            ))}
          </ul>
          {data.audio?.volume !== null && data.audio?.volume !== undefined && (
            <div className="person-field">
              <label>Lautstärke <input type="range" min={0} max={100} step={5} value={volume ?? data.audio.volume}
                onChange={(e) => setVolume(Number(e.target.value))} disabled={!!busy} aria-label="Lautstärke" /> {volume ?? data.audio.volume} %{data.audio.mute ? " (stumm)" : ""}</label>
              {volume !== null && volume !== data.audio.volume && (
                <button disabled={!!busy} onClick={() => void send("volume", { action: "volume", percent: volume }).then(() => setVolume(null))}>Übernehmen</button>
              )}
            </div>
          )}
          <div className="couchdeck-actions">
            <button disabled={!!busy} onClick={() => void send("check", { action: "check" })}>{busy === "check" ? "Wird geprüft …" : "Jetzt prüfen"}</button>
            {!restart && <button disabled={!!busy} onClick={() => setRestart(true)}>Oberfläche neu starten</button>}
          </div>
          {restart && (
            <ConfirmBar label="Couchdeck neu starten" busy={busy === "restart"} busyLabel="Wird neu gestartet …" onCancel={() => setRestart(false)}
              onOk={() => send("restart", { action: "restart", confirmation: "OK" }).then(() => setRestart(false))}>
              <p>Couchdeck-Oberfläche neu starten? Eine laufende Wiedergabe wird dabei beendet; nach ein paar Sekunden ist Couchdeck wieder da.</p>
            </ConfirmBar>
          )}
        </>
      )}
    </section>
  );
}
