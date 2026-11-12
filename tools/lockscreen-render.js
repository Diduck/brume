// Brume — filme l'animation d'une scène en vidéo (test de l'écran de verrouillage animé).
//   env -u ELECTRON_RUN_AS_NODE npx electron tools/lockscreen-render.js <scène> <effet> <sortie.mov> [secondes]
'use strict';
const { app } = require('electron');
const path = require('node:path');

const [key = 'drones', effect = 'none', out = '/tmp/brume-lock.mov', seconds = '30'] = process.argv.slice(2);
app.whenReady().then(async () => {
  const lock = require('../src/main/lockscreen');
  const t0 = Date.now();
  try {
    await lock.render({ key, effect, out, seconds: Number(seconds), preload: path.join(__dirname, '../src/preload/overlay-preload.js'), page: path.join(__dirname, '../src/renderer/intro.html') });
    console.log(`vidéo : ${out} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (err) {
    console.error('échec :', err.message);
  }
  app.quit();
});
