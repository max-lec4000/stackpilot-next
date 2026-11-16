import { randomBytes } from "node:crypto";
import { lstat, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { arrKeyConsumers } from "./arr-key-consumers.js";
import { catalog } from "./catalog.js";
import { serviceCredentialKey } from "./provision-files.js";

async function accepts(services, name, key) {
  try {
    await services.arr(name, "/system/status", { headers: { "X-Api-Key": key } });
    return true;
  } catch (error) {
    if ([401, 403].includes(error.status)) return false;
    throw Error(`Die ${name}-API konnte den Schlüssel nicht verlässlich prüfen.`);
  }
}

async function configKey(dir, uid) {
  const file = path.join(dir, "config.xml");
  const parent = await lstat(dir), stat = await lstat(file);
  if (!parent.isDirectory() || parent.uid !== uid || parent.mode & 0o022 ||
      !stat.isFile() || stat.uid !== uid || stat.mode & 0o022 || stat.size > 1024 * 1024 ||
      await realpath(file) !== file)
    throw Error("Die Dienstkonfiguration ist nicht sicher verwaltet.");
  const text = await readFile(file, "utf8");
  const tags = [...text.matchAll(/<ApiKey>([a-f0-9]{32})<\/ApiKey>/gi)];
  if (tags.length !== 1 || !/^\s*(?:<\?xml[^>]*>\s*)?<Config>[\s\S]*<\/Config>\s*$/i.test(text))
    throw Error("Der Dienstschlüssel konnte in der Konfiguration nicht eindeutig gefunden werden.");
  return { file, text, key: tags[0][1], tag: tags[0][0] };
}

export async function rotateArrKey(services, docker, name) {
  if (!["Sonarr", "Radarr", "Lidarr"].includes(name))
    throw Error("Schlüsselwechsel für diesen Dienst ist nicht verfügbar.");
  const { slug } = catalog.services[name];
  const { plan, vault } = services;
  const keyName = serviceCredentialKey(plan, name);
  const saved = vault.get(keyName);
  if (!saved || !/^[a-f0-9]{32}$/i.test(saved.apiKey))
    throw Error("Im Tresor ist kein gültiger Dienstschlüssel hinterlegt.");
  const { pendingApiKey, pendingConsumers, ...credentials } = saved;
  const previous = credentials.apiKey, next = pendingApiKey || randomBytes(16).toString("hex");
  if (!/^[a-f0-9]{32}$/i.test(next) || previous === next)
    throw Error("Der vorbereitete Schlüsselwechsel ist ungültig.");
  const dir = path.join(plan.appdata, slug);
  const root = plan.rootId || plan.id;
  const ids = (await docker(["ps","-aq","--no-trunc","--filter","label=com.docker.compose.project="+plan.project,
    "--filter","label=com.docker.compose.service="+slug,"--filter","label=io.stackpilot.plan="+root])).trim().split(/\s+/);
  if (ids.length !== 1 || !/^[a-f0-9]{64}$/.test(ids[0]))
    throw Error("Der verwaltete Container wurde nicht eindeutig gefunden.");
  const id = ids[0];
  const [container] = JSON.parse(await docker(["inspect",id]));
  if (container.Id !== id || container.Config.Labels["io.stackpilot.managed"] !== "true" ||
      container.Config.Labels["io.stackpilot.plan"] !== root ||
      container.Config.Labels["com.docker.compose.project"] !== plan.project ||
      container.Config.Labels["com.docker.compose.service"] !== slug || container.HostConfig.Privileged ||
      container.Config.Image !== plan.images[name] || container.State.Paused ||
      !container.Mounts.some((mount) => mount.Source === dir && mount.Type === "bind" && mount.Destination === "/config" && mount.RW))
    throw Error("Container oder Konfiguration gehört nicht zur gespeicherten Installation.");

  const found = await configKey(dir, plan.uid);
  if (![previous, next].includes(found.key))
    throw Error("Der bisherige Schlüssel stimmt nicht mit der Dienstkonfiguration überein.");
  const consumers = await arrKeyConsumers(services, name, previous, next, !!pendingApiKey, pendingConsumers);
  if (!pendingApiKey && (!container.State.Running || !await accepts(services, name, previous)))
    throw Error(`${name} bestätigt den bisherigen Schlüssel nicht.`);
  if (!pendingApiKey || !pendingConsumers)
    vault.set(keyName, { ...credentials, pendingApiKey: next, pendingConsumers: consumers.ids });

  if (found.key !== next || !container.State.Running) {
    if (container.State.Running)
      await docker(["stop","--time","30",id], {timeout:45000});
    try {
      const [stopped] = JSON.parse(await docker(["inspect",id]));
      if (stopped.Id !== id || stopped.State.Running || stopped.State.Restarting)
        throw Error("Der Dienstcontainer konnte nicht sicher gestoppt werden.");
      const config = await configKey(dir, plan.uid);
      if (![previous, next].includes(config.key)) throw Error("Konfiguration wurde parallel geändert.");
      if (config.key !== next) {
        const temporary = await mkdtemp(path.join(dir,".key-rotation-"));
        try {
          const file = path.join(temporary,"config.xml");
          await writeFile(file, config.text.replace(config.tag, `<ApiKey>${next}</ApiKey>`), {mode:0o600, flag:"wx", flush:true});
          await rename(file, config.file);
        } finally { await rm(temporary,{recursive:true,force:true}); }
      }
    } finally {
      await docker(["start",id], {timeout:45000});
    }
  }

  let ready = false;
  for (let attempt=0;attempt<24;attempt++) {
    if (await accepts(services, name, next).catch(()=>false)) { ready=true; break; }
    await new Promise((resolve)=>setTimeout(resolve,750));
  }
  if (!ready || await accepts(services, name, previous))
    throw Error("Der Schlüsselwechsel ist noch nicht bestätigt. Dieselbe Aktion erneut ausführen.");
  await consumers.update();
  vault.set(keyName, {...credentials,apiKey:next});
  return {ok:true};
}
