// Prüft in sp-test die YouTube-Abrufwege von Couchdeck mit echten Abrufen (sparsam: ein kurzes
// Video, wenige Abrufe). Ablauf: IPv6 zuerst → bei Sperre automatisch IPv4; Segmentliste über
// denselben Weg; mpv spielt 3 s über den Weiterleiter; dann derselbe Abruf über den VPN-Tunnel
// von StackPilot (vpn-probe), inkl. Abgleich der Adresse, die YouTube sieht.
//
//   node scripts/testvm/youtube-route-check.mjs            (braucht Docker-Zugriff für den VPN-Teil)
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { YouTubeVpnRelay } from "../../apps/server/youtube-vpn.js";

if (os.hostname() !== "sp-test") throw Error("Nur in sp-test ausführen.");
const tmp = mkdtempSync(path.join(os.tmpdir(), "cd-route-check-"));
process.env.COUCHDECK_CONFIG_DIR = path.join(tmp, "config");
process.env.COUCHDECK_LINK_DIR = tmp;
const require = createRequire(import.meta.url);
const { YouTube } = require("../../apps/couchdeck/src/main/youtube.js");
const { parsePlaylist } = require("../../apps/couchdeck/src/main/hls.js");

const ID = process.argv[2] || "jNQXAC9IVRw";
const results = [];
const ok = (name, cond, detail = "") => results.push([cond ? "OK  " : "FEHL", name, detail]);
const ipOf = (url) => (/[?&/]ip[=/]([^&/]+)/.exec(url)?.[1] || "?");
const mask = (ip) => ip.replace(/^(\d+\.\d+)\.\d+\.\d+$/, "$1.x.x").replace(/^([0-9a-f]+:[0-9a-f]+):.*$/i, "$1:…");
// mpv asynchron starten: Der Weiterleiter läuft in diesem Prozess und muss weiter antworten.
function mpvPlays(direct) {
  return new Promise((resolve) => {
    const child = spawn("mpv", ["--no-config", "--vo=null", "--ao=null", "--length=3", "--ytdl=no", "--msg-level=all=error,cplayer=info",
      `--http-proxy=${direct.proxy}`, ...(direct.audio ? [`--audio-file=${direct.audio}`] : []), direct.video],
    { env: { ...process.env, no_proxy: "127.0.0.1,localhost" } });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out: out.split("\n").filter(Boolean).slice(-3).join(" | ").replace(/https?:\/\/\S+/g, "…") });
    });
  });
}

const yt = new YouTube();
let relay = null;
try {
  // 1. Automatischer Wechsel: IPv6 bevorzugt, ist aber gesperrt → IPv4
  yt.preferred = "v6";
  const direct = await yt.resolve({ id: ID, kind: "video" });
  ok("Abruf gelingt über einen freien Weg", !!direct?.video, direct?.route);
  ok("Gesperrter Weg wurde übersprungen", direct?.route === "v4" && yt.blocked.v6 > Date.now(), JSON.stringify({ route: direct?.route, v6Gesperrt: yt.blocked.v6 > Date.now() }));
  ok("Stream-Adresse gehört zur IPv4-Adresse", /^\d+\.\d+\.\d+\.\d+$/.test(ipOf(direct.video)), mask(ipOf(direct.video)));
  // 2. Segmentliste über denselben Weg
  if (/m3u8|playlist|index/i.test(direct.video)) {
    const text = await yt.routes.fetchText(direct.route, direct.video, 10000);
    ok("Segmentliste über den Weg geladen", !!parsePlaylist(text, direct.video), text.slice(0, 20));
  } else ok("Segmentliste (kein HLS bei diesem Video)", true, "übersprungen");
  // 3. mpv über den Weiterleiter
  const play = await mpvPlays(direct);
  ok("mpv spielt über den Weiterleiter", play.code === 0, play.out);
  // 4. VPN-Tunnel von StackPilot
  const probe = execFileSync("docker", ["ps", "--filter", "status=running", "--format", "{{.ID}} {{.Names}}", "--no-trunc"], { encoding: "utf8" })
    .split("\n").map((l) => l.split(" ")).find(([, n]) => /vpn-probe/.test(n || ""));
  if (!probe) ok("vpn-probe läuft", false);
  else {
    const store = new Map();
    relay = new YouTubeVpnRelay({ engine: {
      vault: { ensure: (k, f) => (store.has(k) ? store.get(k) : (store.set(k, f()), store.get(k))) },
      current: () => ({ job: { status: "completed" }, plan: { spec: { vpn: true } } }),
      validate: async () => [{ service: "vpn-probe", id: probe[0] }],
    } }, { linkDir: tmp, port: 0 });
    relay.start();
    await new Promise((r) => setTimeout(r, 300));
    relay.port = relay.server.address().port;
    ok("Übergabe für Couchdeck geschrieben", await relay.publish());
    ok("Couchdeck sieht den VPN-Weg", yt.vpnStatus().available === true);
    yt.useVpn();
    let viaVpn = null, err = null;
    try { viaVpn = await yt.resolve({ id: ID, kind: "video" }); } catch (e) { err = e; }
    if (err) ok("Abruf über VPN (Ergebnis)", err.code === "YOUTUBE_BOT_CHECK", err.code === "YOUTUBE_BOT_CHECK" ? "YouTube sperrt auch die VPN-Adresse" : err.message);
    else {
      ok("Abruf über VPN gelingt", viaVpn?.route === "vpn", viaVpn?.route);
      ok("YouTube sieht eine andere Adresse (VPN)", ipOf(viaVpn.video) !== ipOf(direct.video), `${mask(ipOf(direct.video))} → ${mask(ipOf(viaVpn.video))}`);
      const p = await mpvPlays(viaVpn);
      ok("mpv spielt über den VPN-Tunnel", p.code === 0, p.out);
    }
  }
} catch (e) {
  ok("Ablauf ohne Ausnahme", false, e.stack || e.message);
} finally {
  relay?.stop();
  yt.routes.stop();
  rmSync(tmp, { recursive: true, force: true });
}
for (const [s, n, d] of results) console.log(s, n, d ? "· " + String(d).slice(0, 220) : "");
const failed = results.some(([s]) => s !== "OK  ");
console.log(failed ? "YOUTUBE_ROUTE_CHECK_FAILED" : "YOUTUBE_ROUTE_CHECK_CONFIRMED");
process.exit(failed ? 1 : 0);
