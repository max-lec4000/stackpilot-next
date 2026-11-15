# Jellyfin-Erlebnis und größere Medienbestände

Vom Nutzer am 10. November 2026 ergänzt. To-do-Liste; keine automatische
Plugin-Installation oder Umgestaltung vorhandener Jellyfin-Instanzen.

## Medien direkt in Jellyfin anfragen

- Filme, Serien und später Musik aus der Jellyfin-Oberfläche anfragen können.
- Vorhandenen StackPilot-/Seerr-Anfrageweg verwenden, einschließlich Qualität,
  Größenstandard, Berechtigung, Fortschritt und VPN-Schutz.
- Die Identität des anfragenden Zuschauers übernehmen; technische
  Administratorzugänge oder Dienstschlüssel nicht an Clients ausliefern.
- Web-, TV- und Mobil-Clients getrennt prüfen. Eine Web-Erweiterung bedeutet
  keine Unterstützung durch jede native Jellyfin-App.

## Attraktiveres Jellyfin

- Gemeinsames Gestaltungskonzept für Login, Hintergrund, Startseite und Musik.
- Unterstützte Themes und Plugins nach Versionskompatibilität, Pflegezustand,
  Integrität und Verträglichkeit mit SSO/MFA prüfen.
- Einen Bereich mit persönlichen Empfehlungen vorsehen.
- Nur zwei bis drei interessante persönliche Kennzahlen anzeigen,
  beispielsweise Wiedergabezeit, neu entdeckte Musik und häufig gehörte Interpreten.
- Kennzahlen aus tatsächlichen Daten ableiten, privat halten und klar erklären.
- Bei Musik insbesondere Künstler-/Albumansichten, Cover, Wiedergabelisten,
  Empfehlungen und Navigation großer Sammlungen verbessern.
- Erweiterungen zunächst isoliert prüfen und eine gezielte Rücknahme ermöglichen.

## Mehrfachauswahl und Sammelaktionen

- Filme, Serien, Alben und Titel gemeinsam auswählen, filtern und bearbeiten.
- Auswahl pro Seite sowie ausdrücklich alle gefilterten Treffer unterscheiden.
- Vor allem für Musik Stapelaktionen für Tags, Cover, Wiedergabelisten und
  Vorschauen vorsehen; individuelle Ausnahmen weiter bearbeiten können.
- Zunächst Gesamtvorschau mit Anzahl, Umfang und Konflikten. Destruktive Aktionen
  getrennt bestätigen, Ergebnis je Objekt anzeigen und Teilfehler fortsetzen können.
- Tastatur-/Bereichsauswahl, erhaltene Auswahl bei Seitenwechseln und Abwahl bieten.
- Lange Aufträge im Hintergrund fortsetzen und Fortschritt kompakt anzeigen.

## Später: Installationsassistent ohne dauerhafte Webapp

Bereits im ersten Wizard auswählen lassen:

1. Jellyfin und weitere Dienste installieren und zusätzlich die dauerhafte
   StackPilot-Webapp verwenden.
2. StackPilot ausschließlich als Installationsassistent verwenden.

Vor der Umsetzung Abhängigkeiten sauber trennen: Download-Ausfallsperre,
Zertifikatserneuerung, Reparaturaufträge, Updates und Integrationen dürfen nicht
versehentlich wegfallen, wenn die Verwaltungsoberfläche beendet wird. Erforderliche
Hintergrunddienste separat darstellen. Keine Abmeldung oder Deinstallation von
StackPilot darf bestehende Mediencontainer oder Daten ungefragt entfernen.

Die Entscheidung für einen konkreten Plugin-Satz und dessen Installation erfolgt
nach Kompatibilitätsprüfung; dieser Plan gibt keine pauschale Installationsfreigabe.
