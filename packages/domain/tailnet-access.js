/** A single Tailscale host selector. Ranges, tags, users and wildcards are deliberately excluded. */
export function tailnetHost(value) {
  if (typeof value !== "string" || value.length > 80)
    throw Error("Eine einzelne Tailscale-IP pro Gerät angeben.");
  const input = value.trim();
  const parts = input.split("/");
  if (parts.length > 2)
    throw Error("Eine einzelne Tailscale-IP pro Gerät angeben.");
  const address = parts[0];
  const ipv4 = address.split(".");
  if (
    ipv4.length === 4 &&
    ipv4.every((v) => /^(0|[1-9][0-9]{0,2})$/.test(v) && Number(v) <= 255)
  ) {
    if (parts.length === 2 && parts[1] !== "32")
      throw Error(
        "Die Vorlage unterstützt einzelne Geräte, keine ganzen IP-Netze.",
      );
    if (
      Number(ipv4[0]) !== 100 ||
      Number(ipv4[1]) < 64 ||
      Number(ipv4[1]) > 127
    )
      throw Error(
        "Die IPv4-Adresse muss aus dem Tailscale-Bereich 100.64.0.0/10 stammen.",
      );
    return ipv4.map(Number).join(".");
  }
  if (address.includes(":") && /^[a-f0-9:]+$/i.test(address)) {
    if (parts.length === 2 && parts[1] !== "128")
      throw Error(
        "Die Vorlage unterstützt einzelne Geräte, keine ganzen IP-Netze.",
      );
    try {
      const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
      if (normalized.startsWith("fd7a:115c:a1e0:")) return normalized;
    } catch {}
  }
  throw Error(
    "Eine gültige Tailscale-IP des Geräts angeben, keine LAN-Adresse, Domain oder Freigabe für alle.",
  );
}
/** @param {unknown} values @returns {string[]} */
export function tailnetAddresses(values) {
  if (!Array.isArray(values)) return [];
  const result = [];
  for (const value of values.slice(0, 16)) {
    try {
      const address = tailnetHost(value);
      if (!result.includes(address)) result.push(address);
    } catch {}
  }
  return result.sort(
    (a, b) => Number(a.includes(":")) - Number(b.includes(":")),
  );
}
/** This creates a policy suggestion only; it proves neither effective rules nor client connectivity. */
export function buildTailnetGrant(sourceText, target) {
  if (typeof sourceText !== "string" || sourceText.length > 2048)
    throw Error("Höchstens 16 Geräteadressen angeben.");
  const sources = sourceText
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (!sources.length)
    throw Error(
      "Zuerst die Tailscale-IP des Laptops, Handys oder eines anderen zugelassenen Geräts eintragen.",
    );
  if (sources.length > 16) throw Error("Höchstens 16 Geräteadressen angeben.");
  const dst = tailnetHost(target);
  const src = [...new Set(sources.map(tailnetHost))];
  if (src.includes(dst))
    throw Error(
      "Als Quelle ein anderes Gerät auswählen. Der Serverzugriff auf sich selbst bestätigt keinen Gerätezugriff.",
    );
  return { src, dst: [dst], ip: ["tcp:443", "tcp:8443"] };
}
export function tailnetBrowserLinks(hostname) {
  if (
    typeof hostname !== "string" ||
    hostname.length > 253 ||
    !/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+ts\.net$/.test(hostname)
  )
    return null;
  return {
    jellyfin: `https://${hostname}`,
    sso: `https://${hostname}/sso/OID/start/stackpilot`,
    discovery: `https://${hostname}:8443/application/o/stackpilot-jellyfin/.well-known/openid-configuration`,
  };
}
