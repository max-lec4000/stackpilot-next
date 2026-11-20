// App-Adapter für Seerr (Phase 7.0a). Benannte Methoden statt freier API-Pfade; Fachlogik
// spricht Seerr nur noch hierüber an. Weitere Methoden kommen mit den Bereichen in 7.1 ff.
import { writeAndConfirm, userFacing } from "./confirm.js";

export const SEERR = Object.freeze({
  ADMIN: 2, MANAGE_REQUESTS: 16, REQUEST: 32,
  AUTO_APPROVE: 128, AUTO_APPROVE_MOVIE: 256, AUTO_APPROVE_TV: 512,
});
const normalize = (value) => String(value || "").replaceAll("-", "").toLowerCase();
const id = (value) => {
  if (!Number.isSafeInteger(value) || value < 1) throw userFacing("Ungültiges Seerr-Konto.");
  return value;
};

export class SeerrAdapter {
  /** s: Dienstkontext aus hub.context (s.additional.seerr ist der geschützte Zugang). */
  constructor(s) {
    this.call = (route, options) => s.additional.seerr(route, options);
  }

  async version() {
    const status = await this.call("/status");
    return typeof status?.version === "string" ? status.version : null;
  }

  /** Alle Konten, seitenweise; bricht bei unplausiblen Antworten ab. */
  async users() {
    const users = [];
    for (let skip = 0; skip < 10000; skip += 100) {
      const page = await this.call(`/user?take=100&skip=${skip}`);
      if (!Array.isArray(page?.results)) throw Error("Seerr-Nutzerliste nicht bestätigt.");
      users.push(...page.results);
      if (page.results.length < 100) return users;
    }
    throw Error("Seerr-Nutzerliste zu groß für einen sicheren Abgleich.");
  }

  async user(userId) {
    return this.call(`/user/${id(userId)}`);
  }

  /** Konten zu einem Jellyfin-Konto (Kennung mit oder ohne Bindestriche). */
  async usersForJellyfin(jellyfinId) {
    const want = normalize(jellyfinId);
    return want ? (await this.users()).filter((u) => normalize(u.jellyfinUserId) === want) : [];
  }

  async importFromJellyfin(jellyfinId) {
    await this.call("/user/import-from-jellyfin", { method: "POST", body: { jellyfinUserIds: [normalize(jellyfinId)] } });
    return this.usersForJellyfin(jellyfinId);
  }

  /** Anfragelimits eines Kontos setzen (Seerr: Kontoeinstellungen „main“) und zurücklesen. */
  async setQuotas(userId, quotas) {
    const route = `/user/${id(userId)}/settings/main`;
    const current = await this.call(route);
    if (!current || typeof current !== "object") throw userFacing("Seerr-Kontoeinstellungen nicht lesbar.");
    return writeAndConfirm({
      write: () => this.call(route, { method: "POST", body: { ...current, ...quotas } }),
      read: () => this.call(route),
      check: (saved) => ["movieQuotaLimit", "movieQuotaDays", "tvQuotaLimit", "tvQuotaDays"].every((k) => (saved?.[k] ?? null) === (quotas[k] ?? null)),
      message: "Seerr hat das Anfragelimit nicht bestätigt. Erneut prüfen.",
    });
  }

  /** Rechte setzen und bestätigen lassen (gleiches Konto, gleiche Jellyfin-Verknüpfung). */
  setPermissions(user, permissions) {
    return writeAndConfirm({
      write: () => this.call(`/user/${id(user.id)}`, {
        method: "PUT",
        body: { ...(typeof user.username === "string" ? { username: user.username } : {}), permissions },
      }),
      read: () => this.user(user.id),
      check: (saved) => saved?.permissions === permissions && normalize(saved.jellyfinUserId) === normalize(user.jellyfinUserId),
      message: "Seerr hat die Rechte nicht bestätigt. Erneut prüfen.",
    });
  }
}

export const seerrAdapter = (s) => new SeerrAdapter(s);
export { normalize as normalizeJellyfinId };
