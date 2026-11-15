// Only explicit, non-secret setup guidance may cross the read-only API boundary.
export function setupError(message) {
  return Object.assign(new Error(message), { userFacing: true });
}
