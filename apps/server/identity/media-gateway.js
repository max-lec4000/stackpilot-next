import { validateIdentityInput } from "./config.js";
// Render-only. Deployment and external proxy/client-IP acceptance remain separate gates.
export function mediaGateway(input, sessionGuard = false) {
  const { hostname } = validateIdentityInput(input);
  const proxy = `proxy_http_version 1.1;
      proxy_set_header Host ${hostname};
      proxy_set_header X-Forwarded-Host ${hostname};
      proxy_set_header X-Forwarded-Proto https;
      proxy_set_header X-Forwarded-For $remote_addr;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $sp_media_upgrade;
      proxy_buffering off;
      proxy_read_timeout 300s;
      proxy_pass http://jellyfin:8096;`;
  return `map $http_upgrade $sp_media_upgrade { default upgrade; '' close; }
server {
  listen 8081;
  access_log off;
  ${
    sessionGuard
      ? `auth_request /_stackpilot_auth;
  location = /_stackpilot_auth {
    internal;
    auth_request off;
    proxy_pass http://authguard:8082/check;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header X-StackPilot-Original-URI $request_uri;
    proxy_set_header X-StackPilot-Upgrade $http_upgrade;
  }`
      : ""
  }
  server_name ${hostname};
  if ($host != "${hostname}") { return 421; }
  merge_slashes on;
  if ($uri ~ "%[0-9a-fA-F]{2}") { return 400; }
  client_max_body_size 1m;
  add_header Strict-Transport-Security "max-age=31536000" always;
  add_header X-Content-Type-Options nosniff always;
  add_header X-Frame-Options SAMEORIGIN always;
  add_header Referrer-Policy no-referrer always;
  add_header Content-Security-Policy "frame-ancestors 'self'" always;
  location ~* ^/users/authenticatewithquickconnect/?$ { ${proxy} }
  location ~* (^|/)users/([^/]+/)?(authenticate[^/]*|password|forgotpassword)(/|$) { return 403; }
  # Die Startseite führt direkt zur Anmeldung über Authentik: Zuschauer haben kein
  # Jellyfin-Passwort, das Passwortfeld der normalen Startseite würde nur verwirren.
  # Apps rufen nur API-Pfade auf und sind davon nicht betroffen.
  location = / { absolute_redirect off; return 302 /sso/OID/start/stackpilot; }
  location ~* ^/sso/oid/(start|redirect|auth)/stackpilot/?$ { ${proxy} }
  location ~* (^|/)sso(/|$) { return 403; }
  location / { ${proxy} }
}
`;
}
