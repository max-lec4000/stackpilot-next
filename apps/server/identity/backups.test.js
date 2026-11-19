import { test } from "node:test";
import assert from "node:assert/strict";
import { IdentityBackups } from "./backups.js";

test("Nach dem Authentik-Start wird das Identitäts-Gateway neu geladen", async () => {
  const calls = [];
  const backups = new IdentityBackups({});
  await backups.startAuthentication(["compose", "-f", "/x/compose.json"], async (args) => { calls.push(args.slice(3)); return ""; });
  assert.deepEqual(calls, [["start", "server", "worker"], ["exec", "-T", "gateway", "nginx", "-s", "reload"]]);
});

test("Schlägt der Start fehl, wird das Gateway nicht angefasst", async () => {
  const calls = [];
  const backups = new IdentityBackups({});
  await assert.rejects(backups.startAuthentication(["compose"], async (args) => { calls.push(args[1]); throw Error("start fehlgeschlagen"); }), /start fehlgeschlagen/);
  assert.deepEqual(calls, ["start"]);
});
