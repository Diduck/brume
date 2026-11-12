'use strict';
// Brume — tes icônes sur le fond d'écran, côté processus principal : importer une image
// (ou l'icône d'une app) en PNG dans le dossier utilisateur, la fournir aux pages, et
// faire le ménage quand une icône est retirée.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'icon-to-png.jxa.js');
const EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'heic', 'heif', 'tif', 'tiff', 'webp', 'bmp', 'svg', 'pdf', 'icns', 'app'];

// Convertit avec AppKit (via osascript) : toutes les images que macOS sait lire, et les
// apps (leur icône en couleurs). Le script est lu ici (il peut être dans l'archive asar).
function toPng(src, out) {
  const code = fs.readFileSync(SCRIPT, 'utf8');
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', code, JSON.stringify({ src, out, size: 1024 })], { timeout: 20000 }, (err, stdout) =>
      err ? reject(err) : resolve(String(stdout).trim())
    );
  });
}

// Importe un fichier ; renvoie l'identifiant de la nouvelle icône.
async function importFile(src, dir) {
  const real = await fs.promises.realpath(src); // /Applications/Safari.app est un lien
  const id = crypto.randomBytes(6).toString('hex');
  const out = path.join(dir, `${id}.png`);
  await fs.promises.mkdir(dir, { recursive: true });
  await toPng(real, out);
  const st = await fs.promises.stat(out).catch(() => null);
  if (!st || st.size < 100) throw new Error('conversion vide');
  return id;
}

// Les images des icônes, en data URL, pour les pages (qui n'ont pas accès aux fichiers).
async function urls(dir, ids) {
  const out = {};
  for (const id of ids) {
    try {
      const buf = await fs.promises.readFile(path.join(dir, `${id}.png`));
      out[id] = `data:image/png;base64,${buf.toString('base64')}`;
    } catch {
      out[id] = null;
    }
  }
  return out;
}

// Supprime les images des icônes retirées.
async function prune(dir, ids) {
  const keep = new Set(ids.map((id) => `${id}.png`));
  let files = [];
  try {
    files = await fs.promises.readdir(dir);
  } catch {
    return;
  }
  for (const f of files) if (f.endsWith('.png') && !keep.has(f)) await fs.promises.rm(path.join(dir, f), { force: true });
}

// Une empreinte courte de la liste (pour savoir quand refaire l'image fixe du fond).
const signature = (list) => (list && list.length ? crypto.createHash('sha1').update(JSON.stringify(list)).digest('hex').slice(0, 8) : '');

module.exports = { importFile, urls, prune, signature, EXTENSIONS };
