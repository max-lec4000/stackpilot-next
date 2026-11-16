import path from "node:path";
import { checkServeConfig, RemoteAccess } from "../remote-access.js";
import { IdentityPreparation } from "./preparation.js";
import { JellyfinProtection } from "./jellyfin-protection.js";
import { SsoConnection } from "./sso-connection.js";
import { ConnectionCheck } from "./connection-check.js";
import { ssoCompatibility } from "./sso-release.js";
import { setupError } from "./setup-error.js";

// The release index and its official linux/amd64 manifest refer to the same build.
const approved = new Map([
  ["docker.io/jellyfin/jellyfin@sha256:fea863d0cd9ec445985d9c75fc6ed64e38a1d2766cf0c250a33d553f4fc1b771", "12.4.0"],
  ["docker.io/jellyfin/jellyfin@sha256:7da5184caa38c553f219f6772476540081f392a68049e2b68c923f6daf877f8e", "12.4.0"],
]);

export class JellyfinMaintenance {
  constructor(protection, sso, connection) {
    Object.assign(this, { protection, sso, connection });
  }
  compatible(image) {
    const version = approved.get(image);
    return process.arch === "x64" && Boolean(version && ssoCompatibility(version).loginVerified);
  }
  async privateGateway(plan) {
    const r = this.protection.current();
    const identity = this.protection.identity.current();
    if (r?.status !== "ready" || r.rootId !== (plan.rootId || plan.id) ||
        identity?.status !== "local-ready" || identity.rootId !== r.rootId ||
        identity.input.hostname !== r.hostname || r.streamyfin)
      throw setupError("Jellyfin-Wartung erfordert das bestätigte private Schutz-Gateway. Funnel und Streamyfin vorher abschalten.");
    const run = this.protection.identity.remote.run;
    const [status, serve] = await Promise.all([
      run("tailscale", ["status", "--json"]),
      run("tailscale", ["serve", "status", "--json"]),
    ]);
    try {
      if (!status.ok || !serve.ok) throw Error();
      const live = JSON.parse(status.output), config = JSON.parse(serve.output);
      const desired = {
        [r.hostname + ":443"]: "http://127.0.0.1:19096",
        [r.hostname + ":8443"]: "http://127.0.0.1:" + identity.input.gatewayPort,
      };
      const checked = checkServeConfig(config, desired);
      if (live.BackendState !== "Running" || live.Self?.Online !== true ||
          live.Self.DNSName?.replace(/\.$/, "") !== r.hostname ||
          !checked.exclusive || checked.public || checked.routes !== 2 ||
          Object.keys(config.Foreground || {}).length ||
          !Object.entries(desired).every(([host, target]) =>
            config.Web?.[host]?.Handlers?.["/"]?.Proxy === target &&
            config.TCP?.[host.split(":").at(-1)]?.HTTPS === true))
        throw Error();
    } catch {
      throw setupError("Private HTTPS-Routen sind nicht bestätigt oder Funnel ist aktiv.");
    }
    return this.protection.verifyContainer(r);
  }
  checkContainer(plan, container) {
    const source = (name) => path.join(plan.appdata, name);
    const expected = [
      ["/config", source("jellyfin"), true],
      ["/cache", source("jellyfin-cache"), true],
      ["/data/media", path.join(plan.spec.path, "media"), false],
    ];
    if (container.Mounts.length !== expected.length ||
        !expected.every(([destination, directory, writable]) => container.Mounts.some(
          (mount) => mount.Type === "bind" && mount.Destination === destination &&
            mount.Source === directory && mount.RW === writable)))
      throw setupError("Jellyfin muss die verwaltete Konfiguration sowie die Medien schreibgeschützt eingebunden haben.");
  }
  async verify(plan, image, reload = false) {
    const gateway = await this.privateGateway(plan);
    let { protection, sso, connection } = this;
    if (reload) {
      // Validate the candidate without publishing it as the installed plan.
      const checked = await protection.hub.context(["Jellyfin"], plan);
      const scope = Object.create(protection.hub);
      scope.context = async () => checked;
      const remote = new RemoteAccess(scope, protection.identity.remote.run);
      const identity = new IdentityPreparation(scope, remote, protection.identity.docker);
      protection = new JellyfinProtection(scope, identity, protection.docker);
      sso = new SsoConnection(scope, identity);
      connection = new ConnectionCheck(protection);
      await this.protection.docker(["exec", gateway.Id, "nginx", "-s", "reload"], { timeout: 10000 });
    }
    const context = await protection.context();
    if (context.container.Config.Image !== image || context.info.Version !== approved.get(image))
      throw setupError("Jellyfin-Version oder gestartetes Image stimmt nicht mit der Abnahme überein.");
    this.checkContainer(plan, context.container);
    await protection.verify();
    if (!(await sso.plan()).configured || !(await connection.inspect()).ready)
      throw setupError("Die geschützte Anmeldung über Authentik wurde nach der Wartung nicht bestätigt.");
    await this.privateGateway(plan);
  }
}
