import { useCallback, useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { SectionHeading, StatusBadge, useAction, useConfirm } from "./ui";

type Session = {
  id: string; user: string; device: string; client: string; title: string; paused: boolean; position: string; duration: string | null;
  progress: number | null; method: "direct" | "stream" | "remux" | "transcode"; reasons: { code: string; label: string; hint: string }[];
  transcode: { video: string | null; audio: string | null; bitrateMbit: number | null; height: number | null; hardware: string | null; videoDirect: boolean; audioDirect: boolean } | null;
};
type Data = { sessions: Session[]; transcoding: number; remoteLimitMbit: number; choices: number[]; hardware: string | null };
const methodLabel = { direct: ["Direkt", "success"], stream: ["Direkt (umverpackt)", "success"], remux: ["Nur Ton umgewandelt", "info"], transcode: ["Wird umgewandelt", "warning"] } as const;
const hwLabel = (h: string | null) => (!h ? "unbekannt" : h === "none" ? "aus (nur Prozessor)" : h.toUpperCase());

/** Medien → Wiedergaben (Phase 7 Paket 7.4). */
export function PlaybackView() {
  const [data, setData] = useState<Data | null>(null), [limit, setLimit] = useState<number | null>(null);
  const { busy, error, notice, setError, run } = useAction();
  const { ask, dialog } = useConfirm();
  const load = useCallback(async () => {
    try { setData(await get<Data>("/api/media/playback")); } catch (e) { setError((e as Error).message); }
  }, [setError]);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (document.visibilityState !== "hidden") void load(); }, 10000);
    return () => clearInterval(t);
  }, [load]);
  if (!data) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Wird geladen …</p>;
  const chosen = limit ?? data.remoteLimitMbit;
  return (
    <section className="managed-services playback-view" aria-label="Wiedergaben">
      <SectionHeading title="Wiedergaben" description="Was gerade läuft, auf welchem Gerät – und ob Jellyfin dafür umwandeln muss." />
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {dialog}
      {!data.sessions.length ? <p className="muted">Gerade läuft nichts.</p> : (
        <ul className="playback-list">
          {data.sessions.map((s) => (
            <li key={s.id}>
              <div className="download-issue-title">
                <b>{s.title}</b>
                <StatusBadge tone={methodLabel[s.method][1]}>{methodLabel[s.method][0]}</StatusBadge>
                {s.paused && <StatusBadge tone="neutral">pausiert</StatusBadge>}
              </div>
              <span className="muted">{s.user} · {s.device}{s.client ? ` (${s.client})` : ""} · {s.position}{s.duration ? ` von ${s.duration}` : ""}</span>
              {s.progress !== null && <progress max={1} value={s.progress} aria-label="Fortschritt" />}
              {s.transcode && s.method !== "direct" && (
                <span className="muted">
                  Ausgabe: {[s.transcode.video && `${s.transcode.videoDirect ? "Video direkt" : s.transcode.video.toUpperCase()}`, s.transcode.audio && `Ton ${s.transcode.audioDirect ? "direkt" : s.transcode.audio.toUpperCase()}`,
                    s.transcode.height && `${s.transcode.height}p`, s.transcode.bitrateMbit && `${s.transcode.bitrateMbit} Mbit/s`,
                    s.transcode.hardware ? `Hardware ${s.transcode.hardware.toUpperCase()}` : "per Prozessor"].filter(Boolean).join(" · ")}
                </span>
              )}
              {!!s.reasons.length && (
                <ul className="playback-reasons">
                  {s.reasons.map((r) => <li key={r.code}><b>{r.label}</b>{r.hint && <span className="muted"> – {r.hint}</span>}</li>)}
                </ul>
              )}
              <button disabled={!!busy} onClick={async () => {
                if (await ask(<>Wiedergabe von „{s.title}“ auf {s.device || "dem Gerät"} ({s.user}) beenden?</>, "Wiedergabe beenden", "Beenden"))
                  await run("stop:" + s.id, async () => { const r = await action<{ message: string }>("/api/media/playback/stop", { id: s.id, confirmation: "OK" }); await load(); return r.message; });
              }}>{busy === "stop:" + s.id ? "Wird beendet …" : "Beenden"}</button>
            </li>
          ))}
        </ul>
      )}
      <div className="tile">
        <h3>Unterwegs</h3>
        <p className="muted">
          Höchste Bitrate für Geräte außerhalb des Heimnetzes. Darüber wandelt Jellyfin um – das schont die Leitung, kostet aber
          Rechenleistung. Hardwarebeschleunigung: <b>{hwLabel(data.hardware)}</b>.
        </p>
        <label className="person-field">Grenze{" "}
          <select value={chosen} disabled={!!busy} onChange={(e) => setLimit(Number(e.target.value))}>
            {data.choices.map((c) => <option key={c} value={c}>{c ? `${c} Mbit/s` : "unbegrenzt"}</option>)}
          </select>
        </label>
        {chosen !== data.remoteLimitMbit && (
          <button className="primary" disabled={!!busy} onClick={async () => {
            if (await ask(<>Für Wiedergaben von unterwegs {chosen ? `höchstens ${chosen} Mbit/s` : "keine Grenze"} festlegen?</>, "Grenze speichern"))
              await run("limit", async () => { const r = await action<{ message: string }>("/api/media/playback/limit", { mbit: chosen, confirmation: "OK" }); setLimit(null); await load(); return r.message; });
          }}>Speichern …</button>
        )}
      </div>
    </section>
  );
}
