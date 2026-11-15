# Alltag, Anfragen und Größenregeln

Stand: 08.11.2026. Umsetzung im Repository; keine automatische Veränderung des
persönlichen Servers und keine öffentliche Freigabe.

## Betriebsübersicht

Die Übersicht zeigt begrenzt die nächsten Aufgaben: Einrichtung abschließen,
Anwendungen/Verbindungen prüfen, VPN-Nachweis, Quellen und freien Speicher.
Unbekannte Messwerte sind kein erfolgreicher Nachweis. „Läuft“ bezeichnet den
Containerzustand; eine komplette Medienbeschaffung oder Wiedergabe wird damit
nicht behauptet. Technische Details bleiben unter Verwaltung.

Bei weniger als der kritischen Reserve werden neue StackPilot-Medienanfragen
verweigert. Die Schwelle beträgt mindestens 1 GiB und höchstens 5 GiB, abhängig
von der Datenträgergröße. Eine Warnung erscheint vorher. Diese Prüfung reserviert
keinen Platz für alle laufenden Downloads und löscht niemals Dateien.

## Anfragen archivieren und abbrechen

Unter **Meine Anfragen → Details**:

- **Archivieren** blendet die Anfrage aus der aktiven StackPilot-Liste aus.
  Seerr, Überwachung, Downloads und Dateien bleiben unverändert.
- Im **Archiv** lässt sich eine gewöhnlich archivierte Anfrage zurückholen.
- **Anfrage abbrechen …** prüft den aktuellen Zustand. Bei einem eigenen Film
  wird dessen Überwachung ausgeschaltet; bei Serien werden ausschließlich die
  angefragten Staffeln umgestellt. Die Seerr-Anfrage wird danach entfernt und
  ihre Entfernung anhand HTTP 404 bestätigt.
- Weitere überlappende Anfragen, laufende Suchaufträge und unbestätigte Daten
  sperren den Abbruch. Ein laufender Download wird nicht automatisch angehalten;
  dazu dient die separate Downloadansicht.
- Bereits verfügbare Filme werden archiviert oder über die separate Filmlöschung
  verwaltet. Ein Anfrageabbruch löscht keine Mediendateien oder Torrents.

Unterbrochene Antworten werden anhand gespeicherter Schritte erneut geprüft.
Unbestätigte Abbrüche bleiben im Archiv aufrufbar. Dort lässt sich gezielt
fortsetzen oder der Abbruch ausdrücklich verwerfen und nur archivieren. Dabei
werden bereits deaktivierte Überwachungen nicht automatisch wieder eingeschaltet.
Archiv und Abbruchjournal liegen privat in StackPilots Zustand. Es handelt sich
weiterhin um die zentrale Administratorliste, nicht um separate Familienkonten.

Der gemeinsame Fortschritt unterscheidet Freigabe, Suche, Download, Import und
bestätigte Verfügbarkeit. 100 Prozent Download bedeuten nicht „in Jellyfin verfügbar“.

## Größenregel für Filme

In **Medien entdecken → Details & Anfrage** lässt sich vor einer neuen
Filmanfrage eine Größenregel auswählen. Unter **Verwaltung → Medienprofile**
steht ein optionaler Standard für neue StackPilot-Filmanfragen zur Verfügung.
Für bereits angefragte Filme gibt es dieselbe Option unter **Qualität ändern**.
Eine bestätigte Auswahl für einen bestimmten Film geht dem allgemeinen Standard
vor, auch bei einer späteren Anfrage. Eine ausdrücklich neu gewählte Größenregel
kann diese Auswahl ersetzen. Geänderte Vorschauen müssen neu geöffnet werden.

Beispiel: 120 Minuten bei 3 GiB pro Stunde ergeben höchstens 6 GiB. Es wird auf
die nächste halbe GiB aufgerundet. Eine unbekannte Laufzeit verhindert eine
begrenzte Anfrage; StackPilot rät keine Laufzeit. Ohne ausdrücklich aktivierte
Größenregel bleiben die bisherigen Profilvorgaben bestehen.

Die Umsetzung legt ein eigenes natives Radarr-Custom-Format und ein eigenes
1080p-Profil ohne Remux an. Nur Releases innerhalb der Grenze erreichen dessen
erforderlichen Format-Score. Andere Format-Scores im neuen Profil sind neutral,
Upgrades ausgeschaltet. Bereits vorhandene Profile werden nicht umkonfiguriert;
Radarr ergänzt neue Custom-Formats dort selbst mit neutralem Score 0.

Der Ansatz begrenzt die vom Indexer gemeldete Releasegröße. Er konvertiert keine
Datei, beendet keine laufenden Downloads und garantiert keine fehlerfreien
Indexer-Metadaten. Er legt keine Audio-/Sprachregeln fest. Serien erhalten noch
keine analoge Dateigrößenbegrenzung. Manuell veränderte oder entfernte verwaltete
Regeln werden nicht still ersetzt. Ein Abschalten des Standards entfernt keine
bereits zugeordneten Filmprofile.

## Verlauf und Abfragelast

**Verwaltung → Änderungsverlauf** protokolliert bekannte Aktionen, Zeitpunkt,
Administrator und Ergebnis der Anforderung. Es werden keine Passwörter, Tokens
oder freien Anfrageinhalte gespeichert. Hintergrundaufträge haben ihren eigenen
Abschluss im Auftragsverlauf. Bis zu 10.000 abgeschlossene Audit-Einträge werden
aufbewahrt; laufende/unbestätigte Anforderungen werden nicht automatisch verworfen.

Aktive Abfragen werden zusammengefasst und kurz zwischengespeichert. Mutationen
und die ausdrückliche Aktualisierung invalidieren den Cache. ARR-Warteschlangen
werden über alle Seiten gelesen; Filmabfragen beziehen sich auf sichtbare IDs.
Das lokale Archiv wird in SQLite paginiert. Für ausgeblendete Seerr-Anfragen
wird die entfernte Liste vollständig gefiltert, bevor Seiten gebildet werden;
dabei gilt eine Grenze von 20.000 Anfragen pro Filter. Größere Listen werden
mit Fehler abgewiesen, niemals still als vollständig ausgegeben.

## Prüfungen

- `npm test`: Domänen-, Datei-, Wiederaufnahme-, Rechte- und Schnittstellentests.
- `npm run test:media-policies`: native Radarr-Größenregeln, neutrale fremde
  Profile und Verweigerung manueller Drift; ohne Medien/Downloads.
- `npm run test:request-lifecycle`: native Seerr-Entfernung mit isolierter
  Testdatenbank und synthetischem ARR-Adapter; kein kompletter Downloadlauf.
- `npm run test:runtime`: Produktionsserver in einem isolierten Node-Container,
  Authentifizierung, privater Betriebsstand, Audit-Redaktion und SIGTERM ohne
  aktive Aufträge. Kein Docker-Socket im Testcontainer.

Die systemd-Nutzersitzung, echter VPN-Ausfall, reale Medienimporte und persönliche
Geräte benötigen weiterhin die Abnahme auf dem Zielserver.
