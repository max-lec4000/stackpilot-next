import { sourceFieldSupported } from "../../../packages/domain/source-fields.js";
import { useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
type Field = {
  name: string;
  label: string;
  type: string;
  secret: boolean;
  value: unknown;
  advanced: boolean;
  helpText?: string;
  choices: { value: number | string; name: string }[];
};
type Schema = { key: string; name: string; privacy: string; fields: Field[] };
type SourceData = {
  schemas: Schema[];
  sources:
    | {
        id: number;
        name: string;
        enabled: boolean;
        protocol: string;
        privacy: string;
      }[]
    | null;
  connections: { name: string; syncLevel: string }[] | null;
  issues?: { section: string; code: string; message: string }[];
  note: string;
};
export function SourcesView() {
  const [data, setData] = useState<SourceData | null>(null),
    [selected, setSelected] = useState(""),
    [filter, setFilter] = useState(""),
    [name, setName] = useState(""),
    [values, setValues] = useState<Record<string, unknown>>({}),
    [advanced, setAdvanced] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [draft, setDraft] = useState<{ id: string; name: string } | null>(null);
  const [editing, setEditing] = useState<(Schema & { id: number }) | null>(
    null,
  );
  const schema = editing || data?.schemas.find((v) => v.key === selected);
  async function refresh() {
    setBusy(true);
    try {
      setData(await get("/api/sources"));
      setError("");
    } catch (e) {
      setData(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function openEditor(id: number) {
    setBusy(true);
    setError("");
    try {
      const source = await get<Schema & { id: number }>("/api/sources/detail?id=" + id);
      setEditing(source);
      setName(source.name);
      setValues({});
      setDraft(null);
      setMessage("");
      setAdvanced(false);
      setTimeout(() => document.querySelector(".source-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  // „Zugang erneuern“ aus dem Zustand der Quellen (Paket 7.3) öffnet hier den Bearbeiten-Dialog
  useEffect(() => {
    const onEdit = (e: Event) => void openEditor(Number((e as CustomEvent<number>).detail));
    window.addEventListener("stackpilot:edit-source", onEdit);
    return () => window.removeEventListener("stackpilot:edit-source", onEdit);
  }, []);
  function choose(key: string) {
    setEditing(null);
    setSelected(key);
    const next = data?.schemas.find((v) => v.key === key);
    setName(next?.name || "");
    setValues({});
    setDraft(null);
    setError("");
    setMessage("");
  }
  function update(key: string, value: unknown) {
    setValues((v) => ({ ...v, [key]: value }));
    setDraft(null);
    setMessage("");
  }
  async function perform(task: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await task();
      setMessage(success);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const unsupported = schema?.fields.some((f) => !sourceFieldSupported(f.type));
  return (
    <>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <div className="row">
        <h2>Deine Quellen</h2>
        <button disabled={busy} onClick={() => void refresh()}>
          Aktualisieren
        </button>
      </div>
      {!data && (
        <p role="status">
          {busy
            ? "Quellen werden abgefragt …"
            : "Quellen konnten nicht geladen werden. Die Anzahl und der Zustand deiner Quellen sind unbekannt. Bitte erneut aktualisieren."}
        </p>
      )}
      {data && (
        <>
          <p className="muted">{data.note}</p>
          {data.issues?.map((issue) => (
            <p className="notice" role="alert" key={issue.section}>
              <b>{issue.section}:</b> {issue.message}{" "}
              <small>[{issue.code}]</small>
            </p>
          ))}
          {data.sources === null ? (
            <p>
              Die eingerichteten Quellen konnten nicht abgefragt werden. Das
              bedeutet nicht, dass keine Quellen vorhanden sind.
            </p>
          ) : data.sources.length ? (
            data.sources.map((v) => (
              <article className="tile source-row" key={v.id}>
                <div>
                  <b>{v.name}</b>
                  <p>
                    {v.enabled ? "Aktiv" : "Deaktiviert"} · {v.protocol} ·{" "}
                    {v.privacy}
                  </p>
                </div>
                <div className="button-group">
                  <button disabled={busy} onClick={() => void openEditor(v.id)}>
                    Bearbeiten
                  </button>

                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(
                        () =>
                          action("/api/sources/action", {
                            id: v.id,
                            action: "test",
                          }),
                        "Verbindung erfolgreich geprüft.",
                      )
                    }
                  >
                    Verbindung testen
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(
                        () =>
                          action("/api/sources/action", {
                            id: v.id,
                            action: "toggle",
                            enabled: !v.enabled,
                          }),
                        v.enabled
                          ? "Quelle deaktiviert."
                          : "Quelle aktiviert und geprüft.",
                      )
                    }
                  >
                    {v.enabled ? "Deaktivieren" : "Aktivieren"}
                  </button>
                </div>
              </article>
            ))
          ) : (
            <p>Noch keine Quellen eingerichtet.</p>
          )}
          <details>
            <summary>Verbindungen zu den ARR-Apps</summary>
            {data.connections === null ? (
              <p>ARR-Verbindungen konnten nicht abgefragt werden.</p>
            ) : data.connections.length ? (
              data.connections.map((c, i) => (
                <p key={i}>
                  {c.name} · {c.syncLevel}
                </p>
              ))
            ) : (
              <p>
                Keine Verbindung eingerichtet. Unter Verwaltung → Verbindungen
                prüfen.
              </p>
            )}
          </details>
          <section className="tile source-editor">
            <h2>{editing ? "Quelle bearbeiten" : "Quelle hinzufügen"}</h2>
            {editing && (
              <>
                <p>
                  Leere Zugangsfelder behalten gespeicherte Werte bei.
                  Änderungen werden vor dem Speichern getestet.
                </p>
                <button onClick={() => choose("")} disabled={busy}>
                  Bearbeitung abbrechen
                </button>
              </>
            )}
            {!data.schemas.length && (
              <p className="notice">
                Der Anbieterkatalog ist gerade nicht verfügbar oder enthält
                keine Torrent-Anbieter. Bestehende Quellen bleiben erhalten.
              </p>
            )}
            <p>
              Wähle einen Anbieter aus dem Prowlarr-Katalog. Bestehende Quellen
              und deren Zugangsdaten werden nicht überschrieben.
            </p>
            {!editing && (
              <>
                <label>
                  Anbieter filtern
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Name der Quelle"
                  />
                </label>
                <label>
                  Anbieter
                  <select
                    aria-label="Anbieter"
                    value={selected}
                    disabled={busy}
                    onChange={(e) => choose(e.target.value)}
                  >
                    <option value="">Bitte auswählen</option>
                    {data.schemas
                      .filter((s) =>
                        s.name.toLowerCase().includes(filter.toLowerCase()),
                      )
                      .map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.name} · {s.privacy}
                        </option>
                      ))}
                  </select>
                </label>
              </>
            )}
            {schema && (
              <>
                <label>
                  Eigener Name
                  <input
                    value={name}
                    maxLength={100}
                    disabled={busy}
                    onChange={(e) => {
                      setName(e.target.value);
                      setDraft(null);
                    }}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={advanced}
                    onChange={(e) => setAdvanced(e.target.checked)}
                  />
                  Erweiterte Einstellungen anzeigen
                </label>
                {schema.fields
                  .filter((f) => advanced || !f.advanced)
                  .map((f) => {
                    const value = values[f.name] ?? f.value;
                    if (f.type === "info")
                      return (
                        <div key={f.name} className="source-help">
                          <b>{f.label}</b>
                          <p>{String(f.value ?? "")}</p>
                        </div>
                      );
                    return (
                      <label key={f.name}>
                        {f.label}
                        {f.type === "checkbox" ? (
                          <input
                            type="checkbox"
                            aria-label={f.label}
                            disabled={busy}
                            checked={Boolean(value)}
                            onChange={(e) => update(f.name, e.target.checked)}
                          />
                        ) : f.type === "select" && f.choices.length ? (
                          <select
                            aria-label={f.label}
                            disabled={busy}
                            value={String(value ?? "")}
                            onChange={(e) => update(f.name, e.target.value)}
                          >
                            <option value="">Bitte auswählen</option>
                            {f.choices.map((c) => (
                              <option key={c.value} value={c.value}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            aria-label={f.label}
                            disabled={busy}
                            type={
                              f.secret
                                ? "password"
                                : f.type === "number"
                                  ? "number"
                                  : "text"
                            }
                            autoComplete="off"
                            step={f.type === "number" ? "any" : undefined}
                            list={
                              f.name.toLowerCase() === "baseurl" &&
                              f.choices.length
                                ? "source-base-addresses"
                                : undefined
                            }
                            value={
                              Array.isArray(value)
                                ? value.join(", ")
                                : String(value ?? "")
                            }
                            onChange={(e) =>
                              update(
                                f.name,
                                ["tag", "selectMultiple"].includes(f.type)
                                  ? e.target.value
                                      .split(",")
                                      .map((v) => v.trim())
                                      .filter(Boolean)
                                  : e.target.value,
                              )
                            }
                            placeholder={
                              ["tag", "selectMultiple"].includes(f.type)
                                ? "Werte durch Komma trennen"
                                : f.secret
                                  ? "Zugangsdaten eingeben"
                                  : ""
                            }
                          />
                        )}
                        {f.name.toLowerCase() === "baseurl" &&
                          f.choices.length > 0 && (
                            <datalist id="source-base-addresses">
                              {f.choices.map((c) => (
                                <option key={c.value} value={String(c.value)}>
                                  {c.name}
                                </option>
                              ))}
                            </datalist>
                          )}
                        {f.helpText && (
                          <small className="muted source-help-text">
                            {f.helpText}
                          </small>
                        )}
                      </label>
                    );
                  })}
                {unsupported && (
                  <p className="notice">
                    Diese Quelle benötigt einen speziellen Einrichtungsdialog.
                    Richte sie vorerst direkt in Prowlarr ein; sie erscheint
                    danach hier.
                  </p>
                )}
                <p className="muted">
                  Der Test kontaktiert die gewählte Quelle. Zugangsdaten werden
                  nicht an den Browser zurückgegeben. Keine automatische
                  Torrent-Suche durch StackPilot.
                </p>
                <button
                  className="primary"
                  disabled={busy || !name.trim() || !!unsupported}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    setMessage("");
                    try {
                      setDraft(
                        await action("/api/sources/test", {
                          schema: selected,
                          name,
                          values,
                          sourceId: editing?.id,
                        }),
                      );
                      setValues((v) =>
                        Object.fromEntries(
                          Object.entries(v).filter(
                            ([key]) =>
                              !schema.fields.find((f) => f.name === key)
                                ?.secret,
                          ),
                        ),
                      );
                      setMessage(
                        "Verbindung geprüft. Jetzt kannst du diese Quelle speichern.",
                      );
                    } catch (e) {
                      setDraft(null);
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Wird geprüft …" : "Quelle testen"}
                </button>
                {draft && (
                  <div className="notice">
                    <p>
                      „{draft.name}“ wurde geprüft.{" "}
                      {editing
                        ? "Beim Speichern werden die getesteten Einstellungen übernommen."
                        : "Beim Speichern wird die Quelle in Prowlarr aktiviert."}
                    </p>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await action("/api/sources/save", {
                            id: draft.id,
                            confirmation: "OK",
                          });
                          setDraft(null);
                          setSelected("");
                          setEditing(null);
                          setValues({});
                        }, "Quelle gespeichert. Prowlarr übernimmt die Synchronisierung mit den ARR-Apps.")
                      }
                    >
                      {editing
                        ? "Geprüfte Änderungen speichern"
                        : "Geprüfte Quelle speichern"}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
