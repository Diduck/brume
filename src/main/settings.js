'use strict';
// Réglages persistants, enregistrés en JSON dans le dossier utilisateur de l'app.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  effect: 'snow',          // none | snow | rain | storm | sakura | leaves | fireflies | starfall
  aurora: false,
  wallpaper: 'off',        // off | auto | une scène de BRUME_PALETTES.ORDER (ville, cafe, foret…)
  intensity: 'normal',     // light | normal | heavy
  wind: 0,                 // -2 .. 2
  behind: true,            // la météo reste derrière les fenêtres (jamais devant tes apps)
  accumulate: true,        // la neige / les feuilles se posent sur les fenêtres
  snowballs: true,         // boules de neige et bonshommes
  realWeather: false,
  pauseOnBattery: false,
  stats: false,
  welcomeSeen: false,
  intro: true,             // animation à l'ouverture du Mac (déverrouillage, sortie de veille)
  lockScreen: false,       // l'animation filmée en vidéo et jouée sur l'écran de verrouillage
  lockScreenSaved: null,   // ce que Brume a remplacé (pour tout remettre) : { video, plist }
  originalWallpapers: {},  // fond d'écran macOS d'origine, par écran, pour le remettre
  panelBounds: {},         // dernière position de la fenêtre de Brume : { x, y }
});

const CITY_VARIANTS = require('../shared/palettes').VILLE_KEYS;

let file = null;
let state = { ...DEFAULTS };
let writeTimer = null;

function load(userDataDir) {
  file = path.join(userDataDir, 'settings.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    state = { ...DEFAULTS, ...pickKnown(raw) };
    // Anciennes versions : les cinq ambiances de la ville étaient cinq scènes. C'est
    // maintenant UNE scène, « ville », dont l'ambiance suit la météo.
    if (CITY_VARIANTS.includes(state.wallpaper)) state.wallpaper = 'ville';
  } catch {
    state = { ...DEFAULTS };
  }
  return state;
}

function pickKnown(obj) {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) {
    if (obj && typeof obj[k] === typeof DEFAULTS[k]) out[k] = obj[k];
  }
  return out;
}

function get() {
  return state;
}

function set(patch) {
  state = { ...state, ...pickKnown(patch) };
  clearTimeout(writeTimer);
  writeTimer = setTimeout(save, 250);
  return state;
}

function save() {
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[brume] impossible d’enregistrer les réglages', err);
  }
}

module.exports = { load, get, set, save, DEFAULTS };
