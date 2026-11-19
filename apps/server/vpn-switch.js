// qBittorrent (Gluetun) auf ein anderes VPN-Profil umstellen – mit Prüfung und Rückweg.
// Ablauf unter der Auftragssperre (der Downloadschutz wartet so lange):
//   1. bisherige wg0.conf/auth.toml sichern, neue aus dem gewählten Profil schreiben
//   2. gluetun, qbittorrent und vpn-probe neu erstellen (gleiches Compose-Manifest)
//   3. Mullvad-Ausgang und Ausfallsperre mit dem neuen Profil prüfen, qBittorrent ansprechen
//   4. erst dann den Plan auf das neue Profil umschreiben
// Schlägt etwas fehl, kommen die alten Dateien zurück, die Container werden erneut erstellt
// und mit dem alten Profil geprüft. qBittorrent läuft nie ohne Gluetun-Firewall.
import { readFile, writeFile, rename, chmod } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

async function replaceFile(file, text) {
  const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temp, text, { mode: 0o600, flag: "wx" });
  await chmod(temp, 0o600);
  await rename(temp, file);
}

export function gluetunAuth(profile) {
  return `[[roles]]\nname = "stackpilot-check"\nroutes = ["GET /v1/vpn/status", "PUT /v1/vpn/status"]\nauth = "apikey"\napikey = "${profile.controlKey}"\n`;
}

export class VpnSwitch {
  constructor(hub, { tunnel = null } = {}) {
    this.hub = hub;
    this.engine = hub.engine;
    this.tunnel = tunnel; // YouTube-Tunnel: vorher anhalten, er könnte genau dieses Profil nutzen
  }
  async apply({ profileId, confirmation } = {}) {
    if (confirmation !== "OK") throw Object.assign(Error("Bestätigung fehlt."), { userFacing: true });
    return this.hub.mutate(["qBittorrent"], async ({ s, plan: checked }) => {
      const plan = this.engine.current().plan;
      const root = plan.rootId || plan.id;
      const fail = (m) => { throw Object.assign(Error(m), { userFacing: true }); };
      if (plan.id !== checked.id) fail("Der laufende Installationsplan wurde geändert.");
      if (!plan.spec.vpn) fail("qBittorrent nutzt kein VPN.");
      if (plan.vpnProfileId === profileId) fail("Dieses Profil ist schon aktiv.");
      if (this.engine.vault.get(`safety-latch:${root}`))
        fail("Zuerst die unterbrochene VPN-Prüfung abschließen.");
      const next = this.engine.vault.get(`vpn-profile:${profileId}`);
      const old = this.engine.vault.get(`vpn-profile:${plan.vpnProfileId}`);
      if (!next?.config || !old?.config) fail("VPN-Profil fehlt.");
      const dir = path.join(plan.appdata, "gluetun");
      const files = { wg: path.join(dir, "wg0.conf"), auth: path.join(dir, "auth.toml") };
      const manifest = path.join(this.engine.store.directory, "deployments", plan.id, "compose.json");
      const backup = { wg: await readFile(files.wg, "utf8"), auth: await readFile(files.auth, "utf8") };
      const recreate = () =>
        this.engine.docker(
          ["compose", "-f", manifest, "up", "-d", "--no-deps", "--force-recreate", "--pull", "never", "--no-build",
            "gluetun", "qbittorrent", "vpn-probe"],
          { timeout: 180000 },
        );
      const verify = async (p) => {
        await this.engine.vpnCheck(p, "identity");
        await this.engine.vpnCheck(p, "isolation");
        await s.verifyQbit();
      };
      const nextPlan = { ...plan, vpnProfileId: profileId };
      this.tunnel?.stop();
      try {
        await replaceFile(files.wg, next.config);
        await replaceFile(files.auth, gluetunAuth(next));
        await recreate();
        await verify(nextPlan);
      } catch (error) {
        // Rückweg: altes Profil wiederherstellen und prüfen
        try {
          await replaceFile(files.wg, backup.wg);
          await replaceFile(files.auth, backup.auth);
          await recreate();
          await verify(plan);
        } catch {
          fail("Wechsel fehlgeschlagen und das alte Profil ließ sich nicht bestätigen. Downloads bleiben gesperrt – unter VPN & Ausfallsperre prüfen.");
        }
        fail(`Wechsel fehlgeschlagen (${error.userFacing ? error.message : "VPN-Prüfung"}). Das bisherige Profil ist wieder aktiv.`);
      }
      this.engine.store.replacePlan(nextPlan);
      return { profileId, name: next.name || `Mullvad ${next.endpoint}` };
    });
  }
}
