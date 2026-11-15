function validCounts(value) {
  return (
    value &&
    [value.total, value.withMfa, value.withRecovery].every(
      (v) => Number.isSafeInteger(v) && v >= 0 && v <= 100000,
    ) &&
    value.withMfa <= value.total &&
    value.withRecovery <= value.total
  );
}
export function parseIdentityStatus(output) {
  const lines = String(output)
    .split(/\r?\n/)
    .filter((s) => s.startsWith("STACKPILOT_IDENTITY_STATUS="));
  if (lines.length !== 1)
    throw Error("Identitätsstatus nicht eindeutig bestätigt");
  const v = JSON.parse(lines[0].slice("STACKPILOT_IDENTITY_STATUS=".length));
  if (
    !validCounts(v.admins) ||
    !validCounts(v.viewers) ||
    typeof v.mfaRequired !== "boolean" ||
    typeof v.logoutConfigured !== "boolean"
  )
    throw Error("Identitätsstatus ungültig");
  return {
    admins: {
      total: v.admins.total,
      withMfa: v.admins.withMfa,
      withRecovery: v.admins.withRecovery,
    },
    viewers: {
      total: v.viewers.total,
      withMfa: v.viewers.withMfa,
      withRecovery: v.viewers.withRecovery,
    },
    mfaRequired: v.mfaRequired,
    logoutConfigured: v.logoutConfigured,
  };
}
export function identitySecurityChecks(status) {
  const covered = (r, key) => r.total > 0 && r[key] === r.total;
  return [
    {
      name: "MFA-Regeln",
      state: status.mfaRequired ? "ok" : "blocked",
      message: status.mfaRequired
        ? "Zuschauer-Anmeldung und OIDC-Zustimmung verlangen MFA."
        : "Verpflichtende MFA konnte nicht bestätigt werden.",
    },
    {
      name: "Administratoren",
      state: covered(status.admins, "withMfa") ? "ok" : "todo",
      message: `${status.admins.withMfa} von ${status.admins.total} aktiven Administratoren mit bestätigtem TOTP oder Passkey.`,
    },
    {
      name: "Administrator-Wiederherstellung",
      state: covered(status.admins, "withRecovery") ? "ok" : "todo",
      message: `${status.admins.withRecovery} von ${status.admins.total} Administratoren mit verbleibenden Wiederherstellungscodes.`,
    },
    {
      name: "Zuschauer",
      state: covered(status.viewers, "withMfa") ? "ok" : "todo",
      message: `${status.viewers.withMfa} von ${status.viewers.total} Zuschauern mit bestätigtem TOTP oder Passkey.`,
    },
    {
      name: "Zuschauer-Wiederherstellung",
      // Kein Hindernis: Wer seinen zweiten Faktor verliert, wird mit "Neu einladen" wieder
      // hereingeholt. Angemeldete Geräte (Fernseher, Tablet) bleiben davon unberührt.
      state: covered(status.viewers, "withRecovery") ? "ok" : "info",
      message: `${status.viewers.withRecovery} von ${status.viewers.total} Zuschauern mit Wiederherstellungscodes. Ohne Codes hilft „Neu einladen“.`,
    },
    {
      name: "Authentik-Abmeldung",
      state: status.logoutConfigured ? "ok" : "blocked",
      message: status.logoutConfigured
        ? "Der Abmeldeflow beendet die Authentik-Sitzung. Jellyfin-Gerätesitzungen müssen separat widerrufen werden."
        : "Ein vollständiger Authentik-Abmeldeflow ist noch nicht bestätigt. Vorhandene Konfiguration wird nicht überschrieben.",
    },
    {
      name: "Offline-Wiederherstellung",
      state: "todo",
      message:
        "Vorhandene Codes bestätigen weder eine sichere Offline-Kopie noch einen getesteten Wiederherstellungsweg.",
    },
  ];
}
