# Konzept: Zuschauer einladen und Couchdeck über StackPilot

Stand: 12. November 2026, Entwurf. Ein Eintrag hier ist noch keine Freigabe für
Änderungen am persönlichen Server oder für öffentliche Zugänge.

## 1. Ausgangslage auf medienserver

Lesend geprüft am 12.11.2026; dabei wurden keine Geheimnisse ausgelesen.

| Bereich | Ist-Zustand |
| --- | --- |
| Authentik 2026.8.5 | Blueprint v2 aktiv. 2 Konten: `akadmin` (TOTP) und 1 Zuschauer in `stackpilot-viewers` (TOTP, **keine Wiederherstellungscodes**). 0 Einladungen, kein Enrollment-Flow. |
| Jellyfin 12.4 + SSO-Auth 4.0.0.4 | 2 Konten: das persönliche Admin-/Dienstkonto und `spv_…` (InvalidAuthProvider). 15 Geräte; Couchdeck ist als `spv_…` per Quick Connect angemeldet. Remote Access in Jellyfin ist aus. |
| Seerr | Beide Konten vorhanden, `spv_…` mit Recht REQUEST (32). Der Zuschauer kann sich **nicht selbst** bei Seerr anmelden, weil sein Jellyfin-Passwort gesperrt ist. |
| Tailscale 1.104.5 | Serve nur im Tailnet: 443 → Gateway 19096, 8443 → Authentik-Login 19080. Funnel ist nicht aktiv, der Server hat in der Policy kein Funnel-Recht. 3 Peers (Android, Linux). |
| StackPilot | Läuft per `npm start` in einer interaktiven Shell, nicht als systemd-Dienst. |

## 2. Heutiger Ablauf für einen neuen Zuschauer

1. Admin baut einen SSH-Tunnel inklusive Port 19000 auf und meldet sich als `akadmin` mit TOTP an.
2. Im Authentik-Adminbereich ein Konto anlegen, ein Passwort vergeben und der Gruppe `stackpilot-viewers` zuordnen.
3. **MFA einrichten:** Der öffentliche Login-Flow verweigert Konten ohne zweiten Faktor (`not_configured_action: deny`). Einrichten kann man ihn nur über den privaten Admin-Flow auf `127.0.0.1:19000`. Dafür muss der Zuschauer an den Rechner des Admins, oder der Admin richtet TOTP für ihn ein und gibt das Geheimnis weiter.
4. Wiederherstellungscodes erzeugen. Beim bestehenden Zuschauer ist das unterblieben.
5. **Netzwerkzugang:** Der Zuschauer braucht ein eigenes Tailscale-Konto und die App, muss ins Tailnet eingeladen werden (oder den Server geteilt bekommen), und der Admin trägt seine Geräte-IPs in eine ACL-Vorlage ein. Diese Vorlage überträgt er von Hand in die Tailscale-Policy.
6. Im Browser `https://medienserver.tailnet.ts.net/sso/OID/start/stackpilot` öffnen → Passwort → TOTP → Zustimmung (bei **jedem** Login, `consent: always_require`) → Jellyfin legt `spv_<name>` mit den global gewählten Bibliotheken an.
7. TV und Handy per Quick Connect: Den Code am Gerät ablesen und in der Browsersitzung unter Profil → Quick Connect eingeben.
8. Seerr: Das Konto wird von Hand importiert. Anfragen gehen nur über Couchdeck oder den Admin.

Das sind rund 15 Handgriffe auf vier Oberflächen (Authentik-Admin, Tailscale-Admin, Jellyfin, Seerr). Zwei davon brauchen physische oder SSH-Nähe zum Server.

### Grundprobleme

- **P1** Die MFA-Ersteinrichtung ist nur über den Loopback-Port 19000 möglich.
- **P2** Jeder Zuschauer braucht Tailscale. Die ACL wird von Hand nach IP gepflegt.
- **P3** Konto und Passwort entstehen beim Admin und müssen übermittelt werden.
- **P4** Alle Zuschauer bekommen dieselben Bibliotheken. Es gibt keine Profile wie Kinder oder Gast.
- **P5** Seerr-Zuordnung und Anfragerecht werden manuell gesetzt.
- **P6** Es gibt keinen Abmeldeprozess für Zuschauer. Eine entfernte Gruppenzuordnung widerruft keine Jellyfin-Gerätetokens.
- **P7** Die Zustimmungsseite erscheint bei jeder Anmeldung und stört nur.

## 3. Zielbild: „Zuschauer einladen“

### Für den Admin (StackPilot, 1 Dialog)

**Verwaltung → Zuschauer → Einladen**

- Anzeigename und Benutzername (Vorschlag aus dem Namen)
- Profil: *Erwachsene* · *Kinder* · *Gast (befristet)*
- Optional: Anfragen über Seerr erlauben, mit Kontingent
- Gültigkeit der Einladung: Standard 7 Tage, einmal verwendbar

Ergebnis: ein Einladungslink und ein QR-Code. Bestätigt wird mit dem
StackPilot-Passwort, wie bei allen anderen schreibenden Aktionen.

Die Liste unter **Zuschauer** zeigt je Person: Einladung offen/abgelaufen,
MFA eingerichtet, Wiederherstellungscodes vorhanden, Jellyfin-Konto aktiv,
Geräte (Anzahl, zuletzt aktiv), Seerr-Recht. Aktionen: *Gerät abmelden*,
*MFA zurücksetzen (neue Einladung)*, *Pausieren*, *Entfernen*.

### Für den Zuschauer (Link öffnen, etwa 2 Minuten)

1. Link öffnen → Willkommensseite „Max lädt dich zu Jellyfin ein“.
2. Passwort wählen. Der Benutzername ist aus der Einladung fest vorgegeben.
3. Zweiten Faktor einrichten: Passkey (empfohlen, ein Tippen) oder TOTP-App.
4. Wiederherstellungscodes anzeigen und bestätigen.
5. Automatische Weiterleitung zum Jellyfin-SSO-Login, der direkt durchläuft, weil die Sitzung schon besteht.
6. Fertigseite in Jellyfin mit „Fernseher oder Handy verbinden“: kurze Quick-Connect-Anleitung und App-Links.

### Technik dahinter

**Authentik: Blueprint v3** (neue Vorlage plus geprüfte Migration von v2, siehe 6.):

- Flow `stackpilot-enrollment` (designation `enrollment`) mit folgenden Stufen:
  - Invitation-Stage (`continue_flow_without_invitation: false`)
  - Prompt-Stage (Passwort, Benutzername aus `fixed_data` der Einladung)
  - user_write (Gruppe aus der Einladung)
  - Authenticator-Validate mit `not_configured_action: configure` (Passkey/TOTP)
  - Static-Setup (Wiederherstellungscodes)
  - user_login
  - Weiterleitung auf `/sso/OID/start/stackpilot`
- Gruppen je Profil: `stackpilot-viewers` bleibt die Grundgruppe, dazu `stackpilot-viewers-kids` und `stackpilot-viewers-guest`. Die Richtlinie `viewers-only` bleibt unverändert.
- Zustimmung: `always_require` → `expiring` (zum Beispiel 30 Tage). Die MFA-Stufe im Authorization-Flow bleibt.
- **MFA zurücksetzen** löscht die Geräte des Kontos und erzeugt eine neue, auf diesen Benutzer gebundene Einladung zur Neueinrichtung.

**Login-Gateway (19080):** Die bestehenden Regex-Allowlists um `stackpilot-enrollment` ergänzen (`/if/flow/…` und `/api/v3/flows/executor/…`). Die Verwaltung bleibt gesperrt.

**StackPilot-Server:**

- Einladungen erzeugt StackPilot wie bisher per `docker compose exec` und ein mitgeliefertes Python-Skript (`invite.py`, analog zu `audit.py` und `settings.py`). Es braucht keinen neuen Authentik-API-Token. Im Vault liegt nur die Einladungs-ID, nicht der Link.
- Neues Modul `viewers.js` als Hintergrundprüfung im Minutentakt, solange Einladungen offen sind. Sobald ein neues `spv_<name>` in Jellyfin auftaucht:
  - Jellyfin-Richtlinie nach Profil setzen: Bibliotheken, `MaxParentalRating` bei Kindern, Downloads, Remote-Wiedergabe-Bitrate.
  - Seerr: Konto importieren (`/api/v1/user/import-from-jellyfin`), Rechte und Kontingent setzen.
  - Ergebnis im Änderungsverlauf vermerken.
- Bibliotheken pro Profil könnte stattdessen das SSO-Plugin über `EnableFolderRoles` und eine Gruppen-zu-Ordner-Zuordnung setzen. Das ist robuster als ein nachträglicher Abgleich und vor dem Bau zu prüfen. Altersfreigabe und Seerr brauchen den Abgleich aber trotzdem.
- **Entfernen** in dieser Reihenfolge, mit Ergebnis je Schritt:
  1. Authentik-Konto deaktivieren und Sitzungen beenden
  2. Jellyfin-Geräte des Kontos abmelden (der vorhandene Gerätewiderruf)
  3. `spv_`-Konto in Jellyfin deaktivieren
  4. Seerr-Rechte entziehen

  Mediendaten und Anfragen bleiben erhalten.
- **Gast (befristet):** Ablaufdatum in StackPilot gespeichert. Bei Ablauf greift automatisch derselbe Ablauf wie beim Entfernen.

### Erreichbarkeit: die eigentliche Weichenstellung (P2)

Einladungslinks sind nur nützlich, wenn der Zuschauer `:8443` und `:443` erreicht.

| Variante | Für Zuschauer | Für den Admin | Bewertung |
| --- | --- | --- | --- |
| **A: Funnel** (Ziel von 0.4.0) | Nur Link und Browser, kein Tailscale | Einmal Funnel-Recht in der Tailnet-Policy setzen und die vorhandene Funnel-Abnahme durchlaufen | **Empfohlen.** Das Schutzkonzept (Gateway, MFA, gesperrtes Passwort, Admin-Sperre) ist genau dafür gebaut. |
| B: Tailnet-Freigabe | Tailscale-Konto und App, Gerät freigeben lassen | Server teilen oder einladen, ACL von Hand | Nur für Familie mit ohnehin vorhandenem Tailscale. Bleibt als Option. |
| C: Tailscale-API automatisiert | wie B | OAuth-Client mit Policy-Schreibrecht im Vault | **Nicht empfohlen**: Ein Schlüssel, der die ganze Tailnet-Policy ändern darf, ist ein zu großes Risiko. |

**Entscheidung (12.11.2026):** Vorerst bleibt es bei **B (Tailnet)**. Langfristiges
Ziel ist **A**, wobei ausschließlich Jellyfin öffentlich erreichbar sein soll.
StackPilot, ARR, Seerr, qBittorrent und die Authentik-Verwaltung bleiben privat.

Folge für A: Bei OIDC muss der Browser des Zuschauers die Authentik-Anmeldeseite
erreichen. Die heutige Funnel-Vorlage veröffentlicht dafür einen zweiten Port
(8443 → eingeschränktes Login-Gateway). Für „nur Jellyfin“ prüfen wir, ob das
Login stattdessen unter einem Pfad am Jellyfin-Gateway laufen kann
(`https://<host>/auth/…`, Authentik `AUTHENTIK_WEB__PATH`). Dann gäbe es nur
eine öffentliche Adresse auf 443, und 8443 bliebe tailnet-only. Das ist vor
Phase 3 isoliert zu testen.

#### Einladung im Tailnet (jetzt)

Der Einladungsdialog prüft die Erreichbarkeit live und sagt klar: „Diese Person
braucht Tailscale“. Um den Ablauf zu vereinfachen:

- **Gruppe statt IP-Liste:** Die Regelvorlage arbeitet mit einer Gruppe
  `group:jellyfin-viewers` (Tailscale-Login-E-Mails) statt mit Geräte-IPs. Die
  Grant-Regel erlaubt TCP 443/8443 zum Server und wird einmal angelegt. Pro neuem
  Zuschauer kommt nur eine E-Mail-Adresse in die Gruppe. Neue Geräte desselben
  Zuschauers funktionieren dann ohne weitere Pflege. StackPilot ändert die Policy
  weiterhin nicht selbst, sondern zeigt die fertige Zeile zum Einfügen.
- **Eine Anleitungsseite für den Zuschauer:** Der Einladungslink führt zuerst auf
  eine Seite mit drei Schritten: Tailscale installieren, Tailnet-Einladung
  annehmen, dann weiter zur Konto-Einrichtung. Diese Seite ist statisch und ohne
  Tailscale abrufbar. Sie wird über das Login-Gateway ausgeliefert, sobald Funnel
  aktiv ist, bis dahin als Text oder QR zum Weiterschicken aus StackPilot.
- **Tailnet-Einladung vs. Node-Sharing:** Tailscale bietet „Benutzer einladen“
  (Zuschauer wird Mitglied des Tailnets) und „Gerät teilen“ (nur der Server ist
  sichtbar). Sharing ist enger. Ob Grants für geteilte Nutzer greifen und wie
  Quick Connect mit TV-Apps über Sharing funktioniert, wird am echten Tailnet
  getestet, bevor die Anleitung eine Variante empfiehlt.
- **Fernseher:** Smart-TVs ohne Tailscale-App kommen im Tailnet-Modus nicht an
  Jellyfin. Das bleibt bis Funnel eine bekannte Grenze. Lokal im Heimnetz ist
  Couchdeck der Weg zum Fernseher.

## 4. Couchdeck als StackPilot-App

### Randbedingung

Couchdeck ist keine Container-App. Es braucht apt-Pakete, einen Systembenutzer,
Autologin auf tty1, setuid für `chrome-sandbox` und Zugriff auf DRM- und
Eingabegeräte. StackPilot führt bewusst **nie sudo** aus. Ein Container mit cage
als DRM-Master wäre fragil (logind-Seat, VT-Wechsel) und wird nicht verfolgt.

### Lösung: Katalogtyp „Host-App“ mit getrennter Root-Basis

1. **Katalogeintrag** `Couchdeck` mit `kind: "host"`. Er enthält:
   - festen Git-Commit/Tag des Repos `max-lec4000/couchdeck`
   - SHA-256 des Release-Archivs
   - Voraussetzungen: angeschlossener Monitor, Intel-VA-API, freies tty1

   Wie alle anderen Apps erscheint er im Auswahlassistenten unter „Jellyfin & Erweiterungen“.
2. **Plan:** StackPilot zeigt einen einzigen kopierbaren Befehl mit Pin und Prüfsumme, den der Admin einmal selbst mit sudo ausführt, zum Beispiel `sudo bash …/install.sh --stackpilot`. Der Plan sagt ehrlich: Dieser Schritt braucht Root und wird nicht von StackPilot ausgeführt.
3. **Übergabeordner**, einmalig von `install.sh --stackpilot` angelegt:
   `/var/lib/couchdeck/provision/`, Eigentümer `couchdeck`, Gruppe `couchdeck-provision` mit 2770, und `max` ist Mitglied dieser Gruppe. Danach kann StackPilot ohne Root Integrationsdaten ablegen, und nur Couchdeck liest sie.
4. **Verdrahtung durch StackPilot** (normaler, bestätigter Auftrag, wiederholbar):
   - `integration.json` (0640) mit:
     - `jellyfinUrl` aus `plan.ports.Jellyfin` (aktuell `http://127.0.0.1:8096`)
     - Seerr-URL
     - Ping-Ziele für alle verwalteten Dienste mit ihren tatsächlichen Ports
     - Stack-ID und Versionsangabe

     Damit verschwinden die fest verdrahteten Ports in `couchdeck/src/main/config.js`.
   - Couchdeck liest die Datei beim Start und bei Änderungen (inotify) und meldet seinen Zustand in `status.json` zurück: Version, angemeldet ja/nein, Wohnzimmer-Profil.
   - **Prüfung:** Getty-Autologin aktiv, cage läuft, `status.json` frisch, Jellyfin von Couchdeck aus erreichbar.
5. **Updates:** Ein neuer Pin im Katalog führt zu einem Updateplan mit dem nötigen sudo-Befehl. Die Konfiguration bleibt erhalten.

### Tokens und Berechtigungen

- **Jellyfin:** Couchdeck bleibt ein normaler Client mit Benutzersitzung und bekommt keinen API-Schlüssel. StackPilot gibt Geräte nie mit seinem Admin-Konto frei, das bleibt so.

  Empfohlen ist ein eigener Zuschauer „Wohnzimmer“ (`spv_wohnzimmer`), angelegt über den Einladungsablauf. Couchdeck zeigt beim ersten Start einen QR-Code auf `https://<host>/web/#/quickconnect?code=…`: Handy scannen, per SSO und MFA anmelden, freigeben. In StackPilot erscheint „Couchdeck verbunden als Wohnzimmer“.

  Später möglich: Profilwahl auf dem Sofa (mehrere Zuschauer, Wechsel per Quick Connect).
- **Seerr:** Heute bekommt Couchdeck den globalen Seerr-Admin-API-Key per Hand über `set-seerr-key.sh`.

  Zielbild: StackPilot bietet eine lokale **Anfrage-Brücke** für Couchdeck über einen Unix-Socket im Übergabeordner. Ein eigener Client-Token liegt in `integration.json` und erlaubt ausschließlich `trending`, `search`, `details`, `request`, `my-requests` und `cancel-own`, jeweils im Namen des per Jellyfin-Benutzer-ID zugeordneten Seerr-Kontos. Der Seerr-Admin-Key verlässt StackPilot nicht. Anfragen laufen über die vorhandene MediaHub-Logik, also auch mit VPN-Nachweis und Größenwahl.

  Übergangsweise (Phase 1) legt StackPilot den vorhandenen Key in `integration.json` ab. Das ersetzt das manuelle Skript, bleibt aber sichtbar als „weitreichender Schlüssel“ markiert.
- **Port:** Couchdeck spricht Jellyfin direkt auf `127.0.0.1:8096` an. Das Gateway auf 19096 ist für Fernzugriff gedacht. Lokal ist der direkte Port richtig und schneller, und der Zuschauer-Token bleibt trotzdem auf das `spv_`-Konto beschränkt.

## 5. Umsetzungsreihenfolge

| Phase | Inhalt | Braucht vom Nutzer |
| --- | --- | --- |
| 0 | StackPilot als systemd-Nutzerdienst (`npm run service:install`). Sonst laufen Wächter und Hintergrundprüfungen nur, solange die Shell offen ist. | OK für den Eingriff auf medienserver |
| 1 | Blueprint v3 + Gateway-Allowlist + `invite.py` + Zuschauerliste mit Einladen/Entfernen; Tailnet-Anleitung und Gruppen-Regelvorlage | Migration v2 → v3 bestätigen; Gruppe einmal in die Tailnet-Policy einfügen; einen Testzuschauer einladen |
| 2 | Profile (Gruppen, Bibliotheken, Altersfreigabe), Seerr-Abgleich, Gast-Ablauf | Profilinhalte festlegen |
| 3 (später) | Nur Jellyfin über Funnel: Login unter Pfad am Jellyfin-Gateway prüfen, dann vorhandene Funnel-Abnahme. Einladungen funktionieren danach ohne Tailscale. | Funnel-Recht in der Tailnet-Policy, Test über Mobilfunk |
| 4 | Couchdeck: `install.sh --stackpilot`, Übergabeordner, `integration.json`, Katalogeintrag Host-App | einmal sudo |
| 5 | Couchdeck: Anfrage-Brücke statt Seerr-Admin-Key, QR-Quick-Connect, Profilwahl | — |

## 6. Risiken und offene Fragen

- **Migration v2 → v3:** Die vorhandenen Konfigurationsdateien sind über Prüfsummen geschützt und werden nicht still überschrieben. v3 braucht deshalb einen eigenen, vorab angezeigten Migrationsschritt mit Authentik-Sicherung davor (vorhandene Funktion).
- **Einladungslink = Zugang:** Einmal verwendbar, kurz gültig, fester Benutzername, nur über HTTPS. Der Link wird nicht in Logs oder Berichten gespeichert.
- **Passkeys über Funnel:** WebAuthn braucht eine stabile RP-ID (`medienserver.tailnet.ts.net`). Ein späterer Domainwechsel macht Passkeys ungültig. Darauf hinweisen.
- **Seerr-Import:** Den Endpunkt und das Verhalten bei `spv_`-Konten mit gesperrtem Passwort gegen die gepinnte Seerr-Version testen.
- **SSO-Plugin `EnableFolderRoles`:** Mit 4.0.0.4 und Jellyfin 12.4 zuerst isoliert testen.
- **Couchdeck und StackPilot-Neustart:** Couchdeck darf nicht von laufendem StackPilot abhängen. `integration.json` bleibt gültig. Ohne Brücke fällt nur die Anfragefunktion aus.
- **Offen:**
  - Sollen Zuschauer Seerr selbst im Browser nutzen? Das würde eine öffentliche Seerr-Route über das Gateway bedeuten und ist bisher bewusst ausgeschlossen.
  - Reicht eine geprüfte Anfrageintegration in Jellyfin (siehe [Jellyfin-Erlebnis](jellyfin-erlebnis.md))?
