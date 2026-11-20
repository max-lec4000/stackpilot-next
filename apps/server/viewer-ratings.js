// Jellyfin-Rechte je Zuschauer (Phase 7.1c/7.1): Altersfreigabe (MaxParentalRating; optional
// Titel ohne Altersangabe ausblenden), Herunterladen für unterwegs (EnableContentDownloading),
// Medien löschen (EnableContentDeletion) und vorübergehend sperren (IsDisabled – wirkt sofort,
// auch auf schon angemeldeten Geräten). Nur normale Zuschauerkonten, nie Administratoren.
import { normalizeJellyfinId as normalize } from "./adapters/seerr.js";

export const AGE_LEVELS = [0, 6, 12, 16, 18];
const UNRATED = ["Movie", "Series"];
const jellyfinId = (v) => /^[a-f0-9]{32}$/.test(v || "");

export class ViewerRatings {
  constructor(hub, connection, viewers) {
    Object.assign(this, { hub, connection, viewers });
  }
  async context() {
    const { s, plan } = await this.hub.context(["Jellyfin"]);
    const connection = await this.connection.context();
    const links = (await connection.request("/sso/OID/Get"))?.stackpilot?.CanonicalLinks;
    if (!links) throw Error("Die Zuordnung der Zuschauer zu Jellyfin fehlt.");
    const { viewers } = await this.viewers.list();
    return { s, plan, links, viewers: viewers.filter((v) => v.active) };
  }
  async user(s, plan, links, username) {
    const id = normalize(links["spv_" + username]);
    if (!jellyfinId(id)) return null;
    const user = await this.hub.library.request(s, plan, "/Users/" + id);
    if (!user?.Policy || normalize(user.Id) !== id) throw Error("Jellyfin-Konto nicht eindeutig bestätigt.");
    return user;
  }
  static project(username, user) {
    if (!user) return { username, linked: false, editable: false, reason: "Noch keine bestätigte Jellyfin-Anmeldung. Zuerst einmal als Zuschauer anmelden." };
    const p = user.Policy;
    if (p.IsAdministrator) return { username, linked: true, editable: false, reason: "Jellyfin-Administratoren werden hier nicht beschränkt." };
    const max = Number.isSafeInteger(p.MaxParentalRating) ? p.MaxParentalRating : null;
    const blocked = Array.isArray(p.BlockUnratedItems) ? p.BlockUnratedItems : [];
    return { username, linked: true, editable: true, maxAge: max, blockUnrated: UNRATED.every((t) => blocked.includes(t)),
      downloads: p.EnableContentDownloading !== false, deletion: p.EnableContentDeletion === true, suspended: p.IsDisabled === true };
  }
  async list() {
    const { s, plan, links, viewers } = await this.context();
    const rows = [];
    for (const v of viewers) rows.push(ViewerRatings.project(v.username, await this.user(s, plan, links, v.username)));
    return { levels: AGE_LEVELS, viewers: rows };
  }
  async change(body) {
    if (body.confirmation !== "OK") throw Error("Änderung mit OK bestätigen.");
    const has = (k) => Object.hasOwn(body, k);
    const rating = has("maxAge") || has("blockUnrated");
    const maxAge = !has("maxAge") || body.maxAge === null ? null : Number(body.maxAge);
    if (has("maxAge") && maxAge !== null && !AGE_LEVELS.includes(maxAge)) throw Error("Ungültige Altersstufe.");
    if (rating && typeof body.blockUnrated !== "boolean") throw Error("Angabe zu Titeln ohne Altersfreigabe fehlt.");
    for (const k of ["downloads", "deletion", "suspended"])
      if (has(k) && typeof body[k] !== "boolean") throw Error("Ungültige Angabe.");
    if (!rating && !["downloads", "deletion", "suspended"].some(has)) throw Error("Nichts zu ändern.");
    return this.hub.mutate(["Jellyfin"], async () => {
      const { s, plan, links, viewers } = await this.context();
      if (!viewers.some((v) => v.username === body.username)) throw Error("Zuschauer nicht gefunden.");
      const user = await this.user(s, plan, links, body.username);
      const before = ViewerRatings.project(body.username, user);
      if (!before.editable) throw Error(before.reason);
      const blocked = (user.Policy.BlockUnratedItems || []).filter((t) => !UNRATED.includes(t));
      const policy = {
        ...user.Policy,
        ...(rating ? {
          MaxParentalRating: maxAge,
          ...("MaxParentalSubRating" in user.Policy ? { MaxParentalSubRating: null } : {}),
          BlockUnratedItems: body.blockUnrated ? [...blocked, ...UNRATED] : blocked,
        } : {}),
        ...(has("downloads") ? { EnableContentDownloading: body.downloads } : {}),
        ...(has("deletion") ? { EnableContentDeletion: body.deletion } : {}),
        ...(has("suspended") ? { IsDisabled: body.suspended } : {}),
      };
      await this.hub.library.request(s, plan, "/Users/" + normalize(user.Id) + "/Policy", { method: "POST", body: policy });
      const after = ViewerRatings.project(body.username, await this.user(s, plan, links, body.username));
      if ((rating && (after.maxAge !== maxAge || after.blockUnrated !== body.blockUnrated)) ||
          ["downloads", "deletion", "suspended"].some((k) => has(k) && after[k] !== body[k]))
        throw Error("Jellyfin hat die Änderung nicht bestätigt. Erneut laden.");
      return after;
    });
  }
}
