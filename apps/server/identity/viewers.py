# Runs only inside the managed Authentik worker. Fixed program; request arrives as JSON on stdin.
# Never prints passwords, tokens or MFA material.
import json, re, sys
from django.db import transaction
from authentik.blueprints.v1.importer import Importer
from authentik.core.models import Group, User
from authentik.flows.models import FlowStageBinding, Stage
from authentik.policies.expression.models import ExpressionPolicy
from authentik.policies.models import PolicyBinding
from authentik.providers.oauth2.models import OAuth2Provider, ScopeMapping
from authentik.stages.authenticator import devices_for_user
from authentik.stages.authenticator_static.models import AuthenticatorStaticStage
from authentik.stages.authenticator_validate.models import AuthenticatorValidateStage
from authentik.stages.authenticator_webauthn.models import AuthenticatorWebAuthnStage
from authentik.stages.dummy.models import DummyStage
from authentik.stages.prompt.models import Prompt, PromptStage
from authentik.stages.user_write.models import UserWriteStage

request = json.loads(sys.stdin.read())
action = request.get("action")
group = Group.objects.get(name="stackpilot-viewers")
result = {}

def row(user):
    devices = list(devices_for_user(user))
    passkeys = {str(d.pk) for d in devices if type(d).__name__ == "WebAuthnDevice"}
    pending = user.attributes.get(request["passkeyEnrollment"]["pending"])
    return {
        "hasPasskey": bool(passkeys),
        "passkeyPending": isinstance(pending, list) and not passkeys.difference(pending),
        "username": user.username,
        "name": user.name,
        "active": user.is_active,
        "mfa": any(type(d).__name__ in ("TOTPDevice", "WebAuthnDevice") for d in devices),
        "lastLogin": user.last_login.isoformat() if user.last_login else None,
        "profileId": user.attributes.get("stackpilot_viewer_profile"),
    }

def viewer(name):
    user = group.users.filter(username=name).first()
    if not user or user.is_superuser:
        raise SystemExit("STACKPILOT_VIEWERS=" + json.dumps({"error": "missing"}))
    return user

def password_choice(enable=False):
    spec = request["viewerPassword"]
    bindings = FlowStageBinding.objects.filter(target__slug="stackpilot-authorization", order__in=[12, 13])
    policies = ExpressionPolicy.objects.filter(name__in=[spec["gate"], spec["validation"]])
    if enable and not bindings.exists() and not policies.exists() and not Stage.objects.filter(
        name__in=[spec["prompt"], spec["write"]]
    ).exists() and not Prompt.objects.filter(name__in=spec["fields"]).exists():
        importer = Importer.from_string(request["passwordUpgrade"])
        valid, _ = importer.validate()
        if not valid:
            return False
        importer.apply()
    prompt = PromptStage.objects.filter(name=spec["prompt"]).first()
    write = UserWriteStage.objects.filter(name=spec["write"], user_creation_mode="never_create",
        create_users_group__isnull=True).first()
    gate = policies.filter(name=spec["gate"], expression=spec["gateExpression"]).first()
    if not prompt or not write or not gate or bindings.count() != 2:
        return False
    if set(prompt.fields.values_list("name", "field_key", "type", "required")) != {
        (spec["fields"][0], "password", "password", True),
        (spec["fields"][1], "password_repeat", "password", True),
    } or prompt.validation_policies.count() != 1:
        return False
    validator = policies.filter(name=spec["validation"], expression=spec["validateExpression"]).first()
    if not validator or not prompt.validation_policies.filter(pk=validator.pk).exists():
        return False
    for stage, order in [(prompt, 12), (write, 13)]:
        binding = bindings.filter(stage=stage, order=order, evaluate_on_plan=False, re_evaluate_policies=True).first()
        if not binding:
            return False
        attached = PolicyBinding.objects.filter(target=binding)
        if attached.count() != 1 or not attached.filter(policy=gate, enabled=True, failure_result=False).exists():
            return False
    return True

@transaction.atomic
def login_improved(enable=False):
    spec = request["viewerMfa"]
    provider = OAuth2Provider.objects.filter(name="StackPilot Jellyfin", client_id="stackpilot-jellyfin").first()
    login = provider.authentication_flow if provider else None
    authz = provider.authorization_flow if provider else None
    if not login or login.slug != "stackpilot-authentication" or not authz or authz.slug != "stackpilot-authorization":
        return False
    first_mfa = FlowStageBinding.objects.filter(target=login, stage__name="stackpilot-viewer-mfa", order=30).first()
    login_stage = FlowStageBinding.objects.filter(target=login, stage__name="stackpilot-short-login", order=100).first()
    fallback = FlowStageBinding.objects.filter(target=authz, stage__name="stackpilot-required-mfa", order=10).first()
    if not first_mfa or not login_stage or not fallback or PolicyBinding.objects.filter(target__in=[first_mfa.pk, login_stage.pk]).exists():
        return False
    mfa = AuthenticatorValidateStage.objects.filter(pk=first_mfa.stage_id,
        not_configured_action="configure", last_auth_threshold="seconds=0",
        webauthn_user_verification="required").first()
    if not mfa or not AuthenticatorValidateStage.objects.filter(pk=fallback.stage_id,
        not_configured_action="deny", webauthn_user_verification="required").exists():
        return False
    passkey_name = request["viewerPasskey"]
    configs = set(mfa.configuration_stages.values_list("name", flat=True))
    if configs not in ({"default-authenticator-totp-setup"}, {"default-authenticator-totp-setup", passkey_name}):
        return False
    passkey = AuthenticatorWebAuthnStage.objects.filter(name=passkey_name).first()
    if passkey and (passkey.user_verification != "required" or passkey.max_attempts != 3 or
        passkey.resident_key_requirement != "preferred" or passkey.device_type_restrictions.exists()):
        return False
    stage = DummyStage.objects.filter(name=spec["stage"]).first()
    proof = FlowStageBinding.objects.filter(target=login, order=spec["order"]).first()
    known = ExpressionPolicy.objects.filter(name__in=[spec["record"], spec["require"]])
    if enable and not stage and not proof and not known.exists() and not PolicyBinding.objects.filter(target=fallback).exists():
        stage = DummyStage.objects.create(name=spec["stage"])
        proof = FlowStageBinding.objects.create(target=login, stage=stage, order=spec["order"],
            evaluate_on_plan=False, re_evaluate_policies=True)
        fallback.evaluate_on_plan = False
        fallback.re_evaluate_policies = True
        fallback.save(update_fields=["evaluate_on_plan", "re_evaluate_policies"])
        for binding, name, expression, failure in (
            (proof, spec["record"], spec["recordExpression"], False),
            (fallback, spec["require"], spec["requireExpression"], True),
        ):
            policy = ExpressionPolicy.objects.create(name=name, expression=expression)
            PolicyBinding.objects.create(target=binding, policy=policy, order=0, failure_result=failure, enabled=True)
    if not proof or not stage or proof.stage_id != stage.pk or FlowStageBinding.objects.filter(target=login, order=spec["order"]).count() != 1:
        return False
    for binding, name, expression, failure in (
        (proof, spec["record"], spec["recordExpression"], False),
        (fallback, spec["require"], spec["requireExpression"], True),
    ):
        policy = known.filter(name=name, expression=expression).first()
        policies = PolicyBinding.objects.filter(target=binding)
        if (not policy or binding.evaluate_on_plan or not binding.re_evaluate_policies or policies.count() != 1 or
            not policies.filter(order=0, failure_result=failure, enabled=True, policy=policy).exists()):
            return False
    if not enable:
        return passkey_name in configs and passkey is not None
    if not passkey:
        passkey = AuthenticatorWebAuthnStage.objects.create(name=passkey_name, friendly_name="Passkey",
            user_verification="required", resident_key_requirement="preferred", max_attempts=3)
    mfa.configuration_stages.add(passkey)
    return True

@transaction.atomic
def recovery_enabled(enable=False):
    spec = request["viewerRecovery"]
    name = spec["name"]
    provider = OAuth2Provider.objects.filter(name="StackPilot Jellyfin", client_id="stackpilot-jellyfin").first()
    flow = provider.authorization_flow if provider else None
    if not flow or flow.slug != "stackpilot-authorization":
        return False
    bindings = FlowStageBinding.objects.filter(target=flow)
    mfa = AuthenticatorValidateStage.objects.filter(name="stackpilot-required-mfa", not_configured_action="deny").first()
    if (not mfa or set(mfa.device_classes) != {"totp", "webauthn", "static"} or
        not bindings.filter(stage=mfa, order=10).exists() or
        not bindings.filter(stage__name="stackpilot-approval", order=20).exists()):
        return False
    stage = AuthenticatorStaticStage.objects.filter(name=name).first()
    policy = ExpressionPolicy.objects.filter(name=name).first()
    binding = bindings.filter(order=spec["order"]).first()
    if not stage and not policy and not binding and enable:
        stage = AuthenticatorStaticStage.objects.create(name=name, token_count=spec["count"], token_length=spec["length"])
        binding = FlowStageBinding.objects.create(target=flow, stage=stage, order=spec["order"], evaluate_on_plan=False, re_evaluate_policies=True)
        policy = ExpressionPolicy.objects.create(name=name, expression=spec["expression"])
        PolicyBinding.objects.create(target=binding, policy=policy, order=0, enabled=True, failure_result=False)
    if (not stage or not policy or not binding or binding.stage_id != stage.pk or
        stage.token_count != spec["count"] or stage.token_length != spec["length"] or
        binding.evaluate_on_plan or not binding.re_evaluate_policies or
        policy.expression.strip() != spec["expression"] or bindings.filter(order=spec["order"]).count() != 1):
        return False
    policies = PolicyBinding.objects.filter(target=binding)
    return policies.count() == 1 and policies.filter(policy=policy, order=0, enabled=True, failure_result=False).exists()

@transaction.atomic
def passkey_enrollment(enable=False):
    spec = request["passkeyEnrollment"]
    if not login_improved():
        return False
    flow = OAuth2Provider.objects.get(client_id="stackpilot-jellyfin", name="StackPilot Jellyfin").authorization_flow
    passkey = AuthenticatorWebAuthnStage.objects.get(name=request["viewerPasskey"])
    finish = DummyStage.objects.filter(name=spec["finish"]).first()
    orders = [g["order"] for g in spec["gates"]]
    bindings = FlowStageBinding.objects.filter(target=flow, order__in=orders)
    known = ExpressionPolicy.objects.filter(name__in=[g["name"] for g in spec["gates"]])
    if enable and not finish and not bindings.exists() and not known.exists() and not Stage.objects.filter(name=spec["finish"]).exists():
        finish = DummyStage.objects.create(name=spec["finish"])
        for stage, gate in zip([passkey, finish], spec["gates"]):
            binding = FlowStageBinding.objects.create(target=flow, stage=stage, order=gate["order"],
                evaluate_on_plan=False, re_evaluate_policies=True)
            policy = ExpressionPolicy.objects.create(name=gate["name"], expression=gate["expression"])
            PolicyBinding.objects.create(target=binding, policy=policy, order=0, enabled=True, failure_result=False)
    if not finish or bindings.count() != len(orders):
        return False
    for stage, gate in zip([passkey, finish], spec["gates"]):
        binding = bindings.filter(stage=stage, order=gate["order"], evaluate_on_plan=False, re_evaluate_policies=True).first()
        policy = known.filter(name=gate["name"], expression=gate["expression"]).first()
        attached = PolicyBinding.objects.filter(target=binding) if binding else None
        if not policy or attached is None or attached.count() != 1 or not attached.filter(
            policy=policy, order=0, enabled=True, failure_result=False).exists():
            return False
    return True

if action in ("invite", "reset", "remove", "library-stage", "library-commit", "library-cancel", "add-passkey", "cancel-passkey"):
    name = request.get("username", "")
    if not re.fullmatch(r"[a-z][a-z0-9_-]{2,31}", name):
        raise SystemExit("STACKPILOT_VIEWERS=" + json.dumps({"error": "invalid"}))
if action == "invite":
    if User.objects.filter(username=name).exists():
        result["error"] = "exists"
    else:
        user = User(username=name, name=request.get("displayName") or name, is_active=True)
        user.set_password(request["password"])
        if password_choice():
            user.attributes[request["viewerPassword"]["attribute"]] = True
        user.save()
        group.users.add(user)
        result["created"] = True
elif action in ("reset", "remove"):
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=viewer(name).pk)
        if user.attributes.get("stackpilot_library_change"):
            result["error"] = "library-pending"
        else:
            user.attributes.pop(request["passkeyEnrollment"]["pending"], None)
            if action == "reset":
                # A viewer who lost access sets up MFA again with a new temporary password.
                for device in list(devices_for_user(user, confirmed=None)):
                    device.delete()
                user.set_password(request["password"])
                if password_choice():
                    user.attributes[request["viewerPassword"]["attribute"]] = True
                user.is_active = True
                result["reset"] = True
            else:
                user.is_active = False
                user.set_unusable_password()
                result["removed"] = True
            user.save()
    if result.get("removed"):
        try:
            from authentik.core.models import AuthenticatedSession
            AuthenticatedSession.objects.filter(user=user).delete()
        except Exception:
            result["sessions"] = "unknown"
elif action == "library-claims":
    scope = ScopeMapping.objects.filter(managed="io.stackpilot.identity.profile", scope_name="profile").first()
    provider = OAuth2Provider.objects.filter(client_id="stackpilot-jellyfin", property_mappings=scope).first() if scope else None
    if not provider or scope.expression.strip() not in (request["previous"], request["expression"]):
        result["error"] = "library"
    elif scope.expression.strip() != request["expression"]:
        scope.expression = request["expression"]
        scope.save(update_fields=["expression"])
elif action in ("library-stage", "library-commit", "library-cancel"):
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=viewer(name).pk)
        attrs = user.attributes.copy()
        lock = attrs.get("stackpilot_library_change")
        operation = request["operation"]
        if (action != "library-cancel" and not user.is_active) or (lock is not None and lock != operation):
            result["error"] = "library"
        elif action == "library-stage":
            attrs["stackpilot_library_change"] = operation
        elif action == "library-commit":
            if request["profileId"]:
                attrs["stackpilot_viewer_profile"] = request["profileId"]
                attrs["stackpilot_viewer_folders"] = request["folders"]
            else:
                attrs.pop("stackpilot_viewer_profile", None)
                attrs.pop("stackpilot_viewer_folders", None)
            attrs.pop("stackpilot_library_change", None)
        else:
            attrs.pop("stackpilot_library_change", None)
        if not result:
            user.attributes = attrs
            user.save(update_fields=["attributes"])
elif action in ("add-passkey", "cancel-passkey"):
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=viewer(name).pk)
        key = request["passkeyEnrollment"]["pending"]
        if action == "cancel-passkey":
            user.attributes.pop(key, None)
        else:
            devices = list(devices_for_user(user))
            if not user.is_active or not any(type(d).__name__ in ("TOTPDevice", "WebAuthnDevice") for d in devices) or not passkey_enrollment():
                result["error"] = "passkey"
            else:
                user.attributes[key] = sorted(str(d.pk) for d in devices if type(d).__name__ == "WebAuthnDevice")
        if not result:
            user.save(update_fields=["attributes"])
elif action == "enable-recovery":
    if not recovery_enabled(enable=True):
        result["error"] = "recovery"
elif action == "improve-login":
    with transaction.atomic():
        if not login_improved(enable=True) or not password_choice(enable=True) or not passkey_enrollment(enable=True):
            transaction.set_rollback(True)
            result["error"] = "login"
elif action != "list":
    result["error"] = "action"
if not action.startswith("library-"):
    result["recoveryEnabled"] = recovery_enabled()
    result["loginImproved"] = login_improved()
    result["passwordChoice"] = password_choice()
    result["addPasskeyReady"] = passkey_enrollment()
    result["viewers"] = [row(u) for u in group.users.order_by("username") if not u.is_superuser]
print("STACKPILOT_VIEWERS=" + json.dumps(result))
