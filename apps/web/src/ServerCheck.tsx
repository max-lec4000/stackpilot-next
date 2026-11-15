import {
  storageCandidates,
  dataPathForMount,
} from "../../../packages/domain/storage.js";
import { RetirementPanel } from "./RetirementPanel";
import { ReportPanel } from "./ReportPanel";
import { useEffect, useRef, useState } from "react";
export type Inventory = {
  observedAt: string;
  cpuCount: number;
  memoryBytes: number;
  details?: {
    kernel: string;
    architecture: string;
    cpuModel: string | null;
    gpu: string[] | null;
    sockets:
      | {
          protocol: string;
          address: string;
          processes: { name: string; pid: number }[];
        }[]
      | null;
    services: { unit: string; active: string; sub: string }[] | null;
    checks: Record<string, { available: boolean; reason: string | null }>;
  };
  retirement?: {
    containers: {
      id: string;
      name: string;
      component: string;
      state: string;
      ports: string;
      project: string | null;
    }[];
    services: { unit: string; active: string }[];
    note: string;
  };
  host: string;
  release: string;
  docker: { available: boolean; version: string | null; reason: string | null };
  compose: {
    available: boolean;
    version: string | null;
    reason: string | null;
  };
  containerScanComplete: boolean;
  containers: {
    ID: string;
    Names: string;
    Image: string;
    State: string;
    Ports: string;
    component: string | null;
    project?: string | null;
    managed?: boolean;
    mounts?: {
      source: string;
      destination: string;
      type: string;
      writable: boolean;
    }[];
  }[];
  mounts: {
    target: string;
    source: string;
    type: string;
    options: string;
    freeBytes?: number | null;
    totalBytes?: number | null;
  }[];
  listening: string[];
  issues: string[];
  limitations: string[];
};
export type Storage = {
  requested: string;
  exists: boolean;
  existingParent: string;
  resolvedParent: string;
  writable: boolean;
  freeBytes: number;
  totalBytes: number;
  uid: number;
  gid: number;
  mode: string;
  message: string;
  hardlinks: string;
};
export async function get<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.headers.get("content-type")?.includes("application/json"))
    throw new Error(
      "Serverprüfung nicht verfügbar. Starte StackPilot mit npm run dev.",
    );
  if (r.status === 401)
    window.dispatchEvent(new Event("stackpilot:auth-required"));
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Prüfung fehlgeschlagen.");
  return data;
}
export function bytes(n: number) {
  return `${(n / 1024 ** 3).toLocaleString("de-AT", { maximumFractionDigits: 1 })} GiB`;
}
export function ServerCheck({
  value,
  onChange,
}: {
  value: Inventory | null;
  onChange: (v: Inventory | null) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!value && !autoStarted.current) {
      autoStarted.current = true;
      void scan();
    }
  }, []);
  async function scan() {
    setLoading(true);
    setError("");
    onChange(null);
    try {
      onChange(await get<Inventory>("/api/inventory"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <div className="row">
        <h2>Dein Server, wirklich geprüft</h2>
        <button onClick={scan} disabled={loading}>
          {loading ? "Server wird gelesen …" : "Server jetzt prüfen"}
        </button>
      </div>
      <p>
        Die Prüfung startet automatisch, wenn noch keine Serverprüfung vorliegt.
        Sie liest den Rechner aus, auf dem StackPilot gestartet wurde. Sie
        installiert nichts, startet keine Container und verändert keine Dienste
        oder Nutzdaten.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <ReportPanel onInventory={onChange} />
      {value && (
        <>
          <p className="muted">
            Stand: {new Date(value.observedAt).toLocaleString("de-AT")} ·{" "}
            {value.host}
          </p>
          <div className="grid">
            <div className="tile">
              <b>{value.release}</b>
              <p>System erkannt</p>
            </div>
            <div className="tile">
              <b>Docker {value.docker.version || "nicht verfügbar"}</b>
              <p>{value.docker.reason || "Daemon erreichbar"}</p>
            </div>
            <div className="tile">
              <b>Compose {value.compose.version || "nicht verfügbar"}</b>
              <p>{value.compose.reason || "CLI verfügbar"}</p>
            </div>
          </div>
          <details
            className="server-technical"
            onToggle={(e) => setTechnicalOpen(e.currentTarget.open)}
          >
            <summary>
              Technische Diagnose öffnen · Container, Hardware, Ports &
              Altinstallationen
            </summary>
            {technicalOpen && (
              <>
                <h3>Vorhandene Container ({value.containers.length})</h3>
                {!value.containerScanComplete ? (
                  <p className="warning">
                    Docker konnte nicht geprüft werden. Eine leere Liste
                    bedeutet nicht, dass keine Installation existiert.
                  </p>
                ) : value.containers.length === 0 ? (
                  <p>Keine Container im aktiven Docker-Kontext gefunden.</p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Name / Image</th>
                          <th>Zustand</th>
                          <th>Ports</th>
                          <th>Umgang</th>
                        </tr>
                      </thead>
                      <tbody>
                        {value.containers.map((c) => (
                          <tr key={c.ID}>
                            <td>
                              <b>{c.Names}</b>
                              <br />
                              <small>{c.Image}</small>
                              {c.project && (
                                <>
                                  <br />
                                  <small>Compose: {c.project}</small>
                                </>
                              )}
                              {c.mounts?.map((m, i) => (
                                <div key={i}>
                                  <small>
                                    <code>
                                      {m.source} → {m.destination}
                                    </code>{" "}
                                    ({m.writable ? "RW" : "RO"})
                                  </small>
                                </div>
                              ))}
                            </td>
                            <td>{c.State}</td>
                            <td>{c.Ports || "Keine veröffentlicht"}</td>
                            <td>
                              {c.managed || c.project === "stackpilot" ? "StackPilot" : "Nur beobachtet"}
                              {c.component && (
                                <>
                                  <br />
                                  <small>{c.component} erkannt</small>
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="grid">
                  <div className="tile">
                    <b>CPU / RAM</b>
                    <p>
                      {value.details?.cpuModel || "Modell nicht ermittelt"}
                      <br />
                      {value.cpuCount} logische CPUs ·{" "}
                      {bytes(value.memoryBytes)} RAM
                    </p>
                  </div>
                  <div className="tile">
                    <b>GPU-Erkennung</b>
                    <p>
                      {value.details?.gpu?.join("; ") ||
                        "Keine GPU ermittelt oder lspci fehlt. Treiberfunktion ist ungeprüft."}
                    </p>
                  </div>
                </div>
                {value.retirement && (
                  <div className="tile">
                    <h3>Alte Installationen ersetzen</h3>
                    <p>
                      Für diesen Testserver werden alte Medien-Apps nicht
                      benötigt. Die folgenden Treffer sind Kandidaten zum
                      Ablösen, noch keine ausgeführten Änderungen.
                    </p>
                    {value.retirement.containers.map((c) => (
                      <p key={c.id}>
                        <b>{c.name}</b> · {c.state}
                        <br />
                        <small>
                          Vorschlag: Container gezielt stoppen und entfernen;
                          Volumes und Konfigurationsdaten behalten.{" "}
                          {c.project
                            ? `Compose-Projekt: ${c.project}. Autostart muss dort ebenfalls berücksichtigt werden.`
                            : ""}
                        </small>
                      </p>
                    ))}
                    {value.retirement.services.map((s) => (
                      <p key={s.unit}>
                        <b>{s.unit}</b> · {s.active}
                        <br />
                        <small>
                          Vorschlag: Dienst gezielt stoppen und Autostart
                          deaktivieren; Konfigurationsdaten behalten.
                        </small>
                      </p>
                    ))}
                    {!value.retirement.containers.length &&
                      !value.retirement.services.length && (
                        <p>
                          Keine bekannten Medien-Installationen erkannt.
                          Unbekannte Prozesse sind damit nicht ausgeschlossen.
                        </p>
                      )}
                    <p className="muted">{value.retirement.note}</p>
                    <p>
                      Unten kann ein konkreter Ablöseplan erstellt und
                      ausdrücklich bestätigt werden. Dienste außerhalb des
                      ausgewählten Docker-Projekts werden nicht gestoppt.
                    </p>
                  </div>
                )}
                <RetirementPanel inventory={value} onInventory={onChange} />
                <h3>Lauschende TCP-Adressen ({value.listening.length})</h3>
                <p className="muted">
                  Momentaufnahme; keine Garantie, dass ein Port später frei ist.
                  Prozessnamen und UDP-Adressen werden zusätzlich unten erfasst,
                  soweit die Berechtigungen reichen.
                </p>
                <div className="tile">
                  <code>
                    {value.listening.join(", ") || "Keine Adressen ermittelt"}
                  </code>
                </div>
                {value.details?.sockets && (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Protokoll</th>
                          <th>Lokale Adresse</th>
                          <th>Sichtbarer Prozess</th>
                        </tr>
                      </thead>
                      <tbody>
                        {value.details.sockets.map((s, i) => (
                          <tr key={i}>
                            <td>{s.protocol}</td>
                            <td>
                              <code>{s.address}</code>
                            </td>
                            <td>
                              {s.processes.length
                                ? s.processes
                                    .map((p) => `${p.name} (PID ${p.pid})`)
                                    .join(", ")
                                : "Nicht sichtbar / keine Berechtigung"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <h3>Grenzen der Prüfung</h3>
                {value.details &&
                  Object.entries(value.details.checks)
                    .filter(([, c]) => !c.available)
                    .map(([name, c]) => (
                      <p className="muted" key={name}>
                        {name}: {c.reason}. Dieser Teil ist ungeprüft.
                      </p>
                    ))}
                {value.issues.map((i) => (
                  <p className="warning" key={i}>
                    {i}
                  </p>
                ))}
                <ul>
                  {value.limitations.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </>
            )}
          </details>
        </>
      )}
      <p className="muted">
        Die reine Prüfung verändert keine Dienste. Nur eine ausdrücklich
        bestätigte Altstack-Ablösung verändert Container. Echte Installationen
        benötigen einen geprüften Gesamtplan und deine Bestätigung.
      </p>
    </>
  );
}
export function StorageCheck({
  path,
  inventory,
  value,
  onChange,
  onPath,
}: {
  path: string;
  inventory: Inventory | null;
  value: Storage | null;
  onChange: (v: Storage | null) => void;
  onPath: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function check() {
    setBusy(true);
    setError("");
    onChange(null);
    try {
      onChange(
        await get<Storage>(`/api/storage?path=${encodeURIComponent(path)}`),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h3>Speicherort prüfen</h3>
      {inventory && (
        <label>
          Erkannte Mountpunkte – Auswahl als Basis
          <select
            value=""
            onChange={(e) => {
              onChange(null);
              onPath(dataPathForMount(e.target.value));
            }}
          >
            <option value="" disabled>
              Mountpunkt auswählen …
            </option>
            {storageCandidates(inventory.mounts).map((m, i) => (
              <option key={i} value={m.target}>
                {m.target} · {m.type} ·{" "}
                {typeof m.freeBytes === "number"
                  ? `${bytes(m.freeBytes)} frei`
                  : m.source}
              </option>
            ))}
          </select>
        </label>
      )}
      {inventory &&
        storageCandidates(inventory.mounts).length === 1 &&
        storageCandidates(inventory.mounts)[0].target === "/" && (
          <p className="warning">
            Nur das Systemdateisystem ist als geeigneter Speicher erkannt. Für
            kleine Tests ist /srv/stackpilot/data ein Vorschlag; Medien und
            Downloads teilen sich den freien Platz mit Ubuntu und Docker. Es
            werden keine Partitionen oder LVM-Volumes verändert.
          </p>
        )}
      <button disabled={busy} onClick={check}>
        {busy ? "Speicher wird gelesen …" : "Diesen Speicherpfad prüfen"}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {value && value.requested === path && (
        <div className="tile">
          <b>
            {value.writable
              ? "Für aktuellen Prozess beschreibbar"
              : "Keine Schreibberechtigung für aktuellen Prozess"}
          </b>
          <p>{value.message}</p>
          <p>
            Geprüfter bestehender Pfad: <code>{value.existingParent}</code>
            <br />
            Aufgelöst: <code>{value.resolvedParent}</code>
            <br />
            Frei: {bytes(value.freeBytes)} / {bytes(value.totalBytes)}
            <br />
            UID/GID: {value.uid}/{value.gid} · Modus: {value.mode}
          </p>
          <p>{value.hardlinks}</p>
          <small>
            Container-UIDs und ACLs benötigen eine eigene Prüfung. Es wird keine
            Testdatei angelegt.
          </small>
        </div>
      )}
    </>
  );
}
