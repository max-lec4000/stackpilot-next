import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { StateStore } from "./state.js";
import { reportConsent, setReportConsent } from "./dev-report-consent.js";
import { developmentUploadStatus } from "./development-report.js";
test("Entwicklungsupload benötigt je Installation eine lokale Auswahl und kann wieder deaktiviert werden", async () => {
  const dir = await mkdtemp("/tmp/sp-report-consent-");
  let a, b;
  try {
    a = new StateStore(dir + "/a");
    b = new StateStore(dir + "/b");
    assert.equal(reportConsent(a), false);
    assert.equal(reportConsent(b), false);
    assert.equal(reportConsent(), false);
    const enabled = setReportConsent(a, true);
    assert.equal(enabled.enabled, true);
    assert.equal(reportConsent(a), true);
    assert.equal(reportConsent(b), false);
    a.close();
    a = new StateStore(dir + "/a");
    assert.equal(reportConsent(a), true);
    setReportConsent(a, false);
    assert.equal(reportConsent(a), false);
    await assert.rejects(
      async () => setReportConsent(a, "true"),
      /ausdrücklich/,
    );
    await assert.rejects(
      async () => setReportConsent(null, true),
      /nicht verfügbar/,
    );
  } finally {
    a?.close();
    b?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("Lokale Auswahl aktiviert keinen Upload ohne enge Repository-Policy", async () => {
  const dir = await mkdtemp("/tmp/sp-report-policy-");
  const store = new StateStore(dir + "/state");
  try {
    setReportConsent(store, true);
    const state = await developmentUploadStatus(store, { directory: dir });
    assert.equal(state.consented, true);
    assert.equal(state.policyEnabled, false);
    assert.equal(state.enabled, false);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
