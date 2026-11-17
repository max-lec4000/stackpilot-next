import { useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
export function SizeSettings() {
  const [data, setData] = useState<{
      rate: number;
      capGiB?: number;
      rates: number[];
      scope: string;
      shared?: {state:string;message:string};
    } | null>(null),
    [rate, setRate] = useState(0),
    [fixed, setFixed] = useState(false),
    [cap, setCap] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function load() {
    setBusy(true);
    setError("");
    try {
      const result = await get<NonNullable<typeof data>>("/api/media/size-settings");
      setData(result);
      setRate(result.rate);
      setFixed(!!result.capGiB);
      setCap(result.capGiB ? String(result.capGiB) : "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => { void load(); }, []);
  return (
    <div className="tile">
      <h3>Größe neuer Filmanfragen</h3>
      <p>
        Gemeinsamer Standard für neue Filmanfragen: 1080p ohne Remux mit einer
        festen oder laufzeitabhängigen Obergrenze. Eine kleinere Grenze kann verfügbare
        Veröffentlichungen ausschließen.
      </p>
      {!data && !error && <p role="status">Medienprofile werden geladen …</p>}
      {!data && error && <button disabled={busy} onClick={() => void load()}>Erneut laden</button>}
      {data && (
        <>
          <p>{data.scope}</p>
          {data.shared && <p role="status">{data.shared.message}</p>}
          <label>
            Größenstandard
            <select
              aria-label="Größenstandard"
              value={fixed ? "fixed" : rate}
              onChange={(e) => {
                setFixed(e.target.value === "fixed");
                if (e.target.value !== "fixed") setRate(Number(e.target.value));
              }}
            >
              <option value={0}>Kein zusätzlicher Größenstandard</option>
              <option value="fixed">Feste Obergrenze pro Film</option>
              {data.rates.map((r) => (
                <option key={r} value={r}>
                  {r} GiB pro Stunde · maximal {r * 2} GiB bei 120 Minuten
                </option>
              ))}
            </select>
          </label>
          {fixed && (
            <label>
              Maximale Downloadgröße je Film (GiB)
              <input type="number" min="0.5" max="200" step="0.5"
                value={cap} onChange={(e) => setCap(e.target.value)} />
            </label>
          )}
          <p>
            Bei einer Laufzeitregel wird die Grenze pro Film auf die nächste halbe GiB aufgerundet.
            Vorhandene Dateien und andere Profile werden nicht geändert. Ohne
            bekannte Laufzeit kann eine feste Grenze verwendet werden.
          </p>
          <button
            className="primary"
            disabled={busy || (fixed && !(Number(cap) >= 0.5 && Number(cap) <= 200 && Number.isInteger(Number(cap) * 2)))}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const result = await action<{ message: string }>(
                  "/api/media/size-settings",
                  { rate: fixed ? 0 : rate, capGiB: fixed ? Number(cap) : 0, confirmation: "OK" },
                );
                setMessage(result.message);
                await load();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            OK – Standard für neue Filmanfragen speichern
          </button>
        </>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
