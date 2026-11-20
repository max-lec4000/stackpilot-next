// Docker-Wächter (Phase 7.0c, Prototyp): Erlaubnisliste für Docker-API-Aufrufe von StackPilot.
// Ziel: Der StackPilot-Container bekommt keinen vollen Docker-Socket (= root auf dem Host),
// sondern nur die Aufrufe, die er braucht – und neue Container nur ohne Wege nach außen.

// Pfad ohne API-Version (/v1.47/containers/json → /containers/json)
export const bare = (path) => path.replace(/^\/v1\.\d+(?=\/)/, "").split("?")[0];

const ID = "[A-Za-z0-9_.:@/-]+";
const allowed = [
  ["GET", `^/_ping$`], ["HEAD", `^/_ping$`], ["GET", `^/version$`], ["GET", `^/info$`],
  ["GET", `^/containers/json$`], ["GET", `^/containers/${ID}/json$`], ["GET", `^/containers/${ID}/logs$`],
  ["GET", `^/containers/${ID}/top$`],
  ["POST", `^/containers/create$`],
  ["POST", `^/containers/${ID}/(start|stop|restart|kill|pause|unpause|wait|update|resize|attach|rename)$`],
  ["DELETE", `^/containers/${ID}$`],
  ["POST", `^/containers/${ID}/exec$`], ["POST", `^/exec/${ID}/(start|resize)$`], ["GET", `^/exec/${ID}/json$`],
  ["GET", `^/images/json$`], ["GET", `^/images/${ID}/json$`], ["POST", `^/images/create$`],
  ["GET", `^/networks$`], ["GET", `^/networks/${ID}$`], ["POST", `^/networks/create$`],
  ["POST", `^/networks/${ID}/(connect|disconnect)$`], ["DELETE", `^/networks/${ID}$`],
  ["GET", `^/volumes$`], ["GET", `^/volumes/${ID}$`], ["POST", `^/volumes/create$`], ["DELETE", `^/volumes/${ID}$`],
  ["GET", `^/events$`],
].map(([m, re]) => [m, new RegExp(re)]);

/** Ist der Aufruf grundsätzlich erlaubt? (ohne Inhaltsprüfung) */
export function routeAllowed(method, path) {
  const p = bare(path);
  return allowed.some(([m, re]) => m === method && re.test(p));
}

// Pfad wie Docker bereinigen (filepath.Clean): „..“, „.“ und doppelte Schrägstriche
export function clean(p) {
  const out = [];
  for (const part of String(p).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop(); else out.push(part);
  }
  return "/" + out.join("/");
}
const inside = (dir, roots) => roots.some((root) => dir === root || dir.startsWith(root.endsWith("/") ? root : root + "/"));
const CAPS = new Set(["NET_ADMIN", "CAP_NET_ADMIN", "CHOWN", "CAP_CHOWN", "DAC_OVERRIDE", "CAP_DAC_OVERRIDE", "FOWNER", "CAP_FOWNER", "SETUID", "CAP_SETUID", "SETGID", "CAP_SETGID"]);
const DEVICES = new Set(["/dev/net/tun"]);
const NETWORK_DRIVERS = new Set(["", "bridge"]);

/**
 * Host-Ordner prüfen. resolve: echter Pfad nach Auflösen von Verknüpfungen (der Wächter
 * läuft als root auf dem Host und sieht dieselben Pfade wie Docker). Ohne resolve nur
 * bereinigt (Tests).
 */
function checkSource(src, { roots, resolve = (x) => x }, label, reasons) {
  const path = clean(src);
  if (/^\/(var\/run|run)\/docker\.sock$/.test(path)) return reasons.push("Docker-Socket");
  const real = resolve(path);
  if (/^\/(var\/run|run)\/docker\.sock$/.test(real)) return reasons.push("Docker-Socket");
  if (!inside(path, roots) || !inside(real, roots)) reasons.push(`${label} ${real === path ? path : `${path} → ${real}`}`);
}

// Lokale Volumes können mit type/o/device ebenfalls Host-Ordner einbinden.
function checkDriverOptions(driver, opts, ctx, reasons) {
  if (driver && driver !== "local") return reasons.push(`Volume-Treiber ${driver}`);
  const o = opts || {};
  if (!Object.keys(o).length) return;
  const type = String(o.type || "");
  if (type === "tmpfs") return;
  if ((type === "none" || /(^|,)r?bind(,|$)/.test(String(o.o || ""))) && String(o.device || "").startsWith("/"))
    return checkSource(o.device, ctx, "Volume-Bind", reasons);
  reasons.push(`Volume-Optionen ${type || "?"}`);
}

/**
 * Neuen Container prüfen. ctx.roots: erlaubte Host-Ordner für Einbindungen (Zustand,
 * App-Daten, Medien). Gründe werden gesammelt, damit das Protokoll alle Verstöße zeigt.
 */
export function checkCreate(body, ctx) {
  const h = body?.HostConfig || {};
  const reasons = [];
  if (h.Privileged) reasons.push("privileged");
  for (const mode of ["NetworkMode", "PidMode", "IpcMode", "UTSMode", "UsernsMode", "CgroupnsMode"])
    if (h[mode] === "host") reasons.push(`${mode}=host`);
  if (/^container:/.test(h.PidMode || "")) reasons.push("PidMode=container");
  if ((h.VolumesFrom || []).length) reasons.push("VolumesFrom");
  if (h.Runtime && h.Runtime !== "runc") reasons.push(`Runtime ${h.Runtime}`);
  if (h.CgroupParent) reasons.push("CgroupParent");
  for (const cap of h.CapAdd || []) if (!CAPS.has(String(cap).toUpperCase())) reasons.push(`CapAdd ${cap}`);
  for (const d of h.Devices || []) if (!DEVICES.has(d.PathOnHost)) reasons.push(`Device ${d.PathOnHost}`);
  if ((h.DeviceRequests || []).length) reasons.push("DeviceRequests");
  if ((h.DeviceCgroupRules || []).length) reasons.push("DeviceCgroupRules");
  for (const opt of h.SecurityOpt || []) if (/unconfined|label[:=]disable|systempaths/i.test(opt)) reasons.push(`SecurityOpt ${opt}`);
  for (const b of h.Binds || []) {
    const src = String(b).split(":")[0];
    if (src.startsWith("/")) checkSource(src, ctx, "Bind", reasons); // sonst benanntes Volume
  }
  for (const m of h.Mounts || []) {
    if (m.Type === "bind") checkSource(m.Source || "", ctx, "Bind", reasons);
    else if (m.Type === "volume") {
      const dc = m.VolumeOptions?.DriverConfig;
      if (dc) checkDriverOptions(dc.Name, dc.Options, ctx, reasons);
    } else if (m.Type !== "tmpfs") reasons.push(`Mount-Typ ${m.Type}`);
  }
  return reasons;
}

/** Neues Volume: nur lokal, Host-Ordner nur innerhalb der erlaubten Ordner. */
export function checkVolume(body, ctx) {
  const reasons = [];
  checkDriverOptions(body?.Driver, body?.DriverOpts, ctx, reasons);
  return reasons;
}

/** Neues Netzwerk: nur Bridge (kein macvlan/ipvlan an der Host-Schnittstelle). */
export function checkNetwork(body) {
  const driver = String(body?.Driver || "");
  return NETWORK_DRIVERS.has(driver) ? [] : [`Netzwerk-Treiber ${driver}`];
}

/** exec in einem Container: kein privilegierter Modus. */
export function checkExec(body) {
  return body?.Privileged ? ["exec privileged"] : [];
}
