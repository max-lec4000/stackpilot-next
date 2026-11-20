import { test } from "node:test";
import assert from "node:assert/strict";
import { DownloadIssues, causeOf, isProblem, issueOf } from "./download-issues.js";

const plan = { id: "p", spec: { selected: ["Radarr", "Sonarr", "qBittorrent"] } };
const row = (over = {}) => ({
  id: 11, downloadId: "ABC", title: "Film.2024.1080p", size: 1000, sizeleft: 0, status: "completed",
  trackedDownloadStatus: "warning", trackedDownloadState: "importPending", movie: { title: "Ein Film" },
  statusMessages: [{ title: "Film.2024.1080p", messages: ["No files found are eligible for import in /data/torrents/film"] }],
  ...over,
});

test("Ursachen in Alltagssprache", () => {
  assert.equal(causeOf({}, ["The download is stalled with no connections"]).cause, "Download hängt – keine Quellen");
  assert.equal(causeOf({}, ["Sample file"]).cause, "Nur ein Beispielvideo");
  assert.equal(causeOf({}, ["Found archive file, might need to be extracted"]).cause, "Gepackte Dateien");
  assert.equal(causeOf({}, ["Not an upgrade for existing movie file(s)"]).cause, "Keine Verbesserung");
  assert.equal(causeOf({}, ["No files found are eligible for import"]).cause, "Keine importierbaren Dateien");
  assert.equal(causeOf({}, ["Found matching series via grab history, but release was matched to series by ID"]).cause, "Titel nicht eindeutig zugeordnet");
  assert.equal(causeOf({}, ["Access to the path is denied"]).cause, "Keine Schreibrechte");
  assert.equal(causeOf({ trackedDownloadState: "importBlocked" }, []).cause, "Import blockiert");
  assert.equal(causeOf({ status: "failed" }, []).cause, "Download fehlgeschlagen");
});

test("Problem erkennen und ohne Adressen/Schlüssel darstellen", () => {
  assert.equal(isProblem(row()), true);
  assert.equal(isProblem(row({ trackedDownloadStatus: "ok", trackedDownloadState: "downloading" })), false);
  assert.equal(isProblem(row({ trackedDownloadStatus: "ok", trackedDownloadState: "importBlocked" })), true);
  const i = issueOf(row({ statusMessages: [{ title: "x", messages: ["Fehler bei http://10.0.0.5:7878/api?apikey=GEHEIM123 mit GEHEIM123"] }] }), "Radarr", plan, ["GEHEIM123"]);
  assert.equal(i.title, "Ein Film");
  assert.equal(i.kind, "movie");
  assert.equal(i.progress, 1);
  assert.ok(!i.messages.join(" ").includes("GEHEIM123"), "Schlüssel ausgeblendet");
  assert.ok(!i.messages.join(" ").includes("10.0.0.5"), "Adresse ausgeblendet");
  assert.match(i.id, /^[a-f0-9]{32}$/);
  const tv = issueOf(row({ movie: undefined, series: { title: "Eine Serie" }, episode: { seasonNumber: 2, episodeNumber: 5 } }), "Sonarr", plan);
  assert.equal(tv.title, "Eine Serie · S02E05");
});

function setup(queue, { vpn = true } = {}) {
  const calls = [];
  const s = {
    arr: async (service, route, options = {}) => {
      calls.push([service, options.method || "GET", route]);
      if (route.startsWith("/queue?")) return { records: queue[service] || [], totalRecords: (queue[service] || []).length };
      if (options.method === "DELETE") { const id = Number(route.match(/^\/queue\/(\d+)/)[1]); queue[service] = queue[service].filter((r) => r.id !== id); return null; }
      return {};
    },
  };
  const hub = {
    engine: { current: () => ({ job: { status: "completed" }, plan }) },
    context: async () => ({ s, plan }),
    mutate: async (_n, fn) => fn({ s, plan }),
    requireVpn: async () => { if (!vpn) throw Error("Downloads gesperrt: zuerst Mullvad verbinden und prüfen."); },
  };
  return { issues: new DownloadIssues(hub), calls, queue };
}

test("Liste, erneut prüfen, anderen Treffer suchen", async () => {
  const { issues, calls, queue } = setup({ Radarr: [row(), row({ id: 12, downloadId: "DEF", trackedDownloadStatus: "ok", trackedDownloadState: "downloading" })], Sonarr: [] });
  const list = await issues.list();
  assert.equal(list.total, 1);
  const [issue] = list.issues;
  assert.equal(issue.cause, "Keine importierbaren Dateien");
  const retry = await issues.act({ action: "retry" });
  assert.ok(retry.ok);
  assert.deepEqual(calls.filter(([, m, r]) => m === "POST" && r === "/command").map(([s]) => s).sort(), ["Radarr", "Sonarr"]);
  await assert.rejects(issues.act({ action: "replace", id: issue.id }), /mit OK/);
  await assert.rejects(issues.act({ action: "replace", id: "x", confirmation: "OK" }), /Ungültige Auswahl/);
  const done = await issues.act({ action: "replace", id: issue.id, confirmation: "OK" });
  assert.match(done.message, /Ein Film.*sucht automatisch nach Ersatz/);
  assert.ok(calls.some(([s, m, r]) => s === "Radarr" && m === "DELETE" && r === "/queue/11?removeFromClient=true&blocklist=true&skipRedownload=false"));
  assert.equal(queue.Radarr.length, 1);
  await assert.rejects(issues.act({ action: "replace", id: issue.id, confirmation: "OK" }), /nicht mehr in der Warteschlange/);
});

test("Anderen Treffer suchen nur mit VPN und nur für echte Probleme", async () => {
  const blocked = setup({ Radarr: [row()] }, { vpn: false });
  const [issue] = (await blocked.issues.list()).issues;
  await assert.rejects(blocked.issues.act({ action: "replace", id: issue.id, confirmation: "OK" }), /Mullvad/);
  assert.ok(!blocked.calls.some(([, m]) => m === "DELETE"));
  const healed = setup({ Radarr: [row()] });
  const [again] = (await healed.issues.list()).issues;
  healed.queue.Radarr[0].trackedDownloadStatus = "ok";
  healed.queue.Radarr[0].trackedDownloadState = "downloading";
  await assert.rejects(healed.issues.act({ action: "replace", id: again.id, confirmation: "OK" }), /läuft wieder normal/);
});
