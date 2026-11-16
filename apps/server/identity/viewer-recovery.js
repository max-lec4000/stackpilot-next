export const viewerRecovery = {
  name: "stackpilot-viewer-recovery",
  order: 15,
  count: 8,
  length: 16,
  expression: [
    'u = request.context.get("pending_user") or request.user',
    'return (u.is_authenticated and not u.is_superuser',
    '        and ak_is_group_member(u, name="stackpilot-viewers")',
    '        and not ak_user_has_authenticator(u, "static"))',
  ].join("\n"),
};
