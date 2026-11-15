import { readContainers } from "./retirement.js";
import { catalog } from "./catalog.js";
import { Services } from "./service-api.js";
import { serviceUrl } from "./access.js";
export async function managedServices(engine, requestHost = "") {
  const current = engine.current();
  const jobs = current ? [current.job] : [];
  const containers = await readContainers(engine.docker);
  const services = [];
  for (const job of jobs) {
    const plan = engine.store.plan(job.planId);
    const published = job.steps.some(
      (s) => s.id === "publish" && s.status === "completed",
    );
    for (const name of plan.spec.selected) {
      const entry = catalog.services[name];
      const c = containers.find(
        (c) =>
          c.project === plan.project &&
          c.managedPlan === (plan.rootId || plan.id) &&
          c.service === entry.slug,
      );
      services.push({
        operationId: job.id,
        planId: plan.id,
        name,
        slug: entry.slug,
        hostPort: plan.ports[name],
        url:
          published ||
          (plan.existing?.includes(name) &&
            !(plan.vpnTransition && name === "qBittorrent"))
            ? serviceUrl(entry.slug, plan.ports[name], plan.bind, requestHost)
            : null,
        state: c?.status || "missing",
        installationStatus: job.status,
        image: plan.images[name],
        username: plan.spec.username,
        authentication: ["Seerr", "Streamystats"].includes(name)
          ? "Jellyfin"
          : "Dienstkonto",
      });
    }
  }
  return { services };
}
export async function revealCredentials(engine, body, auth, remoteAddress) {
  if (!(await auth.reauthenticate(body.password, remoteAddress)))
    throw new Error("Administratorpasswort stimmt nicht.");
  const job = engine.store.operation(body.operationId);
  if (job?.kind !== "deployment")
    throw new Error("Installationsauftrag nicht gefunden.");
  const plan = engine.store.plan(job.planId);
  if (!plan.spec.selected.includes(body.service))
    throw new Error("Dienst gehört nicht zu diesem Auftrag.");
  const credentials = engine.vault.get(
    `deployment:${plan.rootId || plan.id}:${["Seerr", "Streamystats"].includes(body.service) ? "jellyfin" : catalog.services[body.service].slug}`,
  );
  if (!credentials) throw new Error("Dienstzugang wurde noch nicht erzeugt.");
  return { username: credentials.username, password: credentials.password };
}
export async function checkManaged(engine, id) {
  const job = engine.store.operation(id);
  if (job?.kind !== "deployment")
    throw new Error("Installationsauftrag nicht gefunden.");
  const plan = engine.current()?.plan || engine.store.plan(job.planId);
  const relay = await engine.relay(plan);
  const checks = await new Services(plan, engine.vault, relay).verify();
  if (plan.spec.vpn) checks.push(await engine.vpnCheck(plan));
  return { checks };
}
