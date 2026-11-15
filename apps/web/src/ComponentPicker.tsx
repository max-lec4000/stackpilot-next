import { components } from "../../../packages/domain/planner.js";
import { apps } from "../../../packages/domain/apps.js";
const groups = [
  {
    id: "media",
    title: "Jellyfin & Erweiterungen",
    description: "Medien, Statistiken und Anfragen",
    apps: components.filter((name) => apps[name as keyof typeof apps]?.group === "media"),
  },
  {
    id: "arr",
    title: "ARR-Suite",
    description: "Bibliotheken, Indexer und Untertitel",
    apps: components.filter((name) => apps[name as keyof typeof apps]?.group === "arr"),
  },
  {
    id: "download",
    title: "qBittorrent & VPN",
    description: "Downloads mit optionalem Mullvad-Schutz",
    apps: components.filter((name) => apps[name as keyof typeof apps]?.group === "download"),
  },
];
const details: Record<string, [string, string]> = Object.fromEntries(
  Object.entries(apps).map(([name, app]) => [name, [app.icon, app.label]]),
);
export function ComponentPicker({
  selected,
  onChange,
  installed,
  existing,
  support,
  real,
}: {
  selected: string[];
  onChange: (names: string[]) => void;
  installed: string[];
  existing: string[];
  support: Record<string, { installable: boolean }>;
  real: boolean;
}) {
  const locked = (n: string) =>
    real && (installed.includes(n) || existing.includes(n));
  function toggleAll(names: string[]) {
    const available = names.filter((n) => !locked(n));
    const remove =
      available.length > 0 && available.every((n) => selected.includes(n));
    onChange([
      ...new Set([
        ...selected.filter((n) => !remove || !available.includes(n)),
        ...(!remove ? available : []),
        ...(real ? installed : []),
      ]),
    ]);
  }
  return (
    <>
      <div className="row">
        <h2>Welche Apps möchtest du?</h2>
        <button
          disabled={components.every(locked)}
          onClick={() => toggleAll(components)}
        >
          {components
            .filter((n) => !locked(n))
            .every((n) => selected.includes(n))
            ? "Neue Auswahl aufheben"
            : "Alle auswählen"}
        </button>
      </div>
      <p className="muted">
        Wähle deine Apps in drei Bereichen. Ein bestätigter Gesamtauftrag
        richtet alle neu gewählten Apps gemeinsam ein und verbindet sie.
      </p>
      <button
        onClick={() =>
          onChange([
            ...new Set([
              ...(real ? installed : []),
              ...components.filter(
                (n) => support[n]?.installable && !locked(n),
              ),
            ]),
          ])
        }
      >
        Alle freigegebenen Pilot-Apps wählen
      </button>
      {real && installed.length > 0 && (
        <p className="notice">
          ✓ {installed.length} Apps werden bereits von StackPilot verwaltet. Sie
          bleiben ausgewählt und werden nicht erneut installiert.
        </p>
      )}
      {real && existing.length > 0 && (
        <p className="warning">
          Vorhandene fremde Installationen sind gesperrt. Im Server-Schritt
          zuerst gezielt ablösen oder weiter beobachten; keine automatische
          Übernahme.
        </p>
      )}
      <div className="app-groups">
        {groups.map((group) => (
          <section
            className={`app-group group-${group.id}`}
            key={group.id}
            aria-labelledby={`group-${group.id}`}
          >
            <div className="row">
              <div>
                <h3 id={`group-${group.id}`}>{group.title}</h3>
                <p className="muted">{group.description}</p>
              </div>
              <button
                onClick={() => toggleAll(group.apps)}
                disabled={group.apps.every(locked)}
              >
                Gruppe auswählen / aufheben
              </button>
            </div>
            <div className="grid">
              {group.apps.map((name) => {
                const managed = real && installed.includes(name),
                  foreign = real && existing.includes(name) && !managed;
                return (
                  <label
                    className={`tile app-card ${selected.includes(name) ? "chosen" : ""} ${managed ? "installed" : foreign ? "unavailable" : ""}`}
                    data-app={name}
                    key={name}
                  >
                    <input
                      type="checkbox"
                      checked={managed || (!foreign && selected.includes(name))}
                      disabled={locked(name)}
                      onChange={() =>
                        onChange(
                          selected.includes(name)
                            ? selected.filter((n) => n !== name)
                            : [...selected, name],
                        )
                      }
                    />
                    <span className="app-icon" aria-hidden="true">
                      {details[name][0]}
                    </span>
                    <b>{name}</b>
                    <small className="capability">
                      {managed
                        ? "✓ Installiert · bleibt erhalten"
                        : foreign
                          ? "Bereits vorhanden · gesperrt"
                          : support[name]?.installable
                            ? "Pilot bereit"
                            : "Noch nicht freigegeben"}
                    </small>
                    <p>{details[name][1]}</p>
                    {foreign && (
                      <small>
                        Zuerst im Server-Schritt ablösen. Daten werden dabei
                        behalten.
                      </small>
                    )}
                  </label>
                );
              })}
            </div>
            {group.id === "media" && (
              <p className="muted">
                Jellyfin-Plugins erhalten später eine eigene Auswahl. Noch keine
                automatische Plugin-Installation.
              </p>
            )}
            {group.id === "download" && (
              <p className="muted">
                Mullvad und den WireGuard-Import findest du im Schritt
                „Optionen“.
              </p>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
