# Pläne für die Zukunft

Stand: StackPilot 0.5.0. Ein Eintrag hier ist ein Vorhaben, keine Zusage und keine
Freigabe für Änderungen an einem laufenden Server.

## Reihenfolge der Arbeiten

### Aktuelle Prioritäten nach der Rückmeldung vom 16.11.2026

1. **Einzelfolgen in StackPilot und Couchdeck herunterladen.** In der VM
   für eine bereits in Sonarr vorhandene Serie geprüft, auch für eine
   Staffel außerhalb der abgeschlossenen Anfrage. Sonarrs Treffer muss
   exakt der einen Folge entsprechen. Staffelpakete werden herausgefiltert.
2. **Staffelzeilen in Couchdeck aufklappbar machen.** Die Staffelzeile selbst
   zeigt ihre eingerückten Folgen. Beim Zuklappen kehrt der Controller-Fokus
   zur Staffel zurück. In der VM im Browser geprüft.
3. **Qualitätswechsel aus Couchdeck entfernen.** Menüpunkt und zugehörige
   Couchdeck-Aufrufe entfernt. Der feste Filmgrößenstandard bleibt in
   Couchdeck und der Qualitätswechsel bleibt in StackPilot.
4. **Uploadstatus in StackPilot korrigieren.** Auf dem Produktivserver mit qBittorrent
   abgeglichen. Build und Browserprüfung der neuen Anzeige bestanden in
   der VM. Aktiver Upload, Upload-Warteschlange und Bereitstehen sind
   unterscheidbar. Einspielen auf dem Produktivserver steht aus.

### Bisheriger Stand und weitere Vorhaben

1. **Sonarr wieder erreichbar machen.** Wiederherstellung mit vorhandenem
   Schlüssel in der Test-VM erprobt und auf dem Produktivserver durchgeführt. Sonarr-API,
   Verbindung aus Seerr und Importhistorie geprüft.
2. **Downloadprofile reparieren.** StackPilot kann für neue Filmanfragen eine feste
   GiB-Grenze oder eine laufzeitabhängige Grenze speichern. Das verwaltete
   Couchdeck bietet eine eigene feste Filmgrenze. Offen sind geprüfte Regeln
   für automatische RSS-Downloads. Je Serie können getrennte Limits für
   gezielte Folgen- und Staffelpaket-Downloads gespeichert werden.
3. **Qualitätswechsel und Downloadstatus.** StackPilot kann eindeutig
   zugeordnete, unvollständige Film-Downloads mit einem neuen Profil ersetzen
   und die bisher geladenen Dateien behalten. In der VM mit Radarr,
   qBittorrent und lokalem Indexer geprüft. Serienpakete lassen sich
   gezielt pausieren und nach Bestätigung ersetzen.
4. **Staffeln und Folgen einzeln steuern.** StackPilot und das verwaltete
   Couchdeck zeigen Staffeln und Folgen an. Die Einzelfolgen-Aktion wurde
   nach der Rückmeldung für bestehende Sonarr-Serien überarbeitet. Eindeutig
   zugeordnete Folgendateien können in den vorgesehenen Fällen gelöscht werden. In Couchdeck gilt dies nur
   für eigene genehmigte Anfragen des verbundenen Wohnzimmer-Kontos.
   Einzelne Staffeln lassen sich aus eigenen noch offenen Seerr-Anfragen
   entfernen. Für genehmigte Staffeln kann StackPilot die Sonarr-Überwachung
   einzeln stoppen. Laufende Staffelpakete können bei eindeutiger Zuordnung
   pausiert und danach dateierhaltend aus qBittorrent entfernt werden. Der
   Austausch eines pausierten Staffelpakets ist in StackPilot umgesetzt.
   Der Austausch wurde in der Test-VM mit echtem Sonarr und qBittorrent und
   synthetischen Torrents geprüft. Sonarr blockiert alternative Treffer, wenn
   das vorhandene Paket bereits die Zielqualität erfüllt. Beim ausdrücklichen
   Austausch darf dies der einzige Ablehnungsgrund sein. Der neue Treffer muss
   weiterhin alle Größen- und Zuordnungsprüfungen bestehen. Größenlimits
   für Sonarr-RSS und automatische Suchen können pro Serie
   aktiviert und auf das bisherige Profil zurückgesetzt werden. In der VM
   wurden Filterung im RSS-Abruf, Import, Profilwechsel und Rückkehr geprüft.
5. **Streamyfin mit Seerr verbinden.** An den bestandenen Quick-Connect-Test mit Seerr
   3.5.2 anknüpfen. Die öffentliche Abnahme mit der korrigierten Seerr-Version
   3.5.3 oder neuer durchführen. Die benötigten Seerr-Schnittstellen unter der Jellyfin-HTTPS-Adresse
   zugänglich machen, die Aktualisierung bestehender Installationen prüfen und in der
   echten App Anmeldung, Medienanfrage und abgewiesene Admin-Zugriffe testen.
6. **Couchdeck auf persönliche Seerr-Sitzungen umstellen.** Das verwaltete
   Couchdeck kann nach Neuverknüpfung per Quick Connect als Wohnzimmer-Konto
   arbeiten. Der Schlüssel entfällt für kompatible Versionen aus der
   Übergabedatei. VM-Test bestanden. Veröffentlichung und Prüfung beim
   regulären Update auf dem Fernseher stehen noch aus.
7. **Medienspeicher und Navigation verbessern.** StackPilot und verwaltetes
   Couchdeck zeigen die Belegung am Medienpfad und am Systemlaufwerk.
   Ein gemeinsames Dateisystem erscheint einmal. Separate Warnungen sind
   bei getrennten Laufwerken verfügbar. VM-Test bestanden.
8. **Wartung absichern.** Katalog-Updates für Sonarr, Radarr, Lidarr, Prowlarr,
   Bazarr und Seerr haben Konfigurationssicherung, Funktionsprüfung und
   Rückkehr. Update und beide Rückkehrwege wurden mit echtem Seerr in der
   Test-VM geprüft. Der Tresor-Download ist in der Oberfläche verfügbar,
   die getrennte Wiederherstellungsprüfung erfolgt per Skript. Ausstehend
   sind Rollback für Dienste mit besonderer Netz- oder Datenstruktur,
   die Wiederherstellung in der Oberfläche und die Schlüsselerneuerung
   für weitere Dienste und Verbraucher.
9. **Zuschauerkonten vereinfachen.** Wiederherstellungscodes erscheinen nach
   erfolgreicher MFA. Bei bestehenden Authentik-Installationen ist die
   einmalige Aktivierung in StackPilot nötig und in der VM geprüft.
   Die Zuschauer-Anmeldung kann außerdem den bestätigten Faktor für die
   anschließende Freigabe übernehmen, Passkeys als zweiten Faktor
   einrichten und nach MFA ein eigenes Passwort setzen. StackPilot kann
   Bibliotheksprofile zuweisen und bestehende Konten um einen Passkey ergänzen.
   Profilwechsel mit aktiven Sitzungen und Passkey-Ergänzung wurden in der
   Test-VM geprüft. Die Abnahme auf Fernseher und iPad steht aus.
10. **Weitere Installationswege.** HTTPS mit eigener Domain und Reverse-Proxy ohne
    Tailscale umsetzen. Danach HexOS/TrueNAS SCALE mit vorhandenem Jellyfin und
    passendem Medienordnerschema prüfen. Zuletzt Hardwarebeschleunigung in Jellyfin
    mit passenden Testgeräten validieren.

### Testumfang

- Erst in der Test-VM. Bei Änderungen an Installations-, Update- oder Migrationspfaden
  jeweils Neuinstallation und Update mit vorhandener Konfiguration prüfen.
- Bei YouTube-unabhängigen Änderungen reicht der Test der betroffenen Couchdeck-Funktion.
  YouTube-Oberfläche und Fehlerbehandlung bei Bedarf mit Testdaten prüfen. Ein echtes
  Video nur gezielt abspielen, wenn sich die YouTube-Anbindung, Wiedergabe oder das
  Spulen geändert hat oder ein konkreter YouTube-Fehler nachgestellt werden muss.
  Bei einer Bot-Schutz-Meldung den Testlauf beenden und den Befund festhalten.

Bewusst **nicht** geplant (Entscheidung): Firewall fürs Tailnet (nur eigene Geräte),
ablaufende Authentik-Zustimmung.

## Als Nächstes

### Seerr-Anfragen in Streamyfin (und Couchdeck) ohne Admin-Schlüssel

Streamyfin 0.55.2 kann Seerr per Quick Connect mit einer bestehenden Jellyfin-Sitzung
verbinden. In der Test-VM erhielt ein per Authentik angemeldeter Zuschauer mit
Seerr 3.5.1 und 3.5.2 eine eigene Seerr-Sitzung ohne Admin-Rechte. Für den Zugriff unterwegs
sollen ausschließlich die von Streamyfin benötigten Schnittstellen unter der
Jellyfin-Adresse erreichbar sein. Die Freigabe setzt einen gepatchten Seerr-Stand
voraus und muss mit der Client-App geprüft werden. Danach soll Couchdeck ebenfalls
mit Nutzersitzungen arbeiten und seinen Seerr-Admin-Schlüssel abgeben.

### Sicherheitsprüfung des gesamten Stacks

Kompletter Durchgang: Gateway-Regeln, Container-Rechte, offene Ports im Heimnetz,
Tailscale-Policy, Authentik-Flows, Sitzungs-Cookies bei HTTP im Heimnetz, Updates der
Container-Images.

## Später

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

- Gästeprofile mit Ablaufdatum für ausdrücklich befristete Zugänge.
- Speicherwarnung früher und deutlicher (Systemplatte und Medienplatte getrennt).
- Hardwarebeschleunigung in Jellyfin nach Geräteprüfung.
- Ältere Ideen und Konzepte der Version 0.4: siehe die übrigen Dateien in diesem Ordner.
