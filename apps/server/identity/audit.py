# Executed only inside the locally managed Authentik container. Never print secrets.
import json
from pathlib import Path
from authentik.flows.models import Flow, FlowStageBinding
from authentik.stages.user_logout.models import UserLogoutStage
from authentik.stages.authenticator_validate.models import AuthenticatorValidateStage
from authentik.providers.oauth2.models import OAuth2Provider
from authentik.core.models import Application
from authentik.brands.models import Brand
from authentik.policies.models import PolicyBinding
from authentik.policies.expression.models import ExpressionPolicy
from django.db import connection
with connection.cursor() as cursor:
    cursor.execute("SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication FROM pg_roles WHERE rolname = current_user")
    assert cursor.fetchone() == (False, False, False, False)
mfa = AuthenticatorValidateStage.objects.get(name="stackpilot-required-mfa")
assert mfa.not_configured_action == "deny"
assert set(mfa.device_classes) == {"totp", "webauthn", "static"}
# The login flow always asks for the factor (viewer stage, seconds=0); the authorization step
# right after it accepts that proof for a few minutes instead of asking for a second code.
assert mfa.last_auth_threshold == "minutes=5"
assert mfa.webauthn_user_verification == "required"
assert FlowStageBinding.objects.filter(target__slug="stackpilot-authorization", stage=mfa).exists()
# Login: same factor classes, but a viewer without a factor sets one up instead of being locked out.
viewer_mfa = AuthenticatorValidateStage.objects.get(name="stackpilot-viewer-mfa")
assert viewer_mfa.not_configured_action == "configure"
assert set(viewer_mfa.device_classes) == {"totp", "webauthn", "static"}
assert viewer_mfa.last_auth_threshold == "seconds=0"
assert [s.name for s in viewer_mfa.configuration_stages.all()] == ["default-authenticator-totp-setup"]
assert FlowStageBinding.objects.filter(target__slug="stackpilot-authentication", stage=viewer_mfa).exists()
provider = OAuth2Provider.objects.get(name="StackPilot Jellyfin")
assert provider.client_type == "confidential"
assert provider.grant_types == ["authorization_code"]
assert provider.client_secret == Path("/run/secrets/oidc_secret").read_text().strip()
assert provider.access_code_validity == "seconds=60"
assert provider.access_token_validity == "minutes=5"
assert provider.refresh_token_validity == "seconds=0"
assert provider.signing_key_id is not None
assert len(provider.redirect_uris) == 1
assert provider.redirect_uris[0].matching_mode == "strict"
assert provider.invalidation_flow.slug == "stackpilot-invalidation"
logout = UserLogoutStage.objects.get(name="stackpilot-end-session")
assert FlowStageBinding.objects.filter(target__slug="stackpilot-invalidation", stage=logout).exists()
assert Brand.objects.get(default=True).flow_invalidation.slug == "stackpilot-invalidation"
assert provider.authentication_flow.slug == "stackpilot-authentication"
assert provider.authorization_flow.slug == "stackpilot-authorization"
app = Application.objects.get(slug="stackpilot-jellyfin")
assert app.policy_engine_mode == "all"
policy = ExpressionPolicy.objects.get(name="stackpilot-viewers-no-administrators")
assert "not request.user.is_superuser" in policy.expression
assert "stackpilot-viewers" in policy.expression
assert PolicyBinding.objects.filter(target=app, policy=policy, enabled=True, failure_result=False).exists()
assert Brand.objects.get(default=True).flow_authentication.slug == "stackpilot-admin-login"
print(json.dumps({"mfaRequired": True, "passwordGrantDisabled": True, "strictRedirect": True, "separateAdminFlow": True, "publicReady": False}))
