// A token is checked with Jellyfin itself; no administrator credential or token cache.
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
const credentialHeaders = [
  "authorization",
  "x-emby-authorization",
  "x-emby-token",
  "x-mediabrowser-token",
];
export async function checkMediaSession(headers, originalUri, request = fetch) {
  if (
    typeof originalUri !== "string" ||
    !originalUri.startsWith("/") ||
    originalUri.length > 8192
  )
    return 400;
  let original;
  try {
    original = new URL("http://jellyfin" + originalUri);
  } catch {
    return 400;
  }
  const forwarded = {};
  let credential = false;
  for (const name of credentialHeaders) {
    const value = headers[name];
    if (value !== undefined && typeof value !== "string") return 400;
    if (value) {
      forwarded[name] = value;
      credential ||= name.endsWith("-token") || /\bToken\s*=/i.test(value);
    }
  }
  for (const [name] of original.searchParams)
    if (["apikey", "api_key"].includes(name.toLowerCase())) credential = true;
  if (!credential) return headers["x-stackpilot-upgrade"] ? 401 : 204;
  try {
    const response = await request(
      "http://jellyfin:8096/Users/Me" + original.search,
      {
        headers: forwarded,
        redirect: "error",
        signal: AbortSignal.timeout(4000),
      },
    );
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      return 401;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      return 403;
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 256 * 1024) return 503;
      chunks.push(chunk);
    }
    const user = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return typeof user.Id === "string" &&
      typeof user.Name === "string" &&
      user.Name.startsWith("spv_") &&
      user.Policy?.IsAdministrator === false &&
      user.Policy?.IsDisabled === false &&
      user.Policy?.AuthenticationProviderId ===
        "Jellyfin.Server.Implementations.Users.InvalidAuthProvider"
      ? 204
      : 403;
  } catch {
    return 503;
  }
}
export function mediaAuthServer() {
  const server = createServer(
    { maxHeaderSize: 16384, requestTimeout: 8000, headersTimeout: 5000 },
    async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      if (req.method !== "GET" || req.url !== "/check") {
        res.writeHead(404);
        return res.end();
      }
      const status = await checkMediaSession(
        req.headers,
        req.headers["x-stackpilot-original-uri"],
      );
      res.writeHead(status);
      res.end();
    },
  );
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  mediaAuthServer().listen(8082, "0.0.0.0");
