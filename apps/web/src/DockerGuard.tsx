import { useEffect, useState } from "react";
import { get } from "./ServerCheck";
import { action } from "./RetirementPanel";
import { ConfirmBar, useAction } from "./ui";

type Denial = { at: string; method: string; path: string; reasons: string[]; blocked: boolean };
type Status =
  | { mode: "off" | "unreachable" }
  | {
      mode: "observe" | "enforce";
      since: string;
      allowed: number;
      denied: number;
      recent: Denial[];
      roots: string[];
      rejectedRoots: { path: string; problem: string }[];
    };

const SCRIPT = "sudo /opt/stackpilot/app/deploy/docker-guard.sh";
const time = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
};

/** Docker-Wächter: Zustand, Verstöße und (nur) Scharfschalten. */
export function DockerGuard() {
  const [status, setStatus] = useState<Status | null>(null),
    [confirm, setConfirm] = useState(false),
    [waiting, setWaiting] = useState(false);
  const { busy, error, notice, setError, setNotice, run } = useAction();
  async function load() {
    try {
      const s = await get<Status>("/api/docker-guard");
      setStatus(s);
      return s;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }
  useEffect(() => {
    void load();
  }, []);
  // Nach dem Umstellen startet StackPilot neu – warten, bis der Wächter „sperren“ meldet
  useEffect(() => {
    if (!waiting) return;
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      const s = await get<Status>("/api/docker-guard").catch(() => null);
      if (s?.mode === "enforce") {
        setStatus(s);
        setWaiting(false);
        setNotice("Der Wächter sperrt jetzt nicht erlaubte Docker-Aufrufe.");
      } else if (tries > 30) {
        setWaiting(false);
        setError(`Noch nicht umgestellt. Am Server nachsehen: ${SCRIPT} status`);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [waiting]);

  const active = status && (status.mode === "observe" || status.mode === "enforce") ? status : null;
  return (
    <div className="tile docker-guard">
      <p>
        StackPilot spricht Docker über einen Wächter an, der nur die nötigen Aufrufe durchlässt. Neue Container
        dürfen dabei nur die Datenordner des Stacks einbinden – keine Systemordner, keine vollen Rechte, kein Zugriff
        auf Docker selbst.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success" role="status">{notice}</p>}
      {!status && !error && <p className="muted">Wird geladen …</p>}
      {status?.mode === "off" && (
        <p>
          <b>Aus</b> – StackPilot spricht Docker direkt an. Einschalten am Server: <code>{SCRIPT} observe</code>
        </p>
      )}
      {status?.mode === "unreachable" && (
        <p className="error">
          Der Wächter antwortet nicht – Docker-Aufgaben schlagen dann fehl. Am Server prüfen: <code>{SCRIPT} status</code>
        </p>
      )}
      {active && (
        <>
          <p>
            <span className={"badge " + (active.mode === "enforce" ? "badge-ok" : "badge-warn")}>
              {active.mode === "enforce" ? "Sperrt" : "Beobachtet"}
            </span>{" "}
            seit {time(active.since)}: {active.allowed} Aufrufe erlaubt,{" "}
            {active.mode === "enforce" ? `${active.denied} gesperrt` : `${active.denied} wären gesperrt worden`}.
          </p>
          {!!active.recent.length && (
            <details open={active.mode === "observe"}>
              <summary>Letzte Verstöße ({active.recent.length})</summary>
              <ul className="docker-guard-list">
                {active.recent.map((d, i) => (
                  <li key={i}>
                    <span className="muted">{time(d.at)}</span> <code>{d.method} {d.path}</code> – {d.reasons.join(", ")}
                    {!d.blocked && <span className="muted"> (nur beobachtet)</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details>
            <summary>Erlaubte Datenordner ({active.roots.length})</summary>
            <ul className="docker-guard-list">
              {active.roots.map((r) => <li key={r}><code>{r}</code></li>)}
            </ul>
            {!!active.rejectedRoots.length && (
              <>
                <p className="error">Vom Wächter abgelehnte Ordner:</p>
                <ul className="docker-guard-list">
                  {active.rejectedRoots.map((r) => <li key={r.path}><code>{r.path}</code> – {r.problem}</li>)}
                </ul>
              </>
            )}
          </details>
          {active.mode === "observe" && !confirm && (
            <button disabled={!!busy || waiting} onClick={() => setConfirm(true)}>
              {waiting ? "Wird umgestellt …" : "Jetzt sperren"}
            </button>
          )}
          {active.mode === "observe" && confirm && (
            <ConfirmBar label="Docker-Wächter scharf schalten" busy={busy === "enforce"} busyLabel="Wird umgestellt …"
              onCancel={() => setConfirm(false)}
              onOk={() => run("enforce", async () => {
                await action("/api/docker-guard/enforce", { confirmation: "OK" });
                setConfirm(false);
                setWaiting(true);
                return "Wird umgestellt – StackPilot startet dafür kurz neu.";
              })}>
              <p>
                Ab jetzt lehnt der Wächter nicht erlaubte Docker-Aufrufe ab. StackPilot startet dafür kurz neu.
                {active.denied > 0 && <> <b>Achtung:</b> {active.denied} Aufrufe wären gesperrt worden – diese Abläufe schlagen dann fehl.</>}
              </p>
              <p className="muted">
                Dein Serverkonto verliert dabei die Gruppe „docker“: <code>docker …</code> geht dort dann nur noch mit sudo.
                Zurück nur am Server: <code>{SCRIPT} observe</code>
              </p>
            </ConfirmBar>
          )}
          {active.mode === "enforce" && (
            <p className="muted">Lockern oder ausschalten geht nur am Server: <code>{SCRIPT} observe</code> bzw. <code>off</code></p>
          )}
        </>
      )}
    </div>
  );
}
