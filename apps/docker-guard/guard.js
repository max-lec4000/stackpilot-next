// Docker-Wächter (Phase 7.0c, Prototyp): Unix-Socket für StackPilot, leitet nur erlaubte
// Docker-API-Aufrufe an den Docker-Socket des Hosts weiter. Modus „observe“ protokolliert
// nur, „enforce“ lehnt Verstöße mit 403 ab.
//   node guard.js /etc/stackpilot/docker-guard.json
import http from "node:http";
import fs from "node:fs";
import nodePath from "node:path";
import { routeAllowed, checkCreate, checkExec, checkVolume, checkNetwork, bare } from "./policy.js";

const config = JSON.parse(fs.readFileSync(process.argv[2] || "/etc/stackpilot/docker-guard.json", "utf8"));
const { listen, upstream = "/var/run/docker.sock", mode = "enforce", log = null } = config;
// Erlaubte Ordner selbst mit echtem Pfad vergleichen (falls einer über eine Verknüpfung erreicht wird)
const roots = (config.roots || []).map((r) => { try { return fs.realpathSync(r); } catch { return r; } });
// Echter Pfad wie Docker ihn sieht; fehlt der Ordner noch (Docker legt ihn an), zählt der
// nächste vorhandene Elternordner. Restrisiko: Verknüpfung wird zwischen Prüfung und Anlegen
// getauscht (siehe Probenbericht).
function resolve(p) {
  let rest = "";
  for (let dir = p; ; dir = nodePath.dirname(dir)) {
    try { return nodePath.join(fs.realpathSync(dir), rest); } catch {}
    if (dir === "/") return p;
    rest = nodePath.join(nodePath.basename(dir), rest);
  }
}
const ctx = { roots, resolve };
const CHECKS = {
  "/containers/create": (b) => checkCreate(b, ctx),
  "/volumes/create": (b) => checkVolume(b, ctx),
  "/networks/create": (b) => checkNetwork(b),
};
const write = (line) => {
  const text = `${new Date().toISOString()} ${line}\n`;
  if (log) fs.appendFileSync(log, text); else process.stdout.write(text);
};
const deny = (res, method, path, reasons) => {
  write(`DENY ${method} ${bare(path)} ${reasons.join(", ")}`);
  if (mode !== "enforce") return false;
  res.writeHead(403, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: `StackPilot-Docker-Wächter: nicht erlaubt (${reasons.join(", ")})` }));
  return true;
};

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 4 * 1024 * 1024) throw Error("zu groß"); chunks.push(c); }
  return Buffer.concat(chunks);
}

function forward(req, res, body) {
  const up = http.request({ socketPath: upstream, method: req.method, path: req.url, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    res.flushHeaders(); // Docker sendet bei /wait erst die Kopfzeilen, den Inhalt erst beim Ende – die CLI startet den Container erst nach den Kopfzeilen
    r.pipe(res);
  });
  up.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  if (body) up.end(body); else req.pipe(up);
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;
  const path = bare(url);
  if (!routeAllowed(method, url)) { if (deny(res, method, url, ["Aufruf nicht erlaubt"])) return; }
  try {
    if (method === "POST" && (CHECKS[path] || /\/exec$/.test(path))) {
      const body = await readBody(req);
      const parsed = body.length ? JSON.parse(body) : {};
      const reasons = (CHECKS[path] || checkExec)(parsed);
      if (reasons.length && deny(res, method, url, reasons)) return;
      write(`ALLOW ${method} ${path}`);
      return forward(req, res, body);
    }
    write(`ALLOW ${method} ${path}`);
    forward(req, res, null);
  } catch (e) {
    res.writeHead(400); res.end(JSON.stringify({ message: "Wächter: ungültige Anfrage" }));
  }
});

// exec/attach schalten auf einen rohen Datenstrom um (Upgrade) – nach der Prüfung durchreichen
server.on("upgrade", (req, socket, head) => {
  const { method, url } = req;
  if (!routeAllowed(method, url)) {
    write(`DENY ${method} ${bare(url)} Aufruf nicht erlaubt (Upgrade)`);
    if (mode === "enforce") return socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  }
  write(`ALLOW ${method} ${bare(url)} (Upgrade)`);
  // Der Anfrageinhalt (z. B. {"Detach":false}) kommt mit den Kopfzeilen; Docker antwortet erst,
  // wenn er vollständig da ist. Also zuerst den Inhalt sammeln, dann den Datenstrom verbinden.
  const length = Number(req.headers["content-length"] || 0);
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
      upSocket.on("error", () => socket.destroy()); socket.on("error", () => upSocket.destroy());
    });
    up.on("response", (r) => { socket.end(`HTTP/1.1 ${r.statusCode} ${r.statusMessage}\r\n\r\n`); });
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

try { fs.unlinkSync(listen); } catch {}
server.listen(listen, () => { fs.chmodSync(listen, 0o660); write(`Wächter bereit (${mode}) auf ${listen}`); });
