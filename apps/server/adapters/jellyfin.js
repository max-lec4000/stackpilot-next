// App-Adapter für Jellyfin (Verwaltungszugriff mit Administrator-Kopfzeilen).
// Benannte Methoden für Anwendungsschlüssel; weitere (Bibliotheken, Benutzer, Sitzungen)
// folgen mit 7.1/7.4.
export class JellyfinAdapter {
  /** headers: Authorization-Kopfzeile einer Administrator-Sitzung */
  constructor(s, headers) {
    this.call = (route, options = {}) => s.request("Jellyfin", route, { ...options, headers: { ...headers, ...options.headers } });
    this.request = (route, options) => s.request("Jellyfin", route, options);
  }
  async apiKeys() { return (await this.call("/Auth/Keys")).Items; }
  /** Schlüssel anlegen (Fehler der Antwort zählen nicht) und alle mit diesem Namen liefern. */
  async createApiKey(appName) {
    await this.call("/Auth/Keys?app=" + encodeURIComponent(appName), { method: "POST" }).catch(() => {});
    return (await this.apiKeys()).filter((row) => row.AppName === appName);
  }
  /** Schlüssel widerrufen; ob er weg ist, prüft hasApiKey. */
  async revokeApiKey(token) {
    await this.call("/Auth/Keys/" + token, { method: "DELETE" }).catch(() => {});
  }
  async hasApiKey(token) { return (await this.apiKeys()).some((row) => row.AccessToken === token); }
  /** Systeminfo mit einer anderen Anmeldung (z. B. einem frisch ausgegebenen Schlüssel) */
  systemInfoAs(headers) { return this.request("/System/Info", { headers }); }
  logout() { return this.call("/Sessions/Logout", { method: "POST" }).catch(() => {}); }
}
