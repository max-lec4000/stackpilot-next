# UI/UX-Browserregression

Dieser Test öffnet die laufende Oberfläche und ersetzt **alle**
API-Antworten durch feste Beispieldaten. Er verändert weder den Medienstack noch
Konten, VPN, Tailscale oder echte Downloads. Die Tests beweisen keine persönliche
MFA-Anmeldung oder Wiedergabe.

Benötigt werden ein bereits installiertes Playwright-Node-Modul und Chromium.
Das Skript installiert und lädt keine Browser oder Abhängigkeiten herunter.
Beispiel mit der vorhandenen Cloud-Installation:

    npm run dev

In einem zweiten Terminal:

    STACKPILOT_PLAYWRIGHT_MODULE=/tmp/stackpilot-browser/node_modules/playwright \
    CHROMIUM_PATH=/usr/bin/chromium \
    node apps/web/testing/ux-smoke.cjs

Für die Prüfung des Produktionsbuilds zunächst `npm run build` ausführen und
ihn beispielsweise mit dem bereits installierten Vite bereitstellen:

    npm exec -- vite preview apps/web --config apps/web/vite.config.js --host 127.0.0.1 --port 5174 --strictPort

In einem zweiten Terminal gegen genau diesen Build testen:

    STACKPILOT_PLAYWRIGHT_MODULE=/tmp/stackpilot-browser/node_modules/playwright \
    CHROMIUM_PATH=/usr/bin/chromium \
    STACKPILOT_TEST_URL=http://stackpilot.localhost:5174 \
    npm run test:ui

Optional: STACKPILOT_TEST_URL (Standard http://stackpilot.localhost:5173) und
STACKPILOT_TEST_OUTPUT (Standard /tmp/stackpilot-ux-0.3.0). Screenshots werden
außerhalb des Repositorys gespeichert.

Abgedeckt: Dashboard, kompakte App-Liste und explizite Zugangsanzeige,
Downloadfilter und Bestätigungen, begrenzte Poster-Suche, Film-/Serienanfragen,
Anfragestatus und Aktionen, Verwaltungsunterseiten mit Browser-Zurück,
Schrittnavigation ohne Mutation, Passwortverwerfen, beide Themes sowie
Desktop/Tablet/Mobile und Fehler-/Leerzustände.
