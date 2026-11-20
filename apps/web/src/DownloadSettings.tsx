import { useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { ConfirmBar, useAction } from "./ui";

type Settings = {
  seeding: { ratio: number | null; hours: number | null; action: "stop" | "remove" | "other" };
  limits: { downKiB: number; upKiB: number };
  schedule: { enabled: boolean; from: string; to: string; days: "all" | "weekdays" | "weekends" | "custom"; downKiB: number; upKiB: number };
};
type Form = {
  ratio: string; hours: string; action: "stop" | "remove";
  down: string; up: string;
  enabled: boolean; from: string; to: string; days: "all" | "weekdays" | "weekends"; altDown: string; altUp: string;
};
const toForm = (s: Settings): Form => ({
  ratio: s.seeding.ratio === null ? "" : String(s.seeding.ratio),
  hours: s.seeding.hours === null ? "" : String(s.seeding.hours),
  action: s.seeding.action === "remove" ? "remove" : "stop",
  down: String(s.limits.downKiB), up: String(s.limits.upKiB),
  enabled: s.schedule.enabled, from: s.schedule.from, to: s.schedule.to,
  days: s.schedule.days === "custom" ? "all" : s.schedule.days,
  altDown: String(s.schedule.downKiB), altUp: String(s.schedule.upKiB),
});
const speed = (v: string) => (Number(v) > 0 ? `${v} KiB/s` : "unbegrenzt");
const dayText = { all: "täglich", weekdays: "werktags", weekends: "am Wochenende" };

/** Downloads → Seeding und Geschwindigkeit (Phase 7.2b): qBittorrent-Einstellungen. */
export function DownloadSettings() {
  const [saved, setSaved] = useState<Settings | null>(null),
    [form, setForm] = useState<Form | null>(null),
    [confirm, setConfirm] = useState(false);
  const { busy, error, notice, setError, run } = useAction();
  useEffect(() => {
    get<Settings>("/api/downloads/settings")
      .then((s) => { setSaved(s); setForm(toForm(s)); })
      .catch((e) => setError((e as Error).message));
  }, [setError]);
  if (!form || !saved) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Wird geladen …</p>;
  const set = (patch: Partial<Form>) => { setForm({ ...form, ...patch }); setConfirm(false); };
  const changed = JSON.stringify(form) !== JSON.stringify(toForm(saved));
  const goal = [form.ratio && `Verhältnis ${form.ratio}`, form.hours && `${form.hours} Stunden`].filter(Boolean).join(" oder ");
  return (
    <form className="download-settings" onSubmit={(e) => { e.preventDefault(); setConfirm(true); }}>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      <fieldset disabled={!!busy}>
        <legend>Seeding</legend>
        <p className="muted">
          Wie lange fertige Downloads weiter hochgeladen werden. Leer = kein Ziel. Private Tracker verlangen oft
          Mindestwerte – dann deren Regeln beachten.
        </p>
        <label>Bis Verhältnis <input type="number" min="0.1" max="100" step="0.1" value={form.ratio} placeholder="z. B. 2"
          onChange={(e) => set({ ratio: e.target.value })} /></label>
        <label>oder Stunden <input type="number" min="0.5" max="8760" step="0.5" value={form.hours} placeholder="z. B. 72"
          onChange={(e) => set({ hours: e.target.value })} /></label>
        <label>Danach
          <select value={form.action} onChange={(e) => set({ action: e.target.value as Form["action"] })}>
            <option value="stop">anhalten</option>
            <option value="remove">aus qBittorrent entfernen (Dateien bleiben)</option>
          </select>
        </label>
        {saved.seeding.action === "other" && (
          <p className="notice">In qBittorrent ist gerade eine andere Aktion eingestellt (Superseeding oder Löschen samt Dateien). Beim Speichern wird sie ersetzt.</p>
        )}
      </fieldset>
      <fieldset disabled={!!busy}>
        <legend>Geschwindigkeit</legend>
        <p className="muted">In KiB/s, 0 = unbegrenzt (1 MiB/s = 1024 KiB/s).</p>
        <label>Download <input type="number" min="0" step="1" value={form.down} onChange={(e) => set({ down: e.target.value })} /></label>
        <label>Upload <input type="number" min="0" step="1" value={form.up} onChange={(e) => set({ up: e.target.value })} /></label>
      </fieldset>
      <fieldset disabled={!!busy}>
        <legend>Zeitplan</legend>
        <label className="person-check">
          <input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          Zu bestimmten Zeiten drosseln (z. B. abends, wenn ihr streamt)
        </label>
        {form.enabled && (
          <>
            <label>Von <input type="time" value={form.from} onChange={(e) => set({ from: e.target.value })} /></label>
            <label>Bis <input type="time" value={form.to} onChange={(e) => set({ to: e.target.value })} /></label>
            <label>Tage
              <select value={form.days} onChange={(e) => set({ days: e.target.value as Form["days"] })}>
                <option value="all">täglich</option><option value="weekdays">werktags</option><option value="weekends">am Wochenende</option>
              </select>
            </label>
            <label>Gedrosselt Download <input type="number" min="0" step="1" value={form.altDown} onChange={(e) => set({ altDown: e.target.value })} /></label>
            <label>Gedrosselt Upload <input type="number" min="0" step="1" value={form.altUp} onChange={(e) => set({ altUp: e.target.value })} /></label>
            {saved.schedule.days === "custom" && <p className="notice">In qBittorrent ist ein einzelner Wochentag eingestellt; beim Speichern gilt die Auswahl oben.</p>}
          </>
        )}
      </fieldset>
      {!confirm && <button className="primary" disabled={!!busy || !changed}>Speichern</button>}
      {confirm && (
        <ConfirmBar label="Download-Einstellungen speichern" busy={busy === "save"} busyLabel="Wird gespeichert …"
          onCancel={() => setConfirm(false)}
          onOk={() => run("save", async () => {
            const next = await action<Settings>("/api/downloads/settings", {
              seeding: { ratio: form.ratio === "" ? null : Number(form.ratio), hours: form.hours === "" ? null : Number(form.hours), action: form.action },
              limits: { downKiB: Number(form.down || 0), upKiB: Number(form.up || 0) },
              schedule: { enabled: form.enabled, from: form.from, to: form.to, days: form.days, downKiB: Number(form.altDown || 0), upKiB: Number(form.altUp || 0) },
              confirmation: "OK",
            });
            setSaved(next); setForm(toForm(next)); setConfirm(false);
            return "In qBittorrent gespeichert und bestätigt.";
          })}>
          <p>
            Seeding: {goal ? <>bis {goal}, danach {form.action === "stop" ? "anhalten" : "entfernen (Dateien bleiben)"}</> : "ohne Ziel"} ·
            Geschwindigkeit: ↓ {speed(form.down)}, ↑ {speed(form.up)}
            {form.enabled && <> · {dayText[form.days]} {form.from}–{form.to} gedrosselt auf ↓ {speed(form.altDown)}, ↑ {speed(form.altUp)}</>}
          </p>
          <p className="muted">Gilt sofort für alle Downloads in qBittorrent.</p>
        </ConfirmBar>
      )}
    </form>
  );
}
