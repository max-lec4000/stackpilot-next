import { randomBytes } from "node:crypto";
import { serviceCredentialKey } from "./provision-files.js";

async function accepted(services, key) {
  try {
    await services.additional.bazarr("/system/status", {
      headers: { "X-API-KEY": key },
    });
    return true;
  } catch (error) {
    if (error.status === 401) return false;
    throw Error("Bazarr antwortet nicht verlässlich. Versuche es erneut, sobald der Dienst bereit ist.");
  }
}

// Aufruf innerhalb der Stack-Sperre. Ein offener Schlüsselwechsel bleibt im
// Tresor, bis Bazarr den neuen Schlüssel annimmt und den bisherigen ablehnt.
export async function rotateBazarrKey(services) {
  const { plan, vault } = services;
  const credentialKey = serviceCredentialKey(plan, "Bazarr");
  const current = vault.get(credentialKey);
  if (!current?.apiKey)
    throw Error("Im Tresor ist kein Bazarr-Schlüssel hinterlegt.");

  const { pendingApiKey, ...credentials } = current;
  const previous = credentials.apiKey;
  const next = pendingApiKey || randomBytes(16).toString("hex");
  const pendingAlreadyActive = pendingApiKey && await accepted(services, next);
  if (!pendingAlreadyActive) {
    if (!await accepted(services, previous))
      throw Error("Bazarr lehnt den hinterlegten Schlüssel ab. Prüfe den Schlüssel in Bazarr.");
    vault.set(credentialKey, { ...credentials, pendingApiKey: next });

    try {
      await services.additional.bazarr("/system/settings", {
        method: "POST",
        headers: { "X-API-KEY": previous },
        body: new URLSearchParams({ "settings-auth-apikey": next }),
      });
    } catch {
      // Bazarr kann die Änderung gespeichert haben, bevor die Antwort ausfiel.
    }
  }

  if (!await accepted(services, next) || await accepted(services, previous))
    throw Error("Der Schlüsselwechsel ist noch nicht bestätigt. Wähle „API-Schlüssel erneuern“ erneut, um ihn fortzusetzen.");

  vault.set(credentialKey, { ...credentials, apiKey: next });
  return { ok: true };
}
