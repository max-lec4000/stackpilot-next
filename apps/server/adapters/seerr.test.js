import { test } from "node:test";
import assert from "node:assert/strict";
import { SeerrAdapter, SEERR } from "./seerr.js";
import { writeAndConfirm } from "./confirm.js";

function fake(users) {
  const calls = [];
  const s = { additional: { seerr: async (route, options) => {
    calls.push([options?.method || "GET", route, options?.body]);
    if (route.startsWith("/user?")) {
      const skip = Number(/skip=(\d+)/.exec(route)[1]);
      return { results: users.slice(skip, skip + 100).map((u) => ({ ...u })) };
    }
    if (route === "/user/import-from-jellyfin") { users.push({ id: 99, jellyfinUserId: "AA-BB", permissions: 32 }); return []; }
    const id = Number(route.split("/")[2]);
    const u = users.find((x) => x.id === id);
    if (options?.method === "PUT") Object.assign(u, options.body);
    return { ...u };
  } } };
  return { s, calls };
}

test("Schreiben gilt erst nach bestätigtem Zurücklesen", async () => {
  let value = 1;
  assert.equal(await writeAndConfirm({ write: async () => { value = 2; }, read: async () => value, check: (v) => v === 2, message: "x" }), 2);
  await assert.rejects(writeAndConfirm({ write: async () => {}, read: async () => 1, check: (v) => v === 2, message: "nicht bestätigt" }), /nicht bestätigt/);
});

test("Seerr-Adapter: Konten seitenweise, Import mit normalisierter Jellyfin-Kennung", async () => {
  const users = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, jellyfinUserId: "x" + i, permissions: 32 }));
  const { s, calls } = fake(users);
  const seerr = new SeerrAdapter(s);
  assert.equal((await seerr.users()).length, 150);
  assert.deepEqual(calls.filter((c) => c[1].startsWith("/user?")).map((c) => c[1]), ["/user?take=100&skip=0", "/user?take=100&skip=100"]);
  const created = await seerr.importFromJellyfin("aa-bb");
  assert.deepEqual(calls.find((c) => c[1] === "/user/import-from-jellyfin")[2], { jellyfinUserIds: ["aabb"] });
  assert.deepEqual(created.map((u) => u.id), [99]);
});

test("Seerr-Adapter: Rechte setzen wird bestätigt, ungültige Konten abgelehnt", async () => {
  const users = [{ id: 3, username: "spv_max", jellyfinUserId: "abc", permissions: SEERR.REQUEST }];
  const { s, calls } = fake(users);
  const seerr = new SeerrAdapter(s);
  const saved = await seerr.setPermissions(users[0], SEERR.REQUEST | SEERR.AUTO_APPROVE);
  assert.equal(saved.permissions, 160);
  assert.deepEqual(calls.find((c) => c[0] === "PUT"), ["PUT", "/user/3", { username: "spv_max", permissions: 160 }]);
  await assert.rejects(seerr.user(0), /Ungültiges/);
  await assert.rejects(seerr.user("3"), /Ungültiges/);
  // Seerr übernimmt den Wert nicht → Fehler statt stiller Erfolg
  const stubborn = new SeerrAdapter({ additional: { seerr: async (route, o) => (o?.method === "PUT" ? {} : { id: 3, jellyfinUserId: "abc", permissions: 32 }) } });
  await assert.rejects(stubborn.setPermissions({ id: 3, jellyfinUserId: "abc" }, 160), /nicht bestätigt/);
});
