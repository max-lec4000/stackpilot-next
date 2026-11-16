// The Seerr web UI and administration API have no public location. Streamyfin
// uses Quick Connect and a Seerr session cookie for this subset of the API.
export const streamyfinMaps = String.raw`map "$request_method:$uri" $sp_seerr_allowed {
  default 0;
  "~^GET:/seerr/api/v1/(?:status|auth/me|settings/(?:public|discover)|search|media|request(?:/[0-9]+)?|user/[0-9]+/quota)$" 1;
  "~^GET:/seerr/api/v1/discover/(?:trending|movies(?:/studio/[0-9]+)?|tv(?:/network/[0-9]+)?|genreslider/(?:movie|tv))$" 1;
  "~^GET:/seerr/api/v1/(?:movie/[0-9]+(?:/ratings)?|tv/[0-9]+(?:/ratings|/season/[0-9]+)?|person/[0-9]+(?:/combined_credits)?)$" 1;
  "~^POST:/seerr/api/v1/(?:auth/jellyfin/quickconnect/(?:initiate|authenticate)|request)$" 1;
}
map $request_uri $sp_seerr_raw_path {
  "~^(?<sp_seerr_path>[^?]+)" $sp_seerr_path;
  default "";
}
map $http_cookie $sp_seerr_session {
  "~(?:^|;\s*)(?<sp_seerr_sid>(?:seerr\.sid|jellyseerr\.sid|connect\.sid)=[^;[:space:]]+)" $sp_seerr_sid;
  default "";
}
map $http_cookie $sp_seerr_csrf_cookie {
  "~(?:^|;\s*)(?<sp_seerr_xsrf>XSRF-TOKEN=[^;[:space:]]+)" $sp_seerr_xsrf;
  default "";
}
map "$sp_seerr_session|$sp_seerr_csrf_cookie" $sp_seerr_cookie {
  "~^\|" $sp_seerr_csrf_cookie;
  "~\|$" $sp_seerr_session;
  default "$sp_seerr_session; $sp_seerr_csrf_cookie";
}
`;

export const streamyfinLocation = String.raw`location ^~ /seerr/ {
    auth_request off;
    if ($sp_seerr_raw_path != $uri) { return 400; }
    if ($sp_seerr_allowed = 0) { return 404; }
    if ($http_x_api_key != "") { return 403; }
    set $sp_seerr_upstream seerr:5055;
    rewrite ^/seerr(/api/v1/.*)$ $1 break;
    client_max_body_size 32k;
    proxy_pass_request_headers off;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Content-Type $content_type;
    proxy_set_header Cookie $sp_seerr_cookie;
    proxy_set_header XSRF-TOKEN $http_xsrf_token;
    proxy_cookie_path / /seerr/;
    proxy_cookie_flags ~^(?:seerr\.sid|jellyseerr\.sid|connect\.sid)$ secure httponly;
    proxy_cookie_flags XSRF-TOKEN secure nohttponly;
    resolver 127.0.0.11 valid=5s ipv6=off;
    resolver_timeout 3s;
    proxy_connect_timeout 5s;
    proxy_read_timeout 30s;
    proxy_pass http://$sp_seerr_upstream$uri$is_args$args;
  }`;
