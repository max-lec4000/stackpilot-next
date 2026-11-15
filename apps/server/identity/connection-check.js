import https from "node:https";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { localDocker } from "../retirement.js";
import { localIdentityRequest } from "./local-request.js";
import { validateIdentityInput } from "./config.js";

export function connectionFailure(text) {
  const value = String(text);
  if (
    /Connection refused|ECONNREFUSED|Failed to connect|curl: \(7\)/i.test(value)
  )
    return "refused";
  if (
    /ENOTFOUND|EAI_AGAIN|Name or service not known|Could not resolve/i.test(
      value,
    )
  )
    return "dns";
  if (
    /certificate|SSL connection|TLS handshake|AuthenticationException/i.test(
      value,
    )
  )
    return "tls";
  if (/timed out|timeout|ETIMEDOUT/i.test(value)) return "timeout";
  if (
    /issuer|discovery document|invalid_client|unauthorized_client/i.test(value)
  )
    return "oidc";
  return "unknown";
}
const messages = {
  refused:
    "Verbindung abgewiesen. Hostzugriff und Zugriff aus dem Jellyfin-Container sind getrennte Netzwerkwege.",
  dns: "Die Serveradresse wird in diesem Netzwerkweg nicht aufgelöst.",
  tls: "TLS-Zertifikat oder Zertifikatskette nicht bestätigt. Zertifikatsprüfung bleibt eingeschaltet.",
  timeout:
    "Der Verbindungsaufbau hat das Zeitlimit überschritten. Netzwerkweg und Firewall prüfen.",
  oidc: "OIDC-Metadaten, Anbieteradresse oder Client-Konfiguration nicht bestätigt.",
  unknown:
    "Keine eindeutige Verbindung bestätigt. Keine automatische Netzwerk- oder Sicherheitslockerung.",
};
export const discoveryUrl = (hostname) =>
  `https://${hostname}:8443/application/o/stackpilot-jellyfin/.well-known/openid-configuration`;
export function validDiscovery(value, hostname) {
  const base = `https://${hostname}:8443`;
  if (value?.issuer !== `${base}/application/o/stackpilot-jellyfin/`)
    return false;
  return ["authorization_endpoint", "token_endpoint", "jwks_uri"].every(
    (key) => {
      try {
        const u = new URL(value[key]);
        return (
          u.origin === base &&
          !u.username &&
          !u.password &&
          !u.hash &&
          u.pathname.startsWith("/application/o/")
        );
      } catch {
        return false;
      }
    },
  );
}
// Only the validated own Tailnet endpoint, bounded response, no redirects and strict TLS.
export function readDiscovery(hostname) {
  return new Promise((resolve) => {
    const req = https.get(discoveryUrl(hostname), { timeout: 7000 }, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
        if (body.length > 262144) req.destroy(Error("Response too large"));
      });
      res.on("error", () =>
        resolve({ ok: false, code: "unknown", httpStatus: res.statusCode }),
      );
      res.on("end", () => {
        let valid = false;
        try {
          valid = validDiscovery(JSON.parse(body), hostname);
        } catch {}
        resolve({
          ok: res.statusCode === 200 && valid,
          httpStatus: res.statusCode,
          code: valid ? "ok" : "oidc",
        });
      });
    });
    req.on("timeout", () => req.destroy(Error("timeout")));
    req.on("error", (e) =>
      resolve({ ok: false, code: connectionFailure(`${e.code} ${e.message}`) }),
    );
  });
}
export class ConnectionCheck {
  constructor(
    protection,
    {
      docker = localDocker,
      discovery = readDiscovery,
      request = localIdentityRequest,
      dns = lookup,
    } = {},
  ) {
    Object.assign(this, { protection, docker, discovery, request, dns });
  }
  async inspect() {
    const c = await this.protection.context();
    const hostname = validateIdentityInput(c.identity.input).hostname;
    const host = await this.discovery(hostname).catch(() => ({
      ok: false,
      code: "unknown",
    }));
    let addresses = [],
      containerAddresses = [],
      dnsComplete = false;
    try {
      addresses = (await this.dns(hostname, { all: true })).map(
        (v) => v.address,
      );
    } catch {}
    // Output is interpreted locally, never forwarded as raw logs or /etc/hosts.
    try {
      const out = await this.docker(
        ["exec", c.container.Id, "getent", "ahosts", hostname],
        { timeout: 8000 },
      );
      containerAddresses = [
        ...new Set(
          out
            .split(/\n/)
            .map((v) => v.trim().split(/\s+/)[0])
            .filter((v) => /^[0-9a-fA-F:.]+$/.test(v)),
        ),
      ].slice(0, 12);
      dnsComplete = containerAddresses.length > 0;
    } catch {}
    let challenge = { ok: false, code: "unknown", httpStatus: null };
    try {
      const r = await this.request(
        `http://127.0.0.1:19096/sso/OID/start/stackpilot`,
        { headers: { Host: hostname }, signal: AbortSignal.timeout(15000) },
      );
      await r.arrayBuffer();
      let targetValid = false;
      try {
        const u = new URL(r.headers.get("location"));
        targetValid =
          u.origin === `https://${hostname}:8443` &&
          u.pathname === "/application/o/authorize/";
      } catch {}
      challenge = {
        ok: [302, 303].includes(r.status) && targetValid,
        code: "unknown",
        httpStatus: r.status,
      };
      if (challenge.ok) challenge.code = "ok";
    } catch (e) {
      challenge.code = connectionFailure(`${e.code} ${e.message}`);
    }
    if (!challenge.ok) {
      try {
        const log = await this.docker(
          ["logs", "--since", "30s", "--tail", "100", c.container.Id],
          { timeout: 8000 },
        );
        // Last relevant failure only; no log text or URL parameters leave the server.
        const relevant = log
          .split(/\n/)
          .filter((v) =>
            /Error loading discovery|Connection refused|AuthenticationException|invalid_client|issuer|Could not resolve/i.test(
              v,
            ),
          );
        challenge.code = connectionFailure(relevant.slice(-5).join("\n"));
      } catch {}
    }
    const checks = [
      {
        name: "Authentik HTTPS vom Server",
        state: host.ok ? "ok" : "blocked",
        code: host.code,
        httpStatus: host.httpStatus ?? null,
        message: host.ok
          ? "HTTPS, Anbieteradresse und OIDC-Endpunkte bestätigt."
          : messages[host.code] || messages.unknown,
      },
      {
        name: "SSO aus Jellyfin",
        state: challenge.ok ? "ok" : "blocked",
        code: challenge.code,
        httpStatus: challenge.httpStatus,
        message: challenge.ok
          ? "Der tatsächliche Jellyfin-SSO-Einstieg erreicht den Anbieter und leitet zur Anmeldung weiter."
          : messages[challenge.code] || messages.unknown,
      },
      {
        name: "Namensauflösung im Jellyfin-Container",
        state: dnsComplete ? "ok" : "unknown",
        code: dnsComplete ? "resolved" : "unconfirmed",
        message: dnsComplete
          ? "Container-Auflösung erfasst; die SSO-Prüfung bewertet die tatsächliche Erreichbarkeit."
          : "Container-Auflösung nicht separat lesbar; dies wird nicht als erfolgreicher Nachweis ausgegeben.",
      },
    ];
    return {
      checkedAt: new Date().toISOString(),
      ready: host.ok && challenge.ok,
      publicReady: false,
      hostname,
      checks,
      network: {
        hostAddresses: addresses.slice(0, 12),
        containerAddresses,
        explicitDns: (c.container.HostConfig?.Dns || []).filter((v) => isIP(v)),
        ownHostOverrides: (c.container.HostConfig?.ExtraHosts || [])
          .filter((v) => v.startsWith(hostname + ":"))
          .map((v) => v.slice(hostname.length + 1))
          .filter((v) => isIP(v)),
        proxyConfigured: (c.container.Config?.Env || []).some((v) =>
          /^(https?|all)_proxy=.+/i.test(v),
        ),
      },
      limits: [
        "Kein Nachweis persönlicher MFA, Gerätewiedergabe oder öffentlicher Erreichbarkeit.",
        "Kein pauschaler Umbau von Firewall, Host-DNS oder fremden Docker-Konfigurationen.",
      ],
    };
  }
}
