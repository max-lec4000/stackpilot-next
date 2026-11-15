# Read-only, aggregate evidence. Never emit usernames, tokens, device secrets or recovery codes.
import json
from authentik.core.models import User
from authentik.stages.authenticator import devices_for_user
from authentik.stages.authenticator_static.models import StaticDevice
from authentik.stages.authenticator_validate.models import AuthenticatorValidateStage
from authentik.stages.user_logout.models import UserLogoutStage
from authentik.flows.models import FlowStageBinding
from authentik.providers.oauth2.models import OAuth2Provider
from authentik.brands.models import Brand

def account_ready(user):
    devices = list(devices_for_user(user))
    primary = any(type(d).__name__ in ("TOTPDevice", "WebAuthnDevice") for d in devices)
    recovery = sum(d.token_set.count() for d in devices if isinstance(d, StaticDevice)) > 0
    return primary, recovery

admins = []
viewers = []
for user in User.objects.filter(is_active=True).prefetch_related("groups"):
    if user.is_superuser:
        admins.append(account_ready(user))
    elif user.groups.filter(name="stackpilot-viewers").exists():
        viewers.append(account_ready(user))

def counts(rows):
    return {"total": len(rows), "withMfa": sum(m for m, r in rows), "withRecovery": sum(r for m, r in rows)}

mfa = AuthenticatorValidateStage.objects.filter(name="stackpilot-required-mfa").first()
provider = OAuth2Provider.objects.filter(name="StackPilot Jellyfin").first()
brand = Brand.objects.filter(default=True).first()
logout = UserLogoutStage.objects.filter(name="stackpilot-end-session").first()
logout_ready = bool(logout and provider and provider.invalidation_flow and provider.invalidation_flow.slug == "stackpilot-invalidation" and brand and brand.flow_invalidation and brand.flow_invalidation.slug == "stackpilot-invalidation" and FlowStageBinding.objects.filter(target__slug="stackpilot-invalidation", stage=logout).exists())
mfa_ready = bool(mfa and mfa.not_configured_action == "deny" and mfa.last_auth_threshold in ("seconds=0", "minutes=5") and set(mfa.device_classes) == {"totp", "webauthn", "static"} and mfa.webauthn_user_verification == "required" and FlowStageBinding.objects.filter(target__slug="stackpilot-authorization", stage=mfa).exists() and FlowStageBinding.objects.filter(target__slug="stackpilot-authentication", stage__name__in=["stackpilot-required-mfa", "stackpilot-viewer-mfa"]).exists())
print("STACKPILOT_IDENTITY_STATUS=" + json.dumps({"admins": counts(admins), "viewers": counts(viewers), "mfaRequired": mfa_ready, "logoutConfigured": logout_ready}))
