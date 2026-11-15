import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import {
  readFileSync,
  openSync,
  writeFileSync,
  closeSync,
  chmodSync,
} from "node:fs";
import path from "node:path";
export class Vault {
  constructor(store) {
    this.store = store;
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS vault(name TEXT PRIMARY KEY, nonce BLOB NOT NULL, ciphertext BLOB NOT NULL, tag BLOB NOT NULL)",
    );
    const file = path.join(store.directory, "master.key");
    try {
      this.key = readFileSync(file);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      if (store.db.prepare("SELECT COUNT(*) AS count FROM vault").get().count)
        throw new Error(
          "Tresorschlüssel fehlt. Gesicherten Hauptschlüssel wiederherstellen; kein neuer Schlüssel wurde erzeugt.",
        );
      try {
        const fd = openSync(file, "wx", 0o600);
        try {
          writeFileSync(fd, randomBytes(32));
        } finally {
          closeSync(fd);
        }
      } catch (err) {
        if (err.code !== "EEXIST") throw err;
      }
      this.key = readFileSync(file);
    }
    if (this.key.length !== 32)
      throw new Error("Tresorschlüssel ist beschädigt.");
    chmodSync(file, 0o600);
  }
  set(name, value) {
    if (!/^[a-z0-9:_-]{1,100}$/.test(name))
      throw new Error("Ungültiger Geheimnisname.");
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from("stackpilot-v1:" + name));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    this.store.db
      .prepare(
        "INSERT INTO vault VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET nonce=excluded.nonce,ciphertext=excluded.ciphertext,tag=excluded.tag",
      )
      .run(name, nonce, ciphertext, cipher.getAuthTag());
  }
  get(name) {
    const row = this.store.db
      .prepare("SELECT nonce,ciphertext,tag FROM vault WHERE name=?")
      .get(name);
    if (!row) return null;
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, row.nonce);
      decipher.setAAD(Buffer.from("stackpilot-v1:" + name));
      decipher.setAuthTag(row.tag);
      return JSON.parse(
        Buffer.concat([
          decipher.update(row.ciphertext),
          decipher.final(),
        ]).toString("utf8"),
      );
    } catch {
      throw new Error(
        "Geheimnis konnte nicht entschlüsselt werden. Hauptschlüssel und Datenbank prüfen.",
      );
    }
  }
  ensure(name, generate) {
    let value = this.get(name);
    if (!value) {
      value = generate();
      this.set(name, value);
    }
    return value;
  }
}
