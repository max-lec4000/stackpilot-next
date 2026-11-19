// System → Zugriff & Netzwerk: VPN je Dienst und WireGuard-Configs.
import { importVpn, listVpnProfiles, removeVpnProfile } from "../../vpn.js";

export function vpnRoutes({ vault, youtubeVpn, vpnSwitch, completedPlan }) {
  // Nach jeder Änderung die Übergabe an Couchdeck aktualisieren (VPN-Weg verfügbar ja/nein)
  const publish = (result) => {
    void youtubeVpn.publish().catch(() => {});
    return result;
  };
  return [
    { method: "GET", path: "/api/vpn/profiles", guard: "session", handler: async () => {
      const tunnel = youtubeVpn.tunnel;
      return {
        profiles: listVpnProfiles(vault(), completedPlan()),
        youtube: { program: tunnel ? await tunnel.programInstalled() : false, status: tunnel?.status() || null },
      };
    } },
    { method: "POST", path: "/api/vpn/import", guard: "session",
      handler: ({ body }) => publish(importVpn(vault(), body.config, body.name)) },
    { method: "POST", path: "/api/vpn/profiles/remove", guard: "session",
      handler: ({ body }) => publish(removeVpnProfile(vault(), completedPlan(), body.id)) },
    { method: "POST", path: "/api/vpn/youtube", guard: "session",
      handler: ({ body }) => publish(youtubeVpn.tunnel.saveSettings(body)) },
    { method: "POST", path: "/api/vpn/profiles/qbittorrent", guard: "ok", confirm: "Bestätigung fehlt.",
      handler: async ({ body }) => publish(await vpnSwitch.apply(body)) },
  ];
}
