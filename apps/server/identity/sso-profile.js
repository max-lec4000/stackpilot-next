import { validateIdentityInput } from "./config.js";
export const denyPasswordProvider =
  "Jellyfin.Server.Implementations.Users.InvalidAuthProvider";
// New-provider template only. Existing providers/canonical links require a separate reviewed migration.
export function secureSsoProfile(input, secret, libraryIds = []) {
  const { hostname } = validateIdentityInput(input);
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 512)
    throw Error("Privater OIDC-Schlüssel fehlt.");
  if (
    !Array.isArray(libraryIds) ||
    libraryIds.length > 64 ||
    new Set(libraryIds).size !== libraryIds.length ||
    libraryIds.some(
      (id) => typeof id !== "string" || !/^[a-f0-9-]{32,36}$/i.test(id),
    )
  )
    throw Error("Ungültige Bibliotheksauswahl.");
  return {
    OidEndpoint: `https://${hostname}:8443/application/o/stackpilot-jellyfin/`,
    OidClientId: "stackpilot-jellyfin",
    OidSecret: secret,
    Enabled: true,
    EnableAuthorization: true,
    EnableAllFolders: false,
    EnabledFolders: libraryIds,
    AdminRoles: [],
    Roles: ["stackpilot-viewers"],
    EnableFolderRoles: false,
    EnableLiveTvRoles: false,
    EnableLiveTv: false,
    EnableLiveTvManagement: false,
    RoleClaim: "groups",
    OidScopes: [],
    DefaultProvider: denyPasswordProvider,
    SchemeOverride: "https",
    PortOverride: -1,
    NewPath: true,
    DefaultUsernameClaim: "preferred_username",
    DisableHttps: false,
    DisablePushedAuthorization: false,
    DoNotValidateEndpoints: false,
    DoNotValidateIssuerName: false,
    DoNotLoadProfile: false,
  };
}
