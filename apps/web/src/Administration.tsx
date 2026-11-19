import { VpnProfiles } from "./VpnProfiles";
import { SeriesRemoval } from "./SeriesRemoval";
import { AuditLog } from "./AuditLog";
import { DevelopmentDiagnostics } from "./DevelopmentDiagnostics";
import { Icon } from "./Icon";
import { MusicLibrary } from "./Music";
import { SizeSettings } from "./SizeSettings";
import { RemoteAccessView } from "./RemoteAccess";
import { SourcesView } from "./Sources";
import { SafetyCheckView } from "./SafetyCheck";
import { useEffect, useRef, useState } from "react";
import { ConnectionChecks } from "./ConnectionChecks";
import { DeploymentCheck } from "./DeploymentCheck";
import { Workspace } from "./Workspace";
import { ServerCheck, get, type Inventory, type Storage } from "./ServerCheck";
const areas = [
  { id: "media-files", group: "Betrieb", icon: "▤", title: "Medienbestand", description: "Bibliotheksdateien prüfen und gezielt löschen.", color: "sage" },
  {
    id: "music",
    group: "Betrieb",
    icon: "♫",
    title: "Musikbibliothek",
    description: "Unabhängigen Musikbestand prüfen und als Manifest exportieren.",
    color: "lilac",
  },
  {
    id: "remote",
    group: "Einrichten",
    icon: "↗",
    title: "Externer Zugriff",
    description: "Jellyfin Schritt für Schritt sicher erreichbar machen.",
    color: "peach",
  },
  {
    id: "sources",
    group: "Einrichten",
    icon: "⌕",
    title: "Quellen",
    description: "Anbieter auswählen und mit deinen Apps verbinden.",
    color: "sage",
  },
  {
    id: "profiles",
    group: "Einrichten",
    icon: "◇",
    title: "Medienprofile",
    description: "Qualität und Größenstandard für neue Anfragen.",
    color: "lilac",
  },
  {
    id: "connections",
    group: "Betrieb",
    icon: "⇄",
    title: "Verbindungen",
    description: "Dienstzugänge und Verbindungen prüfen.",
    color: "sage",
  },
  {
    id: "safety",
    group: "Betrieb",
    icon: "◈",
    title: "VPN & Ausfallsperre",
    description: "Downloads und den Schutz bei VPN-Ausfall prüfen.",
    color: "peach",
  },
  {
    id: "backups",
    group: "Betrieb",
    icon: "↺",
    title: "Sicherungen & Updates",
    description: "StackPilot und Container aktualisieren, Tresor sichern.",
    color: "lilac",
  },
  {
    id: "diagnosis",
    group: "Nachsehen",
    icon: "⌘",
    title: "Diagnose",
    description: "Server, Hardware und technische Details bei Bedarf.",
    color: "lilac",
  },
  {
    id: "history",
    group: "Nachsehen",
    icon: "◷",
    title: "Auftragsverlauf",
    description: "Gespeicherte Einrichtungen und Reparaturen fortsetzen.",
    color: "peach",
  },
  {
    id: "audit",
    group: "Nachsehen",
    icon: "≡",
    title: "Änderungsverlauf",
    description: "Aktionen nachvollziehen, ohne Zugangsdaten.",
    color: "sage",
  },
  {
    id: "about",
    group: "Nachsehen",
    icon: "i",
    title: "Über StackPilot",
    description: "Version, lokaler Betrieb und Prüfgrenzen.",
    color: "lilac",
  },
] as const;
export function administrationTitle(id: string) {
  return areas.find((area) => area.id === id)?.title || "Verwaltung";
}
export function Administration({
  area,
  onAreaChange,
  inventory,
  onInventory,
  selected,
  path,
  username,
  vpn,
  vpnProfileId,
  language,
  quality,
  storage,
  onWizard,
  onMigrationPlan,
  migrationLoading,
  migrationError,
}: {
  area: string;
  onAreaChange: (area: string) => void;
  inventory: Inventory | null;
  onInventory: (value: Inventory | null) => void;
  selected: string[];
  path: string;
  username: string;
  vpn: boolean;
  vpnProfileId: string;
  language: string;
  quality: string;
  storage: Storage | null;
  onWizard: () => void;
  onMigrationPlan: () => void;
  migrationLoading: boolean;
  migrationError: string;
}) {
  const panel = areas.some((a) => a.id === area) ? area : "";
  const [menuOpen, setMenuOpen] = useState(false);
  const [networkUpgrade, setNetworkUpgrade] = useState(false);
  useEffect(() => {
    if (panel) return;
    let mounted = true;
    get<{ networkUpgrade?: boolean } | null>("/api/stack")
      .then((stack) => {
        if (mounted) setNetworkUpgrade(stack?.networkUpgrade === true);
      })
      .catch(() => {
        if (mounted) setNetworkUpgrade(false);
      });
    return () => {
      mounted = false;
    };
  }, [panel]);
  const heading = useRef<HTMLHeadingElement>(null),
    active = areas.find((a) => a.id === panel),
    previous = useRef(panel);
  useEffect(() => {
    setMenuOpen(false);
    if (previous.current !== panel) {
      previous.current = panel;
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: "start" });
    }
  }, [panel]);
  function choose(id: string) {
    onAreaChange(id);
    setMenuOpen(false);
  }
  function content() {
    if (panel === "music") return <MusicLibrary />;
    if (panel === "remote") return <RemoteAccessView />;
    if (panel === "profiles") return <SizeSettings />;
    if (panel === "media-files") return <SeriesRemoval />;
    if (panel === "sources") return <SourcesView />;
    if (panel === "safety") return <><VpnProfiles /><SafetyCheckView /></>;
    if (panel === "connections") return <ConnectionChecks />;
    if (panel === "diagnosis")
      return (
        <>
          <ServerCheck value={inventory} onChange={onInventory} />
          <DevelopmentDiagnostics />
        </>
      );
    if (panel === "audit") return <AuditLog />;
    if (panel === "history")
      return (
        <DeploymentCheck
          selected={selected}
          path={path}
          username={username}
          vpn={vpn}
          vpnProfileId={vpnProfileId}
          language={language}
          quality={quality}
          showPlanner={false}
        />
      );
    if (panel === "backups" || panel === "about")
      return (
        <Workspace
          view={panel === "backups" ? "Sicherungen & Updates" : "Einstellungen"}
          inventory={inventory}
          onInventory={onInventory}
          selected={selected}
          connections={[]}
          storage={storage}
          onWizard={onWizard}
        />
      );
    return null;
  }
  return (
    <div className={"administration " + (active ? "has-selection" : "")}>
      {!active ? (
        <>
          <div className="admin-welcome">
            <div>
              <span className="eyebrow">DEIN STACK, GUT AUFGEHOBEN</span>
              <h2 ref={heading} tabIndex={-1}>
                Was möchtest du erledigen?
              </h2>
              <p>
                Einrichten, pflegen oder nachsehen. Jeder Bereich hat seinen
                eigenen Platz.
              </p>
            </div>
            <button className="primary" onClick={onWizard}>
              Stack konfigurieren
            </button>
          </div>
          {networkUpgrade && (
            <section className="tile" aria-labelledby="network-upgrade-title">
              <h3 id="network-upgrade-title">Anstehende Umstellung</h3>
              <p>Jellyfin und die Download-Dienste bekommen getrennte Docker-Netze.
                Die betroffenen Container starten dabei kurz neu.</p>
              <button disabled={migrationLoading} onClick={onMigrationPlan}>
                {migrationLoading ? "Stack wird geladen …" : "Plan für Netztrennung öffnen"}
              </button>
              {migrationError && <p className="error" role="alert">{migrationError}</p>}
            </section>
          )}
          {["Einrichten", "Betrieb", "Nachsehen"].map((group) => (
            <section className="admin-group" key={group}>
              <h3>{group}</h3>
              <div className="admin-area-grid">
                {areas
                  .filter((a) => a.group === group)
                  .map((a) => (
                    <button
                      className={"tile manage-action admin-area " + a.color}
                      key={a.id}
                      onClick={() => choose(a.id)}
                    >
                      <span className="area-symbol" aria-hidden="true">
                        <Icon name={a.id} />
                      </span>
                      <span>
                        <b>{a.title}</b>
                        <span>{a.description}</span>
                      </span>
                      <span className="area-arrow" aria-hidden="true">
                        ↗
                      </span>
                    </button>
                  ))}
              </div>
            </section>
          ))}
        </>
      ) : (
        <>
          <div className="admin-section-head">
            <div>
              <span className="eyebrow">
                VERWALTUNG / {active.group.toUpperCase()}
              </span>
              <h2 ref={heading} tabIndex={-1}>
                {active.title}
              </h2>
              <p>{active.description}</p>
            </div>
            <div className="admin-head-actions">
              <button
                aria-expanded={menuOpen}
                aria-controls="admin-area-navigation"
                onClick={() => setMenuOpen(!menuOpen)}
              >
                Bereich wechseln{" "}
                <span aria-hidden="true">{menuOpen ? "−" : "+"}</span>
              </button>
              <button onClick={() => choose("")}>Alle Bereiche</button>
            </div>
          </div>
          {menuOpen && (
            <nav
              id="admin-area-navigation"
              className="admin-area-navigation"
              aria-label="Verwaltungsbereiche"
            >
              <button onClick={onWizard}>✦ Apps & VPN einrichten</button>
              {areas.map((a) => (
                <button
                  key={a.id}
                  aria-current={panel === a.id ? "page" : undefined}
                  aria-pressed={panel === a.id}
                  onClick={() => choose(a.id)}
                >
                  <Icon name={a.id} />
                  {a.title}
                  {panel === a.id && (
                    <span className="selected-area-label">Ausgewählt</span>
                  )}
                </button>
              ))}
            </nav>
          )}
          <div className={"admin-selected-strip " + active.color}>
            <span aria-hidden="true"><Icon name={active.id} /></span>
            <span>
              Ausgewählt: <b>{active.title}</b>
            </span>
          </div>
          <div className="administration-panel" key={panel}>
            {content()}
          </div>
        </>
      )}
    </div>
  );
}
