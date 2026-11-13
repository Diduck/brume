// Brume — vérifie qu'une scène sait peindre un monde élargi SANS changer le fond d'écran.
//
//   env -u ELECTRON_RUN_AS_NODE npx electron tools/ext-check.js <scène> [effet] [dossier de sortie]
//
// La scène est construite deux fois avec le même hasard : normalement, puis avec
// { ext: { left, right } }. Pour chaque plan peint (toiles de la scène), on compare la
// partie centrale du monde élargi avec le fond normal : elle doit être identique au pixel
// près. On enregistre aussi une image du monde élargi entier, pour le regarder.
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const [key = 'cafe', effect = 'none', outDir = '/tmp/brume-ext'] = process.argv.slice(2);
const W = 360;
const H = 225;

// Plans peints de chaque scène (les noms utilisés par la caméra d'ouverture).
const LAYERS = {
  cafe: ['outside', 'inside'],
  city: ['bg', 'fg'],
  terrasse: ['back', 'mid', 'fore'],
  foret: ['bg', 'ground', 'front'],
  mer: ['back', 'mid', 'front'],
  chambre: ['outFar', 'outNear', 'glass', 'inside'],
  drones: ['bg', 'mid', 'fg'],
  toits: ['back', 'mid', 'fore'],
  annecy: ['back', 'mid', 'fore'],
  planete: ['sky', 'back', 'mid', 'fore'],
};

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { preload: path.join(__dirname, '../src/preload/overlay-preload.js'), contextIsolation: true, sandbox: true } });
  win.webContents.on('console-message', (e) => console.log(`[page] ${e.message}`));
  await win.loadFile(path.join(__dirname, '../src/renderer/wallpaper.html'));
  const layers = LAYERS[key] || LAYERS[['nuit', 'crepuscule', 'pluie', 'sakura', 'automne'].includes(key) ? 'city' : ''] || [];
  const res = await win.webContents.executeJavaScript(`(() => {
    const B = window.Brume;
    const key = ${JSON.stringify(key)};
    const effect = ${JSON.stringify(effect)};
    const W = ${W}, H = ${H};
    const EL = Math.round(W * 1.6), ER = Math.round(W * 0.25);
    // Même hasard pour les deux constructions.
    const seeded = (seed) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
    const real = Math.random;
    const make = (opts) => { Math.random = seeded(1234); const s = new B.PixelScenes[key](W, H, opts); s.update(0.001, { effect }); Math.random = real; return s; };
    const A = make(undefined);
    const X = make({ ext: { left: EL, right: ER } });
    const out = { supported: !!(X.extL || X.extR), extL: X.extL, extR: X.extR, layers: {} };
    for (const name of ${JSON.stringify(layers)}) {
      const a = A[name], x = X[name];
      if (!a || !x) { out.layers[name] = 'absent'; continue; }
      const ga = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
      const gx = x.getContext('2d').getImageData(X.extL || 0, 0, a.width, a.height).data;
      let diff = 0;
      for (let i = 0; i < ga.length; i += 4) if (ga[i] !== gx[i] || ga[i + 1] !== gx[i + 1] || ga[i + 2] !== gx[i + 2] || ga[i + 3] !== gx[i + 3]) diff++;
      // Part peinte des extensions (gauche et droite).
      const full = x.getContext('2d').getImageData(0, 0, x.width, x.height).data;
      let painted = 0, total = 0;
      for (let y = 0; y < x.height; y++) for (let px = 0; px < x.width; px++) {
        if (px >= (X.extL || 0) && px < (X.extL || 0) + a.width) continue;
        total++; if (full[(y * x.width + px) * 4 + 3] > 40) painted++;
      }
      out.layers[name] = { size: a.width + 'x' + a.height + ' -> ' + x.width + 'x' + x.height, diffPixels: diff, extPainted: total ? Math.round((painted / total) * 100) + '%' : '-' };
    }
    // Image du monde élargi entier : la scène dessinée dans une toile large.
    const c = document.createElement('canvas');
    c.width = W + (X.extL || 0) + (X.extR || 0); c.height = H;
    const g = c.getContext('2d');
    g.translate(X.extL || 0, 0);
    for (let i = 0; i < 40; i++) X.update(0.1, { effect });
    X.draw(g);
    out.png = c.toDataURL('image/png');
    return out;
  })()`);
  const png = res.png;
  delete res.png;
  const file = path.join(outDir, `${key}-${effect}-monde.png`);
  fs.writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
  console.log(JSON.stringify(res, null, 2));
  console.log(`monde élargi : ${file}`);
  app.quit();
});
