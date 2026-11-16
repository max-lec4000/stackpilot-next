'use strict';
const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, arg) {
  const res = await ipcRenderer.invoke(channel, arg);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

contextBridge.exposeInMainWorld('cd', {
  call,
  on(channel, fn) {
    const allowed = ['input', 'toast', 'player-state', 'auth', 'socket', 'refresh', 'volume', 'activity', 'raw-input', 'player-loading', 'sound-profiles', 'youtube-bot-check'];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (_e, payload) => fn(payload));
  },
});
