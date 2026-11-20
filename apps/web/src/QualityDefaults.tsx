import { useCallback, useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { ConfirmBar, useAction } from "./ui";

type Profile = { id: number; name: string; allowed: string[]; upgrades: boolean; cutoff: string | null; language: string | null };
type Row = { service: string; kind: string; defaultProfileId?: number | null; serverFound?: boolean; governedBySize?: boolean; profiles?: Profile[]; error?: string };

const languageText = (l: string | null) =>
  !l ? null : l === "Original" ? "Originalsprache" : l === "Any" ? "jede Sprache" : l === "German" ? "Deutsch" : l === "English" ? "Englisch" : l;

/** Qualität & Quellen → Medienprofile: Standardqualität für neue Anfragen (Phase 7.3c). */
export function QualityDefaults() {
  const [rows, setRows] = useState<Row[] | null>(null),
    [choice, setChoice] = useState<Record<string, number>>({}),
    [confirm, setConfirm] = useState<string | null>(null);
  const { busy, error, notice, setError, run } = useAction();
  const load = useCallback(async () => {
    try { setRows((await get<{ services: Row[] }>("/api/quality/defaults")).services); } catch (e) { setError((e as Error).message); }
  }, [setError]);
  useEffect(() => { void load(); }, [load]);
  if (!rows) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Wird geladen …</p>;
  return (
    <div className="tile quality-defaults">
      <h3>Standardqualität für neue Anfragen</h3>
      <p className="muted">
        Welches Qualitätsprofil neue Film- und Serienanfragen bekommen (auch aus Streamyfin und Couchdeck). Einzelne
        Titel änderst du in den Anfrage-Details. Profile selbst bearbeitest du in Radarr bzw. Sonarr.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {rows.map((r) => {
        if (r.error) return <p key={r.service} className="error">{r.error}</p>;
        const profiles = r.profiles || [];
        const current = profiles.find((p) => p.id === r.defaultProfileId);
        const picked = choice[r.service] ?? r.defaultProfileId ?? 0;
        const label = r.kind === "movie" ? "Filme" : "Serien";
        return (
          <section key={r.service} className="quality-default" aria-label={`Standardqualität ${label}`}>
            <h4>{label} <span className="muted">({r.service})</span></h4>
            {!r.serverFound && <p className="notice">Seerr hat keinen verwalteten Standardserver für {r.service}.</p>}
            {r.governedBySize ? (
              <p>
                Gerade gilt die <b>Größenregel</b> für neue Filme (unten „Größe neuer Filmanfragen“). Ohne Größenregel kannst du
                hier ein Profil als Standard wählen.{current ? ` Aktuelles Profil: ${current.name}.` : ""}
              </p>
            ) : (
              <div className="person-field">
                <label>Profil{" "}
                  <select value={picked} disabled={!!busy || !r.serverFound}
                    onChange={(e) => { setChoice({ ...choice, [r.service]: Number(e.target.value) }); setConfirm(null); }}>
                    {!current && <option value={0}>– nicht gesetzt –</option>}
                    {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                {picked !== (r.defaultProfileId ?? 0) && picked > 0 && confirm !== r.service && (
                  <button disabled={!!busy} onClick={() => setConfirm(r.service)}>Als Standard speichern</button>
                )}
              </div>
            )}
            {confirm === r.service && (
              <ConfirmBar label={`Standard für ${label}`} busy={busy === r.service} busyLabel="Wird gespeichert …" onCancel={() => setConfirm(null)}
                onOk={() => run(r.service, async () => {
                  const res = await action<{ profileName: string }>("/api/quality/defaults", { service: r.service, profileId: picked, confirmation: "OK" });
                  setConfirm(null); setChoice({}); await load();
                  return `Neue ${label}anfragen bekommen jetzt „${res.profileName}“.`;
                })}>
                <p>Neue {label}anfragen bekommen ab jetzt „{profiles.find((p) => p.id === picked)?.name}“. Bestehende Titel bleiben, wie sie sind.</p>
              </ConfirmBar>
            )}
            <details>
              <summary>Profile in {r.service} ({profiles.length})</summary>
              <ul className="quality-profile-list">
                {profiles.map((p) => (
                  <li key={p.id}>
                    <b>{p.name}</b>{p.id === r.defaultProfileId && <span className="badge"> Standard</span>}
                    <span className="muted">
                      {" "}{p.allowed.length ? p.allowed.join(", ") : "keine Qualität erlaubt"}
                      {" · "}{p.upgrades ? `verbessert bis ${p.cutoff || "Ziel"}` : "keine Upgrades"}
                      {languageText(p.language) ? ` · Sprache: ${languageText(p.language)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </section>
        );
      })}
    </div>
  );
}
