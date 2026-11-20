// Docker-Wächter: Unix-Socket für StackPilot, leitet nur erlaubte Docker-API-Aufrufe an den
// Docker-Socket des Hosts weiter. Modus „observe“ protokolliert Verstöße nur, „enforce“ lehnt
// sie mit 403 ab. Läuft als root (systemd: stackpilot-docker-guard.service).
//   node guard.js /etc/stackpilot/docker-guard.json
//
// Konfiguration (gehört root): { listen, upstream, mode, group, roots, rootsFile, log }
//   roots      feste erlaubte Ordner (Zustandsordner von StackPilot)
//   rootsFile  von StackPilot gemeldete Datenordner – jeder wird mit rootProblem() geprüft
//   group      Gruppe, die den Socket nutzen darf
//   log        optional: Datei für alle Aufrufe (Fehlersuche); Verstöße stehen immer im Journal
import http from "node:http";
import fs from "node:fs";
import nodePath from "node:path";
import { routeAllowed, checkCreate, checkExec, checkVolume, checkNetwork, bare, rootProblem } from "./policy.js";

const config = JSON.parse(fs.readFileSync(process.argv[2] || "/etc/stackpilot/docker-guard.json", "utf8"));
const { listen, upstream = "/var/run/docker.sock", group = null, rootsFile = null, log = null } = config;
const mode = config.mode === "observe" ? "observe" : "enforce"; // Unbekanntes zählt als „sperren“
const STATUS_PATH = "/_stackpilot/guard";

const realOrNull = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
const fixedRoots = (config.roots || []).map((r) => realOrNull(r) || r);
const homes = () => {
  try {
    return fs.readFileSync("/etc/passwd", "utf8").split("\n").map((l) => l.split(":")[5]).filter(Boolean);
  } catch { return []; }
};

// Gemeldete Datenordner: neu einlesen, sobald sich die Datei ändert
let reported = { mtime: -1, roots: [], rejected: [] };
function currentRoots() {
  if (!rootsFile) return fixedRoots;
  let mtime = 0;
  try { mtime = fs.statSync(rootsFile).mtimeMs; } catch {}
  if (mtime !== reported.mtime) {
    let list = [];
    try { list = mtime ? JSON.parse(fs.readFileSync(rootsFile, "utf8")).roots || [] : []; } catch {}
    const roots = [], rejected = [], h = homes();
    for (const p of Array.isArray(list) ? list.slice(0, 50) : []) {
      const problem = rootProblem(p, { real: typeof p === "string" ? realOrNull(p) : null, homes: h });
      if (problem) rejected.push({ path: String(p).slice(0, 300), problem }); else roots.push(p);
    }
    reported = { mtime, roots, rejected };
    write(`Datenordner: ${roots.join(", ") || "keine"}${rejected.length ? ` – abgelehnt: ${rejected.map((r) => `${r.path} (${r.problem})`).join(", ")}` : ""}`, true);
  }
  return [...fixedRoots, ...reported.roots];
}

// Echter Pfad wie Docker ihn sieht; fehlt der Ordner noch (Docker legt ihn an), zählt der
// nächste vorhandene Elternordner. Restrisiko: Verknüpfung wird zwischen Prüfung und Anlegen
// getauscht (siehe docs/zukunft/phase-7-konzept.md, 7.0c).
function resolve(p) {
  let rest = "";
  for (let dir = p; ; dir = nodePath.dirname(dir)) {
    const real = realOrNull(dir);
    if (real) return nodePath.join(real, rest);
    if (dir === "/") return p;
    rest = nodePath.join(nodePath.basename(dir), rest);
  }
}
const ctx = () => ({ roots: currentRoots(), resolve });
const CHECKS = {
  "/containers/create": (b) => checkCreate(b, ctx()),
  "/volumes/create": (b) => checkVolume(b, ctx()),
  "/networks/create": (b) => checkNetwork(b),
};

const stats = { since: new Date().toISOString(), allowed: 0, denied: 0, recent: [] };
function write(line, journal = false) {
  const text = `${new Date().toISOString()} ${line}\n`;
  if (log) { try { fs.appendFileSync(log, text); } catch {} }
  if (journal || line.startsWith("DENY")) process.stdout.write(line + "\n"); // Journal setzt die Zeit selbst
}
const allow = (method, path, extra = "") => { stats.allowed++; if (log) write(`ALLOW ${method} ${path}${extra}`); };
/** Verstoß zählen und protokollieren; true = Anfrage wurde abgelehnt (Sperrmodus). */
function deny(res, method, url, reasons) {
  const path = bare(url).slice(0, 200);
  stats.denied++;
  stats.recent.unshift({ at: new Date().toISOString(), method, path, reasons: reasons.slice(0, 10), blocked: mode === "enforce" });
  stats.recent.length = Math.min(stats.recent.length, 30);
  write(`DENY ${method} ${path} ${reasons.join(", ")}${mode === "enforce" ? "" : " (nur beobachtet)"}`);
  if (mode !== "enforce") return false;
  if (res) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: `StackPilot-Docker-Wächter: nicht erlaubt (${reasons.join(", ")})` }));
  }
  return true;
}

function status(res) {
  const roots = currentRoots();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ guard: true, mode, since: stats.since, allowed: stats.allowed, denied: stats.denied,
    recent: stats.recent, roots, rejectedRoots: reported.rejected }));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 4 * 1024 * 1024) throw Error("zu groß"); chunks.push(c); }
  return Buffer.concat(chunks);
}

function forward(req, res, body) {
  const up = http.request({ socketPath: upstream, method: req.method, path: req.url, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    // Docker sendet bei /wait erst die Kopfzeilen, den Inhalt erst beim Containerende –
    // die CLI startet den Container erst, wenn die Kopfzeilen da sind.
    res.flushHeaders();
    r.pipe(res);
  });
  up.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  res.on("close", () => up.destroy());
  if (body) up.end(body); else req.pipe(up);
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;
  const path = bare(url);
  if (method === "GET" && path === STATUS_PATH) return status(res);
  if (!routeAllowed(method, url) && deny(res, method, url, ["Aufruf nicht erlaubt"])) return;
  try {
    if (method === "POST" && (CHECKS[path] || /^\/containers\/[^/]+\/exec$/.test(path))) {
      const body = await readBody(req);
      const parsed = body.length ? JSON.parse(body) : {};
      const reasons = (CHECKS[path] || checkExec)(parsed);
      if (reasons.length && deny(res, method, url, reasons)) return;
      allow(method, path);
      return forward(req, res, body);
    }
    allow(method, path);
    forward(req, res, null);
  } catch {
    if (!res.headersSent) res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "StackPilot-Docker-Wächter: ungültige Anfrage" }));
  }
});

// exec/attach schalten auf einen rohen Datenstrom um (Upgrade) – nach der Prüfung durchreichen
server.on("upgrade", (req, socket, head) => {
  const { method, url } = req;
  socket.on("error", () => socket.destroy());
  if (!routeAllowed(method, url) && deny(null, method, url, ["Aufruf nicht erlaubt (Upgrade)"]))
    return socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
  allow(method, bare(url), " (Upgrade)");
  // Der Anfrageinhalt (z. B. {"Detach":false}) kommt mit den Kopfzeilen; Docker antwortet erst,
  // wenn er vollständig da ist. Also zuerst den Inhalt sammeln, dann den Datenstrom verbinden.
  const length = Math.min(Number(req.headers["content-length"] || 0), 1024 * 1024);
  let body = head || Buffer.alloc(0);
  const send = () => {
    const rest = body.subarray(length);
    const up = http.request({ socketPath: upstream, method, path: url, headers: req.headers });
    up.on("upgrade", (r, upSocket, upHead) => {
      socket.write(`HTTP/1.1 ${r.statusCode} ${r.statusMessage}\r\n` +
        Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n") + "\r\n\r\n");
      if (upHead?.length) socket.write(upHead);
      if (rest.length) upSocket.write(rest);
      upSocket.pipe(socket); socket.pipe(upSocket);
      upSocket.on("error", () => socket.destroy()); socket.on("close", () => upSocket.destroy());
    });
    up.on("response", (r) => { socket.end(`HTTP/1.1 ${r.statusCode} ${r.statusMessage}\r\nContent-Length: 0\r\n\r\n`); });
    up.on("error", () => socket.destroy());
    up.end(body.subarray(0, length));
  };
  if (body.length >= length) return send();
  const more = (chunk) => {
    body = Buffer.concat([body, chunk]);
    if (body.length >= length) { socket.off("data", more); socket.pause(); send(); socket.resume(); }
  };
  socket.on("data", more);
});

function groupId(name) {
  for (const line of fs.readFileSync("/etc/group", "utf8").split("\n")) {
    const [n, , gid] = line.split(":");
    if (n === name) return Number(gid);
  }
  throw Error(`Gruppe ${name} fehlt.`);
}

try { fs.unlinkSync(listen); } catch {}
server.listen(listen, () => {
  if (group) fs.chownSync(listen, 0, groupId(group));
  fs.chmodSync(listen, 0o660);
  write(`Wächter bereit (${mode === "enforce" ? "sperren" : "beobachten"}) auf ${listen}`, true);
  currentRoots();
});
// Offene Datenströme (exec, events) halten close() auf – direkt beenden.
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => process.exit(0));
