import os from "node:os";

// Wo StackPilot und die Dienste erreichbar sind. Ohne Angabe nur am Server selbst
// (Entwicklung, Tests); der Installer setzt STACKPILOT_BIND=0.0.0.0 für Heimnetz + Tailnet.
export const port = 5173;
const loopbackNames = ["localhost", "127.0.0.1", "stackpilot.localhost", "[::1]"];

export function bindAddress(env = process.env) {
  const value = env.STACKPILOT_BIND || "127.0.0.1";
  if (!["127.0.0.1", "0.0.0.0"].includes(value))
    throw Error("STACKPILOT_BIND muss 127.0.0.1 oder 0.0.0.0 sein.");
  return value;
}

function ownAddresses(interfaces = os.networkInterfaces()) {
  return Object.values(interfaces)
    .flat()
    .filter((a) => a && a.family === "IPv4")
    .map((a) => a.address);
}

/**
 * Nennt der Host-Header diesen Server? Schützt vor DNS-Rebinding: Eine fremde Domain,
 * die auf die Heimnetz-Adresse zeigt, wird abgewiesen. Erlaubt sind die eigenen
 * IPv4-Adressen, der Gerätename (auch als .local und als Tailscale-Name) und was der
 * Betreiber in STACKPILOT_HOSTS zusätzlich nennt.
 */
export function hostAllowed(header, options = {}) {
  const {
    bind = bindAddress(),
    requiredPort = null,
    hostname = os.hostname(),
    interfaces,
    extra = process.env.STACKPILOT_HOSTS || "",
  } = options;
  if (typeof header !== "string" || header.length > 300) return false;
  const match = header
    .toLowerCase()
    .match(/^(\[::1\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?):(\d{1,5})$/);
  if (!match) return false;
  const name = match[1];
  // Loopback-Namen erreicht nur, wer am Server selbst sitzt oder einen eigenen Tunnel hat;
  // dort darf der Port abweichen (ssh -L 5174:…:5173).
  if (loopbackNames.includes(name)) return true;
  if (requiredPort !== null && Number(match[2]) !== requiredPort) return false;
  if (bind === "127.0.0.1") return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(name))
    return ownAddresses(interfaces).includes(name);
  const own = hostname.toLowerCase().split(".")[0];
  if (name === own || name === own + ".local") return true;
  if (name.endsWith(".ts.net") && name.split(".")[0] === own) return true;
  return extra
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(name);
}

/** Loopback-Aufrufe landen auf stackpilot.localhost, damit das Sitzungscookie nicht an
 * andere lokale Weboberflächen (gleicher Name, anderer Port) geht. */
export const isPlainLoopback = (header) =>
  /^(?:localhost|127\.0\.0\.1):\d+$/.test(header || "");

/** Adresse, unter der ein Dienst für diesen Browser erreichbar ist. */
export function serviceUrl(slug, hostPort, bind, requestHost) {
  const name = (requestHost || "").replace(/:\d+$/, "");
  if (bind === "0.0.0.0" && name && !/(^|\.)localhost$|^127\.0\.0\.1$|^\[::1\]$/.test(name))
    return `http://${name}:${hostPort}`;
  return `http://${slug}.localhost:${hostPort}`;
}
