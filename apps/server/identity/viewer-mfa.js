export const viewerPasskey = "stackpilot-viewer-passkey";
export const viewerMfa = {
  stage: "stackpilot-viewer-login-proof",
  order: 110,
  record: "stackpilot-record-viewer-mfa",
  require: "stackpilot-require-viewer-mfa",
  recordExpression: `from time import time
from authentik.events.signals import get_login_event
from authentik.flows.models import FlowStageBinding
from authentik.policies.models import PolicyBinding
from authentik.stages.authenticator import devices_for_user
from authentik.stages.authenticator_validate.models import AuthenticatorValidateStage

u = http_request.user
event = get_login_event(http_request)
stage = AuthenticatorValidateStage.objects.filter(name="stackpilot-viewer-mfa",
    not_configured_action="configure", last_auth_threshold="seconds=0",
    webauthn_user_verification="required").first()
binding = FlowStageBinding.objects.filter(target__slug="stackpilot-authentication",
    stage=stage, order=30).first() if stage else None
if (binding and not PolicyBinding.objects.filter(target=binding).exists()
        and set(stage.device_classes) == {"totp", "webauthn", "static"}
        and set(stage.configuration_stages.values_list("name", flat=True))
            in ({"default-authenticator-totp-setup"},
                {"default-authenticator-totp-setup", "${viewerPasskey}"})
        and u.is_authenticated and u.is_active and not u.is_superuser and event and event.pk
        and ak_is_group_member(u, name="stackpilot-viewers")):
    devices = sorted(str(d.pk) for d in devices_for_user(u)
                     if type(d).__name__ in ("TOTPDevice", "WebAuthnDevice", "StaticDevice"))
    used = event.context.get("auth_method_args", {}).get("mfa_devices", [])
    # TOTP enrollment validates a code. A new passkey must perform an assertion
    # with user verification before access, because registration alone does not.
    if devices and (used or ak_user_has_authenticator(u, "totp")):
        http_request.session["stackpilot-viewer-mfa"] = [str(event.pk), str(u.pk), int(time()), devices]
return False`,
  requireExpression: `from time import time
from authentik.events.signals import get_login_event
from authentik.stages.authenticator import devices_for_user

try:
    u = http_request.user
    event = get_login_event(http_request)
    proof = http_request.session.pop("stackpilot-viewer-mfa", None)
    if (not proof or not event or not u.is_authenticated or not u.is_active
            or u.is_superuser or not ak_is_group_member(u, name="stackpilot-viewers")
            or proof[0] != str(event.pk) or proof[1] != str(u.pk)
            or not 0 <= int(time()) - proof[2] <= 120):
        return True
    devices = sorted(str(d.pk) for d in devices_for_user(u)
                     if type(d).__name__ in ("TOTPDevice", "WebAuthnDevice", "StaticDevice"))
    return not devices or devices != proof[3]
except Exception:
    return True`,
};
