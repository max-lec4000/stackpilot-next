import test from "node:test";
import assert from "node:assert/strict";
import { rotateBazarrKey } from "./bazarr-key.js";

test("Schlüsselwechsel setzt nach einer verlorenen Antwort und ausgefallener Prüfung fort", async () => {
  const old = "old-key";
  let saved = { apiKey: old, password: "unchanged" };
  let active = old;
  let unavailable = false;
  let writes = 0;
  const services = {
    plan: { id: "plan" },
    vault: {
      get: () => structuredClone(saved),
      set: (_, value) => { saved = structuredClone(value); },
    },
    additional: {
      async bazarr(route, { headers, method, body }) {
        if (unavailable) throw Error("offline");
        if (headers["X-API-KEY"] !== active)
          throw Object.assign(Error("unauthorized"), { status: 401 });
        if (route === "/system/status") return {};
        assert.equal(method, "POST");
        active = body.get("settings-auth-apikey");
        writes++;
        unavailable = true;
        throw Error("response lost");
      },
    },
  };
  await assert.rejects(rotateBazarrKey(services), /antwortet nicht/);
  assert.equal(saved.apiKey, old);
  assert.equal(saved.pendingApiKey, active);
  unavailable = false;
  assert.deepEqual(await rotateBazarrKey(services), { ok: true });
  assert.equal(writes, 1);
  assert.notEqual(saved.apiKey, old);
  assert.deepEqual(saved, { apiKey: active, password: "unchanged" });
});
