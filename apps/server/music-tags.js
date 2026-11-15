const clean = (text) => text.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 300);
const synchsafe = (bytes) => bytes.some((byte) => byte > 127) ? -1 : bytes.reduce((size, byte) => size * 128 + byte, 0);
async function read(file, position, length) {
  if (!Number.isSafeInteger(length) || length < 0 || length > 65536) throw Error("Metadatenblock zu groß.");
  const buffer = Buffer.alloc(length);
  const result = await file.read(buffer, 0, length, position);
  if (result.bytesRead !== length) throw Error("Metadaten unvollständig.");
  return buffer;
}
function textFrame(buffer) {
  const encoding = buffer[0], data = buffer.subarray(1);
  if (encoding === 0) return clean(data.toString("latin1"));
  if (encoding === 3) return clean(data.toString("utf8"));
  if (encoding === 1 || encoding === 2) {
    let bytes = Buffer.from(data.subarray(0, data.length - data.length % 2));
    if (encoding === 2 || (bytes[0] === 0xfe && bytes[1] === 0xff)) bytes.swap16();
    return clean(bytes.toString("utf16le").replace(/^\ufeff/, ""));
  }
  return "";
}
export async function inspectMusicTags(file, stat) {
  const report = { state: "unsupported", fields: {}, embeddedCover: null, message: "Für dieses Format werden Tags noch nicht ausgelesen." };
  if (stat.size < 10) return report;
  try {
    const header = await read(file, 0, 10);
    if (header.subarray(0, 3).toString("ascii") === "ID3") {
      if (![3, 4].includes(header[3]) || (header[5] & 0xc0)) return { ...report, message: "ID3-Version oder erweiterte Kodierung wird nicht unterstützt." };
      const size = synchsafe(header.subarray(6, 10)), end = 10 + size;
      if (size < 0 || end > stat.size) throw Error("Ungültige ID3-Länge.");
      report.state = "inspected"; report.embeddedCover = false; report.message = "ID3-Textfelder gelesen; Bilddaten werden nicht verändert.";
      const names = { TIT2: "title", TPE1: "artist", TALB: "album", TRCK: "track", TYER: "year", TDRC: "date" };
      let position = 10, count = 0;
      while (position + 10 <= end && count++ < 512) {
        const frame = await read(file, position, 10), name = frame.subarray(0, 4).toString("ascii");
        if (!frame[0]) break;
        if (!/^[A-Z0-9]{4}$/.test(name)) throw Error("Ungültiger ID3-Frame.");
        const length = header[3] === 4 ? synchsafe(frame.subarray(4, 8)) : frame.readUInt32BE(4);
        if (length < 0 || position + 10 + length > end) throw Error("Unvollständiger ID3-Frame.");
        if (name === "APIC") report.embeddedCover = true;
        else if (names[name] && length > 0 && length <= 4096 && frame[8] === 0 && frame[9] === 0)
          report.fields[names[name]] = textFrame(await read(file, position + 10, length));
        position += 10 + length;
      }
      if (count > 512) { report.state = "partial"; report.message = "Frame-Limit erreicht; nur ein Teil der Tags gelesen."; }
      return report;
    }
    if (header.subarray(0, 4).toString("ascii") === "fLaC") {
      report.state = "inspected"; report.embeddedCover = false; report.message = "FLAC/Vorbis-Textfelder gelesen; Bilddaten werden nicht verändert.";
      let position = 4;
      for (let count = 0; count < 128; count++) {
        const block = await read(file, position, 4), type = block[0] & 127, length = block.readUIntBE(1, 3);
        if (position + 4 + length > stat.size) throw Error("Ungültiger FLAC-Block.");
        if (type === 6) report.embeddedCover = true;
        if (type === 4) {
          if (length > 65536 || length < 8) { report.state = "partial"; }
          else {
            const data = await read(file, position + 4, length), vendor = data.readUInt32LE(0);
            let offset = 4 + vendor;
            if (offset + 4 > data.length) throw Error("Ungültiger Vorbis-Header.");
            const comments = data.readUInt32LE(offset); offset += 4;
            if (comments > 1024) throw Error("Zu viele Vorbis-Felder.");
            const names = { TITLE: "title", ARTIST: "artist", ALBUM: "album", DATE: "date", TRACKNUMBER: "track" };
            for (let i = 0; i < comments; i++) {
              if (offset + 4 > data.length) throw Error("Unvollständiger Vorbis-Kommentar.");
              const size = data.readUInt32LE(offset); offset += 4;
              if (offset + size > data.length) throw Error("Unvollständiges Vorbis-Feld.");
              const text = data.subarray(offset, offset + size).toString("utf8"), equals = text.indexOf("=");
              const field = names[text.slice(0, equals).toUpperCase()];
              if (field) report.fields[field] = clean(text.slice(equals + 1));
              offset += size;
            }
          }
        }
        position += 4 + length;
        if (block[0] & 128) return report;
      }
      report.state = "partial"; report.message = "Block-Limit erreicht; Tags teilweise gelesen.";
      return report;
    }
    return report;
  } catch {
    return { ...report, state: "unconfirmed", message: "Metadaten sind unvollständig oder nicht sicher lesbar. Datei bleibt unverändert." };
  }
}
