# Pläne für die Zukunft

Stand: StackPilot 0.5.0. Ein Eintrag hier ist ein Vorhaben, keine Zusage und keine
Freigabe für Änderungen an einem laufenden Server.

## Offene Arbeiten

### Phase 1 · Profile und Löschen nachvollziehbar machen

Umsetzung vom 17.11.2026: gemeinsamer Filmstandard, automatisch geladene
Medienprofile und Serienbestand mit bestätigter Datei-/Download-Löschung vorhanden.
Native VM-Prüfungen und Einschränkungen siehe [Abläufe](../ablaeufe.md#gemeinsamer-filmstandard-freigaben-und-bibliotheksdateien).
Die konkrete Zuordnung des gerundeten 15–20-GB-Films bleibt ohne Titel unbestätigt.
Produktive Dateien werden bei diesem Update nicht automatisch gelöscht.

Ursprünglicher Umfang und Nachweise:

- **20-GB-Film aus einer Seerr-Anfrage untersuchen.** Auf reatest lesend
  abgleichen, welches Profil und welche Größenobergrenze StackPilot
  gespeichert hat, was Seerr beim Anfragen und Freigeben an Radarr
  übergab und welchen Treffer Radarr geladen hat. Der feste bzw.
  laufzeitabhängige StackPilot-Standard wurde bisher nur beim Anlegen durch
  StackPilot ausgewertet. Direkte Seerr-Anfragen konnten dessen eigenes
  Standardprofil verwenden; der gemeinsame Standard schließt diese Lücke. Am konkreten Download prüfen,
  welcher Fall vorlag.
- **Medienprofile verbindlich anwenden.** Den konfigurierten Standard für
  Film-Anfragen aus StackPilot, Seerr, Streamyfin und Couchdeck abgleichen.
  Bei automatischer Freigabe muss die Grenze vor der ersten Radarr-Suche
  greifen. Feste GiB-Grenze und GiB/h mit berechneter absoluter Grenze im
  Test nachweisen. Bei fehlender Laufzeit oder einer unbestätigten Regel
  den tatsächlichen Status anzeigen und keinen Download mit einem stillen
  Ersatzprofil starten.
- **Medienprofile direkt anzeigen.** Unter „Verwaltung → Medienprofile“
  das aktive Profil und die gespeicherte Größenregel beim Öffnen laden.
  Der zusätzliche Knopf „Medienprofile laden“ entfällt. Klar anzeigen,
  für welche Anfragen der jeweilige Standard gilt.
- **Andor und mögliche Reste prüfen.** Auf reatest lesend ermitteln, aus
  welcher Jellyfin-Bibliothek Couchdeck Andor abspielt und welche
  Dateien Sonarr, qBittorrent und der Medienpfad noch führen. Weitere
  Reste aus dokumentierten früheren Löschaktionen als Vorschau anzeigen.
  Der Download-Knopf entfernt einen Torrent. Anfrage abbrechen oder
  archivieren und importierte Mediatheksdateien löschen sind eigene
  Aktionen. Eine weiterhin abspielbare Serie belegt daher für sich noch
  keinen Fehler beim Löschen des Torrents.
- **Medien eindeutig und vollständig löschen können.** StackPilot soll
  für Film, ganze Serie, Staffel und Folge die betroffenen
  Mediatheksdateien und zugeordneten Downloads vorab getrennt anzeigen.
  Option zur Beendigung der Überwachung anbieten, wenn das Medium weg
  bleiben soll. Nach Bestätigung tatsächliche Löschung und aktualisierte
  Anzeige in Jellyfin, Couchdeck, Seerr und qBittorrent prüfen. Gemeinsame
  Dateien, mehrdeutige Zuordnungen und verbleibende Hardlinks sichtbar
  machen. Der Bestandsabgleich löscht erst nach ausdrücklicher Auswahl.

### Phase 2 · Anfragen und Medienversionen

Umsetzung vom 17.11.2026: Freigabe in StackPilot, automatische Freigaben je
Zuschauer sowie expliziter Film-/Einzelfolgenersatz mit Sicherung und Rückimport.
Ergänzung vom 18.11.2026: Couchdecks eigene feste Filmgrenze funktioniert auch
für freigabepflichtige Zuschauer. Vorbereitung ohne Freigaberechte, bestätigte
Zuordnung und Beibehaltung der Grenze bei der späteren Freigabe sind umgesetzt.
Der direkte Verwaltungszugriff im Tailnet hat eine Diagnose und eine auf einzelne
Geräte begrenzte Regelvorlage; die tatsächliche Freigabe erfolgt im Tailscale-Konto.

Ursprünglicher Umfang:

- **Seerr-Anfragen in StackPilot freigeben.** Administratoren können unter
  „Meine Anfragen“ ausstehende Anfragen genehmigen, auch wenn sie über
  Streamyfin oder Couchdeck erstellt wurden. StackPilot übernimmt danach
  den von Seerr bestätigten Status.
- **Automatische Freigabe pro Zuschauer verwalten.** In der
  Zuschauerverwaltung können StackPilot-Administratoren dem zugeordneten
  Seerr-Konto das Recht für automatische Freigaben geben oder entziehen.
  Die Einstellung gilt für künftige Anfragen und vergibt keine
  Seerr-Adminrechte oder Rechte zur Freigabe fremder Anfragen.
- **Importierte Version über „Qualität ändern“ ersetzen.** Bei einem
  vorhandenen Film oder einer ausgewählten Folge nach einem Treffer
  im Zielprofil mit der gewünschten Obergrenze suchen und eine Vorschau
  zeigen. Die alte Datei bleibt während des Downloads verfügbar. Erst
  eine geprüfte Ersatzdatei importieren und für den Fehlerfall einen
  Rückweg bereithalten.

### Phase 3 · Medienspeicher aufs NAS umziehen

- **Speicherort auswählen und wechseln.** Lokale Pfade und auf reatest
  eingebundene NAS-Freigaben als Medienziel unterstützen. Zuerst Filme,
  Serien und Musik auf das NAS auslagern. Apps, Datenbanken und
  Konfigurationen laufen weiter auf reatest. Ein späterer Umzug der
  Apps aufs NAS bzw. den anderen Server ist ein eigener Schritt.
- **Migration mit geprüftem Rückweg.** Quell- und Zielpfad, freien Platz,
  Dateirechte, Mount nach Neustart und Hardlink-Fähigkeit prüfen. Wenn
  Downloads lokal bleiben, den Import über Dateisystemgrenzen mit einer
  vollständigen Kopie abnehmen. Wenn Downloads und Medien auf dem NAS
  liegen, Hardlinks auf der gewählten Freigabe tatsächlich prüfen. Bei
  einem unterbrochenen NAS-Mount dürfen Dienste nicht versehentlich auf
  den leeren lokalen Mountpfad schreiben.
- **Medien übernehmen und Dienste abgleichen.** Bestand kopieren,
  Dateien am Ziel prüfen, danach die Dienste umstellen. Bibliotheken,
  Wiedergabestatus, Download-Import und Speicheranzeige in StackPilot und
  Couchdeck prüfen. Alte Dateien bis zur bestätigten Abnahme behalten.

### Phase 4 · Direkte YouTube-Wiedergabe in Couchdeck

- **Mehrere VPN-Profile (StackPilot, Couchdeck 0.2.9), Abnahme offen.** VPN-Profilliste unter
  VPN & Ausfallsperre; qBittorrent-Profil umstellbar mit Prüfung und Rückweg; übrige Profile
  als eigener YouTube-Tunnel (wireproxy v1.1.3, feste Prüfsumme) mit Weiterschalten bei
  Sperre. In sp-test nativ geprüft: YouTube über wireproxy mit Mullvad-Adresse, Wechsel
  qBittorrent hin und zurück inkl. Ausfallsperre, Downloadschutz danach „connected“.
- **Ohne Anmeldung (Couchdeck 0.2.8), persönliche Abnahme offen.** Befund vom 19.11.: YouTube
  sperrte die IPv6-Adresse (yt-dlp und offizieller eingebetteter Player gleichermaßen),
  IPv4 war frei. Couchdeck wechselt jetzt selbst zwischen IPv4 und IPv6, yt-dlp/mpv/
  Segmentlisten über denselben Weg; PO-Token-Anbieter (bgutil) und sparsames Vorabladen;
  bei Sperre beider Adressen Dialog mit großem QR-Code, „Über VPN versuchen“ (Tunnel über
  StackPilot/vpn-probe) und zuletzt der Anmeldung. Ein Ausweich-Player im offiziellen
  YouTube-Player wurde verworfen (aus gesperrter Adresse ebenfalls blockiert). In sp-test
  mit echten Abrufen geprüft (`scripts/testvm/youtube-route-check.mjs`): Wechsel IPv6→IPv4,
  mpv über den Weiterleiter, VPN-Abruf mit Mullvad-Adresse und Wiedergabe.
- **Umgesetzt in Couchdeck 0.2.7, persönliche Abnahme offen.** Bei einer Bot-Meldung
  bietet Couchdeck „Bei YouTube anmelden“: echte Google-Seite oben, Bedienung mit
  Controller und Bildschirmtastatur, Sitzung bleibt gespeichert und wird über eine
  Cookiedatei an yt-dlp übergeben; nach erkannter Anmeldung läuft das Video weiter.
  In der Test-VM ohne Bildschirm geprüft (echte Google-Anmeldeseite, Tippen, Feldwechsel,
  Navigationssperre, Cookie-Übergabe mit Testcookie). Nicht geprüft: echte Anmeldung,
  ob YouTube danach die Bestätigung tatsächlich nicht mehr verlangt, Controller am Fernseher.
- Ursprünglicher Auftrag: **YouTube-Bestätigung vom Sofa aus ermöglichen.** Wenn der offizielle
  Player eine Anmeldung oder Bestätigung anzeigt, die Seite in Couchdeck
  sichtbar machen und mit Controller oder Tastatur bedienbar machen.
  Prüfen, ob Couchdeck eine regulär bestätigte Sitzung wiederverwenden
  und danach automatisch zur Wiedergabe zurückkehren kann. Falls YouTube
  erneut eine persönliche Bestätigung fordert, diese anzeigen. Der
  veröffentlichte QR-Code bleibt als Ausweichweg. In der VM gezielt den
  Übergang von Meldung zu Bestätigung und Wiedergabe prüfen.

### Phase 5 · Abnahmen und Wartung

- **Privater StackPilot-Tailnet-Zugriff umgesetzt.** Unter Externer Zugriff
  stehen Diagnose, Adresse und eine Regelvorlage für eigene Verwaltungsgeräte
  bereit. Zugriff samt Anmeldung vom zweiten Gerät zur Test-VM geprüft.
  Fehlende Regeln müssen einmalig im Tailscale-Konto ergänzt werden; keine
  öffentliche Funnel-Freigabe der Verwaltung.

- **Geschütztes Jellyfin: echter Versionssprung abgenommen (19.11., Test-VM).** Da 12.4
  die neueste Version ist, wurde Jellyfin in sp-test auf das offizielle 12.3.0 gesetzt
  (nur dort für den Test freigegeben, Startprobe auf einer Datenkopie vorab) und dann über
  StackPilots reguläre Container-Wartung auf 12.4.0 aktualisiert (23 s), per Rückweg
  zurück auf 12.3.0 (16 s, gesicherte Konfiguration) und wieder auf 12.4.0. Nach jedem
  Schritt vollständige Zuschauer-Anmeldung über Authentik mit MFA
  (`scripts/testvm/oidc-login.mjs`): Konto kein Admin, Passwortanbieter gesperrt,
  Bibliotheken über das Schutz-Gateway. VM danach im Ausgangszustand (12.4, Streamyfin
  aktiv, kein Funnel, VM-Freigabe für 12.3 entfernt). Beim nächsten echten Jellyfin-Release
  bleibt nur, Image und SSO-Plugin-Kompatibilität in den Katalog aufzunehmen.
- **Streamyfin öffentlich über HTTPS prüfen.** Auf ein offizielles
  Seerr-Image mit den Sicherheitskorrekturen warten und die öffentlichen
  Routen separat abnehmen. Die private Integration ist bereits bestätigt.
  Funnel auf reatest bleibt bis zur ausdrücklichen Freigabe aus.
- **Sicherheitsprüfungen fortführen.** Nach Änderungen an Gateway,
  Tailscale, Sitzungen, Containerrechten oder Images gezielt nachprüfen.
  Signierte StackPilot-Updates bleiben ein späteres Vorhaben.
  Prüfung am 19.11. (YouTube-Wege, VPN-Weiterleitung, wireproxy, VPN-Profile,
  Updates ohne Passwort): Proxy-Schlüssel stand auf der yt-dlp-Kommandozeile (per `ps`
  lesbar) → jetzt 0600-Datei; Schlüsselvergleich bei Sonderzeichen gehärtet;
  Profilkennung beim Wechsel geprüft. Nachweis: 4416/4417/wireproxy nur 127.0.0.1, aus
  allen Docker-Netzen und über LAN/Tailnet geschlossen, kein Funnel.
- **Streamyfin öffentlich: in der Test-VM abgenommen (19.11.).** Die drei Seerr-Hinweise
  (Bildproxy, Passwortwechsel, Benutzerrechte) nennen 3.5.2 als behoben; der Katalog-Digest
  ist das offizielle v3.5.2. StackPilot erlaubt Funnel jetzt auch mit aktivem
  Streamyfin-Gateway – nur wenn Seerr die Korrekturen hat und mit eigener Bestätigung;
  Schreibzugriffe auf den Seerr-Teil sind global begrenzt (30/min, Puffer 20).
  Abnahme: Funnel in sp-test nur für Port 443 kurz geöffnet, von außen über das Internet
  geprüft (`scripts/testvm/streamyfin-public-check.sh`: erlaubte Teilmenge, 404/403/400 für
  Seerr-Oberfläche, Verwaltung, Passwort-Anmeldungen, Bildproxy, Passwort-/Rechteänderung,
  API-Schlüssel, Pfadtricks, Jellyfin-Passwortanmeldung; 429 bei vielen POST), danach
  geschlossen und Tailscale-Zustand wie vorher nachgewiesen. Für reatest gelten weiter
  alle Funnel-Voraussetzungen (Administrator-MFA, getestete Authentik-Sicherung,
  persönliche Tests) und deine ausdrückliche Freigabe.

### Phase 7 · Apps zentral über StackPilot verwalten (nach Phase 5)

Ziel: Die Funktionen der einzelnen Apps (Jellyfin, Seerr, Sonarr, Radarr, Lidarr,
Prowlarr, Bazarr, qBittorrent, Authentik, Couchdeck) über StackPilot steuern – entweder
als eigene StackPilot-Funktion oder indem StackPilot die Verwaltungsfunktionen der App
bedient –, sodass die Apps im Alltag nicht mehr einzeln geöffnet werden müssen.
Die übrige Roadmap bleibt gültig; NAS, YouTube und frühere Abnahmen werden dadurch nicht
erledigt oder ersetzt.

**7.0 Zuerst: Funktionsumfang und Struktur überdenken.** Mit Max abgestimmt:
[phase-7-konzept.md](phase-7-konzept.md). Bevor Funktionen dazukommen:
welche Funktionen StackPilot übernimmt, welche in den Apps bleiben, wie sie organisiert
sind (Nutzersicht statt App-Sicht) und wie Verwaltung, Navigation, Server-Module und
Schnittstellen in StackPilot dafür strukturiert werden. Ergebnis: ein abgestimmtes
Konzept mit Zielstruktur, Reihenfolge und Abgrenzung, erst danach Umsetzung.

**7.1 Benutzer, Rechte und Anfragen** – Seerr, Jellyfin und Authentik für die normale
Benutzerverwaltung nicht mehr separat öffnen.
- Gemeinsame Benutzerverwaltung in StackPilot.
- Film- und Serienanfragen pro Nutzer erlauben oder sperren; Genehmigungspflicht
  getrennt für Filme und Serien.
- Wartende Anfragen einzeln oder gesammelt freigeben bzw. mit Begründung ablehnen.
- Anfragelimits je Benutzer (Zeitraum, offene Anfragen, ggf. Größenlimits).
- Bibliothekszugriff und Altersfreigaben; Fernzugriff, Medienlöschung und Herunterladen
  vorhandener Dateien separat erlauben.
- Konto sperren, Passwort- und MFA-Wiederherstellung starten; angemeldete Geräte anzeigen
  und einzeln abmelden.
- Tatsächliche Rechte aus den Diensten auslesen und erfolgreiche Änderungen bestätigen.
- Grundlage vorhanden: Zuschauerprofile, Anmeldeverwaltung, Freigabe-Schalter je Zuschauer.

**7.2 Suche, Downloads und Serienverwaltung** – Sonarr, Radarr, Seerr und qBittorrent
im normalen Downloadablauf ersetzen.
- Manuelle Suchergebnisse mit Größe, Qualität, Sprache, Quelle und Ablehnungsgrund;
  konkreten Treffer auswählen; fehlerhafte Treffer blockieren und Ersatz suchen.
- Importprobleme anzeigen, Dateien Film/Folge zuordnen, Import wiederholen.
- Serie/Staffel/Folge überwachen bzw. Überwachung beenden; zukünftige Folgen automatisch.
- Downloads pausieren, fortsetzen, priorisieren; Geschwindigkeitsgrenzen und Zeitpläne;
  Seeding-Ziele und Verhalten danach.
- „Warum passiert nichts?“: Freigabe, fehlender Treffer, Größenlimit,
  Veröffentlichungstermin, VPN, Import oder Speicher verständlich als Ursache.
- Grundlage vorhanden: Downloadverwaltung, Einzelfolgenaktionen, Serienlimits,
  Qualitätswechsel.

**7.3 Profile, Suchquellen und Untertitel** – Einstellungen aus ARR-Apps und Bazarr
zentral.
- Qualitäts- und Größenprofile gemeinsam bearbeiten; Auflösung, Sprache, Originalton,
  Remux, bevorzugte Veröffentlichungen; harte Grenzen von Präferenzen unterscheiden.
- Suchquellen hinzufügen, testen, aktivieren/deaktivieren, Zugangsdaten erneuern,
  Fehler anzeigen.
- Untertitelsprachen; fehlende Untertitel suchen, Treffer wählen, fehlerhafte ersetzen.
- Grundlage vorhanden: Größenprofile, automatische Film-/Serienlimits.

**7.4 Medienbibliothek, Wiedergabe und Speicher** – Jellyfin-Verwaltung und
Speicherpflege zusammenführen (Verbindung zu Phase 3 / NAS).
- Bibliotheken anlegen, Ordner zuordnen, Scans starten; falsch erkannte Titel
  korrigieren; Poster und Beschreibungen bearbeiten.
- Aktive Wiedergaben anzeigen und beenden; Direktwiedergabe/Transcoding samt Ursache;
  Bitratenbegrenzung für Fernzugriff.
- Speicherziel pro Bibliothek wählen und Medien verschieben.
- Aufbewahrungsregeln mit geschützten Titeln und Löschvorschau; Papierkorb mit
  Wiederherstellung und optional sofortiger endgültiger Löschung.
- Alte Ersatzversionen, verwaiste Downloads, mögliche Duplikate zur Bereinigung;
  tatsächlich freigebbarer Speicher unter Berücksichtigung von Hardlinks.
- Grundlage vorhanden: Speicheranzeigen, Löschvorschau, gesicherter Medienersatz.

**7.5 Wartung, Sicherungen und Diagnose** – ohne mehrere Apps oder Terminal.
- Dienstübergreifende Verbindungen prüfen statt nur „Container läuft“.
- Wartungsaktionen zentral: Suchlauf, Scan, Untertitelsuche, Dienstneustart.
- Verständliche Fehlerprotokolle; unterstützte Dienstkonfigurationen, Pfade und
  Verbindungen zentral bearbeiten.
- Vollständige Sicherung (StackPilot-Zustand, Dienstkonfigurationen, Datenbanken),
  Wiederherstellungsassistent für einen neuen Rechner, regelmäßige isolierte Prüfung
  der Wiederherstellbarkeit.
- Update-Wartungsfenster ohne Unterbrechung laufender Wiedergaben oder kritischer Imports.
- Änderungsverlauf für Rechte, Profile, Freigaben, Löschungen und Updates.
- Benachrichtigungen (fertige Medien, Fehler, Speicher, fehlgeschlagene Sicherungen).
- Diagnosebericht exportieren, vorher Geheimnisse und persönliche Angaben entfernen.
- Grundlage vorhanden: Tresor-Sicherung, Container-Updates mit Rückweg, Dienstprüfungen.

**7.6 Couchdeck: Bedienung und Diagnose vom Sofa** (Verbindung zu Phase 4)
- Aktuelles Audioziel anzeigen und wechseln; Ton testen.
- Verbindungen zu Jellyfin und Seerr prüfen; Oberfläche neu starten; Diagnose ohne
  Terminal.

**7.7 Alle Anwendungen als Container** – auch StackPilot und Couchdeck; Dienste,
Einstellungen und Funktionen bleiben erhalten. Ausgangspunkt: 10 von 12
Hauptanwendungen laufen schon als Container, StackPilot und Couchdeck fehlen,
Tailscale läuft auf dem Host.
- StackPilot: eigenes Image; bestehende Container und Compose-Projekte übernehmen;
  Netztrennung und Dienstverbindungen erhalten; Tresor und Einstellungen dauerhaft
  außerhalb des Containers; Host-/Containerpfade und Dateirechte sicher zuordnen; lokale
  Dienstadressen anpassen; begrenzter Verwaltungshelfer für Docker-Aktionen; Update und
  Rollback unabhängig vom laufenden StackPilot-Prozess; Host-Aktionen und
  Systemdiagnosen neu anbinden.
- Tailscale: Anbindung erhalten oder in eigenen Container; private Erreichbarkeit und
  HTTPS erhalten.
- Couchdeck: containerisieren; Bildschirm, GPU, Controller, Audio und Geräteschnittstellen
  anbinden; Start, Schließen und Autostart nach Neustart erhalten.
- Abnahme: Übernahme einer bestehenden Installation, Neuinstallation, Updates und
  Rollback, Sicherung und Wiederherstellung, Funktionsgleichheit inkl. VPN, Anmeldung,
  Medienzugriff und Couchdeck.

**Reihenfolge:** 7.0 Konzept → Containerarchitektur festlegen (bevor weitere
hostabhängige Funktionen entstehen) → 7.1 Rechte und Anfragefreigaben → 7.2 Suche,
Downloadsteuerung, Importfehler → 7.3 Profile, Suchquellen, Untertitel → 7.4/7.5
Bibliothek, Speicherpflege, vollständige Wiederherstellung → 7.6/7.7 Couchdeck-Container
und Sofa-Diagnose.

## Umgesetzt oder entschieden

- Streamyfin funktioniert mit Seerr 3.5.2 über das private HTTPS-Gateway
  im Tailnet. Quick Connect verwendet das Jellyfin-Konto. Das Gateway
  blockiert API-Schlüssel, Bildproxy, Passwort- und Rechteänderungen.
  Aktivierung und Rollback sind in der Test-VM geprüft.

- Schlüsselwechsel für Bazarr, Lidarr, Sonarr, Radarr, Prowlarr und
  Seerr. Unterstützte verwaltete Verbraucher übernehmen den neuen
  Schlüssel. Die Jellyfin-Dienstzugänge für Couchdeck, Seerr und
  Streamystats können einzeln erneuert werden.

- Phase 1: Couchdeck zeigt die Gesamtzahl regulärer Staffeln, kommende
  Folgen mit verfügbarem Ausstrahlungsdatum und den freien Medienplatz
  oben rechts im Kino. Die Anzeige im Servermenü bleibt verfügbar.
- Phase 2: Couchdeck bündelt eigene Serienanfragen und Staffeln aus
  offenen Anfragen in einem bestätigten Auswahl-Dialog. Teilfehler
  erscheinen einzeln. StackPilot zeigt die aktive Größenrate, die
  absolute Grenze und den Vergleich mit der vorhandenen Filmdatei.

- Sonarr auf dem Produktivserver mit dem bestehenden Schlüssel repariert.
  Import und Seerr-Verbindung geprüft.
- Wahlweise feste Filmgrößengrenze oder GiB/h-Standard in StackPilot. Fester
  Filmstandard in Couchdeck. Automatische Serienlimits in Sonarr und
  Filmobergrenzen für bereits erfasste Radarr-Filme mit Rückweg zum
  ursprünglichen Profil in der VM geprüft.
- Aufklappbare Staffeln, gezielte Einzelfolgensuche und Löschen eindeutig
  zugeordneter Folgendateien umgesetzt. Eigene offene Mehrstaffelanfragen
  lassen sich um eine Staffel kürzen. Bei genehmigten Staffeln gibt es
  getrennte Aktionen für Überwachung und laufende Pakettransfers.
- Qualitätswechsel nach Anfragestart bleibt in StackPilot. Eindeutig
  zugeordnete, noch unvollständige Filmtransfers sowie pausierte
  Staffelpakete können mit geprüftem Ersatz und ohne Löschen der
  bisherigen Download-Dateien ausgetauscht werden.
- StackPilot unterscheidet im Downloadstatus aktiven Upload, wartende
  Uploads und bereitstehende vollständige Torrents. Die Anzeige wurde gegen
  qBittorrents Zustand und Uploadrate geprüft.
- Beide Oberflächen zeigen belegten und gesamten Platz am Medienpfad.
  Couchdeck zeigt den freien Platz auch im Kino. StackPilot verwendet
  unterschiedliche Symbole für „Anwendungen“ und „Stack konfigurieren“.
- Verwaltetes Couchdeck unterstützt ab 0.2.3 persönliche Seerr-Sitzungen
  ohne Admin-Schlüssel in der Übergabedatei nach erneuter Verknüpfung.
  Der Ablauf wurde in der VM mit dem Wohnzimmer-Konto geprüft.
- Verschlüsselte Tresor-Sicherung, isolierte Wiederherstellung und Übernahme
  per Serverbefehl mit Rückweg sind veröffentlicht. Container-Rollback für
  Sonarr, Radarr, Lidarr, Prowlarr, Bazarr und Seerr ist umgesetzt. Der
  Rückweg für geschütztes Jellyfin ist separat geprüft.
- Einmalige MFA, Wiederherstellungscodes, Passkeys, eigene Passwortwahl und
  Zuschauerprofile umgesetzt und in der Test-VM geprüft. Persönliche
  Abnahme auf Fernseher und iPad bleibt eine spätere Aufgabe.
- Vereinbart sind YouTube-Tests mit Testdaten, wenn keine echte Wiedergabe
  nötig ist. Echte Wiedergabe nur gezielt bei Änderungen daran. Für das
  private Tailnet ist keine zusätzliche Firewall geplant. Reguläre
  Authentik-Zustimmungen laufen nicht ab.

## Testumfang

- Zuerst in der Test-VM prüfen. Bei Änderungen an Installations-, Update-
  oder Migrationspfaden eine Neuinstallation und ein Update mit vorhandenem
  Zustand prüfen.
- YouTube-Video nur bei Änderungen an Anbindung, Wiedergabe oder Spulen und
  zur gezielten Diagnose abrufen. Bei einer Bot-Meldung den Befund
  dokumentieren. Beim gezielten Bestätigungstest den regulären
  YouTube-Dialog verwenden.

## Phase 6 · Für später geplant

### Abnahme auf Fernseher und iPad

Zuschaueranmeldung, Wiedergabe und Profilwechsel bei bestehenden Sitzungen
prüfen. Am Fernseher auch eine echte Medienanfrage in Couchdeck prüfen.

### Zugang ohne Tailscale (eigene Domain)

Heute setzt der Zugriff von unterwegs eine `*.ts.net`-Adresse voraus (Tailscale Serve
bzw. Funnel). Vorgesehen: „Eigene Adresse“ – jemand stellt HTTPS und Erreichbarkeit
selbst bereit (eigener Reverse-Proxy, eigene Domain, Zertifikat). StackPilot richtet dann
Gateway, Authentik und SSO auf diese Adresse ein und prüft, dass nur Jellyfin und die
Anmeldung durchgereicht werden. Nötig: Hostname-Prüfung (`validateIdentityInput`)
öffnen, Weiterleitungsadresse und Proxy-Vertrauen konfigurierbar machen, Anleitung für
gängige Proxys (Caddy, nginx, Cloudflare Tunnel).

### HexOS / TrueNAS SCALE

Ziel: StackPilot auf HexOS installieren, auch wenn dort schon ein Jellyfin läuft, und die
Medien nach dem HexOS-Schema ablegen. Dafür fehlt:

1. **Ein Weg ohne Host-Installation**: TrueNAS ist ein Appliance-System; Pakete, eigene
   Systemdienste und Root-Hilfe passen dort nicht. StackPilot muss als Container bzw.
   eigene App mit Docker-Zugriff laufen, der Zustand auf einem Dataset.
2. **„Vorhandenes Jellyfin verbinden“** statt neu installieren: Adresse und Admin-Zugang
   angeben; StackPilot richtet Seerr, ARR-Dienste und optional den Schutz darum ein, ohne
   Jellyfin neu aufzusetzen.
3. **Frei wählbare Medienpfade** nach dem vorhandenen Schema (HexOS-Ordner). Für
   Hardlinks müssen Downloads und Medien im selben Dataset liegen.
4. Prüfen, wie sich ein eigenes Compose-Projekt mit der TrueNAS-App-Verwaltung verträgt.
5. Couchdeck bleibt auf TrueNAS außen vor (braucht Konsole und Systempakete) oder läuft
   auf einem anderen Gerät.

### Weitere Ideen

- **Updates ohne Passworteingabe – umgesetzt am 19.11.** StackPilot-Update und
  Container-Updates (einzeln, Rückkehr, alle) bestätigen mit „OK“/„Abbrechen“ samt
  Zielversion; Schutz: angemeldete Sitzung, CSRF-Token, ausdrückliches „OK“.
  Fernzugriff, Funnel, Tresor und Zugangsdaten verlangen weiter das Passwort.
- Gästeprofile mit Ablaufdatum für ausdrücklich befristete Zugänge.
- Speicherwarnung früher und deutlicher (Systemplatte und Medienplatte getrennt).
- Hardwarebeschleunigung in Jellyfin nach Geräteprüfung.
- Ältere Ideen und Konzepte der Version 0.4: siehe die übrigen Dateien in diesem Ordner.
