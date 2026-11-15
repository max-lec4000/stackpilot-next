import { appVersion } from "./version";
import { ActivityOverview } from "./ActivityOverview";
import { ConnectionChecks } from "./ConnectionChecks";
import { ManagedServices } from "./ManagedServices";
import { CouchdeckPanel } from "./CouchdeckPanel";
import { IdentityBackups } from "./IdentityBackups";
import { Disclosure } from "./ui";
import { ServiceUpdates } from "./ServiceUpdates";
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
        <CouchdeckPanel />
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
        <h2>Deine Daten bleiben deine Daten.</h2>
        <p>
          Authentik kann unter Verwaltung → Externer Zugriff verschlüsselt
          gesichert und isoliert wiederhergestellt werden. Vollständige
          Stack-Sicherungen und Mediencontainer-Updates sind noch nicht
          freigegeben. StackPilot-Code kann separat vorbereitet und aktualisiert werden.
        </p>
        <ServiceUpdates />
        <Disclosure title="Authentik sichern und Wiederherstellung prüfen">
          <IdentityBackups />
        </Disclosure>
        <details className="workspace-info">
          <summary>StackPilot-Code kontrolliert aktualisieren</summary>
          <p>Der neue Stand wird in einem getrennten Verzeichnis installiert, getestet und gebaut. Erst danach wird der Nutzerdienst gestoppt. Eigene Änderungen und unbekannte Datenmigrationen sperren das Update. Ein fehlgeschlagener Start versucht den vorherigen Code und Build wiederherzustellen.</p>
          <p>Im bestehenden Checkout als normaler Verwaltungsnutzer ausführen:</p>
          <pre><code>npm run update:check{"\n"}npm run update:apply</code></pre>
          <p>Das ist keine Sicherung von Medien oder Datenbanken. Nach einem Prozessabbruch den privaten Updateauftrag prüfen. Rückkehr zur vorherigen Version kann einen Checkout auf einem festen Commit hinterlassen; vor weiteren Änderungen dessen Zustand prüfen.</p>
        </details>
        <div className="workspace-info">
          <details>
            <summary>Geplanter sicherer Ablauf</summary>
            <ol>
              <li>Änderungen und Zielversionen prüfen.</li>
              <li>Konfiguration und Datenbanken konsistent sichern.</li>
              <li>Sicherung prüfen und erst dann aktualisieren.</li>
              <li>Funktion und Verbindungen erneut testen.</li>
            </ol>
          </details>
        </div>
        <p>
          Die gesonderte Altstack-Ablösung kann bereits Container gezielt
          stoppen und entfernen. Die Authentik-Sicherung umfasst nicht
          automatisch Jellyfin, ARR, Medien und den StackPilot-Zustand.
        </p>
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
