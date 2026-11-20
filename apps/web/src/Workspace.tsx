import { appVersion } from "./version";
import { ActivityOverview } from "./ActivityOverview";
import { ConnectionChecks } from "./ConnectionChecks";
import { ManagedServices } from "./ManagedServices";
import { IdentityBackups } from "./IdentityBackups";
import { Disclosure } from "./ui";
import { ServiceUpdates } from "./ServiceUpdates";
import { DockerGuard } from "./DockerGuard";
import { StackBackupPanel } from "./StackBackupPanel";
import { StackRestorePanel } from "./StackRestorePanel";
import { UpdateWindowPanel } from "./UpdateWindowPanel";
import { ContainerMaintenance } from "./ContainerMaintenance";
import { VaultBackup } from "./VaultBackup";
import { type Inventory, type Storage } from "./ServerCheck";
export function Workspace({
  view,
  inventory,
  onInventory,
  selected,
  connections,
  storage,
  onWizard,
  onManage,
  onNavigate,
}: {
  view: string;
  inventory: Inventory | null;
  onInventory: (v: Inventory | null) => void;
  selected: string[];
  connections: string[][];
  storage: Storage | null;
  onWizard: () => void;
  onManage?: () => void;
  onNavigate?: (view: string) => void;
}) {
  if (view === "Übersicht")
    return (
      <ActivityOverview
        onSetup={onWizard}
        onManage={onManage || onWizard}
        onNavigate={onNavigate}
      />
    );
  if (view === "Anwendungen")
    return (
      <>
        <div className="workspace-app-actions">
          <button onClick={onWizard}>Weitere Apps hinzufügen</button>
        </div>
        <ManagedServices />
      </>
    );
  if (view === "Verbindungen")
    return (
      <>
        <h2>Deine Dienstverbindungen</h2>
        <ConnectionChecks />
        <h3>Geplante Verbindungen der Wizard-Auswahl</h3>
        <p>
          Dies sind geplante Verbindungen der aktuellen Auswahl. Es wurden noch
          keine Dienst-APIs konfiguriert oder funktional geprüft.
        </p>
        {connections.length ? (
          connections.map(([a, b]) => (
            <div className="service-row" key={a + b}>
              <b>
                {a} → {b}
              </b>
              <span className="badge">Geplant</span>
            </div>
          ))
        ) : (
          <p>Keine Verbindungen in dieser Auswahl.</p>
        )}
        <button onClick={onWizard}>Stack konfigurieren</button>
      </>
    );
  if (view === "Sicherungen & Updates")
    return (
      <>
        <h2>Sicherungen &amp; Updates</h2>
        <ServiceUpdates />
        <Disclosure title="Gesamtsicherung">
          <StackBackupPanel />
          <StackRestorePanel />
        </Disclosure>
        <Disclosure title="Docker-Wächter">
          <DockerGuard />
        </Disclosure>
        <Disclosure title="Container-Updates und Rückkehr">
          <UpdateWindowPanel />
          <ContainerMaintenance />
        </Disclosure>
        <Disclosure title="StackPilot-Tresor sichern">
          <VaultBackup />
        </Disclosure>
        <Disclosure title="Authentik sichern und Wiederherstellung prüfen">
          <IdentityBackups />
        </Disclosure>
      </>
    );
  return (
    <>
      <div className="row">
        <h2>Transparent von Anfang an</h2>
        <span className="badge">StackPilot {appVersion}</span>
      </div>
      <div className="workspace-info">
      <details>
        <summary>Lokaler Entwicklungsbetrieb</summary>
        <p>
          StackPilot bindet ausschließlich an Loopback. Für den Zugriff vom
          eigenen Rechner bitte einen SSH-Tunnel verwenden.
          Administrator-Anmeldung ist vorhanden. Der Betrieb bleibt auf Loopback
          und SSH-Tunnel begrenzt; kein öffentlicher TLS-Zugriff.
        </p>
      </details>
      <details>
        <summary>Datenspeicherung</summary>
        <p>
          Simulierter Fortschritt wird im Browser gespeichert. Echte Ablösepläne
          und Aufträge werden lokal in .stackpilot/state.sqlite gespeichert.
          Dienstgeheimnisse liegen verschlüsselt im lokalen Tresor mit
          getrenntem Hauptschlüssel. Keine Telemetrie.
        </p>
      </details>
      <details>
        <summary>Klare Grenzen</summary>
        <p>
          Die Prüfung liest Betriebssystem, Docker-Container, Mountpunkte und
          lauschende TCP-Adressen. Die gesondert bestätigte Altstack-Ablösung
          kann Neustartregeln ändern sowie Container stoppen und entfernen.
          Mounts und Volumes werden dabei nicht gelöscht. VPN benötigt ein
          WireGuard-Profil und eine echte Ausfallsperrenprüfung. Nicht
          freigegebene Apps bleiben gesperrt. Die freigegebenen Pilot-Apps
          werden nach gesonderter Bestätigung echt installiert.
        </p>
      </details>
      </div>
    </>
  );
}
