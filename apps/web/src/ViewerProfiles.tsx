import { useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";

type Profile = { id: string; name: string; folders: string[] };
export type Profiles = {
  ready: boolean;
  profiles: Profile[];
  libraries: { id: string; name: string; available: boolean }[];
  pending: { username: string; profileId: string | null } | null;
};

const endpoint = "/api/viewer-profiles";
type ProfileAction =
  | { action: "create"; name: string; folders: string[] }
  | { action: "delete"; profileId: string }
  | { action: "assign"; username: string; profileId: string | null };

export function ViewerProfiles({ viewers, onChange }: {
  viewers: { username: string; active: boolean; profileId: string | null }[];
  onChange: () => Promise<void>;
}) {
  const [data, setData] = useState<Profiles | null>(null);
  const [name, setName] = useState("");
  const [folders, setFolders] = useState<string[]>([]);
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function load() {
    setError("");
    try {
      setData(await get<Profiles>(endpoint));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function save(body: ProfileAction) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      setData(await action<Profiles>(endpoint, body));
      if (body.action === "create") {
        setName("");
        setFolders([]);
      } else if (body.action === "assign") {
        setMessage("Zuschauerprofil gespeichert. In offenen Jellyfin-Apps bei Bedarf die Bibliotheken neu laden.");
        await onChange();
      }
    } catch (e) {
      setError((e as Error).message);
      try { setData(await get<Profiles>(endpoint)); } catch { /* retain original error */ }
    } finally {
      setBusy(false);
    }
  }
  return <details onToggle={(event) => { if (event.currentTarget.open) void load(); }}>
    <summary>Zuschauerprofile</summary>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {data?.ready === false && <p>Zuerst die Bibliotheksfreigabe für Jellyfin einrichten.</p>}
    {data?.ready && <>
      <p>Ein Profil legt fest, welche Jellyfin-Bibliotheken ein Zuschauer sehen kann.</p>
      {data.pending && <p>Unterbrochene Profilzuweisung für „{data.pending.username}“ zuerst fortsetzen.</p>}
      <form onSubmit={(event) => { event.preventDefault(); void save({ action: "create", name, folders }); }}>
        <fieldset disabled={busy || !!data.pending}>
          <legend>Neues Profil</legend>
          <label>Profilname <input value={name} maxLength={64} required onChange={(e) => setName(e.target.value)} /></label>
          {data.libraries.filter((library) => library.available).map((library) => <label key={library.id}>
            <input type="checkbox" checked={folders.includes(library.id)}
              onChange={(event) => setFolders(event.target.checked ? [...folders, library.id] : folders.filter((id) => id !== library.id))} />
            {library.name}
          </label>)}
          <button disabled={!name.trim() || !folders.length}>Profil erstellen</button>
        </fieldset>
      </form>
      <ul className="remote-setup-viewers">
        {viewers.filter((viewer) => viewer.active).map((viewer) => {
          const pending = data.pending?.username === viewer.username ? data.pending : null;
          const chosen = Object.hasOwn(selection, viewer.username) ? selection[viewer.username] : viewer.profileId;
          const value = (pending ? pending.profileId : chosen) ?? "";
          const options = data.profiles.filter((profile) =>
            profile.folders.every((id) => data.libraries.some((library) => library.id === id && library.available)) || profile.id === value);
          return <li key={viewer.username}>
            <label>{viewer.username}{" "}
              <select value={value} disabled={busy || !!data.pending}
                onChange={(event) => setSelection({ ...selection, [viewer.username]: event.target.value })}>
                <option value="">Standardfreigabe</option>
                {options.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
            </label>
            <button disabled={busy || (!!data.pending && !pending) || (!pending && value === (viewer.profileId || ""))}
              onClick={() => void save({ action: "assign", username: viewer.username, profileId: value || null })}>
              {pending ? "Zuweisung fortsetzen" : "Profil zuweisen"}
            </button>
          </li>;
        })}
      </ul>
      {data.profiles.length > 0 && <ul className="remote-setup-viewers">{data.profiles.map((profile) => <li key={profile.id}>
        <b>{profile.name}</b>{" "}
        {profile.folders.map((id) => data.libraries.find((library) => library.id === id)?.name || "Bibliothek entfernt").join(", ")}
        {!viewers.some((viewer) => viewer.profileId === profile.id) && <button disabled={busy || !!data.pending}
          onClick={() => void save({ action: "delete", profileId: profile.id })}>Profil löschen</button>}
      </li>)}</ul>}
    </>}
  </details>;
}
