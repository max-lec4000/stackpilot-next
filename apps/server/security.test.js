import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, unlink, stat } from "node:fs/promises";
import os from "node:os";
import { StateStore } from "./state.js";
import { Auth, sessionCookie } from "./auth.js";
import { Vault } from "./vault.js";
test("Administrator benötigt lokalen Setupcode, Sitzung überlebt Neustart und Logout widerruft sie", async () => {
  const dir = await mkdtemp(os.tmpdir() + "/sp-auth-");
  let store = new StateStore(dir);
  try {
    let auth = new Auth(store);
    const code = await readFile(auth.bootstrapFile, "utf8");
    await assert.rejects(auth.setup("admin", "fixture-password-123", "wrong"));
    const session = await auth.setup("admin", "fixture-password-123", code);
    assert.ok(await auth.verify("fixture-password-123"));
    assert.equal(await auth.verify("wrong"), false);
    assert.ok(sessionCookie(session.token).includes("HttpOnly"));
    assert.equal(
      auth.current("stackpilot_session=" + session.token).username,
      "admin",
    );
    await assert.rejects(auth.setup("hacker", "fixture-password-123", code));
    store.close();
    store = new StateStore(dir);
    auth = new Auth(store);
    assert.ok(auth.current("stackpilot_session=" + session.token));
    auth.logout(auth.current("stackpilot_session=" + session.token));
    assert.equal(auth.current("stackpilot_session=" + session.token), null);
  } finally {
    store.close();
    await rm(dir, { recursive: true });
  }
});
test("Tresor verschlüsselt Werte, bindet sie an den Namen und erzeugt bei verlorenem Schlüssel keinen Ersatz", async () => {
  const dir = await mkdtemp(os.tmpdir() + "/sp-vault-");
  const store = new StateStore(dir);
  try {
    let vault = new Vault(store);
    vault.set("service:fixture", { password: "fixture-only-secret" });
    assert.equal(vault.get("service:fixture").password, "fixture-only-secret");
    assert.ok(
      !Buffer.from(
        store.db.prepare("SELECT ciphertext FROM vault").get().ciphertext,
      ).includes(Buffer.from("fixture-only-secret")),
    );
    assert.equal((await stat(dir + "/master.key")).mode & 0o777, 0o600);
    store.db.prepare("UPDATE vault SET name='service:other'").run();
    assert.throws(() => vault.get("service:other"));
    await unlink(dir + "/master.key");
    assert.throws(() => new Vault(store));
  } finally {
    store.close();
    await rm(dir, { recursive: true });
  }
});
test("Anmeldung und Passwortanzeige teilen die dauerhafte Sperre je Quelladresse", async () => {
  const dir = await mkdtemp(os.tmpdir() + "/sp-auth-rate-");
  const store = new StateStore(dir);
  try {
    const auth = new Auth(store);
    await auth.setup(
      "admin",
      "fixture-password-123",
      await readFile(auth.bootstrapFile, "utf8"),
    );
    const first = "192.0.2.20";
    const second = "192.0.2.21";
    for (let n = 0; n < 5; n++)
      await assert.rejects(auth.login("admin", "wrong", first), /fehlgeschlagen/);

    const reopened = new Auth(store);
    await assert.rejects(
      reopened.reauthenticate("fixture-password-123", "::ffff:c000:214"),
      /15 Minuten/,
    );
    assert.equal(await reopened.reauthenticate("fixture-password-123", second), true);
    await assert.rejects(
      reopened.login("admin", "fixture-password-123", first),
      /15 Minuten/,
    );
    store.db.prepare("UPDATE auth_source_rate SET expires=0").run();
    assert.equal(await reopened.reauthenticate("fixture-password-123", first), true);
  } finally {
    store.close();
    await rm(dir, { recursive: true });
  }
});
