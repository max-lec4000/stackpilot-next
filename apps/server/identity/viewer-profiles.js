import { randomUUID } from "node:crypto";
import { setupError } from "./setup-error.js";

const normalizeId = (id) => String(id).replaceAll("-", "").toLowerCase();
const sameFolders = (actual, expected) => Array.isArray(actual) &&
  actual.map(normalizeId).sort().join(",") === expected.map(normalizeId).sort().join(",");
const invalidAuth = "Jellyfin.Server.Implementations.Users.InvalidAuthProvider";

export class ViewerProfiles {
  constructor(hub, connection, viewers) {
    this.hub = hub;
    this.connection = connection;
    this.viewers = viewers;
  }
  async context() {
    const connection = await this.connection.context();
    const key = "viewer-profiles:" + connection.record.id;
    const data = this.hub.engine.vault.get(key) || { profiles: [] };
    const allowed = connection.existing?.EnabledFolders;
    const folders = Array.isArray(allowed) ? allowed : [];
    const libraries = folders.map((id) => ({
      id,
      name: connection.libraries.find((l) => normalizeId(l.ItemId) === normalizeId(id))?.Name || "Bibliothek entfernt",
      available: connection.libraries.some((l) => normalizeId(l.ItemId) === normalizeId(id)),
    }));
    return { connection, key, data, libraries };
  }
  project({ data, libraries, connection }) {
    return { profiles: data.profiles, libraries, ready: connection.stored?.status === "configured" && libraries.length > 0,
      pending: data.pending ? { username: data.pending.username, profileId: data.pending.profileId } : null };
  }
  async list() {
    return this.project(await this.context());
  }
  async change(body) {
    return this.hub.mutate(["Jellyfin"], async () => {
      const ctx = await this.context();
      const { data, key, libraries, connection } = ctx;
      if (!this.project(ctx).ready) throw setupError("Zuerst Jellyfin-SSO mit Bibliotheksfreigaben einrichten.");
      const save = () => this.hub.engine.vault.set(key, data);
      if (data.pending && (body.action !== "assign" || body.username !== data.pending.username ||
          body.profileId !== data.pending.profileId))
        throw setupError("Zuerst die unterbrochene Profilzuweisung fortsetzen.");
      if (body.action === "create") {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name || name.length > 64 || data.profiles.length >= 50 ||
            data.profiles.some((p) => p.name.toLowerCase() === name.toLowerCase()))
          throw setupError("Einen eindeutigen Profilnamen mit bis zu 64 Zeichen wählen. Bis zu 50 Profile sind möglich.");
        const selected = body.folders;
        if (!Array.isArray(selected) || !selected.length || selected.some((id) => !libraries.some((l) => l.available && l.id === id)))
          throw setupError("Mindestens eine freigegebene Bibliothek wählen.");
        data.profiles.push({ id: randomUUID(), name, folders: [...new Set(selected)] });
        save();
      } else if (body.action === "delete") {
        const { viewers } = await this.viewers.list();
        if (viewers.some((row) => row.profileId === body.profileId))
          throw setupError("Das Profil ist einem Konto zugewiesen.");
        data.profiles = data.profiles.filter((profile) => profile.id !== body.profileId);
        save();
      } else if (body.action === "assign") {
        const username = this.viewers.normalize(body.username);
        const profile = data.profiles.find((p) => p.id === body.profileId);
        if (body.profileId !== null && !profile) throw setupError("Zuschauerprofil fehlt.");
        const baseline = await this.connection.ensureLibraryRoles(connection, this.viewers);
        const folders = profile?.folders || baseline;
        if (!data.pending && folders.some((id) => !libraries.some((l) => l.id === id && l.available)))
          throw setupError("Das Profil enthält eine entfernte Bibliothek.");
        const pending = data.pending || { username, profileId: profile?.id || null, operation: randomUUID() };
        const call = (action) => this.viewers.call({ action, ...pending, folders });
        if (!data.pending) {
          data.pending = pending;
          save();
        }
        let updateStarted = pending.updateStarted === true;
        const name = "spv_" + username;
        try {
          await call("library-stage");
          // Jellyfin can cache folder claims before issuing a session. Wait for
          // any flow that may already carry this viewer's previous claims.
          if ((await this.connection.openLogins(connection)).some((flow) => {
            const user = flow?.Username ?? flow?.username;
            return typeof user !== "string" || !user || user.toLowerCase() === name;
          }))
            throw setupError("Eine Jellyfin-Anmeldung läuft. Bitte abschließen und die Zuweisung erneut versuchen.");
          const current = (await connection.request("/sso/OID/Get"))?.stackpilot;
          if (!current) throw setupError("Jellyfin-SSO ist nicht verfügbar.");
          const link = current.CanonicalLinks?.[name];
          if (link) {
            const route = "/Users/" + encodeURIComponent(link);
            const user = await connection.request(route);
            if (user.Name !== name || normalizeId(user.Id) !== normalizeId(link) ||
                user.Policy?.IsAdministrator !== false || user.Policy.AuthenticationProviderId !== invalidAuth)
              throw setupError("Das verknüpfte Jellyfin-Zuschauerkonto konnte nicht bestätigt werden.");
            pending.updateStarted = true;
            save();
            updateStarted = true;
            await connection.request(route + "/Policy", { method: "POST",
              body: { ...user.Policy, EnableAllFolders: false, EnabledFolders: folders } });
            const policy = (await connection.request(route)).Policy;
            if (policy?.EnableAllFolders !== false || !sameFolders(policy.EnabledFolders, folders))
              throw setupError("Jellyfin hat das Profil nicht bestätigt. Bitte erneut zuweisen.");
          } else if ((await connection.request("/Users")).some((user) => user.Name.toLowerCase() === name)) {
            throw setupError("Das Jellyfin-Konto ist nicht mit dieser Anmeldung verknüpft.");
          }
          // A lost response after the commit must be retried, including for first-time viewers.
          pending.updateStarted = true;
          save();
          updateStarted = true;
          await call("library-commit");
        } catch (error) {
          if (!updateStarted) {
            try {
              await call("library-cancel");
              delete data.pending;
              save();
            } catch (cleanupError) {
              // A rejected or timed-out staging call might have already set the login lock.
              if (error.message === "Diesen Zuschauer gibt es nicht." && cleanupError.message === error.message) {
                delete data.pending;
                save();
              }
            }
          }
          throw error;
        }
        delete data.pending;
        save();
      } else {
        throw setupError("Unbekannte Profilaktion.");
      }
      return this.project(ctx);
    });
  }
}
