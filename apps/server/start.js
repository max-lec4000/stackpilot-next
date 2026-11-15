import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { inventoryMiddleware } from "./middleware.js";
import { bindAddress, hostAllowed, isPlainLoopback, port } from "./access.js";
const root = fileURLToPath(new URL("../web/dist/", import.meta.url));
try {
  await stat(path.join(root, "index.html"));
} catch {
  console.error("Build fehlt. Bitte zuerst npm run build ausführen.");
  process.exit(1);
}
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--report")) {
  console.error("Aufruf: npm start -- [--report]");
  process.exit(1);
}
if (args.includes("--report")) {
  try {
    const { collectReport, writeReport } = await import("./report.js");
    const filename = `reports/serverbericht-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    const saved = await writeReport(filename, await collectReport());
    console.log(
      `Serverbericht gespeichert: ${saved}. Vor dem Teilen prüfen; kein Upload.`,
    );
  } catch {
    console.error(
      "Serverbericht konnte nicht gespeichert werden. Serverstart wird abgebrochen.",
    );
    process.exit(1);
  }
}
const api = inventoryMiddleware();
const bind = bindAddress();
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = createServer(async (req, res) => {
  if (!hostAllowed(req.headers.host, { bind, requiredPort: port })) {
    res.writeHead(403);
    return res.end("Zugriff nur über die Adresse dieses Servers.");
  }
  if (!req.url.startsWith("/api/") && isPlainLoopback(req.headers.host)) {
    res.writeHead(302, {
      Location:
        "http://stackpilot.localhost:" +
        (req.headers.host.split(":").at(-1) || port) +
        new URL(req.url, "http://localhost").pathname +
        new URL(req.url, "http://localhost").search,
    });
    return res.end();
  }
  if (req.url?.startsWith("/api/"))
    return api(req, res, () => {
      res.writeHead(404);
      res.end();
    });
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    return res.end();
  }
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    const file =
      pathname === "/"
        ? path.join(root, "index.html")
        : path.resolve(root, "." + pathname);
    if (!file.startsWith(root) || pathname.includes("..")) {
      res.writeHead(403);
      return res.end();
    }
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "Referrer-Policy": "no-referrer",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    res.writeHead(404);
    res.end("Nicht gefunden.");
  }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.on("error", (e) => {
  console.error(
    e.code === "EADDRINUSE"
      ? "Port 5173 belegt. Bitte einen anderen StackPilot-Prozess zuerst beenden."
      : "Server konnte nicht gestartet werden.",
  );
  process.exitCode = 1;
});
server.listen(port, bind, () =>
  console.log(
    bind === "127.0.0.1"
      ? "StackPilot: http://stackpilot.localhost:5173 · nur an diesem Server erreichbar."
      : "StackPilot: Port 5173 · im Heimnetz und Tailnet über die Adresse dieses Servers erreichbar.",
  ),
);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(
    "StackPilot wird beendet; laufende Aufträge werden gesichert angehalten oder müssen nach Neustart fortgesetzt werden.",
  );
  const closed = new Promise((resolve) => server.close(resolve));
  const result = await api.shutdown();
  if (!result.idle)
    console.log(
      "Auftrag noch aktiv. Nach Neustart Zustand prüfen; Sperre kann bis zu 90 Sekunden nachlaufen.",
    );
  server.closeAllConnections();
  await closed;
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
