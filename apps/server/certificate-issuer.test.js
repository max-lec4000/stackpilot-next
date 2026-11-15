import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import {
  issueCertificate,
  classifyCertificateFailure,
  certificateFailure,
} from "./identity/certificate-issuer.js";
const hostname = "device.example.ts.net";
async function directory(fn) {
  const dir = await mkdtemp("/tmp/sp-cert-issuer-");
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
test("Zertifikatsabruf verwendet feste Dateiziele, eigenen validierten Hostnamen und keinen sudo-/TLS-Fallback", async () =>
  directory(async (dir) => {
    const calls = [];
    const result = await issueCertificate(hostname, dir, {
      execute: async (...args) => {
        calls.push(args);
      },
    });
    assert.deepEqual(result, { legacyClient: false });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(0, 2), [
      "tailscale",
      [
        "cert",
        "--min-validity=336h",
        `--cert-file=${dir}/cert.pem`,
        `--key-file=${dir}/key.pem`,
        hostname,
      ],
    ]);
    assert.equal(calls[0][2].timeout, 60000);
    await assert.rejects(
      issueCertificate("evil.example/path", dir, {
        execute: async () => {
          throw Error("must not execute");
        },
      }),
      (e) => e.stage === "certificate" && e.userFacing === true,
    );
  }));
test("Ältere Clients erhalten genau einen Retry ohne die ausdrücklich unbekannte min-validity-Option", async () =>
  directory(async (dir) => {
    const calls = [];
    const result = await issueCertificate(hostname, dir, {
      execute: async (bin, args) => {
        calls.push([bin, args]);
        if (calls.length === 1)
          throw {
            stderr: "flag provided but not defined: -min-validity\nSECRET",
          };
      },
    });
    assert.deepEqual(result, { legacyClient: true });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1][1], [
      "cert",
      `--cert-file=${dir}/cert.pem`,
      `--key-file=${dir}/key.pem`,
      hostname,
    ]);
    assert.ok(
      !calls
        .flat(3)
        .some(
          (v) =>
            typeof v === "string" && (v === "sudo" || v.includes("insecure")),
        ),
    );
  }));
test("Berechtigungsfehler, fremde unbekannte Flags und Timeouts werden nie als Legacy-Retry wiederholt", async () =>
  directory(async (dir) => {
    for (const [error, code] of [
      [{ stderr: "Access denied: cert access denied SECRET" }, "permission"],
      [
        {
          stderr:
            "flag provided but not defined: -cert-file; min-validity is recommended",
        },
        "unsupported",
      ],
      [{ killed: true, stderr: "SECRET" }, "timeout"],
      [{ code: "ENOENT" }, "missing"],
    ]) {
      let calls = 0;
      await assert.rejects(
        issueCertificate(hostname, dir, {
          execute: async () => {
            calls++;
            throw error;
          },
        }),
        (e) =>
          e.certificateFailureCode === code &&
          e.stage === "certificate" &&
          !JSON.stringify({ message: e.message, ...e }).includes("SECRET"),
      );
      assert.equal(calls, 1);
    }
  }));
test("Klassifizierte Fehler veröffentlichen keine Rohdaten und unterscheiden Dateirechte von Cert-API-Rechten", () => {
  const cases = [
    [
      { stderr: "open /private/SECRET/key.pem: permission denied" },
      "file-permission",
    ],
    [{ stderr: "failed to connect to local tailscaled" }, "not-running"],
    [{ stderr: "Tailscale is not logged in" }, "not-logged-in"],
    [
      {
        stderr: "HTTPS cert support is not enabled/configured for your tailnet",
      },
      "https-disabled",
    ],
    [{ stderr: "acme: 429 too many requests SECRET" }, "rate-limit"],
    [{ stderr: "lookup acme.example: no such host" }, "network"],
    [{ stderr: "SECRET mystery" }, "unknown"],
  ];
  for (const [error, code] of cases) {
    assert.equal(classifyCertificateFailure(error), code);
    const e = certificateFailure(code);
    assert.equal(e.certificateFailureCode, code);
    assert.ok(!e.message.includes("SECRET"));
  }
  assert.equal(certificateFailure("SECRET").certificateFailureCode, "unknown");
});
test("Ausgabesymlinks und vorhandene Zertifikatsdateien werden vor dem CLI-Aufruf abgewiesen", async () =>
  directory(async (dir) => {
    await writeFile(dir + "/owned", "unchanged");
    await symlink(dir + "/owned", dir + "/key.pem");
    let calls = 0;
    await assert.rejects(
      issueCertificate(hostname, dir, {
        execute: async () => {
          calls++;
        },
      }),
      (e) => e.certificateFailureCode === "file-permission",
    );
    assert.equal(calls, 0);
    await rm(dir + "/key.pem");
    await writeFile(dir + "/cert.pem", "existing");
    await assert.rejects(
      issueCertificate(hostname, dir, {
        execute: async () => {
          calls++;
        },
      }),
      (e) => e.certificateFailureCode === "file-permission",
    );
    assert.equal(calls, 0);
  }));
