# Pläne für die Zukunft

Stand: StackPilot 0.5.0. Ein Eintrag hier ist ein Vorhaben, keine Zusage und keine
Freigabe für Änderungen an einem laufenden Server.

## Übersicht (Stand 15.11.2026)

| # | Vorhaben | Art | Aufwand |
| --- | --- | --- | --- |
| 1 | Seerr-Anfragen in Streamyfin über eine Anfrage-Brücke (ohne Admin-Schlüssel) | Funktion + Sicherheit | groß |
| 2 | Couchdeck auf dieselbe Brücke umstellen (kein Seerr-Admin-Schlüssel mehr auf dem Gerät) | Sicherheit | mittel |
| 3 | Container-Updates: neue Versionen anzeigen, vorher sichern, austauschen, prüfen | Sicherheit | groß |
| 4 | Tresor-Sicherung als Knopf (verschlüsselt, mit Erinnerung) und geprüfte Wiederherstellung | Betrieb | mittel |
| 5 | Anmeldesperre der StackPilot-Oberfläche pro Gerät statt global | Sicherheit | klein |
| 6 | Dienst-Schlüssel erneuern (z. B. Bazarr) direkt aus StackPilot | Sicherheit | klein |
| 8 | Doppelte Code-Abfrage bei der ersten Zuschauer-Anmeldung beseitigen | Bedienung | klein |
| 9 | Zugang ohne Tailscale (eigene Domain, eigener Reverse-Proxy) | Funktion | groß |
| 10 | HexOS / TrueNAS SCALE, vorhandenes Jellyfin einbinden, eigenes Ordnerschema | Plattform | sehr groß |
| 11 | Wiederherstellungscodes für Zuschauer bei der ersten Anmeldung; Passkeys; Passwort selbst wählen | Bedienung | mittel |
| 12 | Profile für Zuschauer (Kinder, Gast mit Ablauf), Bibliotheken je Profil | Funktion | mittel |
| 13 | Speicherwarnung für Systemplatte und Medienplatte getrennt und früher | Betrieb | klein |
| 14 | Hardwarebeschleunigung in Jellyfin nach Geräteprüfung | Funktion | mittel |

Bewusst **nicht** geplant (Entscheidung): Firewall fürs Tailnet (nur eigene Geräte),
ablaufende Authentik-Zustimmung.

## Als Nächstes

### Seerr-Anfragen in Streamyfin (und Couchdeck) ohne Admin-Schlüssel

Streamyfin meldet Nutzer mit Jellyfin-Benutzername und -Passwort bei Seerr an. Zuschauer
haben aber absichtlich kein Jellyfin-Passwort (Anmeldung über Authentik), und Seerr ist
von außen nicht erreichbar. Plan: eine Anfrage-Brücke unter der Jellyfin-Adresse
(`/seerr`), die nur Nutzer mit gültiger Jellyfin-Sitzung durchlässt und Seerr
serverseitig im Namen genau dieses Nutzers anspricht. Der Seerr-Schlüssel verlässt den
Server nie. Erst im Streamyfin-Quellcode prüfen, wie die App sich bei Seerr anmeldet.

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

- Wiederherstellungscodes für Zuschauer direkt bei der ersten Anmeldung anzeigen
  (derzeit hilft „Neu einladen“).
- Passkeys als zweiter Faktor bei der Einladung.
- Zuschauer selbst ein Passwort wählen lassen (Registrierungsablauf in Authentik).
- Profile für Zuschauer (Kinder, Gast mit Ablaufdatum), eigene Bibliotheken je Profil.
- Speicherwarnung früher und deutlicher (Systemplatte und Medienplatte getrennt).
- Hardwarebeschleunigung in Jellyfin nach Geräteprüfung.
- Ältere Ideen und Konzepte der Version 0.4: siehe die übrigen Dateien in diesem Ordner.
