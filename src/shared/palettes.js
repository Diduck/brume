/*
 * Brume — scènes et palettes des fonds animés lofi.
 * Partagées par le shader du fond (couche fond d'écran) et par les vignettes de la
 * carte d'accueil (couche interface).
 *
 * scene : 0 = ville, 1 = café, 2 = forêt, 3 = bord de mer, 4 = chambre
 * sun   : [x (0–1), y (0–1 depuis le haut), rayon, type] — type 0 = soleil rétro, 1 = lune, -1 = caché
 *         (pour le café et la chambre, la position est celle vue à travers la fenêtre)
 */
(function (root) {
  'use strict';

  const PALETTES = {
    nuit: {
      scene: 0, skyTop: '#0b1030', skyMid: '#2a2457', horizon: '#7a4b8a', sunColor: '#f4ecd2', sun: [0.74, 0.2, 0.045, 1],
      cloud: '#3a3466', far: '#2d2853', mid: '#1d1a3c', near: '#110e24', light: '#ffcf7a', neon: '#8fd0ff', stars: 1, rain: 0,
    },
    crepuscule: {
      scene: 0, skyTop: '#2b1f4f', skyMid: '#c4547a', horizon: '#ffb26b', sunColor: '#ffe3a3', sun: [0.5, 0.56, 0.11, 0],
      cloud: '#8a3f6e', far: '#6b3060', mid: '#47214a', near: '#24112c', light: '#ffd27f', neon: '#ff8fb8', stars: 0.25, rain: 0,
    },
    pluie: {
      scene: 0, skyTop: '#0d1626', skyMid: '#1f3049', horizon: '#3f5a7a', sunColor: '#c8d6dc', sun: [0.3, 0.3, 0, -1],
      cloud: '#26374f', far: '#1a2738', mid: '#101a28', near: '#080e17', light: '#ffb86b', neon: '#ff5fa2', stars: 0, rain: 1,
    },
    sakura: {
      scene: 0, skyTop: '#e9a6bb', skyMid: '#f7cfcd', horizon: '#fff0dc', sunColor: '#fff7e8', sun: [0.32, 0.6, 0.07, 0],
      cloud: '#f6c3cf', far: '#d892a8', mid: '#b56987', near: '#7a4263', light: '#ffe7b0', neon: '#ffd1e0', stars: 0, rain: 0,
    },
    automne: {
      scene: 0, skyTop: '#3a2240', skyMid: '#a2513a', horizon: '#f0a24a', sunColor: '#ffd38a', sun: [0.62, 0.55, 0.08, 0],
      cloud: '#7b3a37', far: '#6a3433', mid: '#4a2328', near: '#28131a', light: '#ffc56b', neon: '#ffb36b', stars: 0.1, rain: 0,
    },
    cafe: {
      scene: 1, skyTop: '#1d2a44', skyMid: '#4a4f72', horizon: '#d99a72', sunColor: '#ffd59a', sun: [0.35, 0.62, 0.06, 0],
      cloud: '#5a5574', far: '#6b4430', mid: '#3a2622', near: '#1c1110', light: '#ffc977', neon: '#ff9f6b', stars: 0.2, rain: 0,
    },
    foret: {
      scene: 2, skyTop: '#13233a', skyMid: '#3a4f6e', horizon: '#d9a07a', sunColor: '#ffe9c2', sun: [0.72, 0.24, 0.045, 1],
      cloud: '#4a5a78', far: '#33445e', mid: '#1f3140', near: '#0d181e', light: '#e8ff8a', neon: '#9fe0ff', stars: 0.7, rain: 0,
    },
    mer: {
      scene: 3, skyTop: '#2a3a6b', skyMid: '#d9707c', horizon: '#ffc58a', sunColor: '#fff0c4', sun: [0.42, 0.53, 0.09, 0],
      cloud: '#b8607a', far: '#3a4f86', mid: '#2a2240', near: '#17122a', light: '#fff3c4', neon: '#9fd8ff', stars: 0, rain: 0,
    },
    chambre: {
      scene: 4, skyTop: '#0c1230', skyMid: '#1f2650', horizon: '#4a3a72', sunColor: '#f4ecd2', sun: [0.8, 0.28, 0.05, 1],
      cloud: '#2a2f5c', far: '#3b2f4a', mid: '#241d3a', near: '#120e1f', light: '#ffd27f', neon: '#7fe3ff', stars: 1, rain: 0,
    },
    toits: {
      scene: 0, skyTop: '#28256a', skyMid: '#a259ae', horizon: '#f2a0b2', sunColor: '#ffd2c0', sun: [0.47, 0.6, 0.08, 0],
      cloud: '#e384b0', far: '#4a3a88', mid: '#352a5a', near: '#1e1430', light: '#ffc46c', neon: '#ff9ac8', stars: 0.15, rain: 0,
    },
    terrasse: {
      scene: 5, skyTop: '#060d26', skyMid: '#0f2c63', horizon: '#3aa9cf', sunColor: '#ffd27a', sun: [0.5, 0.2, 0, -1],
      cloud: '#11295a', far: '#22558c', mid: '#0c1c3c', near: '#050b1c', light: '#ffae45', neon: '#ffd98a', stars: 0.6, rain: 0,
    },
    drones: {
      scene: 6, skyTop: '#262e46', skyMid: '#4a536e', horizon: '#ad978e', sunColor: '#c8c6c4', sun: [0.8, 0.11, 0.03, 1],
      cloud: '#3c4560', far: '#5f6579', mid: '#41485c', near: '#232a2a', light: '#e9c48c', neon: '#ff7a1c', stars: 0.1, rain: 0,
    },
  };

  // Ordre d'affichage dans la fenêtre et le menu. « ville » est UNE scène : son ambiance
  // (nuit, crepuscule, pluie, sakura, automne) suit la météo, voir VILLE.
  const ORDER = ['off', 'auto', 'toits', 'drones', 'terrasse', 'ville', 'cafe', 'foret', 'mer', 'chambre'];

  // La Ville : quelle ambiance pour quel temps.
  const VILLE = { none: 'crepuscule', snow: 'nuit', rain: 'pluie', storm: 'pluie', sakura: 'sakura', leaves: 'automne', fireflies: 'nuit', starfall: 'nuit' };
  const VILLE_KEYS = ['nuit', 'crepuscule', 'pluie', 'sakura', 'automne'];

  // « Auto » : le lieu ET l'ambiance suivent le temps qu'il fait. Chaque temps a plusieurs
  // scènes qui lui vont ; Brume passe de l'une à l'autre toutes les 3 heures, si bien que
  // toutes les scènes finissent par apparaître au fil des saisons.
  const AUTO_SCENES = {
    none: ['mer', 'toits', 'drones', 'crepuscule'],
    snow: ['nuit', 'chambre', 'cafe'],
    rain: ['pluie', 'cafe', 'chambre'],
    storm: ['pluie', 'chambre', 'drones'],
    sakura: ['sakura', 'toits', 'terrasse'],
    leaves: ['automne', 'foret', 'cafe'],
    fireflies: ['foret', 'terrasse', 'toits'],
    starfall: ['nuit', 'terrasse', 'drones', 'chambre'],
  };
  const AUTO_PERIOD = 3 * 3600 * 1000;
  const autoScene = (effect, now = Date.now()) => {
    const list = AUTO_SCENES[effect] || AUTO_SCENES.none;
    return list[Math.floor(now / AUTO_PERIOD) % list.length];
  };
  // Compatibilité : la première scène de chaque temps.
  const AUTO = Object.fromEntries(Object.entries(AUTO_SCENES).map(([k, v]) => [k, v[0]]));

  function resolve(wallpaper, effect) {
    if (!wallpaper || wallpaper === 'off') return null;
    if (wallpaper === 'auto') return autoScene(effect);
    if (wallpaper === 'ville') return VILLE[effect] || 'nuit';
    return PALETTES[wallpaper] ? wallpaper : null;
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  const api = { PALETTES, ORDER, AUTO, AUTO_SCENES, AUTO_PERIOD, autoScene, VILLE, VILLE_KEYS, resolve, hexToRgb };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BRUME_PALETTES = api;
})(typeof window !== 'undefined' ? window : globalThis);
