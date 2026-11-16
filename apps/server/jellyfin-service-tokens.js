import { randomBytes } from "node:crypto";
import { dockerInput } from "./docker-io.js";

const tokenPattern = /^[a-f0-9]{32}$/i;
const idPattern = /^[a-f0-9-]{32,36}$/i;
const streamystatsTokenImage = "ghcr.io/fredrikburmester/streamystats-aio@sha256:9bc68f6301cc2ae749da950121d6efcbaa63335d458dad1d5967265af8e49382";
const requestHeaders = token => ({ Authorization: `MediaBrowser Token="${token}"` });
const normalize = id => String(id || "").replaceAll("-", "").toLowerCase();

async function actor(s, token) {
  try {
    return await s.request("Jellyfin", "/Users/Me", { headers: requestHeaders(token) });
  } catch (error) {
    if ([401, 403].includes(error.status)) return null;
    throw Error("Der Jellyfin-Dienstzugang konnte nicht geprüft werden.");
  }
}

async function finish(s, journal, state) {
  if (!tokenPattern.test(state.previous) || !tokenPattern.test(state.token) || state.previous === state.token)
    throw Error("Der vorbereitete Jellyfin-Tokenwechsel ist ungültig.");
  const oldUser = await actor(s, state.previous);
  if (oldUser) {
    if (normalize(oldUser.Id) !== normalize(state.userId))
      throw Error("Der frühere Jellyfin-Token gehört zu einem anderen Konto.");
    await s.request("Jellyfin", "/Sessions/Logout", {
      method: "POST", headers: requestHeaders(state.previous),
    }).catch(() => {});
  }
  if (await actor(s, state.previous) || normalize((await actor(s, state.token))?.Id) !== normalize(state.userId))
    throw Error("Jellyfin hat den Widerruf oder den neuen Token nicht bestätigt. Dieselbe Aktion erneut ausführen.");
  s.vault.set(journal, {});
  return { ok: true };
}

async function prepare(s, journal, previous, login, checkUser) {
  let state = s.vault.get(journal);
  if (!state?.previous) {
    if (!tokenPattern.test(previous || "")) throw Error("Es gibt keinen verwalteten Jellyfin-Diensttoken.");
    const user = await actor(s, previous);
    if (!user || !idPattern.test(user.Id || "") || !checkUser(user))
      throw Error("Der bisherige Jellyfin-Diensttoken gehört nicht eindeutig zum verwalteten Konto.");
    state = { previous, userId: user.Id, deviceId: "stackpilot-service-" + randomBytes(12).toString("hex") };
    s.vault.set(journal, state);
  }
  if (!tokenPattern.test(previous || "") || ![state.previous, state.token].includes(previous) || !tokenPattern.test(state.previous) ||
      !idPattern.test(state.userId) || !/^stackpilot-service-[a-f0-9]{24}$/.test(state.deviceId))
    throw Error("Der Jellyfin-Dienstzugang hat sich seit der Vorbereitung geändert.");
  if (!state.token) {
    const issued = await login(state);
    if (normalize(issued?.User?.Id) !== normalize(state.userId) ||
        !tokenPattern.test(issued?.AccessToken || "") || issued.AccessToken === state.previous)
      throw Error("Jellyfin hat keinen getrennten neuen Diensttoken ausgegeben.");
    state = { ...state, token: issued.AccessToken };
    s.vault.set(journal, state);
  }
  const user = tokenPattern.test(state.token) && await actor(s, state.token);
  if (!user || normalize(user.Id) !== normalize(state.userId) || !checkUser(user))
    throw Error("Jellyfin bestätigt den vorbereiteten Dienstzugang nicht.");
  return state;
}

export async function rotateCouchdeckToken(s, couchdeck) {
  const { plan, vault } = s;
  const root = plan.rootId || plan.id;
  const key = `deployment:${root}:couchdeck`, journal = `jellyfin-token:${root}:couchdeck`;
  const data = vault.get(key), linked = await couchdeck.integrationFor(plan);
  const pending = vault.get(journal);
  if (!data?.password || !idPattern.test(data.userId || "") ||
      linked?.auth?.userId !== data.userId || linked.auth.userName !== "wohnzimmer" ||
      ![data.token, pending?.previous, pending?.token].filter(Boolean).includes(linked.auth.token))
    throw Error("Couchdeck zuerst mit dem verwalteten Wohnzimmer-Konto verbinden.");
  const state = await prepare(s, journal, data.token, ({ deviceId }) => s.request("Jellyfin", "/Users/AuthenticateByName", {
    method: "POST",
    headers: { Authorization: `MediaBrowser Client="Couchdeck", Device="Couchdeck", DeviceId="${deviceId}", Version="0.1.0"` },
    body: { Username: "wohnzimmer", Pw: data.password },
  }), user => normalize(user.Id) === normalize(data.userId) && user.Policy?.IsAdministrator === false);

  if (linked.auth.token !== state.token || linked.deviceId !== state.deviceId) {
    const latest = await couchdeck.integrationFor(plan);
    if (latest?.auth?.token !== linked.auth.token)
      throw Error("Die Couchdeck-Verknüpfung wurde parallel geändert. Erneut prüfen.");
    await couchdeck.writeIntegration({ ...latest, deviceId: state.deviceId, auth: { ...latest.auth, token: state.token } });
  }
  vault.set(key, { ...data, deviceId: state.deviceId, token: state.token });
  if ((await couchdeck.status()).state === "running") await couchdeck.restart();
  return finish(s, journal, state);
}

export async function rotateSeerrJellyfinToken(s) {
  const { plan } = s;
  const journal = `jellyfin-token:${plan.rootId || plan.id}:seerr`;
  const route = "/settings/jellyfin";
  const get = () => s.additional.seerr(route);
  const settings = await get();
  const server = await s.request("Jellyfin", "/System/Info/Public");
  if (settings.ip !== "jellyfin" || Number(settings.port) !== 8096 ||
      settings.useSsl !== false || !["", "/", undefined].includes(settings.urlBase) ||
      !server?.Id || normalize(server.Id) !== normalize(settings.serverId))
    throw Error("Seerrs verwaltete Jellyfin-Verbindung konnte nicht eindeutig bestätigt werden.");
  const switchTo = async (token) => {
    if (settings.apiKey !== token) {
      if ((await get()).apiKey !== settings.apiKey)
        throw Error("Seerrs Jellyfin-Verbindung wurde parallel geändert. Erneut prüfen.");
      await s.additional.seerr(route, { method: "POST", body: { apiKey: token } }).catch(() => {});
    }
    const confirmed = await get();
    if (confirmed.apiKey !== token || normalize(confirmed.serverId) !== normalize(server.Id))
      throw Error("Seerr hat den neuen Jellyfin-Token nicht gespeichert. Dieselbe Aktion erneut ausführen.");
    if (!Array.isArray(await s.additional.seerr(route + "/users")))
      throw Error("Seerr konnte Jellyfin mit dem neuen Diensttoken nicht lesen.");
  };

  const admin = await s.additional.jellyfinLogin("seerr-token-maintenance");
  const headers = requestHeaders(admin.AccessToken);
  try {
    const list = async () => (await s.request("Jellyfin", "/Auth/Keys", { headers })).Items;
    const keys = await list();
    const staged = s.vault.get(journal);
    const previousKey = keys.find(row => row.AccessToken === (staged?.previous || settings.apiKey));
    if (staged?.appName || previousKey) {
      const state = staged?.appName ? staged : {
        previous: settings.apiKey,
        oldName: previousKey.AppName,
        appName: "StackPilot Seerr " + randomBytes(12).toString("hex"),
      };
      if (!tokenPattern.test(state.previous || "") ||
          !/^(seerr|jellyseerr|StackPilot Seerr [a-f0-9]{24})$/i.test(state.oldName || "") ||
          !/^StackPilot Seerr [a-f0-9]{24}$/.test(state.appName) ||
          ![state.previous, state.token].includes(settings.apiKey) ||
          (previousKey && previousKey.AppName !== state.oldName))
        throw Error("Der vorhandene Jellyfin-Anwendungsschlüssel gehört nicht eindeutig zu Seerr.");
      if (!staged?.appName) s.vault.set(journal, state);
      let matches = keys.filter(row => row.AppName === state.appName);
      if (!matches.length && !state.token) {
        await s.request("Jellyfin", "/Auth/Keys?app=" + encodeURIComponent(state.appName), { method: "POST", headers })
          .catch(() => {});
        matches = (await list()).filter(row => row.AppName === state.appName);
      }
      const token = matches[0]?.AccessToken;
      if (matches.length !== 1 || !tokenPattern.test(token || "") ||
          token === state.previous || (state.token && state.token !== token))
        throw Error("Jellyfin hat keinen eindeutigen neuen Seerr-Anwendungsschlüssel ausgegeben.");
      s.vault.set(journal, { ...state, token });
      if (normalize((await s.request("Jellyfin", "/System/Info", { headers: requestHeaders(token) })).Id) !== normalize(server.Id))
        throw Error("Der neue Seerr-Schlüssel gehört nicht zum verwalteten Jellyfin.");
      await switchTo(token);
      if (previousKey)
        await s.request("Jellyfin", "/Auth/Keys/" + state.previous, { method: "DELETE", headers }).catch(() => {});
      if ((await list()).some(row => row.AccessToken === state.previous))
        throw Error("Der frühere Seerr-Anwendungsschlüssel konnte nicht widerrufen werden.");
      s.vault.set(journal, {});
      return { ok: true };
    }

    const adminName = s.credentials("Jellyfin").username;
    const state = await prepare(s, journal, settings.apiKey, ({ deviceId }) => s.additional.jellyfinLogin(deviceId),
      user => user.Name === adminName && user.Policy?.IsAdministrator === true);
    await switchTo(state.token);
    return await finish(s, journal, state);
  } finally {
    await s.request("Jellyfin", "/Sessions/Logout", { method: "POST", headers }).catch(() => {});
  }
}

export async function rotateStreamystatsJellyfinToken(s, engine) {
  const { plan, vault } = s;
  const root = plan.rootId || plan.id;
  const key = `deployment:${root}:streamystats-jellyfin`;
  const journal = `jellyfin-token:${root}:streamystats`;
  const saved = vault.get(key), pending = vault.get(journal);
  const container = (await engine.validate(plan, true)).find(row => row.service === "streamystats");
  if (!container || container.image !== streamystatsTokenImage ||
      container.status !== "running" || !/^[a-f0-9]{64}$/.test(container.id) ||
      !tokenPattern.test(saved?.accessToken || "") || !idPattern.test(saved?.userId || ""))
    throw Error("Die verwaltete Streamystats-Installation stimmt nicht mit dem geprüften Datenbankschema überein.");

  const jellyfin = await s.request("Jellyfin", "/System/Info/Public");
  const rows = await s.request("Streamystats", "/api/servers");
  const candidates = rows.filter(row => (row.internalUrl || row.url) === "http://jellyfin:8096");
  const [server] = candidates;
  if (candidates.length !== 1 || !Number.isSafeInteger(server.id) || server.id < 1 ||
      !idPattern.test(jellyfin?.Id || "") || server.jellyfinId !== jellyfin.Id)
    throw Error("Der verwaltete Jellyfin-Eintrag in Streamystats ist nicht eindeutig.");

  // The pinned AIO image has no REST update. Use its local database and compare-and-set just this key.
  // Tokens are sent through COPY over stdin, never in command arguments or in the SQL statement log.
  const sql = async (query) => (await dockerInput(["exec", "-i", "--user", "postgres", container.id,
    "psql", "-X", "-w", "-v", "ON_ERROR_STOP=1", "-qAt", "-d", "streamystats"], query, { timeout: 15000 })).trim();
  const filter = `servers.id = ${server.id} AND servers.jellyfin_id = '${jellyfin.Id}' AND
    coalesce(nullif(servers.internal_url, ''), servers.url) = 'http://jellyfin:8096'`;
  const current = () => sql(`SELECT api_key FROM public.servers WHERE ${filter};\n`);
  const before = await current();
  if (!tokenPattern.test(before) || ![saved.accessToken, pending?.previous, pending?.token].includes(before))
    throw Error("Streamystats nutzt einen anderen Jellyfin-Token als im Tresor gespeichert.");
  const state = await prepare(s, journal, before, ({ deviceId }) => s.additional.jellyfinLogin(deviceId),
    user => normalize(user.Id) === normalize(saved.userId) && user.Policy?.IsAdministrator === true);
  if (before !== state.token) {
    const changed = await sql(`BEGIN;
CREATE TEMP TABLE stackpilot_token_swap(previous text, next text) ON COMMIT DROP;
COPY stackpilot_token_swap FROM STDIN;
${state.previous}\t${state.token}
\\.
UPDATE public.servers SET api_key = swap.next, updated_at = now()
  FROM stackpilot_token_swap swap WHERE ${filter} AND servers.api_key = swap.previous RETURNING 1;
COMMIT;\n`);
    if (changed !== "1")
      throw Error("Der Streamystats-Eintrag wurde parallel geändert. Erneut prüfen.");
  }
  if (await current() !== state.token)
    throw Error("Streamystats konnte den neuen Jellyfin-Token nicht bestätigen.");
  const check = await s.request("Streamystats", `/api/watchlists?serverId=${server.id}`, { headers: requestHeaders(state.token) });
  if (!check || typeof check !== "object") throw Error("Die geschützte Streamystats-API antwortet nicht.");
  vault.set(key, { ...saved, accessToken: state.token });
  return finish(s, journal, state);
}
