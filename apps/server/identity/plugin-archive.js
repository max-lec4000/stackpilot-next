import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { releases } from "./config.js";
export const ssoFiles = [
  "meta.json",
  "SSO-Auth.dll",
  "Duende.IdentityModel.dll",
  "Duende.IdentityModel.OidcClient.dll",
];
const limit = 8 * 1024 * 1024;
export function unpackSsoArchive(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length > limit ||
    bytes.length < 22 ||
    createHash("sha256").update(bytes).digest("hex") !==
      releases.ssoPlugin.sha256
  )
    throw Error(
      "Offizielles SSO-Archiv stimmt nicht mit dem festgelegten SHA-256 überein.",
    );
  // Parse only the four regular, bounded release entries. Never extract paths from ZIP.
  const end = bytes.length - 22;
  if (
    bytes.readUInt32LE(end) !== 0x06054b50 ||
    bytes.readUInt16LE(end + 4) ||
    bytes.readUInt16LE(end + 6) ||
    bytes.readUInt16LE(end + 20) ||
    bytes.readUInt16LE(end + 8) !== 4 ||
    bytes.readUInt16LE(end + 10) !== 4
  )
    throw Error("Nicht unterstütztes SSO-Archivformat.");
  let pos = bytes.readUInt32LE(end + 16);
  if (pos + bytes.readUInt32LE(end + 12) !== end)
    throw Error("Ungültiger ZIP-Index.");
  const files = {};
  for (let i = 0; i < 4; i++) {
    if (pos + 46 > end || bytes.readUInt32LE(pos) !== 0x02014b50)
      throw Error("Ungültiger ZIP-Eintrag.");
    const flags = bytes.readUInt16LE(pos + 8),
      method = bytes.readUInt16LE(pos + 10),
      packed = bytes.readUInt32LE(pos + 20),
      size = bytes.readUInt32LE(pos + 24),
      n = bytes.readUInt16LE(pos + 28),
      extra = bytes.readUInt16LE(pos + 30),
      comment = bytes.readUInt16LE(pos + 32),
      local = bytes.readUInt32LE(pos + 42);
    const name = bytes.subarray(pos + 46, pos + 46 + n).toString("utf8");
    if (
      !ssoFiles.includes(name) ||
      files[name] ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      packed > limit ||
      size > limit ||
      local + 30 > bytes.length ||
      bytes.readUInt32LE(local) !== 0x04034b50
    )
      throw Error("Unerwartete SSO-Datei.");
    const start =
      local +
      30 +
      bytes.readUInt16LE(local + 26) +
      bytes.readUInt16LE(local + 28);
    if (start + packed > bytes.readUInt32LE(end + 16))
      throw Error("Ungültiger ZIP-Datenbereich.");
    const raw = bytes.subarray(start, start + packed),
      data =
        method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: limit });
    if (data.length !== size) throw Error("Ungültige SSO-Dateigröße.");
    files[name] = data;
    pos += 46 + n + extra + comment;
  }
  if (pos !== end || Object.keys(files).length !== 4)
    throw Error("Unvollständiges SSO-Archiv.");
  const meta = JSON.parse(files["meta.json"].toString("utf8"));
  if (
    String(meta.version) !== releases.ssoPlugin.version ||
    String(meta.guid).toLowerCase() !== releases.ssoPlugin.id
  )
    throw Error("SSO-Metadaten weichen vom geprüften Release ab.");
  return files;
}
export async function downloadSsoArchive() {
  let url = releases.ssoPlugin.packageUrl;
  for (let redirects = 0; redirects < 5; redirects++) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      !["github.com", "release-assets.githubusercontent.com"].includes(
        parsed.hostname,
      )
    )
      throw Error("Unerwartetes SSO-Downloadziel.");
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(90000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw Error("SSO-Download ohne Weiterleitungsziel.");
      url = new URL(location, url).href;
      continue;
    }
    if (
      !response.ok ||
      Number(response.headers.get("content-length")) > limit
    ) {
      await response.body?.cancel();
      throw Error("Offizielles SSO-Archiv konnte nicht geladen werden.");
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit)
        throw Error("SSO-Archiv überschreitet die Größenbegrenzung.");
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    unpackSsoArchive(bytes);
    return bytes;
  }
  throw Error("Zu viele SSO-Downloadweiterleitungen.");
}
