import {
  sourceText,
  sourceUrls,
  sourceDefault,
  sourceFieldSupported,
} from "../../packages/domain/source-fields.js";
import { randomUUID, createHash } from "node:crypto";
import { positiveId } from "./media-hub.js";
const secret = (f) =>
  /password|passkey|api.?key|token|cookie|secret/i.test(f.name) ||
  ["password", "apiKey", "username"].includes(f.privacy) ||
  f.type === "password" ||
  (typeof f.value === "string" &&
    /(?:[?&](?:api[-_]?key|passkey|token|password|auth)=|:\/\/[^/\s]+@)/i.test(
      f.value,
    ));
const text = (v, n = 200) => (typeof v === "string" ? v.slice(0, n) : "");
export function schemaKey(v) {
  return [v.implementation, v.configContract, v.name].join(":");
}
export function publicSchema(v) {
  return {
    key: schemaKey(v),
    name: text(v.name),
    privacy: text(v.privacy),
    fields: (Array.isArray(v.fields) ? v.fields : [])
      .filter((f) => f && !f.hidden && f.type !== "hidden")
      .map((f) => ({
        name: text(f.name),
        label: sourceText(f.label, 200) || text(f.name),
        helpText: sourceText(f.helpText),
        type: f.type,
        secret: f.type !== "info" && secret(f),
        value:
          f.type === "info"
            ? sourceText(f.value, 4000)
            : secret(f)
              ? ""
              : sourceDefault(v, f),
        advanced: !!f.advanced,
        choices: (f.name?.toLowerCase() === "baseurl"
          ? sourceUrls(v).map((url) => ({ value: url, name: url }))
          : Array.isArray(f.selectOptions)
            ? f.selectOptions
            : []
        )
          .filter(Boolean)
          .map((o) => ({
            value: o.value,
            name: text(o.name),
          })),
      })),
  };
}
function sourceFingerprint(source) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: source.id,
        name: source.name,
        enable: source.enable,
        implementation: source.implementation,
        configContract: source.configContract,
        priority: source.priority,
        appProfileId: source.appProfileId,
        tags: source.tags,
        fields: (source.fields || [])
          .filter((f) => f.type !== "info")
          .map((f) => ({ name: f.name, value: f.value })),
      }),
    )
    .digest("hex");
}
export class Sources {
  constructor(hub) {
    this.hub = hub;
  }
  async schemas(s) {
    const value = await s.arr("Prowlarr", "/indexer/schema");
    if (!Array.isArray(value)) throw Error("Prowlarr-Format ungültig.");
    return value
      .filter((v) => v?.protocol === "torrent")
      .map((v) => ({
        ...v,
        fields: (Array.isArray(v.fields) ? v.fields : []).filter(Boolean),
      }));
  }
  async list() {
    let s;
    try {
      ({ s } = await this.hub.context(["Prowlarr"]));
    } catch (error) {
      if (error.userFacing) throw error;
      throw Object.assign(
        Error(
          "Die sichere Verbindung zum verwalteten Stack konnte nicht geprüft werden. Unter Verwaltung → Verbindungen und Diagnose prüfen. [SOURCES_STACK]",
        ),
        { userFacing: true },
      );
    }
    const sections = [
      "Anbieterkatalog",
      "Eingerichtete Quellen",
      "ARR-Verbindungen",
    ];
    const results = await Promise.allSettled([
      this.schemas(s),
      s.arr("Prowlarr", "/indexer"),
      s.arr("Prowlarr", "/applications"),
    ]);
    const issues = [];
    const data = results.map((result, index) => {
      if (result.status === "fulfilled" && Array.isArray(result.value))
        return result.value;
      const error = result.status === "rejected" ? result.reason : null;
      const message = String(error?.message || "");
      const code = /HTTP (401|403)/.test(message)
        ? "PROWLARR_AUTH"
        : /ResponseTooLarge/.test(message)
          ? "PROWLARR_RESPONSE_SIZE"
          : /Brücke/.test(message)
            ? "PROWLARR_RELAY"
            : result.status === "fulfilled" || /Prowlarr-Format/.test(message)
              ? "PROWLARR_FORMAT"
              : "PROWLARR_API";
      const reason =
        code === "PROWLARR_AUTH"
          ? "Prowlarr weist den gespeicherten API-Zugang ab. Unter Verwaltung → Verbindungen prüfen."
          : code === "PROWLARR_RESPONSE_SIZE"
            ? "Die Antwort überschreitet die sichere Größenbegrenzung."
            : code === "PROWLARR_FORMAT"
              ? "Prowlarr liefert ein unerwartetes Antwortformat."
              : "Prowlarr oder die interne API-Verbindung ist gerade nicht erreichbar. Unter Verwaltung → Verbindungen prüfen.";
      issues.push({ section: sections[index], code, message: reason });
      return null;
    });
    const [schemas, indexers, apps] = data;
    return {
      schemas: schemas?.map(publicSchema) || [],
      sources:
        indexers?.map((v) => ({
          id: v.id,
          name: text(v.name),
          enabled: !!v.enable,
          protocol: v.protocol,
          privacy: v.privacy,
        })) ?? null,
      connections:
        apps?.map((v) => ({ name: text(v.name), syncLevel: v.syncLevel })) ??
        null,
      issues,
      note: "Quellen werden in Prowlarr verwaltet und über dessen vorhandene Verbindungen an die ARR-Apps synchronisiert. qBittorrent erhält die gefundenen Downloads von diesen Apps.",
    };
  }
  async detail(id) {
    const { s } = await this.hub.context(["Prowlarr"]);
    const source = await s.arr("Prowlarr", `/indexer/${positiveId(id)}`);
    return { id: source.id, ...publicSchema(source) };
  }
  async test(body) {
    return this.hub.mutate(["Prowlarr"], async ({ s, plan }) => {
      const existingId =
        body.sourceId === undefined ? null : positiveId(body.sourceId);
      const schema = existingId
        ? await s.arr("Prowlarr", `/indexer/${existingId}`)
        : (await this.schemas(s)).find((v) => schemaKey(v) === body.schema);
      if (schema?.protocol !== "torrent")
        throw Error("Nur Torrent-Quellen werden hier verwaltet.");
      if (!schema) throw Error("Quelle nicht im aktuellen Katalog gefunden.");
      if (
        typeof body.name !== "string" ||
        !body.name.trim() ||
        body.name.length > 100
      )
        throw Error("Einen Namen mit höchstens 100 Zeichen eingeben.");
      if (
        !body.values ||
        typeof body.values !== "object" ||
        Array.isArray(body.values)
      )
        throw Error("Zugangsdaten fehlen.");
      if (
        schema.fields.some(
          (f) =>
            !f.hidden && f.type !== "hidden" && !sourceFieldSupported(f.type),
        )
      )
        throw Error(
          "Diese Quelle benötigt einen speziellen Einrichtungsdialog in Prowlarr.",
        );
      const allowed = new Set(
        schema.fields
          .filter((f) => !f.hidden && !["info", "hidden"].includes(f.type))
          .map((f) => f.name),
      );
      if (Object.keys(body.values).some((k) => !allowed.has(k)))
        throw Error("Unbekannte Einstellung.");
      const fields = schema.fields.map((f) => {
        if (!(f.name in body.values))
          return f.name?.toLowerCase() === "baseurl"
            ? { ...f, value: sourceDefault(schema, f) }
            : f;
        let value = body.values[f.name];
        if (existingId && secret(f) && value === "") return f;
        if (f.type === "checkbox") {
          if (typeof value !== "boolean") throw Error("Ungültiger Schalter.");
        } else if (["number", "select"].includes(f.type)) {
          if (!Number.isFinite(Number(value)))
            throw Error("Eine Zahl auswählen.");
          value = Number(value);
        } else if (["tag", "selectMultiple"].includes(f.type)) {
          if (
            !Array.isArray(value) ||
            value.length > 100 ||
            value.some((v) => typeof v !== "string" && typeof v !== "number")
          )
            throw Error("Ungültige Auswahl.");
        } else if (typeof value !== "string" || value.length > 2048)
          throw Error("Ungültiger Feldwert.");
        if (
          (f.name.toLowerCase() === "baseurl" ||
            (typeof value === "string" &&
              value.includes("://") &&
              /url$/i.test(f.name))) &&
          value
        ) {
          let u;
          try {
            u = new URL(value);
          } catch {
            throw Error("Eine vollständige HTTP(S)-Adresse eingeben.");
          }
          if (
            !["https:", "http:"].includes(u.protocol) ||
            u.username ||
            u.password
          )
            throw Error(
              "Nur HTTP(S)-Adressen ohne eingebettete Zugangsdaten erlauben.",
            );
        }
        return { ...f, value };
      });
      const candidate = {
        ...schema,
        name: body.name.trim(),
        enable: existingId ? schema.enable : true,
        appProfileId: schema.appProfileId || 1,
        priority: schema.priority ?? 25,
        fields,
      };
      if (!existingId) delete candidate.id;
      const existing = await s.arr("Prowlarr", "/indexer");
      if (
        existing.some(
          (v) =>
            v.id !== existingId &&
            v.name.toLowerCase() === candidate.name.toLowerCase(),
        )
      )
        throw Error("Dieser Quellenname existiert bereits.");
      try {
        await s.arr("Prowlarr", "/indexer/test", {
          method: "POST",
          body: candidate,
        });
      } catch {
        throw Error(
          "Quellentest fehlgeschlagen. Adresse, Zugangsdaten und Erreichbarkeit in Prowlarr prüfen.",
        );
      }
      const id = randomUUID();
      this.hub.engine.vault.set(`source-draft:${id}`, {
        planId: plan.id,
        candidate,
        existingId,
        fingerprint: existingId ? sourceFingerprint(schema) : null,
        expiresAt: Date.now() + 600000,
        used: false,
      });
      return {
        id,
        name: candidate.name,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      };
    });
  }
  async save(body) {
    return this.hub.mutate(["Prowlarr"], async ({ s, plan }) => {
      if (
        typeof body.id !== "string" ||
        !/^[a-f0-9-]{36}$/.test(body.id) ||
        body.confirmation !== "OK"
      )
        throw Error("Geprüfte Quelle mit OK bestätigen.");
      const key = `source-draft:${body.id}`,
        draft = this.hub.engine.vault.get(key);
      if (
        !draft ||
        draft.planId !== plan.id ||
        draft.expiresAt < Date.now() ||
        draft.used
      )
        throw Error(
          "Quellentest abgelaufen oder bereits verwendet. Erneut testen.",
        );
      const existing = await s.arr("Prowlarr", "/indexer");
      if (
        existing.some(
          (v) =>
            v.id !== draft.existingId &&
            v.name.toLowerCase() === draft.candidate.name.toLowerCase(),
        )
      )
        throw Error(
          "Name bereits vorhanden. Bestehende Quelle bleibt erhalten.",
        );
      if (draft.existingId) {
        const current = await s.arr("Prowlarr", `/indexer/${draft.existingId}`);
        if (sourceFingerprint(current) !== draft.fingerprint)
          throw Error(
            "Die Quelle wurde seit dem Test verändert. Erneut laden und testen.",
          );
        this.hub.engine.vault.ensure(`source-backup:${body.id}`, () => current);
      }
      try {
        const saved = await s.arr(
          "Prowlarr",
          draft.existingId ? `/indexer/${draft.existingId}` : "/indexer",
          {
            method: draft.existingId ? "PUT" : "POST",
            body: draft.candidate,
          },
        );
        this.hub.engine.vault.set(key, { used: true });
        return { ok: true, id: saved.id };
      } catch {
        throw Error(
          "Quelle konnte nicht gespeichert werden. Vor erneutem Versuch die Quellenliste prüfen.",
        );
      }
    });
  }
  async action(body) {
    return this.hub.mutate(["Prowlarr"], async ({ s, plan }) => {
      const id = positiveId(body.id);
      const current = await s.arr("Prowlarr", `/indexer/${id}`);
      if (body.action === "test") {
        try {
          await s.arr("Prowlarr", "/indexer/test", {
            method: "POST",
            body: current,
          });
          return { ok: true };
        } catch {
          throw Error(
            "Quellentest fehlgeschlagen. Zugang und Erreichbarkeit in Prowlarr prüfen.",
          );
        }
      }
      if (body.action !== "toggle" || typeof body.enabled !== "boolean")
        throw Error("Unbekannte Quellenaktion.");
      this.hub.engine.vault.ensure(
        `snapshot:${plan.id}:source:${id}`,
        () => current,
      );
      try {
        if (body.enabled)
          await s.arr("Prowlarr", "/indexer/test", {
            method: "POST",
            body: current,
          });
        await s.arr("Prowlarr", `/indexer/${id}`, {
          method: "PUT",
          body: { ...current, enable: body.enabled },
        });
        return { ok: true };
      } catch {
        throw Error(
          "Quelle konnte nicht geändert werden. Konfiguration in Prowlarr prüfen.",
        );
      }
    });
  }
}
