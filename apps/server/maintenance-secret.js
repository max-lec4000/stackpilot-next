import { createServer, createConnection } from "node:net";
import { mkdtemp, chmod, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
// A private one-use Unix socket transfers a passphrase to a separate systemd
// worker. No secret is stored in files, arguments, environment or job metadata.
export async function offerMaintenanceSecret(id, secret, launch) {
  if (!/^[a-f0-9-]{36}$/.test(id) || typeof secret !== "string" || secret.length < 16 || secret.length > 256) throw Error("Ungültiger Sicherungsauftrag oder Passphrase.");
  const directory = await mkdtemp(path.join(os.tmpdir(), "sp-maintenance-"));
  const address = path.join(directory, "channel.sock");
  let peer, settled = false, timer;
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const server = createServer((socket) => {
    if (peer) { socket.destroy(); return; }
    peer = socket;
    let buffer = "", authenticated = false;
    socket.on("error", () => { if (!settled) readyReject(Error("Wartungskanal wurde unterbrochen.")); });
    socket.on("close", () => { if (!settled) readyReject(Error("Wartungskanal wurde geschlossen.")); });
    socket.on("data", (data) => {
      buffer += data.toString("utf8");
      if (Buffer.byteLength(buffer) > 2048) { socket.destroy(); return; }
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!authenticated) {
          if (line !== id) { socket.destroy(); return; }
          authenticated = true;
          socket.write(JSON.stringify({ id, secret }) + "\n");
          secret = "";
        } else if (line === "READY") { readyResolve(); }
        else socket.destroy();
      }
    });
  });
  async function cleanup() {
    clearTimeout(timer);
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(address, resolve); });
    await chmod(address, 0o600);
    timer = setTimeout(() => readyReject(Error("Wartungsdienst antwortet nicht.")), 30000);
    // Observe the rejection before launching a worker to avoid unhandled promises.
    ready.catch(() => {});
    await launch(address);
    await ready;
    settled = true;
    await cleanup();
    let used = false;
    return {
      commit() { if (!used) { used = true; peer.end("GO\n"); } },
      abort() { if (!used) { used = true; peer.destroy(); } },
    };
  } catch (error) {
    settled = true; secret = "";
    if (peer) peer.destroy();
    await cleanup();
    throw error;
  }
}
export async function receiveMaintenanceSecret(id, address) {
  if (!/^[a-f0-9-]{36}$/.test(id) || !path.isAbsolute(address)) throw Error("Ungültiger Wartungskanal.");
  return await new Promise((resolve, reject) => {
    const socket = createConnection(address);
    let buffer = "", secret, finished = false;
    const timeout = setTimeout(() => { socket.destroy(); reject(Error("Sicherungsfreigabe ist abgelaufen.")); }, 30000);
    const fail = () => { clearTimeout(timeout); if (!finished) reject(Error("Sicherungsfreigabe wurde nicht abgeschlossen.")); };
    socket.on("connect", () => socket.write(id + "\n"));
    socket.on("error", fail); socket.on("close", fail);
    socket.on("data", (data) => {
      buffer += data.toString("utf8");
      if (Buffer.byteLength(buffer) > 4096) { socket.destroy(); return; }
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (secret === undefined) {
          try {
            const value = JSON.parse(line);
            if (value.id !== id || typeof value.secret !== "string" || value.secret.length < 16 || value.secret.length > 256) throw Error();
            secret = value.secret;
            socket.write("READY\n");
          } catch { socket.destroy(); return; }
        } else if (line === "GO") {
          finished = true; clearTimeout(timeout); socket.end(); resolve(secret); secret = "";
        } else { socket.destroy(); return; }
      }
    });
  });
}
