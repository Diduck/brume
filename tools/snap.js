// Brume — capture d'une page dans une fenêtre cachée (aucun impact sur l'écran).
//   env -u ELECTRON_RUN_AS_NODE npx electron tools/snap.js <overlay|ui|settings|wallpaper|intro> <sortie.png> '<réglages JSON>' [largeur] [hauteur] [délai ms, ou plusieurs : 500,3000]
//   settings : la fenêtre de Brume (640 × 900 conseillé, hauteur max) ; SNAP_HASH=more déplie « Voir plus ».
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const [page = 'ui', out = 'snap.png', json = '{}', w = '1440', h = '900', delay = '2500'] = process.argv.slice(2);
const W = Number(w);
const H = Number(h);
const PRELOAD = path.join(__dirname, '../src/preload/overlay-preload.js');

// Fenêtre de réglages : ses vignettes sont peintes par une page du fond d'écran cachée,
// comme dans l'app (main.js, makeThumbs).
function sendThumbs(target) {
  const { ipcMain } = require('electron');
  const PAL = require('../src/shared/palettes');
  const keys = [...new Set([...PAL.ORDER, ...Object.keys(PAL.PALETTES)])].filter((k) => PAL.PALETTES[k]);
  const list = keys.map((key) => ({ key, effect: Object.keys(PAL.AUTO).find((e) => PAL.AUTO[e] === key) || 'none' }));
  // Comme dans l'app, la fenêtre prend la hauteur annoncée par la page (bornée par H).
  ipcMain.on('panel:height', (_e, ph) => !target.isDestroyed() && target.setContentSize(W, Math.min(H, Math.round(ph))));
  const painter = new BrowserWindow({ show: false, width: 384, height: 240, webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true } });
  ipcMain.on('wallpaper:thumb', (_e, { key, url }) => !target.isDestroyed() && target.webContents.send('thumbs', { [key]: url }));
  painter.webContents.on('did-finish-load', () => painter.webContents.send('command', { type: 'thumbs', list, w: 384, h: 240 }));
  painter.loadFile(path.join(__dirname, '../src/renderer/wallpaper.html'), { hash: 'thumbs' });
}

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    frame: false,
    backgroundColor: '#5b6f8c', // un « fond d'écran » neutre pour juger la carte
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.webContents.on('console-message', (e) => console.log(`[page] ${e.message}`));
  win.loadFile(path.join(__dirname, `../src/renderer/${page}.html`), process.env.SNAP_HASH ? { hash: process.env.SNAP_HASH } : {});
  win.webContents.on('did-finish-load', () => {
    const settings = { effect: 'snow', aurora: false, wallpaper: 'off', intensity: 'normal', wind: 0, behind: true, accumulate: true, snowballs: true, stats: false, ...JSON.parse(json) };
    win.webContents.send('state', { settings, paused: false, display: { id: 1, width: W, height: H, workTop: 25, groundY: H, primary: true } });
    win.webContents.send('windows', { list: [], closed: [], back: true });
    if (page === 'ui') win.webContents.send('command', { type: 'toast', text: 'Fond d’écran : Forêt — Des sapins, un lac et des lucioles.' });
    if (page === 'settings') sendThumbs(win);
    // SNAP_MAGIC=1 : coup de baguette simulé (easter egg de la scène Drones).
    if (process.env.SNAP_MAGIC) setTimeout(() => win.webContents.send('command', { type: 'magic', path: Array.from({ length: 40 }, (_, i) => ({ x: W / 2 + 60 * Math.cos(i / 6), y: H / 3 + 60 * Math.sin(i / 6) + (i > 30 ? (i - 30) * 20 : 0) })) }), 300);
    if (page === 'intro') win.webContents.send('command', { type: 'intro', key: settings.wallpaper, effect: settings.effect, name: require('node:os').userInfo().username });
    // Plusieurs délais possibles (« 500,3000,6000 ») : une capture par délai, suffixée.
    const delays = String(delay).split(',').map(Number);
    let left = delays.length;
    for (const d of delays) {
      setTimeout(async () => {
        const img = await win.webContents.capturePage();
        const file = delays.length > 1 ? out.replace(/\.png$/, `-${d}.png`) : out;
        fs.writeFileSync(file, img.toPNG());
        console.log(`capture : ${file}`);
        if (--left === 0) app.quit();
      }, d);
    }
  });
});
