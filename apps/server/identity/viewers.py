# Runs only inside the managed Authentik worker. Fixed program; request arrives as JSON on stdin.
# Never prints passwords, tokens or MFA material.
import json, re, sys
from authentik.core.models import Group, User
from authentik.stages.authenticator import devices_for_user

request = json.loads(sys.stdin.read())
action = request.get("action")
group = Group.objects.get(name="stackpilot-viewers")
result = {}

def row(user):
    devices = list(devices_for_user(user))
    return {
        "username": user.username,
        "name": user.name,
        "active": user.is_active,
        "mfa": any(type(d).__name__ in ("TOTPDevice", "WebAuthnDevice") for d in devices),
        "lastLogin": user.last_login.isoformat() if user.last_login else None,
    }

def viewer(name):
    user = group.users.filter(username=name).first()
    if not user or user.is_superuser:
        raise SystemExit("STACKPILOT_VIEWERS=" + json.dumps({"error": "missing"}))
    return user

if action in ("invite", "reset", "remove"):
    name = request.get("username", "")
    if not re.fullmatch(r"[a-z][a-z0-9_-]{2,31}", name):
        raise SystemExit("STACKPILOT_VIEWERS=" + json.dumps({"error": "invalid"}))
if action == "invite":
    if User.objects.filter(username=name).exists():
        result["error"] = "exists"
    else:
        user = User(username=name, name=request.get("displayName") or name, is_active=True)
        user.set_password(request["password"])
        user.save()
        group.users.add(user)
        result["created"] = True
elif action == "reset":
    # New start for a viewer who lost access: new password, second factor must be set up again.
    user = viewer(name)
    for device in list(devices_for_user(user, confirmed=None)):
        device.delete()
    user.set_password(request["password"])
    user.is_active = True
    user.save()
    result["reset"] = True
elif action == "remove":
    user = viewer(name)
    user.is_active = False
    user.set_unusable_password()
    user.save()
    try:
        from authentik.core.models import AuthenticatedSession
        AuthenticatedSession.objects.filter(user=user).delete()
    except Exception:
        result["sessions"] = "unknown"
    result["removed"] = True
elif action != "list":
    result["error"] = "action"
result["viewers"] = [row(u) for u in group.users.order_by("username") if not u.is_superuser]
print("STACKPILOT_VIEWERS=" + json.dumps(result))
