import { test } from "node:test";
import assert from "node:assert/strict";
import { requestJourney } from "./request-journey.js";
test("100 Prozent Download ist noch keine bestätigte Verfügbarkeit", () => {
  const j = requestJourney("importing", 1);
  assert.equal(j.steps[4].state, "pending");
  assert.equal(j.steps[3].state, "current");
  assert.match(j.reason, /importieren/);
  assert.equal(requestJourney("available").steps[4].state, "done");
  assert.equal(requestJourney("unknown").problem, true);
});
