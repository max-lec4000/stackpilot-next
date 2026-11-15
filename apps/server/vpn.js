import { isIP } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import { dockerInput } from "./docker-io.js";
// Parse data, never wg-quick scripts. Unknown directives are rejected rather than executed.
export function parseWireGuard(text) {
  if (typeof text !== "string" || text.length > 6000)
    throw new Error("WireGuard-Datei fehlt oder ist zu groß.");
  const sections = { Interface: {}, Peer: {} };
  let section = null;
  const seen = new Set();
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/\s*[#;].*$/, "").trim();
    if (!line) continue;
    if (/^\[/.test(line)) {
      section = /^\[(Interface|Peer)\]$/.exec(line)?.[1];
      if (!section || seen.has(section))
        throw new Error("Genau ein Interface und ein Peer sind erlaubt.");
      seen.add(section);
      continue;
    }
    const match = /^(\w+)\s*=\s*(.+)$/.exec(line);
    const allowed =
      section === "Interface"
        ? ["PrivateKey", "Address", "DNS", "MTU"]
        : ["PublicKey", "Endpoint", "AllowedIPs", "PersistentKeepalive"];
    if (
      !section ||
      !match ||
      !allowed.includes(match[1]) ||
      sections[section][match[1]]
    )
      throw new Error(
        "Nicht unterstützte oder doppelte WireGuard-Angabe. Keine Skripte oder zusätzlichen Routen erlaubt.",
      );
    sections[section][match[1]] = match[2].trim();
  }
  const i = sections.Interface,
    p = sections.Peer;
  for (const key of [i.PrivateKey, p.PublicKey])
    if (
      !/^[A-Za-z0-9+/]{43}=$/.test(key || "") ||
      Buffer.from(key, "base64").length !== 32
    )
      throw new Error("WireGuard-Schlüssel ungültig.");
  const addresses = (i.Address || "").split(",").map((v) => v.trim());
  const v4 = addresses.find(
    (a) => /^10\.\d+\.\d+\.\d+\/32$/.test(a) && isIP(a.split("/")[0]) === 4,
  );
  if (
    !v4 ||
    addresses.some((a) => !/^.+\/\d+$/.test(a) || !isIP(a.split("/")[0]))
  )
    throw new Error("Eine gültige IPv4-Tunneladresse mit /32 wird benötigt.");
  const endpoint = /^(\d+\.\d+\.\d+\.\d+):(\d+)$/.exec(p.Endpoint || "");
  if (
    !endpoint ||
    isIP(endpoint[1]) !== 4 ||
    +endpoint[2] < 1 ||
    +endpoint[2] > 65535 ||
    /^(0|10|127|169\.254|192\.168)\./.test(endpoint[1]) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(endpoint[1]) ||
    +endpoint[1].split(".")[0] >= 224
  )
    throw new Error(
      "Öffentliche IPv4-Adresse und Port des Mullvad-Servers werden benötigt.",
    );
  if (
    !(p.AllowedIPs || "")
      .split(",")
      .map((v) => v.trim())
      .includes("0.0.0.0/0")
  )
    throw new Error("WireGuard muss den gesamten IPv4-Verkehr tunneln.");
  // IPv6 is deliberately disabled in the VPN namespace until dual-stack leak tests exist.
  return {
    config: `[Interface]\nPrivateKey = ${i.PrivateKey}\nAddress = ${v4}\n[Peer]\nPublicKey = ${p.PublicKey}\nEndpoint = ${endpoint[1]}:${+endpoint[2]}\nAllowedIPs = 0.0.0.0/0\nPersistentKeepalive = 25\n`,
    endpoint: `${endpoint[1]}:${+endpoint[2]}`,
    address: v4,
  };
}
export function importVpn(vault, text) {
  const parsed = parseWireGuard(text),
    id = randomUUID();
  vault.set(`vpn-profile:${id}`, {
    ...parsed,
    controlKey: randomBytes(24).toString("base64url"),
  });
  return {
    id,
    endpoint: parsed.endpoint,
    address: parsed.address,
    provider: "Mullvad",
    ipv6: "deaktiviert",
  };
}
const probeProgram = `let input='';for await(const c of process.stdin)input+=c;const q=JSON.parse(input);const net=await import('node:net');
async function control(status){const r=await fetch('http://127.0.0.1:8000/v1/vpn/status',{method:status?'PUT':'GET',headers:{'X-API-Key':q.key,'Content-Type':'application/json'},body:status?JSON.stringify({status}):undefined,signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('control');return r.json();}
async function identity(){const r=await fetch('https://am.i.mullvad.net/json',{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('identity');const j=await r.json();if(j.mullvad_exit_ip!==true)throw Error('not-mullvad');return true;}
async function udp(){const dgram=await import('node:dgram');return new Promise(resolve=>{const s=dgram.createSocket('udp4');const finish=v=>{clearTimeout(t);s.close();resolve(v)};const t=setTimeout(()=>finish(false),3000);s.on('message',()=>finish(true));s.on('error',()=>finish(false));const query=Buffer.from('123401000001000000000000076578616d706c6503636f6d0000010001','hex');s.send(query,53,'8.8.8.8');});}
async function tcp(host,port){return new Promise(resolve=>{const s=net.createConnection({host,port});const done=v=>{s.destroy();resolve(v)};s.setTimeout(3000,()=>done(false));s.on('connect',()=>done(true));s.on('error',()=>done(false));});}
try{if(q.action==='identity'){await identity();process.stdout.write(JSON.stringify({passed:true}));}else if(q.action==='isolation'){let stopped=false;try{await control('stopped');stopped=true;for(let n=0;n<15;n++){if((await control()).status==='stopped')break;await new Promise(r=>setTimeout(r,500));}if((await control()).status!=='stopped')throw Error('not-stopped');const reach=await Promise.all([tcp('1.1.1.1',443),tcp('8.8.8.8',53),udp()]);if(reach.some(Boolean))throw Error('egress-leak');let escaped=false;try{await identity();escaped=true;}catch{}if(escaped)throw Error('https-leak');if((await control()).status!=='stopped')throw Error('reconnected-during-check');process.stdout.write(JSON.stringify({passed:true}));}finally{if(stopped)await control('running');}}else throw Error('action');}catch{process.stdout.write(JSON.stringify({passed:false}));}`;
export async function probeVpn(container, key, action, input = dockerInput) {
  if (!/^[a-f0-9]{64}$/.test(container))
    throw new Error("VPN-Prüfcontainer ist nicht eindeutig.");
  let result;
  try {
    result = JSON.parse(
      await input(
        [
          "exec",
          "-i",
          container,
          "node",
          "--input-type=module",
          "-e",
          probeProgram,
        ],
        JSON.stringify({ key, action }),
        { timeout: 90000 },
      ),
    );
  } catch {}
  if (result?.passed !== true)
    throw new Error(
      action === "isolation"
        ? "VPN-Ausfallsperre nicht nachgewiesen. qBittorrent bleibt gestoppt; kein ungeschützter Rückfall."
        : "Mullvad-Tunnel nicht nachgewiesen. Konfiguration und Verbindung prüfen.",
    );
  return {
    service: "Mullvad",
    status: "passed",
    scope:
      action === "isolation"
        ? "Tunnel kontrolliert gestoppt; direkte IPv4-TCP-, UDP-DNS- und HTTPS-Ausgänge blockiert; IPv6 deaktiviert"
        : "HTTPS-Prüfung bestätigt Mullvad-Ausgang",
  };
}
