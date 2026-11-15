import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { StateStore } from "./state.js";
import { Auth } from "./auth.js";
import { SsoConnection } from "./identity/sso-connection.js";
import { inventoryMiddleware } from "./middleware.js";

test("Angemeldete SSO-Vorschau erreicht den privaten Konfigurationsdienst", async (t) => {
  const root = await mkdtemp("/tmp/sp-sso-api-");
  const store = new StateStore(root);
  try {
    const auth = new Auth(store);
    await auth.setup(
      "fixture-admin",
      "Fixture-only-password-248!",
      (await readFile(auth.bootstrapFile, "utf8")).trim(),
    );
    const session = auth.session();
    const expected = {
      canApply: false,
      publicReady: false,
      blockers: ["Plugin fehlt"],
    };
    const plan = t.mock.method(
      SsoConnection.prototype,
      "plan",
      async () => expected,
    );
    const api = inventoryMiddleware({ store, background: false });
    let status = 200,
      body;
    await api(
      {
        url: "/api/remote-access/sso",
        method: "GET",
        headers: {
          host: "localhost:5173",
          cookie: "stackpilot_session=" + session.token,
        },
      },
      {
        setHeader() {},
        writeHead(code) {
          status = code;
        },
        end(text) {
          body = JSON.parse(text);
        },
      },
      () => assert.fail("Unexpected next"),
    );
    assert.equal(status, 200);
    assert.deepEqual(body, expected);
    assert.equal(plan.mock.callCount(), 1);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Vorbereitungshinweise sind nach Anmeldung sichtbar, interne Fehler bleiben verborgen", async (t) => {
  const { JellyfinProtection } = await import(
      "./identity/jellyfin-protection.js"
    ),
    { PrivateServe } = await import("./identity/private-serve.js"),
    { setupError } = await import("./identity/setup-error.js");
  const root = await mkdtemp("/tmp/sp-setup-api-"),
    store = new StateStore(root);
  try {
    const auth = new Auth(store);
    await auth.setup(
      "fixture-admin",
      "Fixture-only-password-248!",
      (await readFile(auth.bootstrapFile, "utf8")).trim(),
    );
    const session = auth.session(),
      api = inventoryMiddleware({ store, background: false });
    t.mock.method(JellyfinProtection.prototype, "preview", async () => {
      throw setupError("Authentik zuerst lokal einrichten.");
    });
    t.mock.method(PrivateServe.prototype, "preview", async () => {
      throw Error("private-token-must-not-leak");
    });
    for (const [url, expected] of [
      [
        "/api/remote-access/protection/preview",
        "Authentik zuerst lokal einrichten.",
      ],
      [
        "/api/remote-access/private-serve",
        "Prüfung konnte nicht abgeschlossen werden.",
      ],
    ]) {
      let status, body;
      await api(
        {
          url,
          method: "GET",
          headers: {
            host: "localhost:5173",
            cookie: "stackpilot_session=" + session.token,
          },
        },
        {
          setHeader() {},
          writeHead(code) {
            status = code;
          },
          end(text) {
            body = JSON.parse(text);
          },
        },
        () => assert.fail("Unexpected next"),
      );
      assert.equal(status, 400);
      assert.equal(body.error, expected);
    }
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
