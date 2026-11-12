'use strict';
/*
 * Brume — processus principal.
 *
 * Deux couches transparentes, « traversables » par la souris :
 *  • la MÉTÉO (une fenêtre par écran). En mode « derrière les fenêtres », elle est au
 *    niveau normal et rangée TOUT AU FOND : c'est macOS lui-même qui la cache derrière
 *    tes applications, la barre des menus et le Dock — aucune découpe approximative.
 *    En mode « devant », elle passe au niveau économiseur d'écran, au-dessus de tout.
 *  • l'INTERFACE (écran principal), toujours au-dessus et jamais cliquable :
 *    notifications et statistiques.
 *
 * Et une vraie fenêtre macOS, la FENÊTRE DE BRUME (accueil et réglages) : on la déplace,
 * elle passe derrière les autres apps, le bouton rouge la cache (Brume continue dans la
 * barre des menus) ; le flocon ou `open Brume.app` la ramène devant.
 *
 * Plus : le traqueur des vraies fenêtres, le curseur 60 fois/s, la barre des menus,
 * les réglages et la pause automatique.
 */
const { app, BrowserWindow, Tray, Menu, screen, ipcMain, nativeImage, powerMonitor, globalShortcut } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const S = require('../shared/strings');
const PAL = require('../shared/palettes');
const settings = require('./settings');
const { WindowTracker } = require('./window-tracker');
const weather = require('./weather');
const desktopPicture = require('./desktop-picture');
const lockscreen = require('./lockscreen');

const EFFECTS = ['none', 'snow', 'rain', 'storm', 'sakura', 'leaves', 'fireflies', 'starfall'];
const WALLPAPERS = PAL.ORDER;
const wallLayers = new Map(); // display.id -> { win, display, ready, stillKey }
const PAUSE_SHORTCUT = 'Alt+Command+B';
const PRELOAD = path.join(__dirname, '../preload/overlay-preload.js');

const overlays = new Map(); // display.id -> { win, display, ready, idle, interactive, cursorInside }
let uiLayer = null; // { win, ready, interactive }
let panel = null; // fenêtre de Brume : { win, ready, wantShow }
let quitting = false;
const PANEL_SIZE = { width: 640, height: 640 }; // hauteur de départ : la page annonce ensuite la sienne
const THUMB_SIZE = { width: 384, height: 240 };
const thumbs = {}; // scène -> vignette (data URL PNG), peinte une fois par lancement
let thumbPainter = null;
let tray = null;
let tracker = null;
let latestWindows = [];
let userPaused = false;
let onBattery = false;
let locked = false;
let announcedRealWeather = false;
let lastCursor = { x: NaN, y: NaN };
let intro = null; // { win, startedAt, from } pendant une animation d'ouverture

/* ---------- Robustesse : journal d'erreurs et réparation automatique ---------- */
const LOG_FILE = path.join(app.getPath('userData'), 'brume.log');
function log(...parts) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${parts.join(' ')}\n`);
  } catch {
    /* rien à faire si le disque refuse */
  }
}
// Une erreur ne fait plus quitter Brume : on la note et on continue.
process.on('uncaughtException', (err) => log('exception :', err && err.stack ? err.stack : err));
process.on('unhandledRejection', (err) => log('promesse rejetée :', err && err.stack ? err.stack : err));
// Une page qui plante (météo, interface, fond d'écran) est rechargée toute seule.
app.on('render-process-gone', (_event, contents, details) => {
  log('page plantée :', details.reason, details.exitCode);
  setTimeout(() => !contents.isDestroyed() && contents.reload(), 1000);
});
app.on('child-process-gone', (_event, details) => log('processus arrêté :', details.type, details.reason, details.exitCode));
app.on('will-quit', () => log('fermeture de Brume'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showPanel());
  app.on('activate', () => showPanel()); // rouvrir Brume.app (Finder, `open`) ramène sa fenêtre devant
  app.whenReady().then(init);
}

// Brume vit dans la barre des menus : fermer une fenêtre ne doit jamais quitter l'app.
app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  quitting = true; // la fenêtre de Brume peut alors vraiment se fermer
  if (panel) savePanelBounds();
});
app.on('will-quit', () => {
  if (tracker) tracker.stop();
  globalShortcut.unregisterAll();
});

function init() {
  log('démarrage de Brume', app.getVersion());
  if (app.dock) app.dock.hide();
  settings.load(app.getPath('userData'));
  setAppMenu();
  onBattery = powerMonitor.isOnBatteryPower();

  createTray();
  createUiLayer();
  rebuildOverlays();

  tracker = new WindowTracker(onWindows);
  tracker.start();

  startCursorPump();
  setupPower();
  setupDisplays();
  setupIpc();
  globalShortcut.register(PAUSE_SHORTCUT, togglePause);

  if (settings.get().realWeather) refreshRealWeather();
  if (settings.get().lockScreen || settings.get().lockScreenSaved) scheduleLockVideo(8000);
  // Une vidéo restée comme fond (ancienne version, plantage) : retour à l'image fixe.
  if (settings.get().lockScreenSaved) setTimeout(() => lockVideoOff(true), 6000);
  setInterval(() => settings.get().realWeather && refreshRealWeather(), 20 * 60 * 1000);
  // « Auto » change de scène toutes les 3 heures : on suit (image fixe, vidéo, menu).
  let autoKey = PAL.resolve(settings.get().wallpaper, settings.get().effect);
  setInterval(() => {
    const st = settings.get();
    if (st.wallpaper !== 'auto') return;
    const k = PAL.resolve(st.wallpaper, st.effect);
    if (k === autoKey) return;
    autoKey = k;
    broadcastState();
    rebuildMenu();
    for (const layer of wallLayers.values()) if (layer.ready) scheduleStill(layer);
    if (st.lockScreen) scheduleLockVideo();
  }, 5 * 60 * 1000);
  if (!settings.get().welcomeSeen) setTimeout(() => showPanel(), 900);
}

/* ---------- Fenêtres transparentes ---------- */

// panel : NSPanel non activant, qui peut s'afficher au-dessus des apps en plein écran.
// Sans panel : fenêtre normale, absente des bureaux plein écran (macOS place toujours
// un panel AU-DESSUS d'une app plein écran, il ne peut donc pas servir de fond).
function transparentWindow(bounds, { panel = true, desktop = false } = {}) {
  const win = new BrowserWindow({
    ...bounds,
    ...(desktop ? { type: 'desktop' } : panel ? { type: 'panel' } : {}),
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    enableLargerThanScreen: true,
    roundedCorners: false,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: panel && !desktop, skipTransformProcessType: true });
  win.setHiddenInMissionControl(true); // aucune fenêtre « Brume » parasite dans Mission Control
  win.setBounds(bounds);
  if (!app.isPackaged) win.webContents.on('console-message', (e) => console.log(`[page] ${e.message}`));
  return win;
}

function displayInfo(display) {
  const b = display.bounds;
  const wa = display.workArea;
  return {
    id: display.id,
    width: b.width,
    height: b.height,
    workTop: wa.y - b.y,
    groundY: wa.y + wa.height - b.y,
    primary: display.id === screen.getPrimaryDisplay().id,
  };
}

function stateFor(display) {
  return { settings: settings.get(), paused: isPaused(), display: displayInfo(display) };
}

/* Couche météo */

function createOverlay(display) {
  const win = transparentWindow(display.bounds);
  // Toujours au-dessus : en mode « derrière les fenêtres », la page découpe la météo à
  // la forme de chaque fenêtre (et de la barre des menus / du Dock). Ranger la couche
  // « au fond » était fragile (macOS la remontait parfois devant une app).
  win.setAlwaysOnTop(true, 'screen-saver');
  const entry = { win, display, ready: false, idle: false, interactive: false, cursorInside: false };
  overlays.set(display.id, entry);
  win.webContents.on('did-finish-load', () => {
    entry.ready = true;
    send(entry, 'state', stateFor(entry.display));
    send(entry, 'windows', { list: localWindows(entry.display), closed: [] });
    updateVisibility();
  });
  win.loadFile(path.join(__dirname, '../renderer/overlay.html'));
}

function rebuildOverlays() {
  const displays = screen.getAllDisplays();
  const ids = new Set(displays.map((d) => d.id));
  for (const [id, entry] of overlays) {
    if (!ids.has(id)) {
      entry.win.destroy();
      overlays.delete(id);
    }
  }
  for (const d of displays) {
    const entry = overlays.get(d.id);
    if (!entry) {
      createOverlay(d);
      continue;
    }
    entry.display = d;
    entry.win.setBounds(d.bounds);
    if (entry.ready) {
      send(entry, 'state', stateFor(d));
      send(entry, 'windows', { list: localWindows(d), closed: [] });
    }
  }
  if (uiLayer) {
    uiLayer.win.setBounds(screen.getPrimaryDisplay().bounds);
    if (uiLayer.ready) send(uiLayer, 'state', stateFor(screen.getPrimaryDisplay()));
  }
  // Un écran débranché ne doit pas emporter la fenêtre de Brume hors de vue.
  if (panel && !panel.win.isDestroyed()) panel.win.setBounds(panelBounds(panel.win.getBounds()));
  syncWallpaper();
}

/* Couche fond d'écran animé (niveau du bureau : sous les icônes et sous toutes les fenêtres) */

function syncWallpaper() {
  const s = settings.get();
  const on = s.wallpaper !== 'off';
  const displays = on ? screen.getAllDisplays() : [];
  const ids = new Set(displays.map((d) => d.id));
  for (const [id, layer] of wallLayers) {
    if (!ids.has(id)) {
      layer.win.destroy();
      wallLayers.delete(id);
    }
  }
  for (const d of displays) {
    let layer = wallLayers.get(d.id);
    if (!layer) {
      const win = transparentWindow(d.bounds, { desktop: true });
      layer = { win, display: d, ready: false, stillKey: null };
      wallLayers.set(d.id, layer);
      win.webContents.on('did-finish-load', () => {
        layer.ready = true;
        send(layer, 'state', stateFor(layer.display));
        win.showInactive();
        scheduleStill(layer);
      });
      win.loadFile(path.join(__dirname, '../renderer/wallpaper.html'));
      continue;
    }
    layer.display = d;
    layer.win.setBounds(d.bounds);
    if (layer.ready) {
      send(layer, 'state', stateFor(d));
      scheduleStill(layer);
    }
  }
  if (!on) restoreOriginalWallpapers();
}

// Une fois le fondu terminé, on fige la scène et on en fait le vrai fond d'écran macOS.
// La clé n'est retenue qu'après réussite : en cas d'échec (page en pause…), on réessaie.
function scheduleStill(layer) {
  const s = settings.get();
  const scene = PAL.resolve(s.wallpaper, s.effect);
  // L'image fixe dépend de la scène ET du temps choisi (neige, pluie…).
  const key = scene && `${scene}-${s.effect}`;
  if (!key || key === layer.stillKey || key === layer.pendingKey || isPaused()) return;
  layer.pendingKey = key;
  clearTimeout(layer.stillTimer);
  layer.stillTimer = setTimeout(() => send(layer, 'command', { type: 'snapshot' }), 2500);
}

// Le fond d'origine n'est lu qu'une fois, même avec plusieurs écrans qui changent en même temps.
let originalsPromise = null;
function ensureOriginals(dir) {
  if (Object.keys(settings.get().originalWallpapers).length) return Promise.resolve();
  if (!originalsPromise) {
    originalsPromise = desktopPicture
      .getAll()
      .then((originals) => {
        for (const id of Object.keys(originals)) if (!originals[id] || originals[id].startsWith(dir)) delete originals[id];
        settings.set({ originalWallpapers: originals });
      })
      .finally(() => (originalsPromise = null));
  }
  return originalsPromise;
}

// msg : { png: ArrayBuffer } préparé par la page (hors du processus principal), ou null.
async function onSnapshot(layer, msg) {
  const key = layer.pendingKey;
  layer.pendingKey = null;
  if (!key || !msg || !msg.png) return;
  try {
    const dir = path.join(app.getPath('userData'), 'wallpapers');
    const file = path.join(dir, `brume-${key}-${layer.display.id}-${Date.now()}.png`);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(file, Buffer.from(msg.png));
    await ensureOriginals(dir);
    if (settings.get().wallpaper === 'off') return; // désactivé entre-temps
    layer.lastFile = file;
    if (locked) return; // écran verrouillé : le fond est la vidéo, on la laisse jouer
    await desktopPicture.setAll({ [layer.display.id]: file });
    layer.stillKey = key;
    layer.lastFile = file;
    for (const f of await fs.promises.readdir(dir)) {
      if (f.startsWith('brume-') && f.includes(`-${layer.display.id}-`) && path.join(dir, f) !== file) await fs.promises.rm(path.join(dir, f), { force: true });
    }
  } catch (err) {
    console.warn('[brume] fond d’écran macOS :', err.message);
  }
}

async function restoreOriginalWallpapers() {
  const originals = settings.get().originalWallpapers;
  if (!Object.keys(originals).length) return;
  try {
    await desktopPicture.setAll(originals);
    settings.set({ originalWallpapers: {} });
  } catch (err) {
    console.warn('[brume] restauration du fond d’écran :', err.message);
  }
}

/* Couche interface (écran principal) */

function createUiLayer() {
  const display = screen.getPrimaryDisplay();
  const win = transparentWindow(display.bounds);
  win.setAlwaysOnTop(true, 'screen-saver', 1);
  uiLayer = { win, ready: false, interactive: false };
  win.webContents.on('did-finish-load', () => {
    uiLayer.ready = true;
    send(uiLayer, 'state', stateFor(screen.getPrimaryDisplay()));
    win.showInactive();
  });
  win.loadFile(path.join(__dirname, '../renderer/ui.html'));
}

/* Fenêtre de Brume (accueil et réglages) : une vraie fenêtre, au niveau normal */

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

// Position : celle d'avant si elle tombe encore sur un écran, sinon centrée sur l'écran
// principal ; toujours ramenée en entier dans la zone visible de l'écran le plus proche.
function panelBounds(current) {
  const saved = current || settings.get().panelBounds;
  const has = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y);
  const display = has ? screen.getDisplayMatching({ x: saved.x, y: saved.y, width: PANEL_SIZE.width, height: 60 }) : screen.getPrimaryDisplay();
  const wa = display.workArea;
  const width = Math.min(PANEL_SIZE.width, wa.width - 16);
  const height = Math.min((panel && panel.height) || PANEL_SIZE.height, wa.height - 16);
  const x = has ? saved.x : wa.x + (wa.width - width) / 2;
  const y = has ? saved.y : wa.y + (wa.height - height) / 2;
  return {
    x: Math.round(clamp(x, wa.x, wa.x + wa.width - width)),
    y: Math.round(clamp(y, wa.y, wa.y + wa.height - height)),
    width,
    height,
  };
}

function savePanelBounds() {
  if (!panel || panel.win.isDestroyed()) return;
  const { x, y } = panel.win.getBounds();
  settings.set({ panelBounds: { x, y } });
}

function createPanel() {
  const win = new BrowserWindow({
    ...panelBounds(),
    show: false,
    title: S.appName,
    titleBarStyle: 'hidden', // pas de barre de titre : l'aperçu en haut sert de poignée
    trafficLightPosition: { x: 16, y: 17 },
    backgroundColor: '#0d111a',
    resizable: false,
    minimizable: true, // bouton jaune : la fenêtre se range dans le Dock, le flocon la ramène
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  panel = { win, ready: false, wantShow: false };
  // Le bouton rouge (ou ⌘W, Échap) cache la fenêtre : Brume continue dans la barre des menus.
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    hidePanel();
  });
  let moveTimer = null;
  win.on('move', () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(savePanelBounds, 400);
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  if (!app.isPackaged) win.webContents.on('console-message', (e) => console.log(`[réglages] ${e.message}`));
  win.webContents.on('did-finish-load', () => {
    panel.ready = true;
    sendPanelState();
    if (Object.keys(thumbs).length) send(panel, 'thumbs', thumbs);
    if (panel.wantShow) showPanel();
  });
  win.loadFile(path.join(__dirname, '../renderer/settings.html'));
}

function sendPanelState() {
  if (panel && panel.ready) send(panel, 'state', stateFor(screen.getDisplayMatching(panel.win.getBounds())));
}

// Brume vit dans la barre des menus, sans icône dans le Dock. Mais tant que sa fenêtre est
// ouverte (ou réduite), Brume se comporte comme une app normale : icône dans le Dock,
// présente dans ⌘Tab, et le bouton jaune range la fenêtre dans le Dock. Fermée : l'icône
// disparaît à nouveau.
function setDockVisible(on) {
  if (!app.dock || app.dock.isVisible() === on) return;
  if (on) app.dock.show().catch((err) => log('Dock :', err.message));
  else app.dock.hide();
}

// Menu de l'app, visible seulement quand la fenêtre est au premier plan.
function setAppMenu() {
  const A = S.appMenu;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: S.appName,
        submenu: [
          { label: A.open, click: () => showPanel() },
          { type: 'separator' },
          { label: S.menu.quit, accelerator: 'Command+Q', click: () => app.quit() },
        ],
      },
      { label: A.edit, submenu: [{ role: 'copy', label: A.copy }, { role: 'selectAll', label: A.selectAll }] },
      {
        label: A.window,
        submenu: [
          { role: 'minimize', label: A.minimize },
          { role: 'close', label: A.close },
        ],
      },
    ])
  );
}

// Montre la fenêtre de Brume et la met devant tout : le flocon de la barre des menus,
// `open Brume.app` et l'icône du Dock passent par ici.
function showPanel() {
  if (!panel || panel.win.isDestroyed()) createPanel();
  paintThumbs();
  panel.wantShow = true;
  if (!panel.ready) return;
  panel.wantShow = false;
  const win = panel.win;
  setDockVisible(true);
  if (win.isMinimized()) win.restore(); // réduite dans le Dock : elle en ressort
  if (!win.isVisible()) win.setBounds(panelBounds(win.getBounds()));
  // Apparaître sur le bureau (Space) actuel plutôt que d'y emmener l'utilisateur.
  win.setVisibleOnAllWorkspaces(true, { skipTransformProcessType: true });
  win.show();
  win.setVisibleOnAllWorkspaces(false, { skipTransformProcessType: true });
  app.focus({ steal: true });
  win.focus();
}

function hidePanel() {
  if (!panel || panel.win.isDestroyed()) return;
  savePanelBounds();
  panel.win.hide();
  setDockVisible(false);
  if (!settings.get().welcomeSeen) applySettings({ welcomeSeen: true });
}

// La fenêtre prend la hauteur de son contenu (« Voir plus » déplié ou non), sans jamais
// dépasser de l'écran : au-delà, c'est le contenu qui défile.
function setPanelHeight(h) {
  if (!panel || panel.win.isDestroyed() || !Number.isFinite(h)) return;
  const height = Math.round(clamp(h, 320, 4000));
  if (panel.height === height) return;
  panel.height = height;
  panel.win.setBounds(panelBounds(panel.win.getBounds()));
}

/* Vignettes des scènes, pour la fenêtre de Brume */

// Une page du fond d'écran, cachée, peint chaque scène une fois puis se ferme. Elle connaît
// toutes les scènes (même celles ajoutées plus tard) : rien à tenir à jour ici.
function paintThumbs() {
  // Les scènes de la liste d'abord, puis les ambiances de la Ville (que « Ville » et
  // « Auto » affichent selon la météo).
  const keys = [...new Set([...PAL.ORDER, ...Object.keys(PAL.PALETTES)])];
  const list = keys.filter((key) => PAL.PALETTES[key] && !(key in thumbs)).map((key) => ({
    key,
    // La météo qui va avec la scène (celle qu'« Auto » choisirait), sinon ciel dégagé.
    effect: Object.keys(PAL.AUTO).find((fx) => PAL.AUTO[fx] === key) || 'none',
  }));
  if (!list.length || thumbPainter) return;
  const win = new BrowserWindow({
    ...THUMB_SIZE,
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  thumbPainter = { win, left: new Set(list.map((t) => t.key)) };
  const done = () => {
    if (!thumbPainter || thumbPainter.win !== win) return;
    clearTimeout(thumbPainter.safety);
    thumbPainter = null;
    if (!win.isDestroyed()) win.destroy();
  };
  thumbPainter.done = done;
  thumbPainter.safety = setTimeout(done, 30000);
  win.webContents.on('did-finish-load', () => send({ win }, 'command', { type: 'thumbs', list, w: THUMB_SIZE.width, h: THUMB_SIZE.height }));
  win.loadFile(path.join(__dirname, '../renderer/wallpaper.html'), { hash: 'thumbs' });
}

function onThumb(sender, msg) {
  if (!thumbPainter || thumbPainter.win.webContents !== sender || !msg) return;
  const { key, url } = msg;
  thumbPainter.left.delete(key);
  if (typeof url === 'string' && url.startsWith('data:image/png;base64,')) {
    thumbs[key] = url;
    send(panel, 'thumbs', { [key]: url });
  } else {
    thumbs[key] = null; // scène qui ne se peint pas : la fenêtre garde sa vignette de secours
  }
  if (!thumbPainter.left.size) thumbPainter.done();
}

function send(entry, channel, payload) {
  if (entry && !entry.win.isDestroyed()) entry.win.webContents.send(channel, payload);
}

function entryFor(sender) {
  if (uiLayer && uiLayer.win.webContents === sender) return uiLayer;
  for (const layer of wallLayers.values()) if (layer.win.webContents === sender) return layer;
  for (const entry of overlays.values()) if (entry.win.webContents === sender) return entry;
  return null;
}

/* ---------- Fenêtres des autres apps ---------- */

function localWindows(display) {
  const b = display.bounds;
  const out = [];
  for (const [id, x, y, w, h] of latestWindows) {
    if (x + w <= b.x || x >= b.x + b.width || y + h <= b.y || y >= b.y + b.height) continue;
    out.push([id, x - b.x, y - b.y, w, h]);
  }
  return out;
}

// Changement de bureau : macOS garde un fond par bureau ; on remet notre image fixe sur
// le bureau où l'on arrive (sinon il montre une ancienne image pendant la transition).
let lastIds = new Set();
let spaceTimer = null;
function detectSpaceChange(list) {
  const ids = new Set(list.map((w) => w[0]));
  let changed = 0;
  for (const id of ids) if (!lastIds.has(id)) changed++;
  for (const id of lastIds) if (!ids.has(id)) changed++;
  const big = changed >= 2 && changed >= Math.max(ids.size, lastIds.size) * 0.5;
  lastIds = ids;
  if (!big || settings.get().wallpaper === 'off') return;
  clearTimeout(spaceTimer);
  spaceTimer = setTimeout(() => {
    const map = {};
    if (locked) return;
    for (const layer of wallLayers.values()) if (layer.lastFile) map[layer.display.id] = layer.lastFile;
    if (Object.keys(map).length) desktopPicture.setAll(map).catch((err) => log('fond par bureau :', err.message));
  }, 700);
}

// payload : { w: [[id, x, y, w, h], ...], closed: [id, ...] }
function onWindows(payload) {
  latestWindows = payload.w;
  detectSpaceChange(payload.w);
  for (const entry of overlays.values()) {
    if (entry.ready) send(entry, 'windows', { list: localWindows(entry.display), closed: payload.closed });
  }
}

/* ---------- Curseur ---------- */

// Easter egg : un coup de baguette (cercle puis trait vers le bas) sur la scène Drones
// fait passer le train à vapeur magique.
const wand = require('./wand').createWand((path) => {
  const s = settings.get();
  if (PAL.resolve(s.wallpaper, s.effect) !== 'drones') return;
  const end = path[path.length - 1];
  const d = screen.getDisplayNearestPoint(end);
  const layer = wallLayers.get(d.id);
  if (!layer) return;
  const b = d.bounds;
  send(layer, 'command', { type: 'magic', path: path.map((p) => ({ x: p.x - b.x, y: p.y - b.y })) });
  log('coup de baguette : le train magique passe');
});

function startCursorPump() {
  setInterval(() => {
    if (isPaused()) return;
    const p = screen.getCursorScreenPoint();
    if (p.x === lastCursor.x && p.y === lastCursor.y) return;
    lastCursor = p;
    wand.move(p);
    if (intro && Date.now() - intro.startedAt > 1200) {
      if (!intro.from) intro.from = p;
      else if (Math.hypot(p.x - intro.from.x, p.y - intro.from.y) > 40) send(intro, 'command', { type: 'skip' });
    }
    for (const entry of overlays.values()) {
      if (!entry.ready) continue;
      const b = entry.display.bounds;
      const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
      if (inside || entry.cursorInside) send(entry, 'cursor', { x: p.x - b.x, y: p.y - b.y, inside });
      entry.cursorInside = inside;
    }
  }, 16);
}

/* ---------- Visibilité, pause, énergie ---------- */

function isPaused() {
  return userPaused || locked || (settings.get().pauseOnBattery && onBattery);
}

function updateVisibility() {
  const s = settings.get();
  const paused = isPaused();
  const wantsActivity = s.effect !== 'none' || s.aurora;
  for (const layer of wallLayers.values()) {
    if (!layer.ready) continue;
    send(layer, 'paused', paused);
    if (!paused) scheduleStill(layer); // une image ratée pendant la pause est refaite
  }
  for (const entry of overlays.values()) {
    if (!entry.ready || entry.win.isDestroyed()) continue;
    // Une page qui n'a plus rien à dessiner est cachée : zéro travail pour la carte graphique.
    const show = !paused && (wantsActivity || !entry.idle);
    if (show && !entry.win.isVisible()) entry.win.showInactive();
    if (!show && entry.win.isVisible()) entry.win.hide();
    send(entry, 'paused', paused);
  }
}

function togglePause() {
  userPaused = !userPaused;
  updateVisibility();
  rebuildMenu();
  toastPrimary(userPaused ? S.toasts.paused : S.toasts.resumed);
}

function setupPower() {
  const refresh = () => {
    updateVisibility();
    rebuildMenu();
  };
  const set = (fn) => () => {
    fn();
    refresh();
  };
  powerMonitor.on('on-battery', set(() => (onBattery = true)));
  powerMonitor.on('on-ac', set(() => (onBattery = false)));
  powerMonitor.on('lock-screen', set(() => {
    locked = true;
    lockVideoOn();
  }));
  powerMonitor.on('unlock-screen', () => {
    locked = false;
    lockVideoOff();
    refresh();
    if (!lockScreenOn()) playIntro(false); // déjà jouée sur l'écran de verrouillage
  });
  powerMonitor.on('suspend', set(() => {
    locked = true;
    lockVideoOn();
  }));
  // Le Mac se réveille souvent sur l'écran verrouillé : on vérifie avant de reprendre.
  powerMonitor.on('resume', () =>
    setTimeout(() => {
      if (powerMonitor.getSystemIdleState(1) !== 'locked') {
        locked = false;
        lockVideoOff();
        refresh();
        if (!lockScreenOn()) playIntro(false); // déjà jouée sur l'écran de verrouillage
      }
    }, 1500)
  );
}

function setupDisplays() {
  let timer = null;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(rebuildOverlays, 400);
  };
  screen.on('display-added', later);
  screen.on('display-removed', later);
  screen.on('display-metrics-changed', later);
}

/* ---------- Communication avec les pages ---------- */

function setupIpc() {
  ipcMain.on('overlay:interactive', (event, on) => {
    const entry = entryFor(event.sender);
    if (!entry || entry.interactive === !!on) return;
    entry.interactive = !!on;
    entry.win.setIgnoreMouseEvents(!on, { forward: true });
  });
  ipcMain.on('overlay:idle', (event, idle) => {
    const entry = entryFor(event.sender);
    if (!entry || entry === uiLayer) return;
    entry.idle = !!idle;
    updateVisibility();
  });
  ipcMain.on('overlay:set', (_event, patch) => applySettings(patch, { toast: true }));
  ipcMain.on('wallpaper:snapshot', (event, image) => {
    for (const layer of wallLayers.values()) if (layer.win.webContents === event.sender) onSnapshot(layer, image);
  });
  ipcMain.on('overlay:welcome-done', () => applySettings({ welcomeSeen: true }));
  ipcMain.on('intro:done', endIntro);
  // Fenêtre de Brume.
  ipcMain.on('panel:hide', hidePanel);
  ipcMain.on('panel:height', (event, h) => panel && event.sender === panel.win.webContents && setPanelHeight(h));
  ipcMain.on('intro:play', () => playIntro(true));
  ipcMain.on('wallpaper:thumb', (event, msg) => onThumb(event.sender, msg));
  // La météo demande à l'interface d'afficher quelque chose.
  ipcMain.on('overlay:toast', (_event, text) => toastPrimary(text));
  ipcMain.on('overlay:stats', (_event, stats) => send(uiLayer, 'stats', stats));
}

function broadcastState() {
  for (const entry of overlays.values()) if (entry.ready) send(entry, 'state', stateFor(entry.display));
  if (uiLayer && uiLayer.ready) send(uiLayer, 'state', stateFor(screen.getPrimaryDisplay()));
  sendPanelState();
  syncWallpaper();
}

function applySettings(patch, { toast = false } = {}) {
  const before = settings.get();
  // Choisir un temps à la main désactive la météo réelle.
  if ('effect' in patch && !('realWeather' in patch)) patch = { ...patch, realWeather: false };
  const after = settings.set(patch);
  broadcastState();
  rebuildMenu();
  updateVisibility();
  if (toast && after.effect !== before.effect) {
    const fx = S.effects[after.effect];
    toastPrimary(`${fx.emoji}  ${fx.label} — ${fx.line}`);
  }
  if (after.aurora && !before.aurora) toastPrimary(`${S.aurora.emoji}  ${S.aurora.label} — ${S.aurora.line}`);
  if (toast && after.wallpaper !== before.wallpaper) {
    const wp = S.wallpapers[after.wallpaper];
    toastPrimary(`${S.menu.wallpaper} : ${wp.label} — ${wp.line}`);
  }
  if (after.realWeather && !before.realWeather) refreshRealWeather();
  if (after.lockScreen !== before.lockScreen || (after.lockScreen && (after.wallpaper !== before.wallpaper || after.effect !== before.effect))) scheduleLockVideo();
}

/* ---------- Écran de verrouillage animé ----------
 * L'animation de la scène est filmée (≈ 16 s de calcul) puis jouée par macOS comme un
 * fond « Aerial » : on la voit dès l'écran de connexion. On refilme quand la scène ou le
 * temps changent, avec un délai pour ne pas filmer à chaque clic. */
const LOCK_DIR = () => path.join(app.getPath('userData'), 'lockscreen');
let lockTimer = null;
let lockBusy = false;
let lockKeyDone = null;

function lockScreenOn() {
  return settings.get().lockScreen && !!settings.get().lockScreenSaved;
}

// L'image fixe de l'écran principal (pour tous les bureaux).
function primaryStill() {
  const layer = wallLayers.get(screen.getPrimaryDisplay().id) || [...wallLayers.values()][0];
  return layer && layer.lastFile;
}

let videoShown = false;
function lockVideoOn() {
  if (!lockScreenOn()) return;
  videoShown = true;
  lockscreen.showVideo(settings.get().lockScreenSaved.assetID).catch((err) => log('vidéo de verrouillage :', err.message));
}
function lockVideoOff(force = false) {
  if (!videoShown && !force) return;
  videoShown = false;
  const still = primaryStill();
  if (still) lockscreen.showImage(still).catch((err) => log('retour à l’image fixe :', err.message));
}

function scheduleLockVideo(delay = 20000) {
  clearTimeout(lockTimer);
  lockTimer = setTimeout(updateLockVideo, delay);
}

async function updateLockVideo() {
  const s = settings.get();
  if (lockBusy) return scheduleLockVideo(10000);
  lockBusy = true;
  try {
    if (!s.lockScreen) {
      if (s.lockScreenSaved) {
        await lockscreen.restore(path.join(LOCK_DIR(), 'originaux'));
        settings.set({ lockScreenSaved: null });
        lockKeyDone = null;
        log('écran de verrouillage : vidéo d’origine remise');
      }
      return;
    }
    if (!lockscreen.available()) {
      log('écran de verrouillage : indisponible (ffmpeg ou vidéo Aerial manquants)');
      return;
    }
    const key = PAL.resolve(s.wallpaper !== 'off' ? s.wallpaper : 'auto', s.effect) || 'cafe';
    const id = `${key}-${s.effect}`;
    if (id === lockKeyDone) return;
    const dir = LOCK_DIR();
    await fs.promises.mkdir(dir, { recursive: true });
    const out = path.join(dir, `brume-${id}.mov`);
    const t0 = Date.now();
    await lockscreen.render({ key, effect: s.effect, out, preload: PRELOAD, page: path.join(__dirname, '../renderer/intro.html') });
    const res = await lockscreen.install(out, path.join(dir, 'originaux'));
    await fs.promises.rm(out, { force: true });
    settings.set({ lockScreenSaved: { assetID: res.assetID } });
    lockKeyDone = id;
    log(`écran de verrouillage : ${id} filmé et installé (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (err) {
    log('écran de verrouillage :', err.message);
  } finally {
    lockBusy = false;
  }
}

function toastPrimary(text) {
  send(uiLayer, 'command', { type: 'toast', text });
}

async function refreshRealWeather() {
  try {
    const w = await weather.current();
    if (!settings.get().realWeather) return;
    const changed = settings.get().effect !== w.effect;
    settings.set({ effect: w.effect, wind: w.wind, intensity: w.intensity });
    if (changed && settings.get().lockScreen) scheduleLockVideo();
    broadcastState();
    rebuildMenu();
    updateVisibility();
    if (changed || !announcedRealWeather) toastPrimary(S.toasts.realWeather(w.city, S.effects[w.effect].label.toLowerCase(), w.temperature));
    announcedRealWeather = true;
  } catch (err) {
    console.warn('[brume] météo réelle :', err.message);
    toastPrimary(S.toasts.realWeatherError);
  }
}

/* ---------- Animation d'ouverture du Mac ---------- */

// Nom du compte macOS, tel qu'il s'affiche à l'écran de connexion (« id -F »), sinon
// l'identifiant de session.
function accountName() {
  try {
    const full = require('node:child_process').execFileSync('/usr/bin/id', ['-F'], { encoding: 'utf8', timeout: 1000 }).trim();
    if (full) return full;
  } catch {
    /* on se rabat sur l'identifiant */
  }
  return require('node:os').userInfo().username;
}

// Joue la séquence de la scène du fond d'écran (ou, sans fond, celle qui va avec le temps).
function playIntro(force) {
  const s = settings.get();
  if ((!force && !s.intro) || intro || isPaused()) return;
  const key = PAL.resolve(s.wallpaper !== 'off' ? s.wallpaper : 'auto', s.effect) || 'cafe';
  const win = transparentWindow(screen.getPrimaryDisplay().bounds);
  win.setAlwaysOnTop(true, 'screen-saver', 2);
  intro = { win, startedAt: Date.now(), from: null };
  win.webContents.on('did-finish-load', () => {
    win.showInactive();
    send(intro, 'command', { type: 'intro', key, effect: s.effect, name: accountName() });
  });
  win.loadFile(path.join(__dirname, '../renderer/intro.html'));
  intro.safety = setTimeout(endIntro, 20000); // filet de sécurité
  log('animation d’ouverture :', key);
}

function endIntro() {
  if (!intro) return;
  clearTimeout(intro.safety);
  if (!intro.win.isDestroyed()) intro.win.destroy();
  intro = null;
}

/* ---------- Barre des menus ---------- */

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '../assets/trayTemplate.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip(`${S.appName} — ${S.tagline}`);
  rebuildMenu();
}

function rebuildMenu() {
  if (!tray) return;
  const s = settings.get();
  const M = S.menu;
  const check = (key, label) => ({
    label,
    type: 'checkbox',
    checked: !!s[key],
    click: (item) => applySettings({ [key]: item.checked }),
  });

  // Nom d'une scène dans le menu (« Auto » précise qu'il suit la météo).
  const sceneName = (key) => {
    const label = S.wallpapers[key] ? S.wallpapers[key].label : key;
    return key === 'auto' ? `${label} (${S.panel.wallpaper.auto})` : label;
  };

  // Deux parties bien séparées, comme dans la fenêtre : la MÉTÉO (ce qui tombe sur
  // l'écran) puis le FOND D'ÉCRAN (la scène derrière les icônes).
  const template = [
    { label: M.header, enabled: false },
    { label: M.open, click: () => showPanel() },
    { type: 'separator' },
    { label: M.weatherHeader, type: 'header' },
    ...EFFECTS.map((key) => ({
      label: `${S.effects[key].emoji}  ${S.effects[key].label}`,
      type: 'radio',
      checked: s.effect === key,
      click: () => applySettings({ effect: key }, { toast: true }),
    })),
    check('aurora', `${S.aurora.emoji}  ${S.aurora.label}`),
    {
      label: M.intensity,
      submenu: ['light', 'normal', 'heavy'].map((k) => ({
        label: M.intensityLevels[k],
        type: 'radio',
        checked: s.intensity === k,
        click: () => applySettings({ intensity: k }),
      })),
    },
    {
      label: M.wind,
      submenu: [-2, -1, 0, 1, 2].map((v) => ({
        label: M.windLevels[String(v)],
        type: 'radio',
        checked: s.wind === v,
        click: () => applySettings({ wind: v }),
      })),
    },
    check('accumulate', M.accumulate),
    check('snowballs', M.snowballs),
    check('behind', M.behind),
    check('realWeather', M.realWeather),
    { type: 'separator' },
    { label: M.wallpaperHeader, type: 'header' },
    {
      label: `${M.scene} : ${sceneName(s.wallpaper)}`,
      submenu: WALLPAPERS.map((key) => ({
        label: sceneName(key),
        type: 'radio',
        checked: s.wallpaper === key,
        click: () => applySettings({ wallpaper: key }, { toast: true }),
      })),
    },
    check('intro', M.intro),
    { label: M.playIntro, click: () => playIntro(true) },
    { type: 'separator' },
    check('pauseOnBattery', M.pauseOnBattery),
    {
      label: M.openAtLogin,
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    check('stats', M.stats),
    {
      label: M.meltAll,
      click: () => {
        for (const entry of overlays.values()) if (entry.ready) send(entry, 'command', { type: 'melt' });
        toastPrimary(S.toasts.melted);
      },
    },
    { type: 'separator' },
    { label: userPaused ? M.resume : M.pause, accelerator: PAUSE_SHORTCUT, click: togglePause },
    { label: M.quit, accelerator: 'Command+Q', click: () => app.quit() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}
