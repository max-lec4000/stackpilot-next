import { useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { ConfirmBar, SectionHeading, StatusBadge, useAction } from "./ui";

type Count = { total: number; withProfile: number; stackpilot: number } | null;
type State = {
  profile: { id: number; languages: string[] } | null;
  otherProfiles: string[];
  defaults: { series: boolean; movies: boolean; otherSeries: boolean; otherMovies: boolean };
  providers: string[];
  otherProviders: string[];
  opensubtitles: boolean;
  series: Count;
  movies: Count;
  assigned?: { series: number; movies: number };
  options: { languages: [string, string][]; providers: [string, string, boolean][] };
};

/** Qualität & Quellen → Untertitel (Phase 7.3a): Bazarr in einfachen Worten einstellen. */
export function SubtitleSettings() {
  const [data, setData] = useState<State | null>(null),
    [languages, setLanguages] = useState<string[]>([]),
    [providers, setProviders] = useState<string[]>([]),
    [existing, setExisting] = useState(true),
    [user, setUser] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(false);
  const { busy, error, notice, setError, run } = useAction();
  const apply = (s: State) => {
    setData(s);
    setLanguages(s.profile?.languages.length ? s.profile.languages : ["de", "en"]);
    setProviders(s.providers.length ? s.providers : ["embeddedsubtitles", "gestdown", "yifysubtitles"]);
  };
  useEffect(() => {
    get<State>("/api/subtitles").then(apply).catch((e) => setError((e as Error).message));
  }, [setError]);
  if (!data) return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Wird geladen …</p>;

  const name = (code: string) => data.options.languages.find(([c]) => c === code)?.[1] || code;
  const toggle = (list: string[], v: string, on: boolean) => (on ? [...list.filter((x) => x !== v), v] : list.filter((x) => x !== v));
  const active = !!data.profile && data.defaults.series && data.defaults.movies && data.providers.length > 0;
  const missing = (c: Count) => (c ? c.total - c.withProfile : 0);
  return (
    <section className="managed-services subtitles" aria-label="Untertitel">
      <SectionHeading
        title="Untertitel"
        description="Bazarr sucht passende Untertitel zu Filmen und Serien und legt sie neben die Videodatei. Jellyfin zeigt sie automatisch an."
        actions={<StatusBadge tone={active ? "success" : "warning"}>{active ? "Aktiv" : "Noch nicht eingerichtet"}</StatusBadge>}
      />
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {data.profile && (
        <p className="muted">
          Jetzt: {data.profile.languages.map(name).join(", ") || "keine Sprache"}
          {data.series && ` · Serien mit Untertitelprofil ${data.series.stackpilot}/${data.series.total}`}
          {data.movies && ` · Filme ${data.movies.stackpilot}/${data.movies.total}`}
        </p>
      )}
      <form className="subtitle-form" onSubmit={(e) => { e.preventDefault(); setConfirm(true); }}>
        <fieldset disabled={!!busy}>
          <legend>Sprachen</legend>
          <p className="muted">Für jede gewählte Sprache sucht Bazarr einen eigenen Untertitel.</p>
          <div className="subtitle-choices">
            {data.options.languages.map(([code, label]) => (
              <label key={code} className="person-check">
                <input type="checkbox" checked={languages.includes(code)}
                  onChange={(e) => { setLanguages(toggle(languages, code, e.target.checked)); setConfirm(false); }} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset disabled={!!busy}>
          <legend>Anbieter</legend>
          <div className="subtitle-choices">
            {data.options.providers.map(([id, label]) => (
              <label key={id} className="person-check">
                <input type="checkbox" checked={providers.includes(id)}
                  onChange={(e) => { setProviders(toggle(providers, id, e.target.checked)); setConfirm(false); }} />
                {label}
              </label>
            ))}
          </div>
          {providers.includes("opensubtitlescom") && (
            <div className="subtitle-login">
              <p className="muted">
                OpenSubtitles.com hat die meisten deutschen Untertitel. Konto kostenlos auf opensubtitles.com anlegen und hier
                eintragen{data.opensubtitles ? " (ein Konto ist schon hinterlegt – leer lassen, um es zu behalten)" : ""}. Bazarr
                speichert es; StackPilot zeigt es nicht wieder an.
              </p>
              <label>Benutzername <input value={user} autoComplete="off" onChange={(e) => setUser(e.target.value)} /></label>
              <label>Passwort <input type="password" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} /></label>
            </div>
          )}
          {!!data.otherProviders.length && <p className="muted">Zusätzlich in Bazarr aktiv (bleibt unverändert): {data.otherProviders.join(", ")}</p>}
        </fieldset>
        <fieldset disabled={!!busy}>
          <legend>Gilt für</legend>
          <p>Alle neuen Filme und Serien bekommen automatisch diese Sprachen.</p>
          {(missing(data.series) > 0 || missing(data.movies) > 0 || !data.profile) && (
            <label className="person-check">
              <input type="checkbox" checked={existing} onChange={(e) => setExisting(e.target.checked)} />
              Auch für vorhandene Filme und Serien ohne Untertitelprofil
              {(data.series || data.movies) && ` (${missing(data.series)} Serien, ${missing(data.movies)} Filme)`}
            </label>
          )}
          {(data.defaults.otherSeries || data.defaults.otherMovies || data.otherProfiles.length > 0) && (
            <p className="muted">Andere Sprachprofile in Bazarr ({data.otherProfiles.join(", ") || "Standard"}) bleiben erhalten; der Standard für neue Titel wechselt auf „StackPilot“.</p>
          )}
        </fieldset>
        {!confirm && <button className="primary" disabled={!!busy || !languages.length || !providers.length}>Speichern</button>}
        {confirm && (
          <ConfirmBar label="Untertitel einrichten" busy={busy === "save"} busyLabel="Wird gespeichert …" onCancel={() => setConfirm(false)}
            onOk={() => run("save", async () => {
              const next = await action<State>("/api/subtitles", {
                languages, providers, applyExisting: existing, confirmation: "OK",
                ...(providers.includes("opensubtitlescom") && (user || password) ? { opensubtitles: { username: user, password } } : {}),
              });
              setPassword(""); setUser(""); setConfirm(false); apply(next);
              const a = next.assigned;
              return "In Bazarr gespeichert und bestätigt." + (a && (a.series || a.movies) ? ` Profil für ${a.series} Serien und ${a.movies} Filme gesetzt.` : "");
            })}>
            <p>
              Untertitel in {languages.map(name).join(", ")} über {providers.length} {providers.length === 1 ? "Anbieter" : "Anbieter"} suchen – für
              neue {existing ? "und vorhandene " : ""}Filme und Serien. Bazarr beginnt damit bei seinem nächsten Suchlauf.
            </p>
          </ConfirmBar>
        )}
      </form>
    </section>
  );
}
