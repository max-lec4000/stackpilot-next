import { validateIdentityInput } from "./config.js";
import { viewerRecovery } from "./viewer-recovery.js";
import { baseViewerClaims } from "./viewer-library-roles.js";
import { passkeyEnrollmentEntries } from "./viewer-passkey-enrollment.js";
import { viewerMfa, viewerPasskey } from "./viewer-mfa.js";
import { viewerPasswordEntries } from "./viewer-password.js";
export function identityBlueprint(input) {
  const { hostname } = validateIdentityInput(input);
  return `version: 1
metadata:
  name: StackPilot identity security baseline v3
entries:
- model: authentik_core.group
  identifiers: {name: stackpilot-viewers}
  attrs: {is_superuser: false}
  id: viewers
- model: authentik_flows.flow
  identifiers: {slug: stackpilot-authentication}
  attrs: {name: StackPilot Zuschauer-Anmeldung, title: Jellyfin Anmeldung, designation: authentication, authentication: none}
  id: public-login
- model: authentik_flows.flow
  identifiers: {slug: stackpilot-authorization}
  attrs: {name: StackPilot MFA authorization, title: Jellyfin Zugriff bestätigen, designation: authorization, authentication: require_authenticated}
  id: authorization
- model: authentik_flows.flow
  identifiers: {slug: stackpilot-admin-login}
  attrs: {name: StackPilot private administration, title: Private Verwaltung, designation: authentication, authentication: none}
  id: admin-login
- model: authentik_flows.flow
  identifiers: {slug: stackpilot-invalidation}
  attrs: {name: StackPilot logout, title: Abgemeldet, designation: invalidation, authentication: none}
  id: invalidation
- model: authentik_stages_user_logout.userlogoutstage
  identifiers: {name: stackpilot-end-session}
  id: logout
- model: authentik_flows.flowstagebinding
  identifiers:
    target: !KeyOf invalidation
    stage: !KeyOf logout
    order: 0
- model: authentik_stages_identification.identificationstage
  identifiers: {name: stackpilot-identification}
  attrs: {user_fields: [username], show_matched_user: false, pretend_user_exists: true, enable_remember_me: false}
  id: identification
- model: authentik_stages_password.passwordstage
  identifiers: {name: stackpilot-password}
  attrs: {backends: [authentik.core.auth.InbuiltBackend], failed_attempts_before_cancel: 3}
  id: password
- model: authentik_stages_authenticator_validate.authenticatorvalidatestage
  identifiers: {name: stackpilot-required-mfa}
  attrs:
    device_classes: [totp, webauthn, static]
    not_configured_action: deny
    last_auth_threshold: minutes=5
    webauthn_user_verification: required
    totp_otp_throttling_factor: 1
    static_otp_throttling_factor: 1
  id: required-mfa
- model: authentik_stages_authenticator_webauthn.authenticatorwebauthnstage
  identifiers: {name: ${viewerPasskey}}
  attrs: {friendly_name: Passkey, user_verification: required, resident_key_requirement: preferred, max_attempts: 3}
  id: viewer-passkey
- model: authentik_stages_authenticator_validate.authenticatorvalidatestage
  identifiers: {name: stackpilot-viewer-mfa}
  attrs:
    device_classes: [totp, webauthn, static]
    not_configured_action: configure
    configuration_stages:
    - !Find [authentik_stages_authenticator_totp.authenticatortotpstage, [name, default-authenticator-totp-setup]]
    - !KeyOf viewer-passkey
    last_auth_threshold: seconds=0
    webauthn_user_verification: required
    totp_otp_throttling_factor: 1
    static_otp_throttling_factor: 1
  id: viewer-mfa
- model: authentik_stages_authenticator_validate.authenticatorvalidatestage
  identifiers: {name: stackpilot-private-mfa-enrollment}
  attrs:
    device_classes: [totp, webauthn, static]
    not_configured_action: configure
    configuration_stages:
    - !Find [authentik_stages_authenticator_totp.authenticatortotpstage, [name, default-authenticator-totp-setup]]
    last_auth_threshold: seconds=0
    webauthn_user_verification: required
  id: private-mfa
- model: authentik_stages_user_login.userloginstage
  identifiers: {name: stackpilot-short-login}
  attrs: {session_duration: minutes=30, remember_me_offset: seconds=0, remember_device: seconds=0}
  id: login
- model: authentik_stages_consent.consentstage
  identifiers: {name: stackpilot-approval}
  attrs: {mode: always_require}
  id: consent
${["public-login", "admin-login"]
  .map((flow) =>
    [
      ["identification", 10],
      ["password", 20],
      // Zuschauer richten ihren zweiten Faktor bei der ersten Anmeldung selbst ein (Einladung);
      // die Freigabe für Jellyfin (authorization) verlangt weiterhin zwingend einen Faktor.
      [flow === "admin-login" ? "private-mfa" : "viewer-mfa", 30],
      ["login", 100],
    ]
      .map(
        ([stage, order]) => `- model: authentik_flows.flowstagebinding
  identifiers:
    target: !KeyOf ${flow}
    stage: !KeyOf ${stage}
    order: ${order}
  attrs: {re_evaluate_policies: true}
`,
      )
      .join(""),
  )
  .join("")}
${viewerPasswordEntries("!KeyOf authorization")}
${passkeyEnrollmentEntries()}
- model: authentik_stages_dummy.dummystage
  identifiers: {name: ${viewerMfa.stage}}
  id: viewer-login-proof
- model: authentik_flows.flowstagebinding
  identifiers:
    target: !KeyOf public-login
    stage: !KeyOf viewer-login-proof
    order: ${viewerMfa.order}
  attrs: {re_evaluate_policies: true, evaluate_on_plan: false}
  id: viewer-login-proof-binding
- model: authentik_flows.flowstagebinding
  identifiers:
    target: !KeyOf authorization
    stage: !KeyOf required-mfa
    order: 10
  attrs: {re_evaluate_policies: true, evaluate_on_plan: false}
  id: required-mfa-binding
${[
  [viewerMfa.record, viewerMfa.recordExpression, "viewer-login-proof-binding", false],
  [viewerMfa.require, viewerMfa.requireExpression, "required-mfa-binding", true],
].map(([name, expression, binding, fallback]) => `- model: authentik_policies_expression.expressionpolicy
  identifiers: {name: ${name}}
  attrs:
    expression: |-
      ${expression.replaceAll("\n", "\n      ")}
  id: ${name}
- model: authentik_policies.policybinding
  identifiers:
    target: !KeyOf ${binding}
    policy: !KeyOf ${name}
    order: 0
  attrs: {enabled: true, failure_result: ${fallback}}
`).join("")}
- model: authentik_stages_authenticator_static.authenticatorstaticstage
  identifiers: {name: ${viewerRecovery.name}}
  attrs: {token_count: ${viewerRecovery.count}, token_length: ${viewerRecovery.length}}
  id: viewer-recovery
- model: authentik_flows.flowstagebinding
  identifiers:
    target: !KeyOf authorization
    stage: !KeyOf viewer-recovery
    order: ${viewerRecovery.order}
  attrs: {re_evaluate_policies: true, evaluate_on_plan: false}
  id: viewer-recovery-binding
- model: authentik_policies_expression.expressionpolicy
  identifiers: {name: ${viewerRecovery.name}}
  attrs:
    expression: |-
      ${viewerRecovery.expression.replaceAll("\n", "\n      ")}
  id: viewer-recovery-policy
- model: authentik_policies.policybinding
  identifiers:
    target: !KeyOf viewer-recovery-binding
    policy: !KeyOf viewer-recovery-policy
    order: 0
  attrs: {enabled: true, failure_result: false}
- model: authentik_flows.flowstagebinding
  identifiers:
    target: !KeyOf authorization
    stage: !KeyOf consent
    order: 20
- model: authentik_brands.brand
  identifiers: {domain: authentik-default, default: true}
  attrs:
    flow_authentication: !KeyOf admin-login
    flow_invalidation: !KeyOf invalidation
- model: authentik_providers_oauth2.scopemapping
  identifiers: {managed: io.stackpilot.identity.profile}
  attrs:
    name: StackPilot minimal Jellyfin profile
    scope_name: profile
    expression: |
      ${baseViewerClaims}
  id: profile-scope
- model: authentik_providers_oauth2.oauth2provider
  identifiers: {name: StackPilot Jellyfin}
  attrs:
    authentication_flow: !KeyOf public-login
    authorization_flow: !KeyOf authorization
    invalidation_flow: !KeyOf invalidation
    client_type: confidential
    client_id: stackpilot-jellyfin
    client_secret: !Env STACKPILOT_OIDC_SECRET
    grant_types: [authorization_code]
    redirect_uris:
    - {matching_mode: strict, url: "https://${hostname}/sso/OID/redirect/stackpilot", redirect_uri_type: authorization}
    access_code_validity: seconds=60
    access_token_validity: minutes=5
    refresh_token_validity: seconds=0
    include_claims_in_id_token: true
    signing_key: !Find [authentik_crypto.certificatekeypair, [name, authentik Self-signed Certificate]]
    property_mappings:
    - !Find [authentik_providers_oauth2.scopemapping, [managed, goauthentik.io/providers/oauth2/scope-openid]]
    - !KeyOf profile-scope
  id: oidc
- model: authentik_core.application
  identifiers: {slug: stackpilot-jellyfin}
  attrs:
    name: Jellyfin
    provider: !KeyOf oidc
    policy_engine_mode: all
  id: application
- model: authentik_policies_expression.expressionpolicy
  identifiers: {name: stackpilot-viewers-no-administrators}
  attrs:
    expression: |
      return request.user.is_authenticated and not request.user.is_superuser and request.user.groups.filter(name="stackpilot-viewers").exists()
  id: viewers-only
- model: authentik_policies.policybinding
  identifiers:
    target: !KeyOf application
    policy: !KeyOf viewers-only
    order: 0
  attrs: {enabled: true, failure_result: false}
`;
}
