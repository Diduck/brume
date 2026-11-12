// Brume — scène « Ville », en pixel art.
//
// Vue au niveau de la rue : le ciel (lune ou soleil) et la ville lointaine, une rangée de
// façades détaillées en face (briques, corniches, fenêtres, boutiques, enseignes), la
// chaussée avec voitures et cycliste, puis notre trottoir avec passants, un arbre de
// saison, un lampadaire, un banc où quelqu'un lit, et des pigeons.
//
// Cinq variantes (nuit d'hiver, crépuscule, pluie, sakura, automne) ; l'ambiance s'adapte
// en plus à l'effet météo choisi (neige, pluie, orage, pétales, feuilles…). Le décor est
// peint une fois (éclairage calculé pixel par pixel), puis chaque image ne dessine que ce
// qui bouge. Le décor est repeint quand l'effet météo change.
(function () {
  'use strict';
  const B = window.Brume;
  const { Raster, sprite, hex, mix, rng, hash, fbm, bayer } = B.PX;
  const SP = B.Sprites;
  const X = B.PXC;
  const C = hex;
  const WHITE = [255, 255, 255];
  const BLACK = [0, 0, 0];
  const toHex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const rgbStr = (c) => `${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])}`;

  /* ================= Monde élargi (caméra d'ouverture) ================= */
  // Pour l'animation d'ouverture, la scène peut peindre une rue plus longue que l'écran :
  // le monde va de x = −extL à W + extR, et l'écran reste [0, W). Une toile élargie range
  // le pixel x de la scène en x + extL ; on y peint toujours en coordonnées de scène (le
  // bruit, les trames et les hasards restent donc les mêmes).
  // Pendant la peinture de l'extension (scene.extMode), on ne touche JAMAIS l'écran [0, W),
  // ni ce que la peinture de l'écran a déjà posé hors cadre (le masque) : le fond d'écran
  // reste identique au pixel près. Le mode « free » ignore le masque (finitions : neige,
  // liseré de lumière) mais protège toujours l'écran.
  class WRaster extends Raster {
    constructor(s, h, mask = true) {
      super(s.WW, h);
      this.s = s;
      this.ox = s.extL;
      this.vw = s.W;
      this.lo = -s.extL;
      this.hi = s.W + s.extR;
      this.mask = mask && s.WW > s.W ? new Uint8Array(s.WW * h) : null;
    }

    set(x, y, c, a = 255) {
      x |= 0;
      y |= 0;
      if (x < this.lo || y < 0 || x >= this.hi || y >= this.h) return;
      const p = y * this.w + x + this.ox;
      const m = this.s.extMode;
      if (m) {
        if (x >= 0 && x < this.vw) return;
        if (m !== 'free' && this.mask && this.mask[p]) return;
      } else if (this.mask) this.mask[p] = 1;
      const i = p * 4;
      this.data[i] = c[0];
      this.data[i + 1] = c[1];
      this.data[i + 2] = c[2];
      this.data[i + 3] = a;
    }

    // Lecture : bornée à l'écran pendant la peinture de l'écran (comme une toile de largeur
    // W), au monde entier pendant celle de l'extension.
    get(x, y) {
      const e = this.s.extMode;
      x = Math.max(e ? this.lo : 0, Math.min((e ? this.hi : this.vw) - 1, x | 0));
      y = Math.max(0, Math.min(this.h - 1, y | 0));
      const i = (y * this.w + x + this.ox) * 4;
      return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
    }

    alpha(x, y) {
      return this.data[(y * this.w + x + this.ox) * 4 + 3];
    }
  }

  /* ================= Ambiances ================= */

  // Variante → ambiance par défaut (moment de la journée, saison, pluie, particules propres).
  const VARIANTS = {
    nuit: { tod: 'night', season: 'winter', wet: false, fx: 'snow' },
    crepuscule: { tod: 'sunset', season: 'summer', wet: false, fx: null },
    pluie: { tod: 'night', season: 'summer', wet: true, fx: 'rain' },
    sakura: { tod: 'day', season: 'spring', wet: false, fx: 'petals' },
    automne: { tod: 'dusk', season: 'autumn', wet: false, fx: 'leaves' },
  };

  // L'effet météo modifie l'ambiance de la variante.
  function resolveLook(variant, effect) {
    const v = VARIANTS[variant] || VARIANTS.nuit;
    const lk = { variant, tod: v.tod, season: v.season, wet: v.wet, overcast: v.wet, storm: false, starfall: false, fx: null };
    switch (effect) {
      case 'snow':
        lk.season = 'winter';
        lk.wet = false;
        lk.overcast = false;
        break;
      case 'rain':
        lk.wet = true;
        lk.overcast = true;
        break;
      case 'storm':
        lk.wet = true;
        lk.overcast = true;
        lk.storm = true;
        break;
      case 'sakura':
        lk.season = 'spring';
        lk.wet = false;
        lk.overcast = false;
        break;
      case 'leaves':
        lk.season = 'autumn';
        lk.wet = false;
        lk.overcast = false;
        break;
      case 'fireflies':
        lk.season = 'summer';
        lk.tod = 'night';
        lk.wet = false;
        lk.overcast = false;
        break;
      case 'starfall':
        lk.tod = 'night';
        lk.wet = false;
        lk.overcast = false;
        lk.starfall = true;
        break;
      default:
        lk.fx = v.fx; // particules propres à la scène seulement sans effet météo (pas de double météo)
    }
    lk.snow = lk.season === 'winter' && !lk.wet;
    lk.lightsOn = lk.tod !== 'day';
    lk.night = lk.tod === 'night';
    lk.garland = lk.lightsOn && (lk.season === 'winter' || (lk.night && !lk.wet));
    lk.birds = !lk.night && !lk.storm;
    lk.pigeons = !lk.night && !lk.wet;
    return lk;
  }

  const SKY = {
    night: ['#080d28', '#141b44', '#272c5c', '#45386c'],
    nightO: ['#0b1322', '#16243a', '#243650', '#3a5070'],
    sunset: ['#2b1f4f', '#6e3474', '#d65a78', '#ffb36a'],
    sunsetO: ['#38324c', '#584860', '#86687a', '#b08a84'],
    day: ['#78b0de', '#a4cdea', '#e6dcea', '#fff0dc'],
    dayO: ['#76849a', '#95a0b0', '#b2bac4', '#c6cad0'],
    dusk: ['#36203e', '#73364a', '#c25c3a', '#f2a24a'],
    duskO: ['#2c2836', '#463a46', '#66504e', '#86684e'],
  };
  // Lumière ambiante (multiplicateur) et couleur des lampes, par moment de la journée.
  const LIGHT = {
    night: { amb: [0.34, 0.38, 0.6], warm: [1.0, 0.78, 0.48] },
    sunset: { amb: [0.74, 0.56, 0.64], warm: [0.6, 0.42, 0.24] },
    day: { amb: [1.0, 0.98, 0.97], warm: [0.12, 0.08, 0.04] },
    dusk: { amb: [0.66, 0.5, 0.5], warm: [0.85, 0.6, 0.32] },
  };

  /* ================= Matériaux et boutiques ================= */

  const MATS = {
    brick: { base: '#a65440', alt: '#98493a', mortar: '#8c4436', hi: '#bc664e', dark: '#5e2c24', trim: '#e2d6c2', trimHi: '#f4ecdc', frame: '#e8e0d0' },
    stone: { base: '#d4c4a2', alt: '#cab896', mortar: '#b8a684', hi: '#e8dcc0', dark: '#8a7a60', trim: '#e8dcc4', trimHi: '#f6eedc', frame: '#3a3a40' },
    stucco: { base: '#dc9c8c', alt: '#d2907f', mortar: '#c4867a', hi: '#ecb8a8', dark: '#9a5e54', trim: '#f2e4d4', trimHi: '#fcf2e6', frame: '#f2e4d4' },
    slate: { base: '#5e6e88', alt: '#58677f', mortar: '#4e5b72', hi: '#7a8aa4', dark: '#363f52', trim: '#c8ccd6', trimHi: '#e4e8ee', frame: '#22262e' },
    wood: { base: '#3e706a', alt: '#386860', mortar: '#2c5650', hi: '#5a8c84', dark: '#1e3c38', trim: '#e6d8bc', trimHi: '#f4ead4', frame: '#2a1e18' },
    tan: { base: '#c48c5e', alt: '#b88256', mortar: '#a6744a', hi: '#dcaa7a', dark: '#6e4a2e', trim: '#efe2c8', trimHi: '#faf2e0', frame: '#efe2c8' },
    green: { base: '#557a5e', alt: '#4f7258', mortar: '#46664e', hi: '#729a7a', dark: '#2c4434', trim: '#ece2c8', trimHi: '#f8f0dc', frame: '#ece2c8' },
    // Matériaux de la rue prolongée (animation d'ouverture).
    cream: { base: '#e0d0ae', alt: '#d6c4a0', mortar: '#c2b08c', hi: '#eee2c6', dark: '#927e5c', trim: '#f2e8d2', trimHi: '#fcf6e8', frame: '#2e2a2a' },
    ochre: { base: '#d6a058', alt: '#cc9650', mortar: '#ba8644', hi: '#e8ba78', dark: '#7a5428', trim: '#f2e2c4', trimHi: '#fbf2e0', frame: '#f2e2c4' },
    blue: { base: '#6a88a8', alt: '#63809e', mortar: '#587494', hi: '#86a2c0', dark: '#3a4e66', trim: '#e8e4dc', trimHi: '#f6f2ea', frame: '#e8e4dc' },
    church: { base: '#bcb29c', alt: '#b2a890', mortar: '#a29880', hi: '#d2c8b2', dark: '#6e6654', trim: '#d8d0bc', trimHi: '#ece6d6', frame: '#3a3430' },
  };
  for (const k of Object.keys(MATS)) for (const c of Object.keys(MATS[k])) MATS[k][c] = C(MATS[k][c]);

  const SHOPS = {
    PIZZA: { board: '#2a2a2e', paint: '#f2e2c4', neon: '#ff5a4a', awn: ['#c4463c', '#efe6d4'], door: 'right', open: true },
    BOOKS: { board: '#23402f', paint: '#e8d8a8', neon: '#7fe3ff', awn: ['#2f6a4a', '#e8dcc0'], door: 'left' },
    FLEURS: { board: '#4a2a3a', paint: '#ffc0d4', neon: '#b8ff8a', awn: ['#d86a8a', '#f4ecdc'], door: 'right' },
    HOTEL: { board: '#3a1a22', paint: '#e8c47c', neon: '#ff5fa2', door: 'center' },
    RAMEN: { board: '#2a1a14', paint: '#f2e2c4', neon: '#ffd060', door: 'right' },
    CAFE: { board: '#3a2418', paint: '#f0d8a8', neon: '#ffb36b', awn: ['#d8a83a', '#5a3a2a'], door: 'left', open: true },
    BAKERY: { board: '#3a2a4a', paint: '#f4e4c4', neon: '#ffe9a8', awn: ['#3a4a8a', '#e8e0d0'], door: 'right' },
    // Boutiques de la rue prolongée (on ne les voit que pendant l'animation d'ouverture).
    TABAC: { board: '#232c58', paint: '#f4e4c4', neon: '#ff7a5a', door: 'left', interior: 'TABAC', extra: 'tabac', keeper: '#e8e0d8' },
    CINEMA: { board: '#4a1626', paint: '#ffe2a0', neon: '#ffcf5a', door: 'center', doorW: 15, interior: 'CINEMA', extra: 'cinema' },
    BISTROT: { board: '#3a2016', paint: '#f2d8a4', neon: '#ff9a52', awn: ['#b8322c', '#efe6d4'], door: 'right', open: true, interior: 'CAFE', extra: 'terrace', keeper: '#e8e0d8' },
    BOULANGERIE: { board: '#5a1e24', paint: '#f2d48a', neon: '#ffe08a', awn: ['#e8d8b0', '#c89a5a'], door: 'left', interior: 'BAKERY', extra: 'bread', keeper: '#f4ece0' },
    PHARMACIE: { board: '#1c4a38', paint: '#e8f6e8', neon: '#6aff9a', door: 'right', interior: 'PHARMA', extra: 'pharma' },
    FROMAGERIE: { board: '#22305a', paint: '#f2d06a', neon: '#ffe27a', awn: ['#2a4a8a', '#e8e0d0'], door: 'right', interior: 'CHEESE', keeper: '#f0e8dc' },
    GALERIE: { board: '#1a1a1e', paint: '#e8e0d0', neon: '#c8d8ff', door: 'left', interior: 'ART' },
    PRIMEUR: { board: '#2e5a2e', paint: '#f4e8c0', neon: '#c8ff6a', awn: ['#3a8a3a', '#f2ecd8'], door: 'right', interior: 'FRUIT', extra: 'fruit', keeper: '#e8e0d8' },
  };

  // La rue prolongée : à gauche de l'écran (de la droite vers la gauche) et à droite.
  // « lot » : une place, une rue transversale ou une église au lieu d'un immeuble ordinaire.
  // lamp : position d'un lampadaire du trottoir d'en face (fraction de la largeur).
  const EXT_LEFT = [
    { w: 56, mat: 'cream', kind: 'stone', floors: 3, roof: 'mansard', balcony: true, shop: 'TABAC' },
    { w: 86, lot: 'square', lamp: 0.08 },
    { w: 92, lot: 'church', mat: 'church' },
    { w: 32, lot: 'lane' },
    { w: 80, mat: 'ochre', kind: 'stucco', floors: 3, roof: 'flat', vsign: true, vtext: 'ODEON', vneon: '#ffcf5a', shop: 'CINEMA', lamp: 1 },
    { w: 70, mat: 'brick', kind: 'brick', floors: 3, roof: 'flat', chimney: true, flowers: true, shop: 'BISTROT' },
    { w: 62, mat: 'blue', kind: 'wood', floors: 2, roof: 'tile', shutters: true, shop: 'BOULANGERIE' },
    { w: 60, mat: 'stone', kind: 'stone', floors: 3, roof: 'mansard', balcony: true, shop: 'PHARMACIE', metro: true, lamp: 0 },
    { w: 64, mat: 'stucco', kind: 'stucco', floors: 2, roof: 'flat', chimney: true, shutters: true, shop: 'FROMAGERIE' },
    { w: 66, mat: 'cream', kind: 'stone', floors: 3, roof: 'mansard', arch: true, shop: 'GALERIE', lamp: 0 },
  ];
  const EXT_RIGHT = [
    { w: 66, mat: 'ochre', kind: 'brick', floors: 3, roof: 'flat', chimney: true, flowers: true, shop: 'PRIMEUR' },
    { w: 60, mat: 'cream', kind: 'stone', floors: 3, roof: 'mansard', balcony: true, shop: 'GALERIE' },
  ];
  // Notre trottoir prolongé (premier plan) : position du centre, en partant de l'écran.
  const EXT_FG = [
    { k: 'bus', x: -78 },
    { k: 'lamp', x: -148 },
    { k: 'velib', x: -212 },
    { k: 'tree', x: -282 },
    { k: 'kiosk', x: -344 },
    { k: 'busker', x: -414 },
    { k: 'lamp', x: -468 },
    { k: 'wallace', x: -512 },
    { k: 'planter', x: -546 },
    { k: 'tree', x: -596 },
  ];
  const EXT_FG_MORE = [
    { k: 'lamp', x: -40 },
    { k: 'bench', x: -96 },
    { k: 'tree', x: -150 },
    { k: 'planter', x: -190 },
  ];

  // Les immeubles d'en face, de gauche à droite (répétés si l'écran est très large).
  const SPECS = [
    { w: 74, mat: 'brick', kind: 'brick', floors: 3, roof: 'flat', tank: true, fe: true, flowers: true, shop: 'PIZZA' },
    { w: 80, mat: 'stone', kind: 'stone', floors: 4, roof: 'mansard', balcony: true, arch: true, shop: 'BOOKS' },
    { w: 70, mat: 'stucco', kind: 'stucco', floors: 1, roof: 'terrace', shutters: true, shop: 'FLEURS', low: true },
    { w: 46, mat: 'slate', kind: 'stone', floors: 4, roof: 'flat', antenna: true, vsign: true, shop: 'HOTEL' },
    { w: 64, mat: 'wood', kind: 'wood', floors: 2, roof: 'tile', shop: 'RAMEN', moon: true },
    { w: 72, mat: 'tan', kind: 'brick', floors: 3, roof: 'flat', chimney: true, flowers: true, shop: 'CAFE' },
    { w: 62, mat: 'green', kind: 'stucco', floors: 2, roof: 'mansard', shutters: true, shop: 'BAKERY' },
  ];

  const CURTAINS = ['#c4685a', '#4a8a8a', '#d8b25a', '#8a6aa8', '#e0d0b8', '#5a7ab0'].map(C);

  /* ================= Sprites propres à la scène ================= */

  // Passants, lecteur du banc et cycliste : peints par B.People (people.js).
  const PP = B.People;

  // Vélo (avec ou sans cycliste) construit sur une grille de lettres, roue arrière à gauche.
  const WHEEL = [[-1, -3], [0, -3], [1, -3], [-2, -2], [2, -2], [-3, -1], [3, -1], [-3, 0], [3, 0], [-3, 1], [3, 1], [-2, 2], [2, 2], [-1, 3], [0, 3], [1, 3]];
  function bikeRows(fr, rider) {
    const w = 21;
    const h = 18;
    const gr = Array.from({ length: h }, () => Array(w).fill('.'));
    const put = (x, y, ch) => {
      x = Math.round(x);
      y = Math.round(y);
      if (x >= 0 && y >= 0 && x < w && y < h) gr[y][x] = ch;
    };
    const line = (x0, y0, x1, y1, ch) => {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let k = 0; k <= n; k++) put(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, ch);
    };
    const wheel = (cx, cy) => {
      for (const [dx, dy] of WHEEL) put(cx + dx, cy + dy, 't');
      put(cx, cy, 'o');
      const a = (fr * Math.PI) / 4;
      put(cx + Math.cos(a) * 2, cy + Math.sin(a) * 2, 'o');
      put(cx - Math.cos(a) * 2, cy - Math.sin(a) * 2, 'o');
    };
    const ang = (fr * Math.PI) / 2;
    const hip = [7, 7];
    const leg = (s, cl, cs) => {
      const f = [9 + Math.cos(ang + s) * 2.4, 14 + Math.sin(ang + s) * 2.4];
      const dx = f[0] - hip[0];
      const dy = f[1] - hip[1];
      const d = Math.max(0.01, Math.hypot(dx, dy));
      const L1 = 4.8;
      const a = Math.min(d / 2, L1);
      const hh = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      const ux = dx / d;
      const uy = dy / d;
      let px = -uy;
      let py = ux;
      if (px < 0) {
        px = -px;
        py = -py;
      }
      const k = [hip[0] + ux * a + px * hh, hip[1] + uy * a + py * hh];
      line(hip[0], hip[1], k[0], k[1], cl);
      line(k[0], k[1], f[0], f[1], cl);
      put(f[0] + 1, f[1], cs);
      put(f[0], f[1], cs);
    };
    if (rider) leg(Math.PI, 'q', 'z');
    wheel(3, 14);
    wheel(17, 14);
    line(3, 14, 9, 14, 'f');
    line(9, 14, 7, 9, 'f');
    line(7, 10, 14, 10, 'f');
    line(9, 14, 14, 10, 'f');
    line(14, 10, 17, 14, 'f');
    line(14, 10, 14, 7, 'f');
    put(13, 7, 'g');
    put(15, 7, 'g');
    put(15, 8, 'g');
    put(6, 8, 'S');
    put(7, 8, 'S');
    put(8, 8, 'S');
    put(9, 14, 'g');
    if (rider) {
      for (let d = 0; d < 3; d++) line(6 + d, 7, 9 + d, 3, 'c');
      line(10, 4, 13, 7, 'c');
      put(14, 7, 'k');
      put(10, 0, 'H');
      put(11, 0, 'H');
      put(12, 0, 'H');
      put(9, 1, 'H');
      put(10, 1, 'H');
      put(11, 1, 'H');
      put(12, 1, 'k');
      put(13, 1, 'k');
      put(10, 2, 'k');
      put(11, 2, 'k');
      put(12, 2, 'k');
      put(13, 2, 'k');
      leg(0, 'p', 's');
    }
    return gr.map((r) => r.join(''));
  }
  const BIKE_PAL = { t: '#16161c', o: '#9a9aa4', g: '#3a3a44', S: '#2a1e1a', H: '#e8c547', k: '#e2b08e', c: '#d4564f', p: '#2a3a5a', q: '#1c2638', s: '#101014', z: '#0c0c10' };

  const PIGEON = {
    stand: ['.hh.....', 'yhhn....', '..nggg..', '..ggggGG', '..gGGgG.', '...o.o..'],
    peck: ['........', '........', '..ngggg.', '.nhggggG', 'yhhGGgG.', '...o.o..'],
  };
  const PIGEON_PAL = { h: '#5a5e70', n: '#4a7a74', g: '#8a8e9e', G: '#646878', y: '#d8c8b0', o: '#d8705a' };

  const SNOWMAN = [
    '.....kkkk......',
    '.....kkkk......',
    '.....rrrr......',
    '....kkkkkk.....',
    '.....wwww......',
    '....wewwew.....',
    '....wwwwwoo....',
    '....wwmmwW.....',
    '.....wwwW......',
    '...ffffffff....',
    '....wwwwwwff...',
    'b..wwwwwwwwWf.b',
    '.b.wwwwewwWWfb.',
    '..bwwwwwwwWWb..',
    '...wwwwwwWW....',
    '...wwwwewWW....',
    '..wwwwwwwwWW...',
    '.wwwwwwwwwwWW..',
    '.wwwwwwewwwWW..',
    '.wwwwwwwwwwWW..',
    '.wwwwwwwwwWWW..',
    '..wwwwwwwWWW...',
    '...WWWWWWWW....',
  ];
  const SNOWMAN_PAL = { w: '#f4f6fa', W: '#c4d0e4', k: '#1e1e26', r: '#c8463c', e: '#1a1a20', o: '#f08a2a', m: '#3a3a44', f: '#d4564f', b: '#5a3a24' };

  const HYDRANT = ['...rr...', '..rlrR..', '.rlrrrR.', '..rlrR..', 'yrlrrrRy', 'yrlrrrRy', '..rlrR..', '..rlrR..', '..rlrR..', '..rlrR..', '.rlrrrR.', 'rrrrrrRR'];
  const HYDRANT_PAL = { r: '#c8382c', R: '#8a2420', l: '#e86a54', y: '#d8b04a' };

  // Copie un dessin texte directement dans un Raster.
  function stamp(r, rows, pal, x, y, flip = false) {
    const cols = {};
    for (const k of Object.keys(pal)) cols[k] = C(pal[k]);
    const w = Math.max(...rows.map((s) => s.length));
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const c = cols[row[i]];
        if (c) r.set(x + (flip ? w - 1 - i : i), y + j, c);
      }
    });
  }

  // Assombrit une image (sprite) vers une teinte : personnages à la lumière du soir.
  function shade(cv, rgb, a) {
    if (!a) return cv;
    const c = document.createElement('canvas');
    c.width = cv.width;
    c.height = cv.height;
    const x = c.getContext('2d');
    x.drawImage(cv, 0, 0);
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = `rgba(${rgb},${a})`;
    x.fillRect(0, 0, c.width, c.height);
    return c;
  }

  /* ================= La scène ================= */

  class City {
    constructor(W, H, variant, opts = {}) {
      this.W = W;
      this.H = H;
      this.variant = variant;
      // Monde élargi (animation d'ouverture) : extL pixels à gauche de l'écran, extR à droite.
      const ext = opts && opts.ext;
      this.extL = ext ? Math.max(0, Math.round(ext.left || 0)) : 0;
      this.extR = ext ? Math.max(0, Math.round(ext.right || 0)) : 0;
      this.WW = this.extL + W + this.extR;
      this.wx0 = -this.extL;
      this.wx1 = W + this.extR;
      this.extMode = false;
      this.t = 0;
      this.effect = null;
      this.look = null;
      this.bg = null;
      this.layout();

      const L = this.L;
      this.base = {
        cars: [0, 1, 2].map(SP.car),
        cat: SP.cat(),
        mug: SP.mug(),
        bike: [0, 1, 2, 3].map((f) => bikeRows(f, true)),
        pigeon: { stand: sprite(PIGEON.stand, PIGEON_PAL), peck: sprite(PIGEON.peck, PIGEON_PAL), standR: sprite(PIGEON.stand, PIGEON_PAL, true), peckR: sprite(PIGEON.peck, PIGEON_PAL, true) },
      };
      const { wx0, wx1 } = this;
      this.crowd = new X.Crowd({ x0: wx0, x1: wx1, walkY: L.walkY, rate: [3, 8], mix: { umbrella: 0.62, kid: 0.16, dog: 0.22 }, hh: 5.6, style: false });
      this.trafficFar = new X.Traffic({ x0: wx0, x1: wx1, groundY: L.laneFar, rate: [9, 20] });
      this.trafficNear = new X.Traffic({ x0: wx0, x1: wx1, groundY: L.laneNear, rate: [7, 16] });
      this.cyclist = null;
      this.nextBike = 6 + Math.random() * 8;
      this.flock = new X.Flock({ x0: wx0, x1: wx1, y0: 8, y1: Math.round(H * 0.3), rate: [7, 16] });
      this.smoke = new X.Puffs('190,192,205');
      this.steam = new X.Puffs('225,230,240');
      this.cupSteam = new X.Puffs('235,235,245');
      this.cat = { state: 'sleep', x: Math.round(W * 0.55), target: 0, dir: -1, timer: 20 + Math.random() * 10, frameT: 0, next: 'lick' };
      this.sitter = { pose: 'read', until: 0, nextPage: 4 + Math.random() * 4, nextLook: 10 + Math.random() * 6 };
      const px0 = Math.round(W * 0.49);
      this.pigeons = [0, 1, 2].map((i) => ({ x: px0 + i * 11 + Math.random() * 4, y: 0, dir: Math.random() < 0.5 ? -1 : 1, state: 'peck', timer: Math.random() * 2, t: Math.random() }));
      this.plane = null;
      this.nextPlane = 12 + Math.random() * 20;
      this.nextToggle = 2;
      this.flash = 0;
      this.nextBolt = 5 + Math.random() * 8;
      this.bolt = null;
      if (X.fastTest()) {
        this.crowd.next = 0.2;
        this.trafficNear.next = 0.5;
        this.trafficFar.next = 1.5;
        this.nextBike = 0.6;
        this.cat.timer = 1;
        this.flock.next = 0.3;
        this.nextPlane = 0.5;
        this.sitter.nextPage = 1;
      }
    }

    /* ---------- Plan de la rue (indépendant de l'ambiance) ---------- */
    layout() {
      const { W, H } = this;
      const L = (this.L = {});
      L.street0 = Math.round(H * 0.62); // pied des façades d'en face
      L.shopTop = L.street0 - 30; // haut des devantures
      L.s0 = L.street0 + 7; // début de la chaussée
      L.s1 = L.street0 + 36; // bordure de notre trottoir
      L.ns = L.s1 + 3; // notre trottoir
      L.walkY = Math.round(L.ns + (H - L.ns) * 0.38);
      L.gY = Math.round(L.ns + (H - L.ns) * 0.76); // pied du mobilier du premier plan
      L.laneFar = L.s0 + 12;
      L.laneNear = L.s0 + 25;
      L.bikeY = L.s1 - 1;
      L.lampX = Math.round(W * 0.3);
      L.lampY = Math.round(H * 0.45);
      L.treeX = Math.round(W * 0.08);
      L.morrisX = Math.round(W * 0.87);
      L.benchX = Math.round(W * 0.4);
      L.benchY = L.gY - 8;
      L.pigeonY = Math.min(H - 2, L.gY + 10);
      L.manX = Math.round(W * 0.56);
      const maxF = Math.max(1, Math.floor((L.shopTop - 2 - 5 - 16) / 22)); // nombre d'étages max
      const scale = Math.max(0.85, Math.min(1.25, W / 468));
      this.blds = [];
      let x = -8;
      let i = 0;
      while (x < W) {
        const s = SPECS[i % SPECS.length];
        const w = Math.round(s.w * scale);
        const floors = Math.min(maxF, s.floors);
        const top = L.shopTop - 2 - floors * 22 - 5;
        this.blds.push({ ...s, x, w, floors, top, idx: i });
        x += w;
        i++;
      }
      const inView = (b) => b.x > W * 0.15 && b.x + b.w < W * 0.92;
      const low = this.blds.find((b) => b.low && inView(b)) || this.blds.reduce((a, b) => (b.top > a.top && inView(b) ? b : a), this.blds[1]);
      L.sunX = Math.round(low.x + low.w / 2);
      L.sunY = low.top - 16;
      L.towerX = Math.round(low.x + low.w * 0.8);
      const mb = this.blds.find((b) => b.moon && inView(b));
      L.moonX = mb ? Math.round(mb.x + mb.w / 2) : Math.round(W * 0.75);
      L.moonY = Math.round(H * 0.13);
      // Lampadaires du trottoir d'en face, aux limites entre immeubles.
      L.farLamps = this.blds.filter((b) => b.idx === 1 || b.idx === 4 || b.idx === 8).map((b) => b.x).filter((v) => v > 6 && v < W - 6);
      this.layoutExt(scale, maxF);
    }

    // Plan de la rue prolongée (seulement avec un monde élargi).
    layoutExt(scale, maxF) {
      const { W, L } = this;
      this.extLots = [];
      this.extFg = [];
      L.extFarLamps = [];
      if (!this.extL && !this.extR) return;
      const mk = (s, x, w, idx) => {
        const floors = Math.min(maxF, s.floors || 1);
        return { ...s, x, w, floors, top: L.shopTop - 2 - floors * 22 - 5, idx };
      };
      // À gauche, de l'immeuble le plus à gauche de l'écran vers le bout du monde.
      let x = this.blds[0].x;
      for (let i = 0; x > this.wx0 - 4; i++) {
        const s = EXT_LEFT[i % EXT_LEFT.length];
        const w = Math.round(s.w * scale);
        x -= w;
        this.extLots.push(mk(s, x, w, 100 + i));
      }
      // À droite, après le dernier immeuble de l'écran.
      const last = this.blds[this.blds.length - 1];
      x = last.x + last.w;
      for (let i = 0; x < this.wx1 + 4; i++) {
        const s = EXT_RIGHT[i % EXT_RIGHT.length];
        const w = Math.round(s.w * scale);
        this.extLots.push(mk(s, x, w, 200 + i));
        x += w;
      }
      // Lampadaires du trottoir d'en face (jamais tout près du bord de l'écran).
      for (const b of this.extLots) {
        if (b.lamp == null) continue;
        const lx = Math.round(b.x + b.lamp * b.w);
        if (lx < -14 || lx > W + 14) L.extFarLamps.push(lx);
      }
      // Notre trottoir : mobilier, de l'écran vers la gauche (motif prolongé si l'écran est large).
      for (const f of EXT_FG) if (f.x > this.wx0 - 30) this.extFg.push({ ...f });
      for (let base = -620; base > this.wx0 - 30; base -= 220) {
        for (const f of EXT_FG_MORE) if (base + f.x > this.wx0 - 30) this.extFg.push({ ...f, x: base + f.x });
      }
      // À droite, après l'arbre du bord de l'écran.
      if (this.extR > 40) this.extFg.push({ k: 'planter', x: W + 48 }, { k: 'lamp', x: W + 76 });
    }

    /* ================= Peinture du décor ================= */
    build(effect) {
      this.effect = effect;
      const lk = (this.look = resolveLook(this.variant, effect));
      const { W, H, L } = this;
      this.windows = [];
      this.ledges = [];
      this.signs = [];
      this.chimneys = [];
      this.keepers = [];
      this.lanterns = [];
      this.post = [];
      this.lights = [];
      this.halos = [];
      this.bulbs = [];
      this.stars = [];
      const pal = LIGHT[lk.tod];
      const amb = lk.overcast ? [pal.amb[0] * 0.84, pal.amb[1] * 0.88, pal.amb[2] * 0.96] : pal.amb;
      // Monde élargi : ce qui est peint pour l'extension vient TOUJOURS après ce qui est peint
      // pour l'écran, avec son propre hasard ; ses lampes et halos sont marqués (e) pour ne
      // jamais éclairer l'écran.
      const wide = this.extL > 0 || this.extR > 0;
      const sides = [[this.wx0, 0], [W, this.wx1]].filter(([a, b]) => b > a);
      const extDo = (mode, fn) => {
        if (!wide) return;
        const nl = this.lights.length;
        const nh = this.halos.length;
        this.extMode = mode;
        fn();
        this.extMode = false;
        for (let i = nl; i < this.lights.length; i++) this.lights[i].e = 1;
        for (let i = nh; i < this.halos.length; i++) this.halos[i].e = 1;
      };
      this.xr = rng(31337);
      this.busker = null;
      this.busStop = null;
      this.extExtras = [];
      this.marquee = [];
      this.crosses = [];
      this.fountains = [];

      // Ciel et ville lointaine.
      const sky = (this.skyR = new WRaster(this, H));
      this.paintSky(sky);
      extDo(true, () => this.paintSkyExt(sky));

      // Façades, rue, trottoirs.
      const sc = (this.sc = new WRaster(this, H));
      const lit = (this.litR = new WRaster(this, H));
      const R = rng(1977);
      this.paintStreet(sc, R);
      for (const b of this.blds) this.paintBuilding(sc, b, R);
      this.paintFarLamps(sc);
      if (lk.snow) this.snowPass(sc);
      this.nVpWin = this.windows.length;
      const nLedges = this.ledges.length;
      extDo(true, () => {
        const RX = rng(4711);
        for (const [a, b] of sides) this.paintStreet(sc, RX, a, b);
        this.paintExtLots(sc, RX);
        this.paintFarLamps(sc, L.extFarLamps);
        this.extFgLights();
      });
      if (lk.snow) extDo('free', () => {
        for (const [a, b] of sides) this.snowPass(sc, a, b, nLedges);
      });
      if (lk.lightsOn) {
        this.lights.push({ x: L.lampX + 1, y: L.lampY + 5, r: 24, k: 0.85, sy: 0.5 });
        this.lights.push({ x: L.lampX + 1, y: L.gY, r: 20, k: 0.3, sy: 2.2 });
      }
      // Ligne du haut des toits (pour cacher ce qui passe « derrière » les immeubles).
      this.skyTop = new Int16Array(this.WW);
      for (let x = this.wx0; x < this.wx1; x++) {
        let y = 0;
        while (y < L.street0 && !sc.alpha(x, y)) y++;
        this.skyTop[x - this.wx0] = y;
      }
      this.applyLights(sc, amb, pal.warm);
      for (const f of this.post) f(sc);
      this.post = [];
      if (lk.tod === 'sunset' || lk.tod === 'dusk') {
        const rim = lk.tod === 'sunset' ? C('#ffb070') : C('#ffaa5a');
        this.rimLight(sc, rim);
        extDo('free', () => {
          for (const [a, b] of sides) this.rimLight(sc, rim, false, a, b);
        });
      }

      // Assemblage : la scène par-dessus le ciel.
      const fin = new WRaster(this, H, false);
      for (let i = 0; i < this.WW * H * 4; i += 4) {
        const src = sc.data[i + 3] ? sc.data : sky.data;
        fin.data[i] = src[i];
        fin.data[i + 1] = src[i + 1];
        fin.data[i + 2] = src[i + 2];
        fin.data[i + 3] = 255;
      }
      if (lk.tod === 'sunset' || lk.tod === 'dusk') this.sunShaft(fin);
      if (lk.wet) {
        this.wetPass(fin);
        extDo(true, () => {
          for (const [a, b] of sides) this.wetPass(fin, a, b, L.extFarLamps);
        });
      }
      // Léger assombrissement du bas de l'image (profondeur).
      for (let y = H - 14; y < H; y++) for (let x = 0; x < W; x++) fin.tint(x, y, BLACK, ((y - (H - 14)) / 14) * 0.2);
      extDo(true, () => {
        for (const [a, b] of sides) for (let y = H - 14; y < H; y++) for (let x = a; x < b; x++) fin.tint(x, y, BLACK, ((y - (H - 14)) / 14) * 0.2);
      });
      if (lk.garland) {
        this.paintGarland(fin);
        extDo(true, () => this.paintGarlandExt(fin));
      }
      this.bg = fin.toCanvas();
      this.litCv = lit.toCanvas();

      // Premier plan : arbres, lampadaire, banc, mobilier urbain.
      const fg = new WRaster(this, H);
      this.paintForeground(fg);
      extDo(true, () => this.paintForegroundExt(fg));
      if (lk.snow) extDo('free', () => {
        for (const [a, b] of sides) this.snowFg(fg, a, b);
      });
      if (lk.wet) extDo('free', () => {
        for (const [a, b] of sides) this.wetFg(fg, a, b);
      });
      this.applyLights(fg, amb, pal.warm);
      for (const f of this.post) f(fg);
      this.post = [];
      if (lk.tod === 'sunset' || lk.tod === 'dusk') {
        this.rimLight(fg, C('#ffb070'), true);
        extDo('free', () => {
          for (const [a, b] of sides) this.rimLight(fg, C('#ffb070'), true, a, b);
        });
      }
      this.fg = fg.toCanvas();

      // Halos (lampes, lune, soleil).
      this.halo = this.halos.length ? this.makeHalos() : null;

      this.configureLife();
    }

    // Hasard des éléments posés une fois : Math.random pour l'écran (comme toujours), un
    // hasard à part pour la rue prolongée (l'écran ne voit aucune différence).
    rnd() {
      return this.extMode ? this.xr() : Math.random();
    }

    // Une finition à appliquer après l'éclairage, dans le mode où elle a été demandée.
    pushPost(f) {
      const mode = this.extMode;
      if (!mode) this.post.push(f);
      else {
        this.post.push((t) => {
          const prev = this.extMode;
          this.extMode = mode;
          f(t);
          this.extMode = prev;
        });
      }
    }

    // Les lampes de l'extension s'effacent en approchant du bord de l'écran (aucun raccord).
    seam(x) {
      const d = x < 0 ? -x : x - this.W + 1;
      return Math.min(1, d / 40);
    }

    // X.applyLight, sur une toile élargie : l'écran reçoit exactement les mêmes lampes
    // qu'avant (dans le même ordre) ; l'extension reçoit en plus les siennes.
    applyLights(r, amb, warm) {
      const lights = this.lights;
      if (!this.extL && !this.extR) {
        X.applyLight(r, lights, amb, warm);
        return;
      }
      const vl = lights.filter((l) => !l.e);
      const el = lights.filter((l) => l.e);
      const { W } = this;
      for (let y = 0; y < r.h; y++) {
        for (let px = 0; px < r.w; px++) {
          const i = (y * r.w + px) * 4;
          if (!r.data[i + 3]) continue;
          const x = px - r.ox;
          let I = 0;
          for (const l of vl) {
            const dx = x - l.x;
            const dy = (y - l.y) * (l.sy || 1);
            I += l.k / (1 + (dx * dx + dy * dy) / (l.r * l.r));
          }
          if (x < 0 || x >= W) {
            const f = this.seam(x);
            let J = 0;
            for (const l of el) {
              const dx = x - l.x;
              if (dx > l.r * 12 || dx < -l.r * 12) continue;
              const dy = (y - l.y) * (l.sy || 1);
              J += l.k / (1 + (dx * dx + dy * dy) / (l.r * l.r));
            }
            I += J * f;
          }
          const q = Math.floor(Math.min(1.3, I) * 6 + bayer(x, y)) / 6;
          for (let c = 0; c < 3; c++) r.data[i + c] = Math.min(255, r.data[i + c] * (amb[c] + warm[c] * q));
        }
      }
    }

    // X.makeHalo, sur une toile élargie (même règle que pour les lampes).
    makeHalos() {
      const { W, H } = this;
      const halos = this.halos;
      if (!this.extL && !this.extR) return X.makeHalo(W, H, halos);
      const vh = halos.filter((h) => !h.e);
      const eh = halos.filter((h) => h.e);
      const r = new Raster(this.WW, H);
      for (let y = 0; y < H; y++) {
        for (let px = 0; px < this.WW; px++) {
          const x = px - this.extL;
          const out = x < 0 || x >= W;
          const f = out ? this.seam(x) : 0;
          let R = 0;
          let G = 0;
          let Bl = 0;
          for (const h of vh) {
            if (Math.abs(x - h.x) > h.r) continue;
            const d = Math.hypot(x - h.x, (y - h.y) * 1.2);
            if (d > h.r) continue;
            const q = (Math.floor((1 - d / h.r) ** 1.6 * 5 + bayer(x, y) * 0.9) / 5) * (h.k || 0.55);
            R += h.c[0] * q;
            G += h.c[1] * q;
            Bl += h.c[2] * q;
          }
          if (out && f > 0) {
            for (const h of eh) {
              if (Math.abs(x - h.x) > h.r) continue;
              const d = Math.hypot(x - h.x, (y - h.y) * 1.2);
              if (d > h.r) continue;
              const q = (Math.floor((1 - d / h.r) ** 1.6 * 5 + bayer(x, y) * 0.9) / 5) * (h.k || 0.55) * f;
              R += h.c[0] * q;
              G += h.c[1] * q;
              Bl += h.c[2] * q;
            }
          }
          if (R + G + Bl > 2) r.set(px, y, [R, G, Bl]);
        }
      }
      return r.toCanvas();
    }

    /* ---------- Ciel ---------- */
    paintSky(r) {
      const { W, H, L } = this;
      const lk = this.look;
      const hz = L.street0;
      const stops = (this.skyStops = SKY[lk.tod + (lk.overcast ? 'O' : '')].map(C));
      r.gradient(0, 0, W, hz + 2, stops, 12);
      r.rect(0, hz + 2, W, H - hz - 2, stops[3]);
      const R = rng(77);

      // Étoiles.
      if (lk.night && !lk.overcast) {
        const n = Math.round((W * hz) / (lk.starfall ? 70 : 120));
        for (let k = 0; k < n; k++) {
          const x = Math.floor(R() * W);
          const y = Math.floor(Math.pow(R(), 1.4) * hz * 0.85);
          const b = R();
          const c = mix(stops[0], [255, 248, 230], 0.3 + 0.7 * b * (1 - y / hz));
          r.set(x, y, c);
          if (b > 0.94 && y > 2) {
            const d = mix(c, stops[0], 0.5);
            r.set(x - 1, y, d);
            r.set(x + 1, y, d);
            r.set(x, y - 1, d);
            r.set(x, y + 1, d);
          }
          if (b > 0.6) this.stars.push({ x, y, p: R() * 6.28, s: 0.6 + R() * 2 });
        }
      }

      // Lune (nuit claire).
      if (lk.night && !lk.overcast) {
        const mx = L.moonX;
        const my = L.moonY;
        const rad = 8;
        for (let y = -rad; y <= rad; y++) {
          for (let x = -rad; x <= rad; x++) {
            const d = Math.hypot(x, y);
            if (d > rad + 0.3) continue;
            let c = C('#f4ecd2');
            const n = fbm((mx + x) * 0.35, (my + y) * 0.35, 3);
            if (n > 0.56) c = C('#d8cca8');
            if (n > 0.64) c = C('#c4b894');
            if (x + y > rad * 0.9 && d > rad - 2.2) c = mix(c, C('#a8a088'), 0.5);
            if (d > rad - 0.8 && x - y < 0) c = mix(c, WHITE, 0.4);
            r.set(mx + x, my + y, c);
          }
        }
        this.halos.push({ x: mx, y: my, r: 26, c: [170, 180, 230], k: 0.3 });
      }

      // Soleil : grand soleil rétro rayé (crépuscule), disque ambré (automne), petit soleil (jour).
      if (!lk.overcast && !lk.night) {
        if (lk.tod === 'sunset') {
          const rad = 22;
          const sx = L.sunX;
          const sy = L.sunY;
          const sun = ['#fff4b0', '#ffd27a', '#ff9a6a', '#ff6a7a'].map(C);
          for (let y = -rad; y <= rad; y++) {
            const yy = y + rad;
            if (y > 2 && (y % 5) - 1 < Math.floor((y - 2) / 6)) continue; // bandes rétro
            for (let x = -rad; x <= rad; x++) {
              if (x * x + y * y > rad * rad + rad * 0.4) continue;
              const t = (yy / (2 * rad)) * 3;
              const k = Math.min(2, Math.floor(t));
              const q = Math.min(4, Math.floor((t - k) * 4 + bayer(sx + x, sy + y)));
              r.set(sx + x, sy + y, mix(sun[k], sun[k + 1], q / 4));
            }
          }
          this.halos.push({ x: sx, y: sy, r: 70, c: [255, 150, 100], k: 0.35 });
        } else if (lk.tod === 'dusk') {
          const rad = 15;
          const sx = L.sunX + 6;
          const sy = L.sunY + 8;
          for (let y = -rad; y <= rad; y++) {
            for (let x = -rad; x <= rad; x++) {
              if (x * x + y * y > rad * rad + rad * 0.4) continue;
              const t = (y + rad) / (2 * rad);
              r.set(sx + x, sy + y, mix(C('#ffe6a0'), C('#ff9a48'), Math.floor(t * 4 + bayer(x, y)) / 4));
            }
          }
          this.halos.push({ x: sx, y: sy, r: 60, c: [255, 160, 80], k: 0.35 });
        } else {
          const sx = Math.round(W * 0.16);
          const sy = Math.round(H * 0.1);
          for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) if (x * x + y * y <= 38) r.set(sx + x, sy + y, x * x + y * y > 24 ? C('#fff2d0') : C('#fffaf0'));
          this.halos.push({ x: sx, y: sy, r: 34, c: [255, 240, 210], k: 0.35 });
        }
      }

      // Nuages.
      for (let y = 0; y < hz; y++) for (let x = 0; x < W; x++) this.cloudPx(r, x, y, hz, stops);

      // Ville lointaine, en deux plans.
      const farA = lk.night ? mix(stops[2], stops[1], 0.4) : mix(stops[3], stops[1], 0.5);
      const farB = lk.night ? mix(stops[1], BLACK, 0.25) : mix(stops[2], C('#2a2040'), 0.5);
      const winC = lk.lightsOn ? C('#d8a868') : mix(farB, WHITE, 0.15);
      this.far = { farA, farB, winC, hz };
      const skyline = (col, h0, h1, wmin, wmax, seed, winP) => {
        const RR = rng(seed);
        for (let x = -4; x < W; ) {
          const w = wmin + Math.floor(RR() * (wmax - wmin));
          const top = hz - h0 - Math.floor(RR() * (h1 - h0));
          r.rect(x, top, w, hz - top + 2, col);
          if (RR() < 0.3) r.rect(x + Math.floor(w / 3), top - 3, Math.max(2, Math.floor(w / 4)), 3, col);
          if (RR() < 0.2) r.rect(x + Math.floor(w / 2), top - 7, 1, 7, col);
          for (let wy = top + 2; wy < hz - 2; wy += 3) for (let wx = x + 1; wx < x + w - 1; wx += 2) if (RR() < winP) r.set(wx, wy, winC);
          x += w + (RR() < 0.25 ? 2 : 0);
        }
      };
      skyline(farA, 30, 70, 6, 16, 5, lk.lightsOn ? 0.1 : 0.05);
      skyline(farB, 14, 44, 8, 20, 9, lk.lightsOn ? 0.16 : 0.06);
      // Antenne de télévision lointaine (feu rouge clignotant).
      const tx = L.towerX;
      const ttop = Math.round(H * 0.15);
      for (let y = ttop; y < hz; y++) {
        const half = Math.round((y - ttop) * 0.1);
        r.set(tx - half, y, farB);
        r.set(tx + half, y, farB);
        if ((y - ttop) % 5 === 0) for (let x = tx - half; x <= tx + half; x++) r.set(x, y, farB);
        if ((y - ttop) % 10 === 5) for (let x = -half; x <= half; x++) r.set(tx + x, y + Math.round(Math.abs(x) * 0.5), farB);
      }
      r.rect(tx, ttop - 8, 1, 8, farB);
      this.tower = { x: tx, y: ttop - 9 };
      // Dôme lointain.
      const dx = Math.round(W * 0.88);
      for (let y = -8; y <= 0; y++) for (let x = -9; x <= 9; x++) if (x * x + y * y * 1.4 <= 81) r.set(dx + x, hz - 40 + y, farA);
      r.rect(dx - 9, hz - 40, 19, 40, farA);
      r.rect(dx, hz - 54, 1, 6, farA);
    }

    // Un pixel de nuage (le même calcul pour l'écran et pour la rue prolongée).
    cloudPx(r, x, y, hz, stops) {
      const lk = this.look;
      if (lk.overcast) {
        const n = fbm(x * 0.016, y * 0.055, 3) + (y / hz) * 0.08;
        if (n < 0.4) return;
        const below = fbm(x * 0.016, (y + 3) * 0.055, 3) + ((y + 3) / hz) * 0.08;
        let c = mix(stops[1], stops[2], 0.35);
        if (n > 0.52) c = mix(stops[1], stops[2], 0.75);
        if (n > 0.62) c = mix(stops[2], stops[3], 0.45);
        if (below < n - 0.03) c = mix(c, BLACK, 0.15);
        if (bayer(x, y) < (0.44 - n) * 12) return;
        r.set(x, y, c);
      } else if (lk.tod === 'day') {
        const n = fbm(x * 0.026, y * 0.075, 5) - (y / hz) * 0.12;
        if (n < 0.55) return;
        const below = fbm(x * 0.026, (y + 2) * 0.075, 5) - ((y + 2) / hz) * 0.12;
        let c = C('#ffffff');
        if (below > n) c = C('#eef0f6');
        if (n < 0.58) c = C('#f2e8ee');
        if (below < 0.55 && n < 0.62) c = C('#d4d4e4');
        r.set(x, y, c);
      } else if (lk.tod === 'sunset' || lk.tod === 'dusk') {
        if (y < hz * 0.12 || y > hz * 0.8) return;
        const n = fbm(x * 0.01, y * 0.14, 9);
        if (n < 0.58) return;
        const below = fbm(x * 0.01, (y + 1) * 0.14, 9);
        const base = lk.tod === 'sunset' ? C('#8a3f74') : C('#7b3a37');
        const rim = lk.tod === 'sunset' ? C('#ffb27a') : C('#ffb35a');
        let c = mix(base, stops[1], 0.2);
        if (below < 0.58) c = rim;
        else if (n > 0.66) c = mix(base, BLACK, 0.12);
        r.set(x, y, c);
      } else {
        if (y > hz * 0.75) return;
        const n = fbm(x * 0.012, y * 0.09, 11);
        if (n < 0.62 || bayer(x, y) > (n - 0.62) * 6) return;
        r.set(x, y, mix(stops[1], C('#6a6aa0'), 0.35));
      }
    }

    // Le ciel de la rue prolongée : même dégradé, étoiles, nuages, ville lointaine, et deux
    // silhouettes lointaines (un dôme, une flèche).
    paintSkyExt(r) {
      const { W, H } = this;
      const lk = this.look;
      const stops = this.skyStops;
      const { farA, farB, winC, hz } = this.far;
      const R = rng(7707);
      for (const [a, b] of [[this.wx0, 0], [W, this.wx1]]) {
        if (b <= a) continue;
        r.gradient(a, 0, b - a, hz + 2, stops, 12);
        r.rect(a, hz + 2, b - a, H - hz - 2, stops[3]);
        if (lk.night && !lk.overcast) {
          const n = Math.round(((b - a) * hz) / (lk.starfall ? 70 : 120));
          for (let k = 0; k < n; k++) {
            const x = a + Math.floor(R() * (b - a));
            const y = Math.floor(Math.pow(R(), 1.4) * hz * 0.85);
            const bb = R();
            const c = mix(stops[0], [255, 248, 230], 0.3 + 0.7 * bb * (1 - y / hz));
            r.set(x, y, c);
            if (bb > 0.94 && y > 2) {
              const d = mix(c, stops[0], 0.5);
              r.set(x - 1, y, d);
              r.set(x + 1, y, d);
              r.set(x, y - 1, d);
              r.set(x, y + 1, d);
            }
            if (bb > 0.6) this.stars.push({ x, y, p: R() * 6.28, s: 0.6 + R() * 2 });
          }
        }
        for (let y = 0; y < hz; y++) for (let x = a; x < b; x++) this.cloudPx(r, x, y, hz, stops);
      }
      // Silhouettes lointaines : un dôme à gauche, une flèche, puis la ville en deux plans.
      const dome = (dx, rad, h) => {
        for (let y = -rad; y <= 0; y++) for (let x = -rad; x <= rad; x++) if (x * x + y * y * 1.6 <= rad * rad) r.set(dx + x, hz - h + y, farA);
        r.rect(dx - rad, hz - h, rad * 2 + 1, h, farA);
        r.rect(dx - 2, hz - h - rad - 4, 5, 4, farA);
        r.rect(dx, hz - h - rad - 9, 1, 6, farA);
        for (let i = -rad; i <= rad; i += 3) r.rect(dx + i, hz - h + 2, 1, 6, mix(farA, stops[1], 0.25));
      };
      const spire = (sx, h) => {
        for (let y = 0; y < h; y++) {
          const half = Math.floor((y / h) * 4);
          r.rect(sx - half, hz - 30 - h + y, half * 2 + 1, 1, farA);
        }
        r.rect(sx - 4, hz - 30, 9, 30, farA);
      };
      if (this.extL > 120) dome(Math.round(-this.extL * 0.42), 12, 48);
      if (this.extL > 200) spire(Math.round(-this.extL * 0.78), 34);
      if (this.extL > 60) spire(Math.round(-this.extL * 0.12), 22);
      const sky = (col, h0, h1, wmin, wmax, seed, winP) => {
        const RR = rng(seed);
        const block = (x, w) => {
          const top = hz - h0 - Math.floor(RR() * (h1 - h0));
          r.rect(x, top, w, hz - top + 2, col);
          if (RR() < 0.3) r.rect(x + Math.floor(w / 3), top - 3, Math.max(2, Math.floor(w / 4)), 3, col);
          if (RR() < 0.2) r.rect(x + Math.floor(w / 2), top - 7, 1, 7, col);
          for (let wy = top + 2; wy < hz - 2; wy += 3) for (let wx = x + 1; wx < x + w - 1; wx += 2) if (RR() < winP) r.set(wx, wy, winC);
        };
        for (let x = -4; x > this.wx0; ) {
          const w = wmin + Math.floor(RR() * (wmax - wmin));
          x -= w + (RR() < 0.25 ? 2 : 0);
          block(x, w);
        }
        for (let x = W - 6; x < this.wx1; ) {
          const w = wmin + Math.floor(RR() * (wmax - wmin));
          block(x, w);
          x += w + (RR() < 0.25 ? 2 : 0);
        }
      };
      sky(farA, 30, 70, 6, 16, 105, lk.lightsOn ? 0.1 : 0.05);
      sky(farB, 14, 44, 8, 20, 109, lk.lightsOn ? 0.16 : 0.06);
    }

    // Couleur du ciel à une hauteur donnée (pour les reflets des vitres).
    skyAt(x, y) {
      return this.skyR.get(x, Math.max(0, Math.min(this.L.street0 - 1, y))).slice(0, 3);
    }

    /* ---------- Immeubles ---------- */
    paintWall(r, x, y, w, h, m, kind, seed) {
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const X0 = x + i;
          const Y0 = y + j;
          let c = m.base;
          if (kind === 'brick') {
            const row = Math.floor(Y0 / 3);
            const off = row % 2 ? 3 : 0;
            if (Y0 % 3 === 2 || (X0 + off) % 6 === 0) c = m.mortar;
            else if (hash(Math.floor((X0 + off) / 6), row, seed) < 0.25) c = m.alt;
            else if (hash(Math.floor((X0 + off) / 6), row, seed + 3) < 0.08) c = m.hi;
          } else if (kind === 'stone') {
            const row = Math.floor(Y0 / 5);
            const off = row % 2 ? 6 : 0;
            if (Y0 % 5 === 4 || (X0 + off) % 12 === 0) c = m.mortar;
            else if (hash(X0 >> 2, Y0 >> 1, seed) < 0.12) c = m.alt;
          } else if (kind === 'wood') {
            const row = Math.floor(Y0 / 3);
            if (Y0 % 3 === 2) c = m.mortar;
            else if (hash(Math.floor((X0 + row * 7) / 13), row, seed) < 0.3) c = m.alt;
          } else {
            const n = fbm(X0 * 0.12, Y0 * 0.12, seed);
            if (n > 0.56 && bayer(X0, Y0) < (n - 0.56) * 5) c = m.alt;
            else if (n < 0.36 && bayer(X0, Y0) < 0.25) c = m.hi;
          }
          r.set(X0, Y0, c);
        }
      }
    }

    // Peint sur la façade ET sur la couche des fenêtres allumées (ce qui passe devant une vitre).
    both(fn) {
      fn(this.sc, (c) => c);
      fn(this.litR, (c) => mix(c, BLACK, 0.55));
    }

    paintBuilding(r, b, R) {
      const { L } = this;
      const lk = this.look;
      const m = MATS[b.mat];
      const { x, w, top } = b;
      const base = L.street0;
      this.paintWall(r, x, top, w, base - top, m, b.kind, b.idx + 1);
      r.rect(x, top, 1, base - top, m.hi);
      r.rect(x + w - 1, top, 1, base - top, m.dark);
      // Pilastres d'angle en pierre (immeubles en brique).
      if (b.kind === 'brick') {
        for (let y = top + 4; y < L.shopTop - 2; y++) {
          const c = Math.floor(y / 3) % 2 ? m.trim : mix(m.trim, m.dark, 0.25);
          r.rect(x, y, 3, 1, c);
          r.rect(x + w - 3, y, 3, 1, c);
        }
      }
      // Corniche à denticules.
      r.rect(x - 2, top, w + 4, 1, m.trimHi);
      r.rect(x - 2, top + 1, w + 4, 1, m.trim);
      for (let i = x - 1; i < x + w + 1; i++) r.set(i, top + 2, (i - x) % 3 === 0 ? m.dark : m.trim);
      r.rect(x - 1, top + 3, w + 2, 1, mix(m.dark, BLACK, 0.2));
      this.ledges.push({ x: x - 2, y: top, w: w + 4 });
      // Bandeau au-dessus de la boutique (le chat s'y promène).
      r.rect(x - 1, L.shopTop - 2, w + 2, 1, m.trimHi);
      r.rect(x - 1, L.shopTop - 1, w + 2, 1, mix(m.trim, m.dark, 0.5));
      this.ledges.push({ x: x - 1, y: L.shopTop - 2, w: w + 2 });

      // Étages : fenêtres.
      const usable = b.vsign ? w - 12 : w;
      const n = Math.max(1, Math.floor((usable - 6) / 16));
      const cols = [];
      for (let k = 0; k < n; k++) cols.push(x + Math.round((usable / n) * (k + 0.5)) - 4);
      b.cols = cols;
      for (let f = 0; f < b.floors; f++) {
        const fy0 = L.shopTop - 2 - (f + 1) * 22;
        for (let k = 0; k < cols.length; k++) this.paintWindow(r, b, cols[k], fy0 + 5, f, k, R);
        if (b.balcony && f === 0) this.paintBalcony(b, fy0 + 5 + 14);
        // Bandeau d'étage en pierre (immeubles en pierre).
        if (b.kind === 'stone' && f > 0) {
          r.rect(x + 1, fy0 + 22, w - 2, 1, m.trimHi);
          this.ledges.push({ x: x + 1, y: fy0 + 22, w: w - 2 });
        }
      }
      if (b.fe) this.paintFireEscape(b);
      if (b.vsign) this.paintVSign(r, b);

      // Toit.
      if (b.roof === 'mansard') this.paintMansard(r, b, R);
      else if (b.roof === 'tile') this.paintTileRoof(r, b);
      else if (b.roof === 'terrace') this.paintTerrace(r, b, R);
      if (b.tank) this.paintTank(r, b);
      if (b.antenna) {
        r.rect(x + 8, top - 14, 1, 14, C('#3a3e48'));
        r.rect(x + 5, top - 12, 7, 1, C('#3a3e48'));
        r.rect(x + 6, top - 9, 5, 1, C('#3a3e48'));
        // Parabole.
        const dx = x + w - 12;
        r.rect(dx, top - 4, 1, 4, C('#5a5e68'));
        for (let k = 0; k < 5; k++) r.set(dx - 2 + k, top - 6 - (k === 0 || k === 4 ? 1 : 0), C('#c8ccd4'));
        r.rect(dx - 1, top - 6, 3, 2, C('#e4e8ee'));
      }
      if (b.chimney || b.roof === 'flat') {
        const cxs = b.chimney ? [x + 8, x + w - 16] : [x + w - 14];
        for (const cx of cxs) {
          if (b.tank && cx < x + 30) continue;
          if (b.antenna && Math.abs(cx - (x + w - 12)) < 6) continue;
          this.paintChimney(r, cx, top, m);
        }
      }
      this.paintShop(r, b, R);
    }

    paintChimney(r, cx, top, m) {
      const brick = MATS.brick;
      for (let y = top - 9; y < top; y++) for (let i = 0; i < 6; i++) r.set(cx + i, y, (y % 3 === 2 || (i + (Math.floor(y / 3) % 2) * 2) % 4 === 0) ? brick.mortar : brick.base);
      r.rect(cx - 1, top - 10, 8, 1, m.trim);
      r.rect(cx + 1, top - 12, 2, 2, C('#b8603a'));
      r.rect(cx + 4, top - 12, 1, 2, C('#b8603a'));
      this.ledges.push({ x: cx - 1, y: top - 10, w: 8 });
      this.chimneys.push({ x: cx + 1, y: top - 13 });
    }

    paintWindow(r, b, wx, wy, f, k, R) {
      const lk = this.look;
      const m = MATS[b.mat];
      const frame = m.frame;
      // Linteau (clé de voûte pour la pierre).
      r.rect(wx - 1, wy - 1, 11, 1, m.trim);
      if (b.kind === 'stone' || b.kind === 'brick') {
        r.rect(wx + 3, wy - 2, 3, 1, m.trimHi);
        if (b.kind === 'brick') for (let i = 0; i < 11; i += 2) r.set(wx - 1 + i, wy - 1, m.trimHi);
      }
      r.rect(wx, wy, 9, 13, frame);
      // Volets.
      if (b.shutters) {
        const sc = b.mat === 'green' ? C('#d8c8a0') : C('#4a7a6a');
        for (const sx of [wx - 4, wx + 10]) {
          r.rect(sx, wy, 3, 13, sc);
          for (let y = wy + 1; y < wy + 13; y += 2) r.rect(sx, y, 3, 1, mix(sc, BLACK, 0.25));
          r.rect(sx + (sx < wx ? 0 : 2), wy, 1, 13, mix(sc, BLACK, 0.35));
        }
      }
      // Appui de fenêtre.
      r.rect(wx - 1, wy + 13, 11, 1, m.trimHi);
      r.rect(wx - 1, wy + 14, 11, 1, mix(m.dark, BLACK, 0.2));
      this.ledges.push({ x: wx - 1, y: wy + 13, w: 11 });
      const wd = {
        x: wx + 1,
        y: wy + 1,
        w: 7,
        h: 11,
        mx: wx + 4,
        my: wy + 4,
        frame,
        arch: b.arch,
        curtain: R() < 0.6 ? CURTAINS[Math.floor(R() * CURTAINS.length)] : null,
        blind: R() < 0.25 ? 2 + Math.floor(R() * 3) : 0,
        plant: R() < 0.25,
        decor: Math.floor(R() * 4),
        lit: false,
        tv: false,
      };
      this.windows.push(wd);
      this.paintWinOff(r, wd);
      this.paintWinLit(this.litR, wd);
      if (b.arch) {
        r.set(wd.x, wd.y, frame);
        r.set(wd.x + 6, wd.y, frame);
        this.litR.set(wd.x, wd.y, mix(frame, BLACK, 0.55));
        this.litR.set(wd.x + 6, wd.y, mix(frame, BLACK, 0.55));
      }
      // Jardinière fleurie (pas en hiver).
      if (b.flowers && (f + k) % 2 === 0) {
        const box = C('#6a4a32');
        r.rect(wx, wy + 15, 9, 2, box);
        r.rect(wx, wy + 15, 9, 1, mix(box, WHITE, 0.15));
        if (!lk.snow) {
          const fl = lk.season === 'autumn' ? ['#e8802e', '#c04a22', '#f6b84a'] : ['#e84a5a', '#ff8aa8', '#f8d84a', '#ffffff'];
          this.both((t, tf) => {
            for (let i = 0; i < 9; i++) {
              t.set(wx + i, wy + 14, tf(C(i % 2 ? '#3e7a3e' : '#5a9a4a')));
              if (hash(wx + i, wy, 5) < 0.55) t.set(wx + i, wy + 13 - (i % 3 === 0 ? 1 : 0), tf(C(fl[Math.floor(hash(i, wy, 2) * fl.length)])));
            }
          });
        }
      }
    }

    paintWinOff(r, wd) {
      const lk = this.look;
      const { x, y, w, h } = wd;
      for (let j = 0; j < h; j++) {
        const s = this.skyAt(x, y - 40 + j * 2);
        const c = lk.tod === 'day' ? mix(s, C('#4a5e80'), 0.45) : mix(s, C('#1a1e34'), 0.62);
        for (let i = 0; i < w; i++) {
          const glare = (i + j) % 9 === 0 || (i + j) % 9 === 1;
          r.set(x + i, y + j, glare && j < h - 2 ? mix(c, WHITE, lk.tod === 'day' ? 0.35 : 0.12) : c);
        }
      }
      if (wd.curtain) {
        const cc = mix(wd.curtain, BLACK, lk.tod === 'day' ? 0.15 : 0.45);
        r.rect(x, y, 2, h, cc);
        r.rect(x + w - 2, y, 2, h, cc);
        r.rect(x + 1, y, 1, h, mix(cc, BLACK, 0.2));
      }
      if (wd.blind) r.rect(x, y, w, wd.blind, mix(C('#e8d8b8'), BLACK, lk.tod === 'day' ? 0.1 : 0.45));
      r.rect(wd.mx, y, 1, h, wd.frame);
      r.rect(x, wd.my, w, 1, wd.frame);
    }

    paintWinLit(r, wd) {
      const { x, y, w, h } = wd;
      const warm = [C('#ffe2a0'), C('#ffb05c')];
      r.gradient(x, y, w, h, warm, 4);
      const dark = C('#7a4a30');
      if (wd.decor === 0) r.rect(x + 3, y + 2, 2, 2, C('#b0603a'));
      else if (wd.decor === 1) {
        r.rect(x + 2, y + 5, 3, 2, C('#fff6d8'));
        r.rect(x + 3, y + 7, 1, 3, dark);
      } else if (wd.decor === 2) {
        r.rect(x + 1, y + 6, w - 2, 1, dark);
        for (let i = 1; i < w - 1; i++) if (hash(x + i, y, 1) < 0.7) r.set(x + i, y + 5, CURTAINS[Math.floor(hash(i, y, 2) * 6)]);
      }
      if (wd.curtain) {
        r.rect(x, y, 2, h, wd.curtain);
        r.rect(x + w - 2, y, 2, h, wd.curtain);
        r.rect(x + 1, y, 1, h, mix(wd.curtain, BLACK, 0.25));
        r.rect(x + w - 1, y, 1, h, mix(wd.curtain, BLACK, 0.25));
      }
      if (wd.blind) {
        r.rect(x, y, w, wd.blind, C('#f2c88a'));
        r.rect(x, y + wd.blind - 1, w, 1, C('#c8904a'));
      }
      if (wd.plant) {
        r.rect(x + w - 3, y + h - 2, 2, 2, C('#6a3424'));
        r.rect(x + w - 4, y + h - 4, 3, 2, C('#2a4a2a'));
        r.set(x + w - 3, y + h - 5, C('#2a4a2a'));
      }
      const fr = mix(wd.frame, BLACK, 0.5);
      r.rect(wd.mx, y, 1, h, fr);
      r.rect(x, wd.my, w, 1, fr);
    }

    paintBalcony(b, sy) {
      const { x, w } = b;
      const m = MATS[b.mat];
      const iron = C('#262830');
      this.both((t, tf) => {
        t.rect(x + 2, sy, w - 4, 2, tf(m.trim));
        t.rect(x + 2, sy + 2, w - 4, 1, tf(m.dark));
        t.rect(x + 2, sy - 6, w - 4, 1, tf(iron));
        for (let i = x + 2; i < x + w - 2; i++) {
          if ((i - x) % 3 === 0) t.rect(i, sy - 5, 1, 5, tf(iron));
          else if ((i - x) % 3 === 1) t.set(i, sy - 3, tf(iron));
        }
      });
      this.ledges.push({ x: x + 2, y: sy, w: w - 4 });
      this.ledges.push({ x: x + 2, y: sy - 6, w: w - 4 });
    }

    paintFireEscape(b) {
      const { L } = this;
      const iron = C('#22242c');
      const wx = b.cols[0];
      this.both((t, tf) => {
        for (let f = 0; f < b.floors; f++) {
          const py = L.shopTop - 2 - (f + 1) * 22 + 5 + 15;
          t.rect(wx - 4, py, 18, 1, tf(iron));
          t.rect(wx - 4, py - 6, 18, 1, tf(iron));
          for (let i = wx - 4; i < wx + 14; i += 2) t.rect(i, py - 5, 1, 5, tf(iron));
          if (f < b.floors - 1) {
            for (let k = 0; k < 21; k++) {
              const sx = wx + 12 - Math.round(k * 0.62);
              t.set(sx, py - 1 - k, tf(iron));
              if (k % 3 === 0) t.rect(sx - 2, py - 1 - k, 2, 1, tf(iron));
            }
          } else {
            // Échelle escamotable sous la première plate-forme.
            t.rect(wx + 9, py + 1, 1, 6, tf(iron));
            t.rect(wx + 12, py + 1, 1, 6, tf(iron));
            for (let y = py + 2; y < py + 7; y += 2) t.rect(wx + 9, y, 4, 1, tf(iron));
          }
        }
      });
      for (let f = 0; f < b.floors; f++) this.ledges.push({ x: wx - 4, y: L.shopTop - 2 - (f + 1) * 22 + 20, w: 18 });
    }

    paintVSign(r, b) {
      const bx = b.x + b.w - 10;
      const by = b.top + 8;
      const board = C('#2a1620');
      r.rect(bx - 1, by - 1, 9, 34, C('#c8a050'));
      r.rect(bx, by, 7, 32, board);
      r.rect(bx - 3, by + 4, 2, 1, C('#5a5e68'));
      r.rect(bx - 3, by + 26, 2, 1, C('#5a5e68'));
      this.addSign(b.vtext || 'HOTEL', bx + 2, by + 1, b.vneon || SHOPS.HOTEL.neon, true, board, b.vtext ? '#ffe2a0' : undefined);
      this.ledges.push({ x: bx - 1, y: by - 1, w: 9 });
    }

    paintMansard(r, b, R) {
      const lk = this.look;
      const { x, w, top } = b;
      const zinc = lk.snow ? C('#c8d0dc') : C('#5c6878');
      const zd = lk.snow ? C('#a8b4c4') : C('#46505e');
      const zh = lk.snow ? C('#eef2f8') : C('#76828f');
      const rh = 14;
      for (let k = 1; k <= rh; k++) {
        const y = top - k;
        const ins = Math.floor(k * 0.45) + 1;
        for (let i = x + ins; i < x + w - ins; i++) {
          let c = (i - x) % 4 === 0 ? zd : zinc;
          if (lk.snow && hash(i, y, 4) < 0.5) c = zh;
          if (k === rh) c = zh;
          if (i === x + ins) c = zh;
          r.set(i, y, c);
        }
      }
      // Lucarnes.
      for (const wx of b.cols) {
        const dy = top - 11;
        r.rect(wx, dy, 9, 10, MATS[b.mat].trim);
        for (let k = 0; k < 4; k++) r.rect(wx + 1 + k - 1, dy - 1 - k, 11 - 2 * k, 1, k === 3 ? zh : zd);
        const wd = { x: wx + 2, y: dy + 2, w: 5, h: 7, mx: wx + 4, my: dy + 5, frame: MATS[b.mat].frame, curtain: R() < 0.5 ? CURTAINS[Math.floor(R() * 6)] : null, blind: 0, plant: false, decor: 3, lit: false };
        r.rect(wx + 1, dy + 1, 7, 9, wd.frame);
        this.windows.push(wd);
        this.paintWinOff(r, wd);
        this.paintWinLit(this.litR, wd);
        this.ledges.push({ x: wx + 1, y: dy - 4, w: 5 });
      }
      for (const cx of [x + 5, x + w - 12]) {
        const ty = top - rh;
        this.paintChimney(r, cx, ty + 1, MATS[b.mat]);
      }
    }

    paintTileRoof(r, b) {
      const lk = this.look;
      const { x, w, top } = b;
      const t1 = C('#3a4250');
      const t2 = C('#566072');
      const rh = 10;
      for (let k = 0; k < rh; k++) {
        const y = top - 1 - k;
        const ins = Math.round(k * 1.4) - 3;
        for (let i = x + ins; i < x + w - ins; i++) {
          let c = k % 2 === 0 ? t1 : t2;
          if (k % 2 === 1 && (i - x) % 3 === 0) c = t1;
          if (lk.snow && k % 2 === 1) c = hash(i, y, 1) < 0.8 ? C('#eef2f8') : C('#c8d4e4');
          r.set(i, y, c);
        }
      }
      // Faîtage relevé aux deux bouts.
      const ry = top - rh - 1;
      const ins = Math.round((rh - 1) * 1.4) - 3;
      r.rect(x + ins - 2, ry, w - 2 * ins + 4, 1, C('#2a3038'));
      r.set(x + ins - 3, ry - 1, C('#2a3038'));
      r.set(x + w - ins + 2, ry - 1, C('#2a3038'));
    }

    paintTerrace(r, b, R) {
      const lk = this.look;
      const { x, w, top } = b;
      const iron = C('#2c2e36');
      r.rect(x, top - 6, w, 1, iron);
      for (let i = x; i < x + w; i += 3) r.rect(i, top - 5, 1, 5, iron);
      // Plantes en pot sur le toit.
      for (let k = 0; k < 4; k++) {
        const px = x + 6 + Math.round((k * (w - 14)) / 3);
        r.rect(px - 2, top - 4, 5, 4, C('#b8603a'));
        r.rect(px - 2, top - 4, 5, 1, C('#d8804a'));
        if (!lk.snow) {
          const leaves = lk.season === 'autumn' ? ['#a84a22', '#d8802e', '#6a5a2a'] : ['#2e5a32', '#4a8a46', '#6aae5a'];
          for (let j = 0; j < 30; j++) {
            const a = R() * Math.PI;
            const d = R() * 5;
            r.set(px + Math.round(Math.cos(a) * d), top - 5 - Math.round(Math.sin(a) * d), C(leaves[Math.floor(R() * 3)]));
          }
        }
      }
      // Guirlande de la terrasse, entre deux poteaux.
      const p0 = x + 2;
      const p1 = x + w - 3;
      r.rect(p0, top - 18, 1, 18, iron);
      r.rect(p1, top - 18, 1, 18, iron);
      this.terrace = { x0: p0, x1: p1, y: top - 18 };
      const wire = (t) => {
        for (let xx = p0; xx <= p1; xx++) {
          const u = (xx - p0) / (p1 - p0);
          const y = Math.round(top - 18 + Math.sin(u * Math.PI) * 7);
          t.set(xx, y, C('#1a1a20'));
          if ((xx - p0) % 6 === 3) this.bulbs.push({ x: xx, y: y + 1, c: ['#ffd27a', '#ff9f6b', '#fff0c0', '#ff7ab0'][this.bulbs.length % 4], p: R() * 6 });
        }
      };
      if (lk.lightsOn) this.pushPost(wire);
      else wire(r);
    }

    paintTank(r, b) {
      const { x, top } = b;
      const wood = C('#7a5038');
      const wd = C('#5a3826');
      const tx = x + 9;
      r.rect(tx + 2, top - 6, 1, 6, C('#2a2a30'));
      r.rect(tx + 12, top - 6, 1, 6, C('#2a2a30'));
      r.rect(tx + 2, top - 3, 11, 1, C('#2a2a30'));
      for (let y = top - 18; y < top - 6; y++) {
        for (let i = 0; i < 15; i++) {
          let c = i % 3 === 0 ? wd : wood;
          if ((y - top) % 4 === 0) c = C('#2e2e34');
          if (i === 0) c = mix(wood, WHITE, 0.15);
          r.set(tx + i, y, c);
        }
      }
      for (let k = 0; k < 5; k++) r.rect(tx + k * 2 - 1, top - 19 - k, 17 - k * 4, 1, k === 4 ? wd : C('#4a3020'));
      r.rect(tx + 7, top - 25, 1, 2, C('#2a2a30'));
    }

    /* ---------- Devantures ---------- */
    addSign(text, x, y, neon, vertical, board, paint0) {
      const w = vertical ? 3 : text.length * 4 - 1;
      const h = vertical ? text.length * 6 - 1 : 5;
      const mk = (col) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        if (vertical) for (let i = 0; i < text.length; i++) X.text(g, text[i], 0, i * 6, col);
        else X.text(g, text, 0, 0, col);
        return c;
      };
      const lk = this.look;
      if (lk.lightsOn) {
        const nc = C(neon);
        this.signs.push({ x, y, w, h, on: mk(neon), off: mk(toHex(mix(board, nc, 0.3))), col: nc, flick: 0, on1: true, next: 4 + this.rnd() * 10 });
      } else {
        const shopKey = Object.keys(SHOPS).find((k) => SHOPS[k].neon === neon);
        const paint = paint0 || (shopKey ? SHOPS[shopKey].paint : '#f0e6d0');
        if (vertical) for (let i = 0; i < text.length; i++) X.text(this.sc, text[i], x, y + i * 6, C(paint));
        else X.text(this.sc, text, x, y, C(paint));
      }
    }

    paintShop(r, b, R) {
      const { L } = this;
      const lk = this.look;
      const m = MATS[b.mat];
      const S = SHOPS[b.shop];
      const { x, w } = b;
      const st = L.shopTop;
      const base = L.street0;
      const board = C(S.board);
      // Mur du rez-de-chaussée et pilastres.
      r.rect(x, st, w, base - st, mix(m.base, m.dark, 0.3));
      r.rect(x, st + 7, 2, base - st - 7, m.trim);
      r.rect(x + w - 2, st + 7, 2, base - st - 7, mix(m.trim, m.dark, 0.3));
      // Bandeau d'enseigne.
      if (b.shop !== 'HOTEL') {
        r.rect(x + 1, st, w - 2, 7, board);
        r.rect(x + 1, st, w - 2, 1, mix(board, WHITE, 0.25));
        r.rect(x + 1, st + 6, w - 2, 1, mix(board, BLACK, 0.35));
        const tw = b.shop.length * 4 - 1;
        this.addSign(b.shop, x + Math.round((w - tw) / 2), st + 1, S.neon, false, board, S.extra || S.interior ? S.paint : undefined);
      }
      // Porte.
      const doorW = b.shop === 'HOTEL' ? 13 : S.doorW || 9;
      let dx;
      if (S.door === 'right') dx = x + w - 3 - doorW;
      else if (S.door === 'left') dx = x + 3;
      else dx = x + Math.round((w - doorW) / 2);
      // Vitrines.
      const hasAwn = !!S.awn;
      const iy0 = hasAwn ? st + 14 : st + 9;
      const iy1 = base - 4;
      const wins = [];
      if (S.door === 'center') {
        wins.push([x + 3, dx - 2], [dx + doorW + 2, x + w - 3]);
      } else if (S.door === 'right') wins.push([x + 3, dx - 2]);
      else wins.push([dx + doorW + 2, x + w - 3]);
      for (const [wx0, wx1] of wins) {
        if (wx1 - wx0 < 4) continue;
        r.rect(wx0 - 1, st + 7, wx1 - wx0 + 2, iy1 - st - 7, C('#2a2a30'));
        r.rect(wx0 - 1, iy1, wx1 - wx0 + 2, 4, mix(m.dark, BLACK, 0.1));
        r.rect(wx0 - 1, iy1, wx1 - wx0 + 2, 1, m.trim);
        this.ledges.push({ x: wx0 - 1, y: iy1, w: wx1 - wx0 + 2 });
        const paint = (t) => this.paintShopInterior(t, b, wx0, iy0, wx1, iy1, lk.lightsOn, R);
        if (lk.lightsOn) this.pushPost(paint);
        else paint(r);
        if (lk.lightsOn) {
          this.lights.push({ x: Math.round((wx0 + wx1) / 2), y: base + 2, r: 10 + (wx1 - wx0) * 0.15, k: 0.42, sy: 1.5 });
        }
      }
      // La porte.
      r.rect(dx, base - 21, doorW, 21, C('#2a1e1a'));
      r.rect(dx + 1, base - 20, doorW - 2, 20, b.shop === 'HOTEL' ? C('#7a5a2a') : mix(board, BLACK, 0.2));
      const gx = dx + 2;
      const gy = base - 18;
      const gw = doorW - 4;
      const glass = (t, on) => {
        t.gradient(gx, gy, gw, 9, on ? [C('#ffe2a8'), C('#ffbe74')] : [C('#5a6478'), C('#3a4050')], 3);
        if (b.shop === 'HOTEL') t.rect(gx + Math.floor(gw / 2), gy, 1, 9, C('#7a5a2a'));
      };
      if (lk.lightsOn) this.pushPost((t) => glass(t, true));
      else glass(r, false);
      r.rect(dx + doorW - 3, base - 11, 1, 2, C('#e8c47c'));
      r.rect(dx - 1, base - 1, doorW + 2, 1, C('#8a8478'));
      // Marquise, avant-toit ou store.
      if (hasAwn) this.paintAwning(r, x + 1, st + 7, w - 2, S.awn);
      if (b.shop === 'RAMEN') this.paintRamen(r, b, dx, doorW);
      if (b.shop === 'HOTEL') this.paintHotelCanopy(r, b, dx, doorW);
      if (S.open && lk.lightsOn) {
        const win = wins[0];
        this.signs.push({ x: win[0] + 2, y: iy0 + 1, w: 15, h: 5, on: this.mkText('OPEN', '#ff4a7a'), off: this.mkText('OPEN', '#5a2a3a'), col: C('#ff4a7a'), flick: 0, on1: true, next: 6 + this.rnd() * 8, small: true });
      }
      // Ce qui déborde sur le trottoir d'en face.
      if (b.shop === 'FLEURS') this.paintFlowerStall(r, x + 4, w - 18, R);
      if (b.shop === 'CAFE') this.paintBistro(r, x + w - 2);
      if (b.shop === 'BAKERY') this.paintSandwichBoard(r, x + 5);
      if (S.extra) this.paintShopExtra(r, b, S, dx, doorW, R);
      // Silhouettes de commerçants qui vont et viennent derrière la vitrine.
      if ((b.shop === 'PIZZA' || b.shop === 'BAKERY' || b.shop === 'BOOKS' || S.keeper) && wins.length) {
        const [wx0, wx1] = wins[0];
        if (wx1 - wx0 > 14) this.keepers.push({ x0: wx0 + 1, x1: wx1 - 5, y1: iy1 - 3, x: wx0 + 4 + this.rnd() * (wx1 - wx0 - 10), dir: 1, wait: 0, col: b.shop === 'BOOKS' ? C('#3a4a6a') : C(S.keeper || '#e8e0d8') });
      }
    }

    mkText(text, col) {
      const c = document.createElement('canvas');
      c.width = text.length * 4 - 1;
      c.height = 5;
      X.text(c.getContext('2d'), text, 0, 0, col);
      return c;
    }

    paintAwning(r, x, y, w, cols) {
      const lk = this.look;
      const a = C(cols[0]);
      const b2 = C(cols[1]);
      for (let i = 0; i < w; i++) {
        const c = Math.floor(i / 3) % 2 ? b2 : a;
        r.set(x + i, y, mix(c, BLACK, 0.3));
        r.rect(x + i, y + 1, 1, 5, c);
        r.set(x + i, y + 1, mix(c, WHITE, 0.15));
        if (i % 3 === 1) r.set(x + i, y + 6, c);
        else if (i % 3 !== 2) r.set(x + i, y + 6, mix(c, BLACK, 0.15));
      }
      r.rect(x, y + 7, w, 1, C('#1e1e24'));
      if (lk.snow) for (let i = 0; i < w; i++) if (hash(x + i, y, 3) < 0.85) r.set(x + i, y, C('#eef2f8'));
    }

    paintRamen(r, b, dx, doorW) {
      const { L } = this;
      const lk = this.look;
      const st = L.shopTop;
      const { x, w } = b;
      // Avant-toit en tuiles au-dessus de la vitrine.
      for (let k = 0; k < 3; k++) {
        for (let i = x - 2; i < x + w + 2; i++) {
          let c = k === 0 ? C('#566072') : C('#3a4250');
          if (k === 2 && (i - x) % 3 === 0) c = C('#2a3038');
          if (lk.snow && k === 0) c = C('#eef2f8');
          r.set(i, st + 6 + k, c);
        }
      }
      // Noren (rideau de porte) bleu avec un rond blanc.
      for (let i = 0; i < doorW; i++) {
        const h = i % 3 === 2 ? 0 : 7;
        if (h) r.rect(dx + i, st + 9, 1, h, C('#22346a'));
      }
      r.rect(dx + 3, st + 12, 3, 2, C('#e8e0d0'));
      // Lanternes rouges (dessinées à chaque image, elles se balancent).
      this.lanterns.push({ x: x + 6, y: st + 9, p: 0 }, { x: dx - 6, y: st + 9, p: 1.7 });
    }

    paintHotelCanopy(r, b, dx, doorW) {
      const { L } = this;
      const lk = this.look;
      const st = L.shopTop;
      const cw = doorW + 10;
      const cx = dx - 5;
      const red = C('#8a2232');
      r.rect(cx, st + 6, cw, 3, red);
      r.rect(cx, st + 6, cw, 1, mix(red, WHITE, 0.2));
      r.rect(cx, st + 9, cw, 1, C('#c8a050'));
      // Lettres dorées « LOBBY » au-dessus de la porte.
      X.text(r, 'LOBBY', cx + Math.round((cw - 19) / 2), st, C('#e8c47c'));
      // Poteaux en laiton jusqu'au bord du trottoir.
      r.rect(cx, st + 10, 1, L.street0 - st - 6, C('#c8a050'));
      r.rect(cx + cw - 1, st + 10, 1, L.street0 - st - 6, C('#c8a050'));
      // Lustre dans le hall.
      this.ledges.push({ x: cx, y: st + 6, w: cw });
    }

    paintShopInterior(r, b, x0, y0, x1, y1, lit, R) {
      const w = x1 - x0;
      const h = y1 - y0;
      const wall = lit ? [C('#ffe8b4'), C('#ffc27a')] : [C('#8c7c6e'), C('#5e4e46')];
      r.gradient(x0, y0, w, h, wall, 4);
      const d = (c) => (lit ? C(c) : mix(C(c), C('#4a3c3a'), 0.4));
      const RR = rng(b.idx * 13 + x0);
      const S = SHOPS[b.shop];
      if (S.interior && S.interior !== 'CAFE' && S.interior !== 'BAKERY') this.paintInteriorExt(r, S.interior, x0, y0, x1, y1, w, h, d, lit, RR);
      switch (S.interior || b.shop) {
        case 'PIZZA': {
          // Four à bois voûté, comptoir, pizzas.
          const ox = x1 - 14;
          for (let j = 0; j < h - 3; j++) {
            const half = Math.round(6 * Math.sqrt(Math.max(0, 1 - ((h - 3 - j) / (h - 2)) ** 2)));
            r.rect(ox + 6 - half, y0 + j, half * 2, 1, d('#b86a4a'));
          }
          r.rect(ox + 3, y1 - 7, 6, 4, lit ? C('#ff9a3a') : d('#3a2a24'));
          if (lit) r.rect(ox + 4, y1 - 6, 4, 2, C('#ffe08a'));
          r.rect(x0, y1 - 3, w, 3, d('#7a4a30'));
          r.rect(x0, y1 - 3, w, 1, d('#a8704a'));
          for (let px = x0 + 2; px < ox - 6; px += 8) {
            r.rect(px, y1 - 5, 6, 2, d('#e8b84a'));
            r.set(px + 1, y1 - 5, d('#c8382c'));
            r.set(px + 4, y1 - 5, d('#c8382c'));
          }
          r.rect(x0 + 2, y0 + 1, 10, 4, d('#2a2a2e'));
          for (let i = 0; i < 3; i++) r.rect(x0 + 3, y0 + 2 + i, 6 + (i % 2) * 2, 1, d('#e8e0d0'));
          r.rect(x0 + 3, y0 + 2, 1, 1, d('#2a2a2e'));
          break;
        }
        case 'BOOKS': {
          const books = ['#b8483c', '#3e6e8e', '#d8a63a', '#4e7a4a', '#8a5a9a', '#d9d0bc', '#c47a3a'];
          for (let sy = y0 + 4; sy < y1; sy += 5) {
            r.rect(x0, sy, w, 1, d('#6a432c'));
            for (let i = x0; i < x1; i++) {
              if (RR() < 0.15) continue;
              const bh = 3 + (RR() < 0.4 ? 1 : 0);
              r.rect(i, sy - bh, 1, bh, d(books[Math.floor(RR() * books.length)]));
            }
          }
          break;
        }
        case 'FLEURS': {
          for (let sy = y0 + 5; sy < y1; sy += 6) {
            r.rect(x0, sy, w, 1, d('#8a6a4a'));
            for (let i = x0 + 1; i < x1 - 2; i += 4) {
              r.rect(i, sy - 2, 3, 2, d('#c8704a'));
              const fl = ['#e84a5a', '#ff8aa8', '#f8d84a', '#ffffff', '#b06ad8'][Math.floor(RR() * 5)];
              r.rect(i, sy - 4, 3, 2, d('#3e7a3e'));
              r.set(i + RR() * 3, sy - 4, d(fl));
              r.set(i + 1, sy - 5, d(fl));
            }
          }
          break;
        }
        case 'CAFE': {
          r.rect(x0, y1 - 4, w, 4, d('#5a3a28'));
          r.rect(x0, y1 - 4, w, 1, d('#8a5a3a'));
          r.rect(x0 + 3, y1 - 9, 8, 5, d('#b8bcc4'));
          r.rect(x0 + 4, y1 - 8, 6, 1, d('#5a5e68'));
          for (let k = 0; k < 4; k++) r.rect(x0 + 14 + k * 5, y1 - 6, 3, 2, d('#ece4d8'));
          for (let lx = x0 + 6; lx < x1 - 2; lx += 12) {
            r.rect(lx, y0, 1, 3, d('#3a2418'));
            r.rect(lx - 1, y0 + 3, 3, 1, lit ? C('#fff6d0') : d('#c8a050'));
          }
          r.rect(x1 - 10, y0 + 1, 8, 5, d('#2a3a30'));
          for (let i = 0; i < 3; i++) r.rect(x1 - 9, y0 + 2 + i, 5, 1, d('#d8e0d0'));
          break;
        }
        case 'BAKERY': {
          for (let sy = y0 + 4; sy < y1; sy += 5) {
            r.rect(x0, sy, w, 1, d('#8a6a4a'));
            for (let i = x0 + 1; i < x1 - 3; i += 5) {
              const kind = RR();
              if (kind < 0.5) {
                r.rect(i, sy - 2, 4, 2, d('#d89a4a'));
                r.set(i + 1, sy - 2, d('#f0c070'));
              } else if (kind < 0.8) {
                r.rect(i, sy - 3, 3, 3, d('#f2dcbc'));
                r.rect(i, sy - 3, 3, 1, d('#d47a8a'));
              } else r.rect(i, sy - 1, 4, 1, d('#c8803a'));
            }
          }
          break;
        }
        case 'HOTEL': {
          r.rect(x0, y1 - 4, w, 4, d('#5a2a2a'));
          r.rect(x0, y1 - 4, w, 1, d('#c8a050'));
          r.rect(x0 + Math.floor(w / 2) - 2, y0 + 1, 4, 2, lit ? C('#fff4d0') : d('#c8a050'));
          r.rect(x0 + Math.floor(w / 2), y0, 1, 1, d('#c8a050'));
          r.rect(x0 + 1, y1 - 9, 2, 5, d('#3e7a3e'));
          break;
        }
        case 'RAMEN': {
          r.rect(x0, y1 - 4, w, 4, d('#8a5a3a'));
          r.rect(x0, y1 - 4, w, 1, d('#c08a58'));
          for (let i = x0 + 3; i < x1 - 3; i += 7) {
            r.rect(i, y1 - 6, 4, 2, d('#e8e0d0'));
            r.rect(i + 1, y1 - 6, 2, 1, d('#c8803a'));
          }
          for (let i = x0 + 1; i < x1 - 3; i += 6) {
            r.rect(i, y0 + 1, 4, 3, d('#f2ead8'));
            r.rect(i + 1, y0 + 2, 2, 1, d('#c8382c'));
          }
          break;
        }
        default:
          break;
      }
      // Reflets obliques sur la vitre.
      for (let k = 0; k < Math.max(1, Math.floor(w / 16)); k++) {
        const bx = x0 + 4 + k * 16 + Math.floor(RR() * 6);
        for (let j = 0; j < h; j++) {
          const xx = bx + Math.floor((h - j) * 0.6);
          if (xx >= x0 && xx < x1) r.tint(xx, y0 + j, WHITE, lit ? 0.18 : 0.3);
          if (xx + 1 >= x0 && xx + 1 < x1) r.tint(xx + 1, y0 + j, WHITE, lit ? 0.1 : 0.18);
        }
      }
      // Montants de la vitrine.
      for (let mx = x0 + 18; mx < x1 - 6; mx += 18) r.rect(mx, y0, 1, h, C('#2a2a30'));
    }

    paintFlowerStall(r, x, w, R) {
      const { L } = this;
      const lk = this.look;
      const y = L.street0 + 3;
      for (let i = 0; i < w - 4; i += 6) {
        r.rect(x + i, y - 4, 5, 4, C('#5a6a7a'));
        r.rect(x + i, y - 4, 5, 1, C('#7a8a9a'));
        if (lk.snow) continue;
        const fl = lk.season === 'autumn' ? ['#e8802e', '#c04a22', '#f6b84a', '#8a3a6a'] : ['#e84a5a', '#ff8aa8', '#f8d84a', '#ffffff', '#b06ad8'];
        for (let k = 0; k < 14; k++) {
          const fx = x + i + Math.floor(R() * 5);
          const fy = y - 5 - Math.floor(R() * 5);
          r.set(fx, fy, R() < 0.45 ? C('#3e7a3e') : C(fl[Math.floor(R() * fl.length)]));
        }
      }
    }

    paintBistro(r, xr) {
      const { L } = this;
      const y = L.street0 + 4;
      for (const tx of [xr - 30, xr - 14]) {
        r.rect(tx, y - 7, 7, 1, C('#c8ccd4'));
        r.rect(tx + 3, y - 6, 1, 6, C('#3a3a44'));
        r.rect(tx + 1, y - 1, 5, 1, C('#3a3a44'));
        // Chaises.
        for (const cx of [tx - 4, tx + 9]) {
          const back = cx < tx ? cx : cx + 2;
          r.rect(back, y - 8, 1, 8, C('#6a3a2a'));
          r.rect(cx, y - 4, 3, 1, C('#8a5a3a'));
          r.rect(cx + (cx < tx ? 2 : 0), y - 3, 1, 3, C('#6a3a2a'));
        }
        r.rect(tx + 2, y - 9, 2, 2, C('#ece4d8'));
        this.ledges.push({ x: tx, y: y - 7, w: 7 });
      }
    }

    paintSandwichBoard(r, x) {
      const { L } = this;
      const y = L.street0 + 4;
      for (let j = 0; j < 10; j++) {
        const half = 3 + Math.floor(j * 0.25);
        r.rect(x + 4 - half, y - 10 + j, half * 2, 1, j === 0 ? C('#6a4a2a') : C('#2a3428'));
      }
      r.rect(x + 2, y - 8, 4, 1, C('#e8e0d0'));
      r.rect(x + 2, y - 6, 3, 1, C('#e8a0a8'));
      r.rect(x + 2, y - 4, 4, 1, C('#e8e0d0'));
      this.ledges.push({ x: x + 1, y: y - 10, w: 7 });
    }

    /* ---------- Rue et trottoirs ---------- */
    // xa, xb : colonnes à peindre (l'écran par défaut ; un bout de rue prolongée sinon).
    paintStreet(r, R, xa = 0, xb = this.W) {
      const { W, H, L } = this;
      const lk = this.look;
      const snow = lk.snow;
      const sn = C('#eef2f8');
      const snS = C('#cdd8ea');
      const ext = !!this.extMode;
      const xw = xb - xa;
      const from = (x0, step) => xa + ((((x0 - xa) % step) + step) % step); // première colonne du motif
      // Trottoir d'en face.
      for (let y = L.street0; y < L.street0 + 5; y++) {
        for (let x = xa; x < xb; x++) {
          let c = (x + (y % 2) * 4) % 9 === 0 ? C('#8a857c') : C('#a39d92');
          if (y === L.street0) c = C('#6e6a62');
          if (snow) c = y === L.street0 ? snS : bayer(x, y) < 0.15 ? snS : sn;
          r.set(x, y, c);
        }
      }
      r.rect(xa, L.street0 + 5, xw, 1, snow ? sn : C('#c4beb2'));
      r.rect(xa, L.street0 + 6, xw, 1, C('#6a665e'));
      // Chaussée.
      for (let y = L.s0; y < L.s1; y++) {
        for (let x = xa; x < xb; x++) {
          const n = hash(x, y, 8);
          let c = n < 0.12 ? C('#4a4a52') : n > 0.9 ? C('#62626a') : C('#56565e');
          if (snow) {
            // Neige tassée, avec les traces sombres des pneus.
            const ly = y - L.s0;
            const track = ly === 4 || ly === 9 || ly === 17 || ly === 22;
            const slush = ly === 5 || ly === 10 || ly === 16 || ly === 23;
            c = track && n < 0.75 ? C('#8a92a6') : slush && n < 0.35 ? C('#b4bccc') : n < 0.2 ? snS : sn;
            if (ly === 0 || ly === L.s1 - L.s0 - 1) c = sn;
          }
          r.set(x, y, c);
        }
      }
      if (!snow) {
        for (let x = from(0, 14) - (ext ? 14 : 0); x < xb; x += 14) r.rect(x, L.s0 + 15, 7, 1, C('#d8d4c8'));
        r.rect(xa, L.s0 + 1, xw, 1, C('#4e4e56'));
      }
      // Passage piéton (et, dans la rue prolongée, devant la place).
      const crossings = ext ? this.extLots.filter((b) => b.lot === 'square').map((b) => Math.round(b.x + b.w / 2) - 16) : [Math.round(W * 0.66)];
      for (const cx of crossings) {
        for (let y = L.s0 + 1; y < L.s1 - 1; y++) {
          if ((y - L.s0) % 4 >= 2) continue;
          const spread = Math.round((y - L.s0) * 0.25);
          for (let x = cx - spread; x < cx + 32 + spread; x++) r.set(x, y, snow ? C('#f4f6fa') : hash(x, y, 2) < 0.12 ? C('#a8a49a') : C('#d8d4c8'));
        }
      }
      // Plaque d'égout (d'où monte la vapeur).
      const manholes = ext ? (xa < 0 ? [Math.round(xa * 0.62)] : []) : [L.manX];
      for (const mx of manholes) {
        const my = L.laneNear - 4;
        for (let x = -6; x <= 6; x++) {
          for (let y = -2; y <= 1; y++) {
            if ((x * x) / 36 + (y * y) / 3 > 1) continue;
            r.set(mx + x, my + y, (x + y) % 2 ? C('#3a3a42') : C('#2a2a30'));
          }
        }
        if (ext) this.extExtras.push({ k: 'manhole', x: mx, y: my });
        else this.manhole = { x: mx, y: my };
      }
      // Bordure de notre trottoir.
      r.rect(xa, L.s1, xw, 1, C('#3a3a40'));
      r.rect(xa, L.s1 + 1, xw, 1, snow ? snS : C('#7a766e'));
      r.rect(xa, L.s1 + 2, xw, 1, snow ? sn : C('#c8c2b6'));
      // Notre trottoir : grandes dalles en perspective.
      const vx = W / 2;
      const rows = [];
      for (let y = L.ns + 3, s = 4; y < H; y += s, s++) rows.push(y);
      for (let y = L.ns; y < H; y++) {
        const k = 1 + (y - L.ns) * 0.04;
        for (let x = xa; x < xb; x++) {
          const u = (x - vx) / k;
          const tile = Math.floor(u / 22);
          let c = hash(tile, rows.findIndex((ry) => ry > y), 6) < 0.3 ? C('#948e84') : C('#9e988e');
          if (((u % 22) + 22) % 22 < 1 / k + 0.4 || rows.includes(y)) c = C('#7c776e');
          if (hash(x, y, 9) < 0.04) c = mix(c, BLACK, 0.08);
          if (snow) {
            // Allée déneigée au milieu du trottoir : dalles mouillées, bords de neige irréguliers.
            const e0 = L.walkY - 7 + Math.round(fbm(x * 0.1, 1, 6) * 3);
            const e1 = L.walkY + 3 + Math.round(fbm(x * 0.1, 2, 6) * 3);
            if (y > e0 && y < e1 && hash(x, y, 13) > 0.06) c = mix(c, C('#8a90a6'), 0.25);
            else c = bayer(x, y) < 0.1 + Math.max(0, 0.3 - (y - L.ns) * 0.02) || y === e0 || y === e1 ? snS : sn;
          }
          r.set(x, y, c);
        }
      }
      // Potelets (bornes) le long de notre bordure.
      for (let x = ext ? from(12, 36) - 36 : 12; x < xb; x += 36) {
        const by = L.ns + 8;
        r.rect(x, by - 7, 3, 7, C('#5a4232'));
        r.rect(x, by - 7, 1, 7, C('#7a5a44'));
        r.rect(x - 1, by - 8, 5, 1, C('#3e2e24'));
        r.rect(x, by - 9, 3, 1, C('#c8a050'));
        r.rect(x - 1, by, 5, 1, C('#3e2e24'));
        this.ledges.push({ x: x, y: by - 9, w: 3 });
      }
      // Grille d'évacuation au bord du trottoir.
      const gx = ext ? Math.round(xa + xw * 0.3) : Math.round(W * 0.36);
      r.rect(gx, L.s1 - 1, 12, 2, C('#22222a'));
      for (let i = 1; i < 12; i += 2) r.set(gx + i, L.s1 - 1, C('#4a4a52'));
      if (snow) {
        // Bourrelets de neige le long des bordures, traces de pas.
        for (let x = xa; x < xb; x++) {
          const h1 = 1 + Math.round(fbm(x * 0.15, 3, 2) * 3);
          for (let j = 0; j < h1; j++) r.set(x, L.s1 - j, j === h1 - 1 ? sn : snS);
          const h0 = Math.round(fbm(x * 0.15, 7, 2) * 2);
          for (let j = 0; j < h0; j++) r.set(x, L.s0 - j, sn);
        }
        for (let x = xa + 4; x < xb; x += 5 + Math.floor(R() * 3)) {
          const y = L.walkY - 1 + (Math.floor(x / 5) % 2 ? 1 : -1) * 2;
          r.set(x, y, C('#b8c4d8'));
          r.set(x + 1, y, C('#b8c4d8'));
        }
      }
      if (lk.season === 'autumn' && !snow) {
        const lv = ['#c84a22', '#e8802e', '#f6b84a', '#8a3a1a'].map(C);
        for (let k = 0; k < xw * 0.5; k++) {
          const y = R() < 0.5 ? L.ns + Math.floor(R() * (H - L.ns)) : L.street0 + Math.floor(R() * 5);
          r.set(xa + Math.floor(R() * xw), y, lv[Math.floor(R() * 4)]);
        }
        for (let x = xa; x < xb; x++) if (hash(x, 1, 3) < 0.35) r.set(x, L.s1 - 1, lv[Math.floor(hash(x, 2, 3) * 4)]);
      }
      if (lk.season === 'spring' && !snow) {
        const pk = ['#ffc0d4', '#ff9fbf', '#ffe0ea'].map(C);
        for (let k = 0; k < xw * 0.6; k++) {
          const y = R() < 0.6 ? L.ns + Math.floor(R() * (H - L.ns)) : L.street0 + Math.floor(R() * 5);
          r.set(xa + Math.floor(R() * xw), y, pk[Math.floor(R() * 3)]);
        }
      }
      // Pluie : trottoir assombri et flaques.
      if (lk.wet) {
        for (let y = L.ns; y < H; y++) for (let x = xa; x < xb; x++) r.tint(x, y, C('#2a3040'), 0.22);
        for (let k = 0; k < (ext ? Math.round(xw / 60) : 7); k++) {
          const px = xa + Math.floor(R() * Math.max(1, xw - 30));
          const py = L.ns + 5 + Math.floor(R() * (H - L.ns - 10));
          const pw = 12 + Math.floor(R() * 18);
          this.pushPost((t) => {
            for (let i = 0; i < pw; i++) {
              const hh = Math.round(Math.sin((i / pw) * Math.PI) * 2);
              for (let j = -hh; j <= hh; j++) this.puddle(t, px + i, py + j, j === -hh);
            }
          });
        }
      }
    }

    puddle(r, x, y, edge) {
      const s = this.skyStops;
      const { L } = this;
      let c = mix(mix(s[1], s[2], 0.3 + hash(x, y, 4) * 0.4), BLACK, 0.25);
      if (edge) c = mix(c, WHITE, 0.15);
      // Reflet du lampadaire dans les flaques proches.
      let lx = L.lampX;
      if (this.extMode) for (const f of this.extFg) if (f.k === 'lamp' && Math.abs(x - f.x) < Math.abs(x - lx)) lx = f.x;
      if (this.look.lightsOn && Math.abs(x - lx) < 4) c = mix(c, C('#ffd890'), 0.6 - Math.abs(x - lx) * 0.12);
      r.set(x, y, c);
    }

    paintFarLamps(r, list = this.L.farLamps) {
      const { L } = this;
      const lk = this.look;
      const iron = C('#26282e');
      for (const x of list) {
        const top = L.street0 - 40;
        r.rect(x, top, 1, 44, iron);
        r.rect(x - 1, L.street0 + 2, 3, 2, iron);
        r.rect(x - 2, top - 1, 5, 1, iron);
        r.rect(x - 1, top - 2, 3, 1, iron);
        const glass = (t) => t.rect(x - 1, top, 3, 3, lk.lightsOn ? C('#fff0c0') : C('#c8d0d8'));
        if (lk.lightsOn) {
          this.pushPost(glass);
          this.lights.push({ x, y: top + 2, r: 18, k: 0.55, sy: 0.7 });
          this.halos.push({ x, y: top + 1, r: 14, c: [255, 210, 140], k: 0.5 });
        } else glass(r);
        this.ledges.push({ x: x - 2, y: top - 2, w: 5 });
      }
    }

    /* ---------- Neige, reflets, lumière rasante ---------- */
    snowPass(r, xa = 0, xb = this.W, l0 = 0) {
      const { L } = this;
      const sn = C('#f2f5fa');
      const snS = C('#c8d4e8');
      // Neige sur les toits : au-dessus du premier pixel plein de chaque colonne.
      for (let x = xa; x < xb; x++) {
        let y = 0;
        while (y < L.shopTop && !r.alpha(x, y)) y++;
        if (y >= L.shopTop || y < 2) continue;
        const th = 1 + (fbm(x * 0.2, 1, 5) > 0.5 ? 1 : 0) + (fbm(x * 0.2, 1, 5) > 0.62 ? 1 : 0);
        for (let k = 1; k <= th; k++) r.set(x, y - k, sn);
        r.set(x, y, snS);
      }
      // Corniches, appuis de fenêtres, auvents, enseignes.
      for (const l of this.ledges.slice(l0)) {
        for (let i = 0; i < l.w; i++) {
          const x = l.x + i;
          r.set(x, l.y - 1, sn);
          if (i > 0 && i < l.w - 1 && hash(x, l.y, 7) < 0.45) r.set(x, l.y - 2, sn);
          if (l.w > 8 && hash(x, l.y, 11) < 0.06) {
            r.set(x, l.y + 1, C('#d8e6f4'));
            if (hash(x, l.y, 12) < 0.5) r.set(x, l.y + 2, C('#b8cce0'));
          }
        }
      }
    }

    // Lumière rasante du soleil couchant : liseré chaud sur le haut des silhouettes.
    rimLight(r, col, fgOnly, xa = 0, xb = this.W) {
      const { H } = this;
      for (let x = xa; x < xb; x++) {
        let y = 0;
        while (y < H && !r.alpha(x, y)) y++;
        if (y >= H) continue;
        r.tint(x, y, col, 0.6);
        r.tint(x, y + 1, col, 0.3);
        if (!fgOnly) r.tint(x, y + 2, col, 0.12);
      }
    }

    // Puits de lumière chaude sur la chaussée, dans l'axe du soleil bas.
    sunShaft(r) {
      const { W, H, L } = this;
      const col = this.look.tod === 'sunset' ? C('#ffb070') : C('#ffaa50');
      for (let y = L.street0; y < H; y++) {
        const d = y - L.street0;
        const half = 22 + d * 0.9;
        for (let x = Math.max(0, Math.round(L.sunX - half)); x < Math.min(W, L.sunX + half); x++) {
          const e = 1 - Math.abs(x - L.sunX) / half;
          const q = Math.floor(e * 3 + bayer(x, y)) / 3;
          if (q > 0) r.tint(x, y, col, 0.16 * q);
        }
      }
    }

    // Chaussée mouillée : les façades et vitrines s'y reflètent.
    wetPass(r, xa = 0, xb = this.W, lamps = this.L.farLamps) {
      const { L } = this;
      for (let y = L.street0; y < L.s1; y++) {
        const d = y - L.street0;
        for (let x = xa; x < xb; x++) {
          const sy = L.street0 - 2 - Math.round(d * 1.6);
          const src = r.get(x + Math.round(Math.sin(y * 1.7) * 1.5), sy);
          const lum = src[0] + src[1] + src[2];
          if (y < L.s0) continue;
          if (lum > 420 && d % 2 === 0 && hash(x >> 1, y, 9) > 0.3) r.tint(x, y, src, 0.4);
          else if ((y - L.s0) % 3 === 0 && hash(x >> 2, y, 4) < 0.35) r.tint(x, y, this.skyStops[2], 0.18);
        }
      }
      // Traînées verticales des lampadaires d'en face sur la chaussée.
      if (this.look.lightsOn) {
        for (const lx of lamps) {
          for (let y = L.s0; y < L.s1; y++) if (hash(lx, y, 3) < 0.7) r.tint(lx + Math.round(Math.sin(y) * 1), y, C('#ffd890'), 0.35 * (1 - (y - L.s0) / (L.s1 - L.s0)));
        }
      }
    }

    paintGarland(r) {
      const { W, L } = this;
      const pts = [];
      for (const b of this.blds) pts.push(b.x);
      pts.push(W + 10);
      const y0 = L.shopTop - 6;
      const R = rng(55);
      const cols = ['#ffd27a', '#ff6a5a', '#7fe3ff', '#ffe9b0', '#8aff9a'];
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        for (let x = Math.max(0, a); x < Math.min(W, b); x++) {
          const u = (x - a) / (b - a);
          const y = Math.round(y0 + Math.sin(u * Math.PI) * 5);
          r.set(x, y, C('#1a1a20'));
          if ((x - a) % 5 === 2) this.bulbs.push({ x, y: y + 1, c: cols[this.bulbs.length % cols.length], p: R() * 6 });
        }
      }
    }

    /* ---------- Premier plan ---------- */
    paintForeground(r) {
      const { W, L } = this;
      const lk = this.look;
      const R = rng(808);
      this.paintTree(r, L.treeX, L.gY + 6, 1, R);
      this.paintTree(r, W + 4, L.gY + 6, 0.85, R);
      this.paintMorris(r, L.morrisX, L.gY + 2, R);
      this.paintLamp(r);
      this.paintBench(r);
      const sx = Math.round(W * 0.57);
      if (!lk.snow) this.paintPlanter(r, sx, L.gY, R);
      stamp(r, HYDRANT, HYDRANT_PAL, Math.round(W * 0.66), L.gY - 12);
      this.paintBin(r, Math.round(W * 0.72), L.gY);
      this.paintBikeRack(r, Math.round(W * 0.8), L.gY);
      if (lk.season === 'autumn' && !lk.snow) {
        this.leafPile(r, L.treeX - 14, L.gY + 7, 14, 4, R);
        this.leafPile(r, L.treeX + 8, L.gY + 8, 10, 3, R);
        this.leafPile(r, Math.round(W * 0.72) - 8, L.gY + 1, 9, 3, R);
        this.leafPile(r, W - 26, L.gY + 7, 14, 4, R);
      }
      if (lk.snow) this.snowFg(r);
      if (lk.snow) {
        // Bonhomme de neige : ombre au sol et contour bleuté pour qu'il se détache de la neige.
        for (let i = -1; i < 16; i++) r.set(sx - 2 + i, L.gY + 1, C('#8a96b8'));
        const out = { ...SNOWMAN_PAL };
        for (const k of Object.keys(out)) out[k] = '#7c88aa';
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) stamp(r, SNOWMAN, out, sx - 2 + dx, L.gY - 22 + dy);
        stamp(r, SNOWMAN, SNOWMAN_PAL, sx - 2, L.gY - 22);
      }
      if (lk.wet) this.wetFg(r);
    }

    paintTree(r, tx, by, scale, R) {
      const lk = this.look;
      const bark = { base: C('#4a3428'), hi: C('#6e5040'), dark: C('#2e2018') };
      const tips = [];
      const branch = (x, y, ang, len, wd, depth) => {
        const x1 = x + Math.cos(ang) * len;
        const y1 = y + Math.sin(ang) * len;
        const n = Math.ceil(len);
        for (let k = 0; k <= n; k++) {
          const u = k / n;
          const px = x + (x1 - x) * u;
          const py = y + (y1 - y) * u;
          const ww = Math.max(1, Math.round(wd * (1 - u * 0.35)));
          for (let d = 0; d < ww; d++) r.set(Math.round(px - ww / 2 + d), Math.round(py), ww > 2 && d === 0 ? bark.hi : ww > 2 && d === ww - 1 ? bark.dark : bark.base);
        }
        if (depth <= 0 || len < 3) {
          tips.push([x1, y1, 0]);
          return;
        }
        if (depth < 4) tips.push([x1, y1, depth]);
        if (depth < 3) tips.push([(x + x1) / 2, (y + y1) / 2, depth]);
        const nb = 2 + (R() < 0.35 ? 1 : 0);
        for (let i = 0; i < nb; i++) {
          const a = ang + (i - (nb - 1) / 2) * 0.62 + (R() - 0.5) * 0.4;
          branch(x1, y1, a, len * (0.66 + R() * 0.18), Math.max(1, wd * 0.6), depth - 1);
        }
      };
      // Fosse d'arbre avec sa grille.
      r.rect(tx - 10, by - 1, 21, 3, C('#3a3630'));
      for (let i = -9; i <= 9; i += 2) r.set(tx + i, by, C('#5a564e'));
      branch(tx, by, -Math.PI / 2, 30 * scale, 6 * scale, 5);
      if (lk.season === 'winter') return;
      // Feuillage ou fleurs : amas ombrés autour des bouts de branches.
      const pal = {
        spring: ['#b8577e', '#e386a6', '#f6b6cc', '#ffe6ef'],
        summer: ['#1f3f2a', '#30603a', '#4a8644', '#74ac58'],
        autumn: ['#7a2a1a', '#c04a22', '#e8802e', '#f6b84a'],
      }[lk.season].map(C);
      const blobs = tips.map(([x, y, d]) => ({ x, y, r: (6 + R() * 4 + d * 1.6) * scale }));
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const b of blobs) {
        x0 = Math.min(x0, b.x - b.r);
        x1 = Math.max(x1, b.x + b.r);
        y0 = Math.min(y0, b.y - b.r);
        y1 = Math.max(y1, b.y + b.r);
      }
      const sparse = lk.season === 'autumn' ? 0.12 : lk.season === 'spring' ? 0.06 : 0.02;
      for (let y = Math.floor(y0); y <= y1; y++) {
        for (let x = Math.floor(x0); x <= x1; x++) {
          let best = null;
          let bd = 9;
          for (const b of blobs) {
            const d = ((x - b.x) ** 2 + (y - b.y) ** 2) / (b.r * b.r);
            if (d < bd) {
              bd = d;
              best = b;
            }
          }
          const n = fbm(x * 0.22, y * 0.22, 21);
          if (bd > 0.75 + (n - 0.5) * 0.9) continue;
          if (hash(x, y, 31) < sparse) continue;
          const v = (-(x - best.x) * 0.6 - (y - best.y) * 0.8) / best.r;
          const tone = Math.max(0, Math.min(3, Math.floor((v * 0.5 + 0.5) * 2.6 + (n - 0.5) * 2 + bayer(x, y) * 0.8 + (1 - bd) * 0.6)));
          r.set(x, y, pal[tone]);
        }
      }
      if (lk.season === 'spring') {
        // Quelques feuilles vertes tendres et des fleurs blanches.
        for (let k = 0; k < 60 * scale; k++) {
          const b = blobs[Math.floor(R() * blobs.length)];
          const x = Math.round(b.x + (R() - 0.5) * b.r * 1.4);
          const y = Math.round(b.y + (R() - 0.5) * b.r * 1.4);
          if (r.get(x, y)[3]) r.set(x, y, R() < 0.5 ? C('#ffffff') : C('#7aae5a'));
        }
      }
    }

    paintLamp(r, lx = this.L.lampX, ly = this.L.lampY) {
      const { L } = this;
      const lk = this.look;
      const iron = C('#2a2d36');
      const hi = C('#4c5262');
      const gy = L.gY;
      r.rect(lx - 4, gy + 1, 10, 3, iron);
      r.rect(lx - 3, gy - 3, 8, 4, iron);
      r.rect(lx - 2, gy - 9, 6, 6, iron);
      r.rect(lx - 3, gy - 3, 1, 4, hi);
      r.rect(lx - 2, gy - 9, 1, 6, hi);
      r.rect(lx, ly + 12, 2, gy - 9 - ly - 12, iron);
      r.rect(lx, ly + 12, 1, gy - 9 - ly - 12, hi);
      for (const cy of [ly + 12, ly + 40, gy - 24]) {
        r.rect(lx - 1, cy, 4, 2, iron);
        r.set(lx - 1, cy, hi);
      }
      r.rect(lx - 4, ly + 17, 10, 1, iron);
      // Lanterne.
      for (let k = 0; k < 5; k++) r.rect(lx - k, ly - 4 + k, 2 + k * 2, 1, k === 4 ? hi : iron);
      r.rect(lx, ly - 6, 2, 2, iron);
      r.rect(lx - 3, ly + 1, 1, 8, iron);
      r.rect(lx + 4, ly + 1, 1, 8, iron);
      for (let k = 0; k < 3; k++) r.rect(lx - 2 + k, ly + 9 + k, 6 - k * 2, 1, iron);
      const glass = (t) => {
        if (lk.lightsOn) {
          t.rect(lx - 2, ly + 1, 6, 8, C('#ffd88a'));
          t.rect(lx - 1, ly + 2, 4, 6, C('#fff4cc'));
          t.rect(lx, ly + 3, 2, 3, C('#ffffff'));
        } else {
          t.rect(lx - 2, ly + 1, 6, 8, C('#b8c8d4'));
          t.rect(lx - 1, ly + 2, 1, 5, C('#e8f0f4'));
        }
        t.rect(lx + 1, ly + 1, 1, 8, iron);
      };
      if (lk.lightsOn) {
        this.pushPost(glass);
        if (!this.extMode) this.halos.push({ x: lx + 1, y: ly + 5, r: 32, c: [255, 205, 135], k: 0.55 });
      } else glass(r);
    }

    paintBench(r, bx = this.L.benchX, bs = this.L.benchY) {
      const BW = 46; // assez long pour le lecteur et sa tasse
      const wood = C('#9a6a42');
      const wh = C('#c08a58');
      const wdk = C('#6a4628');
      const iron = C('#2a2d36');
      // Montants arrière.
      r.rect(bx + 3, bs - 17, 2, 17, iron);
      r.rect(bx + BW - 5, bs - 17, 2, 17, iron);
      // Dossier : trois lattes.
      for (const y of [bs - 17, bs - 12, bs - 7]) {
        r.rect(bx, y, BW, 3, wood);
        r.rect(bx, y, BW, 1, wh);
        r.rect(bx, y + 2, BW, 1, wdk);
        r.rect(bx + BW - 1, y, 1, 3, wdk);
      }
      // Assise.
      r.rect(bx - 1, bs - 2, BW + 2, 2, wh);
      r.rect(bx - 1, bs, BW + 2, 2, wood);
      r.rect(bx - 1, bs + 1, BW + 2, 1, wdk);
      // Pieds et accoudoirs en fonte.
      for (const lx of [bx + 1, bx + BW - 4]) {
        r.rect(lx, bs + 2, 3, 6, iron);
        r.rect(lx - 1, bs + 7, 5, 1, iron);
        r.rect(lx, bs - 7, 3, 1, iron);
        r.rect(lx + (lx < bx + 10 ? 0 : 2), bs - 6, 1, 5, iron);
      }
    }

    // Vélos et cyclistes (le cycliste est posé sur la selle, mains au guidon, pieds aux
    // pédales qui tournent).
    makeBikes(lk, tintFn, tc, ta) {
      const coats = ['#d4564f', '#3f8fb0', '#e8c547', '#5e7a4a'];
      const hh = 4.8;
      return coats.map((c, i) => {
        const pal = { ...BIKE_PAL, f: ['#2a2a30', '#c8463c', '#3e8ab0', '#e8e0d0'][i] };
        const look = { ...PP.randomLook(40 + i * 3, { season: lk.season }), top: c, topStyle: 'jacket', bottomStyle: 'pants', scarf: null, bag: false };
        const out = {};
        for (const dir of ['right', 'left']) {
          const flip = dir === 'left';
          const poses = [0, 1, 2, 3].map((fr) => {
            const ang = (fr * Math.PI) / 2;
            const ped = (a) => [(9 + Math.cos(a) * 2.4 - 7) / hh, (8 - 14 - Math.sin(a) * 2.4) / hh];
            const pL = ped(ang + Math.PI);
            const pR = ped(ang);
            return {
              pelvis: [0, 0.25, 0],
              lean: 0.62,
              head: { nod: -0.35 },
              legL: { foot: [pL[0], pL[1] - 0.05, 0.16], pole: [1, 0.4, 0.1] },
              legR: { foot: [pR[0], pR[1] - 0.05, -0.16], pole: [1, 0.4, -0.1] },
              armL: { hand: [1.55, 0.3, 0.14] },
              armR: { hand: [1.55, 0.3, -0.14] },
              sway: fr,
            };
          });
          const sh = PP.bake(PP.sheet(look, { ride: poses }, { hh, view: flip ? Math.PI - 0.15 : 0.15 }), tintFn);
          const sx = flip ? 13 : 7;
          const ox = sx - sh.ax;
          const oy = 8 - sh.ay;
          const x0 = Math.min(0, ox);
          const y0 = Math.min(0, oy);
          const w = Math.max(21, ox + sh.w) - x0;
          const h = Math.max(18, oy + sh.h) - y0;
          out[dir] = sh.frames.ride.map((rider, fr) => {
            const cv = document.createElement('canvas');
            cv.width = w;
            cv.height = h;
            const cx = cv.getContext('2d');
            cx.drawImage(shade(sprite(bikeRows(fr, false), pal, flip), tc, ta), -x0, -y0);
            cx.drawImage(rider, ox - x0, oy - y0);
            return cv;
          });
          out[`${dir}D`] = [x0, y0];
        }
        return out;
      });
    }

    paintPlanter(r, x, gy, R) {
      const lk = this.look;
      const box = C('#7a5434');
      r.rect(x, gy - 7, 15, 7, box);
      r.rect(x, gy - 7, 15, 1, C('#a07448'));
      for (let i = x + 2; i < x + 15; i += 4) r.rect(i, gy - 6, 1, 6, C('#5a3a24'));
      if (lk.season === 'autumn') {
        for (const px of [x + 2, x + 8]) {
          r.rect(px, gy - 11, 5, 4, C('#e8802e'));
          r.rect(px + 1, gy - 12, 3, 1, C('#e8802e'));
          r.rect(px + 2, gy - 11, 1, 4, C('#c06020'));
          r.set(px + 2, gy - 13, C('#4a6a2a'));
        }
      } else {
        const fl = lk.season === 'spring' ? ['#f8d84a', '#ff8aa8', '#ffffff'] : ['#e84a5a', '#b06ad8', '#f8d84a'];
        for (let k = 0; k < 60; k++) {
          const fx = x + 1 + Math.floor(R() * 13);
          const fy = gy - 8 - Math.floor(R() * 6);
          r.set(fx, fy, R() < 0.55 ? C(R() < 0.5 ? '#3e7a3e' : '#5a9a4a') : C(fl[Math.floor(R() * 3)]));
        }
      }
    }

    paintBin(r, x, gy) {
      const g1 = C('#2e5a44');
      const g2 = C('#3e7a5a');
      const g0 = C('#1e3a2e');
      for (let y = gy - 13; y < gy; y++) {
        for (let i = 0; i < 9; i++) {
          let c = i % 2 ? g1 : g2;
          if (i === 0) c = mix(g2, WHITE, 0.15);
          if (i === 8) c = g0;
          r.set(x + i, y, c);
        }
      }
      r.rect(x - 1, gy - 15, 11, 2, g0);
      r.rect(x - 1, gy - 15, 11, 1, g2);
      r.rect(x + 3, gy - 17, 3, 2, g0);
      r.rect(x + 1, gy - 9, 7, 1, g0);
      r.rect(x + 1, gy, 7, 1, C('#1a1a20'));
    }

    paintBikeRack(r, x, gy) {
      stamp(r, bikeRows(1, false), { ...BIKE_PAL, f: '#3e8ab0' }, x - 4, gy - 17);
      const steel = C('#9aa0aa');
      r.rect(x, gy - 9, 1, 9, steel);
      r.rect(x + 12, gy - 9, 1, 9, steel);
      r.rect(x + 1, gy - 10, 11, 1, steel);
    }

    // Colonne Morris couverte d'affiches, avec son dôme.
    paintMorris(r, x, gy, R) {
      const lk = this.look;
      const g0 = C('#1e3a2c');
      const g1 = C('#2e5a42');
      const g2 = C('#4a7a5a');
      const gold = C('#c8a050');
      const w = 15;
      r.rect(x - 1, gy - 3, w + 2, 3, g0);
      r.rect(x - 1, gy - 3, w + 2, 1, g2);
      const top = gy - 40;
      // Affiches.
      const posters = [
        { x0: 0, x1: 5, c: '#e8c547', ink: '#c8382c' },
        { x0: 5, x1: 10, c: '#2e4a7a', ink: '#f2e2c4' },
        { x0: 10, x1: 15, c: '#f2e2c4', ink: '#3a2a4a' },
      ];
      for (let y = top; y < gy - 3; y++) {
        for (let i = 0; i < w; i++) {
          const p = posters.find((q) => i >= q.x0 && i < q.x1);
          const band = Math.floor((y - top) / 12);
          let c = C(band === 1 ? posters[(posters.indexOf(p) + 1) % 3].c : p.c);
          const ink = C(band === 1 ? posters[(posters.indexOf(p) + 1) % 3].ink : p.ink);
          const ly = (y - top) % 12;
          if (ly === 0) c = g1;
          else if ((ly === 3 || ly === 4) && i > p.x0 && i < p.x1 - 1) c = ink;
          else if ((ly === 7 || ly === 9) && i > p.x0 && i < p.x1 - 1 && hash(i, y, 3) < 0.7) c = mix(ink, c, 0.4);
          // Rondeur du cylindre : bords plus sombres, reflet à gauche.
          const e = Math.abs(i - 7) / 7.5;
          c = mix(c, BLACK, e > 0.8 ? 0.4 : e > 0.6 ? 0.18 : 0);
          if (i === 3) c = mix(c, WHITE, 0.15);
          r.set(x + i, y, c);
        }
      }
      X.text(r, 'BAL', x + 2, top + 15, C('#ffe9a8'));
      // Frise et dôme.
      r.rect(x - 1, top - 3, w + 2, 3, g1);
      r.rect(x - 1, top - 3, w + 2, 1, g2);
      for (let i = 0; i < w + 2; i += 2) r.set(x - 1 + i, top - 2, gold);
      for (let k = 0; k < 7; k++) {
        const half = Math.round(Math.sqrt(1 - (k / 7) ** 2) * 8);
        r.rect(x + 7 - half, top - 4 - k, half * 2 + 1, 1, k % 2 ? g1 : g2);
        r.set(x + 7 - half, top - 4 - k, g2);
      }
      r.rect(x + 6, top - 13, 3, 2, g0);
      r.set(x + 7, top - 14, gold);
      if (lk.snow) r.rect(x + 3, top - 12, 9, 1, C('#f2f5fa'));
    }

    leafPile(r, x, y, w, hmax, R) {
      const lv = ['#7a2a1a', '#c04a22', '#e8802e', '#f6b84a', '#a0522a'].map(C);
      for (let i = 0; i < w; i++) {
        const h = Math.round(Math.sin(((i + 0.5) / w) * Math.PI) * hmax + R() * 0.8);
        for (let j = 0; j < h; j++) r.set(x + i, y - j, lv[Math.floor(R() * lv.length)]);
      }
    }

    // Neige posée sur tout ce qui a un dessus (branches, lampadaire, banc, poubelle…).
    snowFg(r, xa = 0, xb = this.W) {
      const { H } = this;
      const sn = C('#f2f5fa');
      const marks = [];
      for (let y = 1; y < H; y++) {
        for (let x = xa; x < xb; x++) {
          if (!r.alpha(x, y) || r.alpha(x, y - 1)) continue;
          const wide = r.get(x - 1, y)[3] && r.get(x + 1, y)[3];
          if (wide || hash(x, y, 5) < 0.55) marks.push([x, y - 1]);
          if (wide && hash(x, y, 6) < 0.4) marks.push([x, y - 2]);
        }
      }
      for (const [x, y] of marks) r.set(x, y, sn);
    }

    // Pluie : reflets brillants sur le dessus des objets mouillés.
    wetFg(r, xa = 0, xb = this.W) {
      const { H } = this;
      for (let y = 1; y < H; y++) {
        for (let x = xa; x < xb; x++) {
          if (r.alpha(x, y) && !r.alpha(x, y - 1) && hash(x, y, 2) < 0.6) r.tint(x, y, C('#c8d8f0'), 0.35);
        }
      }
    }

    /* ================= La rue prolongée (animation d'ouverture) ================= */
    // Tout ce qui suit n'est peint qu'avec un monde élargi, en mode extension : jamais sur
    // l'écran. À gauche : un tabac, un cinéma, une place avec sa fontaine, une église, une
    // rue transversale, un bistrot, une boulangerie, une pharmacie avec sa bouche de métro,
    // une fromagerie, une galerie. Devant : abribus, lampadaires, vélos en libre-service,
    // kiosque à journaux, un musicien sur un banc, une fontaine Wallace.

    // Guirlande de l'extension : même courbe que celle de l'écran sur les immeubles qui
    // dépassent du cadre, puis d'un immeuble à l'autre.
    paintGarlandExt(r) {
      const { W, L } = this;
      const R = rng(56);
      const cols = ['#ffd27a', '#ff6a5a', '#7fe3ff', '#ffe9b0', '#8aff9a'];
      const segs = [];
      const pts = this.blds.map((b) => b.x).concat([W + 10]);
      for (let k = 0; k < pts.length - 1; k++) segs.push([pts[k], pts[k + 1]]);
      let prevEnd = W + 10;
      for (const b of this.extLots) {
        if (b.lot) continue;
        if (b.x + b.w <= 0) segs.push([b.x, b.x + b.w]);
        else if (b.x + b.w > prevEnd) {
          segs.push([prevEnd, b.x + b.w]);
          prevEnd = b.x + b.w;
        }
      }
      const y0 = L.shopTop - 6;
      for (const [a, b] of segs) {
        for (let x = Math.max(this.wx0, a); x < Math.min(this.wx1, b); x++) {
          if (x >= 0 && x < W) continue;
          const u = (x - a) / (b - a);
          const y = Math.round(y0 + Math.sin(u * Math.PI) * 5);
          r.set(x, y, C('#1a1a20'));
          if ((x - a) % 5 === 2) this.bulbs.push({ x, y: y + 1, c: cols[this.bulbs.length % cols.length], p: R() * 6 });
        }
      }
    }

    paintExtLots(r, R) {
      const lots = this.extLots;
      for (const b of lots) if (b.lot === 'square') this.paintSquare(r, b, R);
      for (const b of lots) if (b.lot === 'lane') this.paintLane(r, b);
      for (const b of lots) if (b.lot === 'church') this.paintChurch(r, b);
      for (const b of lots) if (!b.lot) this.paintBuilding(r, b, R);
      for (const b of lots) if (b.metro) this.paintMetro(r, b);
      this.paintPlates(r);
    }

    // Plaques de rue émaillées (bleu, cadre vert, lettres blanches) aux coins.
    paintPlates(r) {
      const { L } = this;
      const plate = (text, x, y) => {
        const w = text.length * 4 + 3;
        r.rect(x, y, w, 9, C('#2e6a4a'));
        r.rect(x + 1, y + 1, w - 2, 7, C('#24418a'));
        X.text(r, text, x + 2, y + 2, C('#f2f2ec'));
        this.ledges.push({ x, y, w });
      };
      for (const b of this.extLots) {
        if (b.lot === 'square') plate('PLACE', b.x + b.w - 1, L.shopTop - 17);
        if (b.lot === 'lane') plate('RUE', b.x - 16, L.shopTop - 17);
      }
    }

    // Une petite place : immeubles en retrait, pavés, deux arbres, une fontaine à vasques.
    paintSquare(r, b, R) {
      const { L } = this;
      const lk = this.look;
      const x0 = b.x;
      const x1 = b.x + b.w;
      const base = L.street0;
      const back = base - 9;
      const s = this.skyStops;
      const haze = mix(s[2], s[3], 0.5);
      const RR = rng(b.idx * 7 + 3);
      const mats = ['cream', 'stucco', 'brick', 'tan', 'stone'];
      const zinc = lk.snow ? C('#c8d0dc') : C('#5c6878');
      // Rangée d'immeubles en retrait, un peu voilés par l'air.
      for (let x = x0 - 4; x < x1 + 4; ) {
        const w = 18 + Math.floor(RR() * 12);
        const top = back - 46 - Math.floor(RR() * 14);
        const m = MATS[mats[Math.floor(RR() * mats.length)]];
        const wall = mix(m.base, haze, 0.32);
        const dark = mix(m.dark, haze, 0.32);
        r.rect(x, top, w, back - top, wall);
        r.rect(x, top, 1, back - top, mix(m.hi, haze, 0.32));
        r.rect(x + w - 1, top, 1, back - top, dark);
        r.rect(x - 1, top, w + 2, 1, mix(m.trim, haze, 0.3));
        r.rect(x - 1, top + 1, w + 2, 1, dark);
        if (RR() < 0.6) for (let k = 1; k <= 6; k++) r.rect(x + Math.floor(k * 0.5), top - k, w - 2 * Math.floor(k * 0.5), 1, k === 6 ? mix(zinc, WHITE, 0.2) : zinc);
        else r.rect(x + w - 8, top - 6, 4, 6, mix(MATS.brick.base, haze, 0.3));
        for (let wy = top + 5; wy < back - 13; wy += 9) {
          for (let wx = x + 3; wx < x + w - 4; wx += 6) {
            r.rect(wx, wy, 3, 5, mix(C('#2a3048'), s[1], 0.3));
            r.rect(wx, wy + 5, 3, 1, mix(m.trim, haze, 0.3));
            if (lk.lightsOn && RR() < 0.28) {
              const c = mix(RR() < 0.5 ? C('#ffd890') : C('#ffb860'), C('#5a4a50'), 0.25);
              this.pushPost((t) => t.rect(wx, wy, 3, 5, c));
            }
          }
        }
        // Rez-de-chaussée : une vitrine sous un store.
        r.rect(x + 1, back - 11, w - 2, 11, mix(C('#3a3036'), haze, 0.2));
        r.rect(x + 2, back - 8, w - 4, 7, lk.lightsOn ? C('#4a3a30') : mix(C('#6a7488'), haze, 0.2));
        if (lk.lightsOn) this.pushPost((t) => t.rect(x + 2, back - 8, w - 4, 7, C('#ffcf88')));
        const awn = [C('#b8463c'), C('#3a6a8a'), C('#d8a83a')][Math.floor(RR() * 3)];
        for (let i = 1; i < w - 1; i++) r.rect(x + i, back - 11, 1, 2, Math.floor(i / 2) % 2 ? mix(awn, haze, 0.25) : mix(WHITE, haze, 0.35));
        x += w;
      }
      // Les pavés de la place, de plus en plus petits vers le fond.
      for (let y = back; y < base; y++) {
        const dd = (y - back) / (base - back);
        const bw = 2 + Math.round(dd * 3);
        for (let x = x0; x < x1; x++) {
          let c = (x + (y % 2) * 2) % bw === 0 || (y - back) % 2 === 1 ? C('#857f74') : hash(x, y, 21) < 0.3 ? C('#a49e92') : C('#979186');
          if (lk.snow) c = bayer(x, y) < 0.12 ? C('#cdd8ea') : C('#eef2f8');
          c = mix(c, BLACK, (1 - dd) * 0.18);
          r.set(x, y, c);
        }
      }
      if (lk.season === 'autumn' && !lk.snow) for (let k = 0; k < b.w * 0.4; k++) r.set(x0 + Math.floor(R() * b.w), back + Math.floor(R() * 9), [C('#c84a22'), C('#e8802e'), C('#f6b84a')][Math.floor(R() * 3)]);
      if (lk.season === 'spring' && !lk.snow) for (let k = 0; k < b.w * 0.4; k++) r.set(x0 + Math.floor(R() * b.w), back + Math.floor(R() * 9), [C('#ffc0d4'), C('#ff9fbf')][Math.floor(R() * 2)]);
      // Deux arbres de la place.
      this.paintTree(r, Math.round(x0 + b.w * 0.16), back + 4, 0.62, R);
      this.paintTree(r, Math.round(x1 - b.w * 0.16), back + 4, 0.58, R);
      // Petits bancs verts face à la fontaine.
      for (const bx of [x0 + 12, x1 - 22]) {
        const g = C('#2e5a42');
        r.rect(bx, base - 5, 10, 1, C('#9a6a42'));
        r.rect(bx, base - 7, 10, 1, C('#9a6a42'));
        r.rect(bx + 1, base - 4, 1, 3, g);
        r.rect(bx + 8, base - 4, 1, 3, g);
        this.ledges.push({ x: bx, y: base - 7, w: 10 });
      }
      // La fontaine à vasques.
      const cx = Math.round((x0 + x1) / 2);
      const yb = base - 1;
      const st = MATS.church;
      const water = mix(s[2], WHITE, 0.45);
      r.rect(cx - 13, yb - 8, 27, 1, st.alt);
      r.rect(cx - 14, yb - 7, 29, 1, lk.snow ? C('#e8eef8') : mix(s[1], s[2], 0.5));
      r.rect(cx - 15, yb - 6, 31, 1, st.trimHi);
      for (let y = yb - 5; y < yb; y++) for (let x = cx - 15; x <= cx + 15; x++) r.set(x, y, (x - cx + 15) % 6 === 0 ? st.mortar : x === cx - 15 ? st.hi : st.base);
      r.rect(cx - 15, yb, 31, 1, st.dark);
      r.rect(cx - 2, yb - 19, 4, 11, st.base);
      r.rect(cx - 2, yb - 19, 1, 11, st.hi);
      r.rect(cx + 1, yb - 19, 1, 11, st.mortar);
      r.rect(cx - 7, yb - 21, 15, 1, st.trimHi);
      r.rect(cx - 6, yb - 20, 13, 1, st.base);
      r.rect(cx - 4, yb - 19, 9, 1, st.dark);
      r.rect(cx - 1, yb - 27, 2, 6, st.base);
      r.rect(cx - 3, yb - 28, 7, 1, st.trimHi);
      r.rect(cx - 2, yb - 27, 5, 1, st.dark);
      r.rect(cx - 1, yb - 31, 2, 3, st.alt);
      r.set(cx, yb - 32, st.hi);
      this.ledges.push({ x: cx - 15, y: yb - 6, w: 31 }, { x: cx - 7, y: yb - 21, w: 15 }, { x: cx - 3, y: yb - 28, w: 7 });
      if (!lk.snow) {
        // Rideaux d'eau qui retombent des vasques.
        for (let y = yb - 27; y < yb - 21; y++) {
          r.set(cx - 4, y, water);
          r.set(cx + 4, y, water);
        }
        for (let y = yb - 20; y < yb - 7; y++) {
          if (hash(cx, y, 4) < 0.85) r.set(cx - 8, y, water);
          if (hash(cx + 1, y, 4) < 0.85) r.set(cx + 8, y, water);
        }
        this.fountains.push({ kind: 'square', x: cx, y: yb });
      } else {
        for (const ix of [cx - 6, cx - 3, cx + 2, cx + 5]) r.rect(ix, yb - 20, 1, 1 + (ix & 1), C('#cfe2f4'));
      }
      if (this.look.lightsOn) {
        this.lights.push({ x: cx, y: yb - 6, r: 18, k: 0.4, sy: 1 });
      }
    }

    // Une rue transversale qui s'enfonce : murs en fuite, façade au fond, chaussée.
    paintLane(r, b) {
      const { L } = this;
      const lk = this.look;
      const base = L.street0;
      const s = this.skyStops;
      const haze = mix(s[2], s[3], 0.5);
      const left = this.extLots.find((o) => o.x + o.w === b.x);
      const right = this.extLots.find((o) => o.x === b.x + b.w);
      const topOf = (o) => (!o ? L.shopTop - 50 : o.lot === 'church' ? base - 46 : o.lot ? L.shopTop - 50 : o.top + 4);
      const cx = b.x + b.w / 2;
      const FL = Math.round(cx - 5);
      const FR = Math.round(cx + 5);
      const yFT = base - 50;
      const yFB = base - 15;
      const x0 = b.x;
      const x1 = b.x + b.w - 1;
      const mL = MATS[left && left.mat ? left.mat : 'brick'];
      const mR = MATS[right && right.mat ? right.mat : 'stone'];
      const winD = mix(C('#2a3048'), s[1], 0.25);
      const wall = (x, t, top, m, k, sideT) => {
        const yt = Math.round(top + (yFT - top) * t);
        const yb = Math.round(base + (yFB - base) * t);
        for (let y = yt; y < yb; y++) {
          const v = (y - yt) / Math.max(1, yb - yt);
          let c = mix(mix(m.base, BLACK, k), haze, 0.15 + t * 0.35);
          const fl = (v * 5) % 1;
          const col = (sideT * 4) % 1;
          if (v < 0.78 && fl > 0.35 && fl < 0.75 && col > 0.3 && col < 0.75) {
            c = mix(winD, haze, t * 0.3);
            if (lk.lightsOn && hash(Math.floor(sideT * 4), Math.floor(v * 5), b.idx) < 0.4) {
              const cc = mix(C('#ffcf88'), haze, t * 0.25);
              this.pushPost((tt) => tt.set(x, y, cc));
            }
          }
          if (v > 0.8) c = mix(c, BLACK, 0.2);
          r.set(x, y, c);
        }
        // Sol de la rue, sous le mur.
        for (let y = yb; y < base; y++) r.set(x, y, lk.snow ? C('#e8eef6') : y - yb < 2 ? C('#9a948a') : hash(x, y, 8) < 0.15 ? C('#4a4a52') : C('#56565e'));
      };
      for (let x = x0; x < FL; x++) {
        const t = (x - x0) / (FL - x0);
        wall(x, t, topOf(left), mL, 0.05, t);
      }
      for (let x = x1; x > FR; x--) {
        const t = (x1 - x) / (x1 - FR);
        wall(x, t, topOf(right), mR, 0.32, t);
      }
      // La façade au fond, et la chaussée qui y mène.
      const mF = MATS.cream;
      for (let x = FL; x <= FR; x++) {
        for (let y = yFT; y < yFB; y++) {
          let c = mix(mF.base, haze, 0.5);
          if ((y - yFT) % 7 > 2 && (y - yFT) % 7 < 6 && (x - FL) % 4 === 1) c = mix(winD, haze, 0.4);
          if (y > yFB - 6) c = mix(C('#3a3036'), haze, 0.3);
          r.set(x, y, c);
        }
        for (let y = yFB; y < base; y++) {
          const edge = Math.abs(x - cx) > ((y - yFB) / (base - yFB)) * (b.w / 2 - 6) + 3;
          r.set(x, y, lk.snow ? (edge ? C('#f2f5fa') : C('#dfe6f0')) : edge ? C('#9a948a') : hash(x, y, 8) < 0.15 ? C('#4a4a52') : C('#56565e'));
        }
      }
      r.rect(FL - 1, yFT - 1, FR - FL + 3, 1, mix(mF.trim, haze, 0.4));
      if (lk.lightsOn) {
        this.pushPost((t) => t.rect(FL + 1, yFB - 5, FR - FL - 1, 3, C('#ffcf88')));
        this.halos.push({ x: Math.round(cx), y: yFB - 4, r: 12, c: [255, 200, 130], k: 0.35 });
      }
    }

    // L'église de la place : clocher-porche à flèche, bas-côtés, rosace et vitraux.
    paintChurch(r, b) {
      const { L } = this;
      const lk = this.look;
      const m = MATS.church;
      const base = L.street0;
      const cx = Math.round(b.x + b.w / 2);
      const tw = 11;
      const yA = base - 46;
      const yT = Math.max(30, base - 98);
      const zinc = lk.snow ? C('#c8d0dc') : C('#56606e');
      const zinc2 = lk.snow ? C('#eef2f8') : C('#6e7a88');
      const glassCols = ['#e8b04a', '#c8463c', '#4a7ad0', '#5aa04a', '#a04ab0'].map(C);
      const glass = (x, y, w, h, pointed) => {
        r.rect(x - 1, y - 1, w + 2, h + 2, m.trim);
        const paintG = (t, on) => {
          for (let j = 0; j < h; j++) {
            for (let i = 0; i < w; i++) {
              if (pointed && j < 2 && (i === 0 || i === w - 1) && (j === 0 || w > 3)) continue;
              const c = glassCols[Math.floor(hash(x + i, Math.floor((y + j) / 2), 3) * glassCols.length)];
              t.set(x + i, y + j, on ? mix(c, WHITE, 0.25) : mix(c, C('#1a1e34'), 0.62));
            }
          }
          t.rect(x + Math.floor(w / 2), y + 2, 1, h - 2, on ? C('#5a3a2a') : C('#14141c'));
        };
        if (pointed) {
          r.set(x - 1, y - 1, m.base);
          r.set(x + w, y - 1, m.base);
        }
        if (lk.lightsOn) this.pushPost((t) => paintG(t, true));
        else paintG(r, false);
      };
      // Bas-côtés (toits en appentis contre le clocher).
      for (const [a, z] of [[b.x + 1, cx - tw - 1], [cx + tw + 1, b.x + b.w - 2]]) {
        const outerL = a < cx;
        this.paintWall(r, a, yA, z - a + 1, base - yA, m, 'stone', b.idx + 5);
        for (let x = a; x <= z; x++) {
          const u = outerL ? (x - a) / (z - a) : (z - x) / (z - a);
          const yr = Math.round(yA - u * 10);
          for (let k = 0; k < 3; k++) r.set(x, yr + k, k === 0 ? zinc2 : zinc);
          for (let y = yr + 3; y < yA; y++) r.set(x, y, m.alt);
        }
        r.rect(a, yA + 2, z - a + 1, 1, m.trimHi);
        this.ledges.push({ x: a, y: yA + 2, w: z - a + 1 });
        // Contreforts.
        for (const bx of [a, z - 2]) {
          r.rect(bx, yA + 6, 3, base - yA - 6, m.hi);
          r.rect(bx + 2, yA + 6, 1, base - yA - 6, m.dark);
          r.rect(bx, yA + 5, 3, 1, m.trimHi);
        }
        const gx = Math.round((a + z) / 2) - 2;
        glass(gx, base - 36, 5, 17, true);
        r.rect(gx - 1, base - 18, 7, 1, m.trimHi);
        this.ledges.push({ x: gx - 1, y: base - 18, w: 7 });
      }
      // Le clocher-porche.
      const tx0 = cx - tw;
      const tx1 = cx + tw;
      this.paintWall(r, tx0, yT, tx1 - tx0 + 1, base - yT, m, 'stone', b.idx + 9);
      for (let y = yT; y < base; y++) {
        const q = Math.floor(y / 4) % 2;
        r.rect(tx0, y, q ? 3 : 2, 1, m.hi);
        r.rect(tx1 - (q ? 2 : 1), y, q ? 3 : 2, 1, mix(m.base, m.dark, 0.35));
      }
      // Portail en arc brisé, portes en bois, marches.
      const pw = 14;
      const px = cx - 7;
      const ph = 26;
      for (let j = 0; j < ph; j++) {
        const y = base - ph + j;
        const ins = j < 7 ? Math.round(7 - Math.sqrt(Math.max(0, 49 - (7 - j) * (7 - j) * 1.0)) ) : 0;
        r.rect(px - 2 + ins, y, pw + 4 - ins * 2, 1, m.trim);
        if (j > 1) r.rect(px + ins, y, pw - ins * 2, 1, j < 9 ? mix(m.dark, BLACK, 0.2) : C('#5a2a1e'));
      }
      for (let j = 9; j < ph; j++) {
        r.set(px + 3, base - ph + j, C('#4a2016'));
        r.set(cx, base - ph + j, C('#2a120c'));
        r.set(px + pw - 4, base - ph + j, C('#4a2016'));
      }
      r.rect(px, base - ph + 9, pw, 1, m.trim);
      r.rect(px + 1, base - 13, pw - 2, 1, C('#2a1a14'));
      r.rect(px + 1, base - 7, pw - 2, 1, C('#2a1a14'));
      r.set(cx - 2, base - 11, C('#c8a050'));
      r.set(cx + 1, base - 11, C('#c8a050'));
      for (let k = 0; k < 3; k++) r.rect(px - 3 - k * 2, base - 3 + k, pw + 6 + k * 4, 1, k % 2 ? m.alt : m.trimHi);
      this.ledges.push({ x: px - 2, y: base - ph, w: pw + 4 });
      // Rosace.
      const ry = base - 41;
      for (let y = -7; y <= 7; y++) {
        for (let x = -7; x <= 7; x++) {
          const d = Math.hypot(x, y);
          if (d > 7.3) continue;
          if (d > 5.6) r.set(cx + x, ry + y, m.trim);
        }
      }
      const paintRose = (t, on) => {
        for (let y = -5; y <= 5; y++) {
          for (let x = -5; x <= 5; x++) {
            const d = Math.hypot(x, y);
            if (d > 5.6) continue;
            const a = Math.atan2(y, x);
            const sec = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 8);
            let c = d < 1.6 ? glassCols[0] : d > 4.4 ? glassCols[sec % 2 ? 1 : 3] : glassCols[sec % 2 ? 2 : 4];
            if (Math.abs(Math.sin(a * 4)) < 0.18 && d > 1.6) c = C('#3a2a24');
            t.set(cx + x, ry + y, on ? mix(c, WHITE, 0.2) : mix(c, C('#1a1e34'), 0.6));
          }
        }
      };
      if (lk.lightsOn) {
        this.pushPost((t) => paintRose(t, true));
        this.halos.push({ x: cx, y: ry, r: 16, c: [255, 190, 140], k: 0.28 });
        this.lights.push({ x: cx, y: base - 30, r: 14, k: 0.5, sy: 1 });
      } else paintRose(r, false);
      // Galerie, horloge, beffroi.
      r.rect(tx0 - 1, base - 52, tx1 - tx0 + 3, 1, m.trimHi);
      r.rect(tx0 - 1, base - 51, tx1 - tx0 + 3, 1, m.dark);
      this.ledges.push({ x: tx0 - 1, y: base - 52, w: tx1 - tx0 + 3 });
      for (let i = tx0 + 2; i < tx1 - 1; i += 3) r.rect(i, base - 56, 1, 4, m.trim);
      r.rect(tx0 + 1, base - 57, tx1 - tx0 - 1, 1, m.trimHi);
      const cy = base - 64;
      for (let y = -4; y <= 4; y++) {
        for (let x = -4; x <= 4; x++) {
          const d = Math.hypot(x, y);
          if (d > 4.4) continue;
          r.set(cx + x, cy + y, d > 3.4 ? C('#c8a050') : C('#f2ecd8'));
        }
      }
      r.rect(cx, cy - 3, 1, 3, C('#1e1e26'));
      r.rect(cx, cy, 2, 1, C('#1e1e26'));
      r.set(cx + 2, cy + 1, C('#1e1e26'));
      for (const ox of [-6, 2]) {
        const bx = cx + ox;
        r.rect(bx - 1, base - 86, 6, 15, m.trim);
        r.rect(bx, base - 85, 4, 14, C('#1e1e26'));
        r.rect(bx, base - 85, 1, 1, m.trim);
        r.rect(bx + 3, base - 85, 1, 1, m.trim);
        for (let y = base - 82; y < base - 71; y += 2) r.rect(bx, y, 4, 1, C('#4a4038'));
        r.rect(bx - 1, base - 71, 6, 1, m.trimHi);
        this.ledges.push({ x: bx - 1, y: base - 71, w: 6 });
      }
      // Corniche du clocher et pinacles.
      r.rect(tx0 - 2, yT, tx1 - tx0 + 5, 1, m.trimHi);
      r.rect(tx0 - 2, yT + 1, tx1 - tx0 + 5, 1, m.trim);
      r.rect(tx0 - 1, yT + 2, tx1 - tx0 + 3, 1, m.dark);
      for (const px2 of [tx0 - 1, tx1 - 1]) {
        r.rect(px2, yT - 6, 3, 6, m.base);
        r.rect(px2, yT - 6, 1, 6, m.hi);
        r.set(px2 + 1, yT - 7, m.trimHi);
        r.set(px2 + 1, yT - 8, m.trimHi);
      }
      // Flèche en ardoise, avec ses lucarnes et la croix.
      const ySp = Math.max(6, yT - 46);
      const hS = yT - ySp;
      for (let k = 0; k < hS; k++) {
        const y = yT - 1 - k;
        const half = Math.round((tw - 2) * (1 - k / hS));
        for (let x = cx - half; x <= cx + half; x++) {
          let c = hash(x, y >> 1, 12) < 0.3 ? mix(zinc, BLACK, 0.12) : zinc;
          if (x === cx - half) c = zinc2;
          if (x === cx + half) c = mix(zinc, BLACK, 0.25);
          if (lk.snow && (y + x) % 3 === 0 && x < cx) c = C('#eef2f8');
          r.set(x, y, c);
        }
      }
      const ly = yT - Math.round(hS * 0.3);
      for (let k = 0; k < 4; k++) r.rect(cx - k, ly - 4 + k, k * 2 + 1, 1, m.trim);
      r.rect(cx - 1, ly, 3, 3, C('#1e1e26'));
      r.rect(cx, ySp - 7, 1, 7, C('#c8a050'));
      r.rect(cx - 2, ySp - 5, 5, 1, C('#c8a050'));
      this.church = { x: cx, y: cy };
    }

    // Bouche de métro « Guimard » sur le trottoir d'en face, devant la pharmacie.
    paintMetro(r, b) {
      const { L } = this;
      const lk = this.look;
      const g = C('#2f5c46');
      const gh = C('#4f8a68');
      const gd = C('#1a362a');
      const mx = b.x + Math.round(b.w / 2) - 14;
      const yb = L.street0 + 4;
      // Le trou de l'escalier, vu à travers la balustrade.
      r.rect(mx + 3, yb - 6, 22, 5, C('#1a1a20'));
      for (let k = 0; k < 3; k++) r.rect(mx + 4 + k * 2, yb - 5 + k * 2, 20 - k * 4, 1, C('#4a4a52'));
      // Balustrade à volutes.
      r.rect(mx, yb - 7, 28, 1, gh);
      r.rect(mx, yb - 6, 28, 1, g);
      r.rect(mx, yb - 1, 28, 1, gd);
      for (let i = 1; i < 27; i += 3) {
        r.rect(mx + i, yb - 5, 1, 4, g);
        r.set(mx + i + 1, yb - 4, gh);
        r.set(mx + i + 1, yb - 2, g);
      }
      // Les deux candélabres en tiges de lys, et l'enseigne.
      for (const [px, dir] of [[mx, 1], [mx + 26, -1]]) {
        r.rect(px, yb - 24, 2, 24, g);
        r.rect(px, yb - 24, 1, 24, gh);
        r.set(px + dir + (dir > 0 ? 1 : 0), yb - 25, g);
        r.set(px + dir * 2 + (dir > 0 ? 1 : 0), yb - 26, g);
        const gx = px + dir * 2 + (dir > 0 ? 0 : -1);
        const globe = (t, on) => {
          t.rect(gx, yb - 31, 3, 4, on ? C('#ff8a3a') : C('#c84a22'));
          t.set(gx + 1, yb - 30, on ? C('#ffe0a0') : C('#e88a5a'));
          t.rect(gx, yb - 27, 3, 1, gd);
        };
        if (lk.lightsOn) {
          this.pushPost((t) => globe(t, true));
          this.halos.push({ x: gx + 1, y: yb - 29, r: 12, c: [255, 140, 70], k: 0.45 });
          this.lights.push({ x: gx + 1, y: yb - 28, r: 12, k: 0.45, sy: 1 });
        } else globe(r, false);
      }
      r.rect(mx + 3, yb - 24, 22, 7, gd);
      r.rect(mx + 4, yb - 23, 20, 5, C('#e8d89a'));
      X.text(r, 'METRO', mx + 5, yb - 23, C('#1f4a34'));
      r.rect(mx + 2, yb - 22, 1, 3, g);
      r.rect(mx + 25, yb - 22, 1, 3, g);
      this.ledges.push({ x: mx + 3, y: yb - 24, w: 22 }, { x: mx, y: yb - 7, w: 28 });
    }

    // Ce qui rend chaque boutique de la rue prolongée unique.
    paintShopExtra(r, b, S, dx, doorW, R) {
      const { L } = this;
      const lk = this.look;
      const st = L.shopTop;
      const iron = C('#26282e');
      switch (S.extra) {
        case 'tabac': {
          // La « carotte » rouge des bureaux de tabac, en potence au coin.
          const cx = b.x + b.w - 5;
          const cy = st - 22;
          r.rect(cx - 3, cy - 2, 5, 1, iron);
          r.rect(cx, cy - 1, 1, 1, iron);
          const rows = [1, 3, 5, 5, 5, 5, 5, 5, 5, 3, 1];
          const paintC = (t, on) => {
            rows.forEach((wd, j) => {
              for (let i = 0; i < wd; i++) {
                const x = cx - Math.floor(wd / 2) + i;
                let c = on ? C('#ff4a3a') : C('#c8282a');
                if (i === 0 && wd > 1) c = on ? C('#ff9a7a') : C('#e8604a');
                if (j === 0 || j === rows.length - 1) c = C('#1e1e24');
                t.set(x, cy + j, c);
              }
            });
            t.rect(cx, cy + 3, 1, 5, on ? C('#ffe0c0') : C('#f2d8c0'));
          };
          if (lk.lightsOn) {
            this.pushPost((t) => paintC(t, true));
            this.halos.push({ x: cx, y: cy + 5, r: 12, c: [255, 70, 50], k: 0.35 });
          } else paintC(r, false);
          this.ledges.push({ x: cx - 3, y: cy - 2, w: 5 });
          break;
        }
        case 'cinema': {
          // Marquise lumineuse au-dessus des portes.
          const mw = doorW + 18;
          const mx = dx - 9;
          const my = st + 7;
          r.rect(mx, my, mw, 10, C('#2a1a20'));
          const board = (t, on) => {
            t.rect(mx + 1, my + 2, mw - 2, 6, on ? C('#fff4d8') : C('#f2ead2'));
            X.text(t, 'CE SOIR', mx + Math.round((mw - 27) / 2), my + 2, C('#8a1e2a'));
          };
          if (lk.lightsOn) this.pushPost((t) => board(t, true));
          else board(r, false);
          for (let i = 1; i < mw - 1; i += 2) {
            this.marquee.push({ x: mx + i, y: my, i: this.marquee.length });
            this.marquee.push({ x: mx + mw - 1 - i, y: my + 9, i: this.marquee.length });
          }
          for (let i = 0; i < mw; i += 2) {
            r.set(mx + i, my, C('#e8d8a0'));
            r.set(mx + mw - 1 - i, my + 9, C('#e8d8a0'));
          }
          r.rect(mx, my + 10, mw, 1, C('#1a1014'));
          this.ledges.push({ x: mx, y: my, w: mw });
          if (lk.lightsOn) {
            this.lights.push({ x: mx + mw / 2, y: my + 12, r: 16, k: 0.7, sy: 1 });
            this.halos.push({ x: mx + mw / 2, y: my + 5, r: 22, c: [255, 220, 150], k: 0.35 });
          }
          break;
        }
        case 'terrace': {
          this.paintBistro(r, b.x + b.w - 2);
          // Ardoise du menu sur un chevalet.
          const ax = b.x + 4;
          const ay = L.street0 + 4;
          r.rect(ax, ay - 12, 1, 12, C('#6a4a2a'));
          r.rect(ax + 9, ay - 12, 1, 12, C('#6a4a2a'));
          r.rect(ax + 1, ay - 12, 8, 9, C('#2a3028'));
          X.text(r, 'MENU', ax + 1, ay - 11, C('#e8e4d8'));
          r.rect(ax + 2, ay - 5, 5, 1, C('#c8c4b8'));
          this.ledges.push({ x: ax, y: ay - 12, w: 10 });
          break;
        }
        case 'bread': {
          // Baguettes dans un panier devant la vitrine.
          const bx = b.x + b.w - 16;
          const by = L.street0 + 4;
          r.rect(bx, by - 5, 9, 5, C('#8a5a2a'));
          for (let i = 0; i < 9; i += 2) r.set(bx + i, by - 4, C('#6a4220'));
          for (let k = 0; k < 4; k++) {
            r.rect(bx + 1 + k * 2, by - 12 + (k % 2), 2, 7, C('#d89a4a'));
            r.set(bx + 1 + k * 2, by - 12 + (k % 2), C('#f0c070'));
          }
          this.ledges.push({ x: bx, y: by - 5, w: 9 });
          break;
        }
        case 'pharma': {
          // Croix verte de pharmacie en potence (elle clignote la nuit).
          const cx = b.x + 4;
          const cy = st - 18;
          r.rect(cx - 4, cy - 6, 1, 2, iron);
          r.rect(cx - 4, cy - 6, 4, 1, iron);
          const paintX = (t, col, hi) => {
            t.rect(cx - 1, cy - 4, 3, 9, col);
            t.rect(cx - 4, cy - 1, 9, 3, col);
            t.rect(cx - 1, cy - 4, 1, 9, hi);
            t.rect(cx - 4, cy - 1, 9, 1, hi);
          };
          if (lk.lightsOn) {
            paintX(r, C('#1e4a2e'), C('#2a6a3e'));
            this.crosses.push({ x: cx, y: cy });
            this.halos.push({ x: cx, y: cy, r: 11, c: [80, 255, 120], k: 0.22 });
          } else paintX(r, C('#2aa04a'), C('#6ae08a'));
          this.ledges.push({ x: cx - 4, y: cy - 4, w: 9 });
          break;
        }
        case 'fruit': {
          // Cagettes de fruits et légumes sur le trottoir.
          const y = L.street0 + 3;
          const x0 = b.x + 4;
          const fr = lk.season === 'winter' ? ['#e8a03a', '#f2d04a', '#c8382c', '#7a9a3a'] : lk.season === 'autumn' ? ['#d8602a', '#c8382c', '#e8b03a', '#6a3a6a', '#8aa03a'] : ['#c8382c', '#f2d04a', '#7aae3a', '#e87a2a', '#e84a6a'];
          for (let i = 0; i < b.w - 20; i += 7) {
            r.rect(x0 + i, y - 4, 6, 4, C('#a8784a'));
            r.rect(x0 + i, y - 4, 6, 1, C('#c8986a'));
            r.rect(x0 + i, y - 2, 6, 1, C('#7a5432'));
            const c = C(fr[Math.floor(R() * fr.length)]);
            for (let k = 0; k < 8; k++) r.set(x0 + i + Math.floor(R() * 6), y - 5 - Math.floor(R() * 2), R() < 0.25 ? mix(c, WHITE, 0.35) : c);
            this.ledges.push({ x: x0 + i, y: y - 6, w: 6 });
          }
          break;
        }
        default:
          break;
      }
    }

    // L'intérieur des boutiques de la rue prolongée (le mur du fond est déjà peint).
    paintInteriorExt(r, kind, x0, y0, x1, y1, w, h, d, lit, RR) {
      const pick = (a) => d(a[Math.floor(RR() * a.length)]);
      switch (kind) {
        case 'TABAC': {
          for (let sy = y0 + 4; sy < y1 - 4; sy += 4) {
            r.rect(x0, sy, w, 1, d('#6a4a32'));
            for (let i = x0 + 1; i < x1 - 1; i += 3) if (RR() < 0.85) r.rect(i, sy - 2, 2, 2, pick(['#e8e0d0', '#c8382c', '#3a5aa0', '#e8c547', '#2a2a30', '#5a9a5a']));
          }
          r.rect(x0, y1 - 4, w, 4, d('#5a3a28'));
          r.rect(x0, y1 - 4, w, 1, d('#8a5a3a'));
          r.rect(x0 + 2, y1 - 7, 5, 3, d('#e8e0d0'));
          break;
        }
        case 'CINEMA': {
          for (let px = x0 + 2; px + 9 <= x1 - 1; px += 12) {
            r.rect(px - 1, y0 + 1, 11, h - 4, d('#c8a050'));
            const pal = [['#1a2a5a', '#e85a4a', '#f2d06a'], ['#3a1a3a', '#ff8ab0', '#ffe0a0'], ['#1a3a2a', '#e8c547', '#e8e0d0']][Math.floor(RR() * 3)];
            r.gradient(px, y0 + 2, 9, h - 6, [d(pal[0]), d(pal[1])], 4);
            r.rect(px + 3, y0 + 4, 3, 3, d(pal[2]));
            r.rect(px + 2, y0 + h - 9, 5, 3, d('#14141c'));
            r.rect(px + 1, y0 + h - 6, 7, 1, d(pal[2]));
          }
          break;
        }
        case 'PHARMA': {
          for (let sy = y0 + 5; sy < y1 - 4; sy += 5) {
            r.rect(x0, sy, w, 1, d('#c8ccd4'));
            for (let i = x0 + 1; i < x1 - 2; i += 3) if (RR() < 0.8) r.rect(i, sy - 3, 2, 3, pick(['#ffffff', '#e8f0f4', '#3aa05a', '#5a8ad0', '#f0c8d0']));
          }
          r.rect(x0, y1 - 4, w, 4, d('#e8ecf0'));
          r.rect(x0 + Math.floor(w / 2) - 1, y0 + 1, 3, 1, d('#2aa04a'));
          r.rect(x0 + Math.floor(w / 2), y0, 1, 3, d('#2aa04a'));
          break;
        }
        case 'CHEESE': {
          for (let sy = y0 + 5; sy < y1 - 4; sy += 5) {
            r.rect(x0, sy, w, 1, d('#7a5a3a'));
            for (let i = x0 + 1; i < x1 - 4; i += 5) {
              const k = RR();
              if (k < 0.5) {
                r.rect(i, sy - 3, 4, 3, d('#f2d06a'));
                r.rect(i, sy - 3, 4, 1, d('#c8903a'));
              } else if (k < 0.8) {
                r.rect(i, sy - 2, 3, 2, d('#f4ecd8'));
                r.set(i + 2, sy - 2, d('#e8d8b0'));
              } else r.rect(i, sy - 3, 2, 3, d('#e8a03a'));
            }
          }
          r.rect(x0, y1 - 4, w, 4, d('#8a5a3a'));
          r.rect(x0, y1 - 4, w, 1, d('#d8e8f0'));
          break;
        }
        case 'ART': {
          r.gradient(x0, y0, w, h, lit ? [C('#fff6e4'), C('#f0e0c4')] : [d('#d8d4cc'), d('#b8b4ac')], 4);
          for (let px = x0 + 3; px + 8 <= x1 - 2; px += 11) {
            const ph = 6 + Math.floor(RR() * 4);
            r.rect(px - 1, y0 + 4, 9, ph + 2, d('#3a2a1a'));
            r.gradient(px, y0 + 5, 7, ph, [pick(['#3a6ab0', '#e8603a', '#2a8a6a', '#d8b03a']), pick(['#f2e2c4', '#8a3a5a', '#1a2a4a'])], 3);
            r.set(px + 2 + Math.floor(RR() * 3), y0 + 7, pick(['#ffffff', '#c8382c', '#1a1a1e']));
          }
          r.rect(x0, y1 - 2, w, 2, d('#9a948a'));
          break;
        }
        case 'FRUIT': {
          for (let sy = y0 + 5; sy < y1 - 1; sy += 5) {
            r.rect(x0, sy, w, 1, d('#7a5432'));
            for (let i = x0 + 1; i < x1 - 1; i++) if (RR() < 0.7) r.set(i, sy - 1 - (RR() < 0.4 ? 1 : 0), pick(['#c8382c', '#f2d04a', '#7aae3a', '#e87a2a', '#5a8a2a']));
          }
          break;
        }
        default:
          break;
      }
    }

    // Lampes et halos du mobilier de notre trottoir prolongé (posés avant l'éclairage, pour
    // que le trottoir et la rue en reçoivent la lumière).
    extFgLights() {
      const { L } = this;
      if (!this.look.lightsOn) return;
      for (const f of this.extFg) {
        if (f.k === 'lamp') {
          this.lights.push({ x: f.x + 1, y: L.lampY + 5, r: 24, k: 0.85, sy: 0.5 });
          this.lights.push({ x: f.x + 1, y: L.gY, r: 20, k: 0.3, sy: 2.2 });
          this.halos.push({ x: f.x + 1, y: L.lampY + 5, r: 32, c: [255, 205, 135], k: 0.55 });
        } else if (f.k === 'bus') {
          this.lights.push({ x: f.x + 15, y: L.gY - 14, r: 14, k: 0.55, sy: 1 });
          this.halos.push({ x: f.x + 15, y: L.gY - 16, r: 16, c: [190, 220, 255], k: 0.3 });
        } else if (f.k === 'kiosk') {
          this.lights.push({ x: f.x, y: L.gY - 12, r: 16, k: 0.6, sy: 1 });
          this.halos.push({ x: f.x, y: L.gY - 14, r: 18, c: [255, 210, 150], k: 0.3 });
        }
      }
    }

    // Notre trottoir prolongé : le mobilier, de l'écran vers la gauche.
    paintForegroundExt(r) {
      const { L } = this;
      const lk = this.look;
      const R = rng(909);
      for (const f of this.extFg) {
        switch (f.k) {
          case 'lamp':
            this.paintLamp(r, f.x, L.lampY);
            break;
          case 'tree':
            this.paintTree(r, f.x, L.gY + 6, 0.9 + R() * 0.12, R);
            if (lk.season === 'autumn' && !lk.snow) {
              this.leafPile(r, f.x - 14, L.gY + 7, 12, 3, R);
              this.leafPile(r, f.x + 7, L.gY + 8, 9, 3, R);
            }
            break;
          case 'bus':
            this.paintBusStop(r, f.x - 23, L.gY);
            break;
          case 'velib':
            this.paintVelib(r, f.x - 24, L.gY);
            break;
          case 'kiosk':
            this.paintKiosk(r, f.x - 13, L.gY, R);
            break;
          case 'busker': {
            const bx = f.x - 23;
            this.paintBench(r, bx, L.benchY);
            if (lk.wet) {
              // Sous la pluie, le musicien est rentré : le banc reste vide.
              this.paintBin(r, bx + 50, L.gY);
              break;
            }
            // Étui de guitare ouvert, quelques pièces.
            const cy = L.gY + 3;
            r.rect(bx + 30, cy, 15, 4, C('#3a2418'));
            r.rect(bx + 31, cy + 1, 13, 2, C('#8a2232'));
            r.set(bx + 34, cy + 1, C('#e8c547'));
            r.set(bx + 39, cy + 2, C('#d8d8e0'));
            r.set(bx + 41, cy + 1, C('#e8c547'));
            this.busker = { x: bx, y: L.benchY };
            break;
          }
          case 'bench':
            this.paintBench(r, f.x - 23, L.benchY);
            this.paintBin(r, f.x + 28, L.gY);
            break;
          case 'wallace':
            this.paintWallace(r, f.x, L.gY);
            break;
          case 'planter':
            this.paintPlanterExt(r, f.x - 7, L.gY, R);
            break;
          default:
            break;
        }
      }
      if (lk.snow) {
        // Un petit bonhomme de neige près de la fontaine Wallace.
        const w = this.extFg.find((f) => f.k === 'wallace');
        if (w) {
          const sx = w.x + 14;
          const out = { ...SNOWMAN_PAL };
          for (const k of Object.keys(out)) out[k] = '#7c88aa';
          for (let i = -1; i < 16; i++) r.set(sx - 2 + i, L.gY + 1, C('#8a96b8'));
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) stamp(r, SNOWMAN, out, sx - 2 + dx, L.gY - 22 + dy, true);
          stamp(r, SNOWMAN, SNOWMAN_PAL, sx - 2, L.gY - 22, true);
        }
      }
    }

    paintPlanterExt(r, x, gy, R) {
      const lk = this.look;
      if (!lk.snow) {
        this.paintPlanter(r, x, gy, R);
        return;
      }
      // En hiver : un petit sapin dans son bac.
      const box = C('#7a5434');
      r.rect(x, gy - 7, 15, 7, box);
      r.rect(x, gy - 7, 15, 1, C('#a07448'));
      for (let i = x + 2; i < x + 15; i += 4) r.rect(i, gy - 6, 1, 6, C('#5a3a24'));
      for (let k = 0; k < 14; k++) {
        const half = Math.floor((k % 5) * 0.9 + k * 0.25);
        r.rect(x + 7 - half, gy - 8 - (14 - k), half * 2 + 1, 1, k % 5 === 4 ? C('#1e4a2e') : C('#2e6a3e'));
      }
      r.set(x + 7, gy - 23, C('#e8c547'));
    }

    // Abribus : toit, vitre, banc, affiche éclairée, poteau d'arrêt.
    paintBusStop(r, x, gy) {
      const lk = this.look;
      const post = C('#3a3e48');
      const postHi = C('#5a606c');
      // Poteau d'arrêt avec sa plaque « BUS ».
      r.rect(x - 7, gy - 36, 1, 36, C('#8a8e98'));
      r.rect(x - 13, gy - 42, 13, 7, C('#1e3a7a'));
      r.rect(x - 13, gy - 42, 13, 1, C('#3a5aa0'));
      X.text(r, 'BUS', x - 12, gy - 41, C('#f2f2ec'));
      r.rect(x - 10, gy - 30, 6, 8, C('#e8e4d8'));
      for (let y = gy - 29; y < gy - 23; y += 2) r.rect(x - 9, y, 4, 1, C('#8a8e98'));
      this.ledges.push({ x: x - 13, y: gy - 42, w: 13 });
      // Vitre du fond (on voit la rue à travers).
      for (let y = gy - 29; y < gy - 2; y++) for (let i = 1; i < 30; i++) r.set(x + i, y, (i + y) % 11 === 0 ? C('#e8f4fc') : C('#a8c8dc'), (i + y) % 11 === 0 ? 150 : 70);
      r.rect(x + 1, gy - 16, 29, 1, C('#5a606c'));
      // Banc.
      r.rect(x + 4, gy - 10, 22, 2, C('#9a6a42'));
      r.rect(x + 4, gy - 10, 22, 1, C('#c08a58'));
      r.rect(x + 6, gy - 8, 1, 6, post);
      r.rect(x + 23, gy - 8, 1, 6, post);
      // Affiche (côté droit).
      const ax = x + 30;
      r.rect(ax, gy - 30, 15, 28, post);
      const poster = (t, on) => {
        t.gradient(ax + 1, gy - 29, 13, 22, on ? [C('#7ac8f0'), C('#fff0c8')] : [C('#4a8ab0'), C('#e8d8b0')], 4);
        for (let y = -3; y <= 3; y++) for (let i = -3; i <= 3; i++) if (i * i + y * y <= 10) t.set(ax + 7 + i, gy - 22 + y, on ? C('#ffd84a') : C('#e8b83a'));
        for (let i = 0; i < 13; i++) t.set(ax + 1 + i, gy - 13 - Math.round(Math.abs(i - 6) * 0.5), on ? C('#3a7a5a') : C('#2a5a44'));
        t.rect(ax + 1, gy - 12, 13, 5, on ? C('#3a7a5a') : C('#2a5a44'));
        X.text(t, 'EXPO', ax + 1, gy - 12, on ? C('#ffffff') : C('#e8e4d8'));
      };
      if (lk.lightsOn) this.pushPost((t) => poster(t, true));
      else poster(r, false);
      // Montants et toit.
      r.rect(x, gy - 31, 2, 31, post);
      r.rect(x, gy - 31, 1, 31, postHi);
      r.rect(x - 2, gy - 34, 50, 3, C('#2a2e36'));
      r.rect(x - 2, gy - 34, 50, 1, C('#6a707c'));
      r.rect(x - 2, gy - 31, 50, 1, C('#1a1c22'));
      r.rect(x - 1, gy, 48, 1, C('#5a5650'));
      this.ledges.push({ x: x - 2, y: gy - 34, w: 50 });
      this.busStop = { x: x + 14, y: gy - 2 };
    }

    // Station de vélos en libre-service : trois vélos à leurs bornes, et la borne de location.
    paintVelib(r, x, gy) {
      const pal = { ...BIKE_PAL, f: '#8a9aa4', g: '#5a6a74', S: '#2a2a30' };
      for (let i = 0; i < 3; i++) {
        const bx = x + i * 16;
        stamp(r, bikeRows(1 + i, false), pal, bx, gy - 17);
        r.rect(bx + 15, gy - 12, 4, 3, C('#3a3a44'));
        r.rect(bx + 15, gy - 12, 4, 1, C('#5a5a64'));
        r.rect(bx + 19, gy - 9, 2, 9, C('#6a7480'));
        r.set(bx + 19, gy - 8, C('#6aff8a'));
      }
      r.rect(x - 8, gy - 22, 5, 22, C('#4a525c'));
      r.rect(x - 8, gy - 22, 1, 22, C('#6a727c'));
      r.rect(x - 7, gy - 19, 3, 4, C('#7ac0e8'));
      r.rect(x - 7, gy - 12, 3, 2, C('#c8ccd4'));
      r.rect(x - 9, gy - 23, 7, 1, C('#2a2e36'));
      r.rect(x - 4, gy, 52, 1, C('#5a5650'));
      this.ledges.push({ x: x - 9, y: gy - 23, w: 7 });
    }

    // Kiosque à journaux parisien : dôme, frise « PRESSE », magazines en vitrine.
    paintKiosk(r, x, gy, R) {
      const lk = this.look;
      const g = C('#2e5a42');
      const gh = C('#4a7e60');
      const gd = C('#1c3a2c');
      r.rect(x, gy - 24, 26, 24, g);
      r.rect(x, gy - 24, 1, 24, gh);
      r.rect(x + 25, gy - 24, 1, 24, gd);
      r.rect(x, gy - 2, 26, 2, gd);
      // Affiches sur les montants.
      r.rect(x + 1, gy - 22, 2, 16, C('#c8463c'));
      r.rect(x + 23, gy - 22, 2, 16, C('#3a6ab0'));
      // Vitrine de magazines.
      const mags = [];
      for (let row = 0; row < 3; row++) for (let k = 0; k < 5; k++) mags.push([x + 4 + k * 4, gy - 21 + row * 5, ['#e8c547', '#c8382c', '#3a6ab0', '#e8e0d0', '#5a9a5a', '#e26a8e', '#2a2a30'][Math.floor(R() * 7)]]);
      const shop = (t, on) => {
        t.rect(x + 3, gy - 22, 20, 16, on ? C('#ffe4b0') : C('#2a2a30'));
        for (const [mx, my, c] of mags) {
          t.rect(mx, my, 3, 4, on ? C(c) : mix(C(c), C('#2a2a30'), 0.35));
          t.rect(mx, my, 3, 1, on ? C('#ffffff') : C('#c8c4bc'));
        }
      };
      if (lk.lightsOn) this.pushPost((t) => shop(t, true));
      else shop(r, false);
      r.rect(x + 2, gy - 6, 22, 2, C('#c8b890'));
      r.rect(x + 4, gy - 8, 7, 2, C('#f2eee4'));
      r.rect(x + 4, gy - 7, 7, 1, C('#a8a49c'));
      r.rect(x + 14, gy - 8, 8, 2, C('#f2eee4'));
      // Frise et dôme.
      r.rect(x - 1, gy - 30, 28, 6, gd);
      X.text(r, 'PRESSE', x + 2, gy - 29, C('#e8dcc0'));
      r.rect(x - 2, gy - 31, 30, 1, gh);
      for (let i = 0; i < 30; i += 2) r.set(x - 2 + i, gy - 24, gd);
      for (let k = 0; k < 7; k++) {
        const half = Math.round(Math.sqrt(1 - (k / 7) ** 2) * 14);
        r.rect(x + 13 - half, gy - 32 - k, half * 2, 1, k % 2 ? g : gh);
        r.set(x + 13 - half, gy - 32 - k, gh);
      }
      r.rect(x + 12, gy - 41, 2, 2, gd);
      r.set(x + 12, gy - 42, C('#c8a050'));
      this.ledges.push({ x: x - 2, y: gy - 31, w: 30 });
    }

    // Fontaine Wallace : socle, quatre cariatides, petit dôme en fonte verte.
    paintWallace(r, cx, gy) {
      const lk = this.look;
      const g = C('#2c5a40');
      const gh = C('#4e8a66');
      const gd = C('#183626');
      r.rect(cx - 7, gy - 1, 15, 1, gd);
      r.rect(cx - 6, gy - 5, 13, 4, g);
      r.rect(cx - 6, gy - 5, 13, 1, gh);
      r.rect(cx - 6, gy - 5, 1, 4, gh);
      r.rect(cx + 6, gy - 5, 1, 4, gd);
      r.rect(cx - 4, gy - 11, 9, 6, g);
      r.rect(cx - 4, gy - 11, 1, 6, gh);
      r.rect(cx + 4, gy - 11, 1, 6, gd);
      r.rect(cx - 5, gy - 12, 11, 1, gh);
      // Cariatides (trois visibles).
      for (const ox of [-4, -1, 2]) {
        const fx = cx + ox;
        r.rect(fx, gy - 25, 2, 2, g);
        r.rect(fx, gy - 23, 2, 5, g);
        r.rect(fx - (ox < 0 ? 0 : 0), gy - 18, 3, 6, g);
        r.set(fx, gy - 25, gh);
        r.rect(fx, gy - 23, 1, 11, gh);
        r.set(fx + 2, gy - 13, gd);
      }
      if (!lk.snow) {
        for (let y = gy - 23; y < gy - 12; y++) if (y % 3) r.set(cx + 1, y, C('#b8d8f0'), 200);
        this.fountains.push({ kind: 'wallace', x: cx + 1, y0: gy - 23, y1: gy - 12 });
      }
      // Dôme et ses dauphins (une frise), puis la pointe.
      const rows = [13, 13, 11, 9, 7, 5, 3];
      rows.forEach((w, k) => {
        const y = gy - 26 - k;
        r.rect(cx - Math.floor(w / 2), y, w, 1, k === 0 ? gd : k % 2 ? g : gh);
        r.set(cx - Math.floor(w / 2), y, gh);
      });
      for (let i = -6; i <= 6; i += 2) r.set(cx + i, gy - 25, gd);
      r.rect(cx, gy - 35, 1, 2, gd);
      r.set(cx, gy - 36, gh);
      this.ledges.push({ x: cx - 6, y: gy - 26, w: 13 });
    }

    /* ================= Vie de la scène ================= */
    configureLife() {
      const lk = this.look;
      const { W, H, L } = this;
      // Teinte des personnages selon la lumière.
      const tint = lk.night ? ['18,22,58', 0.32] : lk.tod === 'dusk' ? ['70,30,40', 0.2] : lk.tod === 'sunset' ? ['70,30,70', 0.2] : lk.overcast ? ['60,70,90', 0.12] : ['0,0,0', 0];
      const [tc, ta] = tint;
      const tintFn = PP.tint(tc, ta);
      this.crowd.restyle({ season: lk.season, wet: lk.wet, bake: tintFn, seed: 3 + this.variant.length });
      this.crowd.o.mix = lk.wet ? { umbrella: 0.7, kid: 0.15, dog: 0.15 } : { umbrella: 0.6, kid: 0.17, dog: 0.23 };
      const cars = this.base.cars.map((c) => ({ ...c, right: shade(c.right, tc, ta * 0.6), left: shade(c.left, tc, ta * 0.6) }));
      for (const tr of [this.trafficFar, this.trafficNear]) {
        tr.cars = cars;
        tr.o.headlights = lk.lightsOn || lk.overcast;
        tr.car = null;
      }
      this.bikes = this.makeBikes(lk, tintFn, tc, ta);
      const cat = {};
      for (const k of Object.keys(this.base.cat)) cat[k] = this.base.cat[k].map((f) => shade(f, tc, ta));
      this.catS = cat;
      const pg = {};
      for (const k of Object.keys(this.base.pigeon)) pg[k] = shade(this.base.pigeon[k], tc, ta);
      this.pigeonS = pg;
      this.pigeonFly = X.birdSprites('#6a6e7c');
      // Lecteur du banc : écharpe en hiver, parapluie sous la pluie ; un liseré de lumière
      // du ciel (ou du lampadaire la nuit) sur le haut de la silhouette.
      const cold = lk.season === 'winter' || lk.season === 'autumn';
      const sitLook = {
        seed: 21, body: 'm', skin: '#e0aa88', hairColor: '#3a2420', hairStyle: 'messy',
        top: lk.season === 'summer' ? '#e8d8b8' : '#4a6a8a', topStyle: cold ? 'coat' : 'sweater',
        bottom: '#2a2a3a', shoes: '#3a2a24', scarf: cold ? '#c8463c' : null,
        hat: lk.season === 'winter' ? { color: '#c8463c', band: '#e8e0d0', pom: true } : null,
        props: { book: '#b8483c', umb: '#3f8fb0', umb2: '#2a6078' },
      };
      const rim = lk.night ? { color: '#9ab4ff', dir: [0, -1], k: 0.28 } : lk.tod === 'day' ? null : { color: '#ffb0a0', dir: [0, -1], k: 0.3 };
      this.sitS = PP.bake(PP.heroes.bench(sitLook, { hh: 7.5, umbrella: lk.wet, seatH: 1.15, rim }), tintFn);
      this.mugS = shade(this.base.mug, tc, ta);
      this.flock.o.color = lk.tod === 'day' ? '#3a3440' : '#2a1a30';
      this.flock.frames = X.birdSprites(this.flock.o.color);
      this.smoke.color = lk.night ? '120,124,150' : lk.tod === 'day' ? '230,230,236' : '200,170,170';
      // Fenêtres allumées au départ.
      const pLit = lk.night ? 0.5 : lk.tod === 'dusk' ? 0.4 : lk.tod === 'sunset' ? 0.3 : 0;
      const nv = this.nVpWin;
      const RW = rng(2024);
      this.windows.forEach((w, i) => {
        w.lit = i < nv ? Math.random() < pLit : RW() < pLit;
      });
      const lits = this.windows.slice(0, nv).filter((w) => w.lit && w.h > 8);
      this.tvWin = lits.length ? lits[Math.floor(Math.random() * lits.length)] : null;
      this.silWin = lits.length > 1 ? lits.find((w) => w !== this.tvWin) : null;
      this.sil = { x: 0, dir: 1 };
      // Météo propre à la scène, seulement sans effet (pas de double météo).
      this.fx = null;
      const fx = lk.fx;
      const { wx0, wx1 } = this;
      const span = wx1 - wx0; // = W sans monde élargi
      if (fx === 'rain') this.fx = new X.RainFx({ x0: wx0, x1: wx1, y0: 0, y1: H, groundY0: L.s0, count: Math.round(span * 0.35) });
      else if (fx === 'snow') this.fx = new X.Drift({ x0: wx0, x1: wx1, y0: 0, y1: H, count: Math.round(span * 0.18), colors: ['#ffffff', '#dfe6f5', '#c8d4ea'], fall: [7, 15], sway: 6 });
      else if (fx === 'petals') this.fx = new X.Drift({ x0: wx0, x1: wx1, y0: 0, y1: H, count: Math.round(span * 0.09), colors: ['#ffc0d4', '#ff9fbf', '#ffe0ea'], size: 2, fall: [6, 12], sway: 12 });
      else if (fx === 'leaves') this.fx = new X.Drift({ x0: wx0, x1: wx1, y0: 0, y1: H, count: Math.round(span * 0.07), colors: ['#e8702a', '#c8401e', '#f0a830', '#9a4a1a'], size: 2, fall: [10, 18], sway: 10 });
      for (const p of this.pigeons) {
        if (p.state === 'fly' || p.state === 'gone' || p.state === 'land') {
          p.state = 'peck';
          p.y = 0;
        }
      }
      if (this.extL || this.extR) this.configureExtLife(tintFn, rim);
    }

    // La vie de la rue prolongée : passants déjà en route partout, une voiture sur chaque
    // file, un cycliste, le musicien, quelqu'un qui attend le bus, d'autres pigeons.
    configureExtLife(tintFn, rim) {
      const lk = this.look;
      const { wx0, wx1 } = this;
      const span = wx1 - wx0;
      for (let k = Math.round(span / 70); k > 0; k--) {
        this.crowd.spawn();
        const w = this.crowd.list[this.crowd.list.length - 1];
        w.x = wx0 + Math.random() * span;
      }
      const place = (tr, x, dir) => {
        tr.car = { dir, x, set: tr.cars[Math.floor(Math.random() * tr.cars.length)], v: 50 + Math.random() * 30 };
      };
      place(this.trafficNear, -this.extL * 0.45 - 40, 1);
      place(this.trafficFar, -this.extL * 0.05, -1);
      this.cyclist = { dir: 1, x: -this.extL * 0.32, v: 26 + Math.random() * 6, t: 0, set: this.bikes[Math.floor(Math.random() * this.bikes.length)] };
      // Le musicien de rue, sur son banc.
      if (this.busker) {
        const look = { seed: 12, body: 'm', skin: '#c88a64', hairColor: '#2a1a14', hairStyle: 'messy', top: lk.season === 'summer' ? '#c8463c' : '#3e5a7a', topStyle: lk.season === 'winter' ? 'coat' : 'jacket', trim: '#d8c8a8', bottom: '#3a3a4c', shoes: '#18141a', scarf: lk.season === 'winter' || lk.season === 'autumn' ? '#d8a640' : null, hat: lk.season === 'winter' ? { color: '#3a3a44', band: '#e8e0d0', pom: true } : null, props: { guitar: '#e0a050', guitarDk: '#4a2410', fret: '#2a1810' } };
        this.buskerS = PP.bake(PP.heroes.guitarist(look, { hh: 7.5, seatH: 1.15, rim }), tintFn);
        this.notes = new X.Notes();
        this.strum = { t: 0, beat: 0 };
      }
      // Quelqu'un qui attend le bus.
      if (this.busStop) {
        const look = { ...PP.randomLook(77, { season: lk.season }), bag: true, bagColor: '#7a4a2a' };
        this.waitS = PP.bake(PP.sheet(look, { idle: [PP.stand({ turn: -0.2 }), PP.stand({ turn: -0.2, sway: 0.6 })], look: PP.stand({ turn: 0.7 }) }, { hh: 5.6, view: 0.9, rim }), tintFn);
      }
      // Pigeons de la fontaine Wallace (pas la nuit ni sous la pluie).
      const wf = this.extFg.find((f) => f.k === 'wallace');
      this.extPigeons = [];
      if (wf) this.extPigeons = [0, 1].map((i) => ({ x: wf.x - 18 + i * 9, y: 0, dir: i ? -1 : 1, state: 'peck', timer: Math.random() * 2, t: Math.random(), gx0: wf.x - 30, gx1: wf.x - 4 }));
    }

    update(dt, ctx) {
      const eff = (ctx && ctx.effect) || 'none';
      if (!this.bg || eff !== this.effect) this.build(eff);
      const lk = this.look;
      const { W, L } = this;
      this.t += dt;
      const t = this.t;
      this.crowd.update(dt);
      this.trafficFar.update(dt);
      this.trafficNear.update(dt);
      if (lk.birds) this.flock.update(dt);

      // Cycliste.
      this.nextBike -= dt;
      if (!this.cyclist && this.nextBike <= 0) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        this.cyclist = { dir, x: dir > 0 ? this.wx0 - 24 : this.wx1 + 4, v: 24 + Math.random() * 10, t: 0, set: this.bikes[Math.floor(Math.random() * this.bikes.length)] };
        this.nextBike = 10 + Math.random() * 14;
      }
      if (this.cyclist) {
        const c = this.cyclist;
        c.x += c.dir * c.v * dt;
        c.t += dt;
        if (c.x < this.wx0 - 30 || c.x > this.wx1 + 10) this.cyclist = null;
      }

      // Fumée des cheminées, vapeur de la plaque d'égout.
      const cold = lk.season === 'winter' || lk.night || lk.wet;
      for (const ch of this.chimneys) if (Math.random() < dt * (cold ? 3 : 1.2)) this.smoke.emit(ch.x + Math.random() * 2, ch.y, 3.2, 5);
      this.smoke.update(dt);
      if (this.manhole && Math.random() < dt * (cold ? 9 : 3)) this.steam.emit(this.manhole.x - 3 + Math.random() * 7, this.manhole.y - 1, 2.2, 7);
      for (const m of this.extExtras) if (m.k === 'manhole' && Math.random() < dt * (cold ? 9 : 3)) this.steam.emit(m.x - 3 + Math.random() * 7, m.y - 1, 2.2, 7);
      this.steam.update(dt);
      if ((lk.season === 'winter' || lk.season === 'autumn') && !lk.wet && Math.random() < dt * 3) this.cupSteam.emit(L.benchX + 36 + Math.random() * 2, L.benchY - 8, 1.6, 6);
      this.cupSteam.update(dt);

      // Fenêtres d'en face qui s'allument et s'éteignent.
      if (lk.lightsOn) {
        this.nextToggle -= dt;
        if (this.nextToggle <= 0) {
          const w = this.windows[Math.floor(Math.random() * this.windows.length)];
          if (w && w !== this.tvWin && w !== this.silWin) w.lit = !w.lit;
          this.nextToggle = 1.5 + Math.random() * 4;
        }
      }
      this.sil.x += this.sil.dir * dt * 1.4;
      if (this.sil.x > 4 || this.sil.x < 0) this.sil.dir *= -1;
      // Néons qui grésillent.
      for (const s of this.signs) {
        s.next -= dt;
        if (s.flick > 0) {
          s.flick -= dt;
          s.on1 = Math.sin(t * 47 + s.x) > -0.2;
          if (s.flick <= 0) s.on1 = true;
        } else if (s.next <= 0) {
          s.flick = 0.4 + Math.random() * 0.8;
          s.next = 5 + Math.random() * 14;
        }
      }
      // Commerçants derrière leurs vitrines.
      for (const k of this.keepers) {
        if (k.wait > 0) {
          k.wait -= dt;
          continue;
        }
        k.x += k.dir * dt * 4;
        if (k.x > k.x1 || k.x < k.x0) {
          k.dir *= -1;
          k.x = Math.max(k.x0, Math.min(k.x1, k.x));
          k.wait = 1 + Math.random() * 3;
        } else if (Math.random() < dt * 0.15) k.wait = 1 + Math.random() * 2;
      }

      // Lecteur du banc.
      const s = this.sitter;
      if (t > s.until) s.pose = 'read';
      s.nextPage -= dt;
      s.nextLook -= dt;
      if (s.pose === 'read' && s.nextPage <= 0) {
        s.pose = 'page';
        s.until = t + 0.45;
        s.nextPage = 5 + Math.random() * 6;
      } else if (s.pose === 'read' && s.nextLook <= 0) {
        s.pose = 'look';
        s.until = t + 2.4;
        s.nextLook = 12 + Math.random() * 10;
      }

      this.updateCat(dt);
      this.updatePigeons(dt);

      // Avion qui traverse le ciel.
      this.nextPlane -= dt;
      if (!this.plane && this.nextPlane <= 0) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        this.plane = { dir, x: dir > 0 ? this.wx0 - 8 : this.wx1 + 8, y: 6 + Math.floor(Math.random() * 14), v: 9 + Math.random() * 4 };
        this.nextPlane = 30 + Math.random() * 40;
      }
      if (this.plane) {
        this.plane.x += this.plane.dir * this.plane.v * dt;
        if (this.plane.x < this.wx0 - 12 || this.plane.x > this.wx1 + 12) this.plane = null;
      }
      if (this.notes) this.updateExtLife(dt);

      // Orage : éclairs.
      if (lk.storm) {
        this.nextBolt -= dt;
        if (this.nextBolt <= 0) {
          this.flash = 1;
          this.nextBolt = 6 + Math.random() * 10;
          const pts = [];
          let x = Math.round(W * (0.1 + Math.random() * 0.8));
          for (let y = 0; y < L.street0 * 0.6; y += 3) {
            pts.push([x, y]);
            x += Math.round((Math.random() - 0.5) * 6);
          }
          this.bolt = pts;
        }
        if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.6);
      } else this.flash = 0;

      if (this.fx) {
        if (this.fx instanceof X.RainFx) this.fx.update(dt);
        else this.fx.update(dt, t);
      }
    }

    // Le musicien gratte sa guitare (des notes s'envolent), le voyageur de l'abribus attend.
    updateExtLife(dt) {
      const s = this.strum;
      s.t += dt;
      if (s.t > 0.28) {
        s.t = 0;
        s.beat++;
      }
      const b = this.busker;
      if (b && Math.random() < dt * 0.6) this.notes.emit(b.x + 8 + Math.random() * 10, b.y - 30);
      this.notes.update(dt);
    }

    // Le chat sur la corniche au-dessus des boutiques : dort, s'assoit, fait sa toilette, se promène.
    updateCat(dt) {
      const c = this.cat;
      const { W } = this;
      c.timer -= dt;
      c.frameT += dt;
      if (c.state === 'walk') {
        c.x += c.dir * 9 * dt;
        if ((c.dir < 0 && c.x <= c.target) || (c.dir > 0 && c.x >= c.target)) {
          c.state = 'sit';
          c.timer = 2 + Math.random() * 3;
          c.next = 'sleep';
        }
        return;
      }
      if (c.timer > 0) return;
      if (c.state === 'sleep') {
        c.state = 'sit';
        c.timer = 3 + Math.random() * 3;
        c.next = 'lick';
      } else if (c.state === 'sit' && c.next === 'lick') {
        c.state = 'lick';
        c.timer = 2.5;
      } else if (c.state === 'lick') {
        c.state = 'sit';
        c.timer = 1.5;
        c.next = 'walk';
      } else if (c.state === 'sit' && c.next === 'walk') {
        const minX = 10;
        const maxX = W - 30;
        c.target = Math.round(minX + Math.random() * (maxX - minX));
        if (Math.abs(c.target - c.x) < 40) c.target = c.x > (minX + maxX) / 2 ? c.x - 60 : c.x + 60;
        c.target = Math.max(minX, Math.min(maxX, c.target));
        c.dir = c.target < c.x ? -1 : 1;
        c.state = 'walk';
      } else {
        c.state = 'sleep';
        c.timer = 14 + Math.random() * 16;
      }
    }

    // Pigeons qui picorent sur notre trottoir et s'envolent quand un passant approche.
    updatePigeons(dt) {
      if (!this.look.pigeons) return;
      const { W } = this;
      this.updatePigeonList(dt, this.pigeons, Math.round(W * 0.47), Math.round(W * 0.63));
      if (this.extPigeons) for (const p of this.extPigeons) this.updatePigeonList(dt, [p], p.gx0, p.gx1);
    }

    updatePigeonList(dt, list, gx0, gx1) {
      for (const p of list) {
        p.t += dt;
        if (p.state === 'fly') {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vy -= dt * 6;
          if (p.y < -60 || p.x < this.wx0 - 20 || p.x > this.wx1 + 20) {
            p.state = 'gone';
            p.timer = 10 + Math.random() * 14;
          }
          continue;
        }
        if (p.state === 'gone') {
          p.timer -= dt;
          if (p.timer <= 0) {
            p.state = 'land';
            p.tx = gx0 + Math.random() * (gx1 - gx0);
            p.dir = Math.random() < 0.5 ? -1 : 1;
            p.x = p.tx - p.dir * 70;
            p.y = -70;
          }
          continue;
        }
        if (p.state === 'land') {
          const dx = p.tx - p.x;
          const dy = -p.y;
          const d = Math.hypot(dx, dy);
          if (d < 2) {
            p.state = 'stand';
            p.y = 0;
            p.timer = 1;
          } else {
            p.x += (dx / d) * 34 * dt;
            p.y += (dy / d) * 34 * dt;
          }
          continue;
        }
        // Au sol.
        for (const w of this.crowd.list) {
          if (Math.abs(w.x + w.set.w / 2 - p.x) < 14) {
            p.state = 'fly';
            p.vx = (p.x < w.x + w.set.w / 2 ? -1 : 1) * (28 + Math.random() * 14);
            p.vy = -24 - Math.random() * 10;
            p.dir = p.vx > 0 ? 1 : -1;
            break;
          }
        }
        if (p.state === 'fly') continue;
        p.timer -= dt;
        if (p.state === 'walk') {
          p.x += p.dir * 5 * dt;
          if (p.x < gx0 || p.x > gx1) p.dir *= -1;
        }
        if (p.timer <= 0) {
          const r = Math.random();
          if (r < 0.45) {
            p.state = 'peck';
            p.timer = 0.6 + Math.random() * 1.2;
          } else if (r < 0.75) {
            p.state = 'walk';
            p.timer = 0.8 + Math.random() * 1.2;
            if (Math.random() < 0.4) p.dir *= -1;
          } else {
            p.state = 'stand';
            p.timer = 1 + Math.random() * 2;
          }
        }
      }
    }

    /* ================= Dessin d'une image ================= */
    draw(g) {
      if (!this.bg) this.build(this.effect || 'none');
      const { W, H, L } = this;
      const lk = this.look;
      const t = this.t;
      g.imageSmoothingEnabled = false;
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      const ox = this.extL; // monde élargi : les toiles commencent à x = −extL
      g.drawImage(this.bg, -ox, 0);

      // ----- Ciel : étoiles qui scintillent, feu de l'antenne, avion, éclair -----
      const inSky = (x, y) => x >= this.wx0 && x < this.wx1 && y < this.skyTop[x + ox];
      for (const s of this.stars) {
        const k = Math.sin(t * s.s + s.p);
        if (k > 0.7 && inSky(s.x, s.y)) {
          g.fillStyle = `rgba(255,252,235,${(k - 0.7) * 2.5})`;
          g.fillRect(s.x, s.y, 1, 1);
        } else if (k < -0.8 && inSky(s.x, s.y)) {
          g.fillStyle = 'rgba(10,14,40,0.6)';
          g.fillRect(s.x, s.y, 1, 1);
        }
      }
      if (this.tower && inSky(this.tower.x, this.tower.y) && Math.sin(t * 2.2) > 0.4) {
        g.fillStyle = '#ff3a3a';
        g.fillRect(this.tower.x, this.tower.y, 1, 1);
        g.fillStyle = 'rgba(255,60,60,0.25)';
        g.fillRect(this.tower.x - 1, this.tower.y - 1, 3, 3);
      }
      if (this.plane) {
        const p = this.plane;
        const x = Math.round(p.x);
        if (lk.lightsOn) {
          if (inSky(x, p.y)) {
            g.fillStyle = '#f4f4ff';
            g.fillRect(x, p.y, 1, 1);
          }
          if (Math.sin(t * 7) > 0.3 && inSky(x - p.dir * 3, p.y)) {
            g.fillStyle = '#ff4a4a';
            g.fillRect(x - p.dir * 3, p.y, 1, 1);
          }
        } else {
          g.fillStyle = 'rgba(90,96,120,0.8)';
          for (let i = -3; i <= 3; i++) if (inSky(x + i, p.y)) g.fillRect(x + i, p.y, 1, 1);
          if (inSky(x, p.y - 1)) g.fillRect(x - p.dir, p.y - 1, 2, 1);
          if (inSky(x, p.y + 1)) g.fillRect(x - p.dir, p.y + 1, 1, 1);
        }
      }
      if (this.bolt && this.flash > 0.55) {
        g.fillStyle = '#f4f6ff';
        for (let i = 0; i < this.bolt.length - 1; i++) {
          const [x0, y0] = this.bolt[i];
          const [x1, y1] = this.bolt[i + 1];
          for (let k = 0; k <= 3; k++) {
            const x = Math.round(x0 + ((x1 - x0) * k) / 3);
            const y = Math.round(y0 + ((y1 - y0) * k) / 3);
            if (inSky(x, y)) g.fillRect(x, y, 1, 1);
          }
        }
      }

      // ----- Façades : fenêtres allumées, silhouettes, télé -----
      if (lk.lightsOn) {
        for (const w of this.windows) if (w.lit) g.drawImage(this.litCv, w.x + ox, w.y, w.w, w.h, w.x, w.y, w.w, w.h);
        const sw = this.silWin;
        if (sw && sw.lit) {
          g.fillStyle = 'rgba(46,26,30,0.85)';
          const sx = Math.round(sw.x + 1 + this.sil.x * 0.5);
          g.fillRect(sx, sw.y + 4, 3, sw.h - 4);
          g.fillRect(sx + 1, sw.y + 2, 2, 2);
        }
        const tv = this.tvWin;
        if (tv && tv.lit) {
          g.globalCompositeOperation = 'lighter';
          const k = 0.15 + 0.15 * Math.abs(Math.sin(t * 3.1) * Math.sin(t * 7.7 + 1));
          g.fillStyle = `rgba(90,140,255,${k})`;
          g.fillRect(tv.x, tv.y, tv.w, tv.h);
          g.globalCompositeOperation = 'source-over';
        }
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = 'rgba(255,180,100,0.07)';
        for (const w of this.windows) if (w.lit) g.fillRect(w.x - 2, w.y - 1, w.w + 4, w.h + 4);
        g.globalCompositeOperation = 'source-over';
      }

      // Commerçants derrière les vitrines.
      for (const k of this.keepers) {
        const x = Math.round(k.x);
        g.fillStyle = lk.lightsOn ? 'rgba(70,40,34,0.8)' : 'rgba(40,30,30,0.55)';
        g.fillRect(x + 1, k.y1 - 7, 2, 2);
        g.fillRect(x, k.y1 - 5, 4, 5);
      }

      // Enseignes au néon.
      if (lk.lightsOn) {
        for (const s of this.signs) {
          g.drawImage(s.on1 ? s.on : s.off, s.x, s.y);
          if (!s.on1) continue;
          g.globalCompositeOperation = 'lighter';
          g.fillStyle = `rgba(${rgbStr(s.col)},${s.small ? 0.12 : 0.16})`;
          g.fillRect(s.x - 2, s.y - 2, s.w + 4, s.h + 4);
          g.fillStyle = `rgba(${rgbStr(s.col)},0.08)`;
          g.fillRect(s.x - 4, s.y - 3, s.w + 8, s.h + 6);
          if (lk.wet && !s.small) {
            const ry = L.s0 + 1 + Math.round((L.street0 - s.y) * 0.25);
            const n = Math.min(8, Math.ceil(s.h / 3) + 2);
            g.fillStyle = `rgba(${rgbStr(s.col)},0.14)`;
            for (let i = 0; i < n; i++) if (ry + i * 2 < L.s1) g.fillRect(s.x + Math.round(Math.sin(t * 2 + i) * 1), ry + i * 2, s.w, 1);
          }
          g.globalCompositeOperation = 'source-over';
        }
        // Guirlandes.
        for (const b of this.bulbs) {
          const k = 0.55 + 0.45 * Math.sin(t * 1.6 + b.p);
          const c = C(b.c);
          g.fillStyle = `rgb(${rgbStr(c.map((v) => v * k))})`;
          g.fillRect(b.x, b.y, 1, 1);
        }
        // Lanternes rouges du ramen, qui se balancent.
        for (const ln of this.lanterns) {
          const dx = Math.round(Math.sin(t * 1.3 + ln.p) * 0.8);
          g.fillStyle = '#1a1010';
          g.fillRect(ln.x + 1, ln.y, 1, 2);
          g.fillStyle = '#e83a2a';
          g.fillRect(ln.x + dx, ln.y + 2, 3, 4);
          g.fillStyle = '#ff8a5a';
          g.fillRect(ln.x + dx + 1, ln.y + 3, 1, 2);
          g.fillStyle = '#1a1010';
          g.fillRect(ln.x + dx, ln.y + 6, 3, 1);
          g.globalCompositeOperation = 'lighter';
          g.fillStyle = 'rgba(255,80,50,0.18)';
          g.fillRect(ln.x + dx - 2, ln.y + 1, 7, 7);
          g.globalCompositeOperation = 'source-over';
        }
      } else {
        for (const ln of this.lanterns) {
          const dx = Math.round(Math.sin(t * 1.3 + ln.p) * 0.8);
          g.fillStyle = '#1a1010';
          g.fillRect(ln.x + 1, ln.y, 1, 2);
          g.fillStyle = '#c83a2a';
          g.fillRect(ln.x + dx, ln.y + 2, 3, 4);
          g.fillStyle = '#1a1010';
          g.fillRect(ln.x + dx, ln.y + 6, 3, 1);
        }
      }

      if (this.extL || this.extR) this.drawExtFar(g);

      // Le chat sur la corniche.
      this.drawCat(g);

      // Fumée des cheminées, oiseaux.
      this.smoke.draw(g, lk.night ? 0.4 : 0.5);
      if (lk.birds) this.flock.draw(g);

      // ----- Rue -----
      this.drawCar(g, this.trafficFar);
      this.drawCar(g, this.trafficNear);
      if (this.cyclist) {
        const c = this.cyclist;
        const frames = c.dir > 0 ? c.set.right : c.set.left;
        const img = frames[Math.floor(c.t / 0.12) % frames.length];
        const off = c.dir > 0 ? c.set.rightD : c.set.leftD;
        g.drawImage(img, Math.round(c.x) + off[0], L.bikeY - 17 + off[1]);
        if (lk.lightsOn) {
          g.fillStyle = '#fff4c8';
          g.fillRect(Math.round(c.x) + (c.dir > 0 ? 18 : 2), L.bikeY - 10, 1, 1);
          g.fillStyle = '#ff3a3a';
          g.fillRect(Math.round(c.x) + (c.dir > 0 ? 1 : 19), L.bikeY - 9, 1, 1);
        }
      }
      this.steam.draw(g, cold(lk) ? 0.38 : 0.22);

      // ----- Notre trottoir -----
      this.crowd.draw(g);
      g.drawImage(this.fg, -ox, 0);
      // Le lecteur du banc.
      const S = this.sitS;
      const pose = this.sitter.pose;
      let img = S.frames[pose] || S.frames.read;
      if (Array.isArray(img)) img = img[Math.floor(t / 1.6) % img.length]; // respiration
      g.drawImage(img, L.benchX + 15 - S.ax, L.benchY - 2 - S.ay);
      if (!lk.wet) g.drawImage(this.mugS, L.benchX + 34, L.benchY - 7);
      this.cupSteam.draw(g, 0.35);
      this.drawPigeons(g);
      if (this.extL || this.extR) this.drawExtNear(g);

      // Halos des lampes, du soleil, de la lune.
      if (this.halo) {
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.88 + 0.06 * Math.sin(t * 1.3) + 0.03 * Math.sin(t * 7.1);
        g.drawImage(this.halo, -ox, 0);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
      }

      // Météo propre à la scène (seulement sans effet météo de l'app).
      if (this.fx) {
        if (this.fx instanceof X.RainFx) this.fx.draw(g);
        else this.fx.draw(g, t);
      }

      // Éclair : tout l'écran blanchit un instant.
      if (this.flash > 0) {
        g.globalCompositeOperation = 'lighter';
        const a = this.flash > 0.55 ? 0.35 : this.flash > 0.3 ? 0.08 : this.flash > 0.15 ? 0.22 : 0.05;
        g.fillStyle = `rgba(200,210,255,${a})`;
        g.fillRect(this.wx0, 0, this.wx1 - this.wx0, H);
        g.globalCompositeOperation = 'source-over';
      }
    }

    // Rue prolongée, plan du fond : marquise du cinéma, croix de pharmacie, fontaine.
    drawExtFar(g) {
      const lk = this.look;
      const t = this.t;
      if (lk.lightsOn) {
        const step = Math.floor(t * 7);
        for (const b of this.marquee) {
          const on = (b.i + step) % 4 !== 0;
          g.fillStyle = on ? '#fff2b8' : '#a07840';
          g.fillRect(b.x, b.y, 1, 1);
        }
        g.globalCompositeOperation = 'lighter';
        for (const b of this.marquee) {
          if ((b.i + step) % 4 === 0) continue;
          g.fillStyle = 'rgba(255,210,120,0.22)';
          g.fillRect(b.x - 1, b.y - 1, 3, 3);
        }
        // Croix de pharmacie : pulsation, puis un éclair de temps en temps.
        for (const c of this.crosses) {
          const ph = t % 4;
          const k = ph < 0.6 ? (Math.floor(ph * 10) % 2 ? 0.3 : 1) : 0.65 + 0.35 * Math.sin(t * 2.4);
          g.globalCompositeOperation = 'source-over';
          g.fillStyle = `rgba(90,255,130,${0.55 + 0.45 * k})`;
          g.fillRect(c.x - 1, c.y - 4, 3, 9);
          g.fillRect(c.x - 4, c.y - 1, 9, 3);
          g.fillStyle = `rgba(220,255,225,${k})`;
          g.fillRect(c.x, c.y - 3, 1, 7);
          g.fillRect(c.x - 3, c.y, 7, 1);
          g.globalCompositeOperation = 'lighter';
          g.fillStyle = `rgba(60,255,110,${0.12 * k})`;
          g.fillRect(c.x - 6, c.y - 6, 13, 13);
        }
        g.globalCompositeOperation = 'source-over';
      }
      // Gouttes de la fontaine de la place.
      for (const f of this.fountains) {
        if (f.kind !== 'square') continue;
        g.fillStyle = 'rgba(225,240,255,0.85)';
        for (let k = 0; k < 6; k++) {
          const u = (t * 1.6 + k / 6) % 1;
          const side = k % 2 ? 1 : -1;
          g.fillRect(f.x + side * 8, Math.round(f.y - 20 + u * 12), 1, 1);
          g.fillRect(f.x + side * 4, Math.round(f.y - 27 + ((u * 2) % 1) * 6), 1, 1);
        }
        const sp = Math.floor(t * 5);
        g.fillStyle = 'rgba(255,255,255,0.7)';
        g.fillRect(f.x - 12 + ((sp * 7) % 24), f.y - 7, 1, 1);
        g.fillRect(f.x - 1, f.y - 33 - (sp % 2), 1, 1);
      }
    }

    // Rue prolongée, premier plan : le musicien, le voyageur de l'abribus, la fontaine
    // Wallace, les pigeons.
    drawExtNear(g) {
      const t = this.t;
      if (this.waitS && this.busStop) {
        const S = this.waitS;
        const ph = t % 9;
        const img = ph > 6.5 ? S.frames.look : S.frames.idle[Math.floor(t / 1.4) % 2];
        g.drawImage(img, this.busStop.x - S.ax, this.busStop.y - S.ay);
      }
      if (this.buskerS && this.busker) {
        const S = this.buskerS;
        const s = this.strum;
        const nod = Math.floor(s.beat / 8) % 2 === 1;
        const up = s.beat % 2 === 0;
        const img = S.frames[nod ? (up ? 'nodUp' : 'nodDown') : up ? 'up' : 'down'];
        g.drawImage(img, this.busker.x + 15 - S.ax, this.busker.y - 2 - S.ay);
        this.notes.draw(g, '255,232,170');
      }
      for (const f of this.fountains) {
        if (f.kind !== 'wallace') continue;
        g.fillStyle = 'rgba(200,228,255,0.9)';
        const u = (t * 1.3) % 1;
        g.fillRect(f.x, Math.round(f.y0 + u * (f.y1 - f.y0)), 1, 1);
        g.fillRect(f.x, Math.round(f.y0 + ((u + 0.5) % 1) * (f.y1 - f.y0)), 1, 1);
      }
      if (this.extPigeons) this.drawPigeons(g, this.extPigeons);
    }

    drawCar(g, tr) {
      const c = tr.car;
      if (!c) return;
      tr.draw(g);
      if (this.look.wet) {
        // Reflet de la voiture sur la chaussée mouillée.
        const img = c.dir > 0 ? c.set.right : c.set.left;
        const gy = tr.o.groundY;
        g.save();
        g.globalAlpha = 0.22;
        g.translate(0, gy * 2);
        g.scale(1, -1);
        g.drawImage(img, Math.round(c.x), gy - c.set.h);
        g.restore();
      }
    }

    drawCat(g) {
      const c = this.cat;
      const S = this.catS;
      const right = c.dir > 0;
      let frames;
      let dur;
      if (c.state === 'sleep') {
        frames = right ? S.sleepR : S.sleep;
        dur = 1.4;
      } else if (c.state === 'walk') {
        frames = right ? S.walkR : S.walk;
        dur = 0.15;
      } else if (c.state === 'lick') {
        frames = right ? S.lickR : S.lick;
        dur = 0.3;
      } else {
        frames = right ? S.sitR : S.sit;
        dur = 0.7;
      }
      const img = frames[Math.floor(c.frameT / dur) % frames.length];
      g.drawImage(img, Math.round(c.x), this.L.shopTop - 2 - img.height);
    }

    drawPigeons(g, list = this.pigeons) {
      if (!this.look.pigeons) return;
      const { L } = this;
      for (const p of list) {
        if (p.state === 'gone') continue;
        const x = Math.round(p.x);
        if (p.state === 'fly' || p.state === 'land') {
          const img = this.pigeonFly[Math.floor(p.t / 0.1) % 2];
          g.drawImage(img, x - 3, Math.round(L.pigeonY - 6 + p.y));
          continue;
        }
        const right = p.dir > 0;
        const peck = p.state === 'peck' && Math.floor(p.t / 0.25) % 2 === 0;
        const img = peck ? (right ? this.pigeonS.peckR : this.pigeonS.peck) : right ? this.pigeonS.standR : this.pigeonS.stand;
        g.drawImage(img, x - 4, L.pigeonY - 6);
      }
    }
  }

  const cold = (lk) => lk.season === 'winter' || lk.night || lk.wet;

  for (const key of Object.keys(VARIANTS)) {
    B.PixelScenes[key] = function (W, H, opts) {
      return new City(W, H, key, opts);
    };
  }
})();
