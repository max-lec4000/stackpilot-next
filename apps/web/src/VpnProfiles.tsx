import { useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";

type Profile = {
  id: string;
  name: string;
  endpoint: string;
  address: string;
  addedAt: string | null;
  qbittorrent: boolean;
  youtube: boolean;
};
type Data = {
  profiles: Profile[];
  youtube: { program: boolean; status: { profiles: number; active: { name: string; position: number } | null } | null };
};

/** Alle WireGuard-Profile: eines für qBittorrent (Gluetun), die übrigen als eigener YouTube-Tunnel. */
export function VpnProfiles() {
  const [data, setData] = useState<Data | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [confirm, setConfirm] = useState<Profile | null>(null),
    [switchTo, setSwitchTo] = useState<Profile | null>(null);
  async function load() {
    try {
      setData(await get<Data>("/api/vpn/profiles"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy("import");
    setError("");
    setNotice("");
    const done: string[] = [],
      failed: string[] = [];
    for (const file of Array.from(files)) {
      try {
        if (file.size > 6000) throw new Error("Datei zu groß (höchstens 6 KB).");
        await action("/api/vpn/import", { config: await file.text(), name: file.name });
        done.push(file.name);
      } catch (e) {
        failed.push(`${file.name}: ${(e as Error).message}`);
      }
    }
    if (done.length) setNotice(`Importiert: ${done.join(", ")}`);
    if (failed.length) setError(failed.join(" · "));
    setBusy("");
    await load();
  }
  async function remove(p: Profile) {
    setBusy(p.id);
    setError("");
    setNotice("");
    try {
      await action("/api/vpn/profiles/remove", { id: p.id });
      setNotice(`Entfernt: ${p.name}`);
      setConfirm(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function useForQbit(p: Profile) {
    setBusy("switch");
    setError("");
    setNotice("");
    try {
      await action("/api/vpn/profiles/qbittorrent", { profileId: p.id, confirmation: "OK" });
      setNotice(`qBittorrent nutzt jetzt ${p.name}. Mullvad-Ausgang und Ausfallsperre sind geprüft.`);
      setSwitchTo(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const qbit = data?.profiles.find((p) => p.qbittorrent);
  const yt = data?.profiles.filter((p) => p.youtube) || [];
  const active = data?.youtube.status?.active;
  return (
    <div className="tile vpn-profiles">
      <h2>VPN-Profile</h2>
      <p>
        Mullvad-WireGuard-Konfigurationen. Eine nutzt qBittorrent über Gluetun, alle übrigen bilden einen
        eigenen Tunnel nur für YouTube in Couchdeck: Sperrt YouTube eine Adresse, wechselt Couchdeck zum
        nächsten Profil. Downloads laufen davon unberührt weiter. Jede Konfiguration nur einmal verwenden – zwei
        gleichzeitige Tunnel mit demselben Schlüssel stören sich.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {!data && !error && <p className="muted">Wird geladen …</p>}
      {data && (
        <ul className="vpn-profile-list">
          {data.profiles.map((p) => (
            <li key={p.id}>
              <span className="vpn-profile-name">
                <b>{p.name}</b>
                <span className="muted">{p.endpoint}</span>
              </span>
              <span className={"badge " + (p.qbittorrent ? "badge-qbit" : "badge-yt")}>
                {p.qbittorrent ? "qBittorrent" : active?.name === p.name ? "YouTube · aktiv" : "YouTube"}
              </span>
              {!p.qbittorrent && qbit && switchTo?.id !== p.id && confirm?.id !== p.id && (
                <button disabled={!!busy} onClick={() => setSwitchTo(p)}>Für qBittorrent verwenden</button>
              )}
              {switchTo?.id === p.id && (
                <span className="vpn-profile-confirm">
                  <span className="muted">Downloads stoppen dafür 1–2 Minuten; bei einem Fehler bleibt {qbit?.name} aktiv.</span>
                  <button className="primary" disabled={!!busy} onClick={() => void useForQbit(p)}>
                    {busy === "switch" ? "Wird umgestellt und geprüft …" : "Umstellen"}
                  </button>
                  <button disabled={!!busy} onClick={() => setSwitchTo(null)}>Abbrechen</button>
                </span>
              )}
              {!p.qbittorrent && switchTo?.id !== p.id &&
                (confirm?.id === p.id ? (
                  <span className="vpn-profile-confirm">
                    <button className="danger" disabled={!!busy} onClick={() => void remove(p)}>
                      {busy === p.id ? "Wird entfernt …" : "Ja, entfernen"}
                    </button>
                    <button disabled={!!busy} onClick={() => setConfirm(null)}>Abbrechen</button>
                  </span>
                ) : (
                  <button disabled={!!busy} onClick={() => setConfirm(p)}>Entfernen</button>
                ))}
            </li>
          ))}
          {!data.profiles.length && <li className="muted">Noch keine Profile.</li>}
        </ul>
      )}
      {data && (
        <p className="muted">
          {!qbit
            ? "qBittorrent nutzt kein VPN-Profil."
            : !yt.length
              ? "Kein eigenes YouTube-Profil: Couchdeck nutzt für „Über VPN versuchen“ den qBittorrent-Tunnel mit. Für einen eigenen Tunnel eine weitere Konfiguration importieren."
              : !data.youtube.program
                ? "Für den eigenen YouTube-Tunnel fehlt das Programm wireproxy. Es kommt mit dem nächsten StackPilot-Update."
                : `YouTube-Tunnel: ${yt.length} Profil${yt.length === 1 ? "" : "e"}${active ? `, gerade aktiv: ${active.name}` : ", startet bei Bedarf"}.`}
        </p>
      )}
      <label className="vpn-profile-import">
        Weitere WireGuard-Dateien importieren (.conf, mehrere möglich)
        <input type="file" accept=".conf,text/plain" multiple disabled={!!busy}
          onChange={(e) => { void importFiles(e.target.files); e.target.value = ""; }} />
      </label>
      {busy === "import" && <p role="status">Import läuft …</p>}
      <p className="muted">
        Die privaten Schlüssel werden verschlüsselt gespeichert und nicht angezeigt. Erstelle die Dateien im
        Mullvad-Konto unter WireGuard-Konfiguration (Linux), gern für verschiedene Länder oder Städte.
      </p>
    </div>
  );
}
