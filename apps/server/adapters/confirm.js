// Gemeinsamer Baustein der App-Adapter: Eine Änderung gilt erst als erledigt, wenn die App
// den neuen Zustand beim Zurücklesen bestätigt (Leitlinie „App = Quelle der Wahrheit“).
export const userFacing = (message) => Object.assign(new Error(message), { userFacing: true });

/** write() ausführen, read() zurücklesen, check(after) muss stimmen – sonst Fehler mit message. */
export async function writeAndConfirm({ write, read, check, message }) {
  await write();
  const after = await read();
  if (!check(after)) throw userFacing(message);
  return after;
}
