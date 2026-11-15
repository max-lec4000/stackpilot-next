import { useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
export function SizeSettings() {
  const [data, setData] = useState<{
      rate: number;
      rates: number[];
      scope: string;
    } | null>(null),
    [rate, setRate] = useState(0),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  return (
    <div className="tile">
      <h3>Größe neuer Filmanfragen</h3>
      <p>
        Ein eigener Standard für StackPilot: 1080p ohne Remux mit einer
        Obergrenze nach Laufzeit. Eine kleinere Grenze kann verfügbare
        Veröffentlichungen ausschließen.
      </p>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const result = await get<{
              rate: number;
              rates: number[];
              scope: string;
            }>("/api/media/size-settings");
            setData(result);
            setRate(result.rate);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Medienprofile laden
      </button>
      {data && (
        <>
          <p>{data.scope}</p>
          <label>
            Größenstandard
            <select
              aria-label="Größenstandard"
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
            >
              <option value={0}>Kein zusätzlicher Größenstandard</option>
              {data.rates.map((r) => (
                <option key={r} value={r}>
                  {r} GiB pro Stunde · maximal {r * 2} GiB bei 120 Minuten
                </option>
              ))}
            </select>
          </label>
          <p>
            Die Grenze wird pro Film auf die nächste halbe GiB aufgerundet.
            Vorhandene Dateien und andere Profile werden nicht geändert. Ohne
            bekannte Laufzeit wird keine neue begrenzte Anfrage gestartet.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const result = await action<{ message: string }>(
                  "/api/media/size-settings",
                  { rate, confirmation: "OK" },
                );
                setMessage(result.message);
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
