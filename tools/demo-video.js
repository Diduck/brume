// Brume — vidéo de démonstration d'une animation d'ouverture (pour le README).
//   env -u ELECTRON_RUN_AS_NODE npx electron tools/demo-video.js <scène> <effet> <sortie.mp4> [secondes]
// Les pixels sont agrandis ×2 sans flou (854 × 480).
'use strict';
const { app } = require('electron');
const path = require('node:path');

const [key = 'drones', effect = 'none', out = '/tmp/brume-demo.mp4', seconds = '11'] = process.argv.slice(2);
app.whenReady().then(async () => {
  const lock = require('../src/main/lockscreen');
  try {
    await lock.render({
      key, effect, out, seconds: Number(seconds), fps: 24,
      outArgs: ['-vf', 'scale=854:480:flags=neighbor', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p'],
      preload: path.join(__dirname, '../src/preload/overlay-preload.js'),
      page: path.join(__dirname, '../src/renderer/intro.html'),
    });
    console.log(`vidéo : ${out}`);
  } catch (err) {
    console.error('échec :', err.message);
  }
  app.quit();
});
