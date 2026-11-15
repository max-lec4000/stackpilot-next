import { spawn } from "node:child_process";
export function dockerInput(
  args,
  input,
  { timeout = 60000, maxOutputBytes = 4 * 1024 * 1024 } = {},
) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, LC_ALL: "C" };
    for (const key of [
      "DOCKER_HOST",
      "DOCKER_CONTEXT",
      "DOCKER_TLS",
      "DOCKER_TLS_VERIFY",
      "DOCKER_CERT_PATH",
    ])
      delete env[key];
    const child = spawn(
      "docker",
      ["--host=unix:///var/run/docker.sock", ...args],
      { env, stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    let failed = false;
    const timer = setTimeout(() => {
      failed = true;
      child.kill("SIGTERM");
    }, timeout);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (Buffer.byteLength(output) > maxOutputBytes) {
        failed = true;
        child.kill("SIGTERM");
      }
    });
    child.stderr.resume();
    child.on("error", () => {
      clearTimeout(timer);
      reject(
        new Error("Interne Docker-Anfrage konnte nicht gestartet werden."),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || failed)
        reject(
          new Error(
            "Interne Docker-Anfrage fehlgeschlagen oder Zeitlimit erreicht.",
          ),
        );
      else resolve(output);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
// Fixed program, data arrives only over stdin. No passwords or keys in process arguments.
const relayProgram = `let text='';for await(const chunk of process.stdin){text+=chunk;if(text.length>1000000)process.exit(2);}const q=JSON.parse(text);const u=new URL(q.url);if(u.protocol!=='http:'||!['jellyfin','sonarr','radarr','prowlarr','lidarr','qbittorrent','gluetun','bazarr','seerr','streamystats'].includes(u.hostname))process.exit(3);try{const r=await fetch(u,{method:q.method,headers:q.headers,body:q.body,redirect:'manual',signal:AbortSignal.timeout(Math.min(45000,Math.max(1000,q.timeout||45000)))});const limit=u.hostname==='prowlarr'&&u.pathname==='/api/v1/indexer/schema'&&q.method==='GET'?16*1024*1024:3000000;const chunks=[];let size=0;if(r.body)for await(const chunk of r.body){size+=chunk.length;if(size>limit){process.stdout.write(JSON.stringify({status:598,headers:{},body:'',error:'ResponseTooLarge'}));process.exit(0);}chunks.push(chunk);}const body=Buffer.concat(chunks).toString('utf8');process.stdout.write(JSON.stringify({status:r.status,headers:Object.fromEntries(r.headers),body}));}catch(e){process.stdout.write(JSON.stringify({status:599,headers:{},body:'',error:e.name+(e.cause?.code?':'+e.cause.code:'')}));}`;
export async function relayRequest(container, request) {
  if (!/^[a-f0-9]{64}$/.test(container))
    throw new Error("API-Brücke ist nicht eindeutig.");
  const url = new URL(request.url);
  const schema =
    url.hostname === "prowlarr" &&
    url.pathname === "/api/v1/indexer/schema" &&
    request.method === "GET";
  const result = await dockerInput(
    [
      "exec",
      "-i",
      container,
      "node",
      "--input-type=module",
      "-e",
      relayProgram,
    ],
    JSON.stringify(request),
    { maxOutputBytes: schema ? 48 * 1024 * 1024 : 4 * 1024 * 1024 },
  );
  try {
    return JSON.parse(result);
  } catch {
    throw new Error("Ungültige Antwort der internen API-Brücke.");
  }
}
