import { request } from "node:http";
// Fixed loopback destination; explicit Host is needed to test virtual-host isolation.
// Node's fetch does not preserve this header in the supported runtime.
export function localIdentityRequest(target, options = {}) {
  const url = new URL(target);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password
  )
    throw Error("Identitätsprüfung benötigt ein lokales HTTP-Ziel");
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: options.method || "GET",
        headers: options.headers,
        signal: options.signal,
      },
      (res) => {
        const chunks = [];
        let bytes = 0;
        res.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 4 * 1024 * 1024)
            req.destroy(Error("Identitätsantwort zu groß"));
          else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          const headers = new Headers();
          for (let i = 0; i < res.rawHeaders.length; i += 2)
            headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
          const status = res.statusCode;
          resolve(
            new Response(
              [204, 205, 304].includes(status) ? null : Buffer.concat(chunks),
              { status, headers },
            ),
          );
        });
      },
    );
    req.setTimeout(10000, () =>
      req.destroy(Error("Lokale Identitätsprüfung abgelaufen")),
    );
    req.on("error", reject);
    req.end(options.body === undefined ? undefined : String(options.body));
  });
}
