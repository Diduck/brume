'use strict';
// Brume — l'animation sur l'écran de verrouillage.
//
// Aucune app n'a le droit de dessiner sur l'écran de connexion. Mais macOS y joue les
// fonds d'écran « Aerial » (des vidéos). Brume filme donc sa propre animation d'ouverture
// (le travelling, puis la scène qui vit) et range cette vidéo à la place de la vidéo
// Aerial téléchargée par le Mac. L'original est mis de côté et remis quand on désactive.
//
// Les vidéos Aerial (macOS 26) : ~/Library/Application Support/com.apple.wallpaper/aerials
const { BrowserWindow, ipcMain } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const AERIALS = path.join(os.homedir(), 'Library/Application Support/com.apple.wallpaper/aerials');
const INDEX = path.join(os.homedir(), 'Library/Application Support/com.apple.wallpaper/Store/Index.plist');
const JXA = path.join(__dirname, 'aerial-desktop.jxa.js');
const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find((f) => fs.existsSync(f)) || null;

let active = null; // un seul enregistrement à la fois

ipcMain.handle('record:frame', (_e, buf) => {
  if (!active) return false;
  const ok = active.ff.stdin.write(Buffer.from(buf));
  return ok ? true : new Promise((r) => active.ff.stdin.once('drain', () => r(true)));
});
ipcMain.on('record:done', (_e, info) => {
  if (!active) return;
  active.info = info;
  active.ff.stdin.end();
});

function available() {
  return !!FFMPEG && fs.existsSync(path.join(AERIALS, 'videos'));
}

// Filme l'animation de la scène et l'encode en vidéo HEVC 4K (pixels agrandis sans flou).
// W × H : taille logique 16:9 (427 × 240 → × 9 = 3843 × 2160, recadré en 3840 × 2160).
// outArgs : autre encodage (ex. pour une vidéo de démonstration), à la place de la 4K.
function render({ key, effect, preload, page, out, W = 427, H = 240, fps = 30, seconds = 30, outArgs = null }) {
  if (!FFMPEG) return Promise.reject(new Error('ffmpeg introuvable'));
  if (active) return Promise.reject(new Error('enregistrement déjà en cours'));
  return new Promise((resolve, reject) => {
    const args = ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', '-', ...(outArgs || ['-vf', `scale=${W * 9}:${H * 9}:flags=neighbor,crop=3840:2160`, '-c:v', 'hevc_videotoolbox', '-tag:v', 'hvc1', '-b:v', '24M', '-pix_fmt', 'yuv420p']), out];
    const ff = spawn(FFMPEG, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => (err += d));
    const win = new BrowserWindow({ show: false, width: W, height: H, webPreferences: { preload, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    active = { ff, win, info: null };
    const finish = (e) => {
      if (!win.isDestroyed()) win.destroy();
      const info = active && active.info;
      active = null;
      if (e) reject(e);
      else if (info && info.error) reject(new Error(info.error));
      else resolve(out);
    };
    ff.on('close', (code) => finish(code === 0 ? null : new Error(`ffmpeg (${code}) : ${err.trim()}`)));
    ff.on('error', finish);
    win.webContents.on('did-finish-load', () => win.webContents.send('command', { type: 'record', key, effect, fps, seconds, W, H }));
    win.loadFile(page);
  });
}

// La vidéo Aerial à remplacer : celle que le Mac a téléchargée (la plus récente s'il y en a plusieurs).
function targetVideo() {
  const dir = path.join(AERIALS, 'videos');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mov'));
  if (!files.length) return null;
  files.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
  return path.join(dir, files[0]);
}

// Lance un script JXA. Le script est lu par Node (il peut être dans l'archive app.asar,
// qu'osascript ne sait pas ouvrir) et passé en texte ; ses arguments, en JSON.
function jxa(script, args) {
  const code = fs.readFileSync(script, 'utf8');
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', code, JSON.stringify(args)], { timeout: 15000 }, (err, out) => (err ? reject(err) : resolve(String(out).trim())));
  });
}

const restartAgent = () => new Promise((r) => execFile('/usr/bin/killall', ['WallpaperAgent'], () => r()));

// Range notre vidéo à la place de l'Aerial téléchargé (l'original est gardé une fois).
async function install(video, backupDir) {
  const target = targetVideo();
  if (!target) throw new Error('aucune vidéo Aerial téléchargée');
  await fs.promises.mkdir(backupDir, { recursive: true });
  const backup = path.join(backupDir, path.basename(target));
  if (!fs.existsSync(backup)) await fs.promises.copyFile(target, backup);
  await fs.promises.copyFile(video, target);
  return { target, assetID: path.basename(target, '.mov') };
}

// Écran verrouillé : le fond de tous les bureaux devient la vidéo (donc l'écran de
// connexion l'anime). Déverrouillé : retour à l'image fixe — une vidéo comme fond fait un
// écran noir le temps de se charger à chaque changement de bureau.
async function showVideo(assetID) {
  await jxa(JXA, { plist: INDEX, assetID });
  await restartAgent();
}
async function showImage(file) {
  await jxa(JXA, { plist: INDEX, image: file });
  await restartAgent();
}

// Remet la vidéo d'origine.
async function restore(backupDir) {
  if (!fs.existsSync(backupDir)) return false;
  const dir = path.join(AERIALS, 'videos');
  for (const f of await fs.promises.readdir(backupDir)) {
    if (f.endsWith('.mov')) await fs.promises.copyFile(path.join(backupDir, f), path.join(dir, f));
  }
  await fs.promises.rm(backupDir, { recursive: true, force: true });
  return true;
}

module.exports = { available, render, install, restore, showVideo, showImage, targetVideo, AERIALS };
