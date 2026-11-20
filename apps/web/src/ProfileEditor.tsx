import { useCallback, useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { ConfirmBar, useAction } from "./ui";

type Tiers = { sd: boolean; hd720: boolean; hd1080: boolean; uhd: boolean };
type Profile = {
  id: number; name: string; tiers: Tiers; remux: boolean; upgrades: boolean; cutoff: number;
  cutoffOptions: { id: number; name: string; tier: keyof Tiers | null; remux: boolean; allowed: boolean }[]; language: string; languageEditable: boolean; reason?: string;
};
type Service = { service: string; kind: string; profiles?: Profile[]; error?: string };
type Data = { tiers: Record<keyof Tiers, string>; languages: { key: string; label: string }[]; services: Service[] };
type Draft = { tiers: Tiers; remux: boolean; upgrades: boolean; cutoff: number; language: string };

const draftOf = (p: Profile): Draft => ({ tiers: { ...p.tiers }, remux: p.remux, upgrades: p.upgrades, cutoff: p.cutoff, language: p.language });
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

/** Qualität & Quellen → Medienprofile → Profile bearbeiten (Phase 7 Paket 7.3). */
export function ProfileEditor() {
  const [data, setData] = useState<Data | null>(null),
    [open, setOpen] = useState<string | null>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [confirm, setConfirm] = useState(false);
  const { busy, error, notice, setError, run } = useAction();
  const load = useCallback(async () => {
    try { setData(await get<Data>("/api/quality/profiles")); } catch (e) { setError((e as Error).message); }
  }, [setError]);
  useEffect(() => { void load(); }, [load]);
  if (!data) return error ? <p className="error" role="alert">{error}</p> : null;
  const langLabel = (k: string) => data.languages.find((l) => l.key === k)?.label || "andere Sprache";
  return (
    <div className="tile profile-editor">
      <h3>Profile bearbeiten</h3>
      <p className="muted">
        Welche Auflösungen ein Profil laden darf, ob Remux (unkomprimierte Blu-ray, sehr groß) erlaubt ist, bis wohin Radarr bzw.
        Sonarr eine Datei verbessern und in welcher Sprache. Die internen StackPilot-Profile für Größenregeln erscheinen hier nicht.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {data.services.map((sv) => (
        <section key={sv.service} aria-label={`Profile ${sv.service}`}>
          <h4>{sv.kind === "movie" ? "Filme" : "Serien"} <span className="muted">({sv.service})</span></h4>
          {sv.error && <p className="error">{sv.error}</p>}
          <ul className="profile-editor-list">
            {(sv.profiles || []).map((p) => {
              const key = `${sv.service}:${p.id}`, isOpen = open === key, d = isOpen && draft ? draft : draftOf(p);
              const summary = [
                (Object.keys(data.tiers) as (keyof Tiers)[]).filter((t) => p.tiers[t]).map((t) => data.tiers[t]).join(", ") || "keine Auflösung",
                p.remux ? "mit Remux" : null, p.upgrades ? `verbessert bis ${p.cutoffOptions.find((o) => o.id === p.cutoff)?.name || "Ziel"}` : "keine Upgrades",
                `Sprache: ${langLabel(p.language)}`,
              ].filter(Boolean).join(" · ");
              const valid = p.cutoffOptions.filter((o) => (o.tier ? d.tiers[o.tier] && (!o.remux || d.remux) : o.allowed));
              const cutoff = valid.some((o) => o.id === d.cutoff) ? d.cutoff : valid.at(-1)?.id ?? d.cutoff;
              const set = (patch: Partial<Draft>) => { setDraft({ ...d, ...patch }); setConfirm(false); };
              return (
                <li key={key}>
                  <button className="series-monitoring-row" aria-expanded={isOpen}
                    onClick={() => { setOpen(isOpen ? null : key); setDraft(isOpen ? null : draftOf(p)); setConfirm(false); }}>
                    <b>{p.name}</b><span className="muted">{summary}</span>
                  </button>
                  {isOpen && (
                    <div className="profile-editor-form">
                      <fieldset>
                        <legend>Erlaubte Auflösungen</legend>
                        {(Object.keys(data.tiers) as (keyof Tiers)[]).map((t) => (
                          <label key={t}><input type="checkbox" checked={d.tiers[t]} disabled={!!busy}
                            onChange={(e) => set({ tiers: { ...d.tiers, [t]: e.target.checked } })} /> {data.tiers[t]}</label>
                        ))}
                        <label><input type="checkbox" checked={d.remux} disabled={!!busy} onChange={(e) => set({ remux: e.target.checked })} /> Remux erlauben (sehr große Dateien)</label>
                      </fieldset>
                      <label><input type="checkbox" checked={d.upgrades} disabled={!!busy} onChange={(e) => set({ upgrades: e.target.checked })} /> Vorhandene Dateien später verbessern (Upgrades)</label>
                      {d.upgrades && (
                        <label className="person-field">Verbessern bis{" "}
                          <select value={cutoff} disabled={!!busy} onChange={(e) => set({ cutoff: Number(e.target.value) })}>
                            {valid.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                          </select>
                          <span className="muted"> Danach lädt {sv.service} keine bessere Fassung mehr.</span>
                        </label>
                      )}
                      <label className="person-field">Sprache{" "}
                        <select value={d.language} disabled={!!busy || !p.languageEditable} onChange={(e) => set({ language: e.target.value })}>
                          {!data.languages.some((l) => l.key === d.language) && <option value={d.language}>andere Sprache (unverändert)</option>}
                          {data.languages.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                        </select>
                      </label>
                      <p className="muted">
                        {p.reason || (d.language === "any" ? "Jede Sprache wird geladen."
                          : d.language === "original" ? "Nur Releases in der Originalsprache des Titels."
                          : d.language === "German" ? "Nur Releases mit deutscher Tonspur (auch zweisprachige wie „German DL“)."
                          : d.language === "English" ? "Nur Releases mit englischer Tonspur."
                          : "Sprache bleibt wie in der App eingestellt.")}
                      </p>
                      {!Object.values(d.tiers).some(Boolean) && <p className="warning">Mindestens eine Auflösung erlauben.</p>}
                      {!confirm ? (
                        <span className="couchdeck-actions">
                          <button className="primary" disabled={!!busy || same(d, draftOf(p)) || !Object.values(d.tiers).some(Boolean)} onClick={() => setConfirm(true)}>Speichern …</button>
                          <button disabled={!!busy} onClick={() => { setOpen(null); setDraft(null); }}>Schließen</button>
                        </span>
                      ) : (
                        <ConfirmBar label={`Profil ${p.name} speichern`} busy={busy === key} busyLabel="Wird gespeichert …" onCancel={() => setConfirm(false)}
                          onOk={() => run(key, async () => {
                            await action<Profile>("/api/quality/profiles", { service: sv.service, profileId: p.id, ...d, cutoff, confirmation: "OK" });
                            setConfirm(false); setOpen(null); setDraft(null); await load();
                            return `Profil „${p.name}“ in ${sv.service} gespeichert.`;
                          })}>
                          <p>
                            „{p.name}“ in {sv.service} ändern? Das gilt für alle Titel mit diesem Profil: künftige Suchen und
                            {d.upgrades ? " Upgrades" : " (ohne Upgrades)"} richten sich danach. Vorhandene Dateien bleiben liegen.
                          </p>
                        </ConfirmBar>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
