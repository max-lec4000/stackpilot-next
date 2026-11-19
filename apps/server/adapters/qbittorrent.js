// App-Adapter für qBittorrent: Downloads anhalten, fortsetzen, entfernen, Priorität ändern.
// Anhalten/Fortsetzen/Entfernen gelten erst, wenn qBittorrent den Zustand bestätigt
// (kurzes Nachfragen, weil qBittorrent Änderungen leicht verzögert übernimmt).
import { userFacing } from "./confirm.js";

const stopped = (t) => /^(paused|stopped)/i.test(t?.state || "");
const PRIORITY = { up: "increasePrio", down: "decreasePrio", first: "topPrio", last: "bottomPrio" };

export class QbitAdapter {
  constructor(s, { attempts = 6, delay = 500 } = {}) {
    this.call = (route, body) => s.qbit(route, body);
    this.attempts = attempts;
    this.delay = delay;
  }
  async torrents() { return this.call("/torrents/info"); }
  async find(hash) {
    const want = String(hash).toLowerCase();
    return (await this.torrents()).find((t) => t.hash?.toLowerCase() === want) || null;
  }
  async confirm(hash, check) {
    for (let i = 0; i < this.attempts; i++) {
      if (check(await this.find(hash))) return;
      await new Promise((r) => setTimeout(r, this.delay));
    }
    throw userFacing("qBittorrent hat die Aktion nicht bestätigt. Liste neu laden und erneut versuchen.");
  }
  async stop(hash) {
    await this.call("/torrents/stop", { hashes: hash });
    await this.confirm(hash, (t) => !t || stopped(t));
  }
  async start(hash) {
    await this.call("/torrents/start", { hashes: hash });
    await this.confirm(hash, (t) => !!t && !stopped(t));
  }
  async remove(hash, deleteFiles) {
    await this.call("/torrents/delete", { hashes: hash, deleteFiles: deleteFiles ? "true" : "false" });
    await this.confirm(hash, (t) => !t);
  }
  async priority(hash, direction) {
    if (!Object.hasOwn(PRIORITY, direction)) throw userFacing("Ungültige Downloadpriorität.");
    await this.call("/torrents/" + PRIORITY[direction], { hashes: hash });
  }
}

export const qbitAdapter = (s, options) => new QbitAdapter(s, options);
