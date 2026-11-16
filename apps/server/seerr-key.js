import { seerrServiceAdmin } from "./quality-policy.js";

const format = /^[a-z0-9_+=/-]{24,128}$/i;

async function isAdmin(s, key) {
  try {
    return seerrServiceAdmin(await s.request("Seerr", "/api/v1/auth/me", { headers: { "X-Api-Key": key } }));
  } catch (error) {
    if ([401, 403].includes(error.status)) return false;
    throw Error("Die Seerr-API konnte den Schlüssel nicht verlässlich prüfen.");
  }
}

export async function rotateSeerrKey(s, engine, couchdeck) {
  const { plan, vault } = s;
  const row = (await engine.validate(plan, true)).find(row => row.service === "seerr");
  if (!row) throw Error("Der verwaltete Seerr-Container fehlt.");
  const [container] = JSON.parse(await engine.docker(["inspect", row.id]));
  if (!container.State.Running || (container.Config.Env || []).some(value => value.startsWith("API_KEY=")))
    throw Error("Seerr muss laufen und den Schlüssel selbst verwalten. Die API_KEY-Umgebungsvariable hat Vorrang.");

  const journal = `seerr-key:${plan.rootId || plan.id}`;
  const staged = vault.get(journal);
  const current = (await s.additional.seerr("/settings/main")).apiKey;
  const previous = staged?.previous ?? current;
  let next = staged?.next ?? (staged?.previous && current !== previous ? current : null);
  if (typeof previous !== "string" || !format.test(previous) || !format.test(current || "") ||
      (next && (!format.test(next) || previous === next || current !== next)))
    throw Error("Der Seerr-Schlüssel stimmt nicht mit der vorbereiteten Änderung überein.");

  const linked = await couchdeck.integrationFor(plan);
  const legacy = linked?.seerr?.apiKey;
  if (legacy && (linked.seerr.personalSession || ![previous, next].includes(legacy)))
    throw Error("Der ältere Seerr-Zugang in Couchdeck ist nicht eindeutig zugeordnet.");
  if (staged?.legacy && !legacy)
    throw Error("Die vorbereitete ältere Couchdeck-Verknüpfung fehlt.");
  if (!staged?.previous) {
    if (!await isAdmin(s, previous)) throw Error("Seerr bestätigt den bisherigen Schlüssel nicht.");
    vault.set(journal, { previous, legacy: !!legacy });
  }

  if (!next) {
    await s.additional.seerr("/settings/main/regenerate", { method: "POST" }).catch(() => {});
    next = (await s.additional.seerr("/settings/main")).apiKey;
  }
  if (!format.test(next || "") || next === previous ||
      !await isAdmin(s, next) || await isAdmin(s, previous))
    throw Error("Der neue Seerr-Schlüssel wurde nicht bestätigt. Dieselbe Aktion erneut ausführen.");
  vault.set(journal, { previous, next, legacy: !!legacy });
  if (legacy === previous) {
    const latest = await couchdeck.integrationFor(plan);
    if (latest?.seerr?.apiKey !== previous)
      throw Error("Die Couchdeck-Verknüpfung wurde parallel geändert. Erneut prüfen.");
    await couchdeck.writeIntegration({ ...latest, seerr: { ...latest.seerr, apiKey: next } });
  }
  if (legacy) {
    if ((await couchdeck.integrationFor(plan))?.seerr?.apiKey !== next)
      throw Error("Der Seerr-Zugang in Couchdeck konnte nicht bestätigt werden.");
    if ((await couchdeck.status()).state === "running") await couchdeck.restart();
  }
  vault.set(journal, {});
  return { ok: true };
}
