import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicFunnel, acceptanceKeys } from "./identity/public-funnel.js";
function fixture() {
  const host = "server.example.ts.net", values = new Map();
  const state = { calls: [], config: { TCP: {443: {HTTPS: true}, 8443: {HTTPS: true}}, Web: {
    [host + ":443"]: { Handlers: {"/": {Proxy: "http://127.0.0.1:19096"}} },
    [host + ":8443"]: { Handlers: {"/": {Proxy: "http://127.0.0.1:19080"}} },
  }}, failPort: null, broken: false, mfa: true, backup: true, locked: false };
  const plan = {id: "plan", rootId: "root"};
  const hub = { context: async () => ({plan}),
    mutate: async (_, fn) => { assert.equal(state.locked, false); state.locked = true;
      try { return await fn(); } finally { state.locked = false; } },
    engine: {current: () => ({plan}), store: {
      claim: () => {state.locked = true; return true;}, release: () => {state.locked = false;}},
      vault: {get: (k) => values.get(k), set: (k,v) => values.set(k,v)}} };
  const identity = {
    verify: async () => { if (state.broken) throw Error("down"); return {id: "identity",
      input: {hostname: host, gatewayPort: 19080, uid: 1000, gid: 1000}}; },
    inspectSecurity: async ({alreadyLocked}) => {
      assert.equal(alreadyLocked, state.locked);
      return {checks: [{name: "MFA-Regeln", state: state.mfa ? "ok" : "blocked", message: "MFA"},
        {name: "Offline-Wiederherstellung", state: "todo", message: "Persönlich"}]};
    },
  };
  const run = async (binary, args) => {
    assert.equal(binary, "tailscale");
    state.calls.push([...args]);
    if (args[1] === "status") return {ok: true, output: JSON.stringify(state.config)};
    const port = args.find((a) => a.startsWith("--https="))?.split("=")[1];
    if (state.failPort === port && args[0] === "funnel" && args.at(-1) !== "off") return {ok: false};
    const h = host + ":" + port;
    state.config.AllowFunnel ||= {};
    if (args.at(-1) === "off") {
      delete state.config.AllowFunnel[h];
      delete state.config.Web[h]; delete state.config.TCP[port];
    } else {
      state.config.Web[h] = {Handlers: {"/": {Proxy: args.at(-1)}}};
      state.config.TCP[port] = {HTTPS: true};
      state.config.AllowFunnel[h] = args[0] === "funnel";
    }
    return {ok: true};
  };
  const service = new PublicFunnel(hub, identity,
    {verify: async () => ({hostname: host, target: "http://127.0.0.1:19096"})},
    {plan: async () => ({configured: true, hostname: host, review: "sso"})},
    {inspect: async () => ({ready: true})}, {inspect: async () => ({baseUrl: "expected"})},
    {remote: {inspect: async () => ({hostname: host, tailscaleRunning: true,
      jellyfin: {remoteAccess: true, quickConnect: true, remoteAdmins: 0, viewers: 1, ssoReleaseMatches: true}})}},
    {list: () => state.backup ? [{restore: {status: "passed"}}] : []}, run);
  const body = async () => ({review: (await service.preview()).review, confirmation: "OK",
    acceptance: Object.fromEntries(acceptanceKeys.map((k) => [k,true]))});
  return {service, state, host, body, values};
}
test("Funnel publiziert nur zwei geprüfte Gateways, Login zuerst; Abschaltung erhält private Routen", async () => {
  const f = fixture(), body = await f.body();
  await f.service.apply(body);
  assert.deepEqual(f.state.calls.filter((c) => c[0] === "funnel").map((c) => c[3]), ["--https=8443", "--https=443"]);
  const p = await f.service.preview();
  assert.equal(p.complete, true); assert.equal(p.externallyVerified, false);
  f.state.broken = true;
  assert.equal((await f.service.preview()).canDisable, true);
  assert.equal((await f.service.disable({confirmation: "OK"})).ok, true);
  for (const port of [443, 8443]) {
    assert.notEqual(f.state.config.AllowFunnel[f.host + ":" + port], true);
    assert.ok(f.state.config.Web[f.host + ":" + port].Handlers["/"].Proxy);
  }
  assert.ok(f.state.calls.every((c) => !c.includes("reset") && !c.includes("sudo")));
});
test("Fehlende Abnahme, MFA, Sicherung und veraltete Vorschau verhindern die Freigabe", async () => {
  for (const condition of ["acceptance", "mfa", "backup", "changed"]) {
    const f = fixture(), body = await f.body();
    if (condition === "acceptance") body.acceptance.quickConnect = false;
    if (condition === "mfa") f.state.mfa = false;
    if (condition === "backup") f.state.backup = false;
    if (condition === "changed") f.state.config.ETag = "changed";
    await assert.rejects(f.service.apply(body));
    assert.equal(f.state.calls.filter((c) => c[0] === "funnel").length, 0);
  }
});
test("Teilweise fehlgeschlagene Aktivierung fällt auf private Routen zurück", async () => {
  const f = fixture(), body = await f.body();
  f.state.failPort = "443";
  await assert.rejects(f.service.apply(body), /privaten Zugriff/);
  assert.equal((await f.service.preview()).active, false);
  assert.equal((await f.service.preview()).ready, true);
});
test("Fremde öffentliche Routen werden nicht übernommen und bei Widerruf nicht überschrieben", async () => {
  const f = fixture(), body = await f.body();
  f.state.config.AllowFunnel = {[f.host + ":443"]: true};
  assert.equal((await f.service.preview()).ready, false);
  await assert.rejects(f.service.apply(body));
  delete f.state.config.AllowFunnel;
  await f.service.apply(await f.body());
  f.state.config.Web[f.host + ":443"].Handlers["/"].Proxy = "http://127.0.0.1:9999";
  assert.equal((await f.service.disable({confirmation: "OK"})).ok, false);
  assert.equal(f.state.config.Web[f.host + ":443"].Handlers["/"].Proxy, "http://127.0.0.1:9999");
});
test("Wiederkehrende Prüfung zieht eigene Freigaben bei nicht mehr bestätigter MFA zurück", async () => {
  const f = fixture();
  await f.service.apply(await f.body());
  await f.service.monitor();
  assert.equal((await f.service.preview()).complete, true);
  f.state.mfa = false;
  // Ein einzelner Fehlschlag (z. B. kurz nach einem Neustart) nimmt noch nichts zurück …
  await f.service.monitor();
  assert.equal((await f.service.preview()).active, true);
  // … erst der zweite in Folge.
  await f.service.monitor();
  assert.equal((await f.service.preview()).active, false);
  assert.equal(f.state.locked, false);
});

test("Ein vorübergehender Fehlschlag wird durch eine erfolgreiche Prüfung zurückgesetzt", async () => {
  const f = fixture();
  await f.service.apply(await f.body());
  f.state.mfa = false;
  await f.service.monitor();
  f.state.mfa = true;
  await f.service.monitor();
  f.state.mfa = false;
  await f.service.monitor();
  assert.equal((await f.service.preview()).active, true);
});
