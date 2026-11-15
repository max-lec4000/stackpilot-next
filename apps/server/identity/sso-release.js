import { releases } from "./config.js";
const id = (value) =>
  String(value || "")
    .replaceAll("-", "")
    .toLowerCase();
export function ssoPluginState(plugins) {
  const entries = Array.isArray(plugins)
    ? plugins.filter((p) => id(p.Id) === id(releases.ssoPlugin.id))
    : [];
  if (entries.length !== 1)
    return {
      present: entries.length > 0,
      active: false,
      version: null,
      releaseMatches: false,
    };
  const p = entries[0],
    version = typeof p.Version === "string" ? p.Version.slice(0, 32) : null,
    active = p.Status === "Active";
  return {
    present: true,
    active,
    version,
    releaseMatches: active && version === releases.ssoPlugin.version,
  };
}
export function ssoCompatibility(version) {
  return {
    loadVerified:
      releases.ssoPlugin.loadTestedJellyfinVersions?.includes(version) === true,
    loginVerified: releases.ssoPlugin.testedJellyfinVersions.includes(version),
    automaticInstallation: releases.ssoPlugin.automaticInstallation === true,
  };
}
