# Changelog

## 0.5.0 – November 2026

### Sonarr- und Radarr-Schlüssel

- Die Schlüssel lassen sich in StackPilot erneuern. Verwaltete
  Verbindungen in Prowlarr, Seerr und Bazarr übernehmen den
  neuen Schlüssel automatisch. Ein unterbrochener Wechsel lässt
  sich mit derselben Aktion fortsetzen.

### Serienübersicht und Filmgrößen

- Couchdeck 0.2.6 zeigt in den Seriendetails die Gesamtzahl der
  Staffeln sowie angekündigte Folgen mit verfügbarem Datum. Im
  Kino-Bereich wird der freie Medienspeicher eingeblendet.
- Ein Auswahl-Dialog bündelt das Zurückziehen eigener Serienanfragen
  und das Entfernen einzelner Staffeln aus einer offenen Anfrage.
- StackPilot zeigt die aktive Größenrate und Grenze eines Films.
  Bei bekannter Dateigröße vergleicht der Editor die vorhandene
  Datei mit der aktiven und der geplanten Grenze.

### Couchdeck 0.2.5

- Bei einer YouTube-Bot-Bestätigung zeigt Couchdeck den offiziellen
  Videolink als QR-Code für Handy oder Tablet. Der Link lässt sich auch
  in den Videodetails anzeigen. Couchdeck erzeugt den QR-Code lokal.

### Geschütztes Jellyfin und Couchdeck 0.2.4

- StackPilot bereitet einen Rückweg für geschütztes Jellyfin vor und
  prüft danach die Authentik-Weiterleitung. Der Test mit zwei offiziellen
  Image-Referenzen von Jellyfin 12.4.0 bestand. Eine neue Katalogversion
  erfordert eine eigene Abnahme der geschützten Anmeldung.
- Couchdeck unterdrückt nach einer YouTube-Bot-Bestätigung zusätzliche
  Ausweichabrufe und pausiert das automatische Vorladen.

### Tresor-Wiederherstellung

- Nach der Archivprüfung zeigt StackPilot den Serverbefehl für die
  Übernahme an. Der Befehl startet StackPilot nach dem Tausch neu.
  Die bisherige Datenbank bleibt für die manuelle Rückkehr erhalten.
  Bei einer fehlgeschlagenen Startprüfung wird sie automatisch wieder aktiv.

### Update für Filmprofile und Wartung

- Verbindliche Filmprofile erkennen die Seerr-Administratorberechtigung
  korrekt. Größen- und Qualitätsvorgaben bleiben bei fehlender
  Berechtigung gesperrt.
- Für bereits in Radarr erfasste Filme lässt sich ein dauerhaftes
  Größenlimit für automatische Downloads setzen. Beim Ausschalten wird
  das bisherige Profil wieder zugewiesen.
- Die Wartungsoberfläche kann den Lidarr-Schlüssel erneuern und die
  verwaltete Prowlarr-Verbindung mit aktualisieren. Sie kann verschlüsselte
  Tresor-Sicherungen in einen privaten Ordner wiederherstellen.
- Nach gescheiterter Container-Rückkehr startet ein erneuter Versuch
  aus der ursprünglichen Sicherung.
- Couchdeck unterscheidet YouTubes Bot-Schutz von allgemeinen
  Anmeldefehlern. Das vorbereitete Streamyfin-Gateway bleibt bis zur
  Abnahme eines gepatchten Seerr-Images deaktiviert.

### Neubau

Neubau auf Basis von 0.4 mit dem Ziel „so wenige Schritte wie möglich“.

- **Ein Installationsbefehl** (`install.sh`): Docker, Node, Systemdienst, Tailscale-Rechte,
  begrenzte Root-Hilfe. Aktualisieren aus der Oberfläche holt die neue Version von GitHub.
- **Couchdeck** ist Teil des Stacks: Installation, Starten/Schließen, Wohnzimmer-Konto und
  Seerr-Zugang automatisch.
- **Assistent in vier Seiten**; alle Apps vorausgewählt, Übernahme eines vorhandenen
  Medienordners.
- **Zugriff von unterwegs in einem Auftrag**: Authentik, Schutz-Gateway, SSO, HTTPS,
  Fernzugriff in Jellyfin, Admins nur lokal, erster Zuschauer.
- **Zuschauer einladen** mit einem Namen; zweiter Faktor wird bei der ersten Anmeldung
  eingerichtet.
- Dienste und Oberfläche im Heimnetz und Tailnet erreichbar.
- App-Katalog (`packages/domain/apps.js`): neue Apps bekommen Adressen und Schlüssel ihrer
  Partner automatisch.
- Entfernt: alte Acht-Schritte-Einrichtung, Nutzerdienst-Updates per Git-Checkout.

## 0.4.0 – 10. November 2026

### Geschützte Funnel-Freigabe

- Der letzte Schritt unter Externer Zugriff prüft aktuelle Voraussetzungen,
  persönliche Geräteabnahme und Wiederherstellung vor einer öffentlichen Freigabe.
- Nur die geschützten Jellyfin- und Authentik-Anmelderouten werden veröffentlicht.
  Lokale Bindings sowie SSH-, Firewall- und Tailnet-Regeln bleiben erhalten.
- Abschaltung erhält private HTTPS-Routen und funktioniert unabhängig vom
  Authentik-/Jellyfin-Verbindungsnachweis. Teilfehler versuchen die Rücknahme
  eigener Freigaben; fremde Routen werden nicht überschrieben.
- Wiederkehrende Sicherheitsprüfung bei laufendem StackPilot. Persönliche MFA,
  Gerätewiderruf und der echte Zugriff über Mobilfunk bleiben eigene Nachweise.
  Smart-TV ist vorerst keine Voraussetzung.

### Suche, Ansichten und Medien

- Downloadsuche über den gesamten Downloadclient, anschließend serverseitige
  Seitensteuerung. Prioritätsaktionen sind an die bestehende VPN-Prüfung gebunden.
- Übergreifende Suche nach Anwendungen und Medien, lokale Hinweise,
  gespeicherte Filter und auswählbare Dashboard-Bereiche.
- Gemeinsame SVG-Symbole und verständlichere Fehlerhilfen bei Downloads.
- Portabler Musikbestand mit Such-/Seitenansicht, Metadatenexport und lesender
  ID3-/FLAC-Tagprüfung. Keine automatische Dateiumbenennung oder Tagänderung.

### Wartung und Umfang

- Geführte Code-Updates über einen unabhängigen Nutzerdienst: getrennte
  Vorbereitung, Tests, Build, Gesundheitsprüfung und Rückweg bei Startfehlern.
  Eigene Checkout-Änderungen und unbekannte Zustandsmigrationen sperren das Update.
- Getestete Grundlagen für verschlüsselte Stack-Archive und Kaltstopp.
  Vollständige Stack-Sicherung, Produktionswiederherstellung und Mediencontainer-
  Updates sind noch keine freigegebenen Bedienfunktionen.
- 235 Fachtests, Produktionsbuild und Browserregression mit isolierten
  API-Fixtures. Kein Nachweis einer echten öffentlichen Funnel-Freigabe.

## 0.3.0 – 10. November 2026

### Kompakter Alltag

- Ein Dashboard bündelt tatsächlichen App-Zustand, Speicher, VPN und Medienaktivität.
  Doppelte Zusammenfassungen und große Leerzustände entfallen; Betriebshinweise
  und weitere Geräte sind bei Bedarf aufklappbar.
- Anwendungen als durchsuchbare, filterbare Liste mit begrenzten Seiten. Image,
  Benutzername und lokale Zugriffshinweise öffnen sich erst im Detail-Panel.
  Geschützte Zugangsanzeige verlangt weiterhin erneute Anmeldung und erlischt
  nach 20 Sekunden.
- Downloads mit vorhandenen Serverfiltern, Seitensteuerung und Suche auf der
  aktuellen Seite. Vollständige Transfers ohne redundanten Fortschrittsbalken;
  passende Pause-/Fortsetzen-Aktionen nach tatsächlichem Zustand. Entfernen und
  Dateilöschen bleiben getrennte, bestätigte Aktionen.
- Discover zeigt zunächst zwölf kompakte Poster pro Ergebnisseite. Beschreibung,
  Staffel-, Größen- und Qualitätswahl bleiben in der Detailansicht erreichbar.
- Anfragen als kompakte Statusliste mit Detail-Panel, Größen und direkten
  Übergängen zu Downloads und der tatsächlich konfigurierten Jellyfin-Adresse.
  Archiv, Abbruch, Qualität, Löschung, Bibliotheksabgleich und Diagnose bleiben erhalten.

### Navigation und gemeinsame Gestaltung

- Verwaltung öffnet eine reine Bereichsauswahl. Konfigurationsbereiche haben
  eigene Hash-Adressen, etwa `#/verwaltung/remote`; Browser-Zurück und direkte
  Wiederaufrufe funktionieren mit dem vorhandenen lokalen Server.
- Gemeinsame semantische Design-Tokens für Light und Dark: warme violette
  Akzente, neutrale Oberflächen, konsistente Abstände und lesbare Statusanzeigen.
- Wiederverwendbare Überschriften, Leerzustände, Statusanzeigen, Seitensteuerung
  und native Detail-Panels mit Tastaturfokus, Escape und Fokusrückgabe.
- Kompakte feste Navigation auf Desktop, Tablet und Mobile; Lade-, Fehler- und
  unbekannte Zustände bleiben von leeren Listen unterscheidbar.

### Umfang

- Frontend-Überarbeitung: Backend-Endpunkte, Authentifizierung, VPN-Regeln und
  serverseitige Downloadlogik bleiben unverändert.
- Die seitenbezogene Downloadsuche ist bewusst keine Suche im gesamten Client.
  Persönliche MFA, Gerätezugriff und Wiedergabe benötigen weiterhin den Zielserver.

### Geprüft

- 211 Fachtests, TypeScript/Produktionsbuild und Produktions-HTTP-Integration bestanden.
- Reproduzierbare Browserregression gegen den Produktionsbuild: alle Hauptansichten,
  zehn Verwaltungsbereiche, erhaltene Anfrage-/Download-/Zugangsaktionen, Browserhistorie,
  Tastatur/Dialogfokus und Fehlerfälle. Kein unerwartetes Wiederöffnen alter Panels
  nach ausbleibenden oder fehlgeschlagenen Statusantworten.
- Beide Themes bei 1440, 1024, 768 und 390 px sowie feste Navigation beim Scrollen.
  API-Antworten im Browsertest sind simuliert; persönliche Geräteabnahme bleibt separat.

## 0.2.0 – 10. November 2026

### Verständlicher einrichten und verwalten

- Verwaltung in Einrichten, Betrieb und Nachsehen gegliedert; gewählter Bereich
  bleibt sichtbar und innerhalb der Browsersitzung wiederauffindbar.
- Externer Zugriff als steuerbarer Assistent mit acht Schritten, Zurück/Weiter,
  direkter Auswahl, Voraussetzungen und getrenntem gespeichertem/aktuell geprüftem
  Zustand. Navigation löst keine Installation oder Freigabe aus.
- Nur der aktuelle Einrichtungsschritt ist geöffnet. Ungespeicherte Geheimnisse
  werden beim Wechsel verworfen; bestätigte Serveraufträge laufen weiter.
- Diagnose, technische Hinweise, Kontenverwaltung und Sicherung gezielt aufrufbar.
- Warme Farben, klarere Gruppen, Fokusführung, schmale Ansichten und reduzierte
  Bewegung für beide Themes.

### Erfahrungen aus Tailscale und SSO übernommen

- Aktuelle Serveradressen werden aus Tailscale gelesen. Eine Regelvorlage gewährt
  ausschließlich ausdrücklich eingegebenen Geräten TCP 443/8443 zum gewählten
  aktuellen Server. Keine gespeicherten persönlichen IP-Beispiele.
- Eingehende Tailscale-Sperre, Serverprüfung und tatsächlicher Gerätezugriff werden
  unterschieden. Ping und SSO-Weiterleitung gelten nicht als vollständige Abnahme.
- Die alte direkte Serve-Vorlage am Schutz-Gateway vorbei entfällt.
- GitHub-Diagnoseuploads sind je Installation standardmäßig aus und müssen lokal
  freigegeben werden. Die Freigabe ist widerrufbar; normale Diagnose bleibt lokal.

### Planung und Versionierung

- Zukunftspläne für Funktionen, Fehler/Bedenken, Sicherheit, Design und Betrieb
  unter `docs/zukunft/` angelegt und nach Umsetzungsstand getrennt.
- Versionsnummer in Paket und Lockfile synchronisiert; Anzeige unter Über StackPilot
  und im erweiterten Entwicklungsbericht. Git-Tag `v0.2.0` bezeichnet diesen Stand.

### Geprüft

- 211 Fachtests, TypeScript und Produktionsbuild erfolgreich.
- Produktions-HTTP-Integration und isolierter echter Git-Berichtupload erfolgreich.
- Browserprüfung mit simulierten Diensten: aktive Auswahl, Schrittnavigation,
  Passwortverwerfen, lokale Uploadfreigabe, Tastatur und beide Themes bis 390 px.
  Diese Prüfung ersetzt keine Anmeldung oder Wiedergabe auf persönlichen Geräten.

### Grenzen und Migration

- Bestehende Medien, Konten, Container und Tailscale-Routen werden durch das
  Code-Update nicht umgestellt. Öffentlicher Funnel bleibt gesperrt.
- Bisherige Entwicklungsinstallationen benötigen für weitere automatische Uploads
  ebenfalls die einmalige lokale Freigabe. In Diagnose → Entwicklungsberichte oder:
  `npm run report:dev -- --enable-upload`. Ausschalten mit `--disable-upload`.
- Ubuntu-Zielserver und persönliche Geräte weiterhin vor Ort prüfen. Keine neue
  vollständige Stack-Sicherung, keine automatische Container-Updatefunktion und
  keine TrueNAS-Freigabe in dieser Version.
