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
type YouTubeStatus = {
  mode: "auto" | "profile" | "shared";
  profileId: string | null;
  profiles: number;
  poolIds: string[];
  active: { name: string; position: number } | null;
};
type Data = { profiles: Profile[]; youtube: { program: boolean; status: YouTubeStatus | null } };

/**
 * VPN je Dienst wählen (qBittorrent über Gluetun, YouTube in Couchdeck) und die
 * WireGuard-Configs verwalten.
 */
export function VpnProfiles() {
  const [data, setData] = useState<Data | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [confirmRemove, setConfirmRemove] = useState<Profile | null>(null),
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
  async function run(label: string, fn: () => Promise<string>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      setNotice(await fn());
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    await run("import", async () => {
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
      if (failed.length) setError(failed.join(" · "));
      return done.length ? `Importiert: ${done.join(", ")}` : "";
    });
  }
  const profiles = data?.profiles || [];
  const qbit = profiles.find((p) => p.qbittorrent);
  const free = profiles.filter((p) => !p.qbittorrent);
  const yt = data?.youtube.status;
  const ytValue = !yt ? "auto" : yt.mode === "profile" && yt.profileId ? `p:${yt.profileId}` : yt.mode;
  const usedBy = (p: Profile) =>
    p.qbittorrent ? "qBittorrent" : yt && yt.mode !== "shared" && yt.poolIds.includes(p.id) ? "YouTube" : "frei";
  return (
    <>
      <div className="tile vpn-profiles">
        <h2>VPN je Dienst</h2>
        <p>
          Wähle für jeden Dienst, über welche WireGuard-Config er ins Internet geht. Eine Config kann immer nur ein
          Tunnel gleichzeitig nutzen – deshalb steht die Config von qBittorrent für YouTube nicht zur Auswahl.
        </p>
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="success" role="status">{notice}</p>}
        {!data && !error && <p className="muted">Wird geladen …</p>}
        {data && (
          <div className="vpn-services">
            <div className="vpn-service">
              <label htmlFor="vpn-qbit">
                <b>qBittorrent</b>
                <span className="muted">Downloads über Gluetun, mit Ausfallsperre</span>
              </label>
              {qbit ? (
                <select id="vpn-qbit" value={switchTo?.id || qbit.id} disabled={!!busy}
                  onChange={(e) => setSwitchTo(e.target.value === qbit.id ? null : profiles.find((p) => p.id === e.target.value) || null)}>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              ) : (
                <span className="muted">qBittorrent nutzt kein VPN.</span>
              )}
              {switchTo && qbit && (
                <div className="vpn-service-confirm notice" role="dialog" aria-label="VPN für qBittorrent umstellen">
                  <p>
                    qBittorrent auf <b>{switchTo.name}</b> umstellen? Downloads ruhen dafür etwa 30 Sekunden bis 2 Minuten.
                    StackPilot prüft Mullvad und die Ausfallsperre; bei einem Fehler bleibt {qbit.name} aktiv.
                  </p>
                  <div className="service-update-actions">
                    <button className="primary" disabled={!!busy} onClick={() => void run("switch", async () => {
                      await action("/api/vpn/profiles/qbittorrent", { profileId: switchTo.id, confirmation: "OK" });
                      setSwitchTo(null);
                      return `qBittorrent nutzt jetzt ${switchTo.name}. Mullvad-Ausgang und Ausfallsperre sind geprüft.`;
                    })}>{busy === "switch" ? "Wird umgestellt und geprüft …" : "OK"}</button>
                    <button disabled={!!busy} onClick={() => setSwitchTo(null)}>Abbrechen</button>
                  </div>
                </div>
              )}
            </div>
            <div className="vpn-service">
              <label htmlFor="vpn-yt">
                <b>YouTube in Couchdeck</b>
                <span className="muted">Nur wenn YouTube die eigenen Adressen sperrt („Über VPN versuchen“)</span>
              </label>
              <select id="vpn-yt" value={ytValue} disabled={!!busy || !qbit}
                onChange={(e) => {
                  const v = e.target.value;
                  const body = v.startsWith("p:") ? { mode: "profile", profileId: v.slice(2) } : { mode: v };
                  void run("youtube", async () => {
                    await action("/api/vpn/youtube", body);
                    return "YouTube-VPN gespeichert. Gilt ab dem nächsten Abruf.";
                  });
                }}>
                <option value="auto">Automatisch: alle freien Configs ({free.length}), wechselt bei Sperre</option>
                {free.map((p) => <option key={p.id} value={`p:${p.id}`}>Nur {p.name}</option>)}
                {qbit && <option value="" disabled>{qbit.name} (nutzt qBittorrent)</option>}
                <option value="shared">qBittorrent-Tunnel mitnutzen</option>
              </select>
              <p className="muted">
                {!qbit
                  ? "Ohne VPN im Stack gibt es keinen VPN-Weg für YouTube."
                  : yt?.mode === "shared" || !free.length
                    ? "YouTube nutzt den Tunnel von qBittorrent mit (über den Prüfcontainer)."
                    : !data.youtube.program
                      ? "Für den eigenen YouTube-Tunnel fehlt das Programm wireproxy (kommt mit dem StackPilot-Update)."
                      : yt?.active
                        ? `Eigener Tunnel aktiv: ${yt.active.name}.`
                        : `Eigener Tunnel mit ${yt?.profiles ?? 0} Config${yt?.profiles === 1 ? "" : "s"}, startet bei Bedarf.`}
              </p>
            </div>
          </div>
        )}
      </div>
      <div className="tile vpn-profiles">
        <h2>WireGuard-Configs</h2>
        {data && (
          <ul className="vpn-profile-list">
            {profiles.map((p) => (
              <li key={p.id}>
                <span className="vpn-profile-name">
                  <b>{p.name}</b>
                  <span className="muted">{p.endpoint}</span>
                </span>
                <span className={"badge " + (p.qbittorrent ? "badge-qbit" : "badge-yt")}>{usedBy(p)}</span>
                {!p.qbittorrent &&
                  (confirmRemove?.id === p.id ? (
                    <span className="vpn-profile-confirm">
                      <span className="muted">Config entfernen?</span>
                      <button className="danger" disabled={!!busy} onClick={() => void run(p.id, async () => {
                        await action("/api/vpn/profiles/remove", { id: p.id });
                        setConfirmRemove(null);
                        return `Entfernt: ${p.name}`;
                      })}>{busy === p.id ? "Wird entfernt …" : "OK"}</button>
                      <button disabled={!!busy} onClick={() => setConfirmRemove(null)}>Abbrechen</button>
                    </span>
                  ) : (
                    <button disabled={!!busy} onClick={() => setConfirmRemove(p)}>Entfernen</button>
                  ))}
              </li>
            ))}
            {!profiles.length && <li className="muted">Noch keine Configs.</li>}
          </ul>
        )}
        <label className="vpn-profile-import">
          WireGuard-Dateien importieren (.conf, mehrere auf einmal möglich)
          <input type="file" accept=".conf,text/plain" multiple disabled={!!busy}
            onChange={(e) => { void importFiles(e.target.files); e.target.value = ""; }} />
        </label>
        {busy === "import" && <p role="status">Import läuft …</p>}
        <p className="muted">
          Erstelle die Dateien im Mullvad-Konto (WireGuard-Konfiguration, Linux), gern für verschiedene Länder oder
          Städte. Die privaten Schlüssel werden verschlüsselt gespeichert und nicht angezeigt.
        </p>
      </div>
    </>
  );
}
