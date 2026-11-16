import { randomBytes } from "node:crypto";
import { lstat, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { serviceCredentialKey } from "./provision-files.js";

async function accepts(services, key) {
  try {
    await services.arr("Lidarr", "/system/status", { headers: { "X-Api-Key": key } });
    return true;
  } catch (error) {
    if ([401, 403].includes(error.status)) return false;
    throw Error("Die Lidarr-API konnte den Schlüssel nicht verlässlich prüfen.");
  }
}

async function prowlarrLink(services, previous, next) {
  if (!services.plan.spec.selected.includes("Prowlarr")) return null;
  const apps = await services.arr("Prowlarr", "/applications");
  const managedUrl = (app) => app.fields?.some((field) =>
    field.name === "baseUrl" && ["http://lidarr:8686", "http://lidarr:8686/"].includes(field.value));
  const targets = apps.filter((app) => app.name === "StackPilot Lidarr" ||
    (app.implementation === "Lidarr" && managedUrl(app)));
  if (!targets.length) return null;
  const app = targets[0], keys = app.fields?.filter((field) => field.name === "apiKey") || [];
  const masked = typeof keys[0]?.value === "string" && /^\*+$/.test(keys[0].value);
  if (targets.length !== 1 || app.name !== "StackPilot Lidarr" || app.implementation !== "Lidarr" ||
      !managedUrl(app) || !Number.isSafeInteger(app.id) ||
      keys.length !== 1 || (!masked && ![previous, next].includes(keys[0].value)))
    throw Error("Prowlarrs Lidarr-Verbindung ist nicht eindeutig verwaltet. Einstellungen prüfen.");
  return { app, current: masked ? null : keys[0].value };
}

async function configKey(dir, uid) {
  const file = path.join(dir, "config.xml");
  const parent = await lstat(dir), stat = await lstat(file);
  if (!parent.isDirectory() || parent.uid !== uid || parent.mode & 0o022 ||
      !stat.isFile() || stat.uid !== uid || stat.mode & 0o022 || stat.size > 1024 * 1024 ||
      await realpath(file) !== file)
    throw Error("Die Lidarr-Konfiguration ist nicht sicher verwaltet.");
  const text = await readFile(file, "utf8");
  const tags = [...text.matchAll(/<ApiKey>([a-f0-9]{32})<\/ApiKey>/gi)];
  if (tags.length !== 1 || !/^\s*(?:<\?xml[^>]*>\s*)?<Config>[\s\S]*<\/Config>\s*$/i.test(text))
    throw Error("Der Lidarr-Schlüssel konnte in der Konfiguration nicht eindeutig gefunden werden.");
  return { file, text, key: tags[0][1], tag: tags[0][0] };
}

export async function rotateLidarrKey(services, docker) {
  const { plan, vault } = services;
  const keyName = serviceCredentialKey(plan, "Lidarr");
  const saved = vault.get(keyName);
  if (!saved || !/^[a-f0-9]{32}$/i.test(saved.apiKey))
    throw Error("Im Tresor ist kein gültiger Lidarr-Schlüssel hinterlegt.");
  const { pendingApiKey, ...credentials } = saved;
  const previous = credentials.apiKey, next = pendingApiKey || randomBytes(16).toString("hex");
  if (!/^[a-f0-9]{32}$/i.test(next) || previous === next)
    throw Error("Der vorbereitete Schlüsselwechsel ist ungültig.");
  const dir = path.join(plan.appdata, "lidarr");
  const root = plan.rootId || plan.id;
  const ids = (await docker(["ps","-aq","--no-trunc","--filter","label=com.docker.compose.project="+plan.project,
    "--filter","label=com.docker.compose.service=lidarr","--filter","label=io.stackpilot.plan="+root])).trim().split(/\s+/);
  if (ids.length !== 1 || !/^[a-f0-9]{64}$/.test(ids[0]))
    throw Error("Der verwaltete Lidarr-Container wurde nicht eindeutig gefunden.");
  const id = ids[0];
  const [container] = JSON.parse(await docker(["inspect",id]));
  if (container.Id !== id || container.Config.Labels["io.stackpilot.managed"] !== "true" ||
      container.Config.Labels["io.stackpilot.plan"] !== root ||
      container.Config.Labels["com.docker.compose.project"] !== plan.project ||
      container.Config.Labels["com.docker.compose.service"] !== "lidarr" || container.HostConfig.Privileged ||
      container.Config.Image !== plan.images.Lidarr || container.State.Paused ||
      !container.Mounts.some((mount) => mount.Source === dir && mount.Type === "bind" && mount.Destination === "/config" && mount.RW))
    throw Error("Container oder Konfiguration gehört nicht zur gespeicherten Lidarr-Installation.");

  const found = await configKey(dir, plan.uid);
  if (![previous, next].includes(found.key))
    throw Error("Der bisherige Schlüssel stimmt nicht mit der Lidarr-Konfiguration überein.");
  const originalLink = await prowlarrLink(services, previous, next);
  if (originalLink && !pendingApiKey)
    await services.arr("Prowlarr", "/applications/test", { method:"POST", body:originalLink.app })
      .catch(() => { throw Error("Prowlarr bestätigt die bisherige Lidarr-Verbindung nicht."); });
  const active = pendingApiKey && container.State.Running && await accepts(services, next);
  if (!active) {
    if (!pendingApiKey && (!container.State.Running || !await accepts(services, previous)))
      throw Error("Lidarr bestätigt den bisherigen Schlüssel nicht.");
    vault.set(keyName, { ...credentials, pendingApiKey: next });
    if (container.State.Running)
      await docker(["stop","--time","30",id], {timeout:45000});
    try {
      const [stopped] = JSON.parse(await docker(["inspect",id]));
      if (stopped.Id !== id || stopped.State.Running || stopped.State.Restarting)
        throw Error("Der Lidarr-Container konnte nicht sicher gestoppt werden.");
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
    if (await accepts(services,next).catch(()=>false)) { ready=true; break; }
    await new Promise((resolve)=>setTimeout(resolve,750));
  }
  if (!ready || await accepts(services,previous))
    throw Error("Der Schlüsselwechsel ist noch nicht bestätigt. Dieselbe Aktion erneut ausführen.");
  const link = await prowlarrLink(services,previous,next);
  if (link && link.current !== next) {
    const { app } = link;
    await services.arr("Prowlarr", `/applications/${app.id}`, {
      method:"PUT", body:{...app,fields:app.fields.map((field)=>
        field.name === "apiKey" ? {...field,value:next} : field)},
    }).catch(()=>{});
  }
  if (originalLink) {
    const verified = await prowlarrLink(services,previous,next);
    const connected = verified?.app.id === originalLink.app.id &&
      (verified.current === null || verified.current === next) &&
      await services.arr("Prowlarr", "/applications/test", { method:"POST", body:verified.app })
        .then(() => true, () => false);
    if (!connected)
      throw Error("Lidarr nutzt den neuen Schlüssel. Prowlarr ist noch nicht bestätigt. Dieselbe Aktion erneut ausführen.");
  }
  vault.set(keyName, {...credentials,apiKey:next});
  return {ok:true};
}
