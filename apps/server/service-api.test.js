import { test } from "node:test";
import assert from "node:assert/strict";
import { Services } from "./service-api.js";
const vault = {
  ensure: () => ({
    username: "fixture",
    password: "fixture-password",
    apiKey: "fixture-key",
  }),
};
test("qBittorrent-Anmeldung unterstützt Legacy-SID und den neuen portbezogenen Cookie bei HTTP 204", async () => {
  for (const [text, cookie] of [
    ["Ok.", "SID=legacy-token; HttpOnly"],
    ["", "QBT_SID_8080=current-token; HttpOnly"],
  ]) {
    const api = new Services(
      {
        id: "fixture",
        spec: { selected: ["qBittorrent"] },
        ports: { qBittorrent: 8080 },
      },
      vault,
    );
    api.request = async (name, route, options) =>
      route.endsWith("/login")
        ? {
            headers: new Headers({ "set-cookie": cookie }),
            text: async () => text,
          }
        : (assert.ok(options.headers.Cookie.includes("token")), "v5.3.0");
    assert.equal(await api.qbit("/app/version"), "v5.3.0");
  }
});
test("HTTP-Fehler aus Diensten speichern keine erzeugten Passwörter oder API-Schlüssel", async () => {
  const api = new Services(
    { id: "fixture", spec: { selected: ["Sonarr"] }, ports: { Sonarr: 8989 } },
    vault,
  );
  const previous = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify([
        { errorMessage: "Bad fixture-password and fixture-key" },
      ]),
      { status: 400 },
    );
  try {
    await assert.rejects(
      api.arr("Sonarr", "/downloadclient/test", { method: "POST", body: {} }),
      (e) =>
        !e.message.includes("fixture-password") &&
        !e.message.includes("fixture-key") &&
        e.message.includes("[redacted]"),
    );
  } finally {
    globalThis.fetch = previous;
  }
});
test("Abgelaufene qBittorrent-Sitzung wird einmal neu authentifiziert", async () => {
  const api = new Services(
    {
      id: "fixture",
      spec: { selected: ["qBittorrent"] },
      ports: { qBittorrent: 8080 },
    },
    vault,
  );
  let logins = 0;
  let requests = 0;
  api.request = async (name, route) => {
    if (route.endsWith("/login")) {
      logins++;
      return {
        headers: new Headers({ "set-cookie": "QBT_SID_8080=fixture" }),
        text: async () => "",
      };
    }
    requests++;
    if (requests === 1) throw new Error("qBittorrent HTTP 403");
    return "v5.3.0";
  };
  assert.equal(await api.qbit("/app/version"), "v5.3.0");
  assert.equal(logins, 2);
  assert.equal(requests, 2);
});
