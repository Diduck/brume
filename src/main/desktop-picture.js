'use strict';
// Brume — vrai fond d'écran macOS.
// Le fond lofi animé est dessiné par une fenêtre au niveau du bureau ; en plus, on
// enregistre une image fixe de la scène et on en fait le fond d'écran macOS, pour que
// Mission Control et « Afficher le bureau » montrent la même chose. Le fond d'origine
// est sauvegardé avant le premier changement et remis quand on choisit « Aucun ».
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = fs.readFileSync(path.join(__dirname, 'desktop-picture.jxa.js'), 'utf8');

function osa(args) {
  return new Promise((resolve, reject) => {
    const child = execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-', ...args], { timeout: 15000 }, (err, stdout) => {
      if (err) return reject(err);
      try {
        resolve(JSON.parse(stdout.trim() || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    child.stdin.end(SCRIPT);
  });
}

const getAll = () => osa(['get']);
const setAll = (map) => osa(['set', JSON.stringify(map)]);

module.exports = { getAll, setAll };
