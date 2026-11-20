import { useCallback, useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { ConfirmBar, Disclosure, SectionHeading, StatusBadge, useAction } from "./ui";
import { viewHref } from "./navigation";

type Viewer = { username: string; name: string; active: boolean; mfa: boolean; lastLogin: string | null; profileId: string | null; hasPasskey: boolean; passkeyPending: boolean };
type Invitation = { username: string; password: string; loginUrl: string };
type ViewerList = { loginUrl: string; viewers: Viewer[]; invitation?: Invitation; recoveryEnabled?: boolean; loginImproved?: boolean; passwordChoice?: boolean; addPasskeyReady?: boolean };
type Profiles = {
  ready: boolean;
  profiles: { id: string; name: string; folders: string[] }[];
  libraries: { id: string; name: string; available: boolean }[];
  pending: { username: string; profileId: string | null } | null;
};
type RequestRow = { username: string; editable: boolean; reason?: string | null; needsAccount?: boolean; userId: number | null; permissions: number | null; movieAutoApprove: boolean; tvAutoApprove: boolean };
type Setup = { status: string };

const lastSeen = (iso: string | null) => {
  if (!iso) return "noch nie angemeldet";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : "zuletzt " + d.toLocaleDateString("de-DE", { dateStyle: "medium" });
};

/**
 * Personen (Phase 7.1a): je Zuschauer eine Karte mit Anmeldestatus, Bibliotheken,
 * Freigabepflicht für Anfragen und den Aktionen. Einrichtung des Fernzugriffs bleibt unter
 * System → Zugriff & Netzwerk.
 */
export function PeoplePanel() {
  const [setup, setSetup] = useState<Setup | null>(null),
    [list, setList] = useState<ViewerList | null>(null),
    [profiles, setProfiles] = useState<Profiles | null>(null),
    [requests, setRequests] = useState<RequestRow[] | null>(null),
    [invitation, setInvitation] = useState<Invitation | null>(null),
    [name, setName] = useState(""),
    [confirm, setConfirm] = useState<{ act: "reset" | "remove"; username: string } | null>(null);
  const { busy, error, notice, setError, setNotice, run } = useAction();

  const loadAll = useCallback(async () => {
    const s = await get<Setup>("/api/remote-setup").catch(() => null);
    setSetup(s);
    if (s?.status !== "completed") return;
    const [v, p, r] = await Promise.allSettled([
      get<ViewerList>("/api/viewers"),
      get<Profiles>("/api/viewer-profiles"),
      get<{ viewers: RequestRow[] }>("/api/viewer-requests"),
    ]);
    if (v.status === "fulfilled") setList(v.value); else setError((v.reason as Error).message);
    if (p.status === "fulfilled") setProfiles(p.value);
    if (r.status === "fulfilled") setRequests(r.value.viewers);
  }, [setError]);
  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function viewerAction(act: string, username: string, extra: Record<string, unknown> = {}) {
    setInvitation(null);
    return run(act + ":" + username, async () => {
      const next = await action<ViewerList>("/api/viewers/action", { action: act, name: username, ...extra });
      setList(next);
      if (next.invitation) setInvitation(next.invitation);
      setConfirm(null);
      if (act === "invite") setName("");
      return act === "remove" ? `„${username}“ entfernt.` : "";
    });
  }

  if (!setup) return <p className="muted">Wird geladen …</p>;
  if (setup.status !== "completed")
    return (
      <section className="managed-services people" aria-label="Zuschauer">
        <SectionHeading title="Zuschauer" description="Personen, die Jellyfin von unterwegs nutzen dürfen." />
        <p>
          Zuerst den Zugriff von unterwegs einrichten:{" "}
          <a href={viewHref("Verwaltung", "remote")}>System → Zugriff &amp; Netzwerk</a>. Danach lädst du hier Zuschauer ein.
        </p>
      </section>
    );

  const active = (list?.viewers || []).filter((v) => v.active);
  const removed = (list?.viewers || []).filter((v) => !v.active);
  return (
    <section className="managed-services people" aria-label="Zuschauer">
      <SectionHeading
        title="Zuschauer"
        description="Wer Jellyfin von unterwegs nutzen darf – mit eigener Anmeldung und zweitem Faktor, eigenen Bibliotheken und Freigaberegeln für Anfragen."
      />
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}

      <form className="couchdeck-actions people-invite"
        onSubmit={(event) => { event.preventDefault(); if (name.trim()) void viewerAction("invite", name.trim()); }}>
        <label>
          Neuen Zuschauer einladen – Benutzername{" "}
          <input value={name} placeholder="z. B. eltern" pattern="[a-zA-Z][a-zA-Z0-9_\-]{2,31}" disabled={!!busy}
            onChange={(event) => setName(event.target.value)} />
        </label>
        <button className="primary" disabled={!!busy || !name.trim()}>Einladen</button>
      </form>

      {invitation && (
        <div className="remote-setup-invitation" role="status">
          <b>Einladung für „{invitation.username}“ – wird nur jetzt angezeigt.</b>
          <p>
            Schick der Person diese drei Angaben. Beim ersten Anmelden richtet sie ihren zweiten Faktor selbst ein.
            {list?.passwordChoice ? " Danach wählt sie ein eigenes Passwort." : ""}
            {list?.recoveryEnabled ? " Die Wiederherstellungscodes sollte sie an einem sicheren Ort aufbewahren." : ""}
          </p>
          <dl>
            <dt>Adresse</dt><dd><code>{invitation.loginUrl}</code></dd>
            <dt>Benutzername</dt><dd><code>{invitation.username}</code></dd>
            <dt>Startpasswort</dt><dd><code>{invitation.password}</code></dd>
          </dl>
          <button onClick={() => void navigator.clipboard?.writeText(
            `Jellyfin: ${invitation.loginUrl}\nBenutzername: ${invitation.username}\nPasswort: ${invitation.password}`)}>
            Kopieren
          </button>
          <button onClick={() => setInvitation(null)}>Notiert – ausblenden</button>
        </div>
      )}

      {!list && !error && <p className="muted">Zuschauer werden geladen …</p>}
      {list && !active.length && <p className="muted">Noch keine Zuschauer eingeladen.</p>}
      <ul className="people-list">
        {active.map((v) => (
          <PersonCard key={v.username} viewer={v} list={list!} profiles={profiles}
            request={requests?.find((r) => r.username === v.username) || null}
            busy={busy} confirm={confirm?.username === v.username ? confirm.act : null}
            onConfirm={(act) => setConfirm(act ? { act, username: v.username } : null)}
            onAction={(act) => viewerAction(act, v.username, act === "reset" || act === "remove" ? { confirmation: "OK" } : {})}
            onProfile={(profileId) => run("profile:" + v.username, async () => {
              setProfiles(await action<Profiles>("/api/viewer-profiles", { action: "assign", username: v.username, profileId }));
              await loadAll();
              return "Bibliotheken gespeichert. In offenen Jellyfin-Apps bei Bedarf die Bibliotheken neu laden.";
            }).then(async (ok) => { if (!ok) setProfiles(await get<Profiles>("/api/viewer-profiles").catch(() => profiles)); })}
            onRequests={(row) => run("requests:" + v.username, async () => {
              const automatic = row.movieAutoApprove || row.tvAutoApprove;
              await action("/api/viewer-requests", { username: row.username, userId: row.userId,
                previousPermissions: row.permissions, enabled: !automatic, confirmation: "OK" });
              setRequests((await get<{ viewers: RequestRow[] }>("/api/viewer-requests")).viewers);
              return "";
            })}
          />
        ))}
      </ul>
      {!!removed.length && (
        <p className="muted">Entfernt: {removed.map((v) => v.username).join(", ")}</p>
      )}

      <Disclosure title="Bibliotheksprofile">
        <LibraryProfiles initial={profiles} viewers={active} onChange={(p) => setProfiles(p)} />
      </Disclosure>
      {list && (list.loginImproved === false || list.passwordChoice === false || list.addPasskeyReady === false || list.recoveryEnabled === false) && (
        <Disclosure title="Anmeldung der Zuschauer aktualisieren">
          <LoginMaintenance list={list} onChange={setList} />
        </Disclosure>
      )}
      {list?.recoveryEnabled === true && (
        <p className="muted">Zuschauer erhalten Wiederherstellungscodes nach erfolgreicher Anmeldung mit zweitem Faktor.</p>
      )}
    </section>
  );
}

function PersonCard({ viewer: v, list, profiles, request, busy, confirm, onConfirm, onAction, onProfile, onRequests }: {
  viewer: Viewer; list: ViewerList; profiles: Profiles | null; request: RequestRow | null; busy: string;
  confirm: "reset" | "remove" | null; onConfirm: (act: "reset" | "remove" | null) => void;
  onAction: (act: string) => unknown; onProfile: (profileId: string | null) => unknown; onRequests: (row: RequestRow) => unknown;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const pending = profiles?.pending?.username === v.username ? profiles.pending : null;
  const current = (pending ? pending.profileId : v.profileId) ?? "";
  const value = choice ?? current;
  const options = (profiles?.profiles || []).filter((p) =>
    p.folders.every((id) => profiles!.libraries.some((l) => l.id === id && l.available)) || p.id === value);
  const automatic = !!request && (request.movieAutoApprove || request.tvAutoApprove);
  const mixed = !!request && request.movieAutoApprove !== request.tvAutoApprove;
  return (
    <li className="person-card" aria-label={`Zuschauer ${v.username}`}>
      <div className="person-head">
        <b>{v.username}</b>
        <StatusBadge tone={v.mfa ? "success" : "warning"}>{v.mfa ? "Zweiter Faktor eingerichtet" : "Einladung offen"}</StatusBadge>
        {v.hasPasskey && <StatusBadge tone="info">Passkey</StatusBadge>}
        <span className="muted">{lastSeen(v.lastLogin)}</span>
      </div>

      <div className="person-rights">
        {profiles?.ready ? (
          <div className="person-field">
            <label>
              Bibliotheken{" "}
              <select value={value} disabled={!!busy || (!!profiles.pending && !pending)}
                onChange={(e) => setChoice(e.target.value)}>
                <option value="">Standardfreigabe</option>
                {options.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            {(pending || value !== (v.profileId || "")) && (
              <button disabled={!!busy} onClick={() => { void onProfile(value || null); setChoice(null); }}>
                {pending ? "Zuweisung fortsetzen" : "Speichern"}
              </button>
            )}
          </div>
        ) : profiles ? (
          <p className="muted">Bibliotheken: Standardfreigabe (eigene Profile erst nach Einrichtung der Bibliotheksfreigabe).</p>
        ) : null}

        {request && (
          <label className={"switch" + (request.editable ? "" : " disabled")}>
            <input type="checkbox" role="switch" checked={!automatic} disabled={!request.editable || !!busy}
              aria-label={`Freigabe für Anfragen von ${v.username}`} onChange={() => void onRequests(request)} />
            <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
            <span className="switch-text">
              <b>Anfragen brauchen meine Freigabe</b>
              <span>{busy === "requests:" + v.username ? "Wird gespeichert …"
                : !request.editable ? (request.reason || "Kontozuordnung oder Rechte konnten nicht bestätigt werden.")
                : automatic ? (mixed ? `Teilweise automatisch (Filme ${request.movieAutoApprove ? "ja" : "nein"}, Serien ${request.tvAutoApprove ? "ja" : "nein"})`
                  : "Nein – Anfragen laufen sofort los")
                : request.needsAccount ? "Ja · beim Ausschalten wird das Seerr-Konto angelegt"
                : "Ja"}</span>
            </span>
          </label>
        )}
      </div>

      <div className="couchdeck-actions person-actions">
        {list.addPasskeyReady && v.mfa && (
          <>
            {v.passkeyPending && <span className="muted">Passkey-Einrichtung beim nächsten Login im Browser</span>}
            <button disabled={!!busy} onClick={() => void onAction(v.passkeyPending ? "cancel-passkey" : "add-passkey")}>
              {v.passkeyPending ? "Passkey-Einrichtung abbrechen" : "Passkey hinzufügen"}
            </button>
          </>
        )}
        {!confirm && (
          <>
            <button disabled={!!busy} onClick={() => onConfirm("reset")}>Neu einladen</button>
            <button className="danger" disabled={!!busy} onClick={() => onConfirm("remove")}>Entfernen</button>
          </>
        )}
      </div>
      {confirm === "reset" && (
        <ConfirmBar label={`${v.username} neu einladen`} busy={busy === "reset:" + v.username} busyLabel="Wird zurückgesetzt …"
          onCancel={() => onConfirm(null)} onOk={() => onAction("reset")}>
          <p>
            <b>{v.username}</b> neu einladen? Passwort und zweiter Faktor werden zurückgesetzt; du bekommst ein neues
            Startpasswort, und die Person richtet ihren zweiten Faktor beim nächsten Anmelden neu ein.
          </p>
        </ConfirmBar>
      )}
      {confirm === "remove" && (
        <ConfirmBar label={`${v.username} entfernen`} busy={busy === "remove:" + v.username} busyLabel="Wird entfernt …"
          onCancel={() => onConfirm(null)} onOk={() => onAction("remove")}>
          <p>
            <b>{v.username}</b> entfernen? Die Person kann sich danach nicht mehr neu anmelden. Bereits angemeldete
            Jellyfin-Apps (Fernseher, Streamyfin) bleiben angemeldet, bis ihr Gerät abgemeldet wird. Konto und
            Wiedergabeverlauf in Jellyfin bleiben erhalten.
          </p>
        </ConfirmBar>
      )}
    </li>
  );
}

function LibraryProfiles({ initial, viewers, onChange }: { initial: Profiles | null; viewers: Viewer[]; onChange: (p: Profiles) => void }) {
  const [data, setData] = useState<Profiles | null>(initial),
    [name, setName] = useState(""),
    [folders, setFolders] = useState<string[]>([]),
    [remove, setRemove] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  useEffect(() => { setData(initial); }, [initial]);
  const save = (body: Record<string, unknown>) => run("profiles", async () => {
    const next = await action<Profiles>("/api/viewer-profiles", body);
    setData(next); onChange(next); setRemove(null);
    if (body.action === "create") { setName(""); setFolders([]); }
    return "";
  });
  if (!data) return <p className="muted">Wird geladen …</p>;
  if (!data.ready) return <p>Zuerst die Bibliotheksfreigabe für Jellyfin einrichten.</p>;
  return (
    <div className="people-profiles">
      <p>Ein Profil legt fest, welche Jellyfin-Bibliotheken ein Zuschauer sieht. Zuweisen kannst du es oben auf der Karte.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {data.profiles.length > 0 && (
        <ul className="remote-setup-viewers">
          {data.profiles.map((p) => (
            <li key={p.id}>
              <b>{p.name}</b>{" "}
              {p.folders.map((id) => data.libraries.find((l) => l.id === id)?.name || "Bibliothek entfernt").join(", ")}
              {!viewers.some((v) => v.profileId === p.id) && remove !== p.id && (
                <button disabled={!!busy || !!data.pending} onClick={() => setRemove(p.id)}>Profil löschen</button>
              )}
              {remove === p.id && (
                <ConfirmBar label={`Profil ${p.name} löschen`} busy={busy === "profiles"} onCancel={() => setRemove(null)}
                  onOk={() => save({ action: "delete", profileId: p.id })}>
                  <p>Profil <b>{p.name}</b> löschen? Es ist keinem Zuschauer zugewiesen.</p>
                </ConfirmBar>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(event) => { event.preventDefault(); void save({ action: "create", name, folders }); }}>
        <fieldset disabled={!!busy || !!data.pending}>
          <legend>Neues Profil</legend>
          <label>Profilname <input value={name} maxLength={64} required onChange={(e) => setName(e.target.value)} /></label>
          {data.libraries.filter((l) => l.available).map((l) => (
            <label key={l.id}>
              <input type="checkbox" checked={folders.includes(l.id)}
                onChange={(e) => setFolders(e.target.checked ? [...folders, l.id] : folders.filter((id) => id !== l.id))} />
              {l.name}
            </label>
          ))}
          <button disabled={!name.trim() || !folders.length}>Profil erstellen</button>
        </fieldset>
      </form>
    </div>
  );
}

function LoginMaintenance({ list, onChange }: { list: ViewerList; onChange: (l: ViewerList) => void }) {
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();
  const update = (act: "improve-login" | "enable-recovery") => run(act, async () => {
    try {
      onChange(await action<ViewerList>("/api/viewers/action", { action: act, password }));
    } finally {
      setPassword("");
    }
    return "";
  });
  const improve = list.loginImproved === false || list.passwordChoice === false || list.addPasskeyReady === false;
  return (
    <form className="people-login" onSubmit={(e) => { e.preventDefault(); void update(improve ? "improve-login" : "enable-recovery"); }}>
      {improve ? (
        <p>Übernimmt den frisch bestätigten zweiten Faktor für die Jellyfin-Freigabe. Neue Zuschauer können ein eigenes Passwort wählen; bestehende können einen Passkey zusätzlich einrichten.</p>
      ) : (
        <p>Nach der Anmeldung mit zweitem Faktor zeigt Authentik Zuschauern ohne Wiederherstellungscodes einmalig acht Codes an.</p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <label>StackPilot-Administratorpasswort
        <input type="password" autoComplete="current-password" required value={password}
          onChange={(e) => setPassword(e.target.value)} disabled={!!busy} />
      </label>
      <button disabled={!!busy}>{improve ? "Zuschauer-Anmeldung aktualisieren" : "Wiederherstellungscodes aktivieren"}</button>
    </form>
  );
}
