import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { offerMaintenanceSecret, receiveMaintenanceSecret } from "./maintenance-secret.js";
test("Passphrase wird nur über einen privaten Einmalkanal nach Freigabe übergeben", async () => {
  const id = randomUUID(), phrase = "Fixture-only-backup-key-2026!";
  let receive, address;
  const channel = await offerMaintenanceSecret(id, phrase, async (socket) => {
    address = socket;
    assert.equal((await stat(socket)).mode & 0o777, 0o600);
    receive = receiveMaintenanceSecret(id, socket);
  });
  await assert.rejects(() => stat(address), { code: "ENOENT" });
  channel.commit();
  assert.equal(await receive, phrase);
});
test("Abgebrochene Freigabe startet keine Arbeit mit der übergebenen Passphrase", async () => {
  const id = randomUUID(); let receive;
  const channel = await offerMaintenanceSecret(id, "Fixture-aborted-backup-key", async (socket) => { receive = receiveMaintenanceSecret(id, socket); receive.catch(() => {}); });
  channel.abort();
  await assert.rejects(() => receive, /nicht abgeschlossen/);
});
