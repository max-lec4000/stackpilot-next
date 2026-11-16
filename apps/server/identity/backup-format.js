import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scrypt as derive,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
const scrypt = promisify(derive),
  zip = promisify(gzip),
  unzip = promisify(gunzip);
const identityMagic = Buffer.from("STACKPILOT_IDENTITY_BACKUP_V1\n");
export const backupLimit = 128 * 1024 * 1024;
export const sha256 = (b) => createHash("sha256").update(b).digest("hex");
export function requirePassphrase(p) {
  if (typeof p !== "string" || p.length < 16 || Buffer.byteLength(p) > 1024)
    throw Error(
      "Eine eigene Sicherungspassphrase mit mindestens 16 Zeichen ist erforderlich. Sicher getrennt vom Server aufbewahren.",
    );
}
export async function encryptBackup(value, passphrase, magic = identityMagic) {
  requirePassphrase(passphrase);
  const plain = Buffer.from(JSON.stringify(value));
  if (plain.length > backupLimit)
    throw Error(
      "Sicherung überschreitet die unterstützte Größe von 128 MiB. Es wurde nichts ausgelassen.",
    );
  const salt = randomBytes(32),
    iv = randomBytes(12),
    header = Buffer.concat([magic, salt, iv]);
  const key = await scrypt(passphrase, salt, 32, {
    N: 131072,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
  });
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(header);
    return Buffer.concat([
      header,
      cipher.update(await zip(plain)),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
  } finally {
    key.fill(0);
    plain.fill(0);
  }
}
export async function decryptBackup(bytes, passphrase, magic = identityMagic) {
  requirePassphrase(passphrase);
  if (
    bytes.length > backupLimit ||
    bytes.length < magic.length + 60 ||
    !bytes.subarray(0, magic.length).equals(magic)
  )
    throw Error("Sicherungsformat ungültig.");
  const header = bytes.subarray(0, magic.length + 44),
    salt = bytes.subarray(magic.length, magic.length + 32),
    iv = bytes.subarray(magic.length + 32, magic.length + 44);
  const key = await scrypt(passphrase, salt, 32, {
    N: 131072,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
  });
  try {
    const cipher = createDecipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(header);
    cipher.setAuthTag(bytes.subarray(-16));
    const raw = await unzip(
      Buffer.concat([
        cipher.update(bytes.subarray(header.length, -16)),
        cipher.final(),
      ]),
      { maxOutputLength: backupLimit },
    );
    return JSON.parse(raw);
  } catch {
    throw Error(
      "Sicherung konnte nicht authentifiziert werden. Passphrase oder Datei ist falsch beziehungsweise beschädigt.",
    );
  } finally {
    key.fill(0);
  }
}
export function validateBackup(value, record) {
  if (
    value?.format !== 1 ||
    !value.record ||
    value.record.id !== record.id ||
    JSON.stringify(value.images) !== JSON.stringify(record.images) ||
    JSON.stringify(value.record.hashes) !== JSON.stringify(record.hashes) ||
    typeof value.database !== "string" ||
    value.database.length > 90 * 1024 * 1024 ||
    !Array.isArray(value.files) ||
    value.files.length > 10000
  )
    throw Error("Sicherung gehört nicht zur geprüften Identitätsinstallation.");
  const seen = new Set();
  let size = 0;
  for (const file of value.files) {
    if (
      typeof file.name !== "string" ||
      !/^(config|blueprints|secrets|data|media)\//.test(file.name) ||
      file.name.includes("\\") ||
      file.name.split("/").some((v) => !v || v === "." || v === "..") ||
      seen.has(file.name) ||
      typeof file.data !== "string" ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw Error("Unsicherer Sicherungspfad oder Dateieintrag.");
    seen.add(file.name);
    const bytes = Buffer.from(file.data, "base64");
    size += bytes.length;
    if (size > backupLimit || sha256(bytes) !== file.sha256)
      throw Error("Sicherungsdatei beschädigt.");
  }
  for (const [name, hash] of Object.entries(value.record.hashes || {})) {
    if (name === "compose.json") continue;
    const file = value.files.find((v) => v.name === name);
    if (!file || file.sha256 !== hash)
      throw Error("Private Schutzkonfiguration fehlt oder wurde geändert.");
  }
  return value;
}
