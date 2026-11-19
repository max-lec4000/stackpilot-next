// Routen-Verzeichnis (Phase 7.0a): Jede Schnittstelle wird mit Methode, Pfad und
// Schutzstufe deklariert; der gemeinsame Rahmen erzwingt die Stufe, bevor die Fachlogik
// läuft. Anmeldung, Herkunft, CSRF-Token, Größenlimit und Änderungsverlauf erledigt weiter
// die Middleware für alle Routen.
//
// Schutzstufen:
//   session  – angemeldete Sitzung genügt (für GET immer)
//   ok       – zusätzlich ausdrückliches „OK“ im Auftrag (body.confirmation === "OK")
//   password – zusätzlich das Administratorpasswort (body.password); mit `confirm` außerdem „OK“
// Antwortet eine Route nicht mit JSON, liefert sie `rawResponse(bytes, header)` bzw. für
// Downloads `fileResponse(bytes, dateiname)`.
export const GUARDS = ["session", "ok", "password"];

const userFacing = (message) => Object.assign(new Error(message), { userFacing: true });

const RAW = Symbol("Rohantwort");
export const rawResponse = (bytes, headers) => ({ [RAW]: { bytes, headers } });
export const fileResponse = (bytes, filename) => rawResponse(bytes, {
  "Content-Type": "application/octet-stream",
  "Content-Disposition": `attachment; filename="${filename}"`,
});
export const isRawResponse = (result) => !!result?.[RAW];
export const rawOf = (result) => result[RAW];

export class RouteRegistry {
  constructor() {
    this.routes = new Map();
  }

  /** Routen hinzufügen: [{ method, path, guard, confirm?, handler(ctx) }] */
  add(list) {
    for (const r of list) {
      if (!["GET", "POST"].includes(r.method)) throw Error(`Route ${r.path}: Methode ${r.method} nicht erlaubt.`);
      if (!/^\/api\/[a-z0-9/_-]+$/.test(r.path)) throw Error(`Route ${r.path}: ungültiger Pfad.`);
      if (!GUARDS.includes(r.guard)) throw Error(`Route ${r.path}: Schutzstufe fehlt.`);
      if (r.method === "GET" && r.guard !== "session") throw Error(`Route ${r.path}: GET ändert nichts und braucht keine Bestätigung.`);
      if (typeof r.handler !== "function") throw Error(`Route ${r.path}: Verarbeitung fehlt.`);
      const key = `${r.method} ${r.path}`;
      if (this.routes.has(key)) throw Error(`Route ${key} doppelt.`);
      this.routes.set(key, Object.freeze({ ...r }));
    }
    return this;
  }

  find(method, path) {
    return this.routes.get(`${method} ${path}`) || null;
  }

  /** Übersicht für Tests und Diagnose (ohne Verarbeitung). */
  list() {
    return [...this.routes.values()].map(({ method, path, guard }) => ({ method, path, guard }));
  }

  /** Schutzstufe prüfen, dann die Fachlogik ausführen. */
  async run(route, ctx) {
    const body = ctx.body || {};
    // Erst „OK“ prüfen: eine fehlende Bestätigung verbraucht keinen Passwortversuch.
    if ((route.guard === "ok" || (route.guard === "password" && route.confirm)) && body.confirmation !== "OK")
      throw userFacing(route.confirm || "Mit OK bestätigen.");
    // reauthenticate wirft bei falschem Passwort oder zu vielen Versuchen
    if (route.guard === "password") await ctx.manager.reauthenticate(body.password, ctx.remoteAddress);
    return route.handler(ctx);
  }
}
