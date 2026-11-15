# Sicherheit

## Verbindliche Leitlinien

- Keine öffentliche Freigabe ohne eigene Abnahme.
- Zuschauer und technische/administrative Konten getrennt; MFA und Gerätewiderruf prüfen.
- TLS-, Issuer- und Tokenprüfung beibehalten; keine pauschalen Netzwerkfreigaben.
- Minimal benötigte Rechte; lokale Administratoraktionen ausdrücklich erklären.
- Keine Passwörter, API-Schlüssel, MFA-Secrets oder Rohlogs in Entwicklungsberichten.
- Entwicklungsexporte und GitHub-Übertragung benötigen eine lokale, erkennbare Auswahl.

## In 0.2.0 umgesetzt

- Berechtigung, Server-Erreichbarkeit, Client-Erreichbarkeit und persönliche Abnahme
  als getrennte Nachweise im Einrichtungsablauf darstellen.
- Tailscale-Regelvorlagen mit aktuellem Ziel und gewählten Quellen statt Freigabe für alle.
- Abhängigkeiten verständlich zeigen, ohne Backend-Sicherheitsprüfungen zu ersetzen.

## Später

Abgetrennter privilegierter Executor, zusätzliche Rollen, vollständige Sicherung und
Wiederherstellung sowie öffentliche TLS-/Client-Abnahme bleiben offen.

## 0.4.0

Geführte Funnel-Aktivierung und Rücknahme eigener, geprüfter Gateway-Routen,
erneute Passwortbestätigung, persönliche Geräteabnahme und wiederkehrende
Prüfung implementiert. Lokale Zugänge bleiben erhalten. Die tatsächliche
öffentliche Anmeldung ist weiterhin am Zielserver zu prüfen:
[Bedienweg und Grenzen](../funnel.md).
