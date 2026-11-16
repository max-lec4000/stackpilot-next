import { test } from "node:test";
import assert from "node:assert/strict";
import { MediaHub, mediaSummary } from "./media-hub.js";
import { Sources, publicSchema, schemaKey } from "./sources.js";
function fixture() {
  const calls = [],
    values = new Map();
  let leased = false;
  const plan = {
    id: "plan",
    rootId: "root",
    spec: {
      selected: [
        "Seerr",
        "Jellyfin",
        "Radarr",
        "Sonarr",
        "Prowlarr",
        "qBittorrent",
      ],
      vpn: true,
    },
  };
  const engine = {
    current: () => ({ plan, job: { status: "completed" } }),
    relay: async () => "relay",
    store: {
      claim: () => {
        if (leased) return false;
        leased = true;
        return true;
      },
      release: () => {
        leased = false;
      },
    },
    vault: {
      get: (k) => values.get(k),
      set: (k, v) => values.set(k, v),
      ensure: (k, fn) => {
        if (!values.has(k)) values.set(k, fn());
        return values.get(k);
      },
    },
  };
  let detail = {
    id: 42,
    title: "Film",
    mediaInfo: { status: 1, requests: [] },
    seasons: [{ seasonNumber: 1 }, { seasonNumber: 2 }],
  };
  const schema = {
    name: "Testquelle",
    implementation: "Torznab",
    configContract: "TorznabSettings",
    protocol: "torrent",
    privacy: "private",
    fields: [
      {
        name: "baseUrl",
        label: "Adresse",
        type: "textbox",
        value: "https://example.org",
      },
      {
        name: "apiKey",
        label: "API-Schlüssel",
        type: "password",
        value: "schema-secret",
      },
    ],
  };
  let existing = [];
  const services = {
    additional: {
      seerr: async (route, opts) => {
        calls.push(["seerr", route, opts]);
        if (route.startsWith("/search"))
          return {
            page: 1,
            totalPages: 1,
            results: [
              {
                ...detail,
                mediaType: "movie",
                posterPath: "/cover.jpg",
                private: "secret",
              },
              { mediaType: "person", id: 1 },
            ],
          };
        if (route.startsWith("/movie/") || route.startsWith("/tv/"))
          return detail;
        if (route.startsWith("/request?"))
          return {
            pageInfo: { results: 1 },
            results: [
              {
                id: 7,
                status: 2,
                createdAt: "2026-11-07",
                seasons: [],
                media: { mediaType: "movie", tmdbId: 42, status: 3 },
              },
            ],
          };
        return { id: 7 };
      },
    },
    arr: async (name, route, opts) => {
      calls.push([name, route, opts]);
      if (route === "/indexer/schema") return [schema];
      if (route === "/indexer") return opts ? { id: 3 } : existing;
      if (route === "/applications")
        return [
          { name: "Radarr", syncLevel: "fullSync", apiKey: "never-export" },
        ];
      if (route.startsWith("/queue"))
        return {
          records: [
            {
              movie: { tmdbId: 42 },
              downloadId: "a".repeat(40),
              status: "downloading",
            },
          ],
        };
      if (route.startsWith("/indexer/"))
        return {
          id: 3,
          name: "Existing",
          enable: true,
          fields: [{ name: "apiKey", value: "existing-secret" }],
        };
      return null;
    },
    qbit: async (route, body) => {
      calls.push(["qbit", route, body]);
      return [{ hash: "a".repeat(40), progress: 0.4, tracker: "secret" }];
    },
  };
  const guard = {
      checkedPlanId: "plan",
      check: async () => ({ state: "connected" }),
    },
    hub = new MediaHub(engine, guard, { services: () => services });
  return {
    hub,
    guard,
    engine,
    services,
    calls,
    values,
    plan,
    schema,
    setDetail: (v) => (detail = v),
    setExisting: (v) => (existing = v),
  };
}
test("Suche und Details liefern sichere Medienprojektionen; Personen und fremde Cover-URLs bleiben draußen", async () => {
  const f = fixture(),
    r = await f.hub.search("Test & Film");
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].title, "Film");
  assert.ok(!JSON.stringify(r).includes("secret"));
  assert.match(f.calls[0][1], /Test%20%26%20Film/);
  assert.equal(
    mediaSummary({ posterPath: "https://bad.example/secret" }).poster,
    null,
  );
  await assert.rejects(f.hub.detail("person", 1));
});
test("Anfragen brauchen frisches VPN, verhindern Duplikate und akzeptieren nur verfügbare Staffelnummern", async () => {
  const f = fixture();
  f.guard.check = async () => ({ state: "blocked" });
  await assert.rejects(
    f.hub.request({ type: "movie", id: 42 }),
    /Downloads gesperrt/,
  );
  assert.equal(f.calls.length, 0);
  f.guard.check = async () => ({ state: "connected" });
  f.setDetail({ mediaInfo: { status: 2, requests: [{ status: 2 }] } });
  await assert.rejects(
    f.hub.request({ type: "movie", id: 42 }),
    /bereits angefragt/,
  );
  f.setDetail({
    mediaInfo: { status: 1, requests: [] },
    seasons: [{ seasonNumber: 1 }],
  });
  await assert.rejects(
    f.hub.request({ type: "tv", id: 42, seasons: [999] }),
    /ungültig/,
  );
  await f.hub.request({ type: "tv", id: 42, seasons: [1] });
  const post = f.calls.find((c) => c[1] === "/request");
  assert.deepEqual(post[2].body, {
    mediaType: "tv",
    mediaId: 42,
    is4k: false,
    seasons: [1],
  });
});
test("Anfragefortschritt korreliert Medien-ID, ARR-Warteschlange und Torrent-Hash ohne private Torrentdaten", async () => {
  const f = fixture();
  const r = await f.hub.requests();
  assert.equal(r.results[0].state, "downloading");
  assert.equal(r.results[0].progress, 0.4);
  assert.ok(!JSON.stringify(r).includes("secret"));
  f.services.arr = async () => {
    throw Error("offline");
  };
  f.services.qbit = async () => {
    throw Error("offline");
  };
  const offline = await f.hub.requests({ force: true });
  assert.equal(offline.results[0].state, "unknown");
  assert.ok(offline.unavailable.includes("Radarr"));
});
test("Einzelne Downloads: kein Fortsetzen ohne VPN, keine Wildcards, Entfernen behält Dateien und manuelles Pausieren hebt Auto-Fortsetzen auf", async () => {
  const f = fixture(),
    hash = "a".repeat(40);
  await assert.rejects(
    f.hub.downloadAction({ hash: "all", action: "remove", confirmation: "OK" }),
  );
  f.guard.check = async () => ({ state: "blocked" });
  await assert.rejects(
    f.hub.downloadAction({ hash, action: "resume" }),
    /gesperrt/,
  );
  f.values.set("download-policy:root:paused", [hash]);
  await f.hub.downloadAction({ hash, action: "pause" });
  assert.deepEqual(f.values.get("download-policy:root:paused"), []);
  await assert.rejects(f.hub.downloadAction({ hash, action: "remove" }), /OK/);
  await f.hub.downloadAction({ hash, action: "remove", confirmation: "OK" });
  assert.deepEqual(f.calls.find((c) => c[1] === "/torrents/delete")[2], {
    hashes: hash,
    deleteFiles: "false",
  });
  await f.hub.downloadAction({
    hash,
    action: "remove",
    confirmation: "OK",
    deleteFiles: true,
  });
  assert.deepEqual(
    f.calls.filter((c) => c[1] === "/torrents/delete").at(-1)[2],
    { hashes: hash, deleteFiles: "true" },
  );
});
test("Quellen: Geheimnisse werden ausgeblendet; nur getestete, unveränderte und unbenutzte Entwürfe sind speicherbar", async () => {
  const f = fixture(),
    sources = new Sources(f.hub);
  assert.equal(publicSchema(f.schema).fields[1].value, "");
  assert.ok(!JSON.stringify(await sources.list()).includes("schema-secret"));
  const draft = await sources.test({
    schema: schemaKey(f.schema),
    name: "Meine Quelle",
    values: { apiKey: "provider-private" },
  });
  assert.ok(!JSON.stringify(draft).includes("provider-private"));
  await sources.save({ id: draft.id, confirmation: "OK" });
  await assert.rejects(
    sources.save({ id: draft.id, confirmation: "OK" }),
    /bereits verwendet/,
  );
  const post = f.calls.find(
    (c) => c[1] === "/indexer" && c[2]?.method === "POST",
  );
  assert.equal(post[2].body.fields[1].value, "provider-private");
  assert.equal(post[2].body.enable, true);
});
test("Quellenfehler verraten keine Anbieter-Schlüssel, bestehende Quellen werden nicht überschrieben", async () => {
  const f = fixture(),
    sources = new Sources(f.hub);
  f.setExisting([{ name: "Meine Quelle" }]);
  await assert.rejects(
    sources.test({
      schema: schemaKey(f.schema),
      name: "Meine Quelle",
      values: { apiKey: "private" },
    }),
    /existiert bereits/,
  );
  f.setExisting([]);
  f.services.arr = async (name, route) => {
    if (route === "/indexer/schema") return [f.schema];
    if (route === "/indexer") return [];
    throw Error("echo private-secret");
  };
  await assert.rejects(
    sources.test({
      schema: schemaKey(f.schema),
      name: "Neu",
      values: { apiKey: "private-secret" },
    }),
    (e) =>
      !e.message.includes("private-secret") &&
      e.message.includes("Quellentest"),
  );
});

test("Ein angenommener Wunsch ohne Warteschlangeneintrag behauptet keine laufende Suche", async () => {
  const f = fixture();
  f.services.arr = async () => ({ records: [] });
  const r = await f.hub.requests();
  assert.equal(r.results[0].state, "waiting");
});
test("Ein defekter Katalog blendet vorhandene Quellen und ARR-Verbindungen nicht aus; Fehler enthalten keine Zugangsdaten", async () => {
  const f = fixture();
  f.services.arr = async (name, route) => {
    if (route === "/indexer/schema")
      throw Error("HTTP 598 ResponseTooLarge provider-secret");
    if (route === "/indexer")
      return [
        {
          id: 1,
          name: "Existing",
          enable: true,
          fields: [{ value: "private-key" }],
        },
      ];
    return [{ name: "Radarr", syncLevel: "fullSync" }];
  };
  const r = await new Sources(f.hub).list();
  assert.equal(r.sources[0].name, "Existing");
  assert.equal(r.connections[0].name, "Radarr");
  assert.deepEqual(r.schemas, []);
  assert.equal(r.issues[0].code, "PROWLARR_RESPONSE_SIZE");
  assert.ok(!JSON.stringify(r).includes("provider-secret"));
  assert.ok(!JSON.stringify(r).includes("private-key"));
});
test("Fehlgeschlagene Quellenabfrage bleibt unbekannt statt leer; optionale Null-Felder im Katalog werden unterstützt", async () => {
  const f = fixture();
  f.services.arr = async (name, route) => {
    if (route === "/indexer/schema")
      return [
        {
          name: "Valid",
          protocol: "torrent",
          fields: [
            null,
            { name: "apiKey", type: "password", selectOptions: null },
          ],
        },
      ];
    if (route === "/indexer") throw Error("HTTP 401 secret");
    return [];
  };
  const r = await new Sources(f.hub).list();
  assert.equal(r.sources, null);
  assert.equal(r.issues[0].code, "PROWLARR_AUTH");
  assert.equal(r.schemas[0].fields.length, 1);
  assert.deepEqual(r.schemas[0].fields[0].choices, []);
  assert.equal(r.schemas[0].fields[0].value, "");
});

test("Cardigann-Quellen mit info-Hinweisen sind testbar: Basisadresse vorbelegt, HTML nur als Text und API-Hostname bleibt unverändert", async () => {
  const f = fixture();
  f.schema.name = "Cardigann fixture";
  f.schema.implementation = "Cardigann";
  f.schema.indexerUrls = ["javascript:alert(1)", "https://example.org/"];
  f.schema.fields = [
    { name: "baseUrl", label: "Base Url", type: "textbox", value: null },
    { name: "seedRatio", label: "Seed Ratio", type: "textbox", value: null },
    {
      name: "apiurl",
      label: "API URL",
      type: "textbox",
      value: "api.example.org",
    },
    {
      name: "top100",
      label: "Top100",
      type: "select",
      value: 0,
      selectOptions: [{ value: 0, name: "All" }],
    },
    {
      name: "info_top100",
      label: "About",
      type: "info",
      value: "Uses <b>top100_recent</b> for <i>TEST</i>.",
    },
    {
      name: "definitionFile",
      type: "textbox",
      hidden: "hidden",
      value: "fixture",
    },
  ];
  const sources = new Sources(f.hub),
    listed = await sources.list(),
    schema = listed.schemas[0];
  assert.equal(
    schema.fields.find((v) => v.name === "baseUrl").value,
    "https://example.org/",
  );
  assert.deepEqual(schema.fields.find((v) => v.name === "baseUrl").choices, [
    { name: "https://example.org/", value: "https://example.org/" },
  ]);
  assert.equal(
    schema.fields.find((v) => v.type === "info").value,
    "Uses  top100_recent  for  TEST .",
  );
  assert.ok(!JSON.stringify(schema).includes("<b>"));
  assert.equal(
    schema.fields.find((v) => v.name === "definitionFile"),
    undefined,
  );
  await sources.test({
    schema: schemaKey(f.schema),
    name: "Test",
    values: { apiurl: "api.example.org", top100: 0 },
  });
  const tested = f.calls.find((c) => c[1] === "/indexer/test")[2].body.fields;
  assert.equal(
    tested.find((v) => v.name === "baseUrl").value,
    "https://example.org/",
  );
  assert.equal(tested.find((v) => v.name === "seedRatio").value, null);
  assert.equal(
    tested.find((v) => v.name === "apiurl").value,
    "api.example.org",
  );
  await assert.rejects(
    sources.test({
      schema: schemaKey(f.schema),
      name: "Tamper",
      values: { info_top100: "changed" },
    }),
    /Unbekannte Einstellung/,
  );
  await assert.rejects(
    sources.test({
      schema: schemaKey(f.schema),
      name: "Tamper",
      values: { definitionFile: "changed" },
    }),
    /Unbekannte Einstellung/,
  );
});
test("Echte Spezialfelder bleiben gesperrt und ungültige Basisadressen werden abgewiesen", async () => {
  const f = fixture(),
    sources = new Sources(f.hub);
  f.schema.fields.push({ name: "captcha", type: "captcha" });
  await assert.rejects(
    sources.test({ schema: schemaKey(f.schema), name: "Test", values: {} }),
    /speziellen Einrichtungsdialog/,
  );
  f.schema.fields.pop();
  await assert.rejects(
    sources.test({
      schema: schemaKey(f.schema),
      name: "Test",
      values: { baseUrl: "file:///etc/passwd" },
    }),
    /Nur HTTP/,
  );
});

test("Quellen bearbeiten erhält leere Zugangsfelder, sichert den alten Stand und verhindert veraltete Änderungen", async () => {
  const f = fixture(),
    source = {
      ...f.schema,
      id: 3,
      name: "Bestehend",
      enable: false,
      priority: 5,
      fields: [
        { name: "baseUrl", type: "textbox", value: "https://example.org" },
        { name: "apiKey", type: "password", value: "existing-private-key" },
      ],
    };
  f.services.arr = async (name, route, opts) => {
    f.calls.push([name, route, opts]);
    if (route === "/indexer/3")
      return opts?.method === "PUT"
        ? { ...opts.body, id: 3 }
        : structuredClone(source);
    if (route === "/indexer") return [{ id: 3, name: source.name }];
    if (route === "/indexer/test") return null;
    throw Error("unexpected");
  };
  const sources = new Sources(f.hub),
    detail = await sources.detail(3);
  assert.equal(detail.fields.find((f) => f.name === "apiKey").value, "");
  const draft = await sources.test({
    sourceId: 3,
    name: "Umbenannt",
    values: { apiKey: "", baseUrl: "https://new.example.org" },
  });
  await sources.save({ id: draft.id, confirmation: "OK" });
  const saved = f.calls.find(
    (c) => c[1] === "/indexer/3" && c[2]?.method === "PUT",
  )[2].body;
  assert.equal(saved.enable, false);
  assert.equal(saved.priority, 5);
  assert.equal(
    saved.fields.find((f) => f.name === "apiKey").value,
    "existing-private-key",
  );
  assert.equal(
    saved.fields.find((f) => f.name === "baseUrl").value,
    "https://new.example.org",
  );
  assert.ok(f.values.has("source-backup:" + draft.id));
  const stale = await sources.test({ sourceId: 3, name: "Neu", values: {} });
  source.priority = 99;
  await assert.rejects(
    sources.save({ id: stale.id, confirmation: "OK" }),
    /inzwischen|seit dem Test/,
  );
});

test("Gespeicherte Zugänge in Quellen-URLs werden im Bearbeitungsformular ausgeblendet", () => {
  const value = publicSchema({
    indexerUrls: ["https://source.example/?apikey=private"],
    fields: [
      {
        name: "baseUrl",
        type: "textbox",
        value: "https://source.example/?apikey=private",
      },
    ],
  });
  assert.equal(value.fields[0].secret, true);
  assert.equal(value.fields[0].value, "");
  assert.deepEqual(value.fields[0].choices, []);
  assert.ok(!JSON.stringify(value).includes("private"));
});
test("Anfragenseiten verwenden native Filter und begrenzte Seiten statt einer abgeschnittenen Gesamtliste", async () => {
  const f = fixture();
  const result = await f.hub.requests({
    page: 3,
    filter: "active",
    type: "movie",
  });
  assert.equal(result.page, 3);
  assert.equal(result.pageSize, 8);
  assert.ok(
    f.calls.some(
      (c) =>
        String(c[1]).includes("skip=16") &&
        String(c[1]).includes("filter=unavailable") &&
        String(c[1]).includes("mediaType=movie"),
    ),
  );
  await assert.rejects(() => f.hub.requests({ filter: "invalid" }));
});
test("Downloadseiten behalten Dateigröße und Seitenfortsetzung, ohne Tracker-Zugänge auszugeben", async () => {
  const f = fixture();
  f.services.qbit = async (route) => {
    f.calls.push(["qbit", route]);
    return route === "/transfer/info"
      ? { dl_info_speed: 12, up_info_speed: 3 }
      : Array.from({ length: 9 }, (_, i) => ({
          hash: String(i).padStart(40, "a"),
          name: "Film",
          size: 2048,
          downloaded: 1024,
          tracker: "secret",
        }));
  };
  const result = await f.hub.downloads({ page: 2, filter: "completed" });
  assert.equal(result.torrents.length, 8);
  assert.equal(result.hasMore, true);
  assert.equal(result.torrents[0].size, 2048);
  assert.equal(result.torrents[0].downloaded, 1024);
  assert.ok(f.calls.some((c) => String(c[1]).includes("offset=8&limit=9")));
  assert.equal(JSON.stringify(result).includes("secret"), false);
});
test("Bestätigte Löschung korrigiert veraltete Verfügbarkeit in Suche und Details; erneute Anfrage wird frisch abgesichert", async () => {
  const f = fixture();
  f.values.set("removed-movie:root:42", { requestId: 7, mediaRecordId: 12 });
  f.setDetail({
    id: 42,
    title: "Film",
    mediaInfo: { id: 12, status: 5, requests: [{ id: 7, status: 2 }] },
  });
  f.services.arr = async () => [];
  const original = f.services.additional.seerr;
  f.services.additional.seerr = async (route, options) => {
    if (route === "/media/12/unknown") {
      f.calls.push(["seerr", route, options]);
      return { status: 1 };
    }
    if (route === "/request" && options?.method === "POST") {
      f.calls.push(["seerr", route, options]);
      return { id: 8 };
    }
    if (route === "/request/8")
      return { id: 8, status: 2, media: { tmdbId: 42, mediaType: "movie" } };
    return original(route, options);
  };
  const detail = await f.hub.detail("movie", 42);
  assert.equal(detail.status, 6);
  assert.equal(detail.requested, false);
  assert.equal((await f.hub.search("Film")).results[0].status, 6);
  await f.hub.request({ type: "movie", id: 42 });
  const reset = f.calls.findIndex((c) => c[1] === "/media/12/unknown");
  const post = f.calls.findIndex(
    (c) => c[1] === "/request" && c[2]?.method === "POST",
  );
  assert.ok(reset >= 0 && reset < post);
  assert.equal((await f.hub.detail("movie", 42)).requested, true);
  await assert.rejects(
    () => f.hub.request({ type: "movie", id: 42 }),
    /bereits angefragt/,
  );
  assert.equal(
    f.calls.filter((c) => c[1] === "/request" && c[2]?.method === "POST")
      .length,
    1,
  );
});
test("Vorhandene neue Dateien und fehlende Löschbelege umgehen die Verfügbarkeitssperre nicht", async () => {
  for (const withMarker of [true, false]) {
    const f = fixture();
    f.setDetail({
      id: 42,
      title: "Film",
      mediaInfo: { id: 12, status: 5, requests: [] },
    });
    if (withMarker) f.values.set("removed-movie:root:42", { requestId: 7 });
    f.services.arr = async () => [{ tmdbId: 42, hasFile: true }];
    assert.equal((await f.hub.detail("movie", 42)).status, 5);
    await assert.rejects(
      () => f.hub.request({ type: "movie", id: 42 }),
      /bereits verfügbar/,
    );
    assert.equal(
      f.calls.some((c) => c[2]?.method === "POST"),
      false,
    );
  }
});
test("Nicht prüfbarer Dateistatus nach Löschung bleibt unbekannt und startet keine neue Anfrage", async () => {
  const f = fixture();
  f.values.set("removed-movie:root:42", { requestId: 7 });
  f.setDetail({
    id: 42,
    title: "Film",
    mediaInfo: { status: 5, requests: [] },
  });
  f.services.arr = async () => {
    throw Error("offline");
  };
  const detail = await f.hub.detail("movie", 42);
  assert.equal(detail.status, 0);
  assert.equal(detail.availabilityCheckFailed, true);
  await assert.rejects(() => f.hub.request({ type: "movie", id: 42 }));
  assert.equal(
    f.calls.some((c) => c[1] === "/request" && c[2]?.method === "POST"),
    false,
  );
});

test("Seerr muss die Statuskorrektur bestätigen, bevor eine neue Anfrage angelegt wird", async () => {
  const f = fixture();
  f.values.set("removed-movie:root:42", { requestId: 7, mediaRecordId: 12 });
  f.setDetail({ id: 42, mediaInfo: { id: 12, status: 5, requests: [] } });
  f.services.arr = async () => [];
  const original = f.services.additional.seerr;
  f.services.additional.seerr = async (route, options) =>
    route === "/media/12/unknown" ? { status: 5 } : original(route, options);
  await assert.rejects(
    () => f.hub.request({ type: "movie", id: 42 }),
    /nicht anlegen/,
  );
  assert.equal(
    f.calls.some((c) => c[1] === "/request" && c[2]?.method === "POST"),
    false,
  );
});
test("Neue Anfrage übernimmt die bestätigte profilspezifische Auswahl statt eines alten Seerr-Standardprofils", async () => {
  const f = fixture();
  f.values.set("quality-policy:root:movie:42", {
    serverId: 0,
    profileId: 2,
    compact: true,
  });
  f.services.arr = async () => [
    {
      id: 2,
      upgradeAllowed: false,
      items: [
        { allowed: true, quality: { name: "WEBDL-1080p" } },
        { allowed: false, quality: { name: "Remux-1080p" } },
      ],
    },
  ];
  const original = f.services.additional.seerr;
  f.services.additional.seerr = async (route, options) => {
    if (route === "/auth/me") return { permissions: 2 };
    if (route === "/settings/radarr")
      return [
        {
          id: 0,
          hostname: "radarr",
          port: 7878,
          isDefault: true,
          activeProfileId: 1,
        },
      ];
    if (route === "/request" && options?.method === "POST") {
      f.calls.push(["seerr", route, options]);
      return { id: 7, profileId: 2, serverId: 0 };
    }
    return original(route, options);
  };
  const result = await f.hub.request({ type: "movie", id: 42 });
  assert.equal(result.warning, null);
  assert.deepEqual(f.calls.find((c) => c[1] === "/request")[2].body, {
    mediaType: "movie",
    mediaId: 42,
    is4k: false,
    serverId: 0,
    profileId: 2,
  });
});

test("Bestätigtes Filmprofil geht dem Größenstandard vor; explizite neue Größenwahl bleibt möglich", async () => {
  const f = fixture();
  f.values.set("quality-policy:root:movie:42", {
    profileId: 5,
    serverId: 0,
    profileName: "Persönlich",
  });
  const seerr = f.services.additional.seerr,
    arr = f.services.arr;
  f.services.additional.seerr = async (route, options) =>
    route === "/auth/me"
      ? { permissions: 2 }
      : route === "/settings/radarr"
        ? [
            {
              id: 0,
              isDefault: true,
              hostname: "radarr",
              port: 7878,
              activeProfileId: 5,
            },
          ]
        : seerr(route, options);
  f.services.arr = async (name, route, options) =>
    route === "/qualityprofile"
      ? [{ id: 5, name: "Persönlich", items: [] }]
      : arr(name, route, options);
  let created = 0;
  f.hub.sizeLimits = {
    config: () => ({ rate: 3 }),
    forRequest: async () => {
      created++;
      return { profileId: 6, serverId: 0, capGiB: 6, formatId: 1 };
    },
  };
  await f.hub.request({ type: "movie", id: 42, expectedFilmProfile: 5 });
  assert.equal(created, 0);
  await f.hub.request({ type: "movie", id: 42, sizeGiBPerHour: 3 });
  assert.equal(created, 1);
  await assert.rejects(
    f.hub.request({ type: "movie", id: 42, expectedFilmProfile: 99 }),
    /Filmprofil/,
  );
});

test("Fester Filmstandard wird ohne Laufzeit angewandt und gegen veraltete Auswahl geprüft", async () => {
  const f = fixture();
  f.hub.sizeLimits = {
    config: () => ({ rate: 0, capGiB: 7.5 }),
    forRequest: async (_s, _plan, detail, rate, capGiB) => {
      assert.equal(detail.runtime, undefined);
      assert.equal(rate, 0);
      assert.equal(capGiB, 7.5);
      return { profileId: 6, serverId: 0, capGiB, formatId: 1 };
    },
  };
  await assert.rejects(
    f.hub.request({ type: "movie", id: 42, expectedSizeDefaultCap: 7 }),
    /Größenstandard wurde geändert/,
  );
  await f.hub.request({ type: "movie", id: 42, expectedSizeDefaultCap: 7.5 });
  assert.equal(f.calls.find((c) => c[1] === "/request")[2].body.profileId, 6);
});

test("Couchdeck-Filmgrenze hat Vorrang und bleibt an den bestätigten Seerr-Besitzer gebunden", async () => {
  const f = fixture();
  const owner = "0123456789abcdef0123456789abcdef";
  const seerr = f.services.additional.seerr;
  f.services.additional.seerr = async (route, options) => route === "/user/9"
    ? { jellyfinUserId: owner } : seerr(route, options);
  f.hub.sizeLimits = {
    config: () => ({ rate: 0, capGiB: 10 }),
    forRequest: async (_s, _p, _detail, rate, capGiB) => {
      assert.equal(rate, 0);
      assert.equal(capGiB, 7.5);
      return { profileId: 6, serverId: 0, capGiB };
    },
  };
  const body = { type: "movie", id: 42 };
  await assert.rejects(f.hub.request(body, { owner: "different", userId: 9, capGiB: 7.5 }), /Wohnzimmer/);
  await f.hub.request(body, { owner, userId: 9, capGiB: 7.5 });
  const saved = f.calls.find((c) => c[1] === "/request")[2].body;
  assert.equal(saved.userId, 9);
  assert.equal(saved.profileId, 6);
});
