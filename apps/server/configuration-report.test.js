import { test } from "node:test";
import assert from "node:assert/strict";
import { configurationReport } from "./configuration-report.js";
test("Dienstkonfigurationen erfassen Profilregeln und Quellstatus, keine API-Schlüssel, Filme oder Quellenzugänge", async () => {
  const secret = "NEVER_EXPORT_SERVICE_SECRET";
  const r = await configurationReport({
    context: async () => ({
      plan: {
        spec: { selected: ["Radarr", "Prowlarr", "qBittorrent", "Seerr"] },
      },
      s: {
        arr: async (name, route) =>
          route === "/qualityprofile"
            ? [
                {
                  id: 1,
                  name: secret,
                  items: [
                    {
                      allowed: false,
                      items: [
                        { allowed: true, quality: { id: 7, name: secret } },
                      ],
                    },
                  ],
                  apiKey: secret,
                },
              ]
            : route === "/rootfolder"
              ? [{ path: "/data/media/movies", freeSpace: 1000 }]
              : [
                  {
                    id: 1,
                    name: secret,
                    enable: true,
                    fields: [{ name: "apiKey", value: secret }],
                  },
                ],
        qbit: async () => ({
          save_path: "/data/downloads",
          web_ui_password: secret,
        }),
        additional: {
          seerr: async () => [
            { id: 0, apiKey: secret, activeProfileId: 1, isDefault: true },
          ],
        },
      },
    }),
  });
  assert.ok(!JSON.stringify(r).includes(secret));
  assert.equal(r.Radarr.value.profiles[0].qualities[0].allowed, false);
  assert.equal(r.Seerr.value.radarr[0].id, 0);
  assert.equal(r.qBittorrent.value.savePath, "/data/downloads");
});
