// Brume — scène « Drones », en pixel art.
//
// L'heure bleue dans une vallée de montagne embrumée. Un grand viaduc ferroviaire en béton
// (hautes piles, voûtes en plein cintre) enjambe la vallée ; derrière lui, deux chaînes de
// montagnes s'effacent dans la brume, avec tout au fond une rivière et un petit village
// dont quelques fenêtres s'allument.
// Le décor est volontairement sourd (gris bleutés, une bande tiède sur l'horizon au plus) :
// les seules couleurs vives de l'image sont les drones et la télépilote.
// • Au premier plan, sur un replat à flanc de colline : la télépilote en gilet haute
//   visibilité et casque blanc, sa radiocommande, la valise de la station sol (écran de
//   télémétrie), l'antenne sur trépied et l'aire de décollage (un tapis marqué d'un H).
// • Le drone d'inspection (gris clair, embouts orange, nacelle caméra + projecteur, feux
//   de navigation rouge et vert, flash blanc) : il attend sur le tapis, décolle, file vers
//   le viaduc, inspecte le fût d'une pile, un appareil d'appui puis l'intrados d'une voûte
//   en balayant le béton de son projecteur, et revient se poser. Trois tailles de sprite
//   (proche, moyen, lointain) simulent la profondeur.
// • Très haut, un second drone cartographie la vallée en allers-retours réguliers.
// • De temps en temps, un train traverse le viaduc, fenêtres allumées. Quelques oiseaux.
// • Orage : le drone reste posé, feux clignotants, et la pilote attend.
//
// Le décor est peint UNE fois par ambiance dans trois calques (this.bg : ciel, montagnes,
// vallée lointaine ; this.mid : viaduc et collines ; this.fg : le flanc de colline de la
// pilote) ; chaque image ne dessine que ce qui bouge. Le sprite du drone est exporté
// (B.DroneSprite) pour l'animation d'ouverture.
// • Monde élargi (option « ext », pour le travelling d'ouverture) : les mêmes calques
//   peignent aussi ce qui est hors de l'écran. À droite : la voie quitte le viaduc par
//   une culée, longe un mur de soutènement (un ruisseau sort d'une buse) et s'enfonce
//   dans un tunnel ; sur le flanc de la pilote, la camionnette de l'équipe, une manche à
//   air, un panneau de randonnée, des chevreuils, une cabane éclairée et la lisière.
//   La partie écran reste identique au pixel près au fond d'écran normal.
(function () {
  'use strict';
  const B = window.Brume;
  const { Raster, sprite, hex, mix, rng, hash, noise, fbm, bayer } = B.PX;  const X = B.PXC;
  const C = hex;
  const WHITE = [255, 255, 255];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(a, 0, 1).toFixed(3)})`;
  const toHex = (c) => '#' + c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');

  /* ================= Sprites ================= */

  // Drone d'inspection vu de profil. Lettres : P/Q = hélices qui tournent (deux images),
  // m = hélice à l'arrêt, M = moteur, o = embout orange, a/A = bras, W/S = coque claire,
  // k = contour sombre (il détache le drone du décor), l = train d'atterrissage,
  // G = nacelle, c = objectif de la caméra, L = projecteur.
  const NEAR_BODY = [
    '...m' + '.............' + 'm...',
    '..oMo' + '...........' + 'oMo..',
    '.aoooaak' + 'WWWWW' + 'kaaoooa.',
    '..AAAAk' + 'WWWWWWW' + 'kAAAA..',
    '......k' + 'SWWWWWS' + 'k......',
    '.....l.k' + 'SSSSS' + 'k.l.....',
    '....l...' + 'kGGGk' + '...l....',
    '...l....' + 'kcGLk' + '....l...',
    '..lll...' + '.....' + '...lll..',
  ];
  const NEAR = {
    fly: [['PPPPPPP' + '.......' + 'PPPPPPP', ...NEAR_BODY], ['.QQQQQ.' + '.......' + '.QQQQQ.', ...NEAR_BODY]],
    parked: ['.mmmmm.' + '.......' + '.mmmmm.', ...NEAR_BODY],
    w: 21, h: 10, navL: [1, 3], navR: [19, 3], strobe: [10, 2], lens: [11, 8], cam: [9, 8],
  };
  const MID_BODY = ['.mMm' + '.....' + 'mMm.', 'oaaak' + 'WWW' + 'kaaao', '..lk' + 'SWWWS' + 'kl..', '.l...' + 'kLk' + '...l.', 'll...' + '...' + '...ll'];
  const MID = {
    fly: [['PPPP' + '.....' + 'PPPP', ...MID_BODY], ['.QQ.' + '.....' + '.QQ.', ...MID_BODY]],
    parked: ['.mm.' + '.....' + '.mm.', ...MID_BODY],
    w: 13, h: 6, navL: [0, 2], navR: [12, 2], strobe: [6, 1], lens: [6, 4], cam: [5, 4],
  };
  const FAR_BODY = ['oa' + 'WWWWW' + 'ao', '.l.k' + 'L' + 'k.l.', 'l...' + '.' + '...l'];
  const FAR = {
    fly: [['PP' + '.....' + 'PP', ...FAR_BODY], ['.Q' + '.....' + 'Q.', ...FAR_BODY]],
    parked: ['mm' + '.....' + 'mm', ...FAR_BODY],
    w: 9, h: 4, navL: [0, 1], navR: [8, 1], strobe: [4, 0], lens: [4, 2], cam: [3, 2],
  };
  const DRONE_PAL = {
    P: '#e2e7ee', Q: '#9aa3b0', m: '#3a3e46', M: '#555a64', o: '#ff7a1c', a: '#c9cfd8', A: '#8d95a2',
    k: '#262a31', W: '#f3f5f8', S: '#a9b1bd', l: '#3d424b', G: '#2c2f36', c: '#3fb4f0', L: '#fff1c2',
  };
  const makeSet = (def) => ({
    ...def,
    fly: def.fly.map((f) => sprite(f, DRONE_PAL)),
    parked: sprite(def.parked, DRONE_PAL),
  });
  const NEAR_SET = makeSet(NEAR);
  B.DroneSprite = { frames: NEAR_SET.fly, parked: NEAR_SET.parked, w: NEAR.w, h: NEAR.h, mid: makeSet(MID), far: makeSet(FAR) };

  // Petit drone de cartographie, très haut (silhouette ; on le repère surtout à ses feux).
  const MAPPER = ['qq...qq', '.kkWkk.', '..k.k..'];
  const MAPPER_PAL = { q: '#8a92a0', k: '#2a2f3a', W: '#c4cad4' };

  // La télépilote (12 × 21), tournée vers la gauche (vers le viaduc) : casque blanc,
  // veste sombre, gilet orange haute visibilité à bandes réfléchissantes.
  const LEGS = ['...pppppp...', '...ppp.ppp..', '...pp...pp..', '...pp...pp..', '..sss..sss..'];
  const HEAD_FWD = ['....bbbb....', '...bbbbbb...', '..bbbbbbbb..', '.BBBBBBBB...', '..kekhhhhh..', '..kkkkhhhh..', '..kkkkkhh...', '...KkkkK....', '.....kK.....'];
  const PILOT = {
    // Elle lève la tête vers le drone (la radiocommande à la main).
    look: [
      '.....bbbb...', '...BBbbbbb..', '..BBbbbbbbb.', '..kebbbbbbb.', '..kkkhhhhh..', '...kkkhhhh..', '...kkkkhh...', '....KkkK....', '.....kK.....',
      '...dvvvvd...', '..dvvvvvvd..', '..drrrrrrrd.', '.advvvvvvVd.', '.kccgckvvVd.', '.kccccrrrVd.', '..vvvvvvvV..', ...LEGS,
    ],
    // Elle regarde devant elle et joue des manettes (deux images : les pouces bougent).
    sticks: [
      ...HEAD_FWD,
      '...dvvvvd...', '..dvvvvvvd..', '.adrrrrrrrd.', '.kccgcvvvVd.', '.kcccckvvVd.', '..vrrrrrrVd.', '..vvvvvvvV..', ...LEGS,
    ],
    sticks2: [
      ...HEAD_FWD,
      '...dvvvvd...', '..dvvvvvvd..', 'a.drrrrrrrd.', '.kcgccvvvVd.', '.kccccvkvVd.', '..vrrrrrrVd.', '..vvvvvvvV..', ...LEGS,
    ],
    // Elle consulte sa tablette (écran lumineux), tête baissée.
    tablet: [
      '............', '....bbbb....', '...bbbbbb...', '..bbbbbbbb..', '.BBBBBBBB...', '..kkkhhhhh..', '..kekhhhh...', '...kkkhh....', '....KkK.....',
      '...dvvvvd...', '..dvvvvvvd..', '.tTTTtrrrrd.', '.tTTTtvvvVd.', '.ktttkvvvVd.', '..vrrrrrrVd.', '..vvvvvvvV..', ...LEGS,
    ],
  };
  const PILOT_PAL = {
    b: '#f2f1ea', B: '#c4c3ba', h: '#2a1c18', k: '#d8a88a', K: '#a87a62', e: '#1a1010', d: '#2a3346',
    v: '#ff8a1e', V: '#c4581a', r: '#e8ecea', p: '#2c3040', s: '#141418', c: '#2a2c34', g: '#7fe3ff',
    a: '#9a9eaa', T: '#cfeaff', t: '#3a3e48',
  };
  // Lettres qui restent vives la nuit (écrans, bandes réfléchissantes).
  const PILOT_GLOW = 'rgT';

  // Valise de la station sol, couvercle ouvert (écran de télémétrie dedans).
  const CASE = [
    '.LLLLLLLLLLLL.', '.LssssssssssL.', '.LssssssssssL.', '.LssssssssssL.', '.LssssssssssL.', '.LLLLLLLLLLLL.',
    'CCCCCCCCCCCCCC', 'ckkkkkkkkkkkkc', 'cccccccccccccc', 'ccmccccccccmcc', 'cccccccccccccc', '.dddddddddddd.',
  ];
  const CASE_PAL = { L: '#2b2e34', s: '#141c24', C: '#4a4e56', k: '#1e2024', c: '#33363d', m: '#8a8e96', d: '#1a1b1e' };
  // Antenne panneau de la station, sur son trépied.
  const ANTENNA = ['.AAAA.', 'AaaaaA', 'AaaaaA', 'AaaaaA', '.AAAA.', '..tt..'];
  const ANTENNA_PAL = { A: '#3a3e46', a: '#b8bec6', t: '#2a2d33' };

  // Copie un dessin texte directement dans un Raster.
  function stamp(r, rows, pal, x, y) {
    const cols = {};
    for (const k of Object.keys(pal)) cols[k] = Array.isArray(pal[k]) ? pal[k] : C(pal[k]);
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const c = cols[row[i]];
        if (c) r.set(x + i, y + j, c);
      }
    });
  }

  // Ligne de crête : bruit « replié » (arêtes vives des montagnes).
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

  // Sapin à étages, éclairé à droite. col = [sombre, moyen, clair, tronc] ; snow = [ombre, lumière].
  function pine(r, cx, base, h, col, snow, seed) {
    cx = Math.round(cx);
    base = Math.round(base);
    h = Math.max(3, Math.round(h));
    const [dark, midc, light, trunk] = col;
    const top = base - h;
    r.set(cx, base - 1, trunk);
    r.set(cx, base - 2, trunk);
    const crownH = h - 1;
    const maxHalf = Math.max(1, h * 0.26);
    const tiers = Math.max(1, Math.round(crownH / clamp(h * 0.24, 3, 8)));
    for (let y = 0; y < crownH; y++) {
      const tp = ((y + 0.5) / crownH) * tiers;
      const k = Math.min(tiers - 1, Math.floor(tp));
      const p = tp - k;
      const tw = (maxHalf * (k + 1)) / tiers;
      const start = k === 0 ? 0 : ((maxHalf * k) / tiers) * 0.5;
      const half = Math.round(start + (tw - start) * p + (hash(y, 1, seed) - 0.5) * 0.9);
      for (let dx = -half; dx <= half; dx++) {
        let c = dx > half * 0.35 ? light : dx < -half * 0.4 ? dark : midc;
        if (hash(cx + dx, top + y, seed) < 0.12) c = midc;
        if (snow && (p < 0.3 || ((dx === -half || dx === half) && p < 0.6)) && hash(dx, y, seed + 2) < 0.6) c = dx > 0 ? snow[1] : snow[0];
        r.set(cx + dx, top + y, c);
      }
    }
  }

  // Arbre feuillu (couronne bosselée). pal = [sombre, moyen, clair, accent, tronc].
  function broadleaf(r, cx, base, h, pal, seed) {
    cx = Math.round(cx);
    base = Math.round(base);
    const cy = base - h * 0.6;
    const rad = h * 0.42;
    for (let y = Math.round(cy); y < base; y++) r.set(cx, y, pal[4]);
    for (let y = Math.floor(cy - rad - 1); y <= Math.ceil(cy + rad); y++) {
      for (let x = Math.floor(cx - rad - 1); x <= Math.ceil(cx + rad + 1); x++) {
        const dx = (x - cx) / rad;
        const dy = (y - cy) / rad;
        const n = fbm(x * 0.35, y * 0.35, seed, 3);
        if (dx * dx + dy * dy > 0.45 + n * 0.9) continue;
        const l = dx * 0.55 - dy * 0.7 + (n - 0.5) * 0.9;
        let c = l > 0.3 ? pal[2] : l > -0.3 ? pal[1] : pal[0];
        if (hash(x, y, seed) < 0.06) c = pal[3];
        r.set(x, y, c);
      }
    }
  }

  // Rocher arrondi éclairé par le haut. K = [sombre, moyen, clair] ; top = neige ou null.
  function rock(r, cx, cy, rx, ry, K, top) {
    for (let y = cy - ry; y <= cy; y++) {
      for (let x = cx - rx; x <= cx + rx; x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy > 1) continue;
        const l = -dx * 0.35 - dy * 0.85 + (hash(x, y, 5) - 0.5) * 0.3;
        let c = l > 0.55 ? K[2] : l > 0 ? K[1] : K[0];
        if (top && dy < -0.5 + hash(x, 3, 9) * 0.3) c = top;
        r.set(x, y, c);
      }
    }
  }

  /* ================= Monde élargi (animation d'ouverture) =================
   * Pour l'ouverture, la scène peut peindre un monde plus large que l'écran : x va de
   * −extL à W + extR, l'écran restant en [0, W). Tout se calcule en coordonnées de la
   * scène (bruits, trames) ; seule la toile est décalée. Ainsi, la partie écran du monde
   * élargi est identique, au pixel près, au fond d'écran normal. */

  // Une toile dont l'origine est décalée : (x, y) en coordonnées de la scène.
  class XRaster extends Raster {
    constructor(x0, w, h) {
      super(w, h);
      this.ox = -x0;
    }
    set(x, y, c, a = 255) {
      super.set((x | 0) + this.ox, y, c, a);
    }
    get(x, y) {
      return super.get((x | 0) + this.ox, y);
    }
  }

  // Éclairage peint (comme B.PXC.applyLight), mais en coordonnées de la scène, sur [x0, x1).
  function lightPass(r, x0, x1, lights, ambient, warm, mask) {
    for (let y = 0; y < r.h; y++) {
      for (let x = x0; x < x1; x++) {
        if (mask && !mask(x, y)) continue;
        const px = x + r.ox;
        if (px < 0 || px >= r.w) continue;
        const i = (y * r.w + px) * 4;
        if (!r.data[i + 3]) continue;
        let I = 0;
        for (const l of lights) {
          const dx = x - l.x;
          const dy = (y - l.y) * (l.sy || 1);
          I += l.k / (1 + (dx * dx + dy * dy) / (l.r * l.r));
        }
        const q = Math.floor(Math.min(1.3, I) * 6 + bayer(x, y)) / 6;
        for (let c = 0; c < 3; c++) r.data[i + c] = Math.min(255, r.data[i + c] * (ambient[c] + warm[c] * q));
      }
    }
  }

  // Calque des halos (comme B.PXC.makeHalo), en coordonnées de la scène et seulement
  // autour de chaque halo (les sommes se font dans le même ordre : résultat identique).
  function haloLayer(x0, w, H, halos) {
    const r = new XRaster(x0, w, H);
    const n = w * H;
    const R = new Float64Array(n);
    const G = new Float64Array(n);
    const Bl = new Float64Array(n);
    for (const h of halos) {
      const ya = Math.max(0, Math.floor(h.y - h.r / 1.2) - 1);
      const yb = Math.min(H - 1, Math.ceil(h.y + h.r / 1.2) + 1);
      const xa = Math.max(x0, Math.floor(h.x - h.r) - 1);
      const xb = Math.min(x0 + w - 1, Math.ceil(h.x + h.r) + 1);
      for (let y = ya; y <= yb; y++) {
        for (let x = xa; x <= xb; x++) {
          const d = Math.hypot(x - h.x, (y - h.y) * 1.2);
          if (d > h.r) continue;
          const q = (Math.floor((1 - d / h.r) ** 1.6 * 5 + bayer(x, y) * 0.9) / 5) * (h.k || 0.55);
          const i = y * w + (x - x0);
          R[i] += h.c[0] * q;
          G[i] += h.c[1] * q;
          Bl[i] += h.c[2] * q;
        }
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (R[i] + G[i] + Bl[i] > 2) r.set(x + x0, y, [R[i], G[i], Bl[i]]);
      }
    }
    return r.toCanvas();
  }

  // Courbe lisse (Hermite) par points [u, v] ; m0 = pente au premier point.
  function profile(pts, u, m0) {
    if (u <= pts[0][0]) return pts[0][1];
    const n = pts.length;
    if (u >= pts[n - 1][0]) return pts[n - 1][1];
    let i = 0;
    while (u > pts[i + 1][0]) i++;
    const tan = (k) => (k === 0 ? m0 : k === n - 1 ? 0 : (pts[k + 1][1] - pts[k - 1][1]) / (pts[k + 1][0] - pts[k - 1][0]));
    const [u0, v0] = pts[i];
    const [u1, v1] = pts[i + 1];
    const h = u1 - u0;
    const t = (u - u0) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * h * tan(i) + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * h * tan(i + 1);
  }
  const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

  // Le flanc de colline de la pilote, au-delà du bord droit : une butte, le replat où
  // stationne la camionnette, le pré des chevreuils, la cabane, puis la lisière.
  // [d / W, hauteur au-dessus du replat / H].
  const FG_RIGHT = [[0, 0.04], [0.08, 0.085], [0.19, 0.055], [0.32, 0.028], [0.5, 0.022], [0.6, 0.03], [0.72, 0.048], [0.86, 0.032], [1.0, 0.016], [1.12, 0.026], [1.24, 0.045], [1.36, 0.055], [1.5, 0.1], [1.62, 0.15], [1.9, 0.18]];

  // La camionnette de l'équipe (de profil, l'avant à gauche) : bandes réfléchissantes,
  // gyrophare éteint sur le toit.
  const VAN = [
    '...........bBb................',
    '.....kkkkkkkkkkkkkkkkkkkkkkkk.',
    '....kWWWWWWWWWWWWWWWWWWWWWWWWk',
    '...kgWWgggggWgggggWWWWWWWWWWWk',
    '..kggWWgggggWgggggWWWWWWWWWWWk',
    '.kgggWWgggggWgggggWWWWWWWWWWWk',
    'kWWWWWWWWWWWWWWWWWWWWWWWWWWWWk',
    'kWWWWWWWWWWWkWWWWWWWWWWWWWWWWk',
    'koooYYooooYYooooYYooooYYooooYk',
    'kWWWWWWWWWWWkWWWWWWWWWWWWWWWWk',
    'lSSSSSSSSSSSSSSSSSSSSSSSSSSSSr',
    'kSSkddkSSSSSSSSSSSSSSSkddkSSSk',
    '...dmmd...............dmmd....',
    '....dd.................dd.....',
  ];
  const VAN_PAL = {
    k: '#1e2228', W: '#c3c9d2', g: '#2b3546', o: '#c8641e', Y: '#cfc06a', S: '#3a3e46', d: '#141416',
    m: '#5e626a', l: '#d8d2b4', r: '#8a2a24', b: '#6a4e2a', B: '#9a7030',
  };
  // Chevreuil (tourné vers la gauche) : tête levée, puis tête baissée qui broute.
  const DEER_BODY = ['...bbbbbbbbt', '...bBBBBBbb.'];
  const DEER = {
    up: ['.e..........', '.he.........', 'hhh.........', 'khh.........', '..h.........', '..hbbbbbbbt.', ...DEER_BODY, '...l.l..l.l.', '...l.l..l.l.', '...s.s..s.s.'],
    down: ['............', '............', '............', '............', '............', '...bbbbbbbt.', '..hbbbbbbbbt', '.hhbBBBBBbb.', '.hhl.l..l.l.', 'ehhl.l..l.l.', 'k..s.s..s.s.'],
  };
  const DEER_PAL = { h: '#6a5444', b: '#6a5444', B: '#8a735e', e: '#4e3e34', k: '#1a1616', l: '#4a3c32', s: '#2a2420', t: '#c8c0b2' };

  /* ================= Ambiances (une par effet météo) ================= */
  // L'heure bleue par défaut : tout est sourd, seuls les drones et la pilote sont vifs.
  const BASE = {
    sky: ['#262e46', '#343e5a', '#4a536e', '#666b82', '#8a8592', '#ad978e'],
    glow: 0.55, // bande tiède sur l'horizon (là où le soleil vient de se coucher)
    glowC: '#d0a68a',
    stars: 0.1,
    milky: 0,
    moon: 'pale',
    clouds: 'dusk',
    cloud: ['#3c4560', '#8a7c88'],
    far: ['#5f6579', '#696f84', '#555b70'], // base, face éclairée, face à l'ombre
    farFade: 0.42,
    near: ['#41485c', '#495066', '#3a4155'],
    nearFade: 0.1,
    snowcap: ['#7a8094', '#8a8fa1', '#6c7286'],
    snowline: 0.14,
    valley: ['#4a5264', '#535b6a', '#434a5b'],
    river: '#9a8f96',
    house: ['#3e4456', '#596072'], // murs, toits
    lit: 0.35,
    win: '#e9c48c',
    mist: '#8e909f',
    mistK: 0.55,
    hill: ['#323a4b', '#3c4455', '#2a3141'], // base, clair, sombre
    pine: ['#262d3a', '#2e3644', '#3a4351', '#211f20'],
    pineSnow: null,
    decid: null,
    concrete: ['#7d8291', '#a3a2a8', '#626878', '#4b5061'], // base, arête éclairée, ombre, sous-face
    lamps: 0.6,
    lampC: '#ffd99a',
    ground: ['#232a2a', '#2c3432', '#37413b', '#4f5b4c'], // sombre, moyen, clair, liseré
    dirt: ['#33302e', '#403b37'],
    grass: '#56614c',
    rock: ['#2c3036', '#3a3f46', '#4d535a'],
    pilotDim: 0,
    night: false,
    birds: true,
    mapper: true,
    fireflies: 0,
    snow: false,
    wet: false,
    storm: false,
  };
  const NIGHT = {
    glow: 0.18,
    glowC: '#4a5a7a',
    moon: 'full',
    clouds: 'none',
    far: ['#262e43', '#30384f', '#20273b'],
    farFade: 0.22,
    near: ['#1c2335', '#232b3e', '#171d2d'],
    nearFade: 0.1,
    snowcap: ['#414b66', '#5a647e', '#36405a'],
    valley: ['#18202a', '#1c2430', '#151c26'],
    river: '#3c4862',
    house: ['#1c2230', '#2a3040'],
    lit: 0.6,
    mist: '#36425c',
    mistK: 0.5,
    hill: ['#141b26', '#19212d', '#10161f'],
    pine: ['#0e141c', '#121a22', '#19232d', '#0e0c0c'],
    concrete: ['#454c5e', '#5a6070', '#363c4c', '#282d3a'],
    lamps: 1,
    ground: ['#0f1515', '#131b1a', '#18221f', '#26332c'],
    dirt: ['#1a1a1a', '#222120'],
    grass: '#2c3a2e',
    rock: ['#161a1e', '#1e2328', '#2a3036'],
    pilotDim: 0.32,
    night: true,
    birds: false,
  };
  const LOOKS = {
    none: {},
    // Neige : ciel couvert et pâle, tout est blanchi, le drone se détache par son contour.
    snow: {
      sky: ['#56606f', '#646d7c', '#747c8a', '#868d99', '#989ea8', '#a8acb3'],
      glow: 0.12,
      glowC: '#c4b4b0',
      stars: 0,
      moon: false,
      clouds: 'overcast',
      cloud: ['#5c6574', '#6c7482', '#7e8592'],
      far: ['#8c94a3', '#a2a9b6', '#78808f'],
      farFade: 0.45,
      near: ['#6e7787', '#828a98', '#5e6676'],
      nearFade: 0.2,
      snowcap: ['#a6adb9', '#c4cad3', '#8e96a4'],
      snowline: 1.2,
      valley: ['#a0a7b2', '#adb3bd', '#8f97a3'],
      river: '#6d7684',
      house: ['#5a5f6a', '#c8ccd2'],
      lit: 0.3,
      mist: '#a3a8b2',
      mistK: 0.6,
      hill: ['#8a92a0', '#9ea5b1', '#747c8b'],
      pine: ['#545c6a', '#626a78', '#727a88', '#3a3638'],
      pineSnow: ['#a2aab6', '#c4cad3'],
      concrete: ['#8b8f99', '#a6a8ae', '#6f747f', '#5b6069'],
      lamps: 0.3,
      ground: ['#8e96a3', '#a7aeb9', '#bcc2cb', '#d2d7de'],
      dirt: ['#6e6a66', '#7e7a74'],
      grass: '#6a6e66',
      rock: ['#4a4e56', '#5e636b', '#c4cad2'],
      snow: true,
      birds: false,
      pilotDim: 0.05,
    },
    // Pluie : plafond bas qui mange les sommets, brume épaisse, sol mouillé.
    rain: {
      sky: ['#20262f', '#283039', '#313a44', '#3b4550', '#46505b', '#505a64'],
      glow: 0,
      stars: 0,
      moon: false,
      clouds: 'overcast',
      cloud: ['#232a33', '#2d353f', '#3a434e'],
      far: ['#434c58', '#4c5561', '#3b434f'],
      farFade: 0.55,
      near: ['#363e4a', '#3e4652', '#2f3642'],
      nearFade: 0.3,
      snowcap: ['#56606c', '#606a76', '#4c5662'],
      snowline: 0.15,
      valley: ['#36403e', '#3c4644', '#303a39'],
      river: '#5a6470',
      lit: 0.45,
      mist: '#5c6570',
      mistK: 0.85,
      hill: ['#28302f', '#2e3735', '#222a2a'],
      pine: ['#1c2424', '#222c2c', '#2c3636', '#1a1818'],
      concrete: ['#5c626c', '#6e747c', '#4a5059', '#3a3f48'],
      lamps: 0.8,
      ground: ['#1d2423', '#242c2a', '#2d3633', '#3e4943'],
      dirt: ['#2a2826', '#33302d'],
      grass: '#3e4a40',
      rock: ['#20252a', '#2a3036', '#384048'],
      wet: true,
      lowCloud: true,
      birds: false,
      mapper: false,
      pilotDim: 0.15,
    },
    // Printemps : la même heure bleue, horizon un peu rosé, cerisiers en fleurs (passés).
    sakura: {
      sky: ['#2a2e4a', '#3a3d5c', '#545670', '#7a7286', '#a28892', '#bf9f9c'],
      glowC: '#d6a2a0',
      cloud: ['#454563', '#9c8090'],
      decid: 'sakura',
      ground: ['#232b29', '#2c3531', '#38433a', '#55634c'],
      grass: '#5a6a50',
    },
    // Automne : horizon ambré, feuillus roux sur les collines.
    leaves: {
      sky: ['#282a3e', '#383a50', '#545266', '#7c6c76', '#a6847a', '#bf9a80'],
      glowC: '#d49c76',
      cloud: ['#45405a', '#9a7c74'],
      decid: 'autumn',
      ground: ['#2a2a24', '#34332a', '#424032', '#5e5940'],
      grass: '#6a6040',
    },
    // Nuit d'été : lune, étoiles, lucioles dans l'herbe ; le projecteur du drone brille.
    fireflies: {
      ...NIGHT,
      sky: ['#0a0f1e', '#0f1628', '#151e34', '#1c2740', '#24304a', '#2c384f'],
      stars: 0.9,
      milky: 0.35,
      fireflies: 18,
    },
    // Nuit d'étoiles filantes : ciel noir et Voie lactée.
    starfall: {
      ...NIGHT,
      sky: ['#05081a', '#0a0f26', '#111834', '#192242', '#212b4c', '#283352'],
      stars: 1.5,
      milky: 1,
      moon: false,
    },
  };
  LOOKS.storm = {
    ...LOOKS.rain,
    sky: ['#14181f', '#1a2028', '#222932', '#2b333d', '#353e49', '#3e4853'],
    cloud: ['#161b22', '#20262f', '#2c343e'],
    far: ['#363e4a', '#3e4652', '#2f3642'],
    near: ['#2a313b', '#313843', '#242a33'],
    concrete: ['#4e545e', '#5e646e', '#3e434c', '#30353d'],
    mist: '#4a525d',
    lamps: 1,
    storm: true,
    pilotDim: 0.22,
  };
  const DECID = {
    sakura: [['#4e4554', '#625466', '#786676', '#8c7888', '#262224'], ['#524656', '#665868', '#7c6a7a', '#907c8c', '#262224']],
    autumn: [['#46362e', '#584234', '#6a503c', '#7a5c44', '#24201e'], ['#423a30', '#534836', '#65583e', '#756646', '#24201e']],
  };

  /* ================= La scène ================= */
  class Drones {
    constructor(W, H, opts = {}) {
      this.W = W;
      this.H = H;
      // Monde élargi (ouverture) : x ∈ [−extL, W + extR) ; l'écran reste en [0, W).
      const ext = (opts && opts.ext) || {};
      this.extL = Math.max(0, Math.round(ext.left || 0));
      this.extR = Math.max(0, Math.round(ext.right || 0));
      this.X0 = -this.extL;
      this.X1 = W + this.extR;
      this.WW = this.X1 - this.X0;
      this.t = 0;
      this.effect = null;
      this.bg = null;
      this.layout();
      // Le pad : point où se posent les patins du drone.
      this.pad = { x: this.L.padX, y: this.L.padY };
      const fast = (this.fast = X.fastTest());

      this.spr = {
        near: NEAR_SET,
        mid: B.DroneSprite.mid,
        far: B.DroneSprite.far,
        mapper: sprite(MAPPER, MAPPER_PAL),
      };
      // Le drone d'inspection (x, y = point de contact des patins ; depth : 1 = sur le pad,
      // ~0,12 = au viaduc, au loin).
      this.insp = { phase: 'pad', timer: fast ? 0.5 : 5 + Math.random() * 5, x: this.L.padX, y: this.L.padY, depth: 1, t: 0, wp: 0, speed: 1, tgt: null };
      this.pilot = { pose: 'look', timer: fast ? 1.2 : 3 + Math.random() * 3, frameT: 0, glance: 4 };
      this.train = null;
      this.nextTrain = fast ? 1 : 12 + Math.random() * 25;
      this.flock = new X.Flock({ x0: this.X0, x1: this.X1, y0: Math.round(H * 0.08), y1: Math.round(H * 0.3), rate: [14, 30], color: '#2a3040' });
      if (fast) this.flock.next = 0.8;
      this.bolt = null;
      this.flash = 0;
      this.nextBolt = fast ? 1.5 : 4 + Math.random() * 6;
      // Monde élargi : fumée de la cheminée de la cabane.
      this.smoke = new X.Puffs('190,196,210');
      this.smokeT = 0;
    }

    // Le monde élargi contient-il le point x (avec une marge) ?
    inWorld(x, m = 0) {
      return x - m >= this.X0 && x + m < this.X1;
    }

    /* ---------- Plan de la scène (indépendant de l'ambiance) ---------- */
    layout() {
      const { W, H } = this;
      const L = (this.L = {});
      L.hz = Math.round(H * 0.6); // pied des montagnes, début de la vallée lointaine
      L.deckY = Math.round(H * 0.36); // dessus du tablier du viaduc
      L.vcx = Math.round(W * 0.44); // axe de la vallée
      L.vfloor = Math.round(H * 0.71); // fond de la vallée sous le viaduc
      L.groundY = Math.round(H * 0.8); // replat de la pilote
      L.moon = { x: Math.round(W * 0.8), y: Math.round(H * 0.11), r: 6 };

      // Les profils (relief, sol, colline) couvrent le monde élargi : l'indice d'un x de la
      // scène est x + o.
      const { X0, X1, WW } = this;
      const o = this.extL;
      // Bouts du viaduc (culées) et, à droite, l'entrée du tunnel (monde élargi seulement).
      L.abL = -Math.round(W * 0.16); // culée gauche : [abL − abW, abL)
      L.abR = W + Math.round(W * 0.08); // culée droite : [abR, abR + abW)
      L.abW = 8;
      L.portalX = W + Math.round(W * 0.5); // mur de tête du tunnel : [portalX, portalX + 19)
      L.portalClip = L.portalX + 5; // le train disparaît dans le noir ici
      this.hasPortal = this.extR > 0 && L.portalX + 24 < X1;

      // Relief : chaîne lointaine (haute), chaîne proche (plus basse, qui s'ouvre sur la vallée).
      L.far = new Int16Array(WW);
      L.near = new Int16Array(WW);
      L.floor = new Int16Array(WW);
      for (let x = X0; x < X1; x++) {
        L.far[x + o] = Math.round(L.hz - 6 - H * (0.17 + 0.3 * Math.pow(ridge(x * 0.0078 + 5, 13), 1.1) * (0.7 + 0.5 * noise(x * 0.005, 2.2, 17))));
        const side = clamp(Math.abs(x - L.vcx) / (W * 0.55), 0, 1);
        L.near[x + o] = Math.round(L.hz - 2 - H * (0.08 + 0.09 * Math.pow(ridge(x * 0.014 + 20, 29), 1.2) + 0.22 * Math.pow(side, 1.5)));
        // Profil du sol au droit du viaduc : une vallée en U, qui remonte jusqu'au tablier sur les bords.
        const u = (x - L.vcx) / (W * 0.56);
        const b = Math.abs(u) >= 1 ? 0 : Math.pow(0.5 + 0.5 * Math.cos(Math.PI * u), 0.5);
        let f = Math.round(L.deckY + 7 + (L.vfloor - L.deckY - 7) * b + (noise(x * 0.06, 4.4, 9) - 0.5) * 4);
        // Au-delà des culées, la voie court sur le flanc : le sol affleure sous le ballast.
        // (Entre la culée droite et le tunnel, et près de la culée gauche, la plateforme est
        // tenue par un mur de soutènement en moellons.)
        const wall = (x >= L.abR + L.abW && x < L.portalX + 2) || (x < L.abL - L.abW && x >= L.abL - L.abW - Math.round(W * 0.3));
        if (x >= L.abR + L.abW || x < L.abL - L.abW) f = L.deckY + (wall ? 7 : 3) + (noise(x * 0.09, 7.7, 9) > 0.62 ? 1 : 0);
        else if (x >= L.abR || x < L.abL) f = L.deckY + 9;
        L.floor[x + o] = f;
      }
      // Le ciel atteint ses couleurs d'horizon à hauteur des sommets.
      let peak = L.hz;
      for (let x = 0; x < W; x++) peak = Math.min(peak, L.far[x + o], L.near[x + o]);
      L.skyEnd = Math.min(L.hz, peak + Math.round(H * 0.12));
      // Les montagnes boisées où la voie s'enfonce au-delà des culées (plan moyen) :
      // hauteur de leur crête au-dessus du tablier (0 = pas de montagne).
      L.flank = new Int16Array(WW);
      for (let x = X0; x < X1; x++) {
        let h = 0;
        if (x >= L.abR + L.abW) {
          const d = x - (L.abR + L.abW);
          h = H * 0.18 * smoothstep(d / (W * 0.75)) + H * 0.05 * ridge(x * 0.03, 61) * Math.min(1, d / 30);
        } else if (x < L.abL - L.abW) {
          const d = L.abL - L.abW - x;
          h = H * 0.12 * smoothstep(d / (W * 0.8)) + H * 0.04 * ridge(x * 0.03, 67) * Math.min(1, d / 30);
        }
        L.flank[x + o] = Math.max(0, Math.round(h - 2));
      }

      // Le viaduc : piles régulières, voûtes en plein cintre surbaissé.
      L.span = clamp(Math.round(H * 0.2), 36, 54);
      L.slab = L.deckY + 4; // sous le tablier
      L.springY = L.slab + Math.round(L.span * 0.36); // naissance des voûtes (haut des piles)
      L.hwTop = 3; // demi-largeur des piles en tête
      L.taper = Math.max(10, Math.round((L.vfloor - L.springY) / 2.5)); // fruit des piles
      L.piers = [];
      for (let k = -Math.ceil(W / L.span) - 1; k <= Math.ceil(W / L.span) + 1; k++) {
        const x = Math.round(L.vcx + L.span * (k + 0.5));
        if (x > -L.span && x < W + L.span) L.piers.push(x);
      }
      // La pile inspectée : juste à gauche de l'axe de la vallée (la plus haute).
      L.tp = Math.round(L.vcx - L.span * 0.5);

      // Premier plan : flanc de colline qui monte vers la droite jusqu'au replat de la pilote.
      L.fgTop = new Int16Array(WW);
      const px0 = W * 0.46;
      for (let x = X0; x < X1; x++) {
        let y = L.groundY + Math.round((noise(x * 0.08, 1.1, 5) - 0.5) * 2);
        if (x < px0) {
          const u = (px0 - x) / px0;
          y += Math.round(Math.pow(u, 1.4) * H * 0.15 + (noise(x * 0.05, 3.3, 6) - 0.5) * 4 * u);
        }
        if (x >= W) y -= Math.round(profile(FG_RIGHT, (x - W) / W, 0.52) * H);
        else if (x > W * 0.9) y -= Math.round(Math.pow((x - W * 0.9) / (W * 0.1), 1.3) * H * 0.04);
        L.fgTop[x + o] = y;
      }
      // Ce qui se trouve sur le flanc, au-delà du bord droit (monde élargi seulement).
      const at = (k) => W + Math.round(W * k);
      L.ext = {
        trackX: at(0.4), // la piste monte du bas de l'image jusqu'à la camionnette
        vanX: at(0.4),
        sockX: at(0.63),
        signX: at(0.72),
        fence: [at(0.8), at(1.0)],
        deer: [at(0.95), at(1.06)],
        cabinX: at(1.2),
        woodsX: at(1.4),
      };
      L.pilotX = Math.round(W * 0.72);
      L.feetY = L.groundY + 7;
      L.padX = L.pilotX - Math.max(30, Math.round(W * 0.13));
      L.padY = L.groundY + 6;
      L.caseX = L.pilotX + 15;
      L.caseY = L.feetY - CASE.length + 1;
      L.screen = { x: L.caseX + 2, y: L.caseY + 1, w: 10, h: 4 };
      L.tripodX = L.pilotX + 37;

      // Le parcours du drone de cartographie (allers-retours, en haut à gauche du ciel).
      const mx0 = Math.round(W * 0.08);
      const mx1 = Math.round(W * 0.36);
      const my0 = Math.round(H * 0.11);
      L.mapPath = [];
      for (let k = 0; k < 4; k++) {
        const y = my0 + k * 5;
        if (k % 2 === 0) L.mapPath.push([mx0, y], [mx1, y]);
        else L.mapPath.push([mx1, y], [mx0, y]);
      }
      L.mapLen = 0;
      for (let i = 1; i < L.mapPath.length; i++) L.mapLen += Math.hypot(L.mapPath[i][0] - L.mapPath[i - 1][0], L.mapPath[i][1] - L.mapPath[i - 1][1]);
    }

    // Demi-largeur d'une pile à la hauteur y.
    pierHalf(y) {
      const L = this.L;
      return L.hwTop + Math.floor(Math.max(0, y - L.springY) / L.taper);
    }

    /* ================= Peinture du décor ================= */
    build(effect) {
      this.effect = effect;
      const lk = (this.lk = { ...BASE, ...(LOOKS[effect] || {}) });
      const { W, H } = this;
      this.halos = [];
      this.twinkles = [];
      this.bg = this.paintBg(lk);
      this.mid = this.paintMid(lk);
      this.deckFront = this.paintDeckFront(lk);
      this.fg = this.paintFg(lk);
      this.mistFar = this.paintMist(lk, 14, 61, 0.9);
      this.mistNear = this.paintMist(lk, 12, 83, 0.75);
      this.halo = haloLayer(this.X0, this.WW, H, this.halos);
      this.makePilot(lk);
      this.makeFlies(lk);
      this.makeExtSprites(lk);
      // Orage : si le drone volait, il rentre tout de suite.
      const d = this.insp;
      if (lk.storm && (d.phase === 'go' || d.phase === 'scan')) {
        d.tgt = null;
        this.legTo('back', this.L.padX, this.cruiseY(), 1);
      }
    }

    makePilot(lk) {
      const k = lk.pilotDim;
      const tint = [16, 22, 40];
      const pal = {};
      for (const key of Object.keys(PILOT_PAL)) pal[key] = PILOT_GLOW.includes(key) ? PILOT_PAL[key] : toHex(mix(C(PILOT_PAL[key]), tint, k));
      this.pilotSpr = {};
      for (const key of Object.keys(PILOT)) this.pilotSpr[key] = sprite(PILOT[key], pal);
    }

    makeFlies(lk) {
      const { W, L } = this;
      const R = rng(303);
      this.flies = [];
      for (let k = 0; k < lk.fireflies; k++) {
        const x = Math.floor(R() * W * 0.55);
        this.flies.push({ x, y: L.fgTop[x + this.extL] - 4 - R() * 14, p: R() * 6.28, s: 0.25 + R() * 0.25, r: 6 + R() * 10 });
      }
      // Monde élargi : d'autres lucioles dans le pré des chevreuils, devant la cabane.
      if (this.extR > 0 && lk.fireflies) {
        const R2 = rng(304);
        const [a, b] = [W + W * 0.7, W + W * 1.3];
        for (let k = 0; k < lk.fireflies * 0.7; k++) {
          const x = Math.floor(a + R2() * (b - a));
          if (!this.inWorld(x, 4)) continue;
          this.flies.push({ x, y: L.fgTop[x + this.extL] - 4 - R2() * 14, p: R2() * 6.28, s: 0.25 + R2() * 0.25, r: 6 + R2() * 10 });
        }
      }
    }

    // Les chevreuils du monde élargi, teintés comme le reste du décor.
    makeExtSprites(lk) {
      this.deerSpr = null;
      if (!this.extR) return;
      const tint = lk.night ? [12, 16, 28] : C(lk.ground[0]);
      const k = lk.night ? 0.45 : lk.snow ? 0.05 : 0.22;
      const pal = {};
      for (const key of Object.keys(DEER_PAL)) pal[key] = toHex(mix(C(DEER_PAL[key]), tint, key === 't' ? k * 0.5 : k));
      this.deerSpr = {
        up: sprite(DEER.up, pal),
        down: sprite(DEER.down, pal),
        upR: sprite(DEER.up, pal, true),
        downR: sprite(DEER.down, pal, true),
      };
    }

    /* ---------- Fond : ciel, montagnes, vallée lointaine ---------- */
    paintBg(lk) {
      const { W, H, L, X0, X1, WW } = this;
      const o = this.extL;
      const r = new XRaster(X0, WW, H);
      const sky = lk.sky.map(C);
      const horizon = sky[sky.length - 1];
      const skyEnd = L.skyEnd;
      r.gradient(X0, 0, WW, skyEnd, sky, 12);
      r.rect(X0, skyEnd, WW, H - skyEnd, horizon);

      // Lueur tiède sur l'horizon, à gauche (le soleil vient de passer derrière les crêtes).
      if (lk.glow > 0) {
        const gc = C(lk.glowC);
        const y0 = Math.round(skyEnd - H * 0.24);
        const y1 = skyEnd;
        for (let y = y0; y < L.hz; y++) {
          const v = Math.pow(clamp((y - y0) / (y1 - y0), 0, 1), 1.4);
          for (let x = X0; x < X1; x++) {
            const g = Math.exp(-(((x - W * 0.3) / (W * 0.45)) ** 2)) * v * lk.glow;
            const q = Math.floor(g * 6 + bayer(x, y)) / 6;
            if (q > 0) r.tint(x, y, gc, Math.min(0.6, q * 0.55));
          }
        }
      }
      if (lk.milky) this.paintMilkyWay(r, lk);
      // Étoiles fixes, plus denses en haut ; certaines scintilleront.
      if (lk.stars > 0) {
        // (Les étoiles qui scintillent hors de l'écran sont rangées à part : celles de
        // l'écran restent les mêmes.)
        const extTw = [];
        const extMax = Math.round((40 * (WW - W)) / W);
        for (let y = 0; y < L.hz - 10; y++) {
          for (let x = X0; x < X1; x++) {
            const d = lk.stars * 0.011 * Math.max(0, 1 - y / (H * 0.45));
            const h = hash(x, y, 77);
            if (h >= d) continue;
            r.set(x, y, mix(r.get(x, y), [255, 248, 230], 0.25 + (h / d) * 0.6));
            if (h < d * 0.12) {
              const tw = { x, y, ph: hash(x, y, 78) * 6.28, sp: 0.8 + hash(x, y, 79) * 2 };
              if (x >= 0 && x < W) {
                if (this.twinkles.length < 40) this.twinkles.push(tw);
              } else if (extTw.length < extMax) extTw.push(tw);
            }
          }
        }
        this.twinkles.push(...extTw);
      }
      if (lk.moon) this.paintMoon(r, lk, sky);
      this.paintClouds(r, lk);

      // Montagnes : la chaîne lointaine (pâle), un voile de brume, puis la chaîne proche.
      const mist = C(lk.mist);
      this.paintRange(r, L.far, lk.far.map(C), lk.snowcap.map(C), lk.snowline, lk.farFade, horizon, 31);
      for (let y = L.hz - 34; y <= L.hz; y++) {
        const k = ((y - (L.hz - 34)) / 34) * lk.mistK;
        for (let x = X0; x < X1; x++) if (y >= L.far[x + o] && bayer(x, y) < k) r.tint(x, y, mist, 0.4);
      }
      this.paintRange(r, L.near, lk.near.map(C), lk.snowcap.map((c) => mix(C(c), C(lk.near[2]), 0.3)), lk.snowline * 0.8, lk.nearFade, horizon, 47);
      // Plafond nuageux qui mange les sommets (pluie, neige).
      if (lk.lowCloud) {
        const cc = lk.cloud.map(C);
        const base = Math.round(L.hz - H * 0.17);
        for (let y = 0; y < base + 8; y++) {
          for (let x = X0; x < X1; x++) {
            if (y < L.far[x + o]) continue;
            const n = fbm(x * 0.02, y * 0.08, 19, 3) + (base - y) / (H * 0.12);
            if (n < 0.62) continue;
            const q = Math.floor(clamp(n - 0.62, 0, 0.6) * 8 + bayer(x, y)) / 8;
            r.tint(x, y, cc[1], clamp(0.35 + q, 0, 0.9));
          }
        }
      }
      this.paintValley(r, lk);
      return r.toCanvas();
    }

    paintMilkyWay(r, lk) {
      const { W, H, L, X0, X1 } = this;
      const ax = -0.42 * (H / W);
      const y0 = H * 0.5;
      const nrm = Math.sqrt(1 + ax * ax);
      const glowC = [150, 145, 190];
      for (let y = 0; y < L.hz; y++) {
        for (let x = X0; x < X1; x++) {
          const d = (y - (y0 + ax * x * 1.9)) / nrm;
          if (Math.abs(d) > 20) continue;
          const n = fbm(x * 0.05, y * 0.05, 91, 4);
          let g = (1 - Math.abs(d) / 20) ** 1.5 * (0.4 + n) * lk.milky;
          if (Math.abs(d + (n - 0.5) * 10) < 2.5 && n > 0.45) g *= 0.25;
          const q = Math.floor(g * 4 + bayer(x, y)) / 4;
          if (q > 0) r.set(x, y, mix(r.get(x, y), glowC, Math.min(0.4, q * 0.25)));
          if (hash(x, y, 93) < g * 0.06) r.set(x, y, mix([255, 250, 240], glowC, hash(x, y, 94) * 0.5));
        }
      }
    }

    paintMoon(r, lk, sky) {
      const { x: mx, y: my, r: mr } = this.L.moon;
      const pale = lk.moon === 'pale';
      const veil = (c) => (pale ? mix(c, sky[2], 0.45) : c);
      const lit = veil(C('#f4ecd2'));
      const sh = veil(C('#d6caa6'));
      const crater = veil(C('#c4b894'));
      for (let y = -mr; y <= mr; y++) {
        for (let x = -mr; x <= mr; x++) {
          const d = Math.hypot(x, y);
          if (d > mr + 0.3) continue;
          let c = lit;
          const term = Math.hypot(x + 3.2, y) - (mr + 0.6);
          if (term < 0 && bayer(mx + x, my + y) < Math.min(1, -term / 2.5)) c = sh;
          if (term < -2.5) c = pale ? r.get(mx + x, my + y) : mix(sh, [60, 70, 100], 0.45);
          if (noise((mx + x) * 0.35, (my + y) * 0.35, 3) > 0.62 && term > -2.5) c = crater;
          r.set(mx + x, my + y, c);
        }
      }
      this.halos.push({ x: mx, y: my, r: pale ? 16 : 24, c: [190, 196, 220], k: pale ? 0.12 : 0.24 });
    }

    paintClouds(r, lk) {
      const { H, X0, X1 } = this;
      const cc = lk.cloud.map(C);
      if (lk.clouds === 'overcast') {
        // Ciel couvert : couches de nuages bosselées, plus claires vers l'horizon.
        for (let y = 0; y < this.L.hz; y++) {
          for (let x = X0; x < X1; x++) {
            const n = fbm(x * 0.018 + y * 0.01, y * 0.055, 9, 4) + (y / this.L.hz) * 0.12;
            const q = n * 3 + (bayer(x, y) - 0.5) * 0.35;
            const c = q < 1.35 ? cc[0] : q < 1.75 ? cc[1] : cc[2];
            r.set(x, y, mix(r.get(x, y), c, 0.75));
          }
        }
        return;
      }
      if (lk.clouds === 'none') return;
      // Longs nuages effilés, éclairés par dessous par la lueur de l'horizon.
      const y0 = Math.round(H * 0.06);
      const y1 = Math.round(H * 0.36);
      for (let y = y0; y < y1; y++) {
        for (let x = X0; x < X1; x++) {
          const n = fbm(x * 0.009 + y * 0.004, y * 0.12, 7, 4);
          if (n < 0.61) continue;
          const under = fbm(x * 0.009 + (y + 1) * 0.004, (y + 1) * 0.12, 7, 4) < 0.61;
          const lit = (y - y0) / (y1 - y0);
          let c = mix(cc[0], cc[1], Math.floor(lit * lit * 4 + bayer(x, y)) / 4);
          if (under) c = mix(c, cc[1], 0.5);
          if (n - 0.61 < 0.02 && bayer(x, y) < 0.5) continue; // bords effilochés
          r.set(x, y, mix(r.get(x, y), c, 0.8));
        }
      }
    }

    // Une chaîne de montagnes : faces éclairées et à l'ombre, ravines, neige dans les
    // couloirs, perspective atmosphérique vers la couleur de l'horizon.
    paintRange(r, top, cols, snowc, snowline, fade, horizon, seed) {
      const { W, L, X0, X1 } = this;
      const o = this.extL;
      const bottom = L.hz + 1;
      let ymin = 1e9;
      for (let x = 0; x < W; x++) ymin = Math.min(ymin, top[x + o]); // (sur l'écran seulement)
      const sl = ymin + (bottom - ymin) * snowline;
      for (let x = X0; x < X1; x++) {
        // Pente locale (à l'écran, bornée à l'écran comme toujours ; ailleurs, au monde).
        const g = x >= 0 && x < W ? top[Math.min(W - 1, x + 3) + o] - top[Math.max(0, x - 3) + o] : top[Math.min(X1 - 1, x + 3) + o] - top[Math.max(X0, x - 3) + o];
        const tx = top[x + o];
        for (let y = tx; y < bottom; y++) {
          const d = y - tx;
          const facet = -g * 0.55 + (noise(x * 0.12 + d * 0.07, d * 0.08, seed) - 0.5) * 8 + (noise(x * 0.035, 1.5, seed + 3) - 0.5) * 3;
          const face = facet > 1.1 ? 1 : facet < -1.4 ? 2 : 0;
          let c = cols[face];
          const streak = noise(x * 0.5, y * 0.06, seed + 5);
          const deep = (y - ymin) / (bottom - ymin);
          const snowy = y < sl + (streak - 0.5) * 16 && (d < 2 || streak > 0.3 + deep * 0.5);
          if (snowy && !(face === 2 && snowline > 1 && hash(x, y, seed) < 0.35)) c = snowc[face];
          if (d === 0 && face !== 2) c = mix(c, WHITE, 0.1);
          const f = fade + Math.max(0, deep - 0.5) * 0.6;
          const q = Math.floor(f * 6 + bayer(x, y)) / 6;
          r.set(x, y, mix(c, horizon, Math.min(0.85, q)));
        }
      }
    }

    // Le fond de la vallée, au loin : prés, haies, la rivière et le village.
    paintValley(r, lk) {
      const { W, H, L, X0, X1 } = this;
      const V = lk.valley.map(C);
      const mist = C(lk.mist);
      const horizon = C(lk.sky[lk.sky.length - 1]);
      for (let y = L.hz + 1; y < H; y++) {
        const k = y - L.hz;
        for (let x = X0; x < X1; x++) {
          const n = noise(x * 0.06, k * 0.35, 5);
          let c = n > 0.62 ? V[1] : n < 0.36 ? V[2] : V[0];
          if (k % 4 === 0 && noise(x * 0.1, y, 8) > 0.45) c = V[2]; // haies
          if (hash(x, y, 6) < 0.04) c = V[2]; // bosquets
          const f = clamp(0.55 - k / (H * 0.18), 0.05, 0.55) * (lk.mistK / 0.55);
          const q = Math.floor(f * 6 + bayer(x, y)) / 6;
          r.set(x, y, mix(c, mist, Math.min(0.8, q)));
        }
      }
      // Rivière : elle serpente en travers du fond de la vallée et reflète l'horizon.
      const rc = C(lk.river);
      for (let x = X0; x < X1; x++) {
        const y = Math.round(L.hz + 9 + Math.sin(x * 0.028 + 1) * 3 + Math.sin(x * 0.071) * 1.2 + (x / W) * 3);
        const thick = 1 + (Math.sin(x * 0.05) > 0.3 ? 1 : 0);
        for (let k = 0; k < thick; k++) {
          const c = hash(x, y + k, 9) < 0.25 ? mix(rc, horizon, 0.5) : rc;
          r.set(x, y + k, mix(c, mist, 0.35));
        }
        r.set(x, y + thick, mix(V[2], mist, 0.3));
      }
      // Le village : maisons, toits, clocher ; quelques fenêtres allumées.
      const R = rng(4242);
      const house = lk.house.map(C);
      const win = C(lk.win);
      const list = [];
      const groups = [
        [L.vcx - Math.round(W * 0.1), 8],
        [L.vcx + Math.round(W * 0.07), 4],
        [L.vcx - Math.round(W * 0.26), 3],
      ];
      for (const [cx, n] of groups) {
        for (let i = 0; i < n; i++) list.push({ x: Math.round(cx + (R() - 0.5) * n * 6), y: L.hz + 5 + Math.round(R() * 7), w: 3 + Math.floor(R() * 3), h: 2 + Math.floor(R() * 2), church: i === 0 && n > 6 });
      }
      list.sort((a, b) => a.y - b.y);
      let halos = 0;
      for (const hs of list) {
        const fade = clamp(0.4 - (hs.y - L.hz) * 0.02, 0.1, 0.4);
        const wall = mix(house[0], mist, fade);
        const roof = mix(house[1], mist, fade);
        r.rect(hs.x, hs.y - hs.h, hs.w, hs.h, wall);
        r.rect(hs.x, hs.y - hs.h - 1, hs.w, 1, roof);
        r.rect(hs.x + 1, hs.y - hs.h - 2, Math.max(1, hs.w - 2), 1, roof);
        if (hs.church) {
          r.rect(hs.x + hs.w, hs.y - 5, 2, 5, wall);
          r.rect(hs.x + hs.w, hs.y - 9, 1, 4, roof);
          r.set(hs.x + hs.w + 1, hs.y - 6, roof);
        }
        for (let wx = hs.x; wx < hs.x + hs.w; wx += 2) {
          if (R() > lk.lit) continue;
          r.set(wx, hs.y - 1, mix(win, wall, 0.15));
          if (halos++ < 8) this.halos.push({ x: wx, y: hs.y - 1, r: 4, c: [255, 200, 130], k: 0.16 });
        }
      }
    }

    /* ---------- Plan moyen : le viaduc et les collines de la vallée ---------- */
    paintMid(lk) {
      const { W, H, L, X0, X1, WW } = this;
      const o = this.extL;
      const r = new XRaster(X0, WW, H);
      const K = lk.concrete.map(C);
      const mist = C(lk.mist);
      const top = L.deckY;
      // Brume : plus on descend vers le fond de la vallée, plus le béton s'y fond.
      const fogAt = (y) => Math.min(0.75, 0.08 + lk.mistK * 0.75 * Math.pow(clamp((y - top) / (L.vfloor - top), 0, 1), 1.7));
      const put = (x, y, c) => {
        const q = Math.floor(fogAt(y) * 6 + bayer(x, y)) / 6;
        r.set(x, y, mix(c, mist, q));
      };

      // Tablier, tympans et voûtes (d'une culée à l'autre).
      const piers = L.piers;
      for (let x = Math.max(X0, L.abL); x < Math.min(X1, L.abR); x++) {
        let pi = 0;
        for (let i = 1; i < piers.length; i++) if (Math.abs(piers[i] - x) < Math.abs(piers[pi] - x)) pi = i;
        const px = piers[pi];
        const dx = x - px;
        let archY = L.springY;
        let u = 1;
        if (Math.abs(dx) > L.hwTop) {
          const pa = dx > 0 ? px : piers[pi - 1];
          const pb = dx > 0 ? piers[pi + 1] : px;
          if (pa !== undefined && pb !== undefined) {
            const midX = (pa + pb) / 2;
            const half = (pb - pa) / 2 - L.hwTop;
            u = (x - midX) / half;
            archY = L.springY - Math.round((L.springY - L.slab - 2) * Math.sqrt(Math.max(0, 1 - u * u)));
          }
        }
        // Corniche éclairée, tablier, goutte d'eau dans l'ombre.
        put(x, top, mix(K[1], K[0], 0.2));
        put(x, top + 1, K[0]);
        put(x, top + 2, x % 6 === 0 ? mix(K[0], K[2], 0.4) : K[0]);
        put(x, top + 3, K[3]);
        const yEnd = Math.min(archY, L.floor[x + o] + 2);
        for (let y = L.slab; y < yEnd; y++) {
          let c = K[0];
          if (x % 4 === 0) c = mix(c, K[2], 0.18); // banches du coffrage
          if ((y - L.slab) % 6 === 5) c = mix(c, K[2], 0.25); // reprises de bétonnage
          if (hash(x, y, 13) < 0.06) c = mix(c, K[3], 0.4);
          put(x, y, c);
        }
        // Intrados : la sous-face de la voûte, qu'on voit d'en dessous.
        if (Math.abs(dx) > L.hwTop) {
          const th = 2 + (Math.abs(u) < 0.6 ? 1 : 0);
          for (let y = archY; y < archY + th && y < L.floor[x + o]; y++) put(x, y, y === archY ? mix(K[3], K[2], 0.3) : K[3]);
          // Barbacane (petit trou d'évacuation) au-dessus de la clé.
          if (Math.abs(u) < 0.03) put(x, L.slab + 2, K[3]);
        }
      }
      // Les piles : arête gauche éclairée, face droite à l'ombre, chevêtre en tête.
      for (const px of piers) {
        if (px < X0 - 12 || px > X1 + 12) continue;
        const near = px >= -12 && px <= W + 12; // les piles de l'écran : comme toujours
        const yb = L.floor[(near ? clamp(px, 0, W - 1) : clamp(px, X0, X1 - 1)) + o] + 3;
        for (let y = L.springY; y < yb; y++) {
          const hw = this.pierHalf(y);
          for (let dx = -hw; dx <= hw; dx++) {
            const x = px + dx;
            let c = K[0];
            if (dx === -hw) c = K[1];
            else if (dx === -hw + 1) c = mix(K[0], K[1], 0.35);
            else if (dx >= hw - 1) c = K[2];
            if ((y - L.springY) % 8 === 7) c = mix(c, K[3], 0.3);
            if (y < L.springY + 16 && noise(x * 0.9, 3.1, 7) > 0.6) c = mix(c, K[3], 0.25); // coulures
            if (hash(x, y, 14) < 0.07) c = mix(c, K[2], 0.35);
            put(x, y, c);
          }
        }
        for (let dx = -L.hwTop - 1; dx <= L.hwTop + 1; dx++) {
          put(px + dx, L.springY, dx > L.hwTop - 1 ? K[2] : K[1]);
          put(px + dx, L.springY + 1, dx > L.hwTop - 1 ? K[3] : K[0]);
        }
        if (lk.snow) for (let dx = -L.hwTop - 1; dx <= L.hwTop + 1; dx++) put(px + dx, L.springY - 1, C('#d0d6de'));
      }
      if (this.extL || this.extR) this.paintMidExt(r, lk, K, put);
      this.paintHills(r, lk);
      if (this.extR) this.paintStream(r, lk);
      if (this.hasPortal) this.paintPortal(r, lk, K, put);
      return r.toCanvas();
    }

    // Monde élargi : un ruisseau sort d'une buse sous le mur et dévale le versant boisé
    // jusque dans la brume.
    paintStream(r, lk) {
      const { L, H } = this;
      const o = this.extL;
      const xs = L.abR + L.abW + Math.round(this.W * 0.22);
      if (!this.inWorld(xs, 6)) return;
      const mist = C(lk.mist);
      const water = mix(mist, [235, 240, 248], lk.night ? 0.1 : 0.22);
      const y0 = L.floor[xs + o];
      // La buse : un trou sombre dans le mur.
      r.set(xs, y0 - 2, mix(C(lk.concrete[3]), [0, 0, 0], 0.4));
      r.set(xs + 1, y0 - 2, mix(C(lk.concrete[3]), [0, 0, 0], 0.4));
      for (let y = y0 - 1; y < H; y++) {
        const fog = lk.mistK * 0.8 * clamp(0.18 + (y - L.deckY) / 70, 0.18, 1);
        const lost = (y - y0) / (H * 0.32); // elle se perd dans la brume
        if (lost > 0.45 && hash(xs, y, 31) < (lost - 0.45) * 2.2) continue;
        const x = Math.round(xs + Math.sin(y * 0.16) * 1.3 + Math.sin(y * 0.045 + 1) * 3 + (y - y0) * 0.1);
        const w = y - y0 > 22 && hash(xs, y, 33) < 0.6 ? 2 : 1;
        for (let k = 0; k < w; k++) {
          const c = hash(x + k, y, 32) < 0.2 ? mix(water, [255, 255, 255], 0.25) : water;
          r.set(x + k, y, mix(c, mist, Math.min(0.9, 0.15 + fog * 1.3)));
        }
      }
    }

    // Monde élargi, plan moyen : les culées, la voie sur le flanc, les montagnes boisées.
    // (Rien de tout cela ne touche l'écran : tout est au-delà des culées.)
    paintMidExt(r, lk, K, put) {
      const { H, L, X0, X1 } = this;
      const o = this.extL;
      const top = L.deckY;
      const mist = C(lk.mist);
      const snowC = C('#d0d6de');
      // Culées : massifs de béton à redans, qui s'enfoncent dans la pente.
      const abut = (x0, dir) => {
        for (let i = 0; i < L.abW; i++) {
          const x = x0 + i * dir; // i = 0 contre le viaduc
          if (!this.inWorld(x)) continue;
          const yb = L.floor[x + o] + 3 - Math.floor(i / 3);
          for (let y = top; y < yb; y++) {
            let c = y === top ? mix(K[1], K[0], 0.2) : y === top + 3 ? K[3] : K[0];
            if (y > top + 3) c = i === 0 ? mix(K[0], K[2], 0.5) : (y - top) % 5 === 4 ? mix(K[0], K[2], 0.3) : K[0];
            if (i === L.abW - 1 || (dir > 0 ? i === L.abW - 2 : false)) c = mix(c, K[2], 0.45);
            if (hash(x, y, 15) < 0.06) c = mix(c, K[3], 0.4);
            put(x, y, c);
          }
          if (lk.snow) put(x, top - 1, snowC);
        }
      };
      abut(L.abR, 1);
      abut(L.abL - 1, -1);
      // Le ballast de la voie, au-delà des culées.
      const B0 = mix(C(lk.dirt[1]), K[2], 0.5);
      const B1 = mix(C(lk.dirt[0]), K[3], 0.4);
      const tunnelEnd = this.hasPortal ? L.portalX + 19 : Infinity; // au-delà, la voie est sous la montagne
      for (let x = X0; x < X1; x++) {
        if ((x >= L.abL - L.abW && x < L.abR + L.abW) || x >= tunnelEnd) continue;
        for (let y = top; y < L.floor[x + o]; y++) {
          let c = y === top ? B0 : B1;
          if (hash(x, y, 16) < 0.3) c = mix(c, K[1], 0.3);
          if (lk.snow && y === top) c = snowC;
          // Mur de soutènement : chaperon clair, moellons à joints décalés.
          if (y >= top + 3) {
            const row = y - (top + 3);
            const joint = row === 3 || (((x + (row > 3 ? 3 : 0)) % 6) + 6) % 6 === 0;
            c = row === 0 ? mix(K[1], K[0], 0.4) : joint ? mix(K[2], K[3], 0.5) : hash(x >> 1, row, 18) < 0.4 ? mix(K[0], K[2], 0.3) : mix(K[0], K[2], 0.12);
          }
          put(x, y, c);
        }
      }
      // Montagnes boisées derrière la voie : prés et sapins serrés, noyés de brume vers le bas.
      const Hc = lk.hill.map(C);
      // (Net au pied, contre la voie ; de plus en plus voilé vers les crêtes.)
      const fogAt = (y) => lk.mistK * 0.8 * clamp(0.18 + (top - y) / 100, 0.18, 0.6);
      for (let x = X0; x < X1; x++) {
        const fh = L.flank[x + o];
        if (fh <= 0) continue;
        const y0 = top - fh;
        const y1 = x >= tunnelEnd ? L.floor[x + o] : top;
        for (let y = y0; y < y1; y++) {
          const d = y - y0;
          const n = fbm(x * 0.03, y * 0.06, 23, 3);
          let c = n > 0.6 ? Hc[1] : n < 0.42 ? Hc[2] : Hc[0];
          if (d === 0) c = mix(Hc[1], mist, 0.3);
          else if (d < 2) c = mix(c, Hc[1], 0.5);
          if (lk.snow && (d < 2 || fbm(x * 0.08, y * 0.1, 24, 2) > 0.55)) c = mix(c, snowC, 0.5);
          const q = Math.floor(fogAt(y) * 8 + bayer(x, y) * 0.9) / 8;
          r.set(x, y, mix(c, mist, q));
        }
      }
      // Les sapins des montagnes : en rangs serrés, plus gros vers la voie.
      const R = rng(95);
      const pc = lk.pine.map(C);
      const snow = lk.pineSnow ? lk.pineSnow.map(C) : null;
      const list = [];
      for (let x = X0 + 2; x < X1 - 2; x += 2 + Math.floor(R() * 3)) {
        if (x > -8 && x < this.W + 8) continue;
        const fh = L.flank[x + o];
        if (fh < 4) continue;
        const y0 = top - fh;
        for (let k = 0; k < 1 + fh / 9; k++) {
          const b = y0 + 3 + R() * (fh - 1);
          if (noise(x * 0.05, b * 0.05, 45) < 0.3 && R() < 0.7) continue;
          list.push({ x, b, h: 5 + ((b - y0) / fh) * 4 + R() * 3 });
        }
      }
      list.sort((a, b) => a.b - b.b);
      for (const p of list) {
        const k = fogAt(p.b - p.h * 0.5) * 0.9 + 0.06;
        pine(r, p.x, p.b, p.h, pc.map((c) => mix(c, mist, k)), snow && snow.map((c) => mix(c, mist, k * 0.5)), (p.x * 13 + Math.round(p.b) * 7) | 0);
      }
    }

    // Le portail du tunnel, où la voie s'enfonce dans la montagne (dessiné par-dessus le
    // pré : le mur de tête descend dans le talus).
    paintPortal(r, lk, K, put) {
      const { L } = this;
      const top = L.deckY;
      const x0 = L.portalX;
      const w = 19;
      const hTop = top - 17;
      const open = { a: x0 + 4, b: x0 + 15, crown: top - 13 }; // ouverture [a, b)
      const cx = (open.a + open.b - 1) / 2;
      const half = (open.b - open.a) / 2;
      const dark = C('#0c0f16');
      for (let x = x0 - 2; x < x0 + w + 2; x++) {
        const wing = x < x0 || x >= x0 + w; // murs en aile, plus bas
        const yt = wing ? top - 6 + Math.abs(x < x0 ? x0 - x : x - (x0 + w - 1)) * 2 : hTop;
        for (let y = yt; y < top + 6; y++) {
          let c = K[0];
          if (y === yt) c = mix(K[1], K[0], 0.15); // couronnement éclairé
          else if (y === yt + 1) c = K[3];
          else if ((y - hTop) % 5 === 4) c = mix(K[0], K[2], 0.25);
          if (x === x0 + w - 1 || x === x0 + w - 2) c = mix(c, K[2], 0.5);
          if (hash(x, y, 17) < 0.07) c = mix(c, K[3], 0.4);
          // L'ouverture en plein cintre, et la nuit du tunnel.
          if (!wing && x >= open.a && x < open.b && y >= open.crown && y < top + 1) {
            const u = (x - cx) / half;
            const archY = top - 13 + Math.round(5 * (1 - Math.sqrt(Math.max(0, 1 - u * u))));
            if (y >= archY) {
              const depth = Math.min(1, (y - archY) / 6);
              c = y === archY ? mix(K[3], K[2], 0.3) : mix(mix(K[3], dark, 0.6), dark, depth);
            }
          }
          if (lk.snow && y === yt) c = C('#d6dbe2');
          put(x, y, c);
        }
      }
      // Lanterne au-dessus de l'ouverture.
      if (lk.lamps > 0) {
        const lx = Math.round(cx);
        const ly = hTop + 2;
        r.set(lx, ly, mix(C(lk.lampC), K[0], 1 - lk.lamps));
        this.halos.push({ x: lx, y: ly, r: 7, c: [255, 214, 150], k: 0.26 * lk.lamps });
      }
    }

    // Les flancs de la vallée au droit du viaduc : prés en pente douce, bosquets de sapins
    // (en groupes, pas en mur), le tout qui se perd dans la brume vers le fond.
    paintHills(r, lk) {
      const { W, H, L, X0, X1 } = this;
      const o = this.extL;
      const Hc = lk.hill.map(C);
      const mist = C(lk.mist);
      const fogAt = (y) => clamp(1 - (y - (L.vfloor - 18)) / 40, 0, 1) * lk.mistK * 0.8;
      // Monde élargi : au-delà de l'écran, le versant sous la voie est à la distance du
      // viaduc (net en haut) et plonge vers une vallée noyée de brume (flou en bas).
      // (Au-delà du tunnel, le pré rejoint la montagne sans liseré.)
      const tunnelEnd = this.hasPortal ? L.portalX + 19 : Infinity;
      const fogExt = (y) => lk.mistK * 0.8 * clamp(0.18 + (y - L.deckY) / 70, 0.18, 1);
      const fogXY = (x, y) => {
        const w = x >= W ? smoothstep((x - W) / (W * 0.12)) : x < 0 ? smoothstep(-x / (W * 0.12)) : 0;
        return w ? fogAt(y) + (fogExt(y) - fogAt(y)) * w : fogAt(y);
      };
      for (let x = X0; x < X1; x++) {
        const fx = L.floor[x + o];
        for (let y = fx; y < H; y++) {
          const d = y - fx;
          const n = fbm(x * 0.025, y * 0.05, 21, 3);
          let c = n > 0.6 ? Hc[1] : n < 0.4 ? Hc[2] : Hc[0];
          if (d === 0 && !(x >= tunnelEnd)) c = mix(Hc[1], mist, 0.3);
          else if (d < 3 && !(x >= tunnelEnd)) c = mix(c, Hc[1], 0.5);
          const q = Math.floor(fogXY(x, y) * 8 + bayer(x, y) * 0.9) / 8;
          r.set(x, y, mix(c, mist, q));
        }
      }
      // Bosquets : les arbres poussent là où un bruit lent le permet.
      const R = rng(91);
      const pc = lk.pine.map(C);
      const snow = lk.pineSnow ? lk.pineSnow.map(C) : null;
      const grove = (x, y) => noise(x * 0.035, y * 0.03, 44) > 0.52;
      const fl = (x) => L.floor[x + o];
      const fg = (x) => L.fgTop[x + o];
      const list = [];
      for (let x = 0; x < W; x += 2 + Math.floor(R() * 2)) {
        if (fl(x) < L.vfloor - 6 && grove(x, fl(x))) list.push({ x, b: fl(x) + 2 + R() * 2, h: 5 + R() * 5 });
      }
      let area = 0;
      for (let x = 0; x < W; x++) area += Math.max(0, fg(x) - fl(x));
      const n = Math.round(area / 22);
      for (let i = 0; i < n; i++) {
        const x = Math.floor(R() * W);
        const room = fg(x) + 4 - fl(x);
        if (room < 6) continue;
        const b = fl(x) + 4 + R() * room;
        if (!grove(x, b)) continue;
        list.push({ x, b, h: 5 + ((b - fl(x)) / room) * 5 + R() * 4 });
      }
      // Monde élargi : les mêmes bosquets de part et d'autre (à distance de l'écran).
      if (this.extL || this.extR) {
        const R2 = rng(92);
        const ok = (x) => (x <= -7 || x >= W + 7) && this.inWorld(x, 1);
        // (Au bord de la plateforme, les cimes restent sous la voie.)
        const rim = (x) => fl(x) <= L.deckY + 8;
        for (let x = X0; x < X1; x += 2 + Math.floor(R2() * 2)) {
          if (!ok(x) || fl(x) >= L.vfloor - 6 || !grove(x, fl(x))) continue;
          const h = 5 + R2() * 5;
          list.push({ x, b: fl(x) + (rim(x) ? h + 1 : 2) + R2() * 2, h });
        }
        let areaX = 0;
        for (let x = X0; x < X1; x++) if (x < 0 || x >= W) areaX += Math.max(0, Math.min(H, fg(x)) - fl(x));
        const nX = Math.round(areaX / 16);
        for (let i = 0; i < nX; i++) {
          const x = Math.floor(X0 + R2() * (X1 - X0));
          if (!ok(x)) continue;
          const room = Math.min(H, fg(x)) + 4 - fl(x);
          if (room < 6) continue;
          const b = fl(x) + 4 + R2() * room;
          if (!grove(x, b)) continue;
          const h = 5 + ((b - fl(x)) / room) * 5 + R2() * 4;
          if (rim(x) && b - h < fl(x) + 1) continue;
          list.push({ x, b, h });
        }
      }
      list.sort((a, b) => a.b - b.b);
      const decid = lk.decid ? DECID[lk.decid] : null;
      for (const p of list) {
        const k = fogXY(p.x, p.b - p.h * 0.5) * 0.9 + 0.08;
        const seed = (p.x * 13 + Math.round(p.b) * 7) | 0;
        if (decid && p.h > 6 && hash(p.x, Math.round(p.b), 3) < 0.3) {
          const pal = decid[hash(p.x, 2, 5) < 0.5 ? 0 : 1].map((c) => mix(C(c), mist, k));
          broadleaf(r, p.x, p.b, p.h * 0.85, pal, seed);
          continue;
        }
        pine(r, p.x, p.b, p.h, pc.map((c) => mix(c, mist, k)), snow && snow.map((c) => mix(c, mist, k * 0.5)), seed);
      }
    }

    // Garde-corps, poteaux caténaires et lampes du viaduc : dessinés PAR-DESSUS le train.
    paintDeckFront(lk) {
      const { W, H, L, X0, X1, WW } = this;
      const r = new XRaster(X0, WW, H);
      const K = lk.concrete.map(C);
      const mist = C(lk.mist);
      const top = L.deckY;
      const f = (c) => mix(c, mist, 0.1);
      const mastC = f(mix(K[3], K[2], 0.3));
      // Garde-corps, d'une culée à l'autre ; au-delà, le rail sur son ballast.
      const g0 = L.abL - L.abW;
      const g1 = L.abR + L.abW;
      const railC = f(mix(K[3], K[1], 0.35));
      const tieC = f(mix(C(lk.dirt[0]), K[3], 0.5));
      for (let x = X0; x < X1; x++) {
        if (x >= g0 && x < g1) {
          r.set(x, top - 2, f(lk.snow ? C('#d6dbe2') : K[1]));
          r.set(x, top - 1, f(x % 3 === 0 ? K[2] : K[0]));
        } else if (!this.hasPortal || x < L.portalClip) {
          r.set(x, top - 1, x % 3 === 0 ? tieC : railC);
        }
      }
      // Poteaux d'extrémité du garde-corps, sur les culées.
      for (const x of [g0, g1 - 1]) {
        if (!this.inWorld(x)) continue;
        for (let y = top - 4; y < top; y++) r.set(x, y, f(y === top - 4 ? K[1] : K[2]));
      }
      // Ligne de contact, légèrement tendue entre les poteaux (jusqu'au tunnel).
      const step = 15;
      const wire = f(mix(K[3], C(lk.sky[2]), 0.25));
      const wireEnd = this.hasPortal ? L.portalX + 4 : X1;
      for (let x = X0; x < wireEnd; x++) {
        const u = ((x % step) + step) % step / step;
        const y = top - 10 + (u > 0.25 && u < 0.75 ? 1 : 0);
        if (hash(x, 1, 2) < 0.92) r.set(x, y, wire);
      }
      const mast = (x, lamp) => {
        for (let y = top - 11; y < top - 2; y++) r.set(x, y, mastC);
        r.set(x + 1, top - 10, mastC);
        r.set(x - 1, top - 11, mastC);
        if (lamp) {
          const lc = mix(C(lk.lampC), K[0], 1 - lk.lamps);
          r.set(x, top - 12, lc);
          this.halos.push({ x, y: top - 12, r: 6, c: [255, 214, 150], k: 0.22 * lk.lamps });
        }
      };
      let n = 0;
      for (let x = 4; x < W; x += step) {
        // Lampes de service sur un poteau sur trois.
        const lamp = lk.lamps > 0 && n++ % 3 === 0;
        mast(x, lamp);
      }
      // Monde élargi : les poteaux continuent (même rythme) ; une lampe dont le halo
      // atteindrait l'écran reste éteinte.
      const lampAt = (x) => lk.lamps > 0 && ((((x - 4) / step) % 3) + 3) % 3 === 0 && (x - 7 >= W || x + 7 < 0);
      for (let x = 4 + step * Math.ceil((W - 4) / step); x < Math.min(X1, wireEnd - 6); x += step) if (x - 1 >= W) mast(x, lampAt(x));
      for (let x = 4 - step; x >= X0; x -= step) mast(x, lampAt(x));
      return r.toCanvas();
    }

    /* ---------- Premier plan : le flanc de colline et le poste de la pilote ---------- */
    paintFg(lk) {
      const { W, H, L, X0, X1, WW } = this;
      const o = this.extL;
      const fgTop = (x) => L.fgTop[x + o];
      const r = new XRaster(X0, WW, H);
      const G = lk.ground.map(C);
      const grass = C(lk.grass);
      for (let x = X0; x < X1; x++) {
        for (let y = fgTop(x); y < H; y++) {
          const d = y - fgTop(x);
          let c;
          if (d === 0) c = G[3];
          else if (d < 3) c = G[2];
          else {
            const n = fbm(x * 0.045, y * 0.09, 3, 3);
            c = n > 0.6 ? G[2] : n < 0.42 ? G[0] : G[1];
            if (y > H - 16 && bayer(x, y) < ((y - (H - 16)) / 16) * 0.7) c = G[0];
          }
          if (d > 1 && hash(x, y, 4) < 0.05) c = mix(c, grass, 0.4);
          r.set(x, y, c);
        }
      }
      // Sentier de terre battue qui monte jusqu'au replat.
      const D = lk.dirt.map(C);
      for (let y = L.groundY + 4; y < H; y++) {
        const u = (y - L.groundY) / (H - L.groundY);
        const xc = L.padX + 14 - u * W * 0.2 + Math.sin(u * 5) * 4;
        const half = 2 + u * 5;
        for (let x = Math.floor(xc - half); x <= xc + half; x++) {
          if (x < 0 || x >= W || y <= fgTop(x) + 1) continue;
          const e = Math.abs(x - xc) / half;
          if (e > 0.75 && bayer(x, y) < (e - 0.75) * 4) continue;
          r.set(x, y, lk.snow ? mix(D[1], G[2], 0.55) : hash(x, y, 7) < 0.3 ? D[1] : D[0]);
        }
      }
      if (this.extR) this.paintTrack(r, lk, G, D);
      // Touffes d'herbe le long du bord (un, deux ou trois brins).
      const R = rng(808);
      const tuft = (R, x) => {
        if (R() < 0.45) return;
        const h = 1 + Math.floor(R() * (lk.snow ? 1.5 : 3));
        const c = R() < 0.5 ? G[3] : mix(grass, G[3], 0.5);
        for (let k = 1; k <= h; k++) r.set(x + (k === 3 ? (R() < 0.5 ? -1 : 1) : 0), fgTop(x) - k, c);
      };
      for (let x = 0; x < W; x++) tuft(R, x);
      // (Monde élargi : d'autres touffes, d'un autre tirage, à distance de l'écran.)
      const R2 = rng(809);
      for (let x = X0; x < X1; x++) if (x < -1 || x > W) tuft(R2, x);
      // Hautes herbes au premier plan, en bas.
      const tall = (R, x) => {
        const base = H - 1 - Math.floor(R() * 6);
        const h = 3 + Math.floor(R() * 6);
        const lean = R() < 0.5 ? -1 : 1;
        const c = mix(G[1], grass, R() * 0.6);
        for (let k = 0; k < h; k++) r.set(x + (k > h * 0.6 ? lean : 0), base - k, c);
      };
      for (let x = 0; x < W; x += 1 + Math.floor(R() * 3)) tall(R, x);
      for (let x = X0; x < X1; x += 1 + Math.floor(R2() * 3)) if ((x < -1 || x > W) && fgTop(x) < H - 4) tall(R2, x);
      // Clôture de piquets sur la pente, à gauche.
      const post = mix(D[0], G[0], 0.3);
      const wireC = mix(G[3], G[1], 0.5);
      let prev = null;
      for (let x = 6; x < W * 0.4; x += 14) {
        const base = fgTop(x) + 4;
        for (let y = base - 7; y <= base; y++) r.set(x, y, post);
        r.set(x, base - 7, mix(post, G[3], 0.4));
        if (prev) {
          for (const off of [5, 2]) {
            const n = x - prev[0];
            for (let k = 1; k < n; k++) {
              const u = k / n;
              const y = Math.round(prev[1] - off + (base - prev[1]) * u + Math.sin(u * Math.PI) * 1.2);
              r.set(prev[0] + k, y, wireC);
            }
          }
        }
        prev = [x, base];
      }
      // Rochers.
      const rk = lk.rock.map(C);
      const top = lk.snow ? C('#d4d9e0') : null;
      rock(r, Math.round(W * 0.06), H - 6, 9, 6, rk, top);
      rock(r, Math.round(W * 0.15), H - 3, 5, 3, rk, top);
      rock(r, L.pilotX + 58 < W - 18 ? L.pilotX + 58 : Math.round(W * 0.95), L.feetY + 4, 4, 3, rk, top);
      // Deux sapins sombres au bord droit, qui encadrent l'image.
      const pc = lk.pine.map((c) => mix(C(c), G[0], 0.4));
      const ps = lk.pineSnow ? lk.pineSnow.map(C) : null;
      pine(r, W - 5, fgTop(W - 5) + 6, H * 0.4, pc, ps, 7);
      pine(r, W - 19, fgTop(W - 19) + 7, H * 0.24, pc, ps, 11);
      if (this.extR) this.paintFgRight(r, lk, G, D, pc, ps, rk, top);

      this.paintPad(r, lk);
      // La valise de la station sol, couvercle ouvert.
      stamp(r, CASE, CASE_PAL, L.caseX, L.caseY);
      if (lk.snow) r.rect(L.caseX, L.caseY + 6, 14, 1, C('#e2e6ec'));
      // L'antenne sur son trépied.
      const tx = L.tripodX;
      const legC = C('#2e3138');
      const t0 = L.feetY - 15;
      for (const [ex, ey] of [[tx - 5, L.feetY], [tx, L.feetY + 1], [tx + 5, L.feetY]]) {
        const n = Math.max(Math.abs(ex - tx), Math.abs(ey - t0));
        for (let k = 0; k <= n; k++) r.set(Math.round(tx + ((ex - tx) * k) / n), Math.round(t0 + ((ey - t0) * k) / n), legC);
      }
      stamp(r, ANTENNA, ANTENNA_PAL, tx - 2, t0 - 6);
      // Ombres portées douces au sol (valise, trépied).
      for (let x = L.caseX; x < L.caseX + 15; x++) r.tint(x, L.feetY + 1, [0, 0, 0], 0.3);

      if (lk.wet) this.paintPuddles(r, lk);

      // La nuit, l'écran de la station éclaire un peu le sol autour.
      const sx = L.screen.x + 5;
      const sy = L.screen.y + 2;
      if (lk.night || lk.storm) lightPass(r, X0, X1, [{ x: sx, y: sy + 6, r: 14, k: 0.6, sy: 1.4 }], [1, 1, 1], [0.12, 0.25, 0.4], (x, y) => y > L.groundY - 4);
      this.halos.push({ x: sx, y: sy, r: 8, c: [110, 200, 255], k: lk.night ? 0.3 : 0.14 });
      // Monde élargi : la fenêtre de la cabane et la lanterne éclairent le pré, la nuit.
      if (this.extLights && (lk.night || lk.storm)) {
        for (const l of this.extLights) {
          const reach = l.r * 3;
          lightPass(r, Math.max(W + 2, Math.round(l.x - reach)), Math.min(X1, Math.round(l.x + reach)), [l], [1, 1, 1], [0.45, 0.32, 0.14], null);
        }
      }
      return r.toCanvas();
    }

    // Monde élargi, premier plan : la piste à deux ornières qui monte du bas de l'image
    // jusqu'à la camionnette de l'équipe.
    paintTrack(r, lk, G, D) {
      const { H, L } = this;
      const o = this.extL;
      const E = L.ext;
      const y0 = L.fgTop[clamp(E.vanX + 6, this.X0, this.X1 - 1) + o] + 2;
      const rut = lk.snow ? mix(D[1], G[2], 0.5) : D[0];
      const rut2 = lk.snow ? mix(D[1], G[3], 0.6) : D[1];
      for (let y = y0; y < H; y++) {
        const u = (y - y0) / (H - y0);
        const xc = E.vanX + 6 - u * this.W * 0.2 + Math.sin(u * 4 + 1) * 3;
        const gap = 1.5 + u * 4.5;
        const w = 1 + u * 2.2;
        for (const side of [-1, 1]) {
          const c0 = xc + side * gap;
          for (let x = Math.floor(c0 - w / 2); x <= c0 + w / 2; x++) {
            if (x < this.W + 8 || y <= L.fgTop[x + o] + 1) continue;
            if (u < 0.15 && bayer(x, y) < 0.5) continue; // la piste se perd dans l'herbe
            r.set(x, y, hash(x, y, 7) < 0.3 ? rut2 : rut);
          }
        }
      }
    }

    // Monde élargi, premier plan (à droite) : butte et rochers, camionnette, manche à air,
    // panneau de randonnée, clôture, cabane éclairée et lisière de sapins.
    paintFgRight(r, lk, G, D, pc, ps, rk, snowTop) {
      const { W, H, L } = this;
      const o = this.extL;
      const E = L.ext;
      const fgTop = (x) => L.fgTop[clamp(x, this.X0, this.X1 - 1) + o];
      const R = rng(812);
      const dim = (hexc, k = 0) => mix(C(hexc), lk.night ? [10, 14, 26] : C(lk.ground[0]), (lk.night ? 0.45 : 0.18) + k);
      const lights = (this.extLights = []);

      // Lisière : sapins sombres en deux rangs, de plus en plus serrés vers la droite.
      const back = pc.map((c) => mix(c, C(lk.mist), 0.25));
      for (let x = E.woodsX - 10; x < this.X1 + 12; x += 6 + Math.floor(R() * 7)) {
        const k = clamp((x - E.woodsX) / (W * 0.15), 0, 1);
        if (R() > 0.35 + k * 0.65) continue;
        pine(r, x, fgTop(x) + 2, H * (0.14 + 0.12 * k + R() * 0.06), back, ps, 300 + x);
      }
      // Rochers sur la butte, et au pied de la lisière.
      rock(r, W + Math.round(W * 0.1), fgTop(W + Math.round(W * 0.1)) + 3, 6, 4, rk, snowTop);
      rock(r, W + Math.round(W * 0.115) + 6, fgTop(W + Math.round(W * 0.115) + 6) + 3, 3, 2, rk, snowTop);
      rock(r, W + Math.round(W * 0.25), H - 4, 7, 4, rk, snowTop);
      rock(r, E.woodsX + 4, fgTop(E.woodsX + 4) + 3, 5, 3, rk, snowTop);
      // Un jeune sapin sur la butte.
      pine(r, W + Math.round(W * 0.16), fgTop(W + Math.round(W * 0.16)) + 4, H * 0.12, pc, ps, 41);
      // Bouquets de grands sapins sombres sur le flanc (ils défilent vite devant la caméra).
      const at = (k) => W + Math.round(W * k);
      for (const [k, hk, seed] of [[0.25, 0.3, 51], [0.275, 0.19, 52], [0.86, 0.34, 53], [0.835, 0.22, 54], [0.89, 0.15, 55], [0.56, 0.1, 56], [1.1, 0.09, 57]]) {
        pine(r, at(k), fgTop(at(k)) + 5, H * hk, pc, ps, seed);
      }
      // Buissons et blocs au tout premier plan, coupés par le bas de l'image.
      const bushPal = [mix(G[0], [8, 10, 14], 0.35), G[0], mix(G[1], G[0], 0.3), mix(G[2], C(lk.grass), 0.3), mix(G[0], [0, 0, 0], 0.4)];
      for (const [k, s, seed] of [[0.36, 16, 61], [0.4, 11, 62], [0.98, 18, 63], [1.31, 14, 64]]) broadleaf(r, at(k), H + Math.round(s * 0.35), s, bushPal, seed);
      rock(r, at(0.66), H - 3, 9, 5, rk, snowTop);
      rock(r, at(0.68) + 4, H - 1, 4, 3, rk, snowTop);
      rock(r, at(1.18), H - 2, 6, 4, rk, snowTop);

      // La cabane : murs de planches, toit d'ardoise, fenêtre allumée, lanterne, cheminée.
      const cx = E.cabinX;
      const cw = 26;
      const base = Math.min(fgTop(cx), fgTop(cx + cw)) + 3;
      const wallTop = base - 12;
      const wood = [dim('#3e302a'), dim('#4c3b31'), dim('#5a473a')];
      const roofC = [dim('#2a2e3a'), dim('#383d4b')];
      // Le replat de la cabane (terre battue, un peu de terrassement).
      for (let x = cx - 2; x < cx + cw + 3; x++) {
        for (let y = base; y <= fgTop(x); y++) r.set(x, y, y === base ? G[3] : hash(x, y, 22) < 0.4 ? rk[1] : rk[0]); // soubassement
      }
      for (let y = wallTop; y < base; y++) {
        for (let x = cx; x < cx + cw; x++) {
          let c = (y - wallTop) % 3 === 2 ? wood[0] : x < cx + 3 ? wood[2] : wood[1];
          if (hash(x, y, 21) < 0.08) c = wood[0];
          r.set(x, y, c);
        }
      }
      // Toit à deux pans (pignon face à nous), débord de 2 pixels.
      const ridgeY = wallTop - 9;
      for (let y = ridgeY; y <= wallTop; y++) {
        const half = Math.round(((y - ridgeY) / (wallTop - ridgeY)) * (cw / 2 + 2));
        const mid = cx + cw / 2;
        for (let x = Math.round(mid - half); x < Math.round(mid + half); x++) {
          let c = y === wallTop || x === Math.round(mid - half) || x === Math.round(mid + half) - 1 ? roofC[1] : roofC[0];
          if (lk.snow && (y < ridgeY + 3 || x === Math.round(mid - half))) c = C('#d4d9e0');
          r.set(x, y, c);
        }
      }
      // Pignon : bardage plus clair, petit oculus.
      r.set(cx + cw / 2, wallTop - 4, wood[0]);
      // Cheminée.
      this.chimney = { x: cx + cw - 6, y: wallTop - 10 };
      for (let y = wallTop - 9; y < wallTop - 3; y++) for (let x = cx + cw - 7; x < cx + cw - 4; x++) r.set(x, y, y === wallTop - 9 ? dim('#5a5250') : dim('#45403e'));
      // Fenêtre allumée (croisillon), porte, lanterne.
      const win = C(lk.win);
      const wx = cx + 4;
      const wy = wallTop + 3;
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 6; x++) {
          const frame = x === 0 || x === 5 || y === 0 || y === 4;
          const cross = x === 3 || y === 2;
          r.set(wx + x, wy + y, frame ? dim('#2a201c') : cross ? mix(win, wood[0], 0.55) : mix(win, [255, 240, 200], hash(x, y, 4) < 0.3 ? 0.25 : 0));
        }
      }
      this.halos.push({ x: wx + 3, y: wy + 2, r: 9, c: [255, 196, 120], k: lk.night ? 0.32 : 0.2 });
      lights.push({ x: wx + 3, y: base + 2, r: 12, k: 0.7, sy: 1.6 });
      const dx = cx + 15;
      for (let y = base - 9; y < base; y++) for (let x = dx; x < dx + 5; x++) r.set(x, y, x === dx || y === base - 9 ? dim('#1e1816') : dim('#2e2420'));
      r.set(dx + 3, base - 5, dim('#8a7a5a'));
      // La lanterne, accrochée à côté de la porte.
      const lx = dx + 7;
      const ly = base - 8;
      r.set(lx, ly - 1, dim('#1a1a1a'));
      r.set(lx, ly, C(lk.lampC));
      r.set(lx, ly + 1, dim('#1a1a1a'));
      this.lantern = { x: lx, y: ly };
      this.halos.push({ x: lx, y: ly, r: 6, c: [255, 210, 140], k: lk.night ? 0.3 : 0.18 });
      lights.push({ x: lx, y: base + 2, r: 8, k: 0.45, sy: 1.6 });
      // Le tas de bois, contre le mur.
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 7 - (y === 0 ? 2 : 0); x++) {
          const c = (x + y) % 2 ? dim('#6a5440') : dim('#4a3a2e');
          r.set(cx + cw + 1 + x + (y === 0 ? 1 : 0), base - 4 + y, c);
        }
      }
      if (lk.snow) for (let x = cx + cw + 2; x < cx + cw + 7; x++) r.set(x, base - 5, C('#d4d9e0'));

      // La seconde clôture, qui borde le pré.
      const post = mix(D[0], G[0], 0.3);
      const wireC = mix(G[3], G[1], 0.5);
      let prev = null;
      for (let x = E.fence[0]; x <= E.fence[1]; x += 12) {
        const b = fgTop(x) + 3;
        for (let y = b - 7; y <= b; y++) r.set(x, y, post);
        r.set(x, b - 7, mix(post, G[3], 0.4));
        if (prev) {
          for (const off of [5, 2]) {
            const n = x - prev[0];
            for (let k = 1; k < n; k++) {
              const u = k / n;
              r.set(prev[0] + k, Math.round(prev[1] - off + (b - prev[1]) * u + Math.sin(u * Math.PI) * 1.2), wireC);
            }
          }
        }
        prev = [x, b];
      }

      // Le panneau de randonnée jaune (deux flèches).
      const sxp = E.signX;
      const sb = fgTop(sxp) + 2;
      for (let y = sb - 13; y <= sb; y++) r.set(sxp, y, dim('#4a3a2c'));
      const yel = dim('#c9a83a', -0.05);
      const yelD = dim('#8a7228');
      for (let x = 0; x < 7; x++) {
        r.set(sxp - 6 + x, sb - 12, x === 0 ? yelD : yel);
        r.set(sxp - 6 + x, sb - 11, x === 0 ? yelD : x < 6 ? yel : yelD);
        r.set(sxp + x, sb - 9, x === 6 ? yelD : yel);
        r.set(sxp + x, sb - 8, x === 6 ? yelD : x > 0 ? yel : yelD);
      }
      r.set(sxp - 7, sb - 12, yelD); // pointes
      r.set(sxp + 7, sb - 8, yelD);

      // Le mât de la manche à air (la manche bouge : drawExt).
      const mx = E.sockX;
      const mb = fgTop(mx) + 2;
      for (let y = mb - 17; y <= mb; y++) r.set(mx, y, dim('#8a8e96'));
      r.set(mx - 1, mb, dim('#3a3e46'));
      r.set(mx + 1, mb, dim('#3a3e46'));
      this.sock = { x: mx, y: mb - 17 };

      // La camionnette de l'équipe, garée au bout de la piste.
      const vpal = {};
      for (const k of Object.keys(VAN_PAL)) vpal[k] = dim(VAN_PAL[k], k === 'o' || k === 'Y' ? -0.08 : 0);
      const vx = E.vanX;
      const vb = fgTop(vx + 15) + 3;
      for (let x = vx + 1; x < vx + 29; x++) r.tint(x, vb, [0, 0, 0], 0.35); // ombre
      stamp(r, VAN, vpal, vx, vb - VAN.length + 1);
      if (lk.snow) for (let x = vx + 6; x < vx + 29; x++) r.set(x, vb - VAN.length + 1, C('#dfe3ea'));
    }

    // L'aire de décollage : un tapis vu en perspective, bord orange, H blanc.
    paintPad(r, lk) {
      const { L } = this;
      const mat = C(lk.snow ? '#4a4e56' : '#3a3e46');
      const rim = C('#c8641e');
      const hc = C('#e6e6e2');
      const rows = [[-10, 10], [-11, 11], [-11, 11], [-12, 12], [-12, 12]];
      rows.forEach(([a, b], j) => {
        const y = L.padY - 2 + j;
        for (let x = a; x <= b; x++) {
          const edge = j === 0 || j === rows.length - 1 || x === a || x === b;
          r.set(L.padX + x, y, edge ? mix(rim, mat, 0.25) : mat);
        }
      });
      for (let x = -12; x <= 12; x++) r.tint(L.padX + x, L.padY + 3, [0, 0, 0], 0.35);
      for (const [x, y] of [[-3, -1], [-2, -1], [2, -1], [3, -1], [-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [3, 0], [-3, 1], [-2, 1], [2, 1], [3, 1]]) r.set(L.padX + x, L.padY + y, hc);
      this.padLights = [[-10, -2], [10, -2], [12, 2], [-12, 2]].map(([x, y]) => ({ x: L.padX + x, y: L.padY + y }));
    }

    paintPuddles(r, lk) {
      const { L } = this;
      const sky = C(lk.sky[lk.sky.length - 2]);
      for (const [cx, cy, rx] of [[L.padX - 22, L.groundY + 10, 6], [L.pilotX - 6, L.feetY + 4, 4]]) {
        for (let y = -1; y <= 1; y++) {
          for (let x = -rx; x <= rx; x++) {
            if ((x / rx) ** 2 + y * y > 1.05) continue;
            r.set(cx + x, cy + y, mix(sky, [20, 26, 32], 0.35 + (hash(x, y, 2) < 0.3 ? 0.2 : 0)));
          }
        }
      }
    }

    // Bande de brume qui dérive (peinte une fois, puis décalée à chaque image).
    paintMist(lk, h, seed, k) {
      const { W } = this;
      const r = new Raster(W, h);
      const c = C(lk.mist);
      for (let y = 0; y < h; y++) {
        const prof = Math.sin((Math.PI * (y + 0.5)) / h);
        for (let x = 0; x < W; x++) {
          const f = (xx) => fbm(xx * 0.03, y * 0.22, seed, 3);
          const a = f(x) * (1 - x / W) + f(x - W) * (x / W);
          const v = Math.max(0, a - 0.4) * 2.2 * prof * lk.mistK * k;
          const q = Math.floor(v * 5 + bayer(x, y) * 0.8) / 5;
          if (q > 0) r.set(x, y, c, Math.round(Math.min(1, q) * 150));
        }
      }
      return r.toCanvas();
    }

    /* ================= La vie de la scène ================= */
    update(dt, ctx) {
      const eff = (ctx && ctx.effect) || 'none';
      if (!this.bg || eff !== this.effect) this.build(eff);
      const lk = this.lk;
      const { W, L } = this;
      this.t += dt;

      this.updateInspection(dt);
      this.updatePilot(dt);
      if (lk.birds) this.flock.update(dt);

      // Train sur le viaduc (dans le monde élargi : sur toute la ligne, depuis le tunnel).
      const { X0, X1 } = this;
      const tunnel = this.hasPortal ? L.portalClip : null;
      if (!this.train) {
        this.nextTrain -= dt;
        if (this.nextTrain <= 0) {
          const dir = Math.random() < 0.5 ? 1 : -1;
          const cars = 3 + Math.floor(Math.random() * 3);
          const len = cars * 17 - 1;
          this.train = { dir, cars, len, x: dir > 0 ? X0 - len - 6 : tunnel !== null ? tunnel + 1 : X1 + 6, v: 24 + Math.random() * 8 };
        }
      } else {
        const T = this.train;
        T.x += T.dir * T.v * dt;
        if (T.magic) this.updateSteam(dt);
        if (T.x > (tunnel !== null ? tunnel + 2 : X1 + 30) || T.x + T.len < X0 - 30) {
          this.train = null;
          this.nextTrain = this.fast ? 6 : 35 + Math.random() * 50;
        }
      }

      if (this.car) this.updateCar(dt);
      if (this.wraiths) this.updateWraiths(dt);

      // Monde élargi : la fumée de la cabane.
      if (this.chimney && this.extR) {
        this.smokeT -= dt;
        if (this.smokeT <= 0) {
          this.smoke.emit(this.chimney.x + Math.random() * 2, this.chimney.y, 3.2, 5);
          this.smokeT = 0.4;
        }
        this.smoke.update(dt);
      }

      // Orage : éclairs derrière les montagnes.
      if (lk.storm) {
        this.nextBolt -= dt;
        if (this.nextBolt <= 0) {
          this.flash = 1;
          this.nextBolt = 6 + Math.random() * 9;
          const pts = [];
          let x = Math.round(W * (0.06 + Math.random() * 0.6));
          for (let y = 0; y < L.far[clamp(x, 0, W - 1) + this.extL]; y += 3) {
            pts.push([x, y]);
            x += Math.round((Math.random() - 0.5) * 7);
          }
          this.bolt = pts;
        }
        if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.4);
      } else this.flash = 0;
    }

    // La pilote : regarde le drone, travaille aux manettes, consulte sa tablette.
    updatePilot(dt) {
      const pl = this.pilot;
      const d = this.insp;
      pl.timer -= dt;
      pl.frameT += dt;
      if (d.phase !== 'pad') {
        // En vol : aux manettes ; au décollage, à l'atterrissage et de temps en temps
        // pendant le vol, elle lève les yeux vers le drone.
        pl.glance -= dt;
        if (pl.glance <= 0) pl.glance = 5 + Math.random() * 4;
        pl.pose = d.phase === 'up' || d.phase === 'down' || pl.glance < 1.4 ? 'look' : 'sticks';
        pl.timer = 2;
        return;
      }
      if (pl.timer > 0) return;
      const storm = this.lk && this.lk.storm;
      if (pl.pose !== 'look' && !(storm && Math.random() < 0.5)) {
        pl.pose = 'look';
        pl.timer = 3 + Math.random() * 4;
      } else if (storm || Math.random() < 0.55) {
        pl.pose = 'tablet';
        pl.timer = 3 + Math.random() * 3;
      } else {
        pl.pose = 'sticks';
        pl.timer = 2 + Math.random() * 2;
      }
    }

    /* ---------- Le drone d'inspection ---------- */
    // Trois points d'inspection sur la pile la plus haute et la voûte voisine :
    // le fût (à mi-hauteur), l'appareil d'appui (sous le chevêtre), l'intrados de la voûte.
    // hover : où le drone se tient ; tgt : ce que vise le projecteur ; sweep : sens du balayage.
    inspectionPoints() {
      const L = this.L;
      const px = L.tp;
      const yA = Math.round(L.springY + (L.floor[clamp(px, 0, this.W - 1) + this.extL] - L.springY) * 0.42);
      const hwA = this.pierHalf(yA);
      const archX = Math.round(px + L.span / 2);
      return [
        { x: px + hwA + 9, y: yA + 2, tgt: [px + hwA, yA - 2], sweep: [0, 4] },
        { x: px + L.hwTop + 10, y: L.springY + 8, tgt: [px + L.hwTop + 2, L.springY + 1], sweep: [0, 1.5] },
        { x: archX + 2, y: L.springY + 9, tgt: [archX, L.slab + 4], sweep: [6, 0] },
      ];
    }

    cruiseY() {
      return this.L.padY - Math.round(this.H * 0.17);
    }

    // Démarre un trajet vers (x, y, depth).
    legTo(phase, x, y, depth) {
      const d = this.insp;
      d.phase = phase;
      d.leg = { x0: d.x, y0: d.y, d0: d.depth, x1: x, y1: y, d1: depth, len: Math.hypot(x - d.x, y - d.y) || 1 };
    }

    // Vitesse apparente (px/s) : plus lente au loin (perspective), freinage à l'arrivée.
    legSpeed(depth, rest) {
      return (5 + 22 * depth) * clamp(rest / 10, 0.35, 1);
    }
    downSpeed(h) {
      return 7 * clamp(h / 10, 0.3, 1);
    }

    updateInspection(dt) {
      const d = this.insp;
      const L = this.L;
      const storm = this.lk && this.lk.storm;
      d.t += dt;
      const v = d.speed;
      if (d.phase === 'pad') {
        d.x = L.padX;
        d.y = L.padY;
        d.depth = 1;
        d.timer -= dt;
        if (d.timer <= 0 && !storm) {
          d.phase = 'up';
          d.wp = 0;
        }
      } else if (d.phase === 'up') {
        const h = d.y - this.cruiseY();
        d.y -= 10 * v * dt * clamp(h / 8, 0.3, 1) * clamp((L.padY - d.y + 2) / 6, 0.4, 1);
        if (h < 0.6) {
          const p = this.inspectionPoints()[0];
          this.legTo('go', p.x, p.y, 0.12);
        }
      } else if (d.phase === 'go' || d.phase === 'back') {
        const g = d.leg;
        const rest = Math.hypot(g.x1 - d.x, g.y1 - d.y);
        const step = this.legSpeed(d.depth, rest) * v * dt;
        if (rest <= step + 0.3) {
          d.x = g.x1;
          d.y = g.y1;
          d.depth = g.d1;
          if (d.phase === 'go') {
            const p = this.inspectionPoints()[d.wp];
            d.phase = 'scan';
            d.timer = this.fast ? 3 : 4.5;
            d.tgt = p.tgt;
            d.sweep = p.sweep;
            d.scanT = 0;
          } else d.phase = 'down';
        } else {
          d.x += ((g.x1 - d.x) / rest) * step;
          d.y += ((g.y1 - d.y) / rest) * step;
          const u = 1 - Math.hypot(g.x1 - d.x, g.y1 - d.y) / g.len;
          d.depth = g.d0 + (g.d1 - g.d0) * u;
        }
        if (storm && d.phase === 'go') this.legTo('back', L.padX, this.cruiseY(), 1);
      } else if (d.phase === 'scan') {
        d.timer -= dt;
        d.scanT += dt;
        if (d.timer <= 0 || storm) {
          const pts = this.inspectionPoints();
          d.wp++;
          d.tgt = null;
          if (d.wp < pts.length && !storm) this.legTo('go', pts[d.wp].x, pts[d.wp].y, 0.12);
          else this.legTo('back', L.padX, this.cruiseY(), 1);
        }
      } else if (d.phase === 'down') {
        d.y += this.downSpeed(L.padY - d.y) * v * dt;
        if (d.y >= L.padY) {
          d.y = L.padY;
          d.phase = 'pad';
          d.speed = 1;
          d.intro = false;
          d.timer = this.fast ? 4 : 10 + Math.random() * 10;
        }
      }
    }

    // Durée (à vitesse 1) du retour depuis le dernier point d'inspection jusqu'au pad.
    returnTime() {
      const L = this.L;
      const p = this.inspectionPoints()[2];
      let x = p.x;
      let y = p.y;
      let depth = 0.12;
      const tx = L.padX;
      const ty = this.cruiseY();
      const len = Math.hypot(tx - x, ty - y) || 1;
      const dt = 1 / 30;
      let t = 0;
      for (let guard = 0; guard < 6000; guard++) {
        const rest = Math.hypot(tx - x, ty - y);
        const step = this.legSpeed(depth, rest) * dt;
        t += dt;
        if (rest <= step + 0.3) break;
        x += ((tx - x) / rest) * step;
        y += ((ty - y) / rest) * step;
        depth = 0.12 + 0.88 * (1 - Math.hypot(tx - x, ty - y) / len);
      }
      for (let guard = 0; guard < 6000 && y < L.padY; guard++) {
        y += this.downSpeed(L.padY - y) * dt;
        t += dt;
      }
      return t;
    }

    // Pour l'animation d'ouverture : le drone termine l'inspection de la voûte, puis rentre
    // se poser sur le pad ; le vol entier dure environ « seconds ».
    introReturn(seconds = 8) {
      const d = this.insp;
      const pts = this.inspectionPoints();
      const p = pts[pts.length - 1];
      Object.assign(d, { phase: 'scan', timer: seconds * 0.2, x: p.x, y: p.y, depth: 0.12, wp: pts.length - 1, tgt: p.tgt, sweep: p.sweep, scanT: 0, intro: true, speed: 1 });
      d.speed = this.returnTime() / Math.max(1, seconds * 0.78);
      // Monde élargi : pendant le travelling, un train sort lentement du tunnel (il reste
      // hors de l'écran jusqu'à la fin), et quelques oiseaux quittent le cadre vers la droite.
      if (this.hasPortal) {
        const cars = 4;
        const len = cars * 17 - 1;
        // (Le faisceau du phare porte à 10 pixels devant : il reste hors de l'écran jusqu'au
        // fondu final, qui dure encore un peu plus d'une seconde.)
        const v = clamp((this.L.portalClip - (this.W + 14)) / Math.max(1, seconds + 1.6), 8, 30);
        this.train = { dir: -1, cars, len, x: this.L.portalClip + 1, v };
      }
      if (this.extR > 0 && this.lk && this.lk.birds) {
        const { W, H } = this;
        for (let k = 0; k < 4; k++) {
          this.flock.birds.push({ x: W * 0.66 - k * 9, y: H * 0.17 + (k % 2) * 4 + k * 2, dir: 1, v: 22, t: k * 0.13, bob: k * 1.7 });
        }
      }
    }

    /* ================= Dessin d'une image ================= */
    draw(g) {
      if (!this.bg) this.build(this.effect || 'none');
      const { H, L } = this;
      const lk = this.lk;
      const t = this.t;
      g.imageSmoothingEnabled = false;
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;

      // ----- Plan lointain : ciel, montagnes, vallée -----
      // (Les décors peints commencent au bord gauche du monde élargi : x = −extL.)
      const ox = -this.extL;
      g.drawImage(this.bg, ox, 0);
      for (const s of this.twinkles) {
        const v = 0.5 + 0.5 * Math.sin(t * s.sp + s.ph);
        if (v < 0.3) continue;
        g.fillStyle = `rgba(255,250,235,${(v * 0.8).toFixed(2)})`;
        g.fillRect(s.x, s.y, 1, 1);
      }
      if (this.bolt && this.flash > 0.55) this.drawBolt(g);
      if (lk.mapper) this.drawMapper(g);
      if (lk.birds) this.flock.draw(g);
      this.drawMist(g, this.mistFar, L.hz - 9, 1.2, 1);

      // ----- Plan moyen : viaduc, train, collines -----
      g.drawImage(this.mid, ox, 0);
      if (this.train) {
        if (this.hasPortal) {
          // Le train s'enfonce dans le noir du tunnel.
          g.save();
          g.beginPath();
          g.rect(this.X0 - 200, 0, L.portalClip - this.X0 + 200, H);
          g.clip();
          this.drawTrain(g);
          g.restore();
        } else this.drawTrain(g);
      }
      g.drawImage(this.deckFront, ox, 0);
      if (this.train && this.train.magic) this.drawSteam(g);
      if (this.car) this.drawFlyingCar(g);
      if (this.wraiths) this.drawWraiths(g);
      this.drawMist(g, this.mistNear, L.vfloor - 12, -1.8, 0.85);

      // ----- Premier plan : la pilote et son poste -----
      g.drawImage(this.fg, ox, 0);
      if (this.extR) this.drawExt(g);
      this.drawStation(g);
      this.drawPilot(g);
      this.drawInspection(g);
      if (this.flies.length) this.drawFlies(g);

      // Halos (village, lampes, lune, écran), qui respirent doucement.
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.9 + 0.06 * Math.sin(t * 1.3);
      g.drawImage(this.halo, ox, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';

      // Éclair d'orage sur toute la scène.
      if (this.flash > 0) {
        const a = this.flash > 0.55 ? 0.28 : this.flash > 0.3 ? 0.05 : this.flash > 0.15 ? 0.16 : 0.03;
        g.fillStyle = `rgba(200,210,255,${a})`;
        g.fillRect(this.X0, 0, this.WW, H);
      }
      this.drawSparks(g, 1 / 30);
    }

    // La bande de brume se répète tous les W pixels (sur tout le monde élargi).
    drawMist(g, img, y, speed, alpha) {
      const W = this.W;
      const off = (((Math.floor(this.t * speed) % W) + W) % W);
      g.globalAlpha = alpha;
      g.drawImage(img, -off, y);
      g.drawImage(img, W - off, y);
      for (let x = -off - W; x + W > this.X0; x -= W) g.drawImage(img, x, y);
      for (let x = 2 * W - off; x < this.X1; x += W) g.drawImage(img, x, y);
      g.globalAlpha = 1;
    }

    // Monde élargi : la vie du flanc de droite (manche à air, chevreuils, cabane).
    drawExt(g) {
      const { L } = this;
      const t = this.t;
      const lk = this.lk;
      const o = this.extL;
      // La manche à air, gonflée par le vent qui forcit et retombe.
      if (this.sock) {
        const { x, y } = this.sock;
        const wind = 0.55 + 0.35 * Math.sin(t * 0.45) + 0.1 * Math.sin(t * 1.9);
        const dimK = lk.night ? 0.5 : 0.2;
        const cols = [toHex(mix(C('#d8742a'), [30, 34, 46], dimK)), toHex(mix(C('#dcdcd4'), [30, 34, 46], dimK))];
        for (let i = 0; i < 7; i++) {
          const droop = i * i * 0.09 * (1.1 - wind) + Math.sin(t * 5 + i * 0.9) * 0.35 * (i / 6) * wind;
          g.fillStyle = cols[Math.floor(i / 2) % 2];
          g.fillRect(x - 1 - i, Math.round(y + droop), 1, i < 4 ? 2 : 1);
        }
      }
      // Les chevreuils : ils broutent, relèvent la tête de temps en temps.
      if (this.deerSpr) {
        const D = this.deerSpr;
        L.ext.deer.forEach((dx, i) => {
          if (!this.inWorld(dx, 12)) return;
          const right = i === 1;
          const ph = (t + i * 4.3) % 11;
          const up = ph > 7.5 || (ph > 3 && ph < 3.8);
          const img = up ? (right ? D.upR : D.up) : right ? D.downR : D.down;
          const by = L.fgTop[dx + 6 + o] + 2;
          g.drawImage(img, dx, by - img.height + 1);
          // Battement de la queue blanche.
          if (!up && Math.sin(t * 3 + i * 2) > 0.92) {
            g.fillStyle = 'rgba(200,192,178,0.8)';
            g.fillRect(right ? dx - 1 + 1 : dx + 11, by - 6, 1, 1);
          }
        });
      }
      // Fumée de la cheminée, lanterne qui vacille.
      if (this.chimney) this.smoke.draw(g, lk.night ? 0.18 : 0.26);
      if (this.lantern) {
        const f = 0.5 + 0.25 * Math.sin(t * 7.3) + 0.15 * Math.sin(t * 13.1);
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = `rgba(255,200,120,${(0.12 * f).toFixed(3)})`;
        g.fillRect(this.lantern.x - 1, this.lantern.y - 1, 3, 3);
        g.globalCompositeOperation = 'source-over';
      }
    }

    drawBolt(g) {
      g.fillStyle = 'rgba(236,240,255,0.9)';
      const p = this.bolt;
      for (let i = 1; i < p.length; i++) {
        const n = Math.max(Math.abs(p[i][0] - p[i - 1][0]), Math.abs(p[i][1] - p[i - 1][1]), 1);
        for (let s = 0; s <= n; s++) g.fillRect(Math.round(p[i - 1][0] + ((p[i][0] - p[i - 1][0]) * s) / n), Math.round(p[i - 1][1] + ((p[i][1] - p[i - 1][1]) * s) / n), 1, 1);
      }
    }

    // Le drone de cartographie : allers-retours réguliers, feux qui clignotent.
    drawMapper(g) {
      const L = this.L;
      const t = this.t;
      let u = (t * 5) % (2 * L.mapLen);
      if (u > L.mapLen) u = 2 * L.mapLen - u;
      let x = L.mapPath[0][0];
      let y = L.mapPath[0][1];
      for (let i = 1; i < L.mapPath.length; i++) {
        const a = L.mapPath[i - 1];
        const b = L.mapPath[i];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (u <= l) {
          x = a[0] + ((b[0] - a[0]) * u) / l;
          y = a[1] + ((b[1] - a[1]) * u) / l;
          break;
        }
        u -= l;
      }
      x = Math.round(x);
      y = Math.round(y + Math.sin(t * 1.7) * 0.5);
      const night = this.lk.night;
      g.globalAlpha = night ? 0.5 : 0.85;
      g.drawImage(this.spr.mapper, x - 3, y - 1);
      g.globalAlpha = 1;
      g.fillStyle = '#ff4a3a';
      g.fillRect(x - 3, y, 1, 1);
      g.fillStyle = '#5aff7a';
      g.fillRect(x + 3, y, 1, 1);
      if (t % 1.6 < 0.07) {
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = 'rgba(255,255,255,0.95)';
        g.fillRect(x, y - 2, 1, 1);
        g.fillStyle = 'rgba(255,255,255,0.22)';
        g.fillRect(x - 1, y - 3, 3, 3);
        g.globalCompositeOperation = 'source-over';
      }
    }

    // Le train : voitures grises, fenêtres allumées, phare et feu arrière.
    /* ---------- Easter egg : le train à vapeur magique ----------
     * Un coup de baguette (un cercle puis un trait vers le bas, à la souris) fait
     * passer sur le viaduc une vieille locomotive à vapeur rouge et ses voitures.
     * path : le tracé de la baguette, en pixels de la scène (des étincelles le suivent). */
    magic(path) {
      const { X0 } = this;
      const cars = 4;
      const len = 24 + cars * 19;
      this.train = { magic: true, dir: 1, cars, len, x: X0 - len - 4, v: 34, t: 0 };
      this.steam = [];
      // … et derrière lui, selon l'heure :
      //  • le jour, une vieille voiture bleue volante qui le rattrape et le suit en zigzag ;
      //  • la nuit, des spectres encapuchonnés qui le poursuivent en flottant.
      const h = new Date().getHours();
      const night = this.lk.night || h >= 21 || h < 6;
      this.car = night ? null : { x: X0 - len - 70, y: this.L.deckY - 26, v: 50, t: 0 };
      this.wraiths = night
        ? [0, 1, 2, 3].map((i) => ({ x: X0 - len - 50 - i * 26, y: this.L.deckY - 30, off: 0.15 + i * 0.22, alt: 19 + (i % 2) * 11 + i * 3, ph: i * 1.9, t: 0, flip: 0 }))
        : null;
      this.sparks = (path || []).map((p, i) => ({ x: p.x, y: p.y, age: -i * 0.01, life: 1.2 + Math.random() * 0.6 }));
    }

    updateSteam(dt) {
      const T = this.train;
      T.t += dt;
      const y = this.L.deckY - 7;
      // Bouffées de vapeur au rythme des pistons.
      T.puff = (T.puff || 0) - dt;
      if (T.puff <= 0) {
        T.puff = 0.18;
        this.steam.push({ x: T.x + T.len - 9, y: y - 9, vx: -6 - Math.random() * 6, vy: -9 - Math.random() * 5, age: 0, life: 2.2 + Math.random(), r: 1 });
      }
      for (const p of this.steam) {
        p.age += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy *= 1 - dt * 0.8;
        p.r = 1 + p.age * 2.2;
      }
      this.steam = this.steam.filter((p) => p.age < p.life);
    }

    // La voiture volante suit le train : elle le rattrape par l'arrière, puis reste au-dessus
    // de ses voitures (un peu en retard, en tanguant). Le train parti, elle file à sa suite.
    updateCar(dt) {
      const c = this.car;
      const T = this.train && this.train.magic ? this.train : null;
      c.t += dt;
      if (T) {
        // Au-dessus des voitures, en zigzag : elle avance et recule un peu en tanguant.
        const target = T.x + T.len * 0.35 + Math.sin(c.t * 1.6) * 16;
        const gap = target - c.x;
        c.x += (T.v + Math.max(-14, Math.min(28, gap * 1.2))) * dt;
      } else c.x += c.v * dt;
      c.y = this.L.deckY - 22 + Math.sin(c.t * 3.1) * 6 + Math.sin(c.t * 0.9) * 2;
      if (c.x > this.X1 + 60) this.car = null;
    }

    drawFlyingCar(g) {
      const c = this.car;
      if (!c) return;
      const x = Math.round(c.x);
      const y = Math.round(c.y);
      const night = this.lk.night;
      const k = night ? 0.8 : 1;
      const col = (r, gg, b) => `rgb(${Math.round(r * k)},${Math.round(gg * k)},${Math.round(b * k)})`;
      const tilt = Math.sin(c.t * 2.3) > 0.5 ? 1 : 0; // le nez pique un peu
      // Carrosserie bleu ciel, ombre bleu nuit, toit clair, chromes.
      g.fillStyle = col(30, 42, 70);
      g.fillRect(x, y + 4, 20, 1); // contour bas
      g.fillStyle = col(96, 168, 220);
      g.fillRect(x, y + 1, 20, 3);
      g.fillStyle = col(62, 120, 178);
      g.fillRect(x, y + 3, 20, 1);
      g.fillStyle = col(214, 226, 236);
      g.fillRect(x + 5, y - 3, 10, 1); // toit
      g.fillStyle = col(96, 168, 220);
      g.fillRect(x + 4, y - 2, 12, 3); // habitacle
      g.fillStyle = night ? '#ffd98a' : col(40, 56, 84);
      g.fillRect(x + 5, y - 2, 4, 2); // vitres
      g.fillRect(x + 10, y - 2, 4, 2);
      g.fillStyle = col(214, 226, 236);
      g.fillRect(x + 19, y + 2 + tilt, 1, 1); // pare-chocs
      g.fillRect(x, y + 2, 1, 1);
      g.fillStyle = '#16141a';
      g.fillRect(x + 3, y + 5, 3, 1); // roues
      g.fillRect(x + 14, y + 5, 3, 1);
      // Phare et son faisceau, petites étincelles derrière.
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = 'rgba(255,240,190,1)';
      g.fillRect(x + 19, y + 1, 1, 1);
      for (let q = 1; q <= 10; q++) {
        g.fillStyle = `rgba(255,230,170,${(0.22 * (1 - q / 11)).toFixed(3)})`;
        g.fillRect(x + 19 + q, y + 1 - (q > 4 ? 1 : 0), 1, q > 4 ? 3 : 1);
      }
      for (let q = 0; q < 6; q++) {
        const a = Math.sin(c.t * 9 + q * 1.7);
        if (a < 0.2) continue;
        g.fillStyle = `rgba(255,220,140,${(a * 0.7).toFixed(3)})`;
        g.fillRect(x - 2 - q * 3, y + 3 + Math.round(Math.sin(c.t * 5 + q) * 2), 1, 1);
      }
      g.globalCompositeOperation = 'source-over';
    }

    // Les spectres : chacun vise un point au-dessus du train et flotte en zigzag.
    updateWraiths(dt) {
      const T = this.train && this.train.magic ? this.train : null;
      for (const w of this.wraiths) {
        w.t += dt;
        const prevX = w.x;
        if (T) {
          const target = T.x + T.len * w.off + Math.sin(w.t * 1.3 + w.ph) * 14;
          w.x += (T.v + Math.max(-10, Math.min(30, (target - w.x) * 1.1))) * dt;
        } else w.x += 44 * dt;
        w.y = this.L.deckY - w.alt + Math.sin(w.t * 2.2 + w.ph) * 5 + Math.sin(w.t * 0.8 + w.ph) * 3;
        w.flip = w.x < prevX ? 1 : 0;
      }
      this.wraiths = this.wraiths.filter((w) => w.x < this.X1 + 40);
      if (!this.wraiths.length) this.wraiths = null;
    }

    // Un spectre (≈ 9 × 15) : capuche noire, visage creux, cape en lambeaux qui ondule,
    // une main grise tendue, et une traînée de brume froide.
    drawWraiths(g) {
      if (!this.wraiths) return;
      for (const w of this.wraiths) {
        const x = Math.round(w.x);
        const y = Math.round(w.y);
        const t = w.t;
        // Traînée froide.
        for (let q = 1; q <= 8; q++) {
          g.fillStyle = `rgba(150,170,200,${(0.16 * (1 - q / 9)).toFixed(3)})`;
          g.fillRect(x - q * 2, y + 6 + Math.round(Math.sin(t * 4 + q) * 1.5), 2, 2);
        }
        // Capuche et corps.
        g.fillStyle = '#0c0b12';
        g.fillRect(x + 2, y, 4, 1);
        g.fillRect(x + 1, y + 1, 6, 3);
        g.fillRect(x, y + 4, 8, 4);
        g.fillStyle = '#1b1a24';
        g.fillRect(x + 6, y + 1, 1, 6); // pli éclairé par la lune
        g.fillStyle = '#04040a';
        g.fillRect(x + 4, y + 2, 2, 2); // le visage : un creux
        // Cape en lambeaux : franges de longueurs qui ondulent, tirées vers l'arrière.
        g.fillStyle = '#0c0b12';
        for (let i = 0; i < 8; i++) {
          const len = 3 + ((i * 7 + Math.floor(t * 6 + w.ph * 3)) % 4) + (i < 3 ? 2 : 0);
          const sway = Math.round(Math.sin(t * 5 + i * 0.9 + w.ph) * 1);
          g.fillRect(x + i - (i < 4 ? 1 : 0) + sway, y + 8, 1, len);
        }
        // Main osseuse tendue vers le train.
        if (Math.sin(t * 0.9 + w.ph) > -0.2) {
          g.fillStyle = '#8a8e98';
          g.fillRect(x + 8, y + 5, 2, 1);
          g.fillRect(x + 10, y + 6, 1, 1);
        }
      }
    }

    drawMagicTrain(g) {
      const T = this.train;
      const y = this.L.deckY - 8;
      const x0 = Math.round(T.x);
      const night = this.lk.night;
      const k = night ? 0.72 : 1;
      const c = (r, gg, b) => `rgb(${Math.round(r * k)},${Math.round(gg * k)},${Math.round(b * k)})`;
      // Voitures rouges, liseré doré, fenêtres chaudes.
      for (let i = 0; i < T.cars; i++) {
        const cx = x0 + i * 19;
        g.fillStyle = c(140, 26, 30);
        g.fillRect(cx, y + 1, 18, 5);
        g.fillStyle = c(92, 16, 22);
        g.fillRect(cx, y + 5, 18, 1);
        g.fillStyle = c(40, 30, 34);
        g.fillRect(cx + 1, y, 16, 1);
        g.fillStyle = c(214, 170, 74);
        g.fillRect(cx, y + 4, 18, 1);
        g.fillStyle = '#ffd98a';
        for (let w = 2; w < 16; w += 4) g.fillRect(cx + w, y + 2, 2, 1);
        g.fillStyle = '#1a1416';
        g.fillRect(cx + 3, y + 6, 2, 1);
        g.fillRect(cx + 13, y + 6, 2, 1);
      }
      // La locomotive, à l'avant (à droite).
      const lx = x0 + T.cars * 19;
      g.fillStyle = c(30, 26, 30);
      g.fillRect(lx, y - 2, 7, 8); // cabine
      g.fillStyle = '#ffd98a';
      g.fillRect(lx + 2, y, 3, 2);
      g.fillStyle = c(150, 28, 32);
      g.fillRect(lx + 6, y + 1, 15, 5); // chaudière
      g.fillStyle = c(214, 170, 74);
      g.fillRect(lx + 10, y + 1, 1, 5);
      g.fillRect(lx + 15, y + 1, 1, 5);
      g.fillStyle = c(30, 26, 30);
      g.fillRect(lx + 17, y - 3, 3, 4); // cheminée
      g.fillRect(lx + 16, y - 4, 5, 1);
      g.fillRect(lx + 12, y - 1, 2, 2); // dôme
      g.fillRect(lx + 21, y + 4, 2, 2); // chasse-pierres
      // Roues qui tournent.
      const turn = Math.floor(T.t * 10) % 2;
      g.fillStyle = '#1a1416';
      for (const wx of [lx + 8, lx + 12, lx + 16]) g.fillRect(wx, y + 6, 3, 1);
      g.fillStyle = c(214, 170, 74);
      g.fillRect(lx + 8 + turn * 4, y + 5, 5, 1); // bielle
      // Lanterne et son halo.
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = 'rgba(255,230,160,1)';
      g.fillRect(lx + 22, y + 2, 1, 1);
      for (let q = 1; q <= 12; q++) {
        g.fillStyle = `rgba(255,220,150,${(0.2 * (1 - q / 13)).toFixed(3)})`;
        g.fillRect(lx + 22 + q, y + 2 - (q > 5 ? 1 : 0), 1, q > 5 ? 3 : 1);
      }
      g.fillStyle = 'rgba(255,200,120,0.12)';
      g.fillRect(x0, y + 1, T.len, 4);
      g.globalCompositeOperation = 'source-over';
    }

    drawSteam(g) {
      for (const p of this.steam || []) {
        const a = 0.7 * (1 - p.age / p.life);
        g.fillStyle = `rgba(236,238,244,${a.toFixed(3)})`;
        // Bouffée ronde : une croix de deux rectangles (coins arrondis en pixel art).
        const r = Math.max(1, Math.round(p.r));
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        g.fillRect(x - r, y - r + 1, r * 2, Math.max(1, r * 2 - 2));
        g.fillRect(x - r + 1, y - r, Math.max(1, r * 2 - 2), r * 2);
      }
    }

    // Étincelles dorées le long du tracé de la baguette.
    drawSparks(g, dt) {
      if (!this.sparks || !this.sparks.length) return;
      g.globalCompositeOperation = 'lighter';
      for (const s of this.sparks) {
        s.age += dt;
        if (s.age < 0 || s.age > s.life) continue;
        const a = 1 - s.age / s.life;
        g.fillStyle = `rgba(255,${200 + Math.round(55 * a)},140,${a.toFixed(3)})`;
        const x = Math.round(s.x + Math.sin(s.age * 9 + s.y) * 1.5);
        const y = Math.round(s.y + s.age * 6);
        g.fillRect(x, y, 1, 1);
        if (a > 0.6) {
          g.fillStyle = `rgba(255,220,150,${(a * 0.35).toFixed(3)})`;
          g.fillRect(x - 1, y, 3, 1);
          g.fillRect(x, y - 1, 1, 3);
        }
      }
      g.globalCompositeOperation = 'source-over';
      this.sparks = this.sparks.filter((s) => s.age <= s.life);
    }

    drawTrain(g) {
      const T = this.train;
      if (T.magic) return this.drawMagicTrain(g);
      const top = this.L.deckY;
      const y = top - 7;
      const x0 = Math.round(T.x);
      const night = this.lk.night;
      const fog = this.lk.mist;
      const body = night ? '#2c313c' : '#4c525e';
      const roof = night ? '#3a404c' : '#666c78';
      const band = night ? '#1e222a' : '#383d48';
      for (let i = 0; i < T.cars; i++) {
        const cx = x0 + i * 17;
        g.fillStyle = body;
        g.fillRect(cx, y + 1, 16, 4);
        g.fillStyle = roof;
        g.fillRect(cx + 1, y, 14, 1);
        g.fillStyle = band;
        g.fillRect(cx, y + 4, 16, 1);
        g.fillStyle = '#ffd890';
        for (let k = 2; k < 14; k += 3) g.fillRect(cx + k, y + 2, 2, 1);
        if (i < T.cars - 1) {
          g.fillStyle = band;
          g.fillRect(cx + 16, y + 2, 1, 2);
        }
      }
      // Nez profilé à l'avant, phare blanc ; feu rouge à l'arrière.
      const front = T.dir > 0 ? x0 + T.len - 1 : x0;
      const back = T.dir > 0 ? x0 : x0 + T.len - 1;
      g.clearRect(front, y, 1, 1);
      g.fillStyle = fog;
      g.fillRect(front, y, 1, 1);
      g.fillStyle = '#fff6dc';
      g.fillRect(front, y + 3, 1, 1);
      g.fillStyle = '#ff4a3a';
      g.fillRect(back, y + 3, 1, 1);
      // Pantographe vers la caténaire.
      g.fillStyle = band;
      const px = T.dir > 0 ? x0 + T.len - 8 : x0 + 7;
      g.fillRect(px, y - 1, 1, 1);
      g.fillRect(px + 1, y - 2, 1, 1);
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = 'rgba(255,240,200,0.22)';
      for (let k = 1; k <= 10; k++) {
        g.globalAlpha = 1 - k / 11;
        g.fillRect(front + T.dir * k, y + 3 - (k > 4 ? 1 : 0), 1, k > 4 ? 3 : 1);
      }
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(255,214,140,0.1)';
      g.fillRect(x0, y + 1, T.len, 3);
      g.globalCompositeOperation = 'source-over';
    }

    // Écran de télémétrie dans la valise, voyants du pad et de l'antenne.
    drawStation(g) {
      const { L } = this;
      const t = this.t;
      const s = L.screen;
      const d = this.insp;
      g.fillStyle = '#16303e';
      g.fillRect(s.x, s.y, s.w, s.h);
      // Tracé du vol : la vallée, le viaduc, le drone.
      g.fillStyle = '#2f7aa0';
      g.fillRect(s.x, s.y + 1, s.w, 1);
      g.fillStyle = '#4ab0e0';
      for (let k = 0; k < s.w; k += 3) g.fillRect(s.x + k, s.y + 1, 1, 1);
      const dx = s.x + clamp(Math.round((d.x / this.W) * s.w), 0, s.w - 1);
      const dy = s.y + clamp(Math.round((1 - d.depth) * 1 + 2), 0, s.h - 1);
      g.fillStyle = (t * 2) % 1 < 0.6 ? '#ff9a3a' : '#ffd0a0';
      g.fillRect(dx, dy, 1, 1);
      // Barre de batterie / signal qui varie un peu.
      g.fillStyle = '#7fe0a0';
      g.fillRect(s.x, s.y + s.h - 1, 3 + Math.round(2 + Math.sin(t * 0.7) * 1.5), 1);
      // Balises du pad, en chenillard (plus lentes au repos).
      const step = Math.floor(t * (d.phase === 'pad' ? 2 : 5)) % this.padLights.length;
      this.padLights.forEach((p, i) => {
        g.fillStyle = i === step ? '#a6ff9a' : '#3a5a40';
        g.fillRect(p.x, p.y, 1, 1);
      });
      // Voyant de l'antenne.
      if ((t * 1.2) % 1 < 0.5) {
        g.fillStyle = '#5aff7a';
        g.fillRect(L.tripodX + 2, L.feetY - 20, 1, 1);
      }
    }

    drawPilot(g) {
      const { L } = this;
      const pl = this.pilot;
      const set = this.pilotSpr;
      let img = set[pl.pose] || set.look;
      if (pl.pose === 'sticks' && Math.floor(pl.frameT / 0.35) % 2) img = set.sticks2;
      const px = L.pilotX;
      const py = L.feetY - img.height + 1;
      // Ombre au sol.
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(px + 2, L.feetY + 1, 9, 1);
      g.drawImage(img, px, py);
      // Lueur de l'écran (tablette ou radiocommande).
      g.globalCompositeOperation = 'lighter';
      if (pl.pose === 'tablet') {
        g.fillStyle = 'rgba(160,220,255,0.2)';
        g.fillRect(px, py + 10, 6, 4);
      } else if ((this.t * 1.5) % 1 < 0.7) {
        g.fillStyle = 'rgba(127,227,255,0.22)';
        g.fillRect(px + 2, py + 12, 4, 2);
      }
      g.globalCompositeOperation = 'source-over';
    }

    drawInspection(g) {
      const d = this.insp;
      const L = this.L;
      const t = this.t;
      const lk = this.lk || BASE;
      const flying = d.phase !== 'pad';
      const hover = d.phase === 'scan' || d.phase === 'go' || d.phase === 'back';
      const bob = hover ? Math.sin(d.t * 2.1) * 0.8 : 0;
      const x = Math.round(d.x);
      const y = Math.round(d.y + bob);
      // (Pendant l'ouverture, la caméra est tout près : on garde un sprite plus détaillé.)
      const set = d.depth > 0.5 ? this.spr.near : d.depth > 0.24 || d.intro ? this.spr.mid : this.spr.far;
      const img = flying ? set.fly[Math.floor(d.t * 16) % 2] : set.parked;
      const dx = x - (set.w >> 1);
      const dy = y - set.h + 1;
      const nightK = lk.night ? 1.5 : lk.storm || lk.wet ? 1.25 : 1;

      // Ombre sur le tapis, et souffle des hélices qui chasse la poussière (ou la neige).
      if (d.depth > 0.5 && (d.phase === 'pad' || d.phase === 'up' || d.phase === 'down')) {
        const h = L.padY - d.y;
        const w = Math.max(5, 17 - Math.round(h * 0.3));
        g.fillStyle = `rgba(0,0,0,${(0.38 * Math.max(0, 1 - h / 45)).toFixed(3)})`;
        g.fillRect(L.padX - (w >> 1), L.padY, w, 1);
        g.fillRect(L.padX - (w >> 1) + 2, L.padY + 1, w - 4, 1);
        if (flying && h < 18) {
          const k = 1 - h / 18;
          g.fillStyle = lk.snow ? `rgba(235,240,248,${(0.7 * k).toFixed(2)})` : `rgba(150,145,130,${(0.55 * k).toFixed(2)})`;
          for (let i = 0; i < 6; i++) {
            const s = (t * 1.6 + i / 6) % 1;
            const side = i % 2 ? 1 : -1;
            g.fillRect(Math.round(L.padX + side * (8 + s * 14)), Math.round(L.padY + 1 - s * 3 - (i % 3)), 1, 1);
          }
        }
      }

      // Projecteur : un cône de lumière qui balaie le béton, et une tache vive.
      if (d.phase === 'scan' && d.tgt) {
        const sx = dx + set.lens[0];
        const sy = dy + set.lens[1];
        const sw = Math.sin((d.scanT || 0) * 1.5);
        const ex = d.tgt[0] + d.sweep[0] * sw;
        const ey = d.tgt[1] + d.sweep[1] * sw;
        const n = Math.max(4, Math.round(Math.hypot(ex - sx, ey - sy)));
        g.globalCompositeOperation = 'lighter';
        for (let k = 1; k <= n; k++) {
          const u = k / n;
          const s = 1 + Math.round(u * 2);
          g.fillStyle = `rgba(236,240,255,${(0.13 * nightK * (1 - u * 0.3)).toFixed(3)})`;
          g.fillRect(Math.round(sx + (ex - sx) * u - s / 2), Math.round(sy + (ey - sy) * u - s / 2), s, s);
        }
        const ix = Math.round(ex);
        const iy = Math.round(ey);
        g.fillStyle = `rgba(230,236,255,${(0.1 * nightK).toFixed(3)})`;
        g.fillRect(ix - 2, iy - 2, 5, 5);
        g.fillStyle = `rgba(240,246,255,${(0.22 * nightK).toFixed(3)})`;
        g.fillRect(ix - 1, iy - 1, 3, 3);
        g.fillStyle = 'rgba(255,252,235,0.7)';
        g.fillRect(ix, iy, 1, 1);
        g.globalCompositeOperation = 'source-over';
      }

      // Le drone.
      g.drawImage(img, dx, dy);

      // Feux : rouge à gauche, vert à droite, flash blanc (double éclat).
      const lamp = (px, py, col, a, r) => {
        g.fillStyle = `rgb(${col})`;
        g.fillRect(px, py, 1, 1);
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = `rgba(${col},${(a * nightK).toFixed(3)})`;
        g.fillRect(px - r, py - r, 2 * r + 1, 2 * r + 1);
        g.globalCompositeOperation = 'source-over';
      };
      const [lx, ly] = set.navL;
      const [rx, ry] = set.navR;
      if (flying) {
        lamp(dx + lx, dy + ly, '255,58,48', 0.22, 1);
        lamp(dx + rx, dy + ry, '80,255,120', 0.22, 1);
        const ph = d.t % 1.3;
        if (ph < 0.06 || (ph > 0.16 && ph < 0.22)) {
          lamp(dx + set.strobe[0], dy + set.strobe[1], '255,255,255', 0.28, 2);
        }
        // Voyant d'enregistrement de la caméra pendant l'inspection.
        if (d.phase === 'scan' && (d.t * 1.5) % 1 < 0.5 && set === this.spr.near) {
          g.fillStyle = '#ff3a3a';
          g.fillRect(dx + set.cam[0], dy + set.cam[1], 1, 1);
        }
      } else if (lk.storm) {
        // Orage : posé, feux qui clignotent en alternance.
        const k = Math.floor(t * 1.6) % 2;
        if (k === 0) lamp(dx + lx, dy + ly, '255,58,48', 0.25, 1);
        else lamp(dx + rx, dy + ry, '80,255,120', 0.25, 1);
        if (t % 2.4 < 0.07) lamp(dx + set.strobe[0], dy + set.strobe[1], '255,255,255', 0.25, 2);
      } else if ((t * 0.8) % 1 < 0.5) {
        // Posé : voyant de charge.
        g.fillStyle = '#5aff7a';
        g.fillRect(dx + set.strobe[0], dy + set.strobe[1] + 1, 1, 1);
      }
    }

    drawFlies(g) {
      const t = this.t;
      for (const f of this.flies) {
        const a = t * f.s + f.p;
        const v = Math.sin(t * 1.8 + f.p * 3);
        if (v < 0.1) continue;
        const x = Math.round(f.x + Math.cos(a) * f.r);
        const y = Math.round(f.y + Math.sin(a * 1.3) * 5);
        g.fillStyle = `rgba(226,255,140,${(0.5 + 0.5 * v).toFixed(2)})`;
        g.fillRect(x, y, 1, 1);
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = `rgba(200,255,120,${(0.18 * v).toFixed(2)})`;
        g.fillRect(x - 1, y - 1, 3, 3);
        g.globalCompositeOperation = 'source-over';
      }
    }
  }

  B.PixelScenes.drones = Drones;
})();
