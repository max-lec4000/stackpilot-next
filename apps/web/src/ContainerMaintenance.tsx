import { ConfirmBar } from "./ui";
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
  note?: string;
  snapshotAt?: string | null;
};
const age = (iso?: string | null) => {
  if (!iso) return null;
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  const date = new Date(iso).toLocaleString("de-AT", { dateStyle: "short", timeStyle: "short" });
  return days >= 1 ? `vom ${date} (vor ${days} ${days === 1 ? "Tag" : "Tagen"})` : `vom ${date}`;
};
const version = (ref: string) => ref.split("@sha256:").at(-1)?.slice(0, 12);
export function ContainerMaintenance() {
  const [services, setServices] = useState<Maintenance[] | null>(null);
  const [selected, select] = useState<{ service: Maintenance; rollback: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reconcile, setReconcile] = useState(false);
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
      {service.update && <button disabled={busy} onClick={() => select({ service, rollback: false })}>Update vorbereiten</button>}
      {service.rollback && <button disabled={busy} onClick={() => select({ service, rollback: true })}>Vorherige Version wiederherstellen</button>}
      {!service.update && !service.rollback && service.from === service.to && <small>Keine abweichende Katalogversion</small>}
      {service.note && <small>{service.note}</small>}
    </div>)}
    {selected && <ConfirmBar label={selected.rollback ? "Rückkehr bestätigen" : "Update bestätigen"} busy={busy} busyLabel="Wartung läuft …"
      onCancel={() => select(null)}
      onOk={async () => {
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const { service, rollback } = selected;
        const result = await action<{ phase: string; reconciled?: string }>(`/api/container-maintenance/${rollback ? "rollback" : "update"}`, {
          name: service.name, review: service.review, confirmation: "OK",
        });
        setNotice(result.phase === "updated" ? "Neue Version läuft. Dienstprüfung bestanden." :
          (rollback ? "Vorherige Version und Konfiguration sind wieder aktiv." : "Die neue Version wurde nicht bestätigt. Die vorherige Version und Konfiguration sind wieder aktiv.") +
          (result.reconciled ? " " + result.reconciled : ""));
        select(null);
      } catch (error) {
        setError((error as Error).message);
        select(null);
      } finally {
        setBusy(false);
        await reload().catch(() => {});
      }
    }}>
      <p>{selected.rollback
        ? `${selected.service.name} wird auf die gesicherte Version und Konfiguration ${age(selected.service.snapshotAt) || "vom letzten Update"} zurückgesetzt. Änderungen seitdem gelten in ${selected.service.name} nicht mehr (sie werden separat auf dem Server abgelegt). Danach gleicht StackPilot die Schlüssel der verbundenen Apps automatisch ab.`
        : `${selected.service.name} auf ${version(selected.service.to)} aktualisieren? Der Dienst wird kurz gestoppt. Wenn die neue Version die Funktionsprüfung nicht besteht, stellt StackPilot die bisherige Version wieder her.`}</p>
    </ConfirmBar>}
    {notice && <p role="status">{notice}</p>}
    <p className="muted">
      Stimmen Verbindungen zwischen den Apps nicht mehr (etwa nach einer Rückkehr auf einen älteren Stand), gleicht
      StackPilot die Schlüssel mit seinem Tresor ab und testet jede Verbindung.
    </p>
    {!reconcile ? <button disabled={busy} onClick={() => setReconcile(true)}>Verbindungen abgleichen …</button> : (
      <ConfirmBar label="Verbindungen abgleichen" busy={busy} busyLabel="Wird abgeglichen …" onCancel={() => setReconcile(false)}
        onOk={async () => {
          setBusy(true); setError(""); setNotice("");
          try {
            const r = await action<{ message: string }>("/api/container-maintenance/reconcile", { confirmation: "OK" });
            setNotice(r.message);
          } catch (error) { setError((error as Error).message); } finally { setBusy(false); setReconcile(false); }
        }}>
        <p>Die von StackPilot verwalteten Verbindungen (Seerr, Bazarr, Prowlarr ↔ Sonarr, Radarr, Lidarr) prüfen und abweichende Schlüssel durch die aus dem Tresor ersetzen?</p>
      </ConfirmBar>
    )}
    {error && <p role="alert">{error}</p>}
  </div>;
}
