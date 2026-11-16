export const viewerPassword = {
  attribute: "stackpilot_password_pending",
  prompt: "stackpilot-viewer-password-prompt",
  write: "stackpilot-viewer-password-write",
  gate: "stackpilot-viewer-password-pending",
  validation: "stackpilot-viewer-password-validation",
  fields: ["stackpilot-viewer-new-password", "stackpilot-viewer-repeat-password"],
  gateExpression: `u = request.user
return bool(u.is_authenticated and u.is_active and not u.is_superuser
    and ak_is_group_member(u, name="stackpilot-viewers")
    and u.attributes.get("stackpilot_password_pending") is True)`,
  validateExpression: `data = request.context.get("prompt_data", {})
password = data.get("password", "")
if not 12 <= len(password) <= 128 or request.user.check_password(password):
    ak_message("Wähle ein neues Passwort mit 12 bis 128 Zeichen.")
    return False
data.pop("password_repeat", None)
data["attributes.stackpilot_password_pending"] = False
return True`,
};

export function viewerPasswordEntries(target) {
  const spec = viewerPassword;
  const expressions = [[spec.gate, spec.gateExpression], [spec.validation, spec.validateExpression]];
  return `${expressions.map(([name, expression]) => `- model: authentik_policies_expression.expressionpolicy
  identifiers: {name: ${name}}
  attrs:
    expression: |-
      ${expression.replaceAll("\n", "\n      ")}
  id: ${name}`).join("\n")}
${[["password", "Eigenes Passwort"], ["password_repeat", "Eigenes Passwort wiederholen"]]
    .map(([key, label], i) => `- model: authentik_stages_prompt.prompt
  identifiers: {name: ${spec.fields[i]}}
  attrs: {field_key: ${key}, label: "${label}", type: password, required: true, order: ${i}}
  id: ${spec.fields[i]}`).join("\n")}
- model: authentik_stages_prompt.promptstage
  identifiers: {name: ${spec.prompt}}
  attrs:
    fields:
    - !KeyOf ${spec.fields[0]}
    - !KeyOf ${spec.fields[1]}
    validation_policies: [!KeyOf ${spec.validation}]
  id: ${spec.prompt}
- model: authentik_stages_user_write.userwritestage
  identifiers: {name: ${spec.write}}
  attrs: {user_creation_mode: never_create}
  id: ${spec.write}
${[[spec.prompt, 12], [spec.write, 13]].map(([stage, order]) => `- model: authentik_flows.flowstagebinding
  identifiers:
    target: ${target}
    stage: !KeyOf ${stage}
    order: ${order}
  attrs: {re_evaluate_policies: true, evaluate_on_plan: false}
  id: ${stage}-binding
- model: authentik_policies.policybinding
  identifiers:
    target: !KeyOf ${stage}-binding
    policy: !KeyOf ${spec.gate}
    order: 0
  attrs: {enabled: true, failure_result: false}`).join("\n")}
`;
}

export function viewerPasswordUpgrade() {
  return `version: 1\nmetadata:\n  name: StackPilot viewer password setup\nentries:\n${viewerPasswordEntries(
    "!Find [authentik_flows.flow, [slug, stackpilot-authorization]]",
  )}`;
}
