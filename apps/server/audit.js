const actions = {
  "/api/credentials/rotate-lidarr": "Lidarr-API-Schlüssel erneuert",
  "/api/credentials/rotate-sonarr": "Sonarr-API-Schlüssel erneuert",
  "/api/credentials/rotate-radarr": "Radarr-API-Schlüssel erneuert",
  "/api/credentials/rotate-bazarr": "Bazarr-API-Schlüssel erneuert",
  "/api/remote-access/funnel/enable": "Öffentliche Jellyfin-Freigabe angefordert",
  "/api/remote-access/funnel/disable": "Öffentliche Jellyfin-Freigabe zurückgenommen",
  "/api/updates/start": "StackPilot-Code-Update angefordert",
  "/api/container-maintenance/update": "Container-Update ausgeführt",
  "/api/container-maintenance/rollback": "Container-Rückkehr ausgeführt",
  "/api/vault-backup/restore": "Tresor-Sicherung isoliert wiederhergestellt",
  "/api/vault-backup": "Verschlüsselte Tresor-Sicherung heruntergeladen",
  "/api/development/consent": "Lokale Freigabe für Entwicklungsuploads geändert",
  "/api/development/report/publish": "Bereinigter Entwicklungsbericht nach GitHub übertragen",
  "/api/media/request": "Medienanfrage erstellt",
  "/api/media/request/archive": "Anfrage archiviert oder zurückgeholt",
  "/api/media/request/cancel": "Anfrage abgebrochen",
  "/api/media/film-limit": "Automatisches Radarr-Filmgrößenlimit geändert",
  "/api/media/quality": "Qualitätsprofil geändert",
  "/api/media/size-settings": "Größenstandard geändert",
  "/api/media/series-limits": "Seriengrößenlimits geändert",
  "/api/media/research": "Suche gestartet",
  "/api/media/library/refresh": "Bibliotheksabgleich angestoßen",
  "/api/media/movie-removal/execute": "Filmlöschung ausgeführt",
  "/api/downloads/action": "Downloadaktion ausgeführt",
  "/api/downloads/resume": "Geschütztes Fortsetzen angefordert",
  "/api/sources/save": "Quelle gespeichert",
  "/api/sources/action": "Quellenstatus geändert",
  "/api/vpn/import": "VPN-Profil importiert",
  "/api/deployment/confirm": "Installationsauftrag angestoßen",
  "/api/deployment/pause": "Installationspause angefordert",
  "/api/deployment/resume": "Installation fortgesetzt",
  "/api/deployment/end": "Installationsauftrag beendet",
  "/api/retirement/confirm": "Altstack-Ablösung angestoßen",
  "/api/retirement/resume": "Altstack-Ablösung fortgesetzt",
  "/api/retirement/end": "Altstack-Ablösung beendet",
  "/api/managed/credentials": "Geschützte Dienstzugänge angezeigt",
  "/api/remote-access/streamyfin/activate": "Privates Streamyfin-Gateway übernommen",
  "/api/remote-access/streamyfin/rollback": "Bisheriges Jellyfin-Gateway wiederhergestellt",
  "/api/remote-access/streamyfin/prepare": "Streamyfin-Gateway geprüft",
  "/api/remote-access/protection/start": "Jellyfin-Schutzauftrag angestoßen",
  "/api/remote-access/sso/apply": "Private SSO-Verbindung eingerichtet",
  "/api/remote-access/private-serve/apply": "Private HTTPS-Routen eingerichtet",
  "/api/remote-access/admins/protect":
    "Administrator-Fernzugriff eingeschränkt",
  "/api/remote-access/devices/revoke": "Jellyfin-Gerät abgemeldet",
  "/api/remote-access/backup/create": "Authentik-Sicherung erstellt",
  "/api/remote-access/backup/test": "Wiederherstellungstest angestoßen",
  "/api/safety/start": "VPN-Ausfalltest angestoßen",
};
export class AuditLog {
  constructor(store) {
    this.store = store;
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,status TEXT NOT NULL,finished TEXT);",
    );
  }
  begin(route, actor) {
    if (!Object.hasOwn(actions, route)) return null;
    return this.store.transaction(() => {
      const row = this.store.db
        .prepare(
          "INSERT INTO audit_events(at,actor,action,status) VALUES(?,?,?,'started')",
        )
        .run(
          new Date().toISOString(),
          String(actor || "Administrator")
            .replace(/[\x00-\x1f\x7f]/g, "")
            .slice(0, 100),
          actions[route],
        );
      this.store.db.exec(
        "DELETE FROM audit_events WHERE status!='started' AND id NOT IN (SELECT id FROM audit_events ORDER BY id DESC LIMIT 10000)",
      );
      return Number(row.lastInsertRowid);
    });
  }
  finish(id, success) {
    if (id === null) return;
    this.store.db
      .prepare("UPDATE audit_events SET status=?,finished=? WHERE id=?")
      .run(success ? "completed" : "failed", new Date().toISOString(), id);
  }
  list(page = 1) {
    page = Number(page);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
      throw Error("Ungültige Verlaufsseite.");
    const total = this.store.db
        .prepare("SELECT COUNT(*) AS n FROM audit_events")
        .get().n,
      pages = Math.max(1, Math.ceil(total / 10));
    page = Math.min(page, pages);
    return {
      page,
      pages,
      total,
      events: this.store.db
        .prepare(
          "SELECT * FROM audit_events ORDER BY id DESC LIMIT 10 OFFSET ?",
        )
        .all((page - 1) * 10),
    };
  }
}
