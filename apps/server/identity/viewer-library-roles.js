export const baseViewerClaims = 'return {"preferred_username": "spv_" + request.user.username, "name": request.user.username, "groups": ["stackpilot-viewers"] if request.user.groups.filter(name="stackpilot-viewers").exists() else []}';

export function viewerClaims(libraries) {
  return `u = request.user
groups = []
if (u.is_active and not u.is_superuser and u.groups.filter(name="stackpilot-viewers").exists()
        and not u.attributes.get("stackpilot_library_change")):
    groups = ["stackpilot-viewers"]
    baseline = ${JSON.stringify(libraries)}
    selected = u.attributes.get("stackpilot_viewer_folders", baseline)
    if isinstance(selected, list):
        groups += ["stackpilot-library-" + folder for folder in baseline if folder in selected]
return {"preferred_username": "spv_" + u.username, "name": u.username, "groups": groups}`;
}
