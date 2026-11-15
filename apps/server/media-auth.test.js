import { test } from "node:test";
import assert from "node:assert/strict";
import { checkMediaSession } from "./identity/media-auth.js";
const result = (policy) => async () =>
  Response.json({ Id: "viewer", Name: "spv_fixture", Policy: policy });
test("Sitzungsschutz erlaubt öffentliche Metadaten und reine Client-Header ohne Token", async () => {
  const never = () => assert.fail("No session lookup expected");
  assert.equal(await checkMediaSession({}, "/System/Info/Public", never), 204);
  assert.equal(
    await checkMediaSession(
      { authorization: 'MediaBrowser Client="Fixture", DeviceId="fixture"' },
      "/QuickConnect/Initiate",
      never,
    ),
    204,
  );
});
test("Sitzungsschutz prüft Header und Query bei Jellyfin und verweigert Administratoren/unklare Rechte", async () => {
  for (const [headers, uri] of [
    [{ authorization: 'MediaBrowser Token="fixture-token"' }, "/System/Info"],
    [{ "x-emby-token": "fixture-token" }, "/Users/Me"],
    [{}, "/Videos/id/stream?ApiKey=fixture-token"],
    [{}, "/Videos/id/stream?aPiKeY=fixture-token"],
    [{}, "/Videos/id/stream?api_key=fixture-token"],
  ]) {
    let checked = 0;
    assert.equal(
      await checkMediaSession(headers, uri, async (url, options) => {
        checked++;
        assert.match(url, /^http:\/\/jellyfin:8096\/Users\/Me/);
        for (const [key, value] of Object.entries(headers))
          assert.equal(options.headers[key], value);
        return Response.json({
          Id: "viewer",
          Name: "spv_fixture",
          Policy: {
            IsAdministrator: false,
            IsDisabled: false,
            AuthenticationProviderId:
              "Jellyfin.Server.Implementations.Users.InvalidAuthProvider",
          },
        });
      }),
      204,
    );
    assert.equal(checked, 1);
    for (const policy of [
      { IsAdministrator: true, IsDisabled: false },
      { IsAdministrator: false, IsDisabled: true },
      { IsAdministrator: false },
      {},
    ])
      assert.equal(await checkMediaSession(headers, uri, result(policy)), 403);
  }
});
test("Sitzungsschutz bleibt bei Ausfall, ungültigen Tokens und fehlerhaften Antworten geschlossen", async () => {
  const headers = { authorization: 'MediaBrowser Token="fixture"' };
  assert.equal(
    await checkMediaSession(headers, "/", async () => {
      throw Error("offline");
    }),
    503,
  );
  for (const status of [401, 403])
    assert.equal(
      await checkMediaSession(
        headers,
        "/",
        async () => new Response(null, { status }),
      ),
      401,
    );
  assert.equal(
    await checkMediaSession(headers, "/", async () => new Response("oops")),
    503,
  );
  assert.equal(
    await checkMediaSession({ authorization: ["a", "b"] }, "/", result({})),
    400,
  );
  assert.equal(
    await checkMediaSession(headers, "https://other/", result({})),
    400,
  );
});

test("Öffentliche Sitzungen benötigen ein separates SSO-Konto mit gesperrtem Passwortanbieter", async () => {
  const headers = { authorization: 'MediaBrowser Token="fixture"' },
    policy = {
      IsAdministrator: false,
      IsDisabled: false,
      AuthenticationProviderId:
        "Jellyfin.Server.Implementations.Users.InvalidAuthProvider",
    };
  for (const user of [
    { Id: "id", Name: "local-viewer", Policy: policy },
    {
      Id: "id",
      Name: "spv_viewer",
      Policy: {
        ...policy,
        AuthenticationProviderId: "DefaultAuthenticationProvider",
      },
    },
  ])
    assert.equal(
      await checkMediaSession(headers, "/Users/Me", async () =>
        Response.json(user),
      ),
      403,
    );
  assert.equal(
    await checkMediaSession({ "x-stackpilot-upgrade": "websocket" }, "/socket"),
    401,
  );
});
