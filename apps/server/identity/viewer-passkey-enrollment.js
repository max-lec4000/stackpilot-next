const pending = "stackpilot_add_passkey";
const test = `u = http_request.user
if (not u.is_authenticated or not u.is_active or u.is_superuser
        or not ak_is_group_member(u, name="stackpilot-viewers")):
    return False`;
const devices = `from authentik.stages.authenticator import devices_for_user
ids = {str(d.pk) for d in devices_for_user(u) if type(d).__name__ == "WebAuthnDevice"}`;

export const passkeyEnrollment = {
  pending,
  finish: "stackpilot-finish-passkey-enrollment",
  gates: [
    {
      stage: "viewer-passkey",
      order: 16,
      name: "stackpilot-add-passkey-pending",
      expression: `${test}
before = u.attributes.get("${pending}")
if not isinstance(before, list):
    return False
${devices}
return not ids.difference(before)`,
    },
    {
      stage: "viewer-passkey-finish",
      order: 17,
      name: "stackpilot-clear-passkey-pending",
      expression: `${test}
from authentik.core.models import User
from django.db import transaction
with transaction.atomic():
    u = User.objects.select_for_update().get(pk=u.pk)
    before = u.attributes.get("${pending}")
    if isinstance(before, list):
        ${devices.replaceAll("\n", "\n        ")}
        if ids.difference(before):
            u.attributes.pop("${pending}", None)
            u.save(update_fields=["attributes"])
return False`,
    },
  ],
};

export function passkeyEnrollmentEntries() {
  return `- model: authentik_stages_dummy.dummystage
  identifiers: {name: ${passkeyEnrollment.finish}}
  id: viewer-passkey-finish
${passkeyEnrollment.gates.map(({ stage, order, name, expression }) => `- model: authentik_policies_expression.expressionpolicy
  identifiers: {name: ${name}}
  attrs:
    expression: |-
      ${expression.replaceAll("\n", "\n      ")}
  id: ${name}
- model: authentik_flows.flowstagebinding
  identifiers:
    target: !KeyOf authorization
    stage: !KeyOf ${stage}
    order: ${order}
  attrs: {re_evaluate_policies: true, evaluate_on_plan: false}
  id: ${name}-binding
- model: authentik_policies.policybinding
  identifiers:
    target: !KeyOf ${name}-binding
    policy: !KeyOf ${name}
    order: 0
  attrs: {enabled: true, failure_result: false}
`).join("")}`;
}
