import { useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";

type Maintenance = {
  name: string;
  from: string;
  to: string;
  review: string;
  phase: string | null;
  update: boolean;
  rollback: boolean;
};
const version = (ref: string) => ref.split("@sha256:").at(-1)?.slice(0, 12);
export function ContainerMaintenance() {
  const [services, setServices] = useState<Maintenance[] | null>(null);
  const [selected, select] = useState<{ service: Maintenance; rollback: boolean } | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function reload() {
    setServices((await get<{ services: Maintenance[] }>("/api/container-maintenance")).services);
  }
  useEffect(() => {
    void reload().catch((error: Error) => setError(error.message));
  }, []);
  return <div className="tile">
    <h3>Mediencontainer aktualisieren</h3>
    <p>StackPilot bietet die Version aus seinem Dienstkatalog an. Vor dem Update wird die Dienstkonfiguration im gestoppten Zustand gesichert.</p>
    {services?.length === 0 && <p>Kein unterstützter Container eingerichtet.</p>}
    {services?.map((service) => <div key={service.name} className="service-row">
      <b>{service.name}</b>
      <span>{service.update ? `${version(service.from)} → ${version(service.to)}` : version(service.from)}</span>
      {service.update && <button disabled={busy} onClick={() => { select({ service, rollback: false }); setPassword(""); }}>Update vorbereiten</button>}
      {service.rollback && <button disabled={busy} onClick={() => { select({ service, rollback: true }); setPassword(""); }}>Vorherige Version wiederherstellen</button>}
      {!service.update && !service.rollback && <small>Keine abweichende Katalogversion</small>}
    </div>)}
    {selected && <form onSubmit={async (event) => {
      event.preventDefault();
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const { service, rollback } = selected;
        const result = await action<{ phase: string }>(`/api/container-maintenance/${rollback ? "rollback" : "update"}`, {
          name: service.name, review: service.review, password, confirmation: "OK",
        });
        setNotice(result.phase === "updated" ? "Neue Version läuft. Dienstprüfung bestanden." :
          rollback ? "Vorherige Version und Konfiguration sind wieder aktiv." : "Die neue Version wurde nicht bestätigt. Die vorherige Version und Konfiguration sind wieder aktiv.");
        select(null);
      } catch (error) {
        setError((error as Error).message);
        select(null);
      } finally {
        setPassword("");
        setBusy(false);
        await reload().catch(() => {});
      }
    }}>
      <p>{selected.rollback
        ? `${selected.service.name} wird auf die gesicherte Version und Konfiguration zurückgesetzt. Neuere Änderungen werden separat auf dem Server abgelegt.`
        : `${selected.service.name} wird kurz gestoppt. Wenn die neue Version die Funktionsprüfung nicht besteht, stellt StackPilot die bisherige Version wieder her.`}</p>
      <label>StackPilot-Administratorpasswort
        <input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} />
      </label>
      <button disabled={busy}>{busy ? "Wartung läuft …" : selected.rollback ? "Rückkehr bestätigen" : "Update bestätigen"}</button>
      <button type="button" disabled={busy} onClick={() => { select(null); setPassword(""); }}>Abbrechen</button>
    </form>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
