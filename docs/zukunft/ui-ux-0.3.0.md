# UI/UX-Überarbeitung 0.3.0

## Befund und Ziel

Die React-Ansichten sind fachlich getrennt, verwenden aber überwiegend lange
Kacheln, mehrfach dargestellte Zustände und globale CSS-Überschreibungen.
Die Übersicht verbindet Operations, ActivityOverview und ManagedServices ohne
gemeinsame Informationshierarchie. Medien und Downloads brauchen begrenzte
Listen; Verwaltung braucht eigenständige, wieder aufrufbare Unterseiten.

Ziel ist eine kompakte Alltagsoberfläche mit warmer violetter Markenfarbe,
einheitlichen neutralen Flächen, klaren Zuständen und Details auf Abruf.

## Umsetzung in Schritten

1. **Grundlagen:** gemeinsame Theme-Tokens für Farbe, Abstand, Typografie,
   Oberflächen, Fokus und Status; wiederverwendbare Überschriften, Statusanzeigen,
   Leerzustände, Seitensteuerung und zugängliche Detail-Panels.
2. **Alltag:** Dashboard aus echten App-/Speicher-/VPN-/Aktivitätsdaten zusammenführen;
   doppelte Zusammenfassungen entfernen, Hinweise und Geräte kompakt darstellen.
   Anwendungen als durchsuchbare Liste; Technik und Zugänge nach Interaktion.
3. **Downloads:** Suche, Zustandsfilter und begrenzte Listenseiten; passende Aktionen
   je gemeldetem Zustand, Abschluss ohne redundanten Fortschrittsbalken.
4. **Medien:** kompaktere Poster-Kacheln, begrenzte erste Ergebnisse und vorhandene
   Detail-/Anfragefunktion erhalten. Anfragen mit eindeutigen Status und direkten
   Übergängen zu Downloads und der tatsächlich konfigurierten Jellyfin-Adresse.
5. **Verwaltung und Navigation:** eigene Hash-Unterseiten mit Browser-Zurück/Weiter,
   Einstiegsseite ausschließlich als Bereichsauswahl; schrittweisen externen
   Zugriff und sämtliche bestehenden Konfigurationsansichten erhalten.
6. **Abnahme und Version:** pro Bereich TypeScript-/Bedienprüfung, abschließend
   Fachtests, Build, Produktions-HTTP und Browserregressionen bei Desktop, Tablet
   und Mobile in beiden Themes. Changelog, Paketversion und Git-Tag 0.3.0.

## Geschützter Umfang

- Keine neuen Backend-Endpunkte, Konto-/VPN-/Downloadregeln oder Statuserfindungen.
- Vorhandene Installation, Reparatur, Diagnose, Konten, Medienprofile, Löschen,
  Abbrechen, Archive und geschützte Zugangsanzeige bleiben erreichbar.
- Destruktive Aktionen bleiben deutlich benannt und bestätigt. Navigation löst
  keine mutierenden Aufrufe aus; Geheimnisse werden nicht in URLs gespeichert.
- Unbekannte oder nicht erreichbare Werte erscheinen als solche, nicht als null.
- Öffentliche Freigaben, persönliche MFA-/Geräteabnahme und funktionelle
  Zukunftspläne gehören nicht zu dieser UI-Version.

## Prüfnachweise

- Die sechs Umsetzungsschritte sind abgeschlossen. Nach den Komponentenänderungen
  wurden TypeScript und Erreichbarkeit der bisherigen Bedienwege geprüft.
- `npm test`: 211 Fachtests erfolgreich. `npm run build`: TypeScript und
  Produktionsbuild erfolgreich. Die Produktions-HTTP-Integration mit Anmeldung,
  geschützten APIs und unveränderten Sicherheitsgrenzen ist ebenfalls bestanden.
- `npm run test:ui` gegen den gebauten Stand: Dashboard, Apps, Downloads,
  Discover, Anfragen, Archiv und alle zehn Verwaltungsbereiche. Getestet sind
  Browser-Zurück/Weiter, direkte Unterseiten, Film-/Serienanfrage, Profile,
  Abbruch-/Löschbestätigung, geschützte Zugangsanzeige, veraltete Antworten,
  Tastatur-/Dialogfokus und kein selbsttätiges Wiederöffnen alter Anfrage-Panels.
- Beide Themes bei 1440, 1024, 768 und 390 px: keine horizontale Seitenüberbreite;
  feste Navigation/Kontoleiste, gespeicherte Theme-Auswahl sowie Lade-, Fehler-
  und Leerzustände geprüft. Die erzeugten Screenshots bleiben außerhalb von Git.
- Der reproduzierbare Browsertest liegt unter `apps/web/testing/`; er verwendet
  ausschließlich simulierte API-Antworten und bereits installierte Testwerkzeuge.
  Er bestätigt keine persönliche MFA, Wiedergabe oder reale Tailnet-Regel.
- Backenddateien und Domainlogik wurden für diese Version nicht verändert.
  Paket und Lockfile verwenden 0.3.0; der lokale Git-Tag lautet `v0.3.0`.
  Eine Veröffentlichung erfolgt gesondert auf ausdrückliche Anweisung.
