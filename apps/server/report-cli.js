import { collectReport, writeReport } from "./report.js";
import {
  publishDevelopmentReport,
  developmentPolicy,
  developmentUploadStatus,
} from "./development-report.js";
import { setReportConsent } from "./dev-report-consent.js";
import { StateStore } from "./state.js";
import { inventoryMiddleware } from "./middleware.js";
import path from "node:path";
const args = process.argv.slice(2);
const development = args[0] === "--development";
const local = development && args[1] === "--local";
const enable = development && args[1] === "--enable-upload";
const disable = development && args[1] === "--disable-upload";
if (
  !(
    args.length === 0 ||
    (args.length === 2 && args[0] === "--output") ||
    (development &&
      (args.length === 1 ||
        (args.length === 2 && (local || enable || disable))))
  )
) {
  console.error(
    "Aufruf: npm run report -- [--output /pfad/serverbericht.json] oder npm run report:dev [-- --local | --enable-upload | --disable-upload]",
  );
  process.exit(1);
}
let runtime, store;
try {
  const stateDirectory =
    process.env.STACKPILOT_STATE_DIR || path.resolve(".stackpilot");
  if (development) store = new StateStore(stateDirectory);
  if (enable) {
    if (!(await developmentPolicy()))
      throw Error("Die Entwicklungspolicy gibt keinen GitHub-Upload frei.");
    setReportConsent(store, true);
    console.log(
      "Entwicklungsupload für diese Installation aktiviert. Es werden nur bereinigte Berichte in das festgelegte private Repository übertragen.",
    );
  }
  if (disable) {
    setReportConsent(store, false);
    console.log(
      "Entwicklungsupload für diese Installation deaktiviert. Berichte bleiben lokal.",
    );
  } else {
    runtime = development
      ? inventoryMiddleware({ store, background: false })
      : null;
    const report = runtime
      ? await runtime.developmentReport()
      : await collectReport();
    const stamp = report.createdAt.replace(/[:.]/g, "-");
    const filename = development
      ? path.join(
          stateDirectory,
          "development-reports",
          `diagnose-${stamp}.json`,
        )
      : args[1] || `reports/serverbericht-${stamp}.json`;
    const file = await writeReport(filename, report);
    console.log(`Bericht lokal gespeichert: ${file}`);
    const upload =
      development && !local && (await developmentUploadStatus(store)).enabled;
    if (upload) {
      const result = await publishDevelopmentReport(report, { store });
      console.log(`Bereinigter Entwicklungsbericht auf GitHub: ${result.url}`);
    } else {
      console.log(
        "Kein Upload. Enthält Netzwerkadressen und Pfade; vor dem Teilen prüfen.",
      );
      if (development && !local)
        console.log(
          "Optional einmalig aktivieren: npm run report:dev -- --enable-upload",
        );
    }
  }
} catch (e) {
  console.error(
    e.code === "EEXIST" ? "Zieldatei existiert bereits." : e.message,
  );
  process.exitCode = 1;
} finally {
  if (runtime) runtime.closeReportContext();
  else if (store) store.close();
}
