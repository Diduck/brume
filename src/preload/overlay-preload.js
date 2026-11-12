'use strict';
// Pont minimal et sûr entre les pages (sans accès à Node) et le processus principal.
// Utilisé par toutes les pages : météo, interface, fond d'écran, ouverture, réglages.
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (callback) => {
  const handler = (_event, data) => callback(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('brume', {
  onState: listen('state'),
  onWindows: listen('windows'),
  onCursor: listen('cursor'),
  onCommand: listen('command'),
  onPaused: listen('paused'),
  onStats: listen('stats'),
  setInteractive: (on) => ipcRenderer.send('overlay:interactive', !!on),
  setIdle: (idle) => ipcRenderer.send('overlay:idle', !!idle),
  setSettings: (patch) => ipcRenderer.send('overlay:set', patch),
  welcomeDone: () => ipcRenderer.send('overlay:welcome-done'),
  toast: (text) => ipcRenderer.send('overlay:toast', String(text)),
  stats: (s) => ipcRenderer.send('overlay:stats', s),
  snapshot: (image) => ipcRenderer.send('wallpaper:snapshot', image),
  introDone: () => ipcRenderer.send('intro:done'),
  // Enregistrement de l'animation en vidéo (écran de verrouillage) : une image à la fois.
  recordFrame: (buf) => ipcRenderer.invoke('record:frame', buf),
  recordDone: (info) => ipcRenderer.send('record:done', info || null),
  // Fenêtre de Brume (réglages) et vignettes des scènes.
  onThumbs: listen('thumbs'),
  thumb: (key, url) => ipcRenderer.send('wallpaper:thumb', { key: String(key), url: typeof url === 'string' ? url : null }),
  hidePanel: () => ipcRenderer.send('panel:hide'),
  panelHeight: (h) => ipcRenderer.send('panel:height', Number(h) || 0),
  playIntro: () => ipcRenderer.send('intro:play'),
});
