import { randomBytes, randomUUID } from 'node:crypto';
import { positiveId } from './media-hub.js';
const permissions = 32 | 8192; // Request + advanced options, never approval or administration.
const norm = value => String(value || '').toLowerCase().replaceAll('-', '');
export const couchdeckFilmKey = (plan, id) => `couchdeck-film:${plan.rootId || plan.id}:${id}`;

async function requester(s, vault, plan) {
  const key = `couchdeck-requester:${plan.rootId || plan.id}`;
  let saved = vault.get(key);
  if (!saved) {
    saved = { email: `stackpilot-${randomUUID()}@requests.invalid` };
    vault.set(key, saved);
  }
  let user;
  if (saved.id) user = await s.additional.seerr(`/user/${positiveId(saved.id)}`);
  else {
    for (let skip = 0; skip < 10000; skip += 100) {
      const page = await s.additional.seerr(`/user?take=100&skip=${skip}`);
      if (!Array.isArray(page.results)) throw Error('Seerr-Konten konnten nicht geprüft werden.');
      user = page.results.find(u => u.email === saved.email);
      if (user || page.results.length < 100) break;
      if (skip === 9900) throw Error('Seerr-Kontenliste unvollständig.');
    }
    if (!user) user = await s.additional.seerr('/user', { method: 'POST', body: {
      email: saved.email, username: 'StackPilot Anfragevorbereitung', password: randomBytes(48).toString('base64url'),
    } });
    saved.id = positiveId(user.id);
    vault.set(key, saved);
    user = await s.additional.seerr(`/user/${saved.id}`);
  }
  if (!saved.ready) {
    if (user.email !== saved.email || user.userType !== 2) throw Error('Vorbereitungskonto nicht eindeutig.');
    await s.additional.seerr(`/user/${saved.id}`, { method: 'PUT', body: { permissions } });
    user = await s.additional.seerr(`/user/${saved.id}`);
  }
  if (user.id === 1 || user.email !== saved.email || user.userType !== 2 || user.permissions !== permissions)
    throw Error('Das Seerr-Vorbereitungskonto hat abweichende Rechte. Keine Anfrage gestartet.');
  saved.ready = true;
  vault.set(key, saved);
  return user;
}

export async function createCappedCouchdeckRequest(hub, s, plan, actor, mediaId, rule, detail) {
  if (!rule || rule.capGiB !== actor.capGiB || !Number.isSafeInteger(rule.serverId) || rule.serverId < 0) throw Error('Filmgrenze nicht bestätigt.');
  const viewer = await s.additional.seerr(`/user/${positiveId(actor.userId)}`);
  if (!viewer.jellyfinUserId || norm(viewer.jellyfinUserId) !== norm(actor.owner) ||
      !Number.isSafeInteger(viewer.permissions) || viewer.permissions & (2 | 16) ||
      !(viewer.permissions & (32 | 262144))) throw Error('Persönliches Seerr-Anfragerecht nicht bestätigt.');
  const vault = hub.engine.vault, key = couchdeckFilmKey(plan, mediaId);
  let job = vault.get(key);
  const active = (detail.mediaInfo?.requests || []).filter(r => ![3, 5].includes(r.status));
  if (job?.requestId && !active.some(r => r.id === job.requestId)) {
    try {
      const previous = await s.additional.seerr(`/request/${positiveId(job.requestId)}`);
      if ([3, 5].includes(previous.status)) job = null;
    } catch (error) {
      if (error.status === 404) job = null;
      else throw error;
    }
  }
  if (job && (job.owner !== actor.owner || job.userId !== viewer.id || job.rule.capGiB !== rule.capGiB || job.rule.profileId !== rule.profileId))
    throw Error('Für diesen Film besteht bereits eine andere Anfragevorbereitung.');
  if (!job && active.length) throw Error('Dieser Film wurde bereits angefragt.');
  const worker = await requester(s, vault, plan);
  const apiKey = (await s.additional.seerr('/settings/main')).apiKey;
  if (typeof apiKey !== 'string' || apiKey.length < 24) throw Error('Seerr-Dienstzugang fehlt.');
  const headers = { 'X-Api-Key': apiKey, 'X-Api-User': String(worker.id) };
  const me = await s.request('Seerr', '/api/v1/auth/me', { headers });
  if (me.id !== worker.id || me.permissions !== permissions) throw Error('Seerr bestätigt das Konto ohne Freigaberecht nicht.');
  if (!job) {
    job = { owner: actor.owner, userId: viewer.id, rule, workerId: worker.id, mediaId, startedAt: Date.now() };
    vault.set(key, job);
  }
  await hub.sizeLimits.verify(s, rule);
  let request;
  if (job.requestId) request = await s.additional.seerr(`/request/${positiveId(job.requestId)}`);
  else {
    const existing = active.find(r => r.requestedBy?.id === worker.id);
    if (existing) request = await s.additional.seerr(`/request/${positiveId(existing.id)}`);
    else {
      if (active.length) throw Error('Eine andere Anfrage ist inzwischen vorhanden.');
      request = await s.request('Seerr', '/api/v1/request', { method: 'POST', headers, body: {
        mediaType: 'movie', mediaId, is4k: false, serverId: rule.serverId, profileId: rule.profileId,
      } });
    }
    job.requestId = positiveId(request.id);
    vault.set(key, job);
  }
  const matches = r => r.media?.tmdbId === mediaId && r.media?.mediaType === 'movie' && !r.is4k &&
    r.profileId === rule.profileId && r.serverId === rule.serverId;
  if (!matches(request)) throw Error('Anfrage und Filmgrenze stimmen nicht überein. Keine automatische Freigabe.');
  if (request.requestedBy?.id === worker.id) {
    if (request.status !== 1) throw Error('Die Vorbereitung wurde außerhalb von StackPilot freigegeben. Zuordnung manuell prüfen.');
    await s.additional.seerr(`/request/${request.id}`, { method: 'PUT', body: {
      mediaType: 'movie', userId: viewer.id, serverId: rule.serverId, profileId: rule.profileId,
      ...(typeof request.rootFolder === 'string' ? {rootFolder:request.rootFolder} : {}),
      ...(Array.isArray(request.tags) ? {tags:request.tags} : {}),
    } }); // Native Seerr enforces the new owner's quota during reassignment.
    request = await s.additional.seerr(`/request/${request.id}`);
  }
  if (!matches(request) || request.requestedBy?.id !== viewer.id || ![1, 2, 5].includes(request.status))
    throw Error('Seerr hat Zuschauer und Filmgrenze nicht bestätigt.');
  const current = await s.additional.seerr(`/user/${viewer.id}`);
  if (norm(current.jellyfinUserId) !== norm(actor.owner) || current.permissions & (2 | 16))
    throw Error('Zuschauerkonto wurde geändert. Keine automatische Freigabe.');
  if (request.status === 1 && (current.permissions & (128 | 256))) {
    await hub.sizeLimits.verify(s, rule);
    await s.additional.seerr(`/request/${request.id}/approve`, { method: 'POST' });
    request = await s.additional.seerr(`/request/${request.id}`);
    if (![2, 5].includes(request.status)) throw Error('Freigabe noch nicht bestätigt. Anfrage erneut prüfen.');
  }
  job.done = true;
  vault.set(key, job);
  return request;
}
