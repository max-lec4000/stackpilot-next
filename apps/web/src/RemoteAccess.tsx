import { FunnelPreview } from "./FunnelPreview";
import { IdentityBackups } from "./IdentityBackups";
import { RemoteSetupPanel } from "./RemoteSetupPanel";
import { AuthentikAdmin } from "./AuthentikAdmin";
import { Disclosure, SectionHeading } from "./ui";

export function RemoteAccessView() {
  return (
    <>
      <RemoteSetupPanel />
      <section className="managed-services" aria-label="Öffentlich über das Internet">
        <SectionHeading
          title="Öffentlich über das Internet (Funnel)"
          description="Optional. Macht nur Jellyfin und die Authentik-Anmeldung ohne Tailscale erreichbar. Voraussetzung: In der Tailscale-Policy hat dieser Server das Recht „funnel“ (nodeAttrs)."
        />
        <FunnelPreview />
      </section>
      <section className="managed-services" aria-label="Sicherung und Verwaltung">
        <Disclosure title="Authentik sichern und Wiederherstellung prüfen">
          <IdentityBackups />
        </Disclosure>
        <Disclosure title="Authentik-Verwaltung (akadmin)">
          <AuthentikAdmin />
        </Disclosure>
      </section>
    </>
  );
}
