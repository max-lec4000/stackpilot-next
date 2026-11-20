import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestLifecycle } from "./request-lifecycle.js";
import { requesterName } from "./media-hub.js";

// Seerr-Attrappe: Anfragen nach ID, Status 1 = wartet, 2 = freigegeben, 3 = abgelehnt
function setup(requests, { admin = true } = {}) {
  const calls = [], saved = [];
  const seerr = async (path, options = {}) => {
    calls.push([options.method || "GET", path]);
    if (path === "/auth/me") return { id: 1, permissions: admin ? 2 : 0 };
    const m = path.match(/^\/request\/(\d+)(?:\/(decline|approve))?$/);
    const r = m && requests[m[1]];
    if (!r) throw Error("Seerr: Anfrage fehlt (HTTP 404).");
    if (m[2] === "decline") r.status = 3;
    return structuredClone(r);
  };
  const plan = { id: "p" };
  const hub = { mutate: async (_names, fn) => fn({ s: { additional: { seerr } }, plan }) };
  const lifecycle = new RequestLifecycle(hub, {}, { put: (_plan, id, data) => saved.push([id, data]) });
  return { lifecycle, calls, saved };
}
const movie = (status) => ({ status, createdAt: "2026-11-20T08:00:00.000Z", media: { mediaType: "movie", tmdbId: 603 } });

test("Anfrage ablehnen: nur wartende, mit OK, Begründung bleibt in StackPilot", async () => {
  const { lifecycle, calls, saved } = setup({ 7: movie(1), 8: movie(2) });
  await assert.rejects(lifecycle.decline({ requestId: 7 }), /mit OK/);
  const result = await lifecycle.decline({ requestId: 7, confirmation: "OK", reason: "  Gibt es schon\u0007 auf DVD  " });
  assert.deepEqual(result, { ok: true, status: 3 });
  assert.ok(calls.some(([m, p]) => m === "POST" && p === "/request/7/decline"));
  assert.equal(saved.length, 1);
  assert.equal(saved[0][0], 7);
  assert.equal(saved[0][1].decision.action, "declined");
  assert.equal(saved[0][1].decision.reason, "Gibt es schon auf DVD");
  assert.equal(saved[0][1].mediaId, 603);
  await assert.rejects(lifecycle.decline({ requestId: 8, confirmation: "OK" }), /wartet nicht mehr/);
  assert.ok(!calls.some(([m, p]) => m === "POST" && p === "/request/8/decline"));
  const long = await setup({ 9: movie(1) }).lifecycle.decline({ requestId: 9, confirmation: "OK", reason: "x".repeat(500) });
  assert.equal(long.status, 3);
});

test("Anfrage ablehnen: Seerr-Dienstkonto braucht Verwaltungsrecht", async () => {
  const { lifecycle, calls } = setup({ 7: movie(1) }, { admin: false });
  await assert.rejects(lifecycle.decline({ requestId: 7, confirmation: "OK" }), /darf keine Anfragen ablehnen/);
  assert.ok(!calls.some(([m]) => m === "POST"));
});

test("Sammelaktion: Ergebnis je Anfrage, Grenzen und OK", async () => {
  const { lifecycle } = setup({ 1: movie(1), 2: movie(2), 3: movie(1) });
  await assert.rejects(lifecycle.batch({ action: "decline", requestIds: [1] }), /Mit OK/);
  await assert.rejects(lifecycle.batch({ action: "loeschen", requestIds: [1], confirmation: "OK" }), /Unbekannte/);
  await assert.rejects(lifecycle.batch({ action: "decline", requestIds: [], confirmation: "OK" }), /1 bis 25/);
  await assert.rejects(lifecycle.batch({ action: "decline", requestIds: Array.from({ length: 26 }, (_, i) => i + 1), confirmation: "OK" }), /1 bis 25/);
  await assert.rejects(lifecycle.batch({ action: "decline", requestIds: ["x"], confirmation: "OK" }), /Ungültige ID/);
  const r = await lifecycle.batch({ action: "decline", requestIds: [1, 2, 3, 3], reason: "zu groß", confirmation: "OK" });
  assert.equal(r.done, 2);
  assert.equal(r.failed, 1);
  assert.deepEqual(r.results.map((x) => [x.requestId, x.ok]), [[1, true], [2, false], [3, true]]);
  assert.match(r.results[1].error, /wartet nicht mehr/);
  // Freigeben geht über approve(): hier nur prüfen, dass jede ID einzeln läuft
  const seen = [];
  lifecycle.approve = async ({ requestId }) => { seen.push(requestId); if (requestId === 2) throw Error("VPN fehlt"); };
  const a = await lifecycle.batch({ action: "approve", requestIds: [1, 2], confirmation: "OK" });
  assert.deepEqual(seen, [1, 2]);
  assert.deepEqual([a.done, a.failed], [1, 1]);
});

test("Name der anfragenden Person ohne E-Mail-Adresse", () => {
  assert.equal(requesterName({ jellyfinUsername: "familie", displayName: "Familie" }), "familie");
  assert.equal(requesterName({ displayName: "person@example.org", email: "person@example.org" }), null);
  assert.equal(requesterName({ username: "  max  " }), "max");
  assert.equal(requesterName({ jellyfinUsername: "spv_familie" }), "familie");
  assert.equal(requesterName(null), null);
});
