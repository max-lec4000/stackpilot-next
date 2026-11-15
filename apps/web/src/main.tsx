import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  components,
  plan,
  portConflicts,
} from "../../../packages/domain/planner.js";
import "./style.css";
import { Discover, Requests } from "./Media";
import { AuthGate } from "./AuthGate";
import { ComponentPicker } from "./ComponentPicker";
import { VpnImport } from "./VpnImport";
import { DeploymentCheck } from "./DeploymentCheck";
import { Administration, administrationTitle } from "./Administration";
import { RemoteAccessView } from "./RemoteAccess";
import { DownloadsView } from "./ActivityOverview";
import { Workspace } from "./Workspace";
import { Icon } from "./Icon";
import { GlobalSearch } from "./GlobalSearch";
import { useNavigation, viewHref } from "./navigation";
import { RemoteSetupPanel } from "./RemoteSetupPanel";
import {
  ServerCheck,
  StorageCheck,
  type Inventory,
  type Storage,
} from "./ServerCheck";
// Vier Seiten statt sieben: Die bisherigen Abschnitte (0 Server … 6 Einrichtung) bleiben
// intern erhalten und werden zu Seiten zusammengefasst.
const pages = [
  { name: "Server & Apps", stages: [0, 1] },
  { name: "Speicher & VPN", stages: [2, 3, 4] },
  { name: "Plan", stages: [5] },
  { name: "Einrichtung", stages: [6] },
];
type Job = { id: string; steps: string[]; done: number; paused: boolean };
const key = "stackpilot-demo-job-v1";
function load(): Job | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    return v &&
      typeof v.id === "string" &&
      Array.isArray(v.steps) &&
      v.steps.every((s: unknown) => typeof s === "string") &&
      Number.isInteger(v.done) &&
      v.done >= 0 &&
      v.done <= v.steps.length
      ? { ...v, paused: true }
      : null;
  } catch {
    return null;
  }
}
function App() {
  const existingStack = useRef(false);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  const { view, area, navigate: setView } = useNavigation();
  const [discoveryQuery, setDiscoveryQuery] = useState("");
  const [discoverySerial, setDiscoverySerial] = useState(0);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const previousView = useRef(view);
  useEffect(() => {
    document.title = `${view === "Verwaltung" && area ? administrationTitle(area) : view} · StackPilot`;
    if (previousView.current !== view) {
      previousView.current = view;
      pageHeading.current?.focus({ preventScroll: true });
    }
  }, [view, area]);
  const [identity, setIdentity] = useState<{
    host: string;
    release: string;
  } | null>(null);
  useEffect(() => {
    fetch("/api/identity", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((v) => {
        if (typeof v.host === "string" && typeof v.release === "string") {
          setIdentity(v);
          if (typeof v.suggestedDataPath === "string" && !existingStack.current)
            setPath((current) =>
              current === "/srv/stackpilot/data"
                ? v.suggestedDataPath
                : current,
            );
          if (typeof v.username === "string" && !existingStack.current)
            setUsername((current) =>
              current === "admin" ? v.username : current,
            );
        }
      })
      .catch(() => {});
  }, []);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [storage, setStorage] = useState<Storage | null>(null);
  const [job, setJob] = useState<Job | null>(load);
  const [mode, setMode] = useState(job ? "simulation" : "real");
  const [support, setSupport] = useState<
    Record<string, { installable: boolean }>
  >({});
  useEffect(() => {
    fetch("/api/catalog")
      .then((r) => r.json())
      .then((c) => setSupport(c.services || {}))
      .catch(() => {});
  }, []);
  const [stage, setStage] = useState(job ? 6 : 0);
  const page = Math.max(0, pages.findIndex((entry) => entry.stages.includes(stage)));
  const on = (section: number) => pages[page].stages.includes(section);
  // Standard: alles. Abwählen ist jederzeit möglich.
  const [selected, setSelected] = useState<string[]>([...components]);
  const [couchdeck, setCouchdeck] = useState(true);
  const [couchdeckYoutube, setCouchdeckYoutube] = useState(true);
  const [couchdeckInstalled, setCouchdeckInstalled] = useState(false);
  const [adopt, setAdopt] = useState(false);
  const [remote, setRemote] = useState(true);
  const [viewer, setViewer] = useState("");
  const [path, setPath] = useState("/srv/stackpilot/data");
  const [username, setUsername] = useState("admin");
  const [vpn, setVpn] = useState(true);
  const [vpnProfileId, setVpnProfileId] = useState("");
  const [stackStatus, setStackStatus] = useState<string | null>(null);
  const [migrationLoading, setMigrationLoading] = useState(false);
  const [migrationError, setMigrationError] = useState("");
  const [installed, setInstalled] = useState<string[]>([]);
  useEffect(() => {
    if (mode !== "real" || !inventory) return;
    setSelected((current) =>
      current.filter(
        (name) =>
          installed.includes(name) ||
          !inventory.containers.some((c) => c.component === name.toLowerCase()),
      ),
    );
  }, [inventory, installed, mode]);
  function loadStack(navigate = false) {
    return fetch("/api/stack", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw Error("Stack konnte nicht geladen werden.");
        return r.json();
      })
      .then((stack) => {
        if (!stack?.spec) {
          if (navigate && !window.location.hash)
            setView("Stack konfigurieren", "", true);
          return stack;
        }
        if (navigate && !window.location.hash) {
          setView(
            stack.status === "completed" ? "Übersicht" : "Stack konfigurieren",
            "",
            true,
          );
          if (stack.status !== "completed") setStage(6);
        }
        if (navigate && view === "Stack konfigurieren" && stack.status !== "completed")
          setStage(6);
        setStackStatus(stack.status);
        existingStack.current = true;
        const spec = stack.spec;
        setInstalled(spec.selected);
        setSelected(spec.selected);
        setPath(spec.path);
        setUsername(spec.username);
        setLanguage(spec.language);
        setQuality(spec.quality);
        setVpn(spec.vpn);
        setCouchdeck(!!spec.couchdeck);
        setCouchdeckYoutube(!!spec.couchdeckYoutube);
        setCouchdeckInstalled(!!spec.couchdeck);
        setRemote(!!spec.remote);
        setViewer(spec.viewer || "");
        // Profile handles contain no keys and can safely prefill the wizard.
        if (stack.vpnProfileId) setVpnProfileId(stack.vpnProfileId);
        return stack;
      })
      .catch(() => null);
  }
  useEffect(() => {
    void loadStack(true);
  }, []);
  const [language, setLanguage] = useState("Deutsch");
  useEffect(() => {
    if (mode === "real" && selected.includes("qBittorrent")) setVpn(true);
  }, [mode, selected]);
  const [quality, setQuality] = useState("1080p · ausgewogen");
  const [confirmed, setConfirmed] = useState(false);
  const [planHint, setPlanHint] = useState(
    "Zuerst den echten Installationsplan prüfen.",
  );
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view, stage]);
  const p = plan({ selected, vpn, path, username });
  useEffect(() => {
    try {
      if (job) localStorage.setItem(key, JSON.stringify(job));
    } catch {
      /* Simulation funktioniert ohne Speicherung weiter. */
    }
  }, [job]);
  useEffect(() => {
    if (!job || job.paused || job.done >= job.steps.length) return;
    const t = setTimeout(
      () => setJob((j) => (j ? { ...j, done: j.done + 1 } : j)),
      650,
    );
    return () => clearTimeout(t);
  }, [job]);
  const busy = !!job && job.done < job.steps.length;
  function start() {
    if (job || p.errors.length || !confirmed) return;
    setJob({ id: crypto.randomUUID(), steps: p.steps, done: 0, paused: false });
    setStage(6);
  }
  return (
    <div className="layout">
      <a className="skip-link" href="#main-content" onClick={(event) => {
        event.preventDefault();
        pageHeading.current?.focus();
      }}>Zum Inhalt springen</a>
      <aside>
        <a className="brand" href={viewHref("Übersicht")}>
          <span className="brandmark" aria-hidden="true">
            ▱
          </span>{" "}
          stackpilot<span className="brand-dot">.</span>
        </a>
        <p className="muted brand-sub">Dein Stack. Dein Zuhause.</p>
        <div className="server-card">
          <span className="server-icon" aria-hidden="true">
            ▤
          </span>
          <div>
            <b title={inventory?.host || identity?.host}>
              {inventory?.host || identity?.host || "Gerät wird erkannt …"}
            </b>
            <small>
              {inventory?.release || identity?.release || "Noch nicht erkannt"}
            </small>
          </div>
        </div>
        <div className="nav-caption">DEIN MEDIENZUHAUSE</div>
        <nav aria-label="Hauptnavigation">
          {[
            "Übersicht",
            "Medien entdecken",
            "Meine Anfragen",
            "Downloads",
            "Anwendungen",
            "Verwaltung",
            "Stack konfigurieren",
          ].map((n, i) => (
            <a
              key={n}
              href={viewHref(n)}
              aria-current={n === view ? "page" : undefined}
              className={"nav-link " + (n === view ? "active" : "")}
            >
              <span className="nav-icon" aria-hidden="true">
                <Icon name={["home", "discover", "requests", "downloads", "apps", "settings", "stack"][i]} />
              </span>
              {n}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="status-dot" /> Dein Stack. Dein Zuhause.
        </div>
      </aside>
      <main id="main-content">
        <div className="topbar">
          <nav aria-label="Brotkrumen">
            <a href={viewHref("Übersicht")}>Zuhause</a>
            <span className="slash" aria-hidden="true">/</span>
            <a href={viewHref(view)} aria-current={!area ? "page" : undefined}>{view}</a>
            {view === "Verwaltung" && area && <>
              <span className="slash" aria-hidden="true">/</span>
              <span aria-current="page">{administrationTitle(area)}</span>
            </>}
          </nav>
          <span className="topbar-status">
            <span className="status-dot" /> Lokal & selbst gehostet
          </span>
          <GlobalSearch onDiscover={(query) => { setDiscoveryQuery(query); setDiscoverySerial((value) => value + 1); setView("Medien entdecken"); }} />
        </div>
        <div className="page-content">
          <header className="page-heading">
            <div>
              <h1 ref={pageHeading} tabIndex={-1}>
                {view === "Stack konfigurieren" ? (
                  <>
                    Dein Medienzuhause.
                    <br />
                    <span>Einfach zusammengestellt.</span>
                  </>
                ) : view === "Übersicht" ? (
                  <>Willkommen zuhause.</>
                ) : (
                  <>
                    {view}
                    <span>.</span>
                  </>
                )}
              </h1>
              <p className="muted">
                {view === "Stack konfigurieren"
                  ? "Ein gemeinsamer Plan für deine Apps."
                  : view === "Übersicht"
                    ? "Dein Stack, deine Medien – die wichtigen Dinge auf einen Blick."
                    : view === "Downloads"
                      ? "Transfers, Größen und VPN-Schutz."
                      : view === "Anwendungen"
                        ? "Deine Apps öffnen und ihren Zustand prüfen."
                        : view === "Verwaltung"
                          ? "Einrichten, pflegen und nachsehen."
                          : view === "Meine Anfragen"
                            ? "Vom Wunsch bis zur Wiedergabe."
                            : "Finde deinen nächsten Filmabend."}
              </p>
            </div>
          </header>
          {view !== "Stack konfigurieren" ? (
            <section>
              {view === "Medien entdecken" ? (
                <Discover key={discoverySerial} initialSearch={discoveryQuery} onNavigate={setView} />
              ) : view === "Meine Anfragen" ? (
                <Requests onNavigate={setView} />
              ) : view === "Downloads" ? (
                <DownloadsView />
              ) : view === "Verwaltung" ? (
                <Administration
                  area={area}
                  onAreaChange={(id) => setView("Verwaltung", id)}
                  inventory={inventory}
                  onInventory={setInventory}
                  selected={selected}
                  path={path}
                  username={username}
                  vpn={vpn}
                  vpnProfileId={vpnProfileId}
                  language={language}
                  quality={quality}
                  storage={storage}
                  migrationLoading={migrationLoading}
                  migrationError={migrationError}
                  onMigrationPlan={async () => {
                    setMigrationLoading(true);
                    setMigrationError("");
                    try {
                      const stack = await loadStack();
                      if (!stack?.networkUpgrade) {
                        setMigrationError("Die Umstellung konnte nicht bestätigt werden. Lade die Verwaltung neu und prüfe den aktuellen Stand.");
                        return;
                      }
                      setMode("real");
                      setStage(5);
                      setView("Stack konfigurieren");
                    } finally {
                      setMigrationLoading(false);
                    }
                  }}
                  onWizard={() => {
                    setView("Stack konfigurieren");
                    setStage(
                      stackStatus && stackStatus !== "completed" ? 6 : 1,
                    );
                    void loadStack();
                  }}
                />
              ) : (
                <Workspace
                  onNavigate={setView}
                  onManage={() => setView("Verwaltung")}
                  view={view}
                  inventory={inventory}
                  onInventory={setInventory}
                  selected={selected}
                  connections={p.connections}
                  storage={storage?.requested === path ? storage : null}
                  onWizard={() => {
                    setView("Stack konfigurieren");
                    setStage(
                      stackStatus && stackStatus !== "completed" ? 6 : 1,
                    );
                    void loadStack();
                  }}
                />
              )}
            </section>
          ) : (
            <>
              <div className="wizard-launch">
                <div>
                  <span className="eyebrow">
                    BEREIT FÜR DEIN MEDIENZUHAUSE?
                  </span>
                  <h2>
                    {stage === 6
                      ? "Dein Stack wächst mit dir."
                      : "Ein Plan. Dein ganzer Stack."}
                  </h2>
                  <p>
                    Serverprüfung automatisch · Apps gemeinsam auswählen · mit
                    OK bestätigen
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => {
                    if (stage === 6) setView("Anwendungen");
                    else setStage(5);
                  }}
                >
                  {stage === 6 ? "Anwendungen ansehen →" : "Zur Einrichtung →"}
                </button>
              </div>
              <div className="mode-bar">
                <button
                  aria-pressed={mode === "real"}
                  disabled={busy}
                  onClick={() => {
                    setMode("real");
                    if (job) {
                      setJob(null);
                      try {
                        localStorage.removeItem(key);
                      } catch {}
                      setStage(0);
                    }
                  }}
                >
                  Echter Installationspilot
                </button>
                <button
                  aria-pressed={mode === "simulation"}
                  disabled={busy}
                  onClick={() => setMode("simulation")}
                >
                  Simulation
                </button>
              </div>
              <div className="wizard-caption">
                <span>DEIN WEG ZUM STACK</span>
                <span>Schritt {page + 1} von {pages.length}</span>
              </div>
              <ol className="stages">
                {pages.map((entry, i) => (
                  <li key={entry.name}>
                    <button
                      disabled={!!job || (i === pages.length - 1 && mode === "simulation")}
                      aria-current={page === i ? "step" : undefined}
                      className={page === i ? "current" : ""}
                      onClick={() => setStage(entry.stages[0])}
                    >
                      <span className="step-number">{i + 1}</span>
                      {entry.name}
                    </button>
                  </li>
                ))}
              </ol>
              <section>
                {on(0) && (
                  <ServerCheck value={inventory} onChange={setInventory} />
                )}
                {on(1) && (
                  <ComponentPicker
                    selected={selected}
                    onChange={setSelected}
                    installed={installed}
                    existing={components.filter(
                      (name) =>
                        !installed.includes(name) &&
                        inventory?.containers.some(
                          (c) => c.component === name.toLowerCase(),
                        ),
                    )}
                    support={support}
                    real={mode === "real"}
                  />
                )}
                {on(1) && mode === "real" && (
                  <fieldset className="couchdeck-choice">
                    <legend>Am Bildschirm des Servers</legend>
                    <label>
                      <input
                        type="checkbox"
                        checked={couchdeck}
                        disabled={couchdeckInstalled}
                        onChange={(event) => setCouchdeck(event.target.checked)}
                      />
                      <span>
                        <b>Couchdeck</b> – Filme, Serien und Anfragen per Controller am
                        Fernseher. Wird direkt auf dem Server installiert, bekommt ein
                        eigenes Wohnzimmer-Konto und ist ohne Anmeldung startklar.
                        {couchdeckInstalled && " Bereits eingerichtet."}
                      </span>
                    </label>
                    {couchdeck && !couchdeckInstalled && (
                      <label>
                        <input
                          type="checkbox"
                          checked={couchdeckYoutube}
                          onChange={(event) => setCouchdeckYoutube(event.target.checked)}
                        />
                        <span>
                          YouTube in Couchdeck (lädt yt-dlp von GitHub, per Prüfsumme
                          geprüft)
                        </span>
                      </label>
                    )}
                  </fieldset>
                )}
                {on(1) && mode === "real" && (
                  <fieldset className="couchdeck-choice">
                    <legend>Von unterwegs</legend>
                    <label>
                      <input
                        type="checkbox"
                        checked={remote}
                        onChange={(event) => setRemote(event.target.checked)}
                      />
                      <span>
                        <b>Jellyfin über HTTPS</b> – mit geschützter Anmeldung (Authentik,
                        zweiter Faktor). Wird direkt nach der Installation eingerichtet und
                        braucht Tailscale auf diesem Server. Alle anderen Dienste bleiben im
                        eigenen Netz.
                      </span>
                    </label>
                    {remote && (
                      <label>
                        <span>
                          Erster Zuschauer (optional):{" "}
                          <input
                            value={viewer}
                            placeholder="z. B. familie"
                            onChange={(event) => setViewer(event.target.value)}
                          />{" "}
                          Dieses Konto ohne Verwaltungsrechte bekommt am Ende eine Einladung.
                          Weitere Zuschauer lädst du später mit einem Klick ein.
                        </span>
                      </label>
                    )}
                  </fieldset>
                )}
                {on(2) && (
                  <>
                    <h2>Ein gemeinsamer Datenbereich</h2>
                    <label>
                      Datenpfad auf dem Server
                      <input
                        value={path}
                        onChange={(e) => {
                          setPath(e.target.value);
                          setStorage(null);
                        }}
                      />
                    </label>
                    {mode === "real" && !installed.length && (
                      <label className="couchdeck-check">
                        <input
                          type="checkbox"
                          checked={adopt}
                          onChange={(event) => setAdopt(event.target.checked)}
                        />
                        Vorhandenen Medienordner übernehmen (enthält nur „media“ und
                        „downloads“ eines früheren Stacks). Die Dateien bleiben unverändert;
                        Konten und Einstellungen entstehen neu.
                      </label>
                    )}
                    <div className="tile">
                      <code>
                        /data/downloads
                        <br />
                        /data/media/movies
                        <br />
                        /data/media/tv
                        <br />
                        /data/media/music
                      </code>
                    </div>
                    <p>
                      Identische Containerpfade erleichtern den Import.
                      Hardlinks erfordern dasselbe Dateisystem; Mountgrenzen und
                      Rechte sind noch ungeprüft.
                    </p>
                    <p>Keine bestehenden Daten oder Rechte werden verändert.</p>
                    <StorageCheck
                      path={path}
                      inventory={inventory}
                      value={storage}
                      onChange={setStorage}
                      onPath={setPath}
                    />
                  </>
                )}
                {on(3) && (
                  <>
                    <h2>Dein Zugang, getrennte Dienstschlüssel</h2>
                    <label>
                      Gewünschter Benutzername
                      <input
                        autoComplete="off"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                      />
                    </label>
                    <p>
                      Wir planen denselben sichtbaren Benutzernamen, soweit die
                      App ihn unterstützt. Echte gemeinsame Anmeldung hängt vom
                      jeweiligen Dienst ab.
                    </p>
                    <div className="tile">
                      Persönliche Konten: automatische Anlage bei echter
                      Installation.
                      <br />
                      Hintergrundzugänge: getrennte API-Schlüssel. Ihre Rechte
                      hängen vom jeweiligen Dienst ab.
                      <br />
                      Passwörter: pro Dienst erzeugt und geschützt verwaltet.
                    </div>
                    <p className="muted">
                      In der Simulation werden keine Zugänge angelegt. Der echte
                      Pilot erzeugt getrennte zufällige Dienstpasswörter.
                      Externe Indexer-Zugänge werden noch nicht automatisch
                      eingerichtet.
                    </p>
                  </>
                )}
                {on(4) && (
                  <>
                    <h2>VPN und Medienprofil</h2>
                    <label className="tile">
                      <input
                        type="checkbox"
                        checked={vpn}
                        disabled={
                          mode === "real" && selected.includes("qBittorrent")
                        }
                        onChange={(e) => setVpn(e.target.checked)}
                      />{" "}
                      Mullvad über Gluetun · für Downloads erforderlich
                    </label>
                    {vpn &&
                      (mode === "real" ? (
                        <VpnImport
                          profileId={vpnProfileId}
                          onImported={setVpnProfileId}
                        />
                      ) : (
                        <p className="notice">
                          Die Simulation benötigt keine echte WireGuard-Datei
                          und prüft keinen Tunnel.
                        </p>
                      ))}
                    <div className="grid">
                      <label>
                        Sprache
                        <select
                          value={language}
                          onChange={(e) => setLanguage(e.target.value)}
                        >
                          <option>Deutsch</option>
                          <option>Englisch</option>
                        </select>
                      </label>
                      <label>
                        Qualitätsprofil
                        <select
                          value={quality}
                          onChange={(e) => setQuality(e.target.value)}
                        >
                          <option>1080p · ausgewogen</option>
                          <option>Originalqualität</option>
                        </select>
                      </label>
                    </div>
                    <p>
                      Hardwarebeschleunigung: erst nach echter Geräteprüfung
                      verfügbar.
                    </p>
                  </>
                )}
                {stage === 5 && (
                  <>
                    <h2>Ein Plan für deinen gesamten Stack</h2>
                    {mode === "real" && (
                      <DeploymentCheck
                        selected={selected}
                        path={path}
                        username={username}
                        vpn={vpn}
                        vpnProfileId={vpnProfileId}
                        language={language}
                        quality={quality}
                        couchdeck={couchdeck}
                        couchdeckYoutube={couchdeckYoutube}
                        remote={remote}
                        viewer={viewer}
                        adopt={adopt}
                        onPlanState={setPlanHint}
                        onStarted={() => setStage(6)}
                      />
                    )}
                    <p>
                      {p.selected.length} Apps · {p.connections.length}{" "}
                      Verbindungen · VPN{" "}
                      {vpn
                        ? mode === "real"
                          ? "Mullvad · mit echter Ausfallsperrenprüfung"
                          : "Mullvad (Simulation)"
                        : "aus"}
                    </p>
                    <div className="tile">
                      <b>{path}</b>
                      <p>
                        Benutzer: {username} · {language} · {quality}
                      </p>
                      <p>
                        Neue Apps erhalten eigene Konten. Bei Erweiterungen
                        bleiben installierte Apps und ihre Pfade erhalten. Das
                        Qualitätsprofil bleibt zunächst eine Empfehlung für
                        spätere Medienanfragen.
                      </p>
                    </div>
                    <div className="notice">
                      <b>Echte Vorprüfung</b>
                      <p>
                        {inventory
                          ? `${inventory.release} · Docker ${inventory.docker.available ? "erreichbar" : "nicht erreichbar"} · ${inventory.containers.length} Container beobachtet`
                          : "Server noch nicht geprüft."}
                      </p>
                      <p>
                        {storage && storage.requested === path
                          ? `Speicherpfad geprüft: ${storage.writable ? "Prozess hat Schreibzugriff" : "Schreibzugriff fehlt"}`
                          : "Speicherpfad noch nicht geprüft."}
                      </p>
                      <p>
                        Der echte Installationsplan prüft Server und Auswahl
                        automatisch neu. Bestehende Dienste und Daten werden
                        nicht automatisch übernommen.
                      </p>
                    </div>
                    {!installed.length &&
                      inventory?.containers.some(
                        (c) =>
                          c.component &&
                          p.selected.some(
                            (s) => s.toLowerCase() === c.component,
                          ),
                      ) && (
                        <p className="warning">
                          Eine ausgewählte App ist bereits vorhanden und soll
                          auf diesem Testserver ersetzt werden. Vor der echten
                          Installation müssen alte Container oder Dienste
                          gezielt abgelöst werden. Konfigurationsdaten bleiben
                          standardmäßig erhalten. Die reine Planung verändert
                          noch nichts.
                        </p>
                      )}
                    {inventory &&
                      portConflicts(
                        selected.filter((n) => !installed.includes(n)),
                        inventory.listening,
                      ).map((c) => (
                        <p className="warning" key={c.component}>
                          Standard-Webport {c.port} für {c.component} ist
                          bereits belegt. Vor einer echten Installation muss der
                          Portkonflikt gelöst werden.
                        </p>
                      ))}
                    <h3>Automatische Verbindungen</h3>
                    {p.connections.length ? (
                      <ul>
                        {p.connections.map(([a, b]) => (
                          <li key={a + b}>
                            {a} → {b}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>Keine Verbindungen in dieser Auswahl.</p>
                    )}
                    <p>
                      Die Simulation verändert nichts. Der gesondert bestätigte
                      echte Installationsplan erzeugt neue Dienstzugänge.
                    </p>
                    {mode === "simulation" && (
                      <>
                        {" "}
                        <label>
                          <input
                            type="checkbox"
                            checked={confirmed}
                            onChange={(e) => setConfirmed(e.target.checked)}
                          />{" "}
                          Ich möchte diesen Gesamtplan simulieren.
                        </label>
                      </>
                    )}
                  </>
                )}
                {stage < 6 && (
                  <div aria-live="polite">
                    {(stage === 5 || on(4) ? p.errors : []).map((e) => (
                      <p className="error" key={e}>
                        {e}
                      </p>
                    ))}
                    {stage === 5 &&
                      p.warnings.map((w) => (
                        <p className="warning" key={w}>
                          {w}
                        </p>
                      ))}
                  </div>
                )}
                {stage === 6 && mode === "real" && remote && <RemoteSetupPanel auto />}
                {stage === 6 && mode === "real" && (
                  <DeploymentCheck
                    selected={selected}
                    path={path}
                    username={username}
                    vpn={vpn}
                    vpnProfileId={vpnProfileId}
                    language={language}
                    quality={quality}
                    couchdeck={couchdeck}
                    couchdeckYoutube={couchdeckYoutube}
                    remote={remote}
                    viewer={viewer}
                    adopt={adopt}
                    showPlanner={false}
                  />
                )}
                {stage === 6 && mode === "real" && selected.includes("Jellyfin") && (
                  <details className="setup-remote-access">
                    <summary>Fernzugriff einrichten · Authentik, MFA und Jellyfin</summary>
                    <p>
                      Nach der erfolgreichen Medieninstallation geht es hier mit
                      Authentik, Zuschauerkonten, MFA, sicherem Jellyfin und privatem
                      HTTPS weiter. Vorhandene Einrichtungen werden über dieselben
                      Prüfungen wie unter Verwaltung fortgesetzt. Eine öffentliche
                      Freigabe wird dadurch nicht aktiviert.
                    </p>
                    <p>
                      In der privaten Authentik-Verwaltung unter Verzeichnis →
                      Benutzer einen Zuschauer ohne Administratorrechte anlegen,
                      der Gruppe stackpilot-viewers zuordnen und für dieses Konto
                      MFA einrichten. Das Administratorkonto bleibt getrennt.
                    </p>
                    <RemoteAccessView />
                  </details>
                )}
                {stage === 6 && mode === "simulation" && job && (
                  <>
                    <h2>
                      {job.done === job.steps.length
                        ? "Simulation abgeschlossen"
                        : job.paused
                          ? "Einrichtung pausiert"
                          : "Dein Stack wird simuliert eingerichtet"}
                    </h2>
                    <p>
                      Ein Gesamtauftrag · <code>{job.id.slice(0, 8)}</code>
                    </p>
                    <progress value={job.done} max={job.steps.length} />
                    <p aria-live="polite">
                      {job.done} von {job.steps.length} Schritten simuliert
                    </p>
                    <ul className="jobs">
                      {job.steps.map((s, i) => (
                        <li key={s}>
                          {i < job.done ? "✓" : i === job.done ? "◉" : "○"} {s}
                        </li>
                      ))}
                    </ul>
                    {busy ? (
                      <button
                        onClick={() =>
                          setJob((j) => (j ? { ...j, paused: !j.paused } : j))
                        }
                      >
                        {job.paused ? "Gezielt fortsetzen" : "Pausieren"}
                      </button>
                    ) : (
                      <>
                        <p>
                          Es wurden keine Anwendungen installiert, Konten
                          erstellt oder VPN-Verbindungen geprüft.
                        </p>
                        <button
                          onClick={() => {
                            try {
                              localStorage.removeItem(key);
                            } catch {}
                            setJob(null);
                            setConfirmed(false);
                            setStage(0);
                          }}
                        >
                          Neue Simulation
                        </button>
                      </>
                    )}
                  </>
                )}
              </section>
              {stage < 6 && (
                <footer>
                  <button
                    disabled={page === 0}
                    onClick={() => setStage(pages[page - 1].stages[0])}
                  >
                    Zurück
                  </button>
                  <span>
                    {page + 1} / {pages.length}
                  </span>
                  {stage === 5 && mode === "real" ? (
                    <span role="status">{planHint}</span>
                  ) : stage === 5 ? (
                    <button
                      className="primary"
                      disabled={p.errors.length > 0 || !confirmed || !!job}
                      onClick={start}
                    >
                      Gesamten Stack simulieren
                    </button>
                  ) : (
                    <button
                      className="primary"
                      onClick={() => {
                        setConfirmed(false);
                        setStage(pages[page + 1].stages[0]);
                      }}
                    >
                      Weiter
                    </button>
                  )}
                </footer>
              )}
            </>
          )}
          {view === "Stack konfigurieren" && (
            <p className="muted bottom">
              Aufträge bleiben gespeichert und können fortgesetzt werden.
              Diagnose und Verlauf findest du unter Verwaltung.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <AuthGate>
    <App />
  </AuthGate>,
);
