import {
  randomBytes,
  createHash,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { readFileSync, openSync, writeFileSync, closeSync } from "node:fs";
import path from "node:path";
import { isIP } from "node:net";
const scrypt = promisify(scryptCallback);
const passwordParams = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const legacyParams = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const digest = (value) => createHash("sha256").update(value).digest("hex");
const attemptLimit = 5;
const attemptWindow = 15 * 60_000;

function sourceKey(address) {
  const withoutZone = address?.split("%")[0];
  const version = isIP(withoutZone || "");
  if (version === 4) return digest(withoutZone);
  if (version === 6) {
    const canonical = new URL(`http://[${withoutZone}]/`).hostname;
    const mapped = canonical.match(/^\[::ffff:([a-f\d]+):([a-f\d]+)\]$/);
    if (mapped) {
      const high = parseInt(mapped[1], 16);
      const low = parseInt(mapped[2], 16);
      return digest([high >> 8, high & 255, low >> 8, low & 255].join("."));
    }
    return digest(canonical);
  }
  return digest("unknown");
}

export class Auth {
  constructor(store) {
    this.store = store;
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS administrator(id INTEGER PRIMARY KEY CHECK(id=1),username TEXT NOT NULL,salt BLOB NOT NULL,hash BLOB NOT NULL);CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL);",
    );
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS auth_source_rate(source TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS auth_source_rate_expires ON auth_source_rate(expires);",
    );
    if (
      !store.db
        .prepare("PRAGMA table_info(administrator)")
        .all()
        .some((column) => column.name === "params")
    )
      store.db.exec("ALTER TABLE administrator ADD COLUMN params TEXT");
    this.bootstrapFile = path.join(store.directory, "bootstrap-token");
    if (!this.configured()) {
      try {
        const fd = openSync(this.bootstrapFile, "wx", 0o600);
        try {
          writeFileSync(fd, randomBytes(24).toString("hex"));
        } finally {
          closeSync(fd);
        }
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
      }
    }
  }
  configured() {
    return !!this.store.db
      .prepare("SELECT id FROM administrator WHERE id=1")
      .get();
  }
  async setup(username, password, code) {
    if (this.configured())
      throw new Error("Administrator ist bereits eingerichtet.");
    const token = readFileSync(this.bootstrapFile, "utf8").trim();
    if (typeof code !== "string" || !safeEqual(token, code))
      throw new Error(
        "Setupcode ist ungültig. Er steht lokal in .stackpilot/bootstrap-token.",
      );
    if (
      typeof username !== "string" ||
      !/^[a-zA-Z][a-zA-Z0-9_-]{2,31}$/.test(username) ||
      typeof password !== "string" ||
      password.length < 12 ||
      password.length > 256
    )
      throw new Error(
        "Benutzername benötigt 3–32 Zeichen; Passwort mindestens 12 und höchstens 256 Zeichen.",
      );
    const salt = randomBytes(16);
    const hash = await scrypt(password, salt, 64, passwordParams);
    this.store.transaction(() => {
      if (this.configured())
        throw new Error("Administrator ist bereits eingerichtet.");
      this.store.db
        .prepare(
          "INSERT INTO administrator(id,username,salt,hash,params) VALUES(1,?,?,?,?)",
        )
        .run(username, salt, hash, JSON.stringify(passwordParams));
    });
    return this.session();
  }
  async verify(password) {
    const admin = this.store.db
      .prepare("SELECT * FROM administrator WHERE id=1")
      .get();
    if (!admin || typeof password !== "string" || password.length > 256)
      return false;
    const params = admin.params ? JSON.parse(admin.params) : legacyParams;
    const hash = await scrypt(password, admin.salt, 64, params);
    return timingSafeEqual(hash, admin.hash);
  }
  async checkCredentials(username, password, remoteAddress) {
    const source = sourceKey(remoteAddress);
    const now = Date.now();
    // Vor scrypt reservieren, damit gleichzeitige Anfragen das Limit einhalten.
    const reservation = this.store.transaction(() => {
      this.store.db.prepare("DELETE FROM auth_source_rate WHERE expires<=?").run(now);
      return this.store.db.prepare(
        `INSERT INTO auth_source_rate(source, attempts, expires) VALUES(?, 1, ?)
         ON CONFLICT(source) DO UPDATE SET attempts=attempts+1, expires=excluded.expires
         WHERE attempts<?`,
      ).run(source, now + attemptWindow, attemptLimit).changes;
    });
    if (!reservation)
      throw new Error(
        "Zu viele Anmeldeversuche von dieser Adresse. Bitte in 15 Minuten erneut versuchen.",
      );

    const admin = this.store.db
      .prepare("SELECT username FROM administrator WHERE id=1")
      .get();
    const valid = await this.verify(password);
    if (!admin || username !== admin.username || !valid)
      throw new Error("Anmeldung fehlgeschlagen.");

    this.store.db
      .prepare("DELETE FROM auth_source_rate WHERE source=?")
      .run(source);
    return true;
  }
  async login(username, password, remoteAddress) {
    await this.checkCredentials(username, password, remoteAddress);
    return this.session();
  }
  async reauthenticate(password, remoteAddress) {
    const name = this.store.db
      .prepare("SELECT username FROM administrator WHERE id=1")
      .get()?.username;
    return this.checkCredentials(name, password, remoteAddress);
  }
  session() {
    const token = randomBytes(32).toString("hex");
    const csrf = randomBytes(24).toString("hex");
    const expires = Date.now() + 12 * 3600000;
    this.store.db
      .prepare("DELETE FROM sessions WHERE expires<?")
      .run(Date.now());
    this.store.db
      .prepare("INSERT INTO sessions VALUES(?,?,?)")
      .run(digest(token), csrf, expires);
    return { token, csrf, expires };
  }
  current(cookie) {
    const token = cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("stackpilot_session="))
      ?.slice("stackpilot_session=".length);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const row = this.store.db
      .prepare("SELECT csrf,expires FROM sessions WHERE hash=? AND expires>?")
      .get(digest(token), Date.now());
    if (!row) return null;
    return {
      ...row,
      username: this.store.db
        .prepare("SELECT username FROM administrator WHERE id=1")
        .get().username,
      hash: digest(token),
    };
  }
  logout(session) {
    if (session)
      this.store.db
        .prepare("DELETE FROM sessions WHERE hash=?")
        .run(session.hash);
  }
}
export function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export const sessionCookie = (token) =>
  `stackpilot_session=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=43200`;
