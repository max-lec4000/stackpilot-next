// App-Adapter für die ARR-Dienste (Sonarr, Radarr, Lidarr, Prowlarr). Benannte Methoden;
// Schreibzugriffe gelten erst nach bestätigtem Zurücklesen. Weitere Methoden folgen mit 7.2/7.3.
import { writeAndConfirm, userFacing } from "./confirm.js";

const id = (value) => {
  if (!Number.isSafeInteger(value) || value < 1) throw userFacing("Ungültige Kennung.");
  return value;
};

export class ArrAdapter {
  constructor(s, name) {
    if (!["Sonarr", "Radarr", "Lidarr", "Prowlarr"].includes(name)) throw Error("Unbekannter ARR-Dienst.");
    this.name = name;
    this.call = (route, options) => s.arr(name, route, options);
  }
  async version() {
    const status = await this.call("/system/status");
    return typeof status?.version === "string" ? status.version : null;
  }
  async movie(movieId) { return this.call(`/movie/${id(movieId)}`); }
  async series(seriesId) { return this.call(`/series/${id(seriesId)}`); }
  async qualityProfile(profileId) { return this.call(`/qualityprofile/${id(profileId)}`); }

  /**
   * Film (Radarr) einem Qualitätsprofil zuweisen und bestätigen lassen. `current` ist der
   * zuletzt gelesene Film; geschrieben wird nur, wenn das Profil noch abweicht.
   */
  async assignMovieProfile(current, profileId, tmdbId, message) {
    const route = `/movie/${id(current.id)}`;
    const check = (m) => m?.tmdbId === tmdbId && m.qualityProfileId === profileId;
    if (current.qualityProfileId === profileId) {
      const now = await this.call(route);
      if (!check(now)) throw userFacing(message);
      return now;
    }
    return writeAndConfirm({
      write: () => this.call(route, { method: "PUT", body: { ...current, qualityProfileId: profileId } }),
      read: () => this.call(route),
      check,
      message,
    });
  }
}

export const arrAdapter = (s, name) => new ArrAdapter(s, name);
