# Fixed program; only aggregate settings cross stdout. No account or MFA material.
import json, sys
from django.db import transaction
request = json.loads(sys.stdin.read())
expected = request["expected"]
assert expected.startswith("https://") and expected.endswith(".ts.net:8443")
result = {"supported": False, "baseUrl": "unsupported", "avatars": "unknown", "changed": False}
try:
    from authentik.admin.models import SystemSettings
except ImportError:
    pass
else:
    with transaction.atomic():
        settings = SystemSettings.objects.select_for_update().filter(pk=True).first()
        if settings:
            result["supported"] = True
            result["baseUrl"] = "expected" if settings.base_url.rstrip("/") == expected else "missing" if not settings.base_url else "different"
            result["avatars"] = "initials" if settings.avatars == "initials" else "other"
            if request.get("apply") and result["baseUrl"] == "missing":
                settings.base_url = expected
                settings.save(update_fields=["base_url"])
                result["baseUrl"] = "expected"
                result["changed"] = True
print("STACKPILOT_SETTINGS=" + json.dumps(result))
