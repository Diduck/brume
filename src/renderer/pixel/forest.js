// Brume — scène « Forêt », en pixel art.
//
// Un lac de montagne à la tombée de la nuit : lune et étoiles, chaînes de montagnes en
// perspective atmosphérique, plusieurs plans de sapins à étages, lac miroir, rive avec
// roseaux et rochers, une tente et un feu de camp dont la lueur est peinte sur le décor.
//
// La vie : le feu crépite (étincelles, fumée), un campeur se réchauffe les mains et
// tisonne, un cerf descend boire au lac, une chouette cligne des yeux et tourne la tête,
// un renard passe, des poissons sautent, des lucioles, des étoiles filantes, des oiseaux.
//
// Le décor change avec la météo (les saisons) : il est repeint quand l'effet change,
// puis chaque image ne dessine que ce qui bouge.
(function () {
  'use strict';
  const B = window.Brume;
  const { Raster, sprite, hex, mix, rng, hash, noise, fbm, bayer } = B.PX;
  const PXC = B.PXC;
  const C = hex;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  /* ================= Ambiances (une par effet météo) ================= */
  const BASE = {
    sky: ['#0e1830', '#1c2f50', '#384b70', '#77698a', '#d6987a'],
    stars: 0.6,
    milky: 0,
    moon: true,
    clouds: 'dusk',
    cloud: ['#3e4268', '#a87480'],
    far: ['#525e86', '#6e7aa2', '#414c72'], // base, face éclairée, face à l'ombre
    farFade: 0.28,
    mid: ['#2c3856', '#3c4a6a', '#222c46'],
    midFade: 0.1,
    snowcap: ['#a6aec8', '#d0d6e6', '#7e88a6'],
    snowline: 0.26,
    hill: '#111b24',
    pine: ['#0d171d', '#16262a', '#24393a', '#1a1210'], // sombre, moyen, clair, tronc
    pineSnow: null,
    farPine: ['#1c283c', '#28364c'],
    decid: null,
    ground: ['#1d281b', '#263421', '#33452b'],
    dirt: ['#382c22', '#4e3e2c'],
    mud: '#1a1c1c',
    rock: ['#2a2c34', '#44464f', '#62646e'],
    reed: ['#34422a', '#56603a', '#3a2618'],
    water: '#18263e',
    mist: '#6a7092',
    mistK: 0.45,
    ambient: [0.56, 0.6, 0.78],
    warm: [1.35, 0.78, 0.34],
    tent: ['#c85e2e', '#86381e', '#5a2414'],
    fireflies: 10,
    birds: true,
    glitter: true,
    fish: true,
    ripples: 0,
  };
  const NIGHT_MTN = {
    far: ['#2c3656', '#404c72', '#222a44'],
    mid: ['#1a2238', '#26304c', '#141a2c'],
    snowcap: ['#6e7896', '#a4aec8', '#545e7c'],
    farFade: 0.2,
    clouds: 'none',
    birds: false,
  };
  const LOOKS = {
    none: {},
    snow: {
      sky: ['#0a1428', '#16284a', '#2a3e66', '#4a6090', '#8094bc'],
      stars: 0.35,
      clouds: 'thin',
      cloud: ['#34446a', '#6a7aa2'],
      far: ['#66749a', '#8290b2', '#4e5c80'],
      mid: ['#435072', '#5a6888', '#333e5a'],
      snowcap: ['#a2aec8', '#cad4e6', '#7a88a8'],
      snowline: 1.1,
      farFade: 0.36,
      hill: '#1a2636',
      pineSnow: ['#9eacc4', '#d6e0ee'],
      farPine: ['#2a3a52', '#8a9ab6'],
      ground: ['#8e9cb6', '#aebcd2', '#cfdaea'],
      snowGround: true,
      ice: true,
      reed: ['#7a6e4e', '#a0926a', '#4a3828'],
      water: '#122038',
      mist: '#8c9abb',
      ambient: [0.66, 0.72, 0.9],
      warm: [1.1, 0.62, 0.3],
      fireflies: 0,
      birds: false,
    },
    rain: {
      sky: ['#10161f', '#1a222c', '#252f3a', '#323e4a', '#3e4a56'],
      stars: 0,
      moon: false,
      clouds: 'overcast',
      cloud: ['#1a222c', '#2a3440', '#3a4652'],
      far: ['#3a4552', '#46525f', '#323c49'],
      farFade: 0.55,
      mid: ['#26303c', '#303c48', '#1e2630'],
      midFade: 0.3,
      snowcap: ['#5e6876', '#727c8a', '#4e5866'],
      snowline: 0.18,
      hill: '#131b21',
      farPine: ['#1c2630', '#242e38'],
      ground: ['#1c2a1c', '#273a24', '#36502e'],
      water: '#172230',
      mist: '#4c5662',
      mistK: 0.85,
      ambient: [0.55, 0.6, 0.68],
      fireflies: 0,
      birds: false,
      glitter: false,
      ripples: 16,
      tarp: true,
    },
    sakura: {
      sky: ['#181c3a', '#33366a', '#6a5a8c', '#c27f9c', '#f0b2a2'],
      cloud: ['#4e4676', '#e09aa8'],
      decid: 'sakura',
      ground: ['#1e321c', '#2a4426', '#3a5e34'],
      flowers: true,
      fireflies: 5,
    },
    leaves: {
      sky: ['#15132a', '#302447', '#6a4258', '#bc6846', '#ec9e58'],
      cloud: ['#4e3450', '#d0805a'],
      far: ['#5a5878', '#78729a', '#46445e'],
      decid: 'autumn',
      ground: ['#2a2a1a', '#3a3620', '#4e4628'],
      reed: ['#5a5228', '#8a7a3a', '#4a2e18'],
      litter: true,
      fireflies: 0,
    },
    fireflies: {
      ...NIGHT_MTN,
      sky: ['#050b18', '#0b162c', '#142644', '#203656', '#2e4462'],
      stars: 1,
      milky: 0.55,
      ground: ['#182a1a', '#223a22', '#2e4e2c'],
      fireflies: 55,
      mist: '#3e4a66',
      water: '#101c32',
    },
    starfall: {
      ...NIGHT_MTN,
      sky: ['#03061a', '#080f2e', '#111a42', '#1c2654', '#2a3466'],
      stars: 1.5,
      milky: 1,
      moon: false,
      fireflies: 6,
      mist: '#3a4268',
      water: '#0e1830',
      glitter: false,
    },
  };
  LOOKS.storm = {
    ...LOOKS.rain,
    sky: ['#0a0e15', '#131921', '#1c242e', '#262f3a', '#303a46'],
    cloud: ['#12181f', '#1e2630', '#2c3642'],
    ambient: [0.48, 0.52, 0.6],
    ripples: 32,
    lightning: true,
  };

  /* ================= Les nuits (météo en direct) =================
   * Quand il fait nuit chez l'utilisateur, chaque temps a sa version nocturne : elle garde
   * les conséquences du temps (neige et lac gelé, pluie sur le lac et bâche, orage,
   * cerisiers en fleurs, feuillus roux) sous l'éclairage des nuits de la scène (lucioles,
   * étoiles filantes) : ciel noir bleuté, montagnes sombres, le feu de camp, la tente et
   * la cabane allumés. Lune et étoiles seulement par ciel dégagé ; pas d'étoile filante
   * (c'est le temps « starfall »). fireflies et starfall sont déjà des nuits.
   * leafNight : les feuillages colorés s'éteignent (part de mélange vers la nuit) ;
   * iceNight : idem pour la glace du lac. */
  const NIGHT_GROUND = ['#182a1a', '#223a22', '#2e4e2c'];
  const NIGHT_LOOKS = {
    // Nuit calme et claire : lune, étoiles, un voile de Voie lactée, quelques lucioles.
    none: {
      ...NIGHT_MTN,
      sky: ['#050a19', '#0a152b', '#122342', '#1c3252', '#283e5c'],
      stars: 0.95,
      milky: 0.35,
      ground: NIGHT_GROUND,
      fireflies: 6,
      mist: '#3e4a66',
      water: '#101c32',
      noShoot: true,
    },
    // Nuit de printemps : ciel mauve, cerisiers pâles sous la lune, fleurs dans l'herbe.
    sakura: {
      ...NIGHT_MTN,
      sky: ['#07081a', '#0f112e', '#1a1b42', '#2a2652', '#3a305c'],
      stars: 0.9,
      milky: 0.3,
      decid: 'sakura',
      leafNight: 0.42,
      flowers: true,
      ground: NIGHT_GROUND,
      fireflies: 8,
      mist: '#44406a',
      water: '#111a34',
      noShoot: true,
    },
    // Nuit d'automne : feuillus roux éteints, feuilles mortes au sol, horizon un peu ambré.
    leaves: {
      ...NIGHT_MTN,
      sky: ['#070816', '#100f24', '#1b1934', '#2a2340', '#3a2c48'],
      stars: 0.9,
      milky: 0.3,
      decid: 'autumn',
      leafNight: 0.45,
      litter: true,
      ground: ['#1e1e14', '#2a2818', '#383420'],
      reed: ['#4a4422', '#6e6230', '#3a2414'],
      fireflies: 0,
      mist: '#3e3e5a',
      water: '#10162a',
      noShoot: true,
    },
    // Pluie de nuit : nuages bas et noirs, lac piqueté de ronds, bâche au-dessus du campeur.
    rain: {
      ...LOOKS.rain,
      sky: ['#05080d', '#0a0f15', '#10161d', '#161e27', '#1d2631'],
      cloud: ['#0b1016', '#131a22', '#1c242e'],
      far: ['#222a35', '#29323d', '#1b222c'],
      mid: ['#161d26', '#1c242e', '#121820'],
      snowcap: ['#38414c', '#444e5a', '#2e3742'],
      hill: '#0b1115',
      pine: ['#091114', '#0f1a1d', '#182628', '#140e0c'],
      farPine: ['#10161c', '#161e26'],
      ground: ['#142014', '#1c2c1a', '#263a22'],
      water: '#0d141e',
      mist: '#2c3440',
      ambient: [0.44, 0.48, 0.58],
    },
    // Neige de nuit : ciel couvert et bas, tout est blanc bleuté, lac gelé dans l'ombre.
    snow: {
      ...LOOKS.snow,
      sky: ['#0a0f1a', '#101828', '#172236', '#1e2b41', '#28354c'],
      stars: 0,
      moon: false,
      clouds: 'overcast',
      cloud: ['#121a28', '#1a2434', '#243042'],
      far: ['#3a4664', '#485474', '#2e3854'],
      mid: ['#283250', '#333f60', '#202842'],
      snowcap: ['#58648a', '#7684a6', '#4a5676'],
      farFade: 0.3,
      hill: '#121a28',
      pineSnow: ['#6a7896', '#9aa8c4'],
      farPine: ['#1c2840', '#56668a'],
      ground: ['#5c6a8a', '#72809e', '#8e9cb8'],
      water: '#0c1628',
      mist: '#4a5676',
      ambient: [0.54, 0.6, 0.8],
      iceNight: 0.5,
    },
  };
  // Orage de nuit : encore plus noir ; seuls les éclairs révèlent les montagnes.
  NIGHT_LOOKS.storm = {
    ...NIGHT_LOOKS.rain,
    sky: ['#030508', '#070a0f', '#0b1015', '#11161d', '#171d25'],
    cloud: ['#080b10', '#0e1318', '#161c23'],
    ambient: [0.4, 0.44, 0.54],
    ripples: 32,
    lightning: true,
  };
  // Teinte de nuit vers laquelle s'éteignent les couleurs vives (feuillages, glace).
  const NIGHT_TINT = [10, 14, 30];

  /* ================= Personnages et animaux ================= */

  // Campeur assis sur une bûche, tourné vers le feu (à droite) : peint par B.People
  // (people.js), puis éclairé par la lueur du feu comme le reste du décor.
  const CAMPER = {
    seed: 31, body: 'm', skin: '#e0a882', hairColor: '#24160f', hairStyle: 'messy',
    top: '#5a2a30', topStyle: 'coat', bottom: '#2e3850', shoes: '#2a1a12',
    hat: { color: '#c8503a', band: '#7a2a22' }, props: { stick: '#4a2c16', mug: '#d8d0c0' },
  };

  // Cerf de profil, tourné vers la gauche (vers le lac).
  const DEER_TOP = [
    '...a.a................',
    '..aa.aa.a.............',
    '...aaaaa..............',
    '....bbbdd.............',
    '...bebbd..............',
    '.nbbbbb...............',
    '..lbbbb...............',
    '....wbbb..............',
    '.....bbbb.............',
    '......LLLLLLLLLLLLLLw.',
    '......bbbbbbbbbbbbbbbw',
    '......lbbbbbbbbbbbbbbd',
    '.......bbbbbbbbbbbbbbd',
    '.......dlllllllllbbbd.',
  ];
  const DEER_LEGS = {
    stand: ['........bb.......bb...', '........b.b.....b.b...', '........b.b.....b..b..', '........b.b.....b..b..', '........h.h.....h..h..'],
    w1: ['........bb.......bb...', '.......b..b.....b.b...', '.......b...b...b...b..', '......b....b...b....b.', '......h....h..h.....h.'],
    w2: ['........bb.......bb...', '........bb.......bb...', '........b.b.....b.b...', '........b.b.....b.b...', '........hh......hh....'],
    w3: ['........bb.......bb...', '.........bb.....bb....', '........b..b...b..b...', '.......b...b..b...b...', '.......h...h..h...h...'],
  };
  const DEER_DRINK = [
    '......................',
    '......................',
    '......................',
    '......................',
    '......................',
    '......................',
    '......................',
    '......................',
    '......................',
    '.......LLLLLLLLLLLLLw.',
    '......bbbbbbbbbbbbbbbw',
    '.....bbbbbbbbbbbbbbbbd',
    '..a.bbbbbbbbbbbbbbbbbd',
    '.aa.bbbdlllllllllbbbd.',
    '..aaabb.bb.......bb...',
    '...ddbb.b.b.....b.b...',
    '..bebb..b.b.....b..b..',
    '.nbbb...b.b.....b..b..',
    '..l.....h.h.....h..h..',
  ];
  // Variante « il lape » : la tête descend d'un pixel.
  const DEER_LAP = DEER_DRINK.map((row, y) => (y >= 12 ? (y === 12 ? '....' : DEER_DRINK[y - 1].slice(0, 4)) + row.slice(4) : row));
  const DEER_PAL = { b: '#5e4232', L: '#86684e', d: '#3a281c', l: '#9a7c5e', w: '#d0c4b0', a: '#c4b490', e: '#0c0806', n: '#120c0a', h: '#160f0a' };
  // doe : la biche (sans bois, pelage un peu plus clair).
  function deerSprites(doe) {
    const pal = doe ? { ...DEER_PAL, b: '#6e4e38', L: '#987656' } : DEER_PAL;
    const nb = (rows) => (doe ? rows.map((r) => r.replace(/a/g, '.')) : rows);
    const set = (flip) => ({
      stand: sprite(nb([...DEER_TOP, ...DEER_LEGS.stand]), pal, flip),
      walk: ['w1', 'w2', 'w3', 'w2'].map((k) => sprite(nb([...DEER_TOP, ...DEER_LEGS[k]]), pal, flip)),
      drink: sprite(nb(DEER_DRINK), pal, flip),
      lap: sprite(nb(DEER_LAP), pal, flip),
    });
    return { left: set(false), right: set(true), w: 22, h: 19 };
  }

  // Renard qui trotte (tourné vers la droite).
  const FOX_TOP = [
    '..............O.O.',
    '..............ooo.',
    '.............oeoow',
    '..oooooooooooowwwn',
    'ooooooooooooooww..',
    'oOoOooooooooooo...',
    'w..wwwwwwwwwooo...',
  ];
  const FOX_LEGS = {
    a: ['....k..k....k..k..', '...k....k..k....k.'],
    b: ['.....kk......kk...', '.....kk......kk...'],
    stand: ['....k.k.....k.k...', '....k.k.....k.k...'],
  };
  const FOX_PAL = { o: '#b4552a', O: '#7a3618', w: '#ddd0bc', k: '#22140e', e: '#0c0604', n: '#0c0604' };
  function foxSprites() {
    const set = (flip) => ({
      run: ['a', 'b'].map((k) => sprite([...FOX_TOP, ...FOX_LEGS[k]], FOX_PAL, flip)),
      stand: sprite([...FOX_TOP, ...FOX_LEGS.stand], FOX_PAL, flip),
    });
    return { right: set(false), left: set(true), h: 9 };
  }

  // Chouette posée sur sa branche (de face).
  const OWL = [
    '.B.....B.',
    '.BbbbbbB.',
    'bbfffffbb',
    'bfYYfYYfb',
    'bfYkfkYfb',
    'bbffnffbb',
    'bblLlLlbb',
    'bbLlLlLbb',
    '.blLlLlb.',
    '..bbbbb..',
    '..t...t..',
  ];
  const OWL_PAL = { B: '#2e2219', b: '#544232', f: '#8a7660', Y: '#f2cc3a', k: '#120c08', n: '#c8a050', l: '#7a6654', L: '#4a3a2e', t: '#c8a050' };
  function owlSprites() {
    const v = (rows3, rows4) => OWL.map((r, y) => (y === 3 ? rows3 : y === 4 ? rows4 : r));
    const shift = (rows, d) => rows.map((r, y) => (y > 5 ? r : d < 0 ? r.slice(1) + '.' : '.' + r.slice(0, -1)));
    const back = OWL.map((r, y) => (y >= 2 && y <= 5 ? ['bbbBbbbbb', 'bBbbbBbbb', 'bbbbBbbBb', 'bbBbbbbbb'][y - 2] : r));
    return {
      front: sprite(OWL, OWL_PAL),
      blink: sprite(v('bfBBfBBfb', 'bfffffffb'), OWL_PAL),
      left: sprite(shift(v('bfYYfYYfb', 'bfkYfkYfb'), -1), OWL_PAL),
      right: sprite(shift(v('bfYYfYYfb', 'bfYkfYkfb'), 1), OWL_PAL),
      back: sprite(back, OWL_PAL),
    };
  }

  /* ================= Outils de peinture ================= */

  // Une crête de montagne (0 – 1) : bruit « en arêtes » sur plusieurs octaves.
  function ridge(x, s) {
    let v = 0;
    let a = 0.55;
    let f = 1;
    for (let i = 0; i < 4; i++) {
      const n = noise(x * f, 0.5 + i * 3.1, s + i);
      v += a * (1 - Math.abs(n * 2 - 1));
      a *= 0.5;
      f *= 2.1;
    }
    return v;
  }

  // Dessin en texte posé directement dans un Raster.
  function stamp(r, rows, pal, x0, y0) {
    const cols = {};
    for (const k of Object.keys(pal)) cols[k] = typeof pal[k] === 'string' ? C(pal[k]) : pal[k];
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = cols[row[x]];
        if (c) r.set(x0 + x, y0 + y, c);
      }
    });
  }

  function inPoly(pts, px, py) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  // Remplit un polygone ; fn(x, y) renvoie la couleur (ou null).
  function fillPoly(r, pts, fn) {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
        if (!inPoly(pts, x + 0.5, y + 0.5)) continue;
        const c = fn(x, y);
        if (c) r.set(x, y, c);
      }
    }
  }
  function line(r, x0, y0, x1, y1, c) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let k = 0; k <= n; k++) r.set(Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n), c);
  }

  /* ---------- Monde élargi (animation d'ouverture) ----------
   * La scène peut peindre un monde plus large que l'écran : x de −extL à W + extR. On
   * peint toujours en coordonnées de la scène ; le pixel x est rangé dans la colonne
   * x + extL de la toile. Le cadre du fond d'écran [0, W) reste peint exactement pareil :
   * les décors ajoutés autour sont peints ensuite, cadre verrouillé (lock). */
  class WRaster extends Raster {
    constructor(x0, w, h, vw) {
      super(w, h);
      this.x0 = x0; // x de la scène de la première colonne
      this.vw = vw; // largeur du cadre du fond d'écran
      this.la = 0;
      this.lb = 0;
    }
    // Colonnes [a, b) protégées (rien ne s'y peint) ; lock() sans argument déverrouille.
    lock(a = 0, b = 0) {
      this.la = a;
      this.lb = b;
    }
    set(x, y, c, a = 255) {
      x |= 0;
      if (x >= this.la && x < this.lb) return;
      super.set(x - this.x0, y, c, a);
    }
    get(x, y) {
      return super.get((x | 0) - this.x0, y);
    }
  }

  // Éclairage peint (comme B.PXC.applyLight) sur une toile élargie, en coordonnées de la
  // scène. extra : lumières des décors ajoutés, qui n'éclairent que hors du cadre (leur
  // traîne est coupée pour ne pas semer de points lumineux au loin).
  function lightW(r, lights, ambient, warm, mask, extra) {
    for (let y = 0; y < r.h; y++) {
      for (let cx = 0; cx < r.w; cx++) {
        const x = cx + r.x0;
        if (mask && !mask(x, y)) continue;
        const i = (y * r.w + cx) * 4;
        if (!r.data[i + 3]) continue;
        let I = 0;
        for (const l of lights) {
          const dx = x - l.x;
          const dy = (y - l.y) * (l.sy || 1);
          I += l.k / (1 + (dx * dx + dy * dy) / (l.r * l.r));
        }
        if (extra && extra.length && (x < 0 || x >= r.vw)) {
          let E = 0;
          for (const l of extra) {
            const dx = x - l.x;
            const dy = (y - l.y) * (l.sy || 1);
            E += l.k / (1 + (dx * dx + dy * dy) / (l.r * l.r));
          }
          I += Math.max(0, E - 0.04) / 0.96;
        }
        const q = Math.floor(Math.min(1.3, I) * 6 + bayer(x, y)) / 6;
        for (let c = 0; c < 3; c++) r.data[i + c] = Math.min(255, r.data[i + c] * (ambient[c] + warm[c] * q));
      }
    }
  }

  // Halos additifs (comme B.PXC.makeHalo) sur toute la largeur du monde.
  function haloW(x0, w, h, vw, halos, extra) {
    const r = new Raster(w, h);
    for (let y = 0; y < h; y++) {
      for (let cx = 0; cx < w; cx++) {
        const x = cx + x0;
        let R = 0;
        let G = 0;
        let Bl = 0;
        const list = extra && (x < 0 || x >= vw) ? halos.concat(extra) : halos;
        for (const hl of list) {
          const d = Math.hypot(x - hl.x, (y - hl.y) * 1.2);
          if (d > hl.r) continue;
          const q = (Math.floor((1 - d / hl.r) ** 1.6 * 5 + bayer(x, y) * 0.9) / 5) * (hl.k || 0.55);
          R += hl.c[0] * q;
          G += hl.c[1] * q;
          Bl += hl.c[2] * q;
        }
        if (R + G + Bl > 2) r.set(cx, y, [R, G, Bl]);
      }
    }
    return r.toCanvas();
  }

  // Courbe lisse qui passe par des points [u, v] (raccords en douceur).
  function curve(P, u) {
    if (u <= P[0][0]) return P[0][1];
    for (let i = 1; i < P.length; i++) {
      if (u > P[i][0]) continue;
      const [a, va] = P[i - 1];
      const [b, vb] = P[i];
      const t = (u - a) / (b - a);
      return va + (vb - va) * t * t * (3 - 2 * t);
    }
    return P[P.length - 1][1];
  }

  // Bouleau : tronc blanc marqué de noir, fin et un peu penché, feuillage léger en
  // bouquets éclairés par la lune (à droite). leaf = [sombre, moyen, clair] (RVB), ou
  // null : branches nues (hiver), poudrées de neige si snow. o.dark assombrit (premier plan).
  function birch(r, cx, base, h, leaf, seed, o = {}) {
    cx = Math.round(cx);
    base = Math.round(base);
    h = Math.round(h);
    const dk = o.dark || 0;
    const dd = (c) => (dk ? mix(c, [6, 8, 12], dk) : c);
    const bark = [dd(C('#e6e2d6')), dd(C('#a8a498')), dd(C('#2a2622'))];
    const twig = dd(C('#4a4038'));
    const tw = o.tw || (h > 70 ? 3 : h > 26 ? 2 : 1);
    const lean = (hash(seed, 1, 7) - 0.5) * 0.14;
    const xAt = (k) => cx + Math.round(lean * k + Math.sin(k * 0.06 + seed) * 0.8);
    const top = Math.round(h * (o.crown || 1));
    for (let k = 0; k < top; k++) {
      const x = xAt(k);
      const w = k > h * 0.75 && tw > 1 ? tw - 1 : tw;
      for (let i = 0; i < w; i++) {
        let c = i === 0 && w > 1 ? bark[1] : bark[0];
        if (w > 2 && i === 1) c = mix(bark[0], bark[1], 0.3);
        // Marques noires horizontales, plus serrées au pied.
        if (hash(Math.floor(k / (k < h * 0.2 ? 1 : 2)), Math.floor(i / 2) + seed * 3, 61) < (k < h * 0.2 ? 0.3 : 0.16)) c = bark[2];
        r.set(x + i, base - k, c);
      }
    }
    // Branches fines qui montent en biais, et bouquets de feuilles au bout.
    const tips = [];
    const nb = 4 + Math.floor(h / 12);
    for (let b = 0; b < nb; b++) {
      const lo = o.low || 0.38;
      const k0 = Math.round(h * (lo + (0.93 - lo) * hash(b, seed, 62)));
      const dir = (b + seed) % 2 ? 1 : -1;
      const len = Math.max(2, Math.round(h * (0.1 + 0.12 * hash(b, seed, 63)) * (o.bl || 1)));
      const x0 = xAt(k0) + (dir > 0 ? tw - 1 : 0);
      let x = x0;
      let y = base - k0;
      for (let s = 1; s <= len; s++) {
        x = x0 + dir * s;
        y = base - k0 - Math.round(s * (0.5 + 0.3 * hash(b, seed, 64)));
        r.set(x, y, twig);
        if (!leaf && o.snow && hash(x, y, 65) < 0.6) r.set(x, y - 1, o.snow[1]);
      }
      tips.push([x, y, len]);
    }
    tips.push([xAt(h) + (tw >> 1), base - h + 1, h * 0.12 * (o.bl || 1)]);
    if (!leaf) {
      // Hiver : brindilles nues au bout des branches.
      for (const [x, y] of tips) {
        for (let s = 1; s < 4; s++) r.set(x + (s & 1), y - s, twig);
        if (o.snow) r.set(x, y - 1, o.snow[0]);
      }
      return;
    }
    const L3 = leaf.map(dd);
    // Rameaux qui retombent (le port pleureur du bouleau), sous chaque bouquet.
    tips.forEach(([tx, ty, len], j) => {
      const rx = 2 + len * 0.3;
      const ns = 3 + Math.round(len * 0.25);
      for (let s = 0; s < ns; s++) {
        let x = tx + Math.round((hash(j, s, seed + 72) - 0.5) * 2 * rx);
        const n = 3 + Math.round(hash(s, j, seed + 73) * (3 + len * 0.45));
        for (let k = 0; k < n; k++) {
          if (k > 2 && hash(s * 7 + k, j, seed + 74) < 0.2) x += hash(k, s, seed + 75) < 0.5 ? -1 : 1;
          if (hash(x, ty + k, seed + 76) < (len > 14 ? 0.08 : 0.3)) continue;
          r.set(x, ty + k, k < n * 0.3 ? L3[1] : L3[0]);
        }
      }
    });
    // Bouquets de feuilles, éclairés en haut à droite.
    for (const [tx, ty, len] of tips) {
      const rx = 2.5 + len * 0.3;
      const ry = 1.8 + len * 0.2;
      for (let y = Math.floor(ty - ry * 1.4); y <= Math.ceil(ty + ry * 1.2); y++) {
        for (let x = Math.floor(tx - rx); x <= Math.ceil(tx + rx); x++) {
          const ex = (x - tx) / rx;
          const ey = (y - ty + ry * 0.2) / ry;
          const n = fbm(x * 0.35, y * 0.35, seed + 70, 2);
          if (ex * ex + ey * ey > 0.35 + n * 0.9) continue;
          if (hash(x, y, seed + 71) < 0.12) continue; // feuillage aéré
          const l = ex * 0.6 - ey * 0.6 + (n - 0.5) * 0.8;
          r.set(x, y, l > 0.35 ? L3[2] : l > -0.3 ? L3[1] : L3[0]);
        }
      }
    }
  }

  // Sapin à étages : silhouette en zigzag (chaque étage commence plus étroit que le bas
  // du précédent), côté droit éclairé par la lune, ombre sous chaque étage, texture
  // d'aiguilles, et neige sur le dessus des étages en hiver.
  // col = [sombre, moyen, clair, tronc] (RVB) ; snow = [ombre, lumière] ou null.
  function pine(r, cx, base, h, col, snow, seed, o = {}) {
    cx = Math.round(cx);
    base = Math.round(base);
    h = Math.max(3, Math.round(h));
    const [dark, midc, light, trunk] = col;
    const trunkH = Math.max(1, Math.round(h * 0.08));
    const crownH = h - trunkH;
    const top = base - h;
    const maxHalf = Math.max(1, h * (o.wide || 0.27));
    const tierH = o.tierH || clamp(h * 0.2, 3, 16);
    const tiers = Math.max(1, Math.round(crownH / tierH));
    const tw = h > 70 ? 3 : h > 24 ? 2 : 1;
    for (let y = base - trunkH - 2; y < base; y++) for (let i = 0; i < tw; i++) r.set(cx - (tw >> 1) + i, y, i === tw - 1 && tw > 1 ? mix(trunk, light, 0.4) : trunk);
    if (h < 7) {
      for (let y = 0; y < crownH; y++) {
        const half = Math.round((maxHalf * (y + 1)) / crownH);
        for (let dx = -half; dx <= half; dx++) {
          let c = dx > 0 && hash(dx, y, seed) < 0.5 ? light : midc;
          if (snow && dx === (y & 1 ? -half : half)) c = snow[1];
          r.set(cx + dx, top + y, c);
        }
      }
      return;
    }
    const tierW = (k) => (maxHalf * (k + 1)) / tiers;
    let pL = -1;
    let pR = -1;
    for (let y = 0; y < crownH; y++) {
      const u = (y + 0.5) / crownH;
      const tp = u * tiers;
      const k = Math.min(tiers - 1, Math.floor(tp));
      const p = tp - k;
      const start = k === 0 ? 0 : tierW(k - 1) * 0.45;
      const half = start + (tierW(k) - start) * Math.pow(p, 0.85);
      const jit = half > 2 ? 1.7 : 0.6;
      const hl = Math.max(0, Math.round(half + (hash(y, 1, seed) - 0.5) * jit));
      const hr = Math.max(0, Math.round(half + (hash(y, 2, seed) - 0.5) * jit));
      const shadowW = k > 0 && p < 0.32 ? tierW(k - 1) * 0.85 : -1;
      for (let dx = -hl; dx <= hr; dx++) {
        const x = cx + dx;
        const s = dx / (half + 0.6);
        let c;
        if (Math.abs(dx) < shadowW) c = dark;
        else if (s > 0.3) c = light;
        else if (s < -0.35) c = dark;
        else c = midc;
        if (hash(x, top + y, seed + 3) < 0.13) c = c === light ? midc : c === midc ? (s > 0 ? light : dark) : midc;
        const edgeTop = dx < 0 ? -dx > pL : dx > pR;
        // Sur les grands sapins, la neige forme un bourrelet de deux pixels.
        const edge2 = snow && h > 40 && (dx < 0 ? -dx >= pL - 1 : dx >= pR - 1) && p > 0.1;
        if (edgeTop || edge2) {
          if (snow) c = s > -0.25 ? snow[1] : snow[0];
          else if (s > -0.1) c = light;
        }
        r.set(x, top + y, c);
      }
      pL = hl;
      pR = hr;
    }
  }

  // Arbre feuillu (cerisier en fleurs ou arbre d'automne) : couronne bosselée ombrée.
  // pal = [sombre, moyen, clair, accent, tronc] (RVB).
  function broadleaf(r, cx, base, h, pal, seed) {
    cx = Math.round(cx);
    base = Math.round(base);
    const cy = base - h * 0.62;
    const rx = h * 0.4;
    const ry = h * 0.4;
    const trunk = pal[4];
    for (let y = Math.round(cy); y < base; y++) {
      r.set(cx, y, trunk);
      if (h > 14) r.set(cx + 1, y, mix(trunk, [0, 0, 0], 0.3));
    }
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const n = fbm(x * 0.3, y * 0.3, seed, 3);
        if (dx * dx + dy * dy > 0.45 + n * 0.9) continue;
        const l = dx * 0.55 - dy * 0.7 + (n - 0.5) * 0.9;
        let c = l > 0.3 ? pal[2] : l > -0.3 ? pal[1] : pal[0];
        if (hash(x, y, seed) < 0.07) c = pal[3];
        r.set(x, y, c);
      }
    }
  }

  // Rocher arrondi, éclairé par le haut ; mousse ou neige sur le dessus.
  function rock(r, cx, cy, rx, ry, K, top) {
    for (let y = cy - ry; y <= cy; y++) {
      for (let x = cx - rx; x <= cx + rx; x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy > 1) continue;
        const l = dx * 0.45 - dy * 0.85 + (hash(x, y, 5) - 0.5) * 0.3;
        let c = l > 0.55 ? K[2] : l > 0 ? K[1] : K[0];
        if (top && dy < -0.55 + hash(x, 3, 9) * 0.3) c = top;
        r.set(x, y, c);
      }
    }
  }

  const snowG = (lk) => !!lk.snowGround;

  /* ================= La scène ================= */
  class Foret {
    constructor(W, H, opts = {}) {
      this.W = W;
      this.H = H;
      // Monde élargi pour l'animation d'ouverture : extL pixels à gauche, extR à droite.
      const ext = opts.ext || {};
      this.extL = Math.max(0, Math.round(ext.left || 0));
      this.extR = Math.max(0, Math.round(ext.right || 0));
      this.ext = this.extL + this.extR > 0;
      this.X0 = -this.extL;
      this.X1 = W + this.extR;
      this.WW = this.X1 - this.X0;
      const L = (this.L = {});
      L.lakeY = Math.round(H * 0.585);
      L.shore = new Int16Array(W);
      for (let x = 0; x < W; x++) L.shore[x] = Math.round(H * 0.772 + (x / W) * H * 0.05 + Math.sin(x * 0.045 + 1) * 2 + (noise(x * 0.07, 3.3, 41) - 0.5) * 4);
      L.shoreMax = Math.max(...L.shore);
      L.shoreMin = Math.min(...L.shore);
      L.fireX = Math.round(W * 0.37);
      L.fireY = H - 20;
      L.tentX = L.fireX - 54;
      L.tentY = H - 26;
      L.campX = L.fireX - 20; // bord gauche du sprite du campeur
      L.moon = { x: Math.round(W * 0.72), y: Math.round(H * 0.17), r: 7 };
      L.deerX = Math.round(W * 0.69);
      L.canoeX = Math.round(W * 0.47);
      L.owl = { x: W - 60, y: Math.round(H * 0.42) };
      L.skyEnd = Math.round(H * 0.44);

      // Relief : chaîne lointaine, chaîne moyenne, collines boisées qui plongent dans le lac.
      L.far = new Int16Array(W);
      L.mid = new Int16Array(W);
      L.hill = new Int16Array(W);
      L.top = new Int16Array(W);
      for (let x = 0; x < W; x++) {
        L.far[x] = Math.round(L.lakeY - 8 - H * (0.06 + 0.26 * Math.pow(ridge(x * 0.011 + 3, 11), 1.6) * (0.45 + 0.75 * noise(x * 0.007, 7.7, 19))));
        L.mid[x] = Math.round(L.lakeY - 4 - H * (0.03 + 0.15 * Math.pow(ridge(x * 0.02 + 40, 23), 1.4)));
        const lh = Math.max(0, 1 - x / (W * 0.4));
        const rh = Math.max(0, 1 - (W - x) / (W * 0.38));
        const bump = Math.max(lh ** 1.4 * H * 0.25, rh ** 1.4 * H * 0.2);
        L.hill[x] = Math.round(L.lakeY - 2 - bump - (bump > 2 ? noise(x * 0.06, 9, 7) * 5 : 0));
        L.top[x] = Math.min(L.far[x], L.mid[x], L.hill[x] - 12);
      }
      // Bande d'eau libre (en hiver, le reste du lac est gelé).
      L.openY0 = L.lakeY + 3;
      L.openY1 = Math.round(L.lakeY + (L.shoreMin - L.lakeY) * 0.5);
      this.layoutWorld();

      this.fast = PXC.fastTest();
      this.sprites = { camper: null, deer: deerSprites(), fox: foxSprites(), owl: owlSprites(), doe: deerSprites(true), boat: null };
      this.effect = null;
      this.night = false; // version nuit du temps (météo en direct, la nuit)
      this.t = 0;
      this.initLife();
    }

    /* ---------- Le monde élargi ----------
     * Dans le cadre [0, W), les profils sont ceux du fond d'écran. À gauche, le paysage
     * continue : la colline boisée redescend sur une anse où tombe une cascade, la rive
     * proche passe devant une biche qui boit, un ponton et sa barque, une cabane éclairée,
     * un bosquet de bouleaux, puis la forêt ; au fond, d'autres sommets. */
    layoutWorld() {
      const { W, H, L, X0, WW } = this;
      const wide = (vp, fn) => {
        const a = new Int16Array(WW);
        for (let i = 0; i < WW; i++) {
          const x = i + X0;
          a[i] = x >= 0 && x < W ? vp[x] : fn(x);
        }
        return a;
      };
      const u = (x) => -x / W; // distance au bord gauche du cadre, en largeurs d'écran
      const fx = Math.round(-W * 0.235);
      L.fall = this.extL > W * 0.3 ? { x: fx } : null;
      // Chaîne lointaine : les crêtes continuent, avec un grand sommet glaciaire plus loin.
      L.farW = wide(L.far, (x) => {
        const base = L.lakeY - 8 - H * (0.06 + 0.26 * Math.pow(ridge(x * 0.011 + 3, 11), 1.6) * (0.45 + 0.75 * noise(x * 0.007, 7.7, 19)));
        const peak = x < 0 ? H * 0.11 * Math.max(0, 1 - Math.abs(u(x) - 0.86) / 0.16) ** 1.4 : 0;
        return Math.round(base - peak);
      });
      // Chaîne moyenne : un épaulement rocheux et la brèche d'où sort la cascade.
      L.midW = wide(L.mid, (x) => {
        let m = L.lakeY - 4 - H * (0.03 + 0.15 * Math.pow(ridge(x * 0.02 + 40, 23), 1.4));
        if (L.fall) {
          m -= H * 0.075 * Math.exp(-(((x - fx) / 24) ** 2));
          m += 3 * Math.max(0, 1 - Math.abs(x - fx) / 3.5);
        }
        return Math.round(m);
      });
      // Collines boisées : celle de gauche redescend vers l'anse, puis d'autres crêtes.
      const HILL = [[0, 1], [0.17, 0.05], [0.3, 0], [0.42, 0.75], [0.56, 0.92], [0.72, 0.18], [0.92, 0], [1.12, 0.12], [1.36, 0.8], [1.7, 1.2]];
      L.hillW = wide(L.hill, (x) => {
        const bump = x < 0 ? H * 0.25 * curve(HILL, u(x)) : Math.min(1.3, 1 - (W - x) / (W * 0.38)) ** 1.4 * H * 0.2;
        return Math.round(L.lakeY - 2 - bump - (bump > 2 ? noise(x * 0.06, 9, 7) * 5 : 0));
      });
      // Rive proche : une petite anse au ponton, une avancée sous la cabane.
      const SHORE = [[0, 0], [0.1, 3], [0.22, 2], [0.33, 9], [0.45, 2], [0.62, -8], [0.8, -3], [1.0, 3], [1.3, -3], [1.7, 0]];
      L.shoreW = wide(L.shore, (x) => {
        const lin = x < 0 ? (curve(SHORE, u(x)) * H) / 225 : (x / W) * H * 0.05;
        return Math.round(H * 0.772 + lin + Math.sin(x * 0.045 + 1) * 2 + (noise(x * 0.07, 3.3, 41) - 0.5) * 4);
      });
      L.topW = new Int16Array(WW);
      for (let i = 0; i < WW; i++) L.topW[i] = i + X0 >= 0 && i + X0 < W ? L.top[i + X0] : Math.min(L.farW[i], L.midW[i], L.hillW[i] - 12);
      if (L.fall) {
        L.fall.y0 = this.at(L.midW, fx) + 2;
        L.fall.y1 = Math.round(L.fall.y0 + (L.lakeY - L.fall.y0) * 0.42);
      }
      // Décors de la rive (seulement s'ils tiennent dans le monde peint).
      const fits = (x, r) => x - r >= X0;
      const at = (x) => this.at(L.shoreW, x);
      const dx = Math.round(-W * 0.2);
      L.doe = fits(dx, 12) ? { x: dx } : null;
      const jx = Math.round(-W * 0.31);
      L.jetty = fits(jx, 40) ? { x: jx, y: at(jx) + 1 } : null;
      const cx = Math.round(-W * 0.62);
      L.cabin = fits(cx, 30) ? { x: cx, y: at(cx) + 16 } : null;
      if (L.cabin) {
        // Cabane en rondins vue de trois quarts : pignon face à nous, long pan à gauche.
        const c = L.cabin;
        const b = c.y;
        c.fw = 12; // demi-largeur de la façade
        c.wallH = 12;
        c.apex = [cx, b - 21];
        c.depth = [-10, -4]; // la cabane s'enfonce vers le fond, à gauche
        c.door = { x: cx - 9, y: b - 8, w: 5, h: 9 };
        c.win = { x: cx + 2, y: b - 8, w: 7, h: 5 };
        c.lamp = { x: cx - 2, y: b - 9 };
        c.chim = { x: cx - 6, y: b - 31 };
      }
    }

    // Valeur d'un profil du monde (tableau élargi) en x de la scène.
    at(a, x) {
      return a[clamp(Math.round(x) - this.X0, 0, this.WW - 1)];
    }

    // Une toile de la largeur du monde.
    raster(h = this.H) {
      return new WRaster(this.X0, this.WW, h, this.W);
    }

    // Parties du monde hors du cadre : [[a, b), …].
    extSpans() {
      const s = [];
      if (this.extL) s.push([this.X0, 0]);
      if (this.extR) s.push([this.W, this.X1]);
      return s;
    }

    /* ---------- Décor (repeint quand la météo change) ---------- */
    // night : version nuit du temps (fireflies et starfall sont déjà des nuits).
    build(effect, night = this.night) {
      const t0 = performance.now();
      this.effect = effect;
      this.night = !!night;
      const nl = this.night ? NIGHT_LOOKS[effect] : null;
      const lk = (this.look = { ...BASE, ...(nl || LOOKS[effect] || {}) });
      this.bg = this.paintBack(lk);
      this.ground = this.paintGround(lk);
      this.front = this.paintFront(lk);
      this.paintHalos(lk);
      this.sprites.camper = this.paintCamper(lk);
      this.sprites.boat = this.L.jetty ? this.paintBoat(lk) : null;
      this.mist = this.paintMist(lk);
      this.makeReeds(lk);
      this.makeStars(lk);
      this.makeFlies(lk.fireflies);
      this.buildMs = performance.now() - t0;
    }

    paintBack(lk) {
      const { H, L, X0, X1 } = this;
      const r = this.raster();
      const R = rng(7);
      const sky = lk.sky.map(C);
      // Ciel : dégradé tramé, puis couleur d'horizon jusqu'au lac.
      r.gradient(X0, 0, X1 - X0, L.skyEnd, sky, 12);
      r.rect(X0, L.skyEnd, X1 - X0, L.lakeY - L.skyEnd + 1, sky[sky.length - 1]);
      this.paintMilkyWay(r, lk);
      // Étoiles fixes, plus denses en haut.
      if (lk.stars > 0) {
        for (let y = 0; y < L.skyEnd + 10; y++) {
          for (let x = X0; x < X1; x++) {
            const d = lk.stars * 0.011 * Math.max(0, 1 - y / (H * 0.5));
            const h = hash(x, y, 77);
            if (h < d) r.set(x, y, mix(r.get(x, y), [255, 248, 230], 0.3 + (h / d) * 0.6));
          }
        }
      }
      if (lk.moon) this.paintMoon(r);
      this.paintClouds(r, lk);
      // Montagnes : la chaîne lointaine (pâle, enneigée) puis la chaîne moyenne.
      const horizon = sky[sky.length - 1];
      this.paintRange(r, L.farW, lk.far.map(C), lk.snowcap.map(C), lk.snowline, lk.farFade, horizon, 31);
      // Brume qui traîne au pied des montagnes lointaines.
      const mist = C(lk.mist);
      for (let y = L.lakeY - 30; y <= L.lakeY; y++) {
        const k = ((y - (L.lakeY - 30)) / 30) * lk.mistK * 0.8;
        for (let x = X0; x < X1; x++) if (y >= L.farW[x - X0] && bayer(x, y) < k) r.tint(x, y, mist, 0.35);
      }
      this.paintRange(r, L.midW, lk.mid.map(C), lk.snowcap.map((c) => mix(C(c), C(lk.mid[2]), 0.25)), lk.snowline * 0.7, lk.midFade, horizon, 47);
      this.paintFall(r, lk, horizon);
      this.paintHills(r, lk, R);
      this.paintLake(r, lk);
      this.paintFallFoam(r, lk);
      return r.toCanvas();
    }

    // La cascade (monde élargi) : elle sort d'une brèche de la chaîne moyenne, rebondit
    // sur une marche et plonge dans le lac. Ses couleurs viennent de la neige des sommets,
    // fondues dans l'air comme la montagne. Gelée en hiver.
    paintFall(r, lk, horizon) {
      const F = this.L.fall;
      if (!F) return;
      const { W, L } = this;
      r.lock(0, W);
      const fade = (c) => mix(c, horizon, Math.min(0.85, lk.midFade + 0.12));
      const sc = lk.snowcap.map(C);
      const hi = fade(mix(sc[1], [255, 255, 255], 0.35));
      const mid = fade(sc[0]);
      const lo = fade(sc[2]);
      const wet = fade(mix(C(lk.mid[2]), [4, 6, 12], 0.35));
      const frozen = !!lk.ice;
      const bottom = L.lakeY;
      // Roche mouillée, plus sombre, de part et d'autre de la chute.
      for (let y = F.y0 - 1; y < bottom; y++) {
        const u = (y - F.y0) / (bottom - F.y0);
        const half = 3 + u * 4;
        for (let x = Math.floor(F.x - half - 1); x <= Math.ceil(F.x + half + 1); x++) {
          if (y < this.at(L.midW, x) + 1) continue;
          if (bayer(x, y) < 0.75 - Math.abs(x - F.x) / (half + 2)) r.set(x, y, wet);
        }
      }
      // Deux chutes : la première tombe sur une marche (gerbe blanche), la seconde, plus
      // large et décalée, jusqu'au lac.
      const seg = (ya, yb, x0, w0, w1) => {
        for (let y = ya; y < yb; y++) {
          const u = (y - ya) / Math.max(1, yb - ya);
          const w = w0 + (w1 - w0) * u + (lk.ripples ? 0.6 : 0);
          for (let x = Math.round(x0 - w); x <= Math.round(x0 + w); x++) {
            const s = (x - x0) / (w + 0.5);
            const n = noise(x * 0.9, y * (frozen ? 0.25 : 0.11), 81);
            let c = n > 0.62 ? hi : n > 0.35 ? mid : lo;
            if (s > 0.55) c = c === hi ? mid : lo; // bord à l'ombre
            if (s < -0.6 && c === lo) c = mid;
            if (frozen && hash(x, y, 82) < 0.12) c = hi;
            r.set(x, y, c);
          }
        }
      };
      seg(F.y0, F.y1, F.x, 0.8, 1.6);
      seg(F.y1 + 1, bottom, F.x + 2, 1.4, 3.2);
      // La marche : rocher et gerbe d'écume.
      for (let x = F.x - 2; x <= F.x + 4; x++) {
        if (hash(x, 4, 83) < 0.8) r.set(x, F.y1 + 1, x < F.x || x > F.x + 2 ? wet : lo);
        if (Math.abs(x - F.x - 1) < 3 && hash(x, 3, 83) < 0.6) r.set(x, F.y1, hi);
      }
      F.cols = { hi, mid, lo };
      r.lock();
    }

    // Écume au pied de la cascade, sur le lac (glace en hiver).
    paintFallFoam(r, lk) {
      const F = this.L.fall;
      if (!F) return;
      const { W, L } = this;
      r.lock(0, W);
      const { hi } = F.cols;
      const cx = F.x + 2;
      for (let y = L.lakeY - 2; y < L.lakeY + 4; y++) {
        const dy = Math.abs(y - L.lakeY + 0.5);
        const half = 9 - dy * 1.8;
        for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
          const k = 1 - Math.abs(x - cx) / (half + 1) - dy * 0.12;
          if (k <= 0 || hash(x, y, 84) > k * (lk.ice ? 0.6 : 0.9)) continue;
          r.tint(x, y, hi, Math.min(0.85, 0.35 + k * 0.6));
        }
      }
      r.lock();
    }

    paintMilkyWay(r, lk) {
      if (!lk.milky) return;
      const { W, H } = this;
      // Bande diagonale, du bas à gauche vers le haut à droite, avec une raie de poussière.
      const ax = -0.42 * (H / W) * 1.0;
      const y0 = H * 0.46;
      const nrm = Math.sqrt(1 + ax * ax);
      const glowC = [150, 140, 190];
      for (let y = 0; y < this.L.skyEnd + 6; y++) {
        for (let x = this.X0; x < this.X1; x++) {
          const d = (y - (y0 + ax * x * 1.9)) / nrm;
          const w = 20;
          if (Math.abs(d) > w) continue;
          const n = fbm(x * 0.05, y * 0.05, 91, 4);
          let g = (1 - Math.abs(d) / w) ** 1.5 * (0.4 + n) * lk.milky;
          const dust = Math.abs(d + (n - 0.5) * 10) < 2.5 && n > 0.45;
          if (dust) g *= 0.25;
          const q = Math.floor(g * 4 + bayer(x, y)) / 4;
          if (q > 0) r.set(x, y, mix(r.get(x, y), glowC, Math.min(0.45, q * 0.28)));
          if (hash(x, y, 93) < g * 0.07) r.set(x, y, mix([255, 250, 240], glowC, hash(x, y, 94) * 0.5));
        }
      }
    }

    paintMoon(r) {
      const { x: mx, y: my, r: mr } = this.L.moon;
      const lit = C('#f4ecd2');
      const sh = C('#d6caa6');
      const crater = C('#c4b894');
      for (let y = -mr; y <= mr; y++) {
        for (let x = -mr; x <= mr; x++) {
          const d = Math.hypot(x, y);
          if (d > mr + 0.3) continue;
          let c = lit;
          // Partie dans l'ombre (lune gibbeuse) : tramée sur le bord gauche.
          const term = Math.hypot(x + 3.2, y) - (mr + 0.6);
          if (term < 0 && bayer(mx + x, my + y) < Math.min(1, -term / 2.5)) c = sh;
          if (term < -2.5) c = mix(sh, [60, 70, 100], 0.45);
          if (noise((mx + x) * 0.35, (my + y) * 0.35, 3) > 0.62 && term > -2.5) c = crater;
          if (d > mr - 0.8 && c === lit) c = mix(lit, [255, 255, 255], 0.4);
          r.set(mx + x, my + y, c);
        }
      }
    }

    paintClouds(r, lk) {
      const { H, L, X0, X1 } = this;
      const cc = lk.cloud.map(C);
      if (lk.clouds === 'overcast') {
        // Ciel couvert : couches de nuages bosselées, un peu plus claires vers l'horizon.
        for (let y = 0; y < L.skyEnd + 30; y++) {
          for (let x = X0; x < X1; x++) {
            const n = fbm(x * 0.018 + y * 0.01, y * 0.055, 9, 4) + (y / L.skyEnd) * 0.12;
            const q = n * 3 + (bayer(x, y) - 0.5) * 0.35;
            const c = q < 1.35 ? cc[0] : q < 1.75 ? cc[1] : cc[2];
            r.set(x, y, mix(r.get(x, y), c, 0.85));
          }
        }
        return;
      }
      if (lk.clouds === 'none') return;
      // Longs nuages effilés, éclairés par dessous par la lueur de l'horizon.
      const y0 = Math.round(H * 0.05);
      const y1 = Math.round(H * 0.36);
      const thr = lk.clouds === 'thin' ? 0.64 : 0.6;
      for (let y = y0; y < y1; y++) {
        for (let x = X0; x < X1; x++) {
          const n = fbm(x * 0.009 + y * 0.004, y * 0.12, 7, 4);
          if (n < thr) continue;
          const under = fbm(x * 0.009 + (y + 1) * 0.004, (y + 1) * 0.12, 7, 4) < thr;
          const lit = (y - y0) / (y1 - y0);
          let c = mix(cc[0], cc[1], Math.floor(lit * lit * 4 + bayer(x, y)) / 4);
          if (under) c = mix(c, cc[1], 0.5);
          if (n - thr < 0.02 && bayer(x, y) < 0.5) continue; // bords effilochés
          r.set(x, y, c);
        }
      }
    }

    // Une chaîne de montagnes : faces éclairées/à l'ombre, ravines, neige qui coule dans
    // les couloirs, et perspective atmosphérique vers la couleur de l'horizon.
    paintRange(r, top, cols, snowc, snowline, fade, horizon, seed) {
      // top : profil élargi (indice x − X0). Dans le cadre, tout est calculé comme sur le
      // fond d'écran (pente bornée au cadre, limite des neiges du cadre).
      const { W, L, X0, X1 } = this;
      const T = (x) => top[x - X0];
      const bottom = L.lakeY + 1;
      let ymin = 1e9;
      for (let x = 0; x < W; x++) ymin = Math.min(ymin, T(x));
      const sl = ymin + (bottom - ymin) * snowline;
      for (let x = X0; x < X1; x++) {
        const vp = x >= 0 && x < W;
        const g = vp ? T(Math.min(W - 1, x + 3)) - T(Math.max(0, x - 3)) : T(Math.min(X1 - 1, x + 3)) - T(Math.max(X0, x - 3));
        const tx = T(x);
        for (let y = tx; y < bottom; y++) {
          const d = y - tx;
          const facet = g * 0.55 + (noise(x * 0.12 + d * 0.07, d * 0.08, seed) - 0.5) * 8 + (noise(x * 0.035, 1.5, seed + 3) - 0.5) * 3;
          const face = facet > 1.1 ? 1 : facet < -1.4 ? 2 : 0;
          let c = cols[face];
          const streak = noise(x * 0.5, y * 0.06, seed + 5);
          const deep = (y - ymin) / (bottom - ymin);
          const snowy = y < sl + (streak - 0.5) * 16 && (d < 2 || streak > 0.3 + deep * 0.5);
          if (snowy && !(face === 2 && snowline > 1 && hash(x, y, seed) < 0.35)) c = snowc[face];
          if (d === 0 && face !== 2) c = mix(c, [255, 255, 255], 0.12);
          const f = fade + Math.max(0, deep - 0.55) * 0.5;
          const q = Math.floor(f * 6 + bayer(x, y)) / 6;
          r.set(x, y, mix(c, horizon, Math.min(0.85, q)));
        }
      }
    }

    // Collines boisées sur les côtés : plusieurs rangs de sapins, du plus lointain (petit,
    // bleuté) au plus proche (grand, sombre) ; feuillus colorés selon la saison.
    paintHills(r, lk, R) {
      const { W, L, X0, X1 } = this;
      const hillC = C(lk.hill);
      const mist = C(lk.mist);
      for (let x = X0; x < X1; x++) for (let y = L.hillW[x - X0]; y <= L.lakeY; y++) r.set(x, y, noise(x * 0.2, y * 0.2, 5) > 0.6 ? mix(hillC, mist, 0.12) : hillC);
      const pc = lk.pine.map(C);
      const fp = lk.farPine.map(C);
      const snow = lk.pineSnow ? lk.pineSnow.map(C) : null;
      const list = [];
      // Crête : sapins serrés qui découpent le ciel.
      for (let x = 0; x < W; x += 2 + Math.floor(R() * 3)) if (L.hill[x] < L.lakeY - 8) list.push({ x, b: L.hill[x] + 3 + R() * 3, h: 6 + R() * 7 });
      // Flancs.
      let area = 0;
      for (let x = 0; x < W; x++) area += Math.max(0, L.lakeY - L.hill[x]);
      const n = Math.round(area / 16);
      for (let i = 0; i < n; i++) {
        const x = Math.floor(R() * W);
        const tp = L.hill[x];
        if (tp > L.lakeY - 6) continue;
        const b = tp + 4 + R() * (L.lakeY + 1 - tp - 4);
        const depth = (b - tp) / (L.lakeY + 1 - tp);
        list.push({ x, b, h: 7 + depth * 14 + R() * 6 });
      }
      // Rive d'en face : une rangée continue de petits sapins.
      for (let x = 0; x < W; x += 2 + Math.floor(R() * 2)) list.push({ x, b: L.lakeY + 1, h: 4 + R() * 5 + (L.hill[x] < L.lakeY - 8 ? 7 : 0), shore: true });
      // Monde élargi : les mêmes rangs d'arbres continuent autour du cadre (hasard à part).
      // Le tri est stable : les arbres du cadre gardent exactement leur ordre.
      if (this.ext) list.push(...this.hillTreesExt());
      list.sort((a, b) => a.b - b.b);
      const decidRate = lk.decid === 'autumn' ? 0.33 : lk.decid === 'sakura' ? 0.2 : 0;
      for (const p of list) {
        r.lock(0, p.ext ? W : 0);
        const far = clamp((L.lakeY - p.b) / (this.H * 0.28), 0, 1);
        const k = 0.12 + far * 0.45;
        const seed = (p.x * 13 + Math.round(p.b) * 7) | 0;
        if (decidRate && p.h > 8 && hash(p.x, Math.round(p.b), 3) < decidRate) {
          const pal = this.leafPalette(lk.decid, hash(p.x, 1, 4)).map((c) => mix(c, mist, k * 0.8));
          broadleaf(r, p.x, p.b, p.h * 0.85, pal, seed);
          continue;
        }
        const base = p.shore && p.h < 9 ? [fp[0], fp[0], fp[1], fp[0]] : pc;
        const col = base.map((c) => mix(c, mist, k));
        pine(r, p.x, p.b, p.h, col, snow && snow.map((c) => mix(c, mist, k * 0.6)), seed);
      }
      r.lock();
    }

    // Arbres des collines hors du cadre : crêtes, flancs et rive d'en face.
    hillTreesExt() {
      const { L } = this;
      const R = rng(1007);
      const hill = (x) => L.hillW[x - this.X0];
      const F = L.fall;
      const list = [];
      for (const [a, b] of this.extSpans()) {
        for (let x = a; x < b; x += 2 + Math.floor(R() * 3)) if (hill(x) < L.lakeY - 8) list.push({ x, b: hill(x) + 3 + R() * 3, h: 6 + R() * 7, ext: true });
        let area = 0;
        for (let x = a; x < b; x++) area += Math.max(0, L.lakeY - hill(x));
        const n = Math.round(area / 16);
        for (let i = 0; i < n; i++) {
          const x = a + Math.floor(R() * (b - a));
          const tp = hill(x);
          if (tp > L.lakeY - 6) continue;
          const bb = tp + 4 + R() * (L.lakeY + 1 - tp - 4);
          const depth = (bb - tp) / (L.lakeY + 1 - tp);
          list.push({ x, b: bb, h: 7 + depth * 14 + R() * 6, ext: true });
        }
        for (let x = a; x < b; x += 2 + Math.floor(R() * 2)) {
          const h = 4 + R() * 5 + (hill(x) < L.lakeY - 8 ? 7 : 0);
          if (F && Math.abs(x - F.x - 2) < 7) continue; // la cascade tombe dans le lac
          list.push({ x, b: L.lakeY + 1, h, shore: true, ext: true });
        }
      }
      return list;
    }

    leafPalette(kind, h) {
      const pal = this.leafPaletteDay(kind, h);
      const k = this.look && this.look.leafNight;
      return k ? pal.map((c) => mix(c, NIGHT_TINT, k)) : pal;
    }
    leafPaletteDay(kind, h) {
      if (kind === 'sakura') {
        const pinks = [
          ['#a8577a', '#e08aac', '#f8c4d6', '#fff0f4'],
          ['#9a4a6e', '#d878a0', '#f2b0c8', '#ffffff'],
          ['#b06a8a', '#eaa0bc', '#fcd8e4', '#f0f8e0'],
        ];
        return [...pinks[Math.floor(h * 3)].map(C), C('#3a2420')];
      }
      const fall = [
        ['#8a2e1a', '#c84a22', '#e8803a', '#f4c050'],
        ['#9a5a1a', '#d88a2a', '#f0b84a', '#c84a22'],
        ['#6e2018', '#a8321e', '#d85a2a', '#f0a040'],
        ['#7a6a1a', '#b8a032', '#e0c850', '#d88a2a'],
      ];
      return [...fall[Math.floor(h * 4)].map(C), C('#2e1e16')];
    }

    // Le lac : miroir de tout ce qui est au-dessus, assombri, ondulé, rayé de reflets.
    paintLake(r, lk) {
      const { W, H, L, X0, X1 } = this;
      const water = C(lk.water);
      const skyHi = C(lk.sky[lk.sky.length - 2]);
      // Le lac descend jusqu'en bas de l'image : la rive proche (opaque) en recouvre le bas,
      // mais le plan du fond est ainsi peint en entier (la caméra d'ouverture s'y fie).
      for (let y = L.lakeY; y < H; y++) {
        const dy = y - L.lakeY;
        for (let x = X0; x < X1; x++) {
          const vp = x >= 0 && x < W;
          const wob = Math.round(Math.sin(y * 1.3 + Math.sin(x * 0.05) * 2) * Math.min(2, 0.4 + dy * 0.045));
          const sy = L.lakeY - 1 - dy;
          // Dans le cadre, le reflet est lu au bord du cadre comme sur le fond d'écran.
          const src = sy >= 0 ? r.get(vp ? clamp(x + wob, 0, W - 1) : x + wob, sy) : r.get(x, 0);
          let c = mix(src, water, 0.32 + Math.min(0.3, dy * 0.006));
          c = [c[0] * 0.84, c[1] * 0.86, c[2] * 0.92];
          // Vaguelettes : traits clairs (le ciel) et traits sombres.
          const hs = hash(x >> 2, y, 13);
          if (hs < 0.07 + dy * 0.0015) c = mix(c, skyHi, 0.35);
          else if (hs > 0.95) c = mix(c, [0, 0, 0], 0.25);
          if (dy === 0) c = mix(c, skyHi, 0.3);
          r.set(x, y, c);
        }
      }
      if (lk.ice) this.paintIce(r, lk);
      // La lueur du feu se pose sur l'eau près de la rive.
      lightW(r, [{ x: L.fireX, y: L.fireY - 8, r: 34, k: 0.6, sy: 2.2 }], [1, 1, 1], [0.45, 0.22, 0.04], (x, y) => y >= L.lakeY && y < L.shoreW[x - X0] + 2);
    }

    paintIce(r, lk) {
      const { L, X0, X1 } = this;
      // (La nuit, la glace s'éteint vers le bleu de la nuit.)
      const dim = (c) => (lk && lk.iceNight ? mix(C(c), NIGHT_TINT, lk.iceNight) : C(c));
      const ice = [dim('#6e83a2'), dim('#8ea2be'), dim('#b6c6da'), dim('#d6e0ee')];
      const crack = dim('#4a5e7c');
      for (let x = X0; x < X1; x++) {
        const edge = L.openY1 + Math.round((noise(x * 0.05, 2, 71) - 0.5) * 10);
        const farEdge = L.lakeY + 2 + Math.round(noise(x * 0.08, 5, 72) * 3);
        for (let y = L.lakeY; y < L.shoreW[x - X0] + 3; y++) {
          if (y > farEdge && y < edge) continue;
          const n = fbm(x * 0.06, y * 0.25, 73, 3);
          let c = n < 0.4 ? ice[0] : n < 0.52 ? ice[1] : n < 0.62 ? ice[2] : ice[3];
          if (Math.abs(noise(x * 0.09, y * 0.5, 74) - 0.5) < 0.03) c = crack;
          if (y === edge) c = ice[3];
          r.set(x, y, c);
        }
      }
    }

    paintGround(lk) {
      const { W, H, L, X0, X1 } = this;
      const R = rng(4242);
      const r = this.raster();
      const G = lk.ground.map(C);
      const D = lk.dirt.map(C);
      const K = lk.rock.map(C);
      const snowG = !!lk.snowGround;
      const fx = L.fireX;
      const fy = L.fireY;
      const mud = C(lk.mud);
      const inClear = (x, y, n) => {
        const ex = (x - fx + (snowG ? 4 : 12)) / (snowG ? 26 : 48);
        const ey = (y - fy - 1) / (snowG ? 7 : 11);
        return ex * ex + ey * ey + (n - 0.5) * 0.9 < 1;
      };
      // Hors du cadre : le sentier de terre battue qui descend de la cabane au ponton.
      const onPath = this.ext ? this.pathTest(snowG) : () => false;
      for (let x = X0; x < X1; x++) {
        const s0 = L.shoreW[x - X0];
        const vp = x >= 0 && x < W;
        for (let y = s0; y < H; y++) {
          const d = y - s0;
          const n = fbm(x * 0.07, y * 0.16, 21, 3);
          let c;
          const q = n + (bayer(x, y) - 0.5) * 0.12;
          if (inClear(x, y, n) || (!vp && onPath(x, y, n))) c = snowG ? mix(q > 0.52 ? D[1] : D[0], G[0], 0.3) : q > 0.52 ? D[1] : D[0];
          else c = q < 0.43 ? G[0] : q < 0.56 ? G[1] : G[2];
          if (d < 2 && !snowG) c = d === 0 ? mix(mud, C(lk.water), 0.3) : mix(mud, G[0], hash(x, y, 2) * 0.6);
          if (d === 0 && snowG) c = mix(G[0], [40, 50, 70], 0.3);
          r.set(x, y, c);
        }
      }
      // Brins d'herbe, fleurs, feuilles mortes ou pétales tombés.
      for (let i = 0; i < W * 1.3; i++) {
        const x = Math.floor(R() * W);
        const y = Math.floor(L.shore[x] + 3 + R() * (H - L.shore[x] - 3));
        if (inClear(x, y, 0.5)) continue;
        if (snowG) {
          if (R() < 0.12) r.set(x, y, C('#8a7e5a'));
          else if (R() < 0.2) r.set(x, y, C('#f4f8ff')); // scintillement de la neige
          continue;
        }
        const len = 1 + Math.floor(R() * 3);
        for (let k = 0; k < len; k++) r.set(x, y - k, k === len - 1 ? mix(G[2], [220, 230, 160], 0.15) : G[2]);
      }
      if (lk.flowers) for (let i = 0; i < W * 0.3; i++) {
        const x = Math.floor(R() * W);
        const y = Math.floor(L.shore[x] + 4 + R() * (H - L.shore[x] - 4));
        r.set(x, y, C(['#f2b0c8', '#fff4f8', '#f0d860', '#e888b0'][Math.floor(R() * 4)]));
      }
      if (lk.litter) for (let i = 0; i < W * 0.9; i++) {
        const x = Math.floor(R() * W);
        const y = Math.floor(L.shore[x] + 2 + R() * (H - L.shore[x] - 2));
        const c = C(['#c84a22', '#e8803a', '#f0b84a', '#8a2e1a', '#a8321e'][Math.floor(R() * 5)]);
        r.set(x, y, c);
        if (R() < 0.3) r.set(x + 1, y, c);
      }
      if (lk.decid === 'sakura') for (let i = 0; i < W * 0.4; i++) {
        const x = Math.floor(R() * W);
        r.set(x, Math.floor(L.shore[x] + 2 + R() * (H - L.shore[x] - 2)), C(R() < 0.5 ? '#f8c4d6' : '#e08aac'));
      }

      // Sapins de la rive proche (derrière la tente) et un à droite.
      const pc = lk.pine.map(C);
      const snow = lk.pineSnow ? lk.pineSnow.map(C) : null;
      const near = [
        [0.105, 0.33],
        [0.158, 0.25],
        [0.06, 0.2],
        [0.875, 0.29],
        [0.93, 0.2],
      ];
      for (const [fxp, fh] of near) {
        const x = Math.round(W * fxp);
        if (lk.decid && fxp === 0.06) broadleaf(r, x, L.shore[x] + 4, H * fh, this.leafPalette(lk.decid, 0.4), 55);
        else pine(r, x, L.shore[x] + 5, H * fh, pc, snow, 100 + x, { wide: 0.25 });
      }
      // Buissons au bord de l'eau.
      for (const bx of [0.2, 0.62, 0.82]) {
        const x = Math.round(W * bx);
        const y = L.shore[x] + 4;
        for (let k = 0; k < 40; k++) {
          const dx = Math.round((R() - 0.5) * 10);
          const dy = -Math.floor(R() * (5 - Math.abs(dx) * 0.4));
          r.set(x + dx, y + dy, snowG && dy < -2 ? C('#d6e0ee') : pc[dx > 1 ? 2 : 1]);
        }
      }
      // Rochers le long de la rive et un gros près du campement.
      const topC = snowG ? C('#dce6f2') : C('#3e5a30');
      for (const [px, rx, ry, dy] of [
        [0.27, 5, 3, 3],
        [0.3, 3, 2, 4],
        [0.56, 6, 4, 3],
        [0.76, 4, 3, 3],
        [0.79, 7, 5, 6],
        [0.64, 3, 2, 10],
        [0.03, 9, 6, 30],
      ]) {
        const x = Math.round(W * px);
        rock(r, x, L.shore[Math.min(W - 1, x)] + dy, rx, ry, K, R() < 0.6 ? topC : null);
      }
      // Champignons au pied des sapins de droite (sauf en hiver).
      if (!snowG) for (let i = 0; i < 7; i++) {
        const x = Math.round(W * (0.84 + R() * 0.08));
        const y = L.shore[x] + 8 + Math.floor(R() * 10);
        r.set(x, y, C('#d8d0c0'));
        r.rect(x - 1, y - 1, 3, 1, C('#b8322a'));
        r.set(x, y - 2, C('#b8322a'));
        r.set(x - 1, y - 1, C('#e8e0d0'));
      }
      this.paintCanoe(r, lk);
      this.paintTent(r, lk);
      this.paintCamp(r, lk);
      // Monde élargi : la rive continue (cadre verrouillé).
      if (this.ext) {
        r.lock(0, W);
        this.paintShoreExt(r, lk, onPath);
        r.lock();
      }
      // Vignette : le premier plan s'assombrit vers le bas de l'image.
      for (let y = H - 18; y < H; y++) {
        const k = (y - (H - 18)) / 18;
        for (let x = X0; x < X1; x++) if (bayer(x, y) < k * 0.95) r.tint(x, y, [0, 0, 0], 0.3);
      }

      // Éclairage : nuit froide + lueur chaude du feu et de la lanterne de la tente (et,
      // hors du cadre, de la fenêtre et de la lanterne de la cabane).
      lightW(r, this.lights(), lk.ambient, lk.warm, null, this.extLights());
      this.paintEmissive(r);
      return r.toCanvas();
    }

    lights() {
      const { L } = this;
      return [
        { x: L.fireX, y: L.fireY - 4, r: 26, k: 1.1, sy: 1.5 },
        { x: L.tentX, y: L.tentY - 7, r: 9, k: 0.55 },
      ];
    }

    /* ---------- La rive hors du cadre (monde élargi) ---------- */

    // Lumières de la cabane : la fenêtre (qui éclaire le sol devant) et la lanterne.
    extLights() {
      const c = this.L.cabin;
      if (!c) return null;
      return [
        { x: c.win.x + 3, y: c.win.y + 6, r: 16, k: 0.85, sy: 1.3 },
        { x: c.lamp.x, y: c.lamp.y + 1, r: 9, k: 0.55 },
      ];
    }

    // Le sentier : de la porte de la cabane jusqu'au ponton, en courbe.
    pathTest(snowG) {
      const { L } = this;
      const c = L.cabin;
      const J = L.jetty;
      if (!c || !J) return () => false;
      const ax = c.door.x + 2;
      const ay = c.y + 2;
      const bx = J.x + 2;
      const by = J.y + 3;
      const w = snowG ? 1.6 : 2.4;
      return (x, y, n) => {
        // Devant la porte : un petit replat.
        const ex = (x - ax - 2) / 9;
        const ey = (y - ay - 1) / 3;
        if (ex * ex + ey * ey + (n - 0.5) * 0.8 < 1) return true;
        if (x < ax || x > bx) return false;
        const t = (x - ax) / (bx - ax);
        const py = ay + (by - ay) * t + Math.sin(t * Math.PI) * 7;
        return Math.abs(y - py) + (n - 0.5) * 2.5 < w;
      };
    }

    // Feuillage des bouleaux selon la saison (null : branches nues).
    birchLeaf(lk) {
      if (lk.pineSnow) return null;
      if (lk.decid === 'autumn' && lk.leafNight) return ['#8a5a14', '#c8901e', '#ecc040'].map((c) => mix(C(c), NIGHT_TINT, lk.leafNight));
      if (lk.decid === 'autumn') return ['#8a5a14', '#c8901e', '#ecc040'].map(C);
      if (lk.decid === 'sakura') return ['#2e5a26', '#4e8a34', '#7ab84a'].map(C);
      return ['#22361e', '#34502a', '#4e6e34'].map(C);
    }

    // Tout ce qui pousse et se trouve sur la rive hors du cadre (cadre verrouillé).
    paintShoreExt(r, lk, onPath) {
      const { W, H, L } = this;
      const R = rng(4343);
      const G = lk.ground.map(C);
      const K = lk.rock.map(C);
      const snowG = !!lk.snowGround;
      const sh = (x) => this.at(L.shoreW, x);
      const pc = lk.pine.map(C);
      const snow = lk.pineSnow ? lk.pineSnow.map(C) : null;
      const fits = (x, rad) => x - rad >= this.X0 && x + rad < this.X1 && (x + rad < 0 || x - rad >= W);
      // Brins d'herbe, scintillements de neige, fleurs, feuilles mortes, pétales.
      for (const [a, b] of this.extSpans()) {
        const n = b - a;
        const rx = () => a + Math.floor(R() * n);
        for (let i = 0; i < n * 1.3; i++) {
          const x = rx();
          const y = Math.floor(sh(x) + 3 + R() * (H - sh(x) - 3));
          if (onPath(x, y, 0.5)) continue;
          if (snowG) {
            if (R() < 0.12) r.set(x, y, C('#8a7e5a'));
            else if (R() < 0.2) r.set(x, y, C('#f4f8ff'));
            continue;
          }
          const len = 1 + Math.floor(R() * 3);
          for (let k = 0; k < len; k++) r.set(x, y - k, k === len - 1 ? mix(G[2], [220, 230, 160], 0.15) : G[2]);
        }
        if (lk.flowers) for (let i = 0; i < n * 0.3; i++) {
          const x = rx();
          r.set(x, Math.floor(sh(x) + 4 + R() * (H - sh(x) - 4)), C(['#f2b0c8', '#fff4f8', '#f0d860', '#e888b0'][Math.floor(R() * 4)]));
        }
        if (lk.litter) for (let i = 0; i < n * 0.9; i++) {
          const x = rx();
          const y = Math.floor(sh(x) + 2 + R() * (H - sh(x) - 2));
          const c = C(['#c84a22', '#e8803a', '#f0b84a', '#8a2e1a', '#a8321e'][Math.floor(R() * 5)]);
          r.set(x, y, c);
          if (R() < 0.3) r.set(x + 1, y, c);
        }
        if (lk.decid === 'sakura') for (let i = 0; i < n * 0.4; i++) {
          const x = rx();
          r.set(x, Math.floor(sh(x) + 2 + R() * (H - sh(x) - 2)), C(R() < 0.5 ? '#f8c4d6' : '#e08aac'));
        }
      }
      // Le ponton s'avance dans l'anse (derrière tout ce qui est sur la rive).
      this.paintJetty(r, lk);
      // Sapins et bouleaux de la rive.
      const leaf = this.birchLeaf(lk);
      const NEAR = [
        ['pine', 0.085, 0.26], ['birch', 0.135, 0.31], ['birch', 0.155, 0.22],
        ['pine', 0.44, 0.33], ['birch', 0.485, 0.35], ['birch', 0.515, 0.27],
        ['pine', 0.745, 0.37], ['pine', 0.8, 0.25], ['broad', 0.86, 0.22],
        ['birch', 0.9, 0.31], ['birch', 0.935, 0.37], ['birch', 0.975, 0.26],
        ['pine', 1.08, 0.3], ['pine', 1.17, 0.39], ['broad', 1.23, 0.2], ['pine', 1.28, 0.27],
        ['birch', 1.345, 0.31], ['pine', 1.42, 0.36], ['pine', 1.5, 0.29], ['pine', 1.575, 0.41],
        ['pine', -1.1, 0.3], ['birch', -1.17, 0.28],
      ];
      for (const [kind, u, fh] of NEAR) {
        const x = Math.round(-u * W);
        const h = H * fh;
        if (!fits(x, h * (kind === 'birch' ? 0.2 : 0.27))) continue;
        const seed = 300 + Math.round(u * 1000);
        if (kind === 'birch') birch(r, x, sh(x) + 5, h, leaf, seed, { snow });
        else if (kind === 'broad' && lk.decid) broadleaf(r, x, sh(x) + 4, h, this.leafPalette(lk.decid, hash(seed, 2, 4)), seed);
        else pine(r, x, sh(x) + 5, kind === 'broad' ? h * 1.4 : h, pc, snow, seed, { wide: 0.25 });
      }
      // La cabane, puis ce qui est devant : buissons, rochers, champignons.
      this.paintCabin(r, lk);
      for (const u of [0.29, 0.6, 0.85, 1.14, 1.38, 1.53]) {
        const x = Math.round(-u * W);
        if (!fits(x, 6)) continue;
        const y = sh(x) + 4;
        for (let k = 0; k < 40; k++) {
          const dx = Math.round((R() - 0.5) * 10);
          const dy = -Math.floor(R() * (5 - Math.abs(dx) * 0.4));
          r.set(x + dx, y + dy, snowG && dy < -2 ? C('#d6e0ee') : pc[dx > 1 ? 2 : 1]);
        }
      }
      const topC = snowG ? C('#dce6f2') : C('#3e5a30');
      for (const [u, rx, ry, dy] of [
        [0.115, 3, 2, 14], [0.255, 5, 3, 3], [0.275, 3, 2, 4], [0.37, 6, 4, 3], [0.56, 4, 3, 6],
        [0.7, 7, 5, 4], [0.835, 5, 3, 3], [1.04, 10, 6, 26], [1.245, 4, 3, 3], [1.46, 6, 4, 4], [-1.06, 6, 4, 22],
      ]) {
        const x = Math.round(-u * W);
        if (!fits(x, rx)) continue;
        rock(r, x, sh(x) + dy, rx, ry, K, R() < 0.6 ? topC : null);
      }
      if (!snowG) for (const u of [1.1, 1.2, 1.44]) for (let i = 0; i < 4; i++) {
        const x = Math.round(-u * W + (R() - 0.5) * 16);
        if (!fits(x, 2)) continue;
        const y = sh(x) + 8 + Math.floor(R() * 10);
        r.set(x, y, C('#d8d0c0'));
        r.rect(x - 1, y - 1, 3, 1, C('#b8322a'));
        r.set(x, y - 2, C('#b8322a'));
        r.set(x - 1, y - 1, C('#e8e0d0'));
      }
    }

    // Ponton de bois : il part de la rive et s'enfonce dans l'anse (vu en perspective, il
    // rétrécit en s'éloignant), sur des pilotis, avec un poteau d'amarrage au bout.
    paintJetty(r, lk) {
      const J = this.L.jetty;
      if (!J) return;
      const Wd = [C('#2a1c12'), C('#4a3424'), C('#6a4e36'), C('#866648')];
      const snowG = !!lk.snowGround;
      const len = 21;
      const wet = mix(Wd[0], [10, 22, 34], 0.45);
      const row = (i) => {
        const t = i / (len - 1);
        const cx = J.x - t * 11;
        const half = 7 - t * 2.6;
        return { y: J.y - i, xa: Math.round(cx - half), xb: Math.round(cx + half) };
      };
      // Pilotis (côté droit, que l'on voit) et leurs reflets, du fond vers nous.
      for (let i = len - 1; i >= 4; i -= 5) {
        const { y, xa, xb } = row(i);
        const deep = 3 + Math.round(i * 0.08);
        for (const [px, d] of [[xb + 1, deep], [xa, 1]]) {
          for (let k = 1; k <= d; k++) r.set(px, y + k, k > d - 2 ? wet : Wd[0]);
          if (d > 1) {
            for (let k = d + 1; k < d + 5; k++) if ((k + px) % 2) r.set(px, y + k, Wd[0], 90);
            r.set(px - 1, y + d, C('#8ea4bc'), 140);
            r.set(px + 1, y + d, C('#8ea4bc'), 140);
          }
        }
      }
      // Plancher : planches en travers, joints sombres, tranche du côté droit.
      for (let i = len - 1; i >= 0; i--) {
        const { y, xa, xb } = row(i);
        const gap = i % 3 === 2;
        for (let x = xa; x <= xb; x++) {
          let c = gap ? Wd[1] : hash(x >> 1, i, 92) < 0.5 ? Wd[2] : Wd[3];
          if (x === xa) c = Wd[1];
          if (snowG) c = gap || x === xa ? C('#a8b6cc') : C('#dfe8f4');
          r.set(x, y, c);
        }
        r.set(xb + 1, y, Wd[0]);
      }
      // Poteau d'amarrage au bout, côté droit.
      const e = row(len - 1);
      for (let k = 0; k <= 5; k++) {
        r.set(e.xb, e.y - k, k === 5 ? Wd[3] : Wd[1]);
        r.set(e.xb + 1, e.y - k, Wd[0]);
      }
      if (snowG) r.set(e.xb, e.y - 6, C('#dfe8f4'));
      J.end = { x: e.xb, y: e.y };
    }

    // Cabane en rondins : long pan à gauche dans l'ombre, pignon face à nous, porte,
    // fenêtre allumée, lanterne, cheminée de pierre, tas de bois.
    paintCabin(r, lk) {
      const c = this.L.cabin;
      if (!c) return;
      const cx = c.x;
      const b = c.y;
      const { fw, wallH } = c;
      const snowG = !!lk.snowGround;
      const log = [C('#2e1e12'), C('#56381f'), C('#74502c'), C('#8c6638')]; // joint, sombre, moyen, clair
      const roofC = [C('#1e1a18'), C('#3a302c'), C('#4e423a')];
      const snowC = [C('#e6eef8'), C('#b4c2d8')];
      const xl = cx - fw;
      const [vx, vy] = c.depth;
      // Ombre au sol.
      for (let x = xl + vx - 2; x < cx + fw + 6; x++) for (let y = b - 1; y < b + 3; y++) r.tint(x, y, [0, 0, 0], 0.4);
      // Mur de côté (fuyant vers le fond), dans l'ombre.
      fillPoly(r, [[xl, b - wallH + 1], [xl, b + 0.5], [xl + vx, b + vy + 0.5], [xl + vx, b - wallH + 1 + vy]], (x, y) => {
        const s = y - (x - xl) * (vy / vx);
        const k = (((b - Math.round(s)) % 3) + 3) % 3;
        const col = k === 0 ? log[0] : k === 1 ? log[1] : mix(log[1], log[2], 0.5);
        return mix(col, [8, 10, 18], 0.25);
      });
      // Long pan du toit (bardeaux en rangées), poudré de neige en hiver.
      const apex = c.apex;
      const eave = [xl - 3, b - wallH + 1];
      const E = [eave[0] - apex[0], eave[1] - apex[1]];
      const det = E[0] * vy - E[1] * vx;
      fillPoly(r, [apex, eave, [eave[0] + vx, eave[1] + vy], [apex[0] + vx, apex[1] + vy]], (x, y) => {
        const px = x + 0.5 - apex[0];
        const py = y + 0.5 - apex[1];
        const a = (px * vy - py * vx) / det;
        const course = a * 6;
        const edge = course - Math.floor(course) > 0.72;
        if (snowG) return edge && hash(x, y, 95) < 0.6 ? snowC[1] : snowC[0];
        let col = Math.floor(course) % 2 ? roofC[1] : roofC[2];
        if (edge) col = roofC[0];
        if (hash(x, y, 96) < 0.1) col = roofC[0];
        return col;
      });
      // Cheminée de pierre qui dépasse du faîtage.
      const ch = c.chim;
      for (let y = ch.y + 1; y <= b - 21; y++) {
        for (let x = ch.x - 1; x <= ch.x + 1; x++) {
          const st = hash(x, y >> 1, 97);
          r.set(x, y, x === ch.x + 1 ? C('#3a3a40') : st < 0.3 ? C('#4a4a52') : st < 0.7 ? C('#6a6a72') : C('#82828a'));
        }
      }
      r.rect(ch.x - 2, ch.y + 1, 5, 1, C('#5a5a62'));
      if (snowG) r.rect(ch.x - 2, ch.y, 5, 1, snowC[0]);
      // Façade en rondins, bouts des rondins aux angles.
      for (let y = b - wallH + 1; y <= b; y++) {
        const k = (b - y) % 3;
        for (let x = xl; x <= cx + fw; x++) {
          let col = k === 0 ? log[0] : k === 1 ? log[2] : log[3];
          if (k !== 0 && hash(x >> 2, y, 98) < 0.15) col = log[1];
          r.set(x, y, col);
        }
        if (k !== 0) {
          r.set(cx + fw + 1, y, k === 2 ? C('#c09060') : C('#9a7048'));
          r.set(xl - 1, y, k === 2 ? C('#a07850') : C('#7a5838'));
        }
      }
      // Pignon en planches verticales, petite lucarne.
      fillPoly(r, [[apex[0], apex[1] + 1], [xl, b - wallH + 0.5], [cx + fw + 1, b - wallH + 0.5]], (x) => ((x - cx) % 3 === 0 ? log[1] : log[2]));
      r.rect(cx - 1, b - wallH - 5, 3, 2, C('#1a120c'));
      // Planches de rive du toit (deux pixels d'épaisseur).
      const board = (x0, y0, x1, y1) => {
        line(r, x0, y0, x1, y1, roofC[2]);
        line(r, x0, y0 + 1, x1, y1 + 1, roofC[0]);
        if (snowG) line(r, x0, y0 - 1, x1, y1 - 1, snowC[0]);
      };
      board(apex[0], apex[1] - 1, xl - 3, b - wallH + 1);
      board(apex[0], apex[1] - 1, cx + fw + 3, b - wallH + 1);
      // Porte, marche, poignée.
      const d = c.door;
      r.rect(d.x - 1, d.y - 1, d.w + 2, d.h + 1, log[0]);
      for (let x = d.x; x < d.x + d.w; x++) for (let y = d.y; y < d.y + d.h; y++) r.set(x, y, (x - d.x) % 2 ? C('#3e2818') : C('#4e3420'));
      r.set(d.x + d.w - 2, d.y + 4, C('#c8a060'));
      r.rect(d.x - 2, b + 1, d.w + 4, 1, log[3]);
      // Fenêtre (le verre est peint après l'éclairage) et son rebord.
      const w = c.win;
      r.rect(w.x - 1, w.y - 1, w.w + 2, w.h + 2, log[0]);
      r.rect(w.x - 1, w.y + w.h + 1, w.w + 2, 1, log[3]);
      if (snowG) r.rect(w.x - 1, w.y + w.h, w.w + 2, 1, snowC[0]);
      else if (!lk.litter) for (let x = w.x; x < w.x + w.w; x++) r.set(x, w.y + w.h + 2, hash(x, 2, 99) < 0.5 ? C('#c84a5a') : C('#e8c050'));
      // Applique de la lanterne.
      r.set(c.lamp.x, c.lamp.y - 1, C('#1a1612'));
      r.set(c.lamp.x - 1, c.lamp.y - 1, C('#1a1612'));
      // Tas de bois sous l'avancée, côté droit.
      const wood = { o: '#5a3a22', i: '#c8965a', c: '#8a6038' };
      const logE = ['.oo.', 'oico', 'ocio', '.oo.'];
      for (const [dx, dy] of [[0, 0], [4, 0], [8, 0], [2, -3], [6, -3], [4, -6]]) stamp(r, logE, wood, cx + fw + 3 + dx, b - 3 + dy);
      if (snowG) r.rect(cx + fw + 6, b - 10, 4, 1, snowC[0]);
      // Banc contre la façade.
      r.rect(cx - 2, b - 3, 3, 1, log[3]);
      r.set(cx - 2, b - 2, log[0]);
      r.set(cx, b - 2, log[0]);
    }

    // Pixels qui émettent leur propre lumière (peints après l'éclairage).
    paintEmissive(r) {
      const c = this.L.cabin;
      if (!c) return;
      r.lock(0, this.W);
      const w = c.win;
      for (let y = w.y; y < w.y + w.h; y++) {
        for (let x = w.x; x < w.x + w.w; x++) {
          const u = (y - w.y) / (w.h - 1);
          let col = mix(C('#ffe8b0'), C('#f0a048'), Math.floor(u * 3 + bayer(x, y)) / 3);
          if (x === w.x + 3 || y === w.y + 2) col = C('#4a2e18'); // croisillon
          if (x === w.x && y > w.y) col = C('#c06a3a'); // rideau
          r.set(x, y, col);
        }
      }
      r.set(c.lamp.x, c.lamp.y, C('#fff0b8'));
      r.set(c.lamp.x, c.lamp.y + 1, C('#ffc860'));
      r.lock();
    }

    // La barque amarrée au ponton (elle se balance doucement : dessinée à chaque image).
    paintBoat(lk) {
      const rows = [
        'g..................g',
        'gg................gg',
        '.gGGGGsGGGGGGsGGGGg.',
        '.rrrrrrrrrrrrrrrrrr.',
        '..hhhhhhhhhhhhhhhh..',
        '...HHHHHHHHHHHHHH...',
      ];
      const r = new Raster(20, 6);
      stamp(r, rows, { g: '#d8c8a8', G: '#5a3e28', s: '#8a6a48', r: '#a8402e', h: '#c8c2b2', H: '#3e5e6a' }, 0, 0);
      if (lk.snowGround) for (let x = 2; x < 18; x++) r.set(x, 2, C(hash(x, 1, 3) < 0.7 ? '#e6eef8' : '#b4c2d8'));
      const J = this.L.jetty;
      const ox = J.end.x + 5;
      const oy = J.end.y + 1;
      PXC.applyLight(r, [], lk.ambient, lk.warm);
      const img = r.toCanvas();
      return { img, x: ox, y: oy };
    }

    paintCanoe(r) {
      const { L } = this;
      const x0 = L.canoeX;
      const y0 = L.shore[x0 + 14] - 2;
      const rows = [
        'g..........................g',
        'gg........................gg',
        '.gGGGGGGGGGGGGGGGGGGGGGGGGg.',
        '.hhhhhhhhhhhhhhhhhhhhhhhhhh.',
        '..hhhhhhhhhhhhhhhhhhhhhhhh..',
        '...HHHHHHHHHHHHHHHHHHHHHH...',
        '.....HHHHHHHHHHHHHHHHHH.....',
      ];
      stamp(r, rows, { g: '#e8d8b0', G: '#b08050', h: '#b8442e', H: '#7a2a1c' }, x0, y0);
      // Pagaie posée en travers.
      line(r, x0 + 6, y0 + 9, x0 + 24, y0 + 7, C('#8a6038'));
      r.rect(x0 + 24, y0 + 6, 4, 2, C('#a87848'));
    }

    paintTent(r, lk) {
      const { L } = this;
      const tx = L.tentX;
      const ty = L.tentY;
      const [tc, ts, seam] = lk.tent.map(C);
      const apex = [tx, ty - 24];
      const back = [tx - 18, ty - 22];
      // Ombre au sol.
      for (let x = tx - 36; x < tx + 20; x++) for (let y = ty - 1; y < ty + 2; y++) r.tint(x, y, [0, 0, 0], 0.35);
      // Pan latéral (à l'ombre), avec coutures.
      fillPoly(r, [apex, back, [tx - 33, ty - 1], [tx - 15, ty + 0.5]], (x, y) => {
        let c = (x - tx) % 6 === 0 ? seam : ts;
        if (lk.snowGround) {
          const topY = apex[1] + ((x - tx) / -18) * 2;
          if (y - topY < 5 + noise(x * 0.3, 1, 5) * 4) c = C(y - topY < 2 ? '#e6eef8' : '#b4c2d8');
        }
        return c;
      });
      // Face avant (éclairée par le feu), porte ouverte sur l'intérieur où brille une lanterne.
      fillPoly(r, [apex, [tx - 15.5, ty + 0.5], [tx + 15.5, ty + 0.5]], (x, y) => {
        const s = (x - tx) / ((y - apex[1]) * 0.66 + 1);
        let c = s < -0.75 ? mix(tc, ts, 0.5) : s > 0.8 ? mix(tc, [255, 220, 170], 0.15) : tc;
        if (lk.snowGround && Math.abs(Math.abs(x - tx) - (y - apex[1]) * 0.62) < 1.2) c = C('#e6eef8');
        return c;
      });
      const door = [[tx, ty - 17], [tx - 7.5, ty + 0.5], [tx + 7.5, ty + 0.5]];
      const glowHi = C('#ffe2a0');
      const glowLo = C('#b05a28');
      fillPoly(r, door, (x, y) => {
        const u = (y - (ty - 17)) / 17;
        const q = Math.floor(u * 4 + bayer(x, y)) / 4;
        return mix(glowHi, glowLo, q * 0.8);
      });
      // Sac de couchage et silhouette de la lanterne à l'intérieur.
      r.rect(tx - 4, ty - 3, 8, 3, C('#3a5a7a'));
      r.rect(tx - 4, ty - 3, 8, 1, C('#5a7a9a'));
      r.rect(tx + 1, ty - 9, 2, 3, C('#fff4c8'));
      r.set(tx + 1, ty - 10, C('#3a2a1a'));
      // Rabats noués de chaque côté de la porte.
      line(r, tx - 1, ty - 17, tx - 8, ty, seam);
      line(r, tx + 1, ty - 17, tx + 8, ty, seam);
      r.rect(tx - 10, ty - 8, 3, 3, mix(tc, ts, 0.3));
      r.rect(tx + 8, ty - 8, 3, 3, mix(tc, [255, 220, 170], 0.1));
      // Mât, faîtage, haubans et piquets.
      r.rect(tx, ty - 27, 1, 3, C('#5a4a3a'));
      line(r, apex[0], apex[1], back[0], back[1], mix(ts, [255, 255, 255], 0.15));
      const rope = C('#8a8070');
      line(r, tx, ty - 25, tx + 26, ty + 1, rope);
      line(r, tx - 18, ty - 23, tx - 42, ty - 1, rope);
      r.rect(tx + 26, ty, 1, 2, C('#c0b8a8'));
      r.rect(tx - 42, ty - 1, 1, 2, C('#c0b8a8'));
      // Sac à dos contre la tente.
      stamp(r, ['.ggg.', 'gGGGg', 'gGsGg', 'gGGGg', 'gssGg', 'gGGGg', '.ggg.'], { g: '#2a3e2a', G: '#3e5e3a', s: '#8a7a50' }, tx + 15, ty - 7);
      // Tas de bois coupé (bûches vues par le bout).
      const wood = { o: '#5a3a22', i: '#c8965a', c: '#8a6038' };
      const log = ['.oo.', 'oico', 'ocio', '.oo.'];
      for (const [dx, dy] of [[0, 0], [4, 0], [8, 0], [2, -3], [6, -3], [4, -6]]) stamp(r, log, wood, tx - 46 + dx, ty - 4 + dy);
      if (lk.snowGround) r.rect(tx - 43, ty - 11, 7, 1, C('#dce6f2'));
    }

    paintCamp(r, lk) {
      const { L } = this;
      const fx = L.fireX;
      const fy = L.fireY;
      const cx = L.campX;
      // Bûche où le campeur est assis (bout coupé éclairé côté feu).
      const bark = C('#4a3020');
      const barkHi = C('#6a4a30');
      r.rect(cx - 6, fy - 1, 16, 4, bark);
      r.rect(cx - 6, fy - 1, 16, 1, barkHi);
      for (let x = cx - 5; x < cx + 10; x += 3) r.set(x, fy + 1, C('#2e1e14'));
      stamp(r, ['.ii.', 'icci', 'icci', '.ii.'], { i: '#c8965a', c: '#8a6038' }, cx + 9, fy - 1);
      if (lk.snowGround) r.rect(cx - 6, fy - 2, 14, 1, C('#dce6f2'));
      // Deuxième bûche, vide, de l'autre côté du feu.
      r.rect(fx + 11, fy - 1, 13, 4, bark);
      r.rect(fx + 11, fy - 1, 13, 1, barkHi);
      stamp(r, ['.ii.', 'icci', 'icci', '.ii.'], { i: '#c8965a', c: '#8a6038' }, fx + 8, fy - 1);
      if (lk.snowGround) r.rect(fx + 13, fy - 2, 10, 1, C('#dce6f2'));
      // Cercle de pierres et bois calciné.
      const stone = [C('#3a3a40'), C('#6a6870')];
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const sx = Math.round(fx + Math.cos(ang) * 8);
        const sy = Math.round(fy + 1 + Math.sin(ang) * 2.4);
        r.rect(sx, sy, 2, 2, stone[0]);
        r.set(sx, sy, stone[1]);
      }
      line(r, fx - 5, fy + 1, fx + 4, fy - 1, C('#2a1810'));
      line(r, fx - 4, fy - 1, fx + 5, fy + 1, C('#3a2214'));
      // Souche avec une hache plantée.
      const sx = fx + 38;
      const sy = fy - 3;
      stamp(r, ['.ssss.', 'siiiis', 'sicciS', 'bbbbbB', 'bbbbbB', 'bbbbbB', 'b.bb.B'], { s: '#7a5a3a', i: '#c8965a', c: '#8a6038', b: '#4a3020', B: '#6a4a30' }, sx, sy);
      line(r, sx + 3, sy, sx + 7, sy - 7, C('#8a6038'));
      stamp(r, ['MM.', 'MMm', '.Mm'], { M: '#8a8c94', m: '#c8ccd4' }, sx + 1, sy - 2);
      if (lk.snowGround) r.rect(sx, sy - 1, 6, 1, C('#dce6f2'));
      // Petite casserole sur une pierre.
      stamp(r, ['.....k', 'mmmmmk', 'MmmmM.', 'MMMMM.'], { m: '#7a7c84', M: '#4a4c54', k: '#2a2a30' }, fx + 13, fy - 5);
      // Bâche tendue au-dessus du campeur quand il pleut.
      if (lk.tarp) {
        const tc = C('#3a5a6e');
        const th = C('#5a7a8e');
        const ax = L.tentX + 1;
        const ay = L.tentY - 24;
        const bx = cx + 14;
        const by = fy - 20;
        for (let x = ax; x <= bx; x++) {
          const y = Math.round(ay + ((by - ay) * (x - ax)) / (bx - ax) + Math.sin(((x - ax) / (bx - ax)) * Math.PI) * 2);
          r.set(x, y, th);
          r.set(x, y + 1, tc);
          r.set(x, y + 2, tc);
        }
        r.rect(bx, by, 1, fy + 2 - by, C('#5a4a3a'));
      }
    }

    // Premier plan : deux grands sapins qui encadrent la vue, la branche de la chouette,
    // des fougères (ou des congères) dans les coins.
    paintFront(lk) {
      const { W, H, L } = this;
      const r = this.raster();
      const pc = lk.pine.map((c) => mix(C(c), [4, 6, 8], 0.45));
      pc[3] = C('#120c0a');
      const snow = lk.pineSnow ? lk.pineSnow.map((c) => mix(C(c), [30, 40, 60], 0.15)) : null;
      // Branche morte de la chouette (sort du sapin de droite).
      const by = L.owl.y + 10;
      const bc = C('#2a1e16');
      const bh = C('#4a3a2c');
      for (let x = W - 70; x < W - 12; x++) {
        const y = by + (x < W - 64 ? Math.round((W - 64 - x) * 0.4) * -1 : 0);
        r.set(x, y, bh);
        r.set(x, y + 1, bc);
        if (x > W - 40) r.set(x, y + 2, bc);
      }
      line(r, W - 52, by, W - 46, by - 6, bc);
      if (snow) r.rect(W - 46, by - 1, 30, 1, snow[1]);
      pine(r, -3, H + 6, H * 1.18, pc, snow, 901, { tierH: 15, wide: 0.19 });
      pine(r, W + 2, H + 6, H * 1.12, pc, snow, 902, { tierH: 16, wide: 0.17 });
      // Fougères ou congères dans les coins du bas.
      const R = rng(55);
      for (const [x0, dir] of [[30, 1], [W - 36, -1], [W - 70, 1]]) {
        if (lk.snowGround) {
          for (let x = -10; x <= 10; x++) {
            const hgt = Math.round(5 * Math.sqrt(1 - (x / 11) ** 2));
            for (let y = 0; y < hgt; y++) r.set(x0 + x, H - 1 - y, C(y === hgt - 1 ? '#dfe8f4' : '#a8b6cc'));
          }
          continue;
        }
        const fern = [C('#122016'), C('#1c3220'), C('#2a4a2c')];
        for (let f = 0; f < 6; f++) {
          const ang = -Math.PI / 2 + (f - 2.5) * 0.38 * dir + (R() - 0.5) * 0.2;
          const len = 10 + Math.floor(R() * 9);
          for (let k = 0; k < len; k++) {
            const bx = Math.round(x0 + Math.cos(ang) * k + dir * (k * k) / 40);
            const yy = Math.round(H - 1 + Math.sin(ang) * k + (k * k) / 30);
            r.set(bx, yy, fern[0]);
            const leaf = Math.round((1 - k / len) * 3);
            if (k % 2 === 0) for (let s = 1; s <= leaf; s++) {
              r.set(bx - s, yy + (s >> 1), fern[s === 1 ? 1 : 2]);
              r.set(bx + s, yy + (s >> 1), fern[1]);
            }
          }
        }
      }
      // Monde élargi : d'autres grands arbres, des fougères et un tronc couché.
      if (this.ext) {
        r.lock(0, W);
        this.paintFrontExt(r, lk, pc, snow);
        r.lock();
      }
      const amb = lk.ambient.map((v) => v * 0.9);
      lightW(r, this.lights(), amb, lk.warm);
      return r.toCanvas();
    }

    // Premier plan hors du cadre : un grand sapin, deux bouleaux tout proches, des
    // fougères (ou des congères) et un vieux tronc moussu couché dans l'herbe.
    paintFrontExt(r, lk, pc, snow) {
      const { W, H } = this;
      const R = rng(5555);
      const leaf = this.birchLeaf(lk);
      const dk = leaf && leaf.map((c) => mix(c, [4, 6, 8], 0.5));
      pine(r, Math.round(-1.53 * W), H + 6, H * 1.16, pc, snow, 903, { tierH: 15, wide: 0.18 });
      for (const [u, hk, seed] of [[0.68, 1.3, 911], [0.715, 1.15, 912]]) {
        birch(r, Math.round(-u * W), H + 4, H * hk, dk, seed, { tw: 4, dark: 0.45, bl: 0.4, low: 0.66, snow: snow && snow.map((c) => mix(c, [20, 26, 40], 0.3)) });
      }
      // Tronc couché, moussu (ou enneigé).
      const lx0 = Math.round(-1.17 * W);
      const lx1 = Math.round(-1.0 * W);
      const bark = [C('#140e0a'), C('#24180f'), C('#36261a')];
      const moss = snowG(lk) ? [C('#a8b6cc'), C('#dfe8f4')] : [C('#1c3220'), C('#2a4a2c')];
      for (let x = lx0; x <= lx1; x++) {
        const y0 = H - 7 + Math.round((x - lx0) * 0.03);
        for (let y = y0; y < y0 + 5; y++) r.set(x, y, y === y0 + 4 ? bark[0] : (x + y) % 5 === 0 ? bark[0] : y < y0 + 2 ? bark[2] : bark[1]);
        if (hash(x, 1, 41) < 0.8) r.set(x, y0 - 1, moss[hash(x, 2, 42) < 0.5 ? 0 : 1]);
        if (hash(x, 3, 43) < 0.3) r.set(x, y0 - 2, moss[0]);
      }
      stamp(r, ['.oo.', 'oico', 'ocio', 'oico', '.oo.'], { o: '#24180f', i: '#5a4430', c: '#3a2c20' }, lx1 - 1, H - 8);
      // Fougères ou congères.
      for (const [u, dir] of [[0.19, -1], [0.43, 1], [0.95, -1], [1.25, 1], [1.42, -1]]) {
        const x0 = Math.round(-u * W);
        if (snowG(lk)) {
          for (let x = -11; x <= 11; x++) {
            const hgt = Math.round(5 * Math.sqrt(Math.max(0, 1 - (x / 12) ** 2)));
            for (let y = 0; y < hgt; y++) r.set(x0 + x, H - 1 - y, C(y === hgt - 1 ? '#dfe8f4' : '#a8b6cc'));
          }
          continue;
        }
        const fern = [C('#122016'), C('#1c3220'), C('#2a4a2c')];
        for (let f = 0; f < 6; f++) {
          const ang = -Math.PI / 2 + (f - 2.5) * 0.38 * dir + (R() - 0.5) * 0.2;
          const len = 10 + Math.floor(R() * 9);
          for (let k = 0; k < len; k++) {
            const bx = Math.round(x0 + Math.cos(ang) * k + (dir * (k * k)) / 40);
            const yy = Math.round(H - 1 + Math.sin(ang) * k + (k * k) / 30);
            r.set(bx, yy, fern[0]);
            const lf = Math.round((1 - k / len) * 3);
            if (k % 2 === 0) for (let s = 1; s <= lf; s++) {
              r.set(bx - s, yy + (s >> 1), fern[s === 1 ? 1 : 2]);
              r.set(bx + s, yy + (s >> 1), fern[1]);
            }
          }
        }
      }
    }

    paintHalos(lk) {
      const { W, H, L, X0, WW } = this;
      const stat = [{ x: L.tentX, y: L.tentY - 7, r: 13, c: [255, 170, 80], k: 0.32 }];
      if (lk.moon) stat.push({ x: L.moon.x, y: L.moon.y, r: 30, c: [150, 165, 215], k: 0.28 });
      this.haloStatic = haloW(X0, WW, H, W, stat);
      this.haloFire = haloW(X0, WW, H, W, [
        { x: L.fireX, y: L.fireY - 5, r: 52, c: [255, 130, 50], k: 0.3 },
        { x: L.fireX, y: L.fireY - 4, r: 16, c: [255, 180, 90], k: 0.5 },
      ]);
      // Monde élargi : la lueur de la fenêtre et de la lanterne de la cabane (dessinée sur
      // le plan de la rive, pour rester collée à la cabane pendant le travelling).
      const c = L.cabin;
      this.haloCabin = c
        ? haloW(X0, WW, H, W, [], [
          { x: c.win.x + 3, y: c.win.y + 2, r: 11, c: [255, 190, 100], k: 0.38 },
          { x: c.lamp.x, y: c.lamp.y, r: 7, c: [255, 200, 120], k: 0.45 },
        ])
        : null;
    }

    // Bande de brume qui dérive lentement au ras de l'eau (motif qui se répète en boucle,
    // de période W ; sur le monde élargi, le même motif est simplement répété).
    paintMist(lk) {
      const { W, X0, WW } = this;
      const h = 16;
      const r = new Raster(WW, h);
      const c = C(lk.mist);
      for (let y = 0; y < h; y++) {
        const prof = Math.sin((Math.PI * (y + 0.5)) / h);
        for (let cx = 0; cx < WW; cx++) {
          const x = (((cx + X0) % W) + W) % W;
          const f = (xx) => fbm(xx * 0.03, y * 0.22, 61, 3);
          const a = f(x) * (1 - x / W) + f(x - W) * (x / W);
          const v = Math.max(0, a - 0.42) * 2.2 * prof * lk.mistK;
          const q = Math.floor(v * 5 + bayer(x, y) * 0.8) / 5;
          if (q > 0) r.set(cx, y, c, Math.round(Math.min(1, q) * 150));
        }
      }
      return r.toCanvas();
    }

    makeReeds(lk) {
      const { W, L } = this;
      const R = rng(777);
      this.reeds = [];
      this.reedCol = lk.reed.map(C);
      for (const s of [0.12, 0.25, 0.41, 0.6, 0.66, 0.84, 0.95]) {
        const cx = Math.round(W * s + (R() - 0.5) * 10);
        if (Math.abs(cx - L.deerX) < 22 || (cx > L.canoeX - 8 && cx < L.canoeX + 36)) continue;
        const n = 4 + Math.floor(R() * 6);
        for (let k = 0; k < n; k++) {
          const x = clamp(cx + Math.round((R() - 0.5) * 12), 0, W - 1);
          this.reeds.push({ x, y: L.shore[x] + 1, len: 5 + Math.floor(R() * 9), lean: (R() - 0.5) * 3, ph: R() * 6, cat: R() < 0.35 });
        }
      }
      // Monde élargi : d'autres touffes le long de la rive (dessinées sur le plan de la rive).
      this.reedsE = [];
      if (!this.ext) return;
      const Re = rng(1777);
      const D = L.doe;
      const J = L.jetty;
      for (const u of [0.05, 0.26, 0.29, 0.47, 0.55, 0.68, 0.82, 0.99, 1.13, 1.31, 1.47, -1.04, -1.2]) {
        const cx = Math.round(-u * W + (Re() - 0.5) * 8);
        const n = 4 + Math.floor(Re() * 6);
        for (let k = 0; k < n; k++) {
          const x = cx + Math.round((Re() - 0.5) * 12);
          const r = { x, y: this.at(L.shoreW, x) + 1, len: 5 + Math.floor(Re() * 9), lean: (Re() - 0.5) * 3, ph: Re() * 6, cat: Re() < 0.35 };
          if (x < this.X0 + 2 || x >= this.X1 - 2 || (x >= -2 && x < W + 2)) continue;
          if (D && x > D.x - 6 && x < D.x + 26) continue;
          if (J && J.end && x > J.end.x - 2 && x < J.end.x + 26) continue;
          this.reedsE.push(r);
        }
      }
    }

    makeStars(lk) {
      const { W, H, L } = this;
      const R = rng(31);
      this.twinkle = [];
      if (!lk.stars || lk.clouds === 'overcast') return;
      const n = Math.round(22 * lk.stars + 6);
      for (let i = 0; i < n * 3 && this.twinkle.length < n; i++) {
        const x = Math.floor(R() * W);
        const y = Math.floor(R() * H * 0.36);
        if (y > L.top[x] - 5) continue;
        if (lk.moon && Math.hypot(x - L.moon.x, y - L.moon.y) < 16) continue;
        this.twinkle.push({ x, y, ph: R() * 6.28, sp: 0.6 + R() * 2.2, big: R() < 0.25 });
      }
      // Monde élargi : le ciel scintille aussi au-dessus des autres sommets.
      const Re = rng(131);
      for (const [a, b] of this.extSpans()) {
        const m = Math.round((n * (b - a)) / W);
        for (let i = 0, got = 0; i < m * 3 && got < m; i++) {
          const x = a + Math.floor(Re() * (b - a));
          const y = Math.floor(Re() * H * 0.36);
          const ph = Re() * 6.28;
          const sp = 0.6 + Re() * 2.2;
          const big = Re() < 0.25;
          if (y > this.at(L.topW, x) - 5) continue;
          this.twinkle.push({ x, y, ph, sp, big });
          got++;
        }
      }
    }

    makeFlies(n) {
      const { W, H, L } = this;
      const fly = (x) => ({
        x,
        y: L.lakeY - 20 + Math.random() * (H - L.lakeY + 14),
        ph: Math.random() * 6.28,
        sp: 0.5 + Math.random() * 0.9,
        vx: (Math.random() - 0.5) * 4,
      });
      this.flies = Array.from({ length: n }, () => fly(Math.random() * W));
      // Monde élargi : les lucioles dansent aussi le long de l'autre rive.
      if (this.ext && n) for (const [a, b] of this.extSpans()) for (let i = Math.round((n * (b - a)) / W); i > 0; i--) this.flies.push(fly(a + Math.random() * (b - a)));
    }

    /* ---------- La vie ---------- */
    initLife() {
      const { W, H } = this;
      const f = this.fast;
      this.deer = { state: 'away', timer: f ? 0.3 : 10 + Math.random() * 20, x: W + 6, ft: 0, drinks: 0, lapT: 0 };
      this.fox = { state: 'away', timer: f ? 0.8 : 25 + Math.random() * 30, x: -20, dir: 1, ft: 0, pauseX: 0, paused: false };
      this.owl = { pose: 'front', timer: f ? 1 : 3 };
      this.camper = { pose: 'warm', timer: f ? 2 : 6, ft: 0 };
      this.fish = [];
      this.nextFish = f ? 0.5 : 4 + Math.random() * 8;
      this.rings = [];
      this.sparks = [];
      this.smoke = new PXC.Puffs('150,138,134');
      this.breath = new PXC.Puffs('225,232,245');
      this.nextBreath = 2;
      this.shoot = null;
      this.nextShoot = f ? 1 : 12 + Math.random() * 25;
      this.flock = new PXC.Flock({ x0: this.X0, x1: this.X1, y0: Math.round(H * 0.1), y1: Math.round(H * 0.28), rate: [12, 28], color: '#121826' });
      if (f) this.flock.next = 0.5;
      this.flash = null;
      this.nextFlash = f ? 1.5 : 5 + Math.random() * 10;
      // Monde élargi : la biche qui boit dans l'anse, la fumée de la cabane.
      this.doe = this.L.doe ? { state: 'drink', timer: 3 + Math.random() * 5, lapT: 0, lapUntil: 0 } : null;
      this.chimney = new PXC.Puffs('120,116,120');
      this.nextPuff = 0;
      // La cheminée fume déjà quand la caméra arrive.
      if (this.L.cabin) for (let i = 0; i < 60; i++) this.puffChimney(0.1);
    }

    update(dt, ctx) {
      const effect = (ctx && ctx.effect) || 'none';
      // Sans « night » dans le contexte (caméra d'ouverture), on garde l'état courant.
      const night = ctx && 'night' in ctx ? !!ctx.night : this.night;
      if (effect !== this.effect || night !== this.night) this.build(effect, night);
      const { W, L } = this;
      const lk = this.look;
      this.t += dt;
      const t = this.t;

      // Feu : étincelles et fumée.
      const poking = this.camper.pose === 'poke';
      if (Math.random() < dt * (poking ? 22 : 6)) {
        this.sparks.push({ x: L.fireX + (Math.random() - 0.5) * 4, y: L.fireY - 5, vx: (Math.random() - 0.5) * 8, vy: -(16 + Math.random() * 18), age: 0, life: 0.6 + Math.random() * 1.1 });
      }
      for (const s of this.sparks) {
        s.age += dt;
        s.x += (s.vx + Math.sin(s.age * 9 + s.life * 10) * 6) * dt;
        s.y += s.vy * dt;
        s.vy *= 1 - dt * 0.6;
      }
      this.sparks = this.sparks.filter((s) => s.age < s.life);
      if (Math.random() < dt * 9) this.smoke.emit(L.fireX + Math.round((Math.random() - 0.5) * 4), L.fireY - 12, 3 + Math.random() * 1.5, 8 + Math.random() * 3);
      this.smoke.update(dt);

      this.updateCamper(dt);
      this.updateDeer(dt);
      this.updateFox(dt);
      this.updateOwl(dt);
      if (this.ext) this.updateExt(dt);

      // Buée du campeur quand il fait froid.
      if (lk.snowGround) {
        this.nextBreath -= dt;
        if (this.nextBreath <= 0) {
          for (let k = 0; k < 3; k++) this.breath.emit(L.campX + 8 + k, L.fireY - 15, 1.2, 3);
          this.nextBreath = 2.2 + Math.random();
        }
      }
      this.breath.update(dt);

      // Poissons qui sautent.
      if (lk.fish) {
        this.nextFish -= dt;
        if (this.nextFish <= 0) {
          const y0 = L.openY0 + 3;
          const y1 = lk.ice ? L.openY1 - 3 : L.shoreMin - 6;
          const x = Math.round(W * (0.3 + Math.random() * 0.62));
          const y = Math.round(y0 + Math.random() * Math.max(1, y1 - y0));
          this.fish.push({ x, y, dir: Math.random() < 0.5 ? -1 : 1, age: 0, dur: 0.75 });
          this.ring(x, y, 1.6, 1);
          this.nextFish = this.fast ? 2.5 : 6 + Math.random() * 12;
        }
      }
      for (const f of this.fish) {
        f.age += dt;
        if (f.age >= f.dur && !f.done) {
          f.done = true;
          this.ring(f.x + f.dir * 9, f.y, 1.8, 1.3);
        }
      }
      this.fish = this.fish.filter((f) => f.age < f.dur + 0.4);

      // Pluie sur le lac : petits ronds partout (les gouttes elles-mêmes sont dessinées
      // par la couche météo).
      if (lk.ripples) {
        let n = lk.ripples * dt;
        while (n > 0) {
          if (Math.random() < n) {
            const x = Math.floor(Math.random() * W);
            const y = Math.round(L.lakeY + 2 + Math.random() * (L.shore[x] - L.lakeY - 3));
            this.ring(x, y, 0.55, 0.45);
          }
          n -= 1;
        }
        // Monde élargi : il pleut aussi sur le reste du lac.
        for (const [a, b] of this.ext ? this.extSpans() : []) {
          if (Math.random() >= (lk.ripples * dt * (b - a)) / W) continue;
          const x = a + Math.floor(Math.random() * (b - a));
          this.ring(x, Math.round(L.lakeY + 2 + Math.random() * (this.at(L.shoreW, x) - L.lakeY - 3)), 0.55, 0.45);
        }
      }
      for (const r of this.rings) r.age += dt;
      this.rings = this.rings.filter((r) => r.age < r.life);

      // Lucioles.
      for (const f of this.flies) {
        f.x += (Math.sin(t * 0.7 + f.ph) * 6 + f.vx) * dt;
        f.y += Math.cos(t * 0.9 + f.ph * 1.3) * 4 * dt;
        if (f.x < this.X0 - 4) f.x = this.X1 + 3;
        if (f.x > this.X1 + 4) f.x = this.X0 - 3;
      }

      // Étoile filante.
      if (lk.stars > 0 && lk.clouds !== 'overcast' && !lk.noShoot) {
        this.nextShoot -= dt;
        if (!this.shoot && this.nextShoot <= 0) {
          const dir = Math.random() < 0.5 ? -1 : 1;
          this.shoot = { x: W * (0.15 + Math.random() * 0.7), y: 4 + Math.random() * this.H * 0.14, vx: dir * (110 + Math.random() * 50), vy: 40 + Math.random() * 20, age: 0, life: 0.7 + Math.random() * 0.3 };
          this.nextShoot = this.fast ? 4 : (lk.milky ? 8 : 18) + Math.random() * 25;
        }
      }
      if (this.shoot) {
        this.shoot.age += dt;
        if (this.shoot.age > this.shoot.life) this.shoot = null;
      }

      if (lk.birds) this.flock.update(dt);

      // Orage : éclairs.
      if (lk.lightning) {
        this.nextFlash -= dt;
        if (!this.flash && this.nextFlash <= 0) {
          const pts = [];
          let x = W * (0.15 + Math.random() * 0.7);
          for (let y = 0; y < L.far[clamp(Math.round(x), 0, W - 1)]; y += 3 + Math.random() * 4) {
            pts.push([Math.round(x), Math.round(y)]);
            x += (Math.random() - 0.5) * 9;
          }
          this.flash = { age: 0, pts };
          this.nextFlash = this.fast ? 3 : 6 + Math.random() * 12;
        }
      }
      if (this.flash) {
        this.flash.age += dt;
        if (this.flash.age > 0.7) this.flash = null;
      }
    }

    // La vie du monde élargi : la biche boit et relève la tête, la cheminée fume.
    updateExt(dt) {
      const { L } = this;
      const d = this.doe;
      if (d) {
        d.timer -= dt;
        if (d.state === 'drink') {
          d.lapT -= dt;
          if (d.lapT <= 0) {
            d.lapT = 0.9 + Math.random() * 0.6;
            d.lapUntil = this.t + 0.3;
            if (!this.look.ice) this.ring(L.doe.x + 2, this.at(L.shoreW, L.doe.x + 2) - 1, 1.4, 0.8);
          }
          if (d.timer <= 0) {
            d.state = 'look';
            d.timer = 1.8 + Math.random() * 2.2;
          }
        } else if (d.timer <= 0) {
          d.state = 'drink';
          d.timer = 5 + Math.random() * 6;
        }
      }
      this.puffChimney(dt);
    }

    puffChimney(dt) {
      const c = this.L.cabin;
      if (!c) return;
      this.nextPuff -= dt;
      if (this.nextPuff <= 0) {
        const x = c.chim.x + Math.round((Math.random() - 0.5) * 2);
        const life = 4 + Math.random() * 2;
        const rise = 5 + Math.random() * 2;
        this.chimney.emit(x, c.chim.y, life, rise);
        this.chimney.emit(x + 1, c.chim.y, life * 0.8, rise);
        this.nextPuff = 0.1 + Math.random() * 0.08;
      }
      this.chimney.update(dt);
    }

    ring(x, y, life, size) {
      if (this.rings.length < 60) this.rings.push({ x, y, age: 0, life, size });
    }

    updateCamper(dt) {
      const c = this.camper;
      c.timer -= dt;
      c.ft += dt;
      if (c.timer > 0) return;
      const roll = Math.random();
      c.ft = 0;
      if (c.pose !== 'warm') {
        c.pose = 'warm';
        c.timer = 6 + Math.random() * 8;
      } else if (roll < 0.5) {
        c.pose = 'poke';
        c.timer = 2.5 + Math.random() * 2;
      } else if (roll < 0.8) {
        c.pose = 'sip';
        c.timer = 2.5 + Math.random();
      } else c.timer = 4;
    }

    updateDeer(dt) {
      const d = this.deer;
      const { W, L } = this;
      d.timer -= dt;
      d.ft += dt;
      if (d.state === 'away') {
        if (d.timer <= 0) {
          d.state = 'in';
          d.x = this.fast ? L.deerX + 28 : W + 4;
        }
      } else if (d.state === 'in') {
        d.x -= 9 * dt;
        if (d.x <= L.deerX) {
          d.x = L.deerX;
          d.state = 'look';
          d.timer = 1.5;
          d.next = 'drink';
        }
      } else if (d.state === 'look') {
        if (d.timer <= 0) {
          if (d.next === 'drink') {
            d.state = 'drink';
            d.timer = 6 + Math.random() * 6;
            d.drinks++;
          } else d.state = 'out';
        }
      } else if (d.state === 'drink') {
        d.lapT -= dt;
        if (d.lapT <= 0) {
          d.lapT = 0.9 + Math.random() * 0.6;
          d.lapUntil = this.t + 0.3;
          if (!this.look.ice) this.ring(Math.round(d.x), L.shore[clamp(Math.round(d.x), 0, W - 1)] - 1, 1.4, 0.8);
        }
        if (d.timer <= 0) {
          d.state = 'look';
          d.timer = 2 + Math.random() * 2;
          d.next = d.drinks < 2 && Math.random() < 0.6 ? 'drink' : 'leave';
        }
      } else if (d.state === 'out') {
        d.x += 10 * dt;
        if (d.x > W + 30) {
          d.state = 'away';
          d.timer = 40 + Math.random() * 50;
          d.drinks = 0;
        }
      }
    }

    updateFox(dt) {
      const f = this.fox;
      const { W } = this;
      f.timer -= dt;
      f.ft += dt;
      if (f.state === 'away') {
        if (f.timer <= 0) {
          f.dir = Math.random() < 0.5 ? 1 : -1;
          f.x = this.fast ? W * 0.35 : f.dir > 0 ? this.X0 - 20 : this.X1 + 2;
          f.pauseX = this.ext ? this.X0 + this.WW * (0.2 + Math.random() * 0.75) : W * (0.45 + Math.random() * 0.35);
          f.paused = false;
          f.state = 'run';
        }
        return;
      }
      if (f.state === 'stop') {
        if (f.timer <= 0) f.state = 'run';
        return;
      }
      const ox = f.x;
      f.x += f.dir * 21 * dt;
      if (!f.paused && (ox - f.pauseX) * (f.x - f.pauseX) <= 0) {
        f.paused = true;
        f.state = 'stop';
        f.timer = 1.2 + Math.random() * 1.2;
      }
      if (f.x < this.X0 - 26 || f.x > this.X1 + 6) {
        f.state = 'away';
        f.timer = 45 + Math.random() * 60;
      }
    }

    updateOwl(dt) {
      const o = this.owl;
      o.timer -= dt;
      if (o.timer > 0) return;
      if (o.pose !== 'front') {
        o.pose = 'front';
        o.timer = 2 + Math.random() * 4;
        return;
      }
      const roll = Math.random();
      if (roll < 0.45) {
        o.pose = 'blink';
        o.timer = 0.16;
      } else if (roll < 0.65) {
        o.pose = 'left';
        o.timer = 1.5 + Math.random() * 2;
      } else if (roll < 0.85) {
        o.pose = 'right';
        o.timer = 1.5 + Math.random() * 2;
      } else {
        o.pose = 'back';
        o.timer = 1.2 + Math.random();
      }
    }

    /* ---------- Dessin d'une image ---------- */
    draw(g) {
      if (!this.bg) this.build('none', this.night);
      const { W, H, L } = this;
      const t = this.t;
      const lk = this.look;
      g.imageSmoothingEnabled = false;
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      // Les toiles couvrent tout le monde peint : elles commencent en x = X0 (0 sans extension).
      const X0 = this.X0;
      g.drawImage(this.bg, X0, 0);
      this.drawSky(g, t);
      if (L.fall) this.drawFall(g, t);
      if (lk.birds) this.flock.draw(g);
      this.drawMist(g, t);
      this.drawLake(g, t);
      this.drawReeds(g, t);
      g.drawImage(this.ground, X0, 0);
      if (this.ext) this.drawShoreExt(g, t);
      this.drawDeer(g);
      this.drawCamp(g, t);
      this.drawFox(g);
      g.drawImage(this.front, X0, 0);
      g.drawImage(this.sprites.owl[this.owl.pose], L.owl.x, L.owl.y);
      this.drawFlies(g, t);

      // Halos : lune et lanterne (fixes), feu (qui vacille).
      g.globalCompositeOperation = 'lighter';
      g.drawImage(this.haloStatic, X0, 0);
      g.globalAlpha = clamp(0.72 + 0.16 * noise(t * 5, 0.5, 8) + 0.08 * Math.sin(t * 17) * noise(t * 2, 3.5, 9), 0, 1);
      g.drawImage(this.haloFire, X0, 0);
      g.globalAlpha = 1;
      if (this.flash) this.drawFlash(g);
      g.globalCompositeOperation = 'source-over';
    }

    drawSky(g, t) {
      const { L } = this;
      for (const s of this.twinkle) {
        const b = 0.5 + 0.5 * Math.sin(t * s.sp + s.ph);
        g.fillStyle = `rgba(255,250,235,${(0.35 + 0.65 * b).toFixed(2)})`;
        g.fillRect(s.x, s.y, 1, 1);
        if (s.big && b > 0.75) {
          g.fillStyle = `rgba(200,215,255,${((b - 0.75) * 1.6).toFixed(2)})`;
          g.fillRect(s.x - 1, s.y, 1, 1);
          g.fillRect(s.x + 1, s.y, 1, 1);
          g.fillRect(s.x, s.y - 1, 1, 1);
          g.fillRect(s.x, s.y + 1, 1, 1);
        }
      }
      const s = this.shoot;
      if (s) {
        const hx = s.x + s.vx * s.age;
        const hy = s.y + s.vy * s.age;
        const fade = Math.min(1, (s.life - s.age) * 4);
        const len = 12;
        for (let k = 0; k < len; k++) {
          const x = Math.round(hx - (s.vx / 140) * k * 1.4);
          const y = Math.round(hy - (s.vy / 140) * k * 1.4);
          if (x < 0 || x >= this.W || y >= L.top[x] - 1) continue;
          g.fillStyle = `rgba(255,248,225,${((1 - k / len) * 0.9 * fade).toFixed(2)})`;
          g.fillRect(x, y, 1, 1);
        }
      }
    }

    drawMist(g, t) {
      const { W, L } = this;
      const off = Math.floor((t * 1.6) % W);
      const y = L.lakeY - 11;
      if (this.ext) {
        // Monde élargi : la bande (motif de période W) couvre tout, en deux morceaux.
        const m = this.mist;
        const strip = (o, yy) => {
          g.drawImage(m, this.X0 - o, yy);
          if (o > 0) g.drawImage(m, this.WW - W, 0, o, m.height, this.X1 - o, yy, o, m.height);
        };
        strip(off, y);
        if (this.look.mistK > 0.6) {
          g.globalAlpha = 0.7;
          strip(Math.floor((t * 2.6 + W / 2) % W), L.lakeY - 34);
          g.globalAlpha = 1;
        }
        return;
      }
      g.drawImage(this.mist, -off, y);
      g.drawImage(this.mist, W - off, y);
      if (this.look.mistK > 0.6) {
        const off2 = Math.floor((t * 2.6 + W / 2) % W);
        g.globalAlpha = 0.7;
        g.drawImage(this.mist, -off2, L.lakeY - 34);
        g.drawImage(this.mist, W - off2, L.lakeY - 34);
        g.globalAlpha = 1;
      }
    }

    // Cascade : filets d'eau qui dévalent et embruns au pied (sur le plan du fond).
    drawFall(g, t) {
      const F = this.L.fall;
      if (this.look.ice) return;
      const hi = F.cols.hi;
      const seg = (ya, yb, x0, w0, w1, n, sp, seed) => {
        for (let k = 0; k < n; k++) {
          const p = (t * sp + hash(k, 1, seed)) % 1;
          const w = w0 + (w1 - w0) * p;
          g.fillStyle = rgba(mix(hi, [255, 255, 255], 0.4), (0.55 + 0.35 * hash(k, 3, seed)).toFixed(2));
          g.fillRect(Math.round(x0 + (hash(k, 2, seed) - 0.5) * 2 * w), Math.round(ya + p * (yb - ya)), 1, 2);
        }
      };
      seg(F.y0, F.y1, F.x, 0.8, 1.6, 4, 1.1, 7);
      seg(F.y1 + 1, this.L.lakeY - 1, F.x + 2, 1.4, 3.2, 8, 0.8, 8);
      // Embruns qui montent et retombent.
      const q = Math.floor(t * 6);
      g.fillStyle = rgba(hi, 0.5);
      for (let k = 0; k < 7; k++) {
        const x = F.x + 2 + Math.round((hash(k, q, 9) - 0.5) * 16);
        const y = this.L.lakeY - 1 - Math.round(hash(k, q, 10) * 5);
        g.fillRect(x, y, 1, 1);
      }
    }

    // La rive hors du cadre : roseaux, barque, biche, fumée et lueur de la cabane.
    drawShoreExt(g, t) {
      const { L } = this;
      const lk = this.look;
      this.drawReeds(g, t, this.reedsE);
      const bt = this.sprites.boat;
      if (bt) {
        const bob = lk.ice ? 0 : Math.sin(t * 1.4) > 0.35 ? 1 : 0;
        const img = bt.img;
        // Reflet écrasé dans l'eau, puis la barque et son amarre.
        g.save();
        g.globalAlpha = lk.ice ? 0.12 : 0.22;
        g.translate(bt.x, bt.y + img.height + bob);
        g.scale(1, -0.5);
        g.drawImage(img, 0, 0);
        g.restore();
        g.drawImage(img, bt.x, bt.y + bob);
        g.fillStyle = 'rgba(150,135,110,0.85)';
        const e = L.jetty.end;
        const n = 4;
        for (let k = 0; k <= n; k++) g.fillRect(Math.round(e.x + 1 + ((bt.x + 1 - e.x - 1) * k) / n), Math.round(e.y - 5 + ((bt.y + bob - e.y + 5) * k) / n + Math.sin((k / n) * Math.PI) * 2), 1, 1);
      }
      if (this.doe) {
        const S = this.sprites.doe;
        const d = this.doe;
        const img = d.state === 'drink' ? (d.lapUntil > this.t ? S.left.lap : S.left.drink) : S.left.stand;
        const x = L.doe.x;
        g.drawImage(img, x, this.at(L.shoreW, x + 10) + 2 - S.h + 1);
      }
      if (L.cabin) {
        // Fumée de la cheminée : des volutes qui s'élargissent en montant.
        for (const q of this.chimney.p) {
          const u = q.age / q.life;
          g.fillStyle = `rgba(172,168,178,${(0.55 * (1 - u * u)).toFixed(2)})`;
          const sz = u > 0.45 ? 2 : 1;
          g.fillRect(Math.round(q.x), Math.round(q.y), sz, sz);
        }
        // La flamme du poêle fait vaciller la fenêtre.
        const w = L.cabin.win;
        g.fillStyle = `rgba(255,170,80,${(0.12 * noise(t * 4, 1.5, 12)).toFixed(2)})`;
        g.fillRect(w.x, w.y, w.w, w.h);
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = clamp(0.85 + 0.15 * noise(t * 3, 2.5, 13), 0, 1);
        g.drawImage(this.haloCabin, this.X0, 0);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
      }
    }

    drawLake(g, t) {
      const { W, L } = this;
      const lk = this.look;
      const q = Math.floor(t * 5);
      // Chemin de lune qui scintille sur l'eau.
      if (lk.moon && lk.glitter) {
        const mx = L.moon.x;
        const y1 = L.shore[clamp(mx, 0, W - 1)] - 1;
        for (let y = L.lakeY + 1; y < y1; y++) {
          const k = y - L.lakeY;
          if (lk.ice && (y > L.openY1 - 2)) break;
          const h = hash(y, q + (y >> 2), 21);
          if (h < 0.38) continue;
          const w = 1 + Math.round(k * 0.08 + hash(y, q, 22) * 2.5);
          const off = Math.round((hash(y, q, 23) - 0.5) * (2 + k * 0.18));
          g.fillStyle = `rgba(244,236,210,${(0.25 + h * 0.45).toFixed(2)})`;
          g.fillRect(mx - (w >> 1) + off, y, w, 1);
        }
      }
      // Reflets qui s'allument et s'éteignent sur l'eau.
      const sh = C(lk.sky[lk.sky.length - 2]);
      g.fillStyle = rgba(mix(sh, [255, 255, 255], 0.2), 0.35);
      const yMax = lk.ice ? L.openY1 - 2 : L.shoreMin;
      for (let i = 0; i < 26; i++) {
        const x = Math.floor(hash(i, q >> 1, 31) * W);
        const y = Math.floor(L.lakeY + 2 + hash(i, q >> 1, 32) * (yMax - L.lakeY - 3));
        if (y >= L.shore[x] - 1) continue;
        g.fillRect(x, y, 2 + (i % 3), 1);
      }
      // Monde élargi : le reste du lac scintille aussi.
      for (const [a, b] of this.ext ? this.extSpans() : []) {
        const n = Math.round((26 * (b - a)) / W);
        for (let i = 0; i < n; i++) {
          const x = a + Math.floor(hash(i, q >> 1, 131 + a) * (b - a));
          const y = Math.floor(L.lakeY + 2 + hash(i, q >> 1, 132 + a) * (yMax - L.lakeY - 3));
          if (y >= this.at(L.shoreW, x) - 1) continue;
          g.fillRect(x, y, 2 + (i % 3), 1);
        }
      }
      // Poissons.
      for (const f of this.fish) {
        if (f.done) continue;
        const u = f.age / f.dur;
        const px = Math.round(f.x + f.dir * u * 9);
        const py = Math.round(f.y - Math.sin(u * Math.PI) * 8);
        const tilt = u < 0.4 ? 1 : u > 0.6 ? -1 : 0;
        g.fillStyle = '#c8d6e4';
        g.fillRect(px, py, 1, 1);
        g.fillRect(px - f.dir, py + tilt, 1, 1);
        g.fillStyle = '#7a8ca4';
        g.fillRect(px - 2 * f.dir, py + 2 * tilt, 1, 1);
        if (u < 0.25 || u > 0.8) {
          g.fillStyle = 'rgba(210,225,245,0.7)';
          g.fillRect(px + f.dir, py + 2, 1, 1);
          g.fillRect(px - 2 * f.dir, py + 3, 1, 1);
        }
      }
      // Ronds dans l'eau.
      for (const r of this.rings) {
        const u = r.age / r.life;
        const rx = 1 + u * 7 * r.size;
        const a = (0.6 * (1 - u)).toFixed(2);
        g.fillStyle = `rgba(200,215,240,${a})`;
        const n = Math.max(6, Math.round(rx * 3));
        for (let k = 0; k < n; k++) {
          const ang = (k / n) * Math.PI * 2;
          const x = Math.round(r.x + Math.cos(ang) * rx);
          const y = Math.round(r.y + Math.sin(ang) * rx * 0.3);
          if (y >= L.lakeY && x >= this.X0 && x < this.X1 && y < this.at(L.shoreW, x)) g.fillRect(x, y, 1, 1);
        }
      }
    }

    drawReeds(g, t, list = this.reeds) {
      const [stem, hi, head] = this.reedCol;
      const lk = this.look;
      for (const r of list) {
        for (let k = 0; k < r.len; k++) {
          const u = k / r.len;
          const sway = Math.round(Math.sin(t * 1.1 + r.ph + r.x * 0.1) * u * u * 1.3 + r.lean * u);
          g.fillStyle = rgba(k > r.len * 0.6 ? hi : stem, 1);
          g.fillRect(r.x + sway, r.y - k, 1, 1);
        }
        const sway = Math.round(Math.sin(t * 1.1 + r.ph + r.x * 0.1) * 1.3 + r.lean);
        if (r.cat) {
          g.fillStyle = rgba(head, 1);
          g.fillRect(r.x + sway, r.y - r.len - 2, 1, 3);
        }
        if (lk.snowGround) {
          g.fillStyle = '#dce6f2';
          g.fillRect(r.x + sway, r.y - r.len - (r.cat ? 3 : 0), 1, 1);
        }
      }
    }

    drawDeer(g) {
      const d = this.deer;
      if (d.state === 'away') return;
      const { W, L } = this;
      const S = this.sprites.deer;
      const set = d.state === 'out' ? S.right : S.left;
      let img;
      if (d.state === 'in' || d.state === 'out') img = set.walk[Math.floor(d.ft / 0.2) % 4];
      else if (d.state === 'drink') img = d.lapUntil > this.t ? set.lap : set.drink;
      else img = set.stand;
      const x = Math.round(d.x);
      const feet = L.shore[clamp(x + 10, 0, W - 1)] + 2;
      g.drawImage(img, x, feet - S.h + 1);
    }

    // Le campeur (bonnet, manteau), éclairé par le feu : le côté tourné vers les flammes
    // s'allume, l'autre reste dans la nuit bleue ; liseré orangé côté feu.
    paintCamper(lk) {
      const { L } = this;
      const hh = 7.2;
      const look = lk.snowGround ? { ...CAMPER, scarf: '#e8c547' } : CAMPER;
      const sh = B.People.heroes.camper(look, { hh, seatH: 3.5 / hh, light: [0.75, -0.45, 0.48], rim: { color: '#ffa050', dir: [1, 0], k: 0.4 } });
      const ox = L.campX + 3 - sh.ax;
      const oy = L.fireY - 1 - sh.ay;
      const lights = this.lights().map((l) => ({ ...l, x: l.x - ox, y: l.y - oy }));
      const out = B.People.bake(sh, (r) => PXC.applyLight(r, lights, lk.ambient, lk.warm));
      out.x = ox;
      out.y = oy;
      return out;
    }

    drawCamp(g, t) {
      const c = this.camper;
      const S = this.sprites.camper;
      const F = S.frames;
      let img = F.warm;
      if (c.pose === 'poke') img = F.poke[Math.floor(c.ft / 0.28) % 2];
      else if (c.pose === 'sip') img = F.sip;
      else if (c.ft % 5 < 1.6) img = Math.floor(c.ft / 0.25) % 2 ? F.rub[1] : F.rub[0];
      g.drawImage(img, S.x, S.y);
      this.drawFire(g, t);
      for (const s of this.sparks) {
        const u = s.age / s.life;
        g.fillStyle = u < 0.3 ? '#ffe08a' : u < 0.65 ? '#ff9a3a' : '#c8481a';
        if (u > 0.85 && Math.random() < 0.5) continue;
        g.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
      }
      this.smoke.draw(g, 0.3);
      this.breath.draw(g, 0.5);
    }

    drawFire(g, t) {
      const fx = this.L.fireX;
      const fy = this.L.fireY;
      // Braises.
      for (let i = -4; i <= 4; i++) {
        const k = noise(i * 0.9, t * 3, 5);
        g.fillStyle = k > 0.62 ? '#ffc050' : k > 0.42 ? '#e0581c' : '#7a2410';
        g.fillRect(fx + i, fy, 1, 1);
      }
      // Flammes : colonnes qui dansent, cœur jaune pâle, bords orange, pointes rouges.
      for (let dx = -3; dx <= 3; dx++) {
        const base = 10 - Math.abs(dx) * 2.4;
        const h = Math.max(1, Math.round(base * (0.6 + 0.65 * noise(dx * 0.7 + 10, t * 5.5, 3))));
        for (let k = 0; k < h; k++) {
          const u = k / h;
          const xo = Math.round(Math.sin(t * 7 + k * 0.6 + dx) * u * 1.2);
          g.fillStyle = u < 0.35 && Math.abs(dx) <= 1 ? '#fff4c0' : u < 0.6 ? '#ffc040' : u < 0.85 ? '#ff7a24' : '#d2401a';
          g.fillRect(fx + dx + xo, fy - 1 - k, 1, 1);
        }
      }
      // Langue de flamme qui se détache.
      const lt = (t * 1.7) % 1;
      if (lt < 0.4) {
        g.fillStyle = lt < 0.2 ? '#ffa030' : '#d2401a';
        g.fillRect(fx + Math.round(Math.sin(t * 3) * 1.5), fy - 11 - Math.round(lt * 10), 1, 1);
      }
    }

    drawFox(g) {
      const f = this.fox;
      if (f.state === 'away') return;
      const S = this.sprites.fox;
      const set = f.dir > 0 ? S.right : S.left;
      const img = f.state === 'stop' ? set.stand : set.run[Math.floor(f.ft / 0.13) % 2];
      g.drawImage(img, Math.round(f.x), this.H - 4 - S.h);
    }

    drawFlies(g, t) {
      if (!this.flies.length) return;
      for (const f of this.flies) {
        const b = 0.5 + 0.5 * Math.sin(t * f.sp * 2 + f.ph);
        if (b < 0.3) continue;
        const x = Math.round(f.x);
        const y = Math.round(f.y);
        g.fillStyle = `rgba(244,255,150,${b.toFixed(2)})`;
        g.fillRect(x, y, 1, 1);
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = `rgba(150,200,60,${(b * 0.35).toFixed(2)})`;
        g.fillRect(x - 1, y, 3, 1);
        g.fillRect(x, y - 1, 1, 3);
        g.globalCompositeOperation = 'source-over';
      }
    }

    drawFlash(g) {
      const { W, H } = this;
      const a = this.flash.age;
      const k = a < 0.07 ? 0.5 : a < 0.14 ? 0.05 : a < 0.24 ? 0.38 : Math.max(0, 0.38 * (1 - (a - 0.24) / 0.45));
      if (a < 0.26) {
        g.fillStyle = 'rgba(235,240,255,0.95)';
        const p = this.flash.pts;
        for (let i = 1; i < p.length; i++) {
          const n = Math.max(Math.abs(p[i][0] - p[i - 1][0]), Math.abs(p[i][1] - p[i - 1][1]), 1);
          for (let s = 0; s <= n; s++) g.fillRect(Math.round(p[i - 1][0] + ((p[i][0] - p[i - 1][0]) * s) / n), Math.round(p[i - 1][1] + ((p[i][1] - p[i - 1][1]) * s) / n), 1, 1);
        }
      }
      g.fillStyle = `rgba(150,165,210,${k.toFixed(2)})`;
      g.fillRect(this.X0, 0, this.WW, H);
    }
  }

  B.PixelScenes.foret = Foret;
})();
