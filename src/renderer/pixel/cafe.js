// Brume — scène « Café », en pixel art.
//
// On est à l'intérieur d'un café, un soir de pluie, face à la grande vitre.
// Dehors : la rue d'en face (façades, boutiques, néon), des passants, des voitures.
// Dedans : boiseries, étagères, machine à espresso, ardoise, lampes suspendues, une
// cliente qui lit à la fenêtre et un chat roux qui vit sa vie sur le comptoir.
//
// Le décor est peint une fois (avec l'éclairage des lampes calculé pixel par pixel),
// puis chaque image ne dessine que ce qui bouge.
(function () {
  'use strict';
  const B = window.Brume;
  const { Raster, hex, mix, rng, hash, noise, fbm, bayer } = B.PX;
  const SP = B.Sprites;
  const C = hex;

  const PAL = {
    sky: ['#141a33', '#262d52', '#4d4870', '#7a5f7c'].map(C),
    cloud: C('#30365e'),
    cloudLit: C('#4b4a76'),
    farCity: C('#232946'),
    farWin: C('#b88a62'),
    facades: [
      ['#2c3456', '#3a4468'],
      ['#3b2f4f', '#4b3d63'],
      ['#2a3c4b', '#3a5062'],
      ['#44303a', '#57414b'],
    ].map((p) => p.map(C)),
    cornice: C('#5a648e'),
    frame: C('#161a2e'),
    sill: C('#4a5274'),
    winDark: C('#171c33'),
    winRefl: C('#2c3456'),
    winLit: [C('#ffd88a'), C('#ffb562')],
    curtains: [C('#c4685a'), C('#4a8a8a'), C('#d8b25a')],
    shopLit: [C('#ffe6b0'), C('#ffc77a')],
    shelfOut: C('#a8754c'),
    awnings: [
      ['#c4463c', '#e8e0d0'],
      ['#2f7a6a', '#e8e0d0'],
      ['#d8a83a', '#5a3a2a'],
      ['#3a4a8a', '#e8e0d0'],
    ].map((p) => p.map(C)),
    asphalt: [C('#1a1e30'), C('#252a40')],
    lane: C('#7a7c6e'),
    sidewalk: C('#2e3146'),
    tileLine: C('#232638'),
    curb: C('#4c5172'),
    post: C('#14172a'),
    plank: [C('#3c251d'), C('#36211a'), C('#412920')],
    plankLine: C('#22140e'),
    grain: C('#2c1a13'),
    frameDark: C('#1d120e'),
    frameLit: C('#4c3427'),
    ledgeTop: C('#8a5a3a'),
    ledgeHi: C('#b47e4e'),
    ledgeFront: C('#4e3123'),
    wainscot: C('#2e1b15'),
    wainscotHi: C('#46291f'),
    shelf: C('#6a432c'),
    shelfHi: C('#94603e'),
    counterTop: C('#8f5d3b'),
    counterHi: C('#c48a55'),
    counterFront: [C('#4d2f21'), C('#2c1a12')],
    rail: [C('#8a6a32'), C('#d8b064')],
    chalk: C('#1d2924'),
    chalkLine: C('#cfd8cc'),
    chalkPink: C('#e8a0a8'),
    leaf: [C('#21402b'), C('#33603d'), C('#4b8a50'), C('#6bae63')],
    pot: [C('#9a5234'), C('#c4774a')],
    brass: [C('#6e4e2a'), C('#b88a4a'), C('#e8c47c')],
    cord: C('#120b08'),
    chrome: [C('#3e454e'), C('#7c8894'), C('#bcc7d0'), C('#eef3f6')],
    black: C('#121214'),
    cup: C('#ece4d8'),
    cupShade: C('#b4aa9c'),
    coffee: C('#5a321e'),
    jar: [C('#6f8f9c'), C('#a6c2ca')],
    beans: C('#4a2a18'),
    sugar: C('#e8e2d6'),
    books: ['#b8483c', '#3e6e8e', '#d8a63a', '#4e7a4a', '#8a5a9a', '#d9d0bc', '#c47a3a'].map(C),
    cake: [C('#f2dcbc'), C('#d47a8a'), C('#6a3a24'), C('#fff4e4')],
    glass: C('#9ab4c4'),
    stool: [C('#2a1a14'), C('#6a432c'), C('#94603e')],
  };
  const NEON = C('#ff5fa2');

  // La rue d'en face suit le temps choisi (compatible avec le fond « Auto »).
  const MOODS = {
    none: { sky: PAL.sky, wet: true },
    rain: { sky: PAL.sky, wet: true },
    storm: { sky: ['#0e1226', '#1e2240', '#3a3858', '#5a4a62'].map(C), wet: true },
    snow: { sky: ['#2a3150', '#4a5274', '#7a7f9a', '#a8a4b8'].map(C), snow: true },
    sakura: { sky: ['#2a2350', '#5a3f78', '#b06a8a', '#e89aa0'].map(C), tree: 'sakura' },
    leaves: { sky: ['#2a1f3a', '#5a3448', '#a8583e', '#e0904a'].map(C), tree: 'autumn' },
    fireflies: { sky: ['#0e1430', '#1c2450', '#34356a', '#55466e'].map(C), stars: 0.6, tree: 'summer', fireflies: true },
    starfall: { sky: ['#070b22', '#111a40', '#22265a', '#3a3468'].map(C), stars: 1 },
  };
  const SNOW0 = [C('#e8eef8'), C('#c4cede'), C('#9aa6bc')];
  const TREES = {
    sakura: [C('#f2b6c8'), C('#e48aa8'), C('#fbd8e2'), C('#b85a7a')],
    autumn: [C('#e07a2a'), C('#c4482a'), C('#f2b03a'), C('#8a3a22')],
    summer: [C('#2e5a3a'), C('#3e7a48'), C('#5a9a5a'), C('#1e3a28')],
  };
  // Versions nuit (météo en direct, quand il fait nuit). Le café est déjà un soir : la rue
  // de « none », « rain », « storm », « fireflies » et « starfall » est une nuit, elle ne
  // change pas. La neige, le printemps et l'automne sont des fins de journée : la nuit, le
  // ciel s'éteint (étoiles et lune s'il est dégagé, ciel bas éclairé par la ville s'il
  // neige), la neige bleuit, les arbres passent dans l'ombre ; vitrines, fenêtres,
  // lampadaire et néon restent allumés, l'intérieur reste chaleureux.
  const shadeNight = (c) => mix(c, [18, 22, 58], 0.32);
  const NIGHT_MOODS = {
    snow: {
      ...MOODS.snow,
      sky: ['#0c1024', '#1a1f3c', '#2e3454', '#4c4a68'].map(C),
      snowPal: ['#c8d2e6', '#9ca8c4', '#76829e'].map(C),
      snowCloud: C('#2c3250'),
      snowRoad: ['#363c56', '#4a506c'].map(C),
      snowTrack: C('#262a40'),
    },
    sakura: {
      ...MOODS.sakura,
      sky: ['#070a22', '#10173c', '#1e2452', '#352f62'].map(C),
      stars: 0.75,
      moon: { u: 0.58, y: 17, r: 5, c: ['#fbf6f2', '#e6dce0', '#b8aab8'].map(C), glow: C('#b8b0e0') },
      treePal: TREES.sakura.map(shadeNight),
    },
    leaves: {
      ...MOODS.leaves,
      sky: ['#0a0920', '#171334', '#2a1d46', '#452c52'].map(C),
      stars: 0.6,
      moon: { u: 0.6, y: 18, r: 6, c: ['#ffe2b0', '#f0c48a', '#c09068'].map(C), glow: C('#c88a6a') },
      treePal: TREES.autumn.map(shadeNight),
    },
  };
  // L'ambiance de la rue pour un temps, de jour ou de nuit.
  const moodFor = (effect, night) => (night && NIGHT_MOODS[effect]) || MOODS[effect] || MOODS.none;
  const BULBS = [C('#ffd27a'), C('#ff9f6b'), C('#7fe3ff'), C('#ffe9b0'), C('#ff7ab0')];

  // Petite police 3 × 5 pour les enseignes.
  const FONT = {
    B: ['110', '101', '110', '101', '110'],
    A: ['010', '101', '111', '101', '101'],
    R: ['110', '101', '110', '101', '101'],
  };

  // Éclairage : chaque pixel est multiplié par la lumière ambiante (froide) plus la
  // lumière des lampes (chaude), quantifiée en paliers tramés comme en pixel art.
  // Monde élargi (animation d'ouverture) : une toile plus large que l'écran, peinte en
  // coordonnées de scène (x < 0 à gauche de l'écran). La toile est décalée de ox.
  // guard : interdit de peindre dans l'écran [0, gw) (pour les décors du monde élargi).
  class XRaster extends Raster {
    constructor(w, h, ox) {
      super(w, h);
      this.ox = ox;
      this.guard = 0;
    }
    set(x, y, c, a) {
      x |= 0;
      if (this.guard && x >= 0 && x < this.guard) return;
      super.set(x + this.ox, y, c, a);
    }
    get(x, y) {
      return super.get((x | 0) + this.ox, y);
    }
  }

  // ext : lumières du monde élargi, avec un poids wt(x) nul dans l'écran (le fond d'écran
  // reste identique au pixel près) et qui monte doucement en s'en éloignant.
  function applyLight(r, lights, ambient, warm, mask, ext) {
    const ox = r.ox || 0;
    for (let y = 0; y < r.h; y++) {
      for (let px = 0; px < r.w; px++) {
        const x = px - ox;
        if (mask && !mask(x, y)) continue;
        const i = (y * r.w + px) * 4;
        if (!r.data[i + 3]) continue;
        let I = 0;
        for (const l of lights) {
          const dx = x - l.x;
          const dy = (y - l.y) * (l.sy || 1);
          I += l.k / (1 + (dx * dx + dy * dy) / (l.r * l.r));
        }
        const w = ext ? ext.wt(x) : 0;
        if (w > 0) {
          for (const l of ext.lights) {
            const dx = x - l.x;
            const dy = (y - l.y) * (l.sy || 1);
            I += (w * l.k) / (1 + (dx * dx + dy * dy) / (l.r * l.r));
          }
        }
        const q = Math.floor(Math.min(1.3, I) * 6 + bayer(x, y)) / 6;
        for (let c = 0; c < 3; c++) r.data[i + c] = Math.min(255, r.data[i + c] * (ambient[c] + warm[c] * q));
      }
    }
  }
  const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

  class Cafe {
    constructor(W, H, opts = {}) {
      this.W = W;
      this.H = H;
      // Monde élargi (animation d'ouverture) : le café continue à gauche (et un peu à
      // droite) de l'écran. Sans ext, la scène est exactement le fond d'écran habituel.
      const ext = opts.ext || null;
      this.extL = ext ? Math.max(0, Math.round(ext.left || 0)) : 0;
      this.extR = ext ? Math.max(0, Math.round(ext.right || 0)) : 0;
      this.ext = this.extL + this.extR > 0;
      this.WW = W + this.extL + this.extR;
      const L = (this.L = {});
      L.ct = H - 46; // dessus du comptoir de premier plan
      L.wx0 = Math.round(W * 0.31);
      L.wx1 = W - 22;
      L.wy0 = 14;
      L.wy1 = Math.round(H * 0.58);
      L.street0 = L.wy1 - 33;
      L.street1 = L.wy1 - 17;
      L.walkY = L.wy1 - 3;
      L.lamps = [
        { x: L.wx0 - 36, y: 24 },
        { x: Math.round(L.wx0 + (L.wx1 - L.wx0) * 0.3), y: 30 },
        { x: Math.round(L.wx0 + (L.wx1 - L.wx0) * 0.82), y: 34 },
      ];
      L.readerX = Math.round(L.wx0 + (L.wx1 - L.wx0) * 0.5);
      L.readerHH = 10.5; // taille d'une tête de la cliente (px)
      L.readerY = L.wy1 + 9; // dessus du tabouret de la cliente
      L.seatX = L.readerX + 12; // milieu du tabouret
      L.streetLampX = Math.round(L.wx0 + (L.wx1 - L.wx0) * 0.12);
      if (this.ext) this.layoutExt();

      this.rand = rng(1234);
      this.windows = [];
      this.sprites = {
        cars: [0, 1, 2].map(SP.car),
        cat: SP.cat(),
        mug: SP.mug(),
      };
      this.effect = 'none';
      this.night = false; // version nuit du temps (météo en direct, la nuit)
      this.mood = MOODS.none;
      this.outside = this.paintOutside();
      this.inside = this.paintInside();
      this.halo = this.paintHalo();
      this.sprites.reader = this.paintReader();
      this.dressWalkers();

      // Ce qui vit dans la scène.
      this.walkers = [];
      this.nextWalker = 1.5;
      this.car = null;
      this.nextCar = 9;
      this.rain = Array.from({ length: 90 }, () => this.newDrop(true));
      this.ripples = [];
      this.glass = Array.from({ length: 28 }, () => this.newGlassDrop(true));
      this.steam = [];
      this.reader = { pose: 'idle', until: 0, nextPage: 8, nextSip: 14 };
      this.cat = { state: 'sleep', x: Math.round(W * 0.43), target: 0, dir: -1, timer: 30, frameT: 0 };
      this.nextToggle = 3;
      this.silhouette = { win: this.windows.find((w) => w.lit) || this.windows[0], x: 0, dir: 1 };
      this.neon = { on: true, flick: 0 };
      this.notes = [];
      // Mode test accéléré (captures) : le chat se réveille vite, un passant arrive tout de suite.
      if (typeof location !== 'undefined' && location.hash === '#fauna') {
        this.cat.timer = 1.5;
        this.nextWalker = 0.2;
      }
      this.t = 0;
      if (this.ext) this.initExt();
    }

    // Toile d'un plan : la largeur de l'écran, ou celle du monde élargi.
    raster() {
      return this.ext ? new XRaster(this.WW, this.H, this.extL) : new Raster(this.W, this.H);
    }

    // Poids des lumières du monde élargi : nul dans l'écran, plein à ~90 px du bord.
    extWeight(x) {
      return x < 0 ? smooth(-x / 90) : x >= this.W ? smooth((x - this.W) / 40) : 0;
    }

    /* ================= Le café continue (monde élargi) ================= */
    // À gauche du fond d'écran : la suite du bar (vitrine à pâtisseries, caisse, barista),
    // la fin du comptoir, une deuxième fenêtre avec une banquette où un couple discute,
    // un fauteuil de lecture sous un lampadaire, une bibliothèque et la porte d'entrée.
    layoutExt() {
      const { W, L } = this;
      const E = (this.E = {});
      const xL = -this.extL;
      E.fl = L.ct + 10; // pied du mur dans la salle
      E.barEnd = -178; // le comptoir s'arrête là
      E.win = { x0: -394, x1: -232, y0: L.wy0 + 22, y1: E.fl - 30 };
      E.seatY = E.fl - 12; // assise de la banquette
      E.couple = [
        { x: -350, view: 0.78 },
        { x: -278, view: Math.PI - 0.78 },
      ];
      E.table = { x: -314, y: E.seatY - 4 };
      E.barista = { x: -121, ground: L.ct + 18 };
      E.register = -164;
      E.vitrine = { x0: -96, x1: -34 };
      E.lamps = [
        { x: -66, y: 26 },
        { x: -312, y: 40 },
      ];
      E.neon = { x: -166, y: 100, text: 'CAFE' };
      // La porte, tout à gauche ; fauteuil et bibliothèque entre la porte et la fenêtre.
      E.door = { x0: xL + 20, w: 50, top: E.fl - 104 };
      E.chair = { x: E.win.x0 - 38, seatY: E.fl - 13 };
      E.floorLamp = { x: E.chair.x - 24, top: E.fl - 92 };
      E.shelf = { x1: E.floorLamp.x - 8, x0: Math.max(E.door.x0 + E.door.w + 10, E.floorLamp.x - 52) };
      E.plant = { x: E.barEnd - 18 };
      const d = E.door;
      E.doorGlass = { x0: d.x0 + 8, x1: d.x0 + d.w - 8, y0: d.top + 8, y1: d.top + 54 };
      E.transom = { x0: d.x0 + 4, x1: d.x0 + d.w - 4, y0: d.top - 20, y1: d.top - 6 };
      E.windows = [E.win, E.doorGlass, E.transom];
      E.sconce = this.extR >= 60 ? { x: W + 50, y: 70 } : null;
      E.lights = E.lamps.map((l) => ({ x: l.x, y: l.y + 6, r: 46, k: 0.85, sy: 0.8 }));
      E.lights.push({ x: (E.win.x0 + E.win.x1) / 2, y: E.win.y1 - 4, r: 60, k: 0.25 });
      E.lights.push({ x: E.floorLamp.x, y: E.floorLamp.top + 8, r: 34, k: 0.8, sy: 0.9 });
      E.lights.push({ x: (d.x0 + d.x0 + d.w) / 2, y: d.top + 30, r: 30, k: 0.18 });
      if (E.sconce) E.lights.push({ x: E.sconce.x, y: E.sconce.y, r: 30, k: 0.7 });
    }

    /* ================= Décor : dehors ================= */
    paintOutside() {
      const { W, H, L } = this;
      const R = this.rand;
      const r = this.raster();
      const spans = []; // façades d'en face (pour raccorder la rue du monde élargi)
      const x0 = L.wx0 - 4;
      const x1 = L.wx1 + 4;
      const mood = this.mood;
      const SNOW = mood.snowPal || SNOW0; // neige (bleutée la nuit)
      r.gradient(x0, L.wy0 - 4, x1 - x0, L.street0 - L.wy0 + 4, mood.sky, 12);
      if (mood.stars) {
        for (let k = 0; k < 140 * mood.stars; k++) {
          const sx = x0 + Math.floor(R() * (x1 - x0));
          const sy = L.wy0 + Math.floor(R() * 40);
          r.set(sx, sy, R() < 0.2 ? C('#fff4d8') : C('#b8c0e0'));
        }
      }
      // Nuages bas, éclairés par la ville.
      for (let y = L.wy0; y < L.wy0 + 46; y++) {
        for (let x = x0; x < x1; x++) {
          const n = fbm(x * 0.028, y * 0.11, 5);
          const thr = mood.stars ? 0.7 : mood.snow ? 0.5 : 0.55;
          if (n > thr) r.set(x, y, bayer(x, y) < (n - thr) * 5 ? (mood.snow ? SNOW[2] : PAL.cloudLit) : mood.snow ? mood.snowCloud || C('#5a6280') : PAL.cloud);
        }
      }
      // Lune (nuits claires des versions nuit) : halo tramé, disque, mers et ombre au bord.
      if (mood.moon) this.paintMoon(r, mood.moon);
      // Ville lointaine.
      for (let x = x0; x < x1; ) {
        const w = 5 + Math.floor(R() * 12);
        const top = L.wy0 + 28 + Math.floor(R() * 22);
        r.rect(x, top, w, L.street0 - top, PAL.farCity);
        for (let wy = top + 2; wy < L.street0 - 4; wy += 3) for (let wx = x + 1; wx < x + w - 1; wx += 2) if (R() < 0.12) r.set(wx, wy, PAL.farWin);
        x += w;
      }
      // Façades d'en face.
      let x = x0 - Math.floor(R() * 24);
      let fi = 0;
      while (x < x1) {
        const w = 54 + Math.floor(R() * 30);
        const top = L.wy0 + 30 + Math.floor(R() * 26);
        const base = L.street0;
        const [col, hi] = PAL.facades[fi % PAL.facades.length];
        spans.push([x, w]);
        r.rect(x, top, w, base - top, col);
        for (let y = top; y < base; y++) {
          for (let xx = x; xx < x + w; xx++) {
            const row = Math.floor((y - top) / 3);
            if ((y - top) % 3 === 0 || (xx + row * 3) % 7 === 0) r.tint(xx, y, [0, 0, 0], 0.12); // briques
          }
        }
        r.rect(x, top, w, 2, PAL.cornice);
        r.rect(x - 1, top + 2, w + 2, 1, hi);
        // Étages.
        const shopTop = base - 25;
        for (let wy = top + 6; wy + 11 < shopTop - 2; wy += 15) {
          for (let wx = x + 5; wx + 8 < x + w - 2; wx += 12) {
            r.rect(wx, wy, 7, 10, PAL.frame);
            r.rect(wx - 1, wy + 10, 9, 1, PAL.sill);
            this.windows.push({ x: wx + 1, y: wy + 1, w: 5, h: 8, lit: R() < 0.5, curtain: R() < 0.55 ? PAL.curtains[Math.floor(R() * 3)] : null });
          }
        }
        // Boutique : auvent rayé, vitrine éclairée, porte.
        const [a1, a2] = PAL.awnings[fi % PAL.awnings.length];
        for (let ax = x + 1; ax < x + w - 1; ax++) {
          const c = Math.floor((ax - x) / 3) % 2 ? a2 : a1;
          r.rect(ax, shopTop, 1, 5, c);
          if ((ax - x) % 3 === 1) r.set(ax, shopTop + 5, c);
        }
        const sx0 = x + 4;
        const sx1 = x + w - 15;
        r.gradient(sx0, shopTop + 8, sx1 - sx0, base - shopTop - 9, PAL.shopLit, 4);
        for (let sy = shopTop + 12; sy < base - 2; sy += 5) r.rect(sx0 + 1, sy, sx1 - sx0 - 2, 1, PAL.shelfOut);
        for (let k = 0; k < (sx1 - sx0) / 4; k++) if (R() < 0.6) r.rect(sx0 + 1 + k * 4, shopTop + 10 + Math.floor(R() * 3) * 5, 2, 2, PAL.books[Math.floor(R() * 6)]);
        r.rect(x + w - 12, shopTop + 7, 8, base - shopTop - 7, PAL.frame);
        r.set(x + w - 6, shopTop + 16, PAL.brass[2]);
        if (fi === 1) this.sign = { x: x + Math.floor(w / 2) - 6, y: top + 8 };
        if (mood.snow) {
          for (let sx = x - 1; sx < x + w + 1; sx++) {
            r.set(sx, top - 1, SNOW[0]);
            if (hash(sx, top, 3) > 0.4) r.set(sx, top - 2, SNOW[1]);
            r.set(sx, shopTop - 1, SNOW[0]); // neige sur l'auvent
          }
          for (const wn of this.windows) if (wn.x >= x && wn.x < x + w) r.rect(wn.x - 2, wn.y + 9, 9, 1, SNOW[0]);
        }
        x += w + 2;
        fi++;
      }
      // Enseigne néon éteinte (allumée dynamiquement).
      if (this.sign) r.rect(this.sign.x - 2, this.sign.y - 2, 15, 9, [24, 18, 30]);
      // Lampadaire de la rue.
      const lx = L.streetLampX;
      r.rect(lx, L.wy0 + 22, 2, L.street1 - L.wy0 - 22, PAL.post);
      r.rect(lx - 3, L.wy0 + 20, 8, 2, PAL.post);
      r.rect(lx + 3, L.wy0 + 22, 4, 3, C('#ffe6a8'));
      // Rue : mouillée (reflets de tout ce qui est éclairé), enneigée ou sèche.
      r.gradient(x0, L.street0, x1 - x0, L.street1 - L.street0, mood.snow ? mood.snowRoad || [C('#5a6078'), C('#7a8098')] : PAL.asphalt, 5);
      if (mood.snow) for (let xx = x0; xx < x1; xx++) for (const ty of [L.street0 + 4, L.street0 + 11]) r.set(xx, ty, mood.snowTrack || C('#3a3f56'));
      for (let y = L.street0; y < L.street1 && mood.wet; y++) {
        for (let xx = x0; xx < x1; xx++) {
          const src = r.get(xx + Math.round(Math.sin(y * 1.7) * 1.5), L.street0 - 2 - (y - L.street0) * 2);
          const lum = src[0] + src[1] + src[2];
          if (lum > 330 && (y - L.street0) % 2 === 0 && hash(xx >> 1, y, 9) > 0.35) r.tint(xx, y, src, 0.32);
        }
      }
      for (let xx = x0; xx < x1; xx += 14) r.rect(xx, Math.round((L.street0 + L.street1) / 2), 6, 1, PAL.lane);
      // Trottoir, bordure, flaques.
      r.rect(x0, L.street1, x1 - x0, L.wy1 - L.street1, mood.snow ? SNOW[1] : PAL.sidewalk);
      r.rect(x0, L.street1, x1 - x0, 1, PAL.curb);
      if (!mood.snow) {
        for (let xx = x0; xx < x1; xx += 11) r.rect(xx, L.street1 + 1, 1, L.wy1 - L.street1, PAL.tileLine);
        r.rect(x0, L.street1 + 8, x1 - x0, 1, PAL.tileLine);
      }
      for (let k = 0; k < (mood.wet ? 5 : 0); k++) {
        const px = x0 + Math.floor(R() * (x1 - x0 - 20));
        const pw = 10 + Math.floor(R() * 14);
        for (let xx = 0; xx < pw; xx++) r.tint(px + xx, L.street1 + 4 + (xx % 3 === 0 ? 1 : 0), PAL.sky[3], 0.5);
      }
      if (mood.snow) for (let xx = x0; xx < x1; xx++) if (hash(xx, 5, 8) > 0.6) r.set(xx, L.street1 + 2 + Math.floor(hash(xx, 9) * 12), SNOW[2]); // traces de pas
      // Arbre du trottoir (cerisier en fleurs, arbre roux, arbre d'été).
      if (mood.tree) this.paintStreetTree(r, rng(42), mood.treePal || TREES[mood.tree], mood.tree);
      // Lumières de la rue : lampadaire et vitrines.
      const lights = [{ x: lx + 5, y: L.wy0 + 24, r: 26, k: 0.9 }];
      for (const w of this.windows) if (w.lit) lights.push({ x: w.x + 2, y: w.y + 4, r: 5, k: 0.25 });
      applyLight(r, lights, [0.92, 0.92, 1.0], [0.7, 0.55, 0.35]);
      if (this.ext) this.paintOutsideWorld(r, spans);
      return r.toCanvas();
    }

    paintMoon(r, m) {
      const { L } = this;
      const mx = Math.round(L.wx0 + (L.wx1 - L.wx0) * m.u);
      const my = L.wy0 + m.y;
      const gR = m.r * 2.8;
      for (let y = Math.floor(my - gR); y <= my + gR; y++) {
        for (let x = Math.floor(mx - gR); x <= mx + gR; x++) {
          const d = Math.hypot(x - mx, y - my);
          if (d <= m.r || d > gR) continue;
          const q = Math.floor((1 - (d - m.r) / (gR - m.r)) * 3 + bayer(x, y) * 0.9) / 3;
          if (q > 0) r.tint(x, y, m.glow, q * 0.3);
        }
      }
      for (let y = my - m.r; y <= my + m.r; y++) {
        for (let x = mx - m.r; x <= mx + m.r; x++) {
          const d = Math.hypot(x - mx, y - my) / m.r;
          if (d > 1.02) continue;
          let c = m.c[0];
          if (noise(x * 0.6, y * 0.6, 44) > 0.6) c = m.c[1]; // mers lunaires
          if (x - mx + (y - my) * 0.3 > m.r * 0.5 && d > 0.6) c = m.c[2]; // ombre sur le bord
          r.set(x, y, c);
        }
      }
    }

    paintStreetTree(r, R, cols, kind, atX) {
      const { L } = this;
      const tx = atX == null ? Math.round(L.wx0 + (L.wx1 - L.wx0) * 0.72) : atX;
      const ground = L.street1 + 6;
      r.rect(tx - 1, L.street0 - 20, 3, ground - L.street0 + 20, C('#2a1a14'));
      r.rect(tx - 4, L.street0 - 24, 2, 8, C('#2a1a14'));
      r.rect(tx + 3, L.street0 - 26, 2, 9, C('#2a1a14'));
      if (atX == null) this.treeCenter = { x: tx, y: L.street0 - 34 };
      for (let k = 0; k < 900; k++) {
        const a = R() * Math.PI * 2;
        const d = Math.sqrt(R());
        const x = Math.round(tx + Math.cos(a) * d * 24);
        const y = Math.round(L.street0 - 34 + Math.sin(a) * d * 15);
        const n = fbm(x * 0.25, y * 0.25, 4);
        if (n < 0.42) continue;
        const c = Math.sin(a) < -0.3 ? cols[2] : n > 0.6 ? cols[0] : cols[1]; // dessus plus clair
        r.set(x, y, d > 0.92 ? cols[3] : c);
      }
      // Pétales ou feuilles tombés sur le trottoir.
      if (kind !== 'summer') for (let k = 0; k < 70; k++) r.set(tx - 34 + Math.floor(R() * 68), L.street1 + 2 + Math.floor(R() * 13), cols[Math.floor(R() * 3)]);
    }

    // Monde élargi : la rue d'en face continue sur toute la largeur du monde. Elle est
    // peinte sur sa propre toile (avec son propre hasard), puis glissée derrière la rue
    // du fond d'écran, seulement hors de l'écran. La partie qui tombe dans l'écran (derrière
    // les boiseries, jamais visible dans le fond d'écran) sert de fond à l'animation.
    paintOutsideWorld(r, spans) {
      const { W, H, L } = this;
      const mood = this.mood;
      const SNOW = mood.snowPal || SNOW0;
      const R = rng(9001);
      const xa = -this.extL;
      const xb = W + this.extR;
      const vx0 = L.wx0 - 4;
      const vx1 = L.wx1 + 4;
      const w = this.raster();
      // Ciel : mêmes dégradé et nuages que derrière la vitre (ils se raccordent).
      w.rect(xa, 0, xb - xa, L.wy0 - 4, mood.sky[0]);
      w.gradient(xa, L.wy0 - 4, xb - xa, L.street0 - L.wy0 + 4, mood.sky, 12);
      if (mood.stars) {
        const n = Math.round((140 * mood.stars * (xb - xa)) / (vx1 - vx0));
        for (let k = 0; k < n; k++) w.set(xa + Math.floor(R() * (xb - xa)), 2 + Math.floor(R() * (L.wy0 + 38)), R() < 0.2 ? C('#fff4d8') : C('#b8c0e0'));
      }
      for (let y = 0; y < L.wy0 + 46; y++) {
        for (let x = xa; x < xb; x++) {
          const n = fbm(x * 0.028, y * 0.11, 5);
          const thr = mood.stars ? 0.7 : mood.snow ? 0.5 : 0.55;
          if (n > thr) w.set(x, y, bayer(x, y) < (n - thr) * 5 ? (mood.snow ? SNOW[2] : PAL.cloudLit) : mood.snow ? mood.snowCloud || C('#5a6280') : PAL.cloud);
        }
      }
      for (let x = xa; x < xb; ) {
        const bw = 5 + Math.floor(R() * 12);
        const top = L.wy0 + 28 + Math.floor(R() * 22);
        w.rect(x, top, bw, L.street0 - top, PAL.farCity);
        for (let wy = top + 2; wy < L.street0 - 4; wy += 3) for (let wx = x + 1; wx < x + bw - 1; wx += 2) if (R() < 0.12) w.set(wx, wy, PAL.farWin);
        x += bw;
      }
      // Façades : vers la gauche depuis la première façade du fond d'écran, vers la droite
      // après la dernière.
      const wins = [];
      const signs = [];
      let x = spans.length ? spans[0][0] - 2 : vx0;
      let fi = -1;
      while (x > xa) {
        const fw = 54 + Math.floor(R() * 30);
        x -= fw;
        this.paintFacadeW(w, x, fw, fi--, R, wins, signs);
        x -= 2;
      }
      const last = spans[spans.length - 1];
      x = last ? last[0] + last[1] + 2 : vx1;
      fi = spans.length;
      while (x < xb) {
        const fw = 54 + Math.floor(R() * 30);
        this.paintFacadeW(w, x, fw, fi++, R, wins, signs);
        x += fw + 2;
      }
      // Lampadaires.
      const lamps = [];
      for (let lx = L.streetLampX - 172; lx > xa + 6; lx -= 172) lamps.push(lx);
      for (const lx of lamps) {
        w.rect(lx, L.wy0 + 22, 2, L.street1 - L.wy0 - 22, PAL.post);
        w.rect(lx - 3, L.wy0 + 20, 8, 2, PAL.post);
        w.rect(lx + 3, L.wy0 + 22, 4, 3, C('#ffe6a8'));
      }
      // Rue, trottoirs (le nôtre continue jusqu'en bas : on le voit par la porte vitrée).
      w.gradient(xa, L.street0, xb - xa, L.street1 - L.street0, mood.snow ? mood.snowRoad || [C('#5a6078'), C('#7a8098')] : PAL.asphalt, 5);
      if (mood.snow) for (let xx = xa; xx < xb; xx++) for (const ty of [L.street0 + 4, L.street0 + 11]) w.set(xx, ty, mood.snowTrack || C('#3a3f56'));
      for (let y = L.street0; y < L.street1 && mood.wet; y++) {
        for (let xx = xa; xx < xb; xx++) {
          const src = w.get(xx + Math.round(Math.sin(y * 1.7) * 1.5), L.street0 - 2 - (y - L.street0) * 2);
          const lum = src[0] + src[1] + src[2];
          if (lum > 330 && (y - L.street0) % 2 === 0 && hash(xx >> 1, y, 9) > 0.35) w.tint(xx, y, src, 0.32);
        }
      }
      const step = (p, k) => p + k * Math.floor((xa - p) / k);
      for (let xx = step(vx0, 14); xx < xb; xx += 14) w.rect(xx, Math.round((L.street0 + L.street1) / 2), 6, 1, PAL.lane);
      w.rect(xa, L.street1, xb - xa, H - L.street1, mood.snow ? SNOW[1] : PAL.sidewalk);
      w.rect(xa, L.street1, xb - xa, 1, PAL.curb);
      if (!mood.snow) {
        for (let xx = step(vx0, 11); xx < xb; xx += 11) w.rect(xx, L.street1 + 1, 1, H - L.street1, PAL.tileLine);
        for (let ty = L.street1 + 8; ty < H; ty += 9) w.rect(xa, ty, xb - xa, 1, PAL.tileLine);
      }
      for (let k = 0; k < (mood.wet ? Math.round((xb - xa) / 45) : 0); k++) {
        const px = xa + Math.floor(R() * (xb - xa - 20));
        const pw = 10 + Math.floor(R() * 14);
        for (let xx = 0; xx < pw; xx++) w.tint(px + xx, L.street1 + 4 + (xx % 3 === 0 ? 1 : 0), PAL.sky[3], 0.5);
      }
      if (mood.snow) for (let xx = xa; xx < xb; xx++) if (hash(xx, 5, 8) > 0.6) w.set(xx, L.street1 + 2 + Math.floor(hash(xx, 9) * 12), SNOW[2]);
      this.worldTrees = [];
      if (mood.tree) {
        for (const tx of [-292, -540]) {
          if (tx < xa + 20) continue;
          this.paintStreetTree(w, rng(43 - tx), mood.treePal || TREES[mood.tree], mood.tree, tx);
          this.worldTrees.push({ x: tx, y: L.street0 - 34 });
        }
      }
      // De notre côté, juste sous les vitres : les jardinières du café.
      const py = L.wy1 + 6;
      w.rect(xa, py, xb - xa, H - py, C('#2e211c'));
      w.rect(xa, py, xb - xa, 1, C('#5a4034'));
      for (let xx = xa; xx < xb; xx++) {
        if (xx % 40 === 0) w.rect(xx, py, 1, H - py, C('#1e1612'));
        const hgt = 2 + Math.floor(fbm(xx * 0.3, 1, 7) * 7);
        for (let j = 0; j < hgt; j++) w.set(xx, py - 1 - j, PAL.leaf[(j + (xx & 1)) % 3 === 0 ? 1 : j > hgt - 3 ? 3 : 2]);
        if (mood.snow) w.set(xx, py - hgt - 1, SNOW[0]);
        else if (hash(xx, 4, 2) > 0.9) w.set(xx, py - hgt, [C('#e86a8a'), C('#f2d65a'), C('#f2f0ea')][Math.floor(hash(xx, 5) * 3)]);
      }
      // Lumières de la rue, puis les fenêtres (allumées ou non) peintes par-dessus.
      const lights = lamps.map((lx) => ({ x: lx + 5, y: L.wy0 + 24, r: 26, k: 0.9 }));
      for (const wn of wins) if (wn.lit) lights.push({ x: wn.x + 2, y: wn.y + 4, r: 5, k: 0.25 });
      applyLight(w, lights, [0.92, 0.92, 1.0], [0.7, 0.55, 0.35]);
      for (const wn of wins) {
        if (wn.lit) {
          w.rect(wn.x, wn.y, wn.w, wn.h, PAL.winLit[0]);
          w.rect(wn.x, wn.y + wn.h - 3, wn.w, 3, PAL.winLit[1]);
          if (wn.curtain) {
            w.rect(wn.x, wn.y, 1, wn.h, wn.curtain);
            w.rect(wn.x + wn.w - 1, wn.y, 1, wn.h, wn.curtain);
          }
        } else {
          w.rect(wn.x, wn.y, wn.w, wn.h, PAL.winDark);
          w.rect(wn.x + 1, wn.y + 1, 1, 2, PAL.winRefl);
        }
      }
      // Enseignes allumées (néons fixes) et leur reflet sur la rue mouillée.
      for (const sg of signs) {
        B.PXC.text(w, sg.text, sg.x, sg.y, sg.c);
        for (let k = 0; k < sg.text.length * 4 + 2; k++) for (let j = -1; j < 6; j++) w.tint(sg.x - 1 + k, sg.y + j, sg.c, j < 0 || j > 4 ? 0.12 : 0.04);
        if (mood.wet) for (let k = 0; k < sg.text.length * 4; k++) if (hash(k, sg.x, 4) > 0.4) w.tint(sg.x + k, L.street0 + 2 + (k % 3), sg.c, 0.25);
      }
      this.worldWins = wins;
      // Ce qui manque autour de l'écran dans le plan du dehors : rempli par la rue du monde.
      const ox = this.extL;
      for (let y = 0; y < H; y++) {
        for (let px = 0; px < r.w; px++) {
          if (px >= ox && px < ox + W) continue;
          const i = (y * r.w + px) * 4;
          if (r.data[i + 3]) continue;
          for (let c = 0; c < 4; c++) r.data[i + c] = w.data[i + c];
        }
      }
      const gap = new Raster(W, H);
      for (let y = 0; y < H; y++) gap.data.set(w.data.subarray((y * w.w + ox) * 4, (y * w.w + ox + W) * 4), y * W * 4);
      this.outsideGap = gap.toCanvas();
    }

    // Une façade de la rue du monde élargi : boutique au rez-de-chaussée (épicerie,
    // boulangerie, fleuriste, rideau baissé), étages aux fenêtres allumées ou non.
    paintFacadeW(r, x, w, fi, R, wins, signs) {
      const { L } = this;
      const mood = this.mood;
      const SNOW = mood.snowPal || SNOW0;
      const k = ((fi % 4) + 4) % 4;
      const top = L.wy0 + 30 + Math.floor(R() * 26);
      const base = L.street0;
      const [col, hi] = PAL.facades[k];
      r.rect(x, top, w, base - top, col);
      for (let y = top; y < base; y++) {
        for (let xx = x; xx < x + w; xx++) {
          const row = Math.floor((y - top) / 3);
          if ((y - top) % 3 === 0 || (xx + row * 3) % 7 === 0) r.tint(xx, y, [0, 0, 0], 0.12);
        }
      }
      r.rect(x, top, w, 2, PAL.cornice);
      r.rect(x - 1, top + 2, w + 2, 1, hi);
      const shopTop = base - 25;
      for (let wy = top + 6; wy + 11 < shopTop - 2; wy += 15) {
        for (let wx = x + 5; wx + 8 < x + w - 2; wx += 12) {
          r.rect(wx, wy, 7, 10, PAL.frame);
          r.rect(wx - 1, wy + 10, 9, 1, PAL.sill);
          wins.push({ x: wx + 1, y: wy + 1, w: 5, h: 8, lit: R() < 0.5, curtain: R() < 0.55 ? PAL.curtains[Math.floor(R() * 3)] : null });
          if (mood.snow) r.rect(wx - 1, wy + 10, 9, 1, SNOW[0]);
          else if (R() < 0.25) {
            // Jardinière au balcon.
            r.rect(wx, wy + 11, 7, 2, PAL.pot[0]);
            for (let f = 0; f < 6; f++) r.set(wx + Math.floor(R() * 7), wy + 9 + Math.floor(R() * 2), PAL.leaf[2 + Math.floor(R() * 2)]);
          }
        }
      }
      const kind = Math.floor(R() * 4);
      const sx0 = x + 4;
      const sx1 = x + w - 15;
      if (kind === 3) {
        // Rideau de fer baissé (boutique fermée), tagué.
        r.rect(sx0 - 1, shopTop + 2, w - 6, base - shopTop - 2, C('#3a3f52'));
        for (let sy = shopTop + 3; sy < base; sy += 2) r.rect(sx0 - 1, sy, w - 6, 1, C('#2c3042'));
        r.rect(sx0 - 1, shopTop + 2, w - 6, 1, C('#5a6078'));
        const tag = [C('#d86a8a'), C('#5ab0c8'), C('#e8c05a')][Math.floor(R() * 3)];
        for (let t = 0; t < 14; t++) r.set(sx0 + 6 + t, base - 10 + Math.round(Math.sin(t * 0.9) * 2), tag);
      } else {
        const [a1, a2] = kind === 2 ? [C('#3a7a4a'), C('#e8e0d0')] : PAL.awnings[k];
        for (let ax = x + 1; ax < x + w - 1; ax++) {
          const c = Math.floor((ax - x) / 3) % 2 ? a2 : a1;
          r.rect(ax, shopTop, 1, 5, c);
          if ((ax - x) % 3 === 1) r.set(ax, shopTop + 5, c);
        }
        r.gradient(sx0, shopTop + 8, sx1 - sx0, base - shopTop - 9, PAL.shopLit, 4);
        if (kind === 1) {
          // Boulangerie : pains et croissants en vitrine, enseigne « PAIN ».
          for (let sy = shopTop + 13; sy < base - 2; sy += 6) {
            r.rect(sx0 + 1, sy, sx1 - sx0 - 2, 1, PAL.shelfOut);
            for (let bx = sx0 + 2; bx < sx1 - 4; bx += 5) r.rect(bx, sy - 2, 3 + (bx % 2), 2, R() < 0.5 ? C('#c8823a') : C('#a85a2a'));
          }
          if (top + 15 < shopTop) signs.push({ text: 'PAIN', x: x + Math.floor(w / 2) - 8, y: top + 7, c: C('#ffd27a') });
        } else if (kind === 2) {
          // Fleuriste : seaux de fleurs sur le trottoir.
          for (let sy = shopTop + 12; sy < base - 2; sy += 5) r.rect(sx0 + 1, sy, sx1 - sx0 - 2, 1, PAL.shelfOut);
          for (let bx = x + 2; bx < x + w - 4; bx += 5) {
            r.rect(bx, L.street1 - 1, 4, 3, C('#5a6078'));
            for (let f = 0; f < 7; f++) r.set(bx + Math.floor(R() * 5) - 1, L.street1 - 2 - Math.floor(R() * 4), [C('#e86a8a'), C('#f2d65a'), C('#f2f0ea'), C('#c45a9a'), C('#4b8a50')][Math.floor(R() * 5)]);
          }
        } else {
          for (let sy = shopTop + 12; sy < base - 2; sy += 5) r.rect(sx0 + 1, sy, sx1 - sx0 - 2, 1, PAL.shelfOut);
          for (let q = 0; q < (sx1 - sx0) / 4; q++) if (R() < 0.6) r.rect(sx0 + 1 + q * 4, shopTop + 10 + Math.floor(R() * 3) * 5, 2, 2, PAL.books[Math.floor(R() * 6)]);
          const txt = R() < 0.5 ? 'HOTEL' : 'LIVRES';
          if (R() < 0.6 && top + 15 < shopTop) signs.push({ text: txt, x: x + Math.floor((w - txt.length * 4) / 2), y: top + 7, c: R() < 0.5 ? C('#7fe3ff') : C('#ff7ab0') });
        }
        r.rect(x + w - 12, shopTop + 7, 8, base - shopTop - 7, PAL.frame);
        r.set(x + w - 6, shopTop + 16, PAL.brass[2]);
      }
      if (mood.snow) {
        for (let sx = x - 1; sx < x + w + 1; sx++) {
          r.set(sx, top - 1, SNOW[0]);
          if (hash(sx, top, 3) > 0.4) r.set(sx, top - 2, SNOW[1]);
          if (kind !== 3) r.set(sx, shopTop - 1, SNOW[0]);
        }
      }
    }

    // Le temps a changé : on repeint la rue d'en face.
    // night : version nuit de ce temps (voir NIGHT_MOODS).
    setEffect(effect, night = false) {
      this.effect = effect;
      this.night = night;
      this.mood = moodFor(effect, night);
      this.windows = [];
      this.sign = null;
      this.treeCenter = null;
      this.rand = rng(1234);
      this.outside = this.paintOutside();
      this.dressWalkers();
      this.silhouette = { win: this.windows.find((w) => w.lit) || this.windows[0], x: 0, dir: 1 };
      this.flash = 0;
      if (this.ext) this.extWalkers = [];
    }

    /* ================= Décor : dedans ================= */
    paintInside() {
      const { W, H, L } = this;
      const R = rng(99);
      const r = this.raster();
      // Boiseries : planches verticales veinées.
      for (let x = -this.extL; x < W + this.extR; x++) {
        const plank = Math.floor(x / 7);
        const base = PAL.plank[Math.floor(hash(plank, 3) * 3)];
        for (let y = 0; y < H; y++) {
          let c = base;
          if (x % 7 === 0) c = PAL.plankLine;
          else if (noise(x * 0.7, y * 0.06 + plank * 13, 2) > 0.7) c = PAL.grain;
          r.set(x, y, c);
        }
      }
      // Soubassement à panneaux sous la fenêtre et sur toute la largeur.
      const wsTop = L.wy1 + 7;
      r.rect(-this.extL, wsTop, this.WW, L.ct - wsTop, PAL.wainscot);
      r.rect(-this.extL, wsTop, this.WW, 1, PAL.wainscotHi);
      const panel = (px, bottom) => {
        r.rect(px, wsTop + 6, 26, 1, PAL.wainscotHi);
        r.rect(px, wsTop + 6, 1, bottom - wsTop - 12, PAL.wainscotHi);
        r.rect(px, bottom - 6, 26, 1, PAL.plankLine);
        r.rect(px + 25, wsTop + 6, 1, bottom - wsTop - 12, PAL.plankLine);
      };
      for (let px = 6; px < W - 20; px += 34) panel(px, L.ct);
      // (monde élargi : les panneaux continuent au même pas, sans toucher l'écran)
      if (this.ext) {
        // Dans la salle (sans comptoir devant), le soubassement descend jusqu'au sol.
        r.rect(-this.extL, L.ct, this.E.barEnd + this.extL, this.E.fl - L.ct, PAL.wainscot);
        for (let px = 6 - 34; px > -this.extL - 26; px -= 34) panel(px, px + 26 < this.E.barEnd ? this.E.fl - 4 : L.ct);
        for (let px = 6 + 34 * Math.ceil((W - 6) / 34); px < W + this.extR; px += 34) panel(px, L.ct);
      }
      // Fenêtre : on « découpe » la vitre, puis cadre, croisillons et rebord.
      r.clear(L.wx0, L.wy0, L.wx1 - L.wx0, L.wy1 - L.wy0);
      r.rect(L.wx0 - 5, L.wy0 - 5, L.wx1 - L.wx0 + 10, 5, PAL.frameDark);
      r.rect(L.wx0 - 5, L.wy0, 5, L.wy1 - L.wy0, PAL.frameDark);
      r.rect(L.wx1, L.wy0, 5, L.wy1 - L.wy0, PAL.frameDark);
      r.rect(L.wx0 - 1, L.wy0, 1, L.wy1 - L.wy0, PAL.frameLit);
      r.rect(L.wx0 - 5, L.wy0 - 5, L.wx1 - L.wx0 + 10, 1, PAL.frameLit);
      const third = (L.wx1 - L.wx0) / 3;
      for (let k = 1; k < 3; k++) {
        const mx = Math.round(L.wx0 + third * k);
        r.rect(mx - 1, L.wy0, 3, L.wy1 - L.wy0, PAL.frameDark);
        r.rect(mx - 1, L.wy0, 1, L.wy1 - L.wy0, PAL.frameLit);
      }
      r.rect(L.wx0, L.wy0 + 24, L.wx1 - L.wx0, 3, PAL.frameDark);
      r.rect(L.wx0, L.wy0 + 24, L.wx1 - L.wx0, 1, PAL.frameLit);
      // Rebord où l'on s'accoude.
      r.rect(L.wx0 - 9, L.wy1, L.wx1 - L.wx0 + 18, 2, PAL.ledgeHi);
      r.rect(L.wx0 - 9, L.wy1 + 2, L.wx1 - L.wx0 + 18, 2, PAL.ledgeTop);
      r.rect(L.wx0 - 9, L.wy1 + 4, L.wx1 - L.wx0 + 18, 3, PAL.ledgeFront);
      // Fil de la guirlande (les ampoules sont dessinées à chaque image).
      this.garland = [];
      for (let x = L.wx0 + 2; x < L.wx1 - 2; x++) {
        const u = (x - L.wx0) / (L.wx1 - L.wx0);
        const y = Math.round(L.wy0 + 3 + Math.sin(u * Math.PI * 3) ** 2 * 6);
        r.set(x, y, PAL.cord);
        if ((x - L.wx0) % 9 === 4) this.garland.push({ x, y: y + 1, c: BULBS[this.garland.length % BULBS.length], p: R() * 6 });
      }
      // Tabourets le long du bar (celui du milieu est celui de la cliente).
      for (const sx of [L.readerX + 4 - 74, L.readerX + 4, L.readerX + 4 + 74]) {
        if (sx < L.wx0 - 4 || sx + 18 > L.wx1 + 4) continue;
        r.rect(sx - 2, L.readerY, 20, 3, PAL.stool[2]);
        r.rect(sx - 2, L.readerY, 20, 1, mix(PAL.stool[2], [255, 255, 255], 0.2));
        r.rect(sx - 2, L.readerY + 3, 20, 1, PAL.stool[0]);
        r.rect(sx, L.readerY + 4, 2, L.ct - L.readerY - 4, PAL.stool[0]);
        r.rect(sx + 14, L.readerY + 4, 2, L.ct - L.readerY - 4, PAL.stool[0]);
        r.rect(sx, L.readerY + 13, 16, 1, PAL.stool[1]); // repose-pieds
      }

      this.paintShelves(r, R);
      this.paintChalkboard(r);
      this.paintHangingPlant(r, R);
      this.paintLamps(r);
      this.paintCounter(r, R);
      if (this.ext) this.paintInsideExt(r);

      // Éclairage chaud des lampes sur tout l'intérieur.
      const lights = L.lamps.map((l) => ({ x: l.x, y: l.y + 6, r: 46, k: 0.85, sy: 0.8 }));
      lights.push({ x: L.readerX + 12, y: L.wy1 - 4, r: 60, k: 0.25 }); // la vitre éclaire un peu
      const extLight = this.ext ? { lights: this.E.lights, wt: (x) => this.extWeight(x) } : null;
      applyLight(r, lights, [0.5, 0.48, 0.58], [0.95, 0.72, 0.45], null, extLight);
      if (this.ext) {
        // Ce qui passe devant les clients (tables, accoudoirs) : sa propre toile.
        const f = this.extFrontRaster;
        applyLight(f, lights, [0.5, 0.48, 0.58], [0.95, 0.72, 0.45], null, extLight);
        this.extFront = f.toCanvas();
        this.extFrontRaster = null;
      }
      return r.toCanvas();
    }

    paintShelves(r, R) {
      const { L } = this;
      const sx0 = 10;
      const sx1 = L.wx0 - 18;
      for (const sy of [46, 76]) {
        // Objets posés sur l'étagère.
        for (let x = sx0 + 1; x < sx1 - 4; ) {
          const kind = R();
          if (kind < 0.35) {
            const n = 3 + Math.floor(R() * 4);
            for (let k = 0; k < n && x < sx1 - 3; k++) {
              const bw = 2 + Math.floor(R() * 2);
              const bh = 8 + Math.floor(R() * 5);
              const c = PAL.books[Math.floor(R() * PAL.books.length)];
              r.rect(x, sy - bh, bw, bh, c);
              r.rect(x, sy - bh, bw, 1, mix(c, [255, 255, 255], 0.3));
              r.rect(x + bw - 1, sy - bh, 1, bh, mix(c, [0, 0, 0], 0.3));
              x += bw;
            }
          } else if (kind < 0.62) {
            const fill = R() < 0.5 ? PAL.beans : PAL.sugar;
            r.rect(x, sy - 11, 8, 11, PAL.jar[0]);
            r.rect(x + 1, sy - 7, 6, 6, fill);
            r.rect(x + 1, sy - 10, 1, 8, PAL.jar[1]);
            r.rect(x - 1, sy - 13, 10, 2, PAL.brass[1]);
            x += 10;
          } else if (kind < 0.82) {
            r.rect(x, sy - 6, 7, 6, PAL.pot[0]);
            r.rect(x, sy - 6, 7, 1, PAL.pot[1]);
            for (let k = 0; k < 26; k++) {
              const lx = x + 3 + Math.round((R() - 0.5) * 9);
              const ly = sy - 7 - Math.floor(R() * 9);
              r.set(lx, ly, PAL.leaf[1 + Math.floor(R() * 3)]);
            }
            x += 10;
          } else {
            for (let k = 0; k < 3; k++) {
              r.rect(x, sy - 4 - k * 4, 6, 3, PAL.cup);
              r.rect(x, sy - 2 - k * 4, 6, 1, PAL.cupShade);
            }
            x += 8;
          }
          x += 2 + Math.floor(R() * 3);
        }
        r.rect(sx0 - 2, sy, sx1 - sx0 + 4, 2, PAL.shelfHi);
        r.rect(sx0 - 2, sy + 2, sx1 - sx0 + 4, 2, PAL.shelf);
        r.rect(sx0 + 2, sy + 4, 2, 4, PAL.shelf);
        r.rect(sx1 - 4, sy + 4, 2, 4, PAL.shelf);
      }
    }

    paintChalkboard(r) {
      const { L } = this;
      const x0 = 14;
      const x1 = L.wx0 - 22;
      const y0 = 92;
      const y1 = L.wy1 + 2;
      r.rect(x0 - 3, y0 - 3, x1 - x0 + 6, y1 - y0 + 6, C('#5a3a24'));
      r.rect(x0, y0, x1 - x0, y1 - y0, PAL.chalk);
      // « Lignes » de menu à la craie, avec des prix à droite.
      for (let ly = y0 + 5, k = 0; ly < y1 - 6; ly += 6, k++) {
        const len = Math.round((x1 - x0 - 16) * (0.45 + hash(k, 7) * 0.4));
        for (let x = x0 + 4; x < x0 + 4 + len; x++) if (hash(x, ly) > 0.25) r.set(x, ly + (hash(x, k) > 0.85 ? 1 : 0), PAL.chalkLine);
        r.rect(x1 - 9, ly, 5, 1, PAL.chalkPink);
      }
      // Petite tasse dessinée à la craie.
      const cx = x0 + Math.round((x1 - x0) / 2) - 4;
      r.rect(cx, y1 - 13, 8, 1, PAL.chalkLine);
      r.rect(cx, y1 - 13, 1, 6, PAL.chalkLine);
      r.rect(cx + 7, y1 - 13, 1, 6, PAL.chalkLine);
      r.rect(cx + 1, y1 - 7, 6, 1, PAL.chalkLine);
      r.rect(cx + 8, y1 - 12, 2, 1, PAL.chalkLine);
      r.rect(cx + 9, y1 - 12, 1, 3, PAL.chalkLine);
    }

    paintHangingPlant(r, R) {
      const { L } = this;
      const px = L.wx0 - 14;
      r.rect(px, 0, 1, 10, PAL.cord);
      r.rect(px - 5, 10, 11, 6, PAL.pot[0]);
      r.rect(px - 5, 10, 11, 1, PAL.pot[1]);
      // Lianes qui retombent.
      for (let v = 0; v < 7; v++) {
        let x = px - 5 + Math.floor(R() * 11);
        const len = 14 + Math.floor(R() * 34);
        for (let y = 16; y < 16 + len; y++) {
          if (R() < 0.35) x += R() < 0.5 ? -1 : 1;
          r.set(x, y, PAL.leaf[1]);
          if (y % 3 === 0) {
            r.set(x - 1, y, PAL.leaf[2]);
            r.set(x + 1, y + 1, PAL.leaf[3]);
          }
        }
      }
      for (let k = 0; k < 40; k++) r.set(px - 6 + Math.floor(R() * 13), 8 + Math.floor(R() * 7), PAL.leaf[1 + Math.floor(R() * 3)]);
    }

    paintLamps(r) {
      for (const l of this.L.lamps) {
        r.rect(l.x, 0, 1, l.y - 4, PAL.cord);
        // Abat-jour en laiton.
        for (let k = 0; k < 6; k++) {
          const half = 2 + k;
          r.rect(l.x - half, l.y - 6 + k, half * 2 + 1, 1, k < 2 ? PAL.brass[2] : PAL.brass[1]);
          r.set(l.x - half, l.y - 6 + k, PAL.brass[0]);
          r.set(l.x + half, l.y - 6 + k, PAL.brass[0]);
        }
      }
    }

    paintCounter(r, R) {
      const { W, H, L } = this;
      const ct = L.ct;
      // Le comptoir (dans le monde élargi, il continue à droite et s'arrête à gauche).
      const c0 = this.ext ? this.E.barEnd : 0;
      const c1 = W + this.extR;
      r.rect(c0, ct, c1 - c0, 1, PAL.counterHi);
      r.rect(c0, ct + 1, c1 - c0, 3, PAL.counterTop);
      r.rect(c0, ct + 4, c1 - c0, 1, PAL.counterFront[1]);
      r.gradient(c0, ct + 5, c1 - c0, H - ct - 5, PAL.counterFront, 6);
      for (let x = 8 + 18 * Math.ceil((c0 - 8) / 18); x < c1; x += 18) r.rect(x, ct + 5, 1, H - ct - 5, PAL.counterFront[1]);
      r.rect(c0, H - 13, c1 - c0, 1, PAL.rail[1]);
      r.rect(c0, H - 12, c1 - c0, 1, PAL.rail[0]);
      for (let x = 20 + 60 * Math.ceil((c0 - 20) / 60); x < c1; x += 60) r.rect(x, H - 13, 2, 5, PAL.rail[0]);

      // Machine à espresso.
      const mx = 14;
      const mb = ct; // posée sur le comptoir
      const mw = 46;
      r.rect(mx, mb - 30, mw, 30, PAL.chrome[1]);
      r.rect(mx, mb - 30, mw, 2, PAL.chrome[3]);
      r.rect(mx, mb - 28, 2, 28, PAL.chrome[2]);
      r.rect(mx + mw - 2, mb - 28, 2, 28, PAL.chrome[0]);
      r.rect(mx + 3, mb - 25, mw - 6, 9, PAL.chrome[0]);
      r.rect(mx + 4, mb - 24, mw - 8, 1, PAL.chrome[2]);
      // Manomètre.
      for (let a = 0; a < 16; a++) r.set(Math.round(mx + 10 + Math.cos(a / 2.5) * 3), Math.round(mb - 21 + Math.sin(a / 2.5) * 3), PAL.chrome[3]);
      r.set(mx + 10, mb - 21, PAL.black);
      r.set(mx + 11, mb - 22, PAL.black);
      // Têtes de groupe et porte-filtres.
      for (const gx of [mx + 20, mx + 33]) {
        r.rect(gx - 3, mb - 16, 7, 3, PAL.chrome[2]);
        r.rect(gx - 1, mb - 13, 3, 2, PAL.chrome[0]);
        r.rect(gx + 3, mb - 15, 7, 2, PAL.black);
      }
      // Tasses sur le chauffe-tasses et sous les becs.
      for (let k = 0; k < 5; k++) r.rect(mx + 4 + k * 8, mb - 35, 6, 5, k % 2 ? PAL.cup : PAL.cupShade);
      for (const gx of [mx + 20, mx + 33]) {
        r.rect(gx - 2, mb - 6, 5, 4, PAL.cup);
        r.rect(gx - 1, mb - 6, 3, 1, PAL.coffee);
      }
      r.rect(mx + 2, mb - 2, mw - 4, 2, PAL.chrome[0]);
      this.machine = { x: mx, y: mb - 30, light: { x: mx + mw - 6, y: mb - 22 }, spouts: [mx + 20, mx + 33], spoutY: mb - 8 };
      r.rect(mx + mw - 7, mb - 23, 2, 2, C('#5a1010'));

      // Pile de soucoupes, sucrier et pot à lait.
      const px = mx + mw + 8;
      for (let k = 0; k < 5; k++) r.rect(px, ct - 2 - k * 2, 10, 1, k % 2 ? PAL.cup : PAL.cupShade);
      r.rect(px + 14, ct - 8, 7, 8, PAL.chrome[2]);
      r.rect(px + 14, ct - 8, 7, 1, PAL.chrome[3]);
      r.rect(px + 21, ct - 6, 2, 3, PAL.chrome[1]);

      // Petite radio rétro (d'où s'envolent des notes de musique).
      const rx = px + 30;
      r.rect(rx, ct - 10, 16, 10, C('#7a3428'));
      r.rect(rx, ct - 10, 16, 1, C('#a84a38'));
      for (let gy = ct - 8; gy < ct - 2; gy += 2) for (let gx = rx + 2; gx < rx + 9; gx += 2) r.set(gx, gy, C('#3a1810'));
      r.rect(rx + 11, ct - 8, 3, 3, C('#e8d8b0'));
      r.set(rx + 12, ct - 7, C('#3a1810'));
      r.rect(rx + 11, ct - 4, 3, 1, C('#e8d8b0'));
      for (let k = 0; k < 7; k++) r.set(rx + 13 + Math.round(k * 0.6), ct - 11 - k, PAL.chrome[2]);
      this.radio = { x: rx + 5, y: ct - 12 };

      // Cloche à gâteau sur la droite.
      const gx = W - 92;
      r.rect(gx, ct - 3, 30, 3, PAL.cupShade);
      r.rect(gx + 4, ct - 12, 22, 9, PAL.cake[0]);
      r.rect(gx + 4, ct - 12, 22, 2, PAL.cake[1]);
      r.rect(gx + 4, ct - 7, 22, 1, PAL.cake[2]);
      for (let x = gx + 6; x < gx + 25; x += 5) r.set(x, ct - 13, PAL.cake[1]);
      for (let y = ct - 26; y < ct - 3; y++) {
        const half = Math.round(14 * Math.sqrt(Math.max(0, 1 - ((y - (ct - 3)) / 23) ** 2)));
        r.tint(gx + 15 - half, y, PAL.glass, 0.7);
        r.tint(gx + 15 + half, y, PAL.glass, 0.7);
      }
      for (let x = gx + 4; x < gx + 27; x++) r.tint(x, ct - 26 + Math.round(((x - gx - 15) / 12) ** 2 * 3), PAL.glass, 0.6);
      r.rect(gx + 14, ct - 29, 3, 3, PAL.brass[1]);

      // Grande plante en pot (monstera) tout à droite.
      const pX = W - 30;
      r.rect(pX - 9, ct - 14, 19, 14, PAL.pot[0]);
      r.rect(pX - 9, ct - 14, 19, 2, PAL.pot[1]);
      for (let leafI = 0; leafI < 9; leafI++) {
        const ang = -Math.PI / 2 + (leafI - 4) * 0.33;
        const len = 18 + Math.floor(R() * 16);
        for (let k = 0; k < len; k++) {
          const bx = Math.round(pX + Math.cos(ang) * k);
          const by = Math.round(ct - 15 + Math.sin(ang) * k + (k * k) / 60);
          r.set(bx, by, PAL.leaf[0]);
          if (k > len * 0.45) {
            const half = Math.round(Math.sin(((k - len * 0.45) / (len * 0.55)) * Math.PI) * 5);
            for (let s = -half; s <= half; s++) {
              const shade = s < 0 ? PAL.leaf[2] : PAL.leaf[1];
              if (Math.abs(s) === half && hash(k, s, leafI) > 0.6) continue; // découpes de la feuille
              r.set(bx - Math.round(Math.sin(ang) * s), by + Math.round(Math.cos(ang) * s), shade);
            }
          }
        }
      }
    }

    // Le café du monde élargi (rien n'est peint dans l'écran : r.guard).
    paintInsideExt(r) {
      const { W, H, L, E } = this;
      const R = rng(4242);
      const ct = L.ct;
      const fl = E.fl;
      const xL = -this.extL;
      r.guard = W;
      const f = (this.extFrontRaster = this.raster());
      f.guard = W;

      // Sol de la salle : carreaux de ciment en damier, en perspective.
      const cream = C('#a8967c');
      const dark = C('#4e382c');
      for (let y = fl; y < H; y++) {
        const d = y - (fl - 62);
        const v = Math.floor(1300 / d);
        for (let x = xL; x < E.barEnd; x++) {
          const u = Math.floor(((x + 300) / d) * 8);
          let c = (u + v) & 1 ? cream : dark;
          if (hash(u, v, 3) > 0.85) c = mix(c, [0, 0, 0], 0.12); // carreaux un peu usés
          r.set(x, y, c);
        }
      }
      for (let x = xL; x < E.barEnd; x++) r.tint(x, fl, [0, 0, 0], 0.4);
      // Plinthe.
      r.rect(xL, fl - 4, E.barEnd - xL, 4, PAL.frameDark);
      r.rect(xL, fl - 4, E.barEnd - xL, 1, PAL.wainscotHi);

      // Bout du comptoir : un montant arrondi.
      const bx = E.barEnd;
      r.rect(bx - 3, ct - 1, 8, 2, PAL.counterHi);
      r.rect(bx - 3, ct + 1, 8, 3, PAL.counterTop);
      r.rect(bx - 2, ct + 4, 6, H - ct - 4, PAL.counterFront[1]);
      r.rect(bx - 2, ct + 4, 1, H - ct - 4, PAL.counterFront[0]);
      r.rect(bx - 2, H - 13, 6, 1, PAL.rail[1]);

      // Les étagères derrière le bar : sirops, tasses, bocaux de café.
      const bar0 = E.barEnd + 12;
      const bar1 = -10;
      const SYRUP = [C('#c43c3c'), C('#e0a03a'), C('#6a3a8a'), C('#3a8a5a'), C('#e8d8b0'), C('#8a4a2a')];
      for (const sy of [46, 76]) {
        for (let x = bar0 + 2; x < bar1 - 6; ) {
          const kind = R();
          if (kind < 0.45) {
            const n = 3 + Math.floor(R() * 3);
            for (let k = 0; k < n && x < bar1 - 6; k++) {
              const c = SYRUP[Math.floor(R() * SYRUP.length)];
              const bh = 10 + Math.floor(R() * 4);
              r.rect(x, sy - bh + 4, 4, bh - 4, mix(c, [20, 10, 10], 0.25));
              r.rect(x + 1, sy - bh, 2, 4, mix(c, [20, 10, 10], 0.4));
              r.rect(x, sy - bh + 6, 4, 3, PAL.cup);
              r.set(x + 1, sy - bh + 7, c);
              r.rect(x + 1, sy - bh + 4, 1, bh - 5, mix(c, [255, 255, 255], 0.35));
              x += 5;
            }
          } else if (kind < 0.7) {
            for (let k = 0; k < 3; k++) {
              r.rect(x, sy - 4 - k * 4, 6, 3, PAL.cup);
              r.rect(x, sy - 2 - k * 4, 6, 1, PAL.cupShade);
            }
            x += 8;
          } else if (kind < 0.88) {
            r.rect(x, sy - 11, 8, 11, PAL.jar[0]);
            r.rect(x + 1, sy - 7, 6, 6, PAL.beans);
            r.rect(x + 1, sy - 10, 1, 8, PAL.jar[1]);
            r.rect(x - 1, sy - 13, 10, 2, PAL.brass[1]);
            x += 10;
          } else {
            r.rect(x, sy - 6, 7, 6, PAL.pot[0]);
            r.rect(x, sy - 6, 7, 1, PAL.pot[1]);
            for (let k = 0; k < 22; k++) r.set(x + 3 + Math.round((R() - 0.5) * 9), sy - 7 - Math.floor(R() * 8), PAL.leaf[1 + Math.floor(R() * 3)]);
            x += 10;
          }
          x += 2 + Math.floor(R() * 3);
        }
        r.rect(bar0 - 2, sy, bar1 - bar0 + 4, 2, PAL.shelfHi);
        r.rect(bar0 - 2, sy + 2, bar1 - bar0 + 4, 2, PAL.shelf);
        r.rect(bar0 + 2, sy + 4, 2, 4, PAL.shelf);
        r.rect(bar1 - 4, sy + 4, 2, 4, PAL.shelf);
      }
      // Tasses suspendues sous l'étagère.
      for (let x = bar0 + 6; x < bar1 - 8; x += 9) {
        r.rect(x + 2, 80, 1, 3, PAL.brass[0]);
        r.rect(x, 83, 5, 4, x % 2 ? PAL.cup : C('#c4774a'));
        r.rect(x + 5, 84, 1, 2, x % 2 ? PAL.cupShade : C('#9a5234'));
      }
      // Enseigne néon « CAFE » (allumée à l'image) : tubes éteints sur une planche.
      const N = E.neon;
      const nw = N.text.length * 8 - 2;
      r.rect(N.x - 3, N.y - 3, nw + 6, 16, C('#1c1210'));
      r.rect(N.x - 3, N.y - 3, nw + 6, 1, C('#3a2418'));
      this.paintBigText(r, N.text, N.x, N.y, C('#4a2236'));
      // Affiche encadrée : une tasse fumante.
      const ax = -58;
      const ay = 94;
      r.rect(ax - 2, ay - 2, 26, 32, C('#6a432c'));
      r.rect(ax, ay, 22, 28, C('#e8d8b8'));
      r.rect(ax + 5, ay + 13, 11, 8, C('#c4463c'));
      r.rect(ax + 16, ay + 15, 2, 4, C('#c4463c'));
      r.rect(ax + 4, ay + 21, 14, 1, C('#8a2a24'));
      for (let k = 0; k < 3; k++) for (let j = 0; j < 7; j++) r.set(ax + 7 + k * 3 + (j % 2), ay + 4 + j, C('#a8988a'));
      r.rect(ax + 3, ay + 24, 16, 1, C('#5a3a2a'));

      // Sur le comptoir : caisse enregistreuse, pot à pourboires, vitrine, moulin à café.
      const rx = E.register;
      r.rect(rx, ct - 13, 22, 13, PAL.brass[1]);
      r.rect(rx, ct - 13, 22, 1, PAL.brass[2]);
      r.rect(rx + 2, ct - 11, 18, 4, PAL.brass[0]);
      for (let ky = ct - 6; ky < ct - 1; ky += 2) for (let kx = rx + 2; kx < rx + 19; kx += 3) r.rect(kx, ky, 2, 1, PAL.cup);
      r.rect(rx + 4, ct - 18, 12, 5, PAL.brass[0]);
      r.rect(rx + 5, ct - 17, 10, 3, C('#2a3a2a'));
      r.rect(rx + 6, ct - 16, 6, 1, C('#8ae08a'));
      const tj = E.barista.x + 20;
      r.rect(tj, ct - 8, 7, 8, PAL.glass);
      r.rect(tj + 1, ct - 4, 5, 3, PAL.brass[1]);
      r.rect(tj + 1, ct - 7, 1, 5, mix(PAL.glass, [255, 255, 255], 0.5));
      const V = E.vitrine;
      const vy = ct - 22;
      r.rect(V.x0, ct - 3, V.x1 - V.x0, 3, PAL.shelf);
      r.rect(V.x0, ct - 3, V.x1 - V.x0, 1, PAL.shelfHi);
      r.rect(V.x0 + 1, vy, V.x1 - V.x0 - 2, ct - 3 - vy, C('#2a1a14'));
      r.rect(V.x0 + 2, vy + 9, V.x1 - V.x0 - 4, 1, C('#c8c0b4'));
      // Rangée du haut : croissants et pains au chocolat ; du bas : tartes et macarons.
      for (let x = V.x0 + 4; x < V.x1 - 7; x += 7) {
        const k = Math.floor((x - V.x0) / 7) % 3;
        if (k === 2) {
          r.rect(x, vy + 6, 5, 3, C('#b86a2a'));
          r.rect(x + 1, vy + 6, 3, 1, C('#5a2a14'));
        } else {
          r.rect(x + 1, vy + 5, 4, 2, C('#e0a04a'));
          r.rect(x, vy + 7, 6, 2, C('#c8823a'));
          r.set(x + 2, vy + 6, C('#f2c87a'));
        }
      }
      const MAC = [C('#f2a0b4'), C('#a8d8a0'), C('#e8d070'), C('#b8a0e0')];
      for (let x = V.x0 + 4; x < V.x1 - 6; x += 6) {
        if (((x - V.x0) / 6) % 2 < 1) {
          r.rect(x, vy + 13, 5, 3, C('#e8c890'));
          r.rect(x + 1, vy + 12, 3, 2, C('#c43c4c'));
        } else {
          const c = MAC[Math.floor(x / 6) & 3];
          r.rect(x, vy + 12, 4, 2, c);
          r.rect(x, vy + 14, 4, 1, PAL.cup);
          r.rect(x, vy + 15, 4, 2, c);
        }
      }
      // Le verre de la vitrine : bords et reflets.
      for (let y = vy - 2; y < ct - 3; y++) {
        r.tint(V.x0, y, PAL.glass, 0.7);
        r.tint(V.x1 - 1, y, PAL.glass, 0.7);
      }
      r.rect(V.x0, vy - 2, V.x1 - V.x0, 1, mix(PAL.glass, [255, 255, 255], 0.3));
      for (let x = V.x0 + 1; x < V.x1 - 1; x++) for (let y = vy - 1; y < ct - 3; y++) if ((x + y) % 23 === 0 || (x + y) % 23 === 1) r.tint(x, y, [255, 255, 255], 0.18);
      // Moulin à café.
      const gx = -24;
      r.rect(gx, ct - 14, 10, 14, PAL.black);
      r.rect(gx, ct - 14, 10, 1, PAL.chrome[0]);
      r.rect(gx + 2, ct - 4, 6, 3, PAL.chrome[1]);
      for (let k = 0; k < 9; k++) r.rect(gx + 1 + Math.round(k * 0.2), ct - 15 - k, 8 - Math.round(k * 0.4), 1, k > 2 ? PAL.beans : PAL.chrome[2]);
      r.rect(gx + 1, ct - 25, 8, 1, PAL.chrome[3]);

      // Grande plante au bout du comptoir.
      this.paintFloorPlant(r, R, E.plant.x, fl + 6);

      // La deuxième fenêtre (avec sa guirlande) et la banquette dessous.
      const w = E.win;
      const ww = w.x1 - w.x0;
      r.clear(w.x0, w.y0, ww, w.y1 - w.y0);
      r.rect(w.x0 - 5, w.y0 - 5, ww + 10, 5, PAL.frameDark);
      r.rect(w.x0 - 5, w.y0, 5, w.y1 - w.y0, PAL.frameDark);
      r.rect(w.x1, w.y0, 5, w.y1 - w.y0, PAL.frameDark);
      r.rect(w.x0 - 1, w.y0, 1, w.y1 - w.y0, PAL.frameLit);
      r.rect(w.x0 - 5, w.y0 - 5, ww + 10, 1, PAL.frameLit);
      for (const mx of [Math.round(w.x0 + ww / 2)]) {
        r.rect(mx - 1, w.y0, 3, w.y1 - w.y0, PAL.frameDark);
        r.rect(mx - 1, w.y0, 1, w.y1 - w.y0, PAL.frameLit);
      }
      r.rect(w.x0, w.y0 + 22, ww, 3, PAL.frameDark);
      r.rect(w.x0, w.y0 + 22, ww, 1, PAL.frameLit);
      r.rect(w.x0 - 8, w.y1, ww + 16, 2, PAL.ledgeHi);
      r.rect(w.x0 - 8, w.y1 + 2, ww + 16, 2, PAL.ledgeTop);
      r.rect(w.x0 - 8, w.y1 + 4, ww + 16, 2, PAL.ledgeFront);
      // Petits pots sur le rebord.
      for (const px of [w.x0 + 6, w.x1 - 14]) {
        r.rect(px, w.y1 - 6, 7, 6, PAL.pot[0]);
        r.rect(px, w.y1 - 6, 7, 1, PAL.pot[1]);
        for (let k = 0; k < 24; k++) r.set(px + 3 + Math.round((R() - 0.5) * 9), w.y1 - 7 - Math.floor(R() * 8), PAL.leaf[1 + Math.floor(R() * 3)]);
      }
      E.garland = [];
      for (let x = w.x0 + 2; x < w.x1 - 2; x++) {
        const u = (x - w.x0) / ww;
        const y = Math.round(w.y0 + 3 + Math.sin(u * Math.PI * 2) ** 2 * 6);
        r.set(x, y, PAL.cord);
        if ((x - w.x0) % 9 === 4) E.garland.push({ x, y: y + 1, c: BULBS[E.garland.length % BULBS.length], p: R() * 6 });
      }
      // Banquette en cuir capitonné.
      const sy = E.seatY;
      const leather = [C('#5a1e22'), C('#7a2a2c'), C('#9a3a36')];
      const b0 = w.x0 - 4;
      const b1 = w.x1 + 4;
      r.rect(b0, w.y1 + 6, b1 - b0, sy - w.y1 - 6, leather[1]);
      for (let y = w.y1 + 6; y < sy; y++) for (let x = b0; x < b1; x++) if ((x - b0) % 10 === 5 && (y - w.y1) % 6 === 3) r.set(x, y, leather[0]);
      for (let x = b0 + 10; x < b1; x += 10) r.rect(x, w.y1 + 6, 1, sy - w.y1 - 6, leather[0]);
      r.rect(b0, w.y1 + 6, b1 - b0, 1, leather[2]);
      r.rect(b0, sy, b1 - b0, 4, leather[2]);
      r.rect(b0, sy + 3, b1 - b0, 1, leather[0]);
      r.rect(b0, sy + 4, b1 - b0, fl - sy - 4, PAL.wainscotHi);
      r.rect(b0, sy + 4, b1 - b0, 1, PAL.frameDark);
      r.rect(b0 - 3, w.y1 + 6, 3, fl - w.y1 - 6, PAL.ledgeFront);
      r.rect(b1, w.y1 + 6, 3, fl - w.y1 - 6, PAL.ledgeFront);
      // Table de bistrot devant le couple (dessus en marbre), sur la toile de devant.
      const T = E.table;
      this.paintBistroTable(f, T.x, T.y, 20, fl + 20);
      f.rect(T.x - 14, T.y - 3, 7, 3, PAL.cup);
      f.rect(T.x - 13, T.y - 3, 5, 1, PAL.coffee);
      f.rect(T.x + 8, T.y - 3, 7, 3, PAL.cup);
      f.rect(T.x + 9, T.y - 3, 5, 1, PAL.coffee);
      f.rect(T.x - 4, T.y - 1, 9, 1, PAL.cupShade);
      f.rect(T.x - 3, T.y - 3, 7, 2, C('#e0a04a'));
      f.set(T.x, T.y - 3, C('#f2c87a'));
      E.cups = [
        { x: T.x - 11, y: T.y - 4 },
        { x: T.x + 11, y: T.y - 4 },
      ];

      // Fauteuil de lecture sous le lampadaire.
      const ch = E.chair;
      const velvet = [C('#1e3a32'), C('#2c5446'), C('#3e7058')];
      const cy = ch.seatY;
      for (let y = cy - 28; y < fl + 4; y++) {
        const hw = y < cy - 24 ? 13 - (cy - 24 - y) : 14;
        for (let x = -hw; x <= hw; x++) r.set(ch.x + x, y, Math.abs(x) > hw - 2 ? velvet[0] : y < cy - 22 ? velvet[2] : velvet[1]);
      }
      for (let y = cy - 20; y < cy; y += 5) for (let x = -9; x <= 9; x += 6) r.set(ch.x + x, y, velvet[0]);
      r.rect(ch.x - 13, cy, 27, 3, velvet[2]);
      // Accoudoirs et pieds, devant la lectrice.
      for (const side of [-1, 1]) {
        const ax0 = side < 0 ? ch.x - 17 : ch.x + 11;
        f.rect(ax0, cy - 9, 7, fl - cy + 9, velvet[1]);
        f.rect(ax0, cy - 9, 7, 2, velvet[2]);
        f.rect(ax0 + (side < 0 ? 0 : 6), cy - 7, 1, fl - cy + 7, velvet[0]);
        f.rect(ax0 + 2, fl, 2, 4, PAL.frameDark);
      }
      f.rect(ch.x - 10, cy + 6, 21, fl - cy - 6, velvet[0]);
      f.rect(ch.x - 10, cy + 6, 21, 1, velvet[2]);
      // Petit guéridon avec une tasse.
      this.paintBistroTable(f, ch.x + 28, cy + 2, 9, fl + 10);
      f.rect(ch.x + 26, cy - 1, 5, 3, PAL.cup);
      E.cups.push({ x: ch.x + 28, y: cy - 2 });

      // Lampadaire.
      const fp = E.floorLamp;
      r.rect(fp.x, fp.top + 10, 1, fl - fp.top - 8, PAL.brass[0]);
      r.rect(fp.x - 4, fl + 1, 9, 2, PAL.brass[0]);
      for (let k = 0; k < 10; k++) {
        const half = 4 + Math.floor(k * 0.6);
        r.rect(fp.x - half, fp.top + k, half * 2 + 1, 1, k < 2 ? C('#f2d8a0') : C('#e0a860'));
      }
      r.rect(fp.x - 9, fp.top + 9, 19, 1, C('#b8783a'));

      // Bibliothèque.
      const S = E.shelf;
      if (S.x1 - S.x0 > 20) {
        const top = 40;
        r.rect(S.x0, top, S.x1 - S.x0, fl - top, C('#24150f'));
        for (let sy2 = top + 26; sy2 < fl - 4; sy2 += 26) {
          for (let x = S.x0 + 3; x < S.x1 - 4; ) {
            if (R() < 0.75) {
              const n = 3 + Math.floor(R() * 5);
              for (let k = 0; k < n && x < S.x1 - 4; k++) {
                const bw = 2 + Math.floor(R() * 2);
                const bh = 13 + Math.floor(R() * 8);
                const c = PAL.books[Math.floor(R() * PAL.books.length)];
                r.rect(x, sy2 - bh, bw, bh, c);
                r.rect(x, sy2 - bh, bw, 1, mix(c, [255, 255, 255], 0.3));
                r.rect(x + bw - 1, sy2 - bh, 1, bh, mix(c, [0, 0, 0], 0.3));
                x += bw;
              }
            } else {
              r.rect(x, sy2 - 6, 7, 6, PAL.pot[0]);
              r.rect(x, sy2 - 6, 7, 1, PAL.pot[1]);
              for (let k = 0; k < 10; k++) {
                r.set(x + 1 + Math.floor(R() * 5), sy2 - 1 + k, PAL.leaf[1 + (k % 3)]);
                r.set(x + 3 + Math.round((R() - 0.5) * 8), sy2 - 7 - Math.floor(R() * 6), PAL.leaf[2]);
              }
              x += 9;
            }
            x += 1 + Math.floor(R() * 3);
          }
          r.rect(S.x0, sy2, S.x1 - S.x0, 2, PAL.shelfHi);
          r.rect(S.x0, sy2 + 2, S.x1 - S.x0, 1, PAL.shelf);
        }
        r.rect(S.x0 - 3, top - 3, 3, fl - top + 3, PAL.shelf);
        r.rect(S.x1, top - 3, 3, fl - top + 3, PAL.frameDark);
        r.rect(S.x0 - 3, top - 4, S.x1 - S.x0 + 6, 3, PAL.shelfHi);
        // Une plante sur le dessus.
        r.rect(S.x0 + 6, top - 12, 10, 8, PAL.pot[0]);
        r.rect(S.x0 + 6, top - 12, 10, 1, PAL.pot[1]);
        for (let k = 0; k < 50; k++) r.set(S.x0 + 11 + Math.round((R() - 0.5) * 18), top - 13 - Math.floor(R() * 12), PAL.leaf[1 + Math.floor(R() * 3)]);
      }

      // La porte d'entrée : vitrée en haut, imposte, clochette, panneau « OUVERT ».
      const d = E.door;
      const dg = E.doorGlass;
      const tr = E.transom;
      r.rect(d.x0 - 5, d.top - 26, d.w + 10, fl - d.top + 26, PAL.frameDark);
      r.rect(d.x0 - 5, d.top - 26, d.w + 10, 1, PAL.frameLit);
      r.rect(d.x0, d.top, d.w, fl - d.top, C('#5a3626'));
      r.rect(d.x0, d.top, 1, fl - d.top, C('#7a4a32'));
      r.rect(d.x0 + d.w - 1, d.top, 1, fl - d.top, C('#3a2018'));
      r.rect(d.x0 + 6, dg.y1 + 8, d.w - 12, fl - dg.y1 - 16, C('#4a2c1e'));
      r.rect(d.x0 + 6, dg.y1 + 8, d.w - 12, 1, C('#7a4a32'));
      r.rect(d.x0 + 6, dg.y1 + 8, 1, fl - dg.y1 - 16, C('#7a4a32'));
      r.clear(dg.x0, dg.y0, dg.x1 - dg.x0, dg.y1 - dg.y0);
      r.clear(tr.x0, tr.y0, tr.x1 - tr.x0, tr.y1 - tr.y0);
      r.rect(Math.round((tr.x0 + tr.x1) / 2), tr.y0, 1, tr.y1 - tr.y0, PAL.frameDark);
      r.rect(d.x0 + d.w - 7, dg.y1 + 2, 2, 5, PAL.brass[2]);
      r.rect(d.x0 + d.w - 8, dg.y1 + 4, 4, 1, PAL.brass[1]);
      // Clochette au-dessus de la porte.
      r.rect(d.x0 + d.w - 6, d.top - 4, 1, 3, PAL.brass[0]);
      r.rect(d.x0 + d.w - 7, d.top - 1, 3, 3, PAL.brass[2]);
      // Paillasson.
      r.rect(d.x0 - 2, fl + 2, d.w + 4, 4, C('#5a4a2a'));
      for (let x = d.x0; x < d.x0 + d.w + 2; x += 3) r.rect(x, fl + 2, 1, 4, C('#4a3a20'));
      // Porte-parapluies et parapluie (qui goutte quand il pleut).
      const ux = d.x0 + d.w + 10;
      if (ux + 10 < S.x0) {
        r.rect(ux, fl - 16, 9, 18, C('#3a4a5a'));
        r.rect(ux, fl - 16, 9, 1, C('#5a6a7a'));
        r.rect(ux + 3, fl - 34, 1, 18, C('#2a1a14'));
        for (let k = 0; k < 12; k++) r.rect(ux + 3 - Math.floor(k / 4), fl - 32 + k, 2 + Math.floor(k / 3), 1, C('#c4463c'));
        r.rect(ux + 6, fl - 30, 1, 14, C('#2a1a14'));
        r.rect(ux + 5, fl - 31, 3, 1, C('#2a1a14'));
        E.drip = { x: ux + 3, y: fl - 18 };
      }
      // Porte-manteau entre la porte et le mur : un manteau et une écharpe.
      const hx = d.x0 - 14;
      if (hx > xL + 6) {
        r.rect(hx, d.top - 10, 1, fl - d.top + 10, PAL.frameDark);
        r.rect(hx - 4, d.top - 10, 9, 1, PAL.brass[1]);
        r.rect(hx - 5, d.top - 9, 6, 26, C('#3a4a6a'));
        r.rect(hx - 5, d.top - 9, 1, 26, C('#4a5a7a'));
        r.rect(hx + 1, d.top - 8, 3, 18, C('#d8a548'));
      }

      // Lampes suspendues de la salle.
      for (const l of E.lamps) {
        r.rect(l.x, 0, 1, l.y - 4, PAL.cord);
        for (let k = 0; k < 6; k++) {
          const half = 2 + k;
          r.rect(l.x - half, l.y - 6 + k, half * 2 + 1, 1, k < 2 ? PAL.brass[2] : PAL.brass[1]);
          r.set(l.x - half, l.y - 6 + k, PAL.brass[0]);
          r.set(l.x + half, l.y - 6 + k, PAL.brass[0]);
        }
      }

      // À droite de l'écran : un cadre et une applique.
      if (E.sconce) {
        const s = E.sconce;
        r.rect(s.x - 1, s.y - 2, 3, 8, PAL.brass[0]);
        r.rect(s.x - 4, s.y - 8, 9, 6, C('#f2d8a0'));
        r.rect(s.x - 4, s.y - 8, 9, 1, C('#fff0c8'));
        const px = W + 16;
        r.rect(px - 2, 30, 24, 30, C('#6a432c'));
        r.gradient(px, 32, 20, 26, [C('#2a3460'), C('#c4685a'), C('#f2c27a')], 5);
        r.rect(px, 50, 20, 8, C('#2a1a24'));
      }
      r.guard = 0;
      f.guard = 0;
    }

    // Texte en grosses lettres (police 3 × 5, chaque point fait 2 × 2).
    paintBigText(r, text, x, y, c) {
      let cx = x;
      for (const ch of text) {
        const g = B.PXC.FONT[ch] || B.PXC.FONT[' '];
        g.forEach((row, ry) => {
          for (let rx = 0; rx < 3; rx++) if (row[rx] === '1') r.rect(cx + rx * 2, y + ry * 2, 2, 2, c);
        });
        cx += 8;
      }
    }

    paintBistroTable(r, x, y, half, foot) {
      r.rect(x - half, y, half * 2 + 1, 2, C('#e8e2d6'));
      r.rect(x - half, y + 2, half * 2 + 1, 1, C('#a89e90'));
      r.rect(x - 1, y + 3, 3, foot - y - 4, PAL.black);
      r.rect(x, y + 3, 1, foot - y - 4, C('#3a3a40'));
      r.rect(x - 7, foot - 1, 15, 2, PAL.black);
    }

    paintFloorPlant(r, R, x, ground) {
      r.rect(x - 8, ground - 16, 17, 16, PAL.pot[0]);
      r.rect(x - 8, ground - 16, 17, 2, PAL.pot[1]);
      r.rect(x - 7, ground - 2, 15, 2, mix(PAL.pot[0], [0, 0, 0], 0.3));
      r.rect(x, ground - 50, 1, 34, C('#3a2418'));
      r.rect(x - 1, ground - 40, 1, 12, C('#3a2418'));
      r.rect(x + 1, ground - 46, 1, 10, C('#3a2418'));
      // Ficus : grosses feuilles en grappes.
      for (let k = 0; k < 34; k++) {
        const a = R() * Math.PI * 2;
        const d = Math.sqrt(R());
        const cx = Math.round(x + Math.cos(a) * d * 15);
        const cy = Math.round(ground - 60 + Math.sin(a) * d * 17);
        for (let j = -2; j <= 2; j++) for (let i = -3; i <= 3; i++) if (i * i + j * j * 2 < 10) r.set(cx + i, cy + j, j < 0 ? PAL.leaf[3] : i < 0 ? PAL.leaf[2] : PAL.leaf[1]);
        r.set(cx + 3, cy + 1, PAL.leaf[0]);
      }
    }

    // Halos des ampoules (ajoutés en mode « lumière » à chaque image).
    paintHalo() {
      const { W, H, L } = this;
      const r = this.raster();
      const halos = L.lamps.map((l) => ({ x: l.x, y: l.y + 1, r: 18, c: [255, 190, 110] }));
      halos.push({ x: L.streetLampX + 5, y: L.wy0 + 24, r: 12, c: [255, 220, 150] });
      // Monde élargi : ses lampes (assez loin de l'écran pour ne jamais l'atteindre).
      if (this.ext) {
        const E = this.E;
        for (const l of E.lamps) halos.push({ x: l.x, y: l.y + 1, r: 18, c: [255, 190, 110] });
        halos.push({ x: E.floorLamp.x, y: E.floorLamp.top + 6, r: 16, c: [255, 180, 100] });
        if (E.sconce) halos.push({ x: E.sconce.x, y: E.sconce.y, r: 14, c: [255, 190, 110] });
      }
      for (let y = 0; y < H; y++) {
        for (let x = -this.extL; x < W + this.extR; x++) {
          let rgb = [0, 0, 0];
          for (const h of halos) {
            const d = Math.hypot(x - h.x, (y - h.y) * 1.2);
            const q = Math.floor(Math.max(0, 1 - d / h.r) ** 1.6 * 5 + bayer(x, y) * 0.9) / 5;
            rgb = [rgb[0] + h.c[0] * q * 0.55, rgb[1] + h.c[1] * q * 0.55, rgb[2] + h.c[2] * q * 0.55];
          }
          if (rgb[0] + rgb[1] + rgb[2] > 2) r.set(x, y, rgb);
        }
      }
      return r.toCanvas();
    }

    /* ================= Les gens du monde élargi ================= */
    // Tous éclairés par les mêmes lampes que la salle. Leur vie utilise son propre hasard
    // (this.xr) : celle du fond d'écran reste exactement la même.
    initExt() {
      const { L, E } = this;
      const P = B.People;
      this.xr = rng(31337);
      const bake = (sh, x, y) => {
        const lights = [...L.lamps.map((l) => ({ x: l.x, y: l.y + 6, r: 46, k: 0.85, sy: 0.8 })), ...E.lights].map((l) => ({ ...l, x: l.x - x, y: l.y - y }));
        const out = P.bake(sh, (r) => applyLight(r, lights, [0.62, 0.6, 0.7], [0.95, 0.72, 0.45]));
        out.x = x;
        out.y = y;
        return out;
      };
      const place = (sh, ax, ay) => bake(sh, Math.round(ax - sh.ax), Math.round(ay - sh.ay));
      // Le barista, derrière le comptoir : essuie une tasse, sert, lève les yeux, se tourne
      // vers les étagères.
      const hh = L.readerHH;
      const bl = { seed: 21, body: 'm', skin: '#c8906a', hairColor: '#2a1c18', hairStyle: 'short', top: '#2e4a3e', topStyle: 'tee', bottom: '#2a2a34', shoes: '#2a2228', props: { mug: '#ece4d8' } };
      const st = (x = {}) => {
        const p = P.stand({ br: x.br || 0, turn: x.turn || 0, armL: x.armL, armR: x.armR });
        if (x.nod != null) p.head.nod = x.nod;
        if (x.props) p.props = x.props;
        if (x.view != null) p.opt = { view: x.view };
        return p;
      };
      const cupL = P.mugProp('L', { off: [0.05, 0.05, 0] });
      const shB = P.sheet(
        bl,
        {
          idle: [st(), st({ br: 1 })],
          wipe: [
            st({ armL: { hand: [0.42, 2.55, 0.08] }, armR: { hand: [0.46, 2.66, -0.1] }, props: cupL, nod: 0.28 }),
            st({ armL: { hand: [0.42, 2.55, 0.08] }, armR: { hand: [0.5, 2.5, 0.02] }, props: cupL, nod: 0.28 }),
          ],
          look: st({ turn: 0.55, nod: -0.02, armL: { hand: [0.42, 2.5, 0.12] }, armR: { hand: [0.44, 2.5, -0.12] } }),
          reach: st({ armR: { hand: [-0.3, 3.75, -0.3] }, nod: -0.3, view: -Math.PI / 2 + 0.35 }),
        },
        { hh, view: 1.2 },
      );
      this.barista = place(shB, E.barista.x, E.barista.ground);
      this.baristaS = { pose: 'wipe', until: 6, next: 'look' };
      // Le couple sur la banquette : elle lit, il boit son café et lui parle.
      const ch = 11;
      const lookA = { seed: 31, body: 'f', skin: '#e8b48e', hairColor: '#8a4a2a', hairStyle: 'long', top: '#4a8a8a', topStyle: 'sweater', bottom: '#3a3448', shoes: '#4a2c22', scarf: '#e8c547', props: { book: '#c4463c' } };
      const lookB = { seed: 32, body: 'm', skin: '#b07a56', hairColor: '#1e1a22', hairStyle: 'curly', top: '#d8a03a', topStyle: 'jacket', bottom: '#2e3048', shoes: '#e8e0d8', props: { mug: '#ece4d8' } };
      const seatH = (E.fl + 1 - E.seatY) / ch;
      const shA = P.heroes.bench(lookA, { hh: ch, seatH, view: E.couple[0].view });
      const base = (x = {}) => {
        const p = P.seated({ seatH, lean: 0.12, footF: 0.75, head: { nod: x.nod == null ? 0.12 : x.nod, turn: x.turn || 0, tilt: 0.04 } });
        p.armR = { hand: x.handR || [0.62, 0.62, -0.22] };
        p.armL = { hand: x.handL || [0.62, 0.6, 0.24] };
        if (x.mug) p.props = P.mugProp(x.mug, { off: [0.08, 0.05, 0] });
        return p;
      };
      const shBb = P.sheet(
        lookB,
        {
          idle: [base(), base({ nod: 0.18 })],
          sip: base({ handR: [0.5, 1.72, -0.1], mug: 'R', nod: -0.05 }),
          talk: [base({ handL: [0.75, 1.2, 0.3], turn: 0.25, nod: 0.05 }), base({ handL: [0.8, 1.32, 0.24], turn: 0.25, nod: 0.02 })],
        },
        { hh: ch, view: E.couple[1].view },
      );
      this.coupleA = place(shA, E.couple[0].x, E.seatY);
      this.coupleB = place(shBb, E.couple[1].x, E.seatY);
      this.coupleS = { a: 'read', aUntil: 5, b: 'idle', bUntil: 3 };
      // La lectrice du fauteuil.
      const lookC = { seed: 41, body: 'f', skin: '#d49a74', hairColor: '#c8a060', hairStyle: 'bob', top: '#8a6aa8', topStyle: 'sweater', bottom: '#2a3a5a', shoes: '#c84a3a', props: { book: '#3e6e8e' } };
      const shC = P.heroes.bench(lookC, { hh: L.readerHH, seatH: (E.fl + 2 - E.chair.seatY) / L.readerHH, view: 0.9, cross: true });
      this.chairReader = place(shC, E.chair.x - 1, E.chair.seatY);
      this.chairS = { pose: 'read', until: 7 };
      // Dehors : passants (mêmes tenues que ceux de la vitre), pluie, gouttes sur la vitre.
      this.extWalkers = [];
      this.extNextWalker = 0.5;
      const R = this.xr;
      const w = E.win;
      this.extRain = Array.from({ length: 70 }, () => this.newExtDrop(true));
      this.extGlass = Array.from({ length: 16 }, () => ({ x: Math.round(w.x0 + 2 + R() * (w.x1 - w.x0 - 4)), y: w.y0 + R() * (w.y1 - w.y0), rest: R() * 6, v: 0, trail: [] }));
      this.extSteam = [];
      this.extDrops = [];
      this.neon2 = { on: true, flick: 0 };
    }

    newExtDrop(initial) {
      const { L, E } = this;
      const R = this.xr;
      const x0 = E.door.x0 - 30;
      const x1 = E.win.x1 + 30;
      return { x: x0 + R() * (x1 - x0), y: initial ? L.wy0 + R() * (E.fl - L.wy0) : L.wy0 - R() * 20, v: 150 + R() * 70, stop: L.street0 + R() * (L.wy1 + 20 - L.street0) };
    }

    updateExt(dt) {
      const { E } = this;
      const R = this.xr;
      const t = this.t;
      // Passants de la rue (vus par la deuxième fenêtre et la porte).
      this.extNextWalker -= dt;
      if (this.extNextWalker <= 0 && this.wsets) {
        const dir = R() < 0.5 ? 1 : -1;
        const ws = this.wsets;
        const roll = R();
        const pool = this.mood.wet ? ws.umbrella : ws.dry;
        const set = roll < 0.65 ? pool[Math.floor(R() * pool.length)] : roll < 0.82 ? ws.kid : ws.dog;
        const speed = roll >= 0.65 && roll < 0.82 ? 12 + R() * 3 : 9 + R() * 5;
        const span = set.w + (set.dogW || 0) + 6;
        this.extWalkers.push({ set, dir, speed, x: dir > 0 ? E.door.x0 - 40 - span : E.win.x1 + 30, t: R() });
        this.extNextWalker = 2.5 + R() * 5;
      }
      for (const w of this.extWalkers) {
        w.x += w.dir * w.speed * dt;
        w.t += dt;
      }
      this.extWalkers = this.extWalkers.filter((w) => w.x > E.door.x0 - 120 && w.x < E.win.x1 + 60);
      // Pluie dehors, gouttes sur la vitre.
      if (this.raining) {
        for (const d of this.extRain) {
          d.y += d.v * dt;
          d.x -= d.v * dt * 0.12;
          if (d.y >= d.stop) Object.assign(d, this.newExtDrop(false));
        }
      }
      if (this.wetGlass) {
        const w = E.win;
        for (const g of this.extGlass) {
          for (const p of g.trail) p.age += dt;
          g.trail = g.trail.filter((p) => p.age < 3);
          if (g.rest > 0) {
            g.rest -= dt;
            continue;
          }
          g.v = Math.min(18, g.v + 30 * dt);
          const oy = Math.round(g.y);
          g.y += g.v * dt;
          if (Math.round(g.y) !== oy) g.trail.push({ x: g.x, y: oy, age: 0 });
          if (R() < dt * 0.8) {
            g.rest = R() * 2;
            g.v = 0;
          }
          if (g.y > w.y1 - 2) Object.assign(g, { x: Math.round(w.x0 + 2 + R() * (w.x1 - w.x0 - 4)), y: w.y0 + R() * 20, rest: R() * 6, v: 0 });
        }
        // Le parapluie mouillé goutte.
        if (E.drip && R() < dt * 0.7) this.extDrops.push({ x: E.drip.x + Math.floor(R() * 3), y: E.drip.y, v: 0 });
      }
      for (const d of this.extDrops) {
        d.v += 120 * dt;
        d.y += d.v * dt;
      }
      this.extDrops = this.extDrops.filter((d) => d.y < E.fl + 2);
      // Le barista.
      const b = this.baristaS;
      if (t > b.until) {
        const r = R();
        b.pose = r < 0.45 ? 'wipe' : r < 0.65 ? 'look' : r < 0.85 ? 'idle' : 'reach';
        b.until = t + (b.pose === 'reach' ? 2.2 : b.pose === 'wipe' ? 5 + R() * 4 : 2.5 + R() * 3);
      }
      // Le couple : elle lit et lève les yeux ; il boit et lui parle.
      const c = this.coupleS;
      if (t > c.aUntil) {
        const r = R();
        c.a = c.a !== 'read' ? 'read' : r < 0.4 ? 'page' : 'look';
        c.aUntil = t + (c.a === 'read' ? 4 + R() * 6 : c.a === 'page' ? 0.6 : 2.5 + R() * 2);
      }
      if (t > c.bUntil) {
        const r = R();
        c.b = c.a === 'look' && r < 0.7 ? 'talk' : r < 0.3 ? 'sip' : r < 0.6 ? 'talk' : 'idle';
        c.bUntil = t + (c.b === 'sip' ? 2.4 : 2 + R() * 3);
      }
      const s = this.chairS;
      if (t > s.until) {
        s.pose = s.pose !== 'read' ? 'read' : R() < 0.6 ? 'page' : 'look';
        s.until = t + (s.pose === 'read' ? 6 + R() * 6 : s.pose === 'page' ? 0.6 : 2.5);
      }
      // Vapeur des tasses.
      for (const cp of E.cups) if (R() < dt * 2.2) this.extSteam.push({ x: cp.x + R() * 2, y: cp.y, age: 0, life: 1.8 + R() });
      for (const p of this.extSteam) {
        p.age += dt;
        p.y -= dt * 6;
        p.x += Math.sin(p.age * 3 + p.y) * dt * 3;
      }
      this.extSteam = this.extSteam.filter((p) => p.age < p.life);
      // Le néon « CAFE » grésille parfois.
      const n = this.neon2;
      if (n.flick > 0) n.flick -= dt;
      else if (R() < dt * 0.1) n.flick = 0.5;
      n.on = n.flick > 0 ? Math.sin(t * 47) > 0 : true;
    }

    // Dehors, par les fenêtres du monde élargi (dans la découpe des vitres).
    drawExtOutside(g) {
      const { L, E } = this;
      const walkers = [...this.extWalkers].sort((a, b) => a.speed - b.speed);
      for (const w of walkers) B.People.drawWalker(g, w.set, Math.round(w.x), L.walkY, w.dir, w.t);
      if (this.raining) {
        g.fillStyle = 'rgba(170,190,230,0.55)';
        for (const d of this.extRain) g.fillRect(Math.round(d.x), Math.round(d.y), 1, 3);
      }
      // Lucioles autour des arbres de la rue (nuit d'été).
      if (this.mood.fireflies && this.worldTrees) {
        const t = this.t;
        for (const tc of this.worldTrees) {
          for (let k = 0; k < 10; k++) {
            const a = t * (0.3 + k * 0.05) + k * 2.7 + tc.x;
            if (Math.sin(t * 2 + k * 1.9 + tc.x) <= 0.2) continue;
            const fx = Math.round(tc.x + Math.cos(a) * (18 + (k % 4) * 6));
            const fy = Math.round(tc.y + 18 + Math.sin(a * 1.3) * 10);
            g.fillStyle = 'rgba(230,255,140,0.9)';
            g.fillRect(fx, fy, 1, 1);
            g.fillStyle = 'rgba(230,255,140,0.25)';
            g.fillRect(fx - 1, fy - 1, 3, 3);
          }
        }
      }
      for (const w of E.windows) {
        // Reflets sur le verre.
        g.fillStyle = 'rgba(255,255,255,0.05)';
        for (let k = 0; k < 2; k++) {
          const bx = w.x0 + 10 + k * Math.round((w.x1 - w.x0) * 0.5);
          for (let y = w.y0; y < w.y1; y++) {
            const x = Math.round(bx + (w.y1 - y) * 0.5);
            if (x < w.x1) g.fillRect(x, y, 2 + k, 1);
          }
        }
        if (this.flash > 0.05) {
          g.fillStyle = `rgba(220,230,255,${this.flash * 0.45})`;
          g.fillRect(w.x0, w.y0, w.x1 - w.x0, w.y1 - w.y0);
        }
        if (this.mood.snow) {
          const n = Math.min(14, Math.round((w.y1 - w.y0) / 3));
          for (let k = 0; k < n; k++) {
            for (let j = 0; j < n - k; j++) {
              if ((k + j) % 2 && hash(k, j, 1) > 0.35) continue;
              g.fillStyle = `rgba(225,235,250,${0.28 * (1 - (k + j) / n)})`;
              g.fillRect(w.x0 + k, w.y1 - 1 - j, 1, 1);
              g.fillRect(w.x1 - 1 - k, w.y1 - 1 - j, 1, 1);
            }
          }
        }
      }
      if (this.wetGlass) {
        for (const d of this.extGlass) {
          for (const p of d.trail) {
            g.fillStyle = `rgba(190,210,240,${0.22 * (1 - p.age / 3)})`;
            g.fillRect(p.x, p.y, 1, 1);
          }
          g.fillStyle = 'rgba(220,232,250,0.85)';
          g.fillRect(d.x, Math.round(d.y), 1, 1);
          g.fillStyle = 'rgba(40,50,80,0.6)';
          g.fillRect(d.x, Math.round(d.y) + 1, 1, 1);
        }
      }
    }

    drawExtInside(g) {
      const { L, E } = this;
      const t = this.t;
      g.fillStyle = '#fff3cc';
      for (const l of E.lamps) g.fillRect(l.x - 1, l.y, 3, 2);
      for (const bl of E.garland) {
        const k = 0.6 + 0.4 * Math.sin(t * 1.7 + bl.p);
        g.fillStyle = `rgb(${bl.c.map((v) => Math.round(v * k)).join(',')})`;
        g.fillRect(bl.x, bl.y, 1, 2);
      }
      // Néon.
      const N = E.neon;
      if (this.neon2.on) {
        g.fillStyle = '#ff9ac4';
        let cx = N.x;
        for (const ch of N.text) {
          B.PXC.FONT[ch].forEach((row, ry) => {
            for (let rx = 0; rx < 3; rx++) if (row[rx] === '1') g.fillRect(cx + rx * 2, N.y + ry * 2, 2, 2);
          });
          cx += 8;
        }
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = 'rgba(255,90,160,0.16)';
        g.fillRect(N.x - 4, N.y - 4, N.text.length * 8 + 6, 18);
        g.fillStyle = 'rgba(255,90,160,0.07)';
        g.fillRect(N.x - 10, N.y - 9, N.text.length * 8 + 18, 28);
        g.globalCompositeOperation = 'source-over';
      }
      // Le barista, coupé au ras du comptoir (il est derrière).
      const bs = this.barista;
      let img = bs.frames[this.baristaS.pose] || bs.frames.idle;
      if (Array.isArray(img)) img = img[Math.floor(t / (this.baristaS.pose === 'wipe' ? 0.35 : 1.6)) % img.length];
      const hb = L.ct - bs.y;
      if (hb > 0) g.drawImage(img, 0, 0, img.width, Math.min(img.height, hb), bs.x, bs.y, img.width, Math.min(img.height, hb));
      // Le couple et la lectrice du fauteuil.
      const cs = this.coupleS;
      const pick = (sh, pose, dur) => {
        let im = sh.frames[pose] || sh.frames[Object.keys(sh.frames)[0]];
        if (Array.isArray(im)) im = im[Math.floor(t / dur) % im.length];
        return im;
      };
      g.drawImage(pick(this.coupleA, cs.a, 1.8), this.coupleA.x, this.coupleA.y);
      g.drawImage(pick(this.coupleB, cs.b, cs.b === 'talk' ? 0.4 : 1.7), this.coupleB.x, this.coupleB.y);
      g.drawImage(pick(this.chairReader, this.chairS.pose, 2), this.chairReader.x, this.chairReader.y);
      g.drawImage(this.extFront, -this.extL, 0);
      for (const p of this.extSteam) {
        g.fillStyle = `rgba(235,235,245,${0.3 * (1 - p.age / p.life)})`;
        g.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      }
      g.fillStyle = 'rgba(170,200,240,0.8)';
      for (const d of this.extDrops) g.fillRect(d.x, Math.round(d.y), 1, 2);
    }

    /* ================= Vie de la scène ================= */
    newDrop(initial) {
      const { L } = this;
      return {
        x: L.wx0 + Math.random() * (L.wx1 - L.wx0 + 30) - 20,
        y: initial ? L.wy0 + Math.random() * (L.wy1 - L.wy0) : L.wy0 - Math.random() * 20,
        v: 150 + Math.random() * 70,
        stop: L.street0 + Math.random() * (L.wy1 - L.street0),
      };
    }

    newGlassDrop(initial) {
      const { L } = this;
      return {
        x: Math.round(L.wx0 + 2 + Math.random() * (L.wx1 - L.wx0 - 4)),
        y: initial ? L.wy0 + Math.random() * (L.wy1 - L.wy0) : L.wy0 + Math.random() * 20,
        rest: Math.random() * 6,
        v: 0,
        trail: [],
      };
    }

    spawnWalker() {
      const { L } = this;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const roll = Math.random();
      let kind;
      let set;
      let speed;
      const ws = this.wsets;
      if (roll < 0.6) {
        // Sous la pluie, parapluie ouvert ; sinon simple promeneur.
        const pool = this.mood.wet ? ws.umbrella : ws.dry;
        kind = 'umbrella';
        set = pool[Math.floor(Math.random() * pool.length)];
        speed = 9 + Math.random() * 5;
      } else if (roll < 0.8) {
        kind = 'kid';
        set = ws.kid;
        speed = 12 + Math.random() * 3;
      } else {
        kind = 'dog';
        set = ws.dog;
        speed = 10 + Math.random() * 2;
      }
      const span = set.w + (set.dogW || 0) + 6;
      this.walkers.push({ kind, set, dir, speed, x: dir > 0 ? L.wx0 - span : L.wx1 + span - set.w, t: Math.random() });
    }

    update(dt, ctx) {
      const { L } = this;
      this.t += dt;
      const eff = ctx.effect || 'none';
      // night absent (caméra d'ouverture) : on garde l'état courant.
      const night = 'night' in ctx ? !!ctx.night : this.night;
      if (eff !== this.effect) this.setEffect(eff, night);
      else if (night !== this.night) {
        // Même rue (temps déjà nocturne) : rien à repeindre.
        if (moodFor(eff, night) === this.mood) this.night = night;
        else this.setEffect(eff, night);
      }
      // Pluie qui tombe : seulement si aucun effet météo n'est actif (pas de double pluie).
      const raining = ctx.effect === 'none';
      this.raining = raining;
      this.wetGlass = !!this.mood.wet; // gouttes sur la vitre (elles sont SUR le verre)
      if (this.effect === 'storm') {
        this.flash = Math.max(0, (this.flash || 0) - dt * 3);
        if (Math.random() < dt * 0.12) this.flash = 1;
      }

      // Passants et voitures.
      this.nextWalker -= dt;
      if (this.nextWalker <= 0) {
        this.spawnWalker();
        this.nextWalker = 3 + Math.random() * 7;
      }
      for (const w of this.walkers) {
        w.x += w.dir * w.speed * dt;
        w.t += dt;
      }
      this.walkers = this.walkers.filter((w) => w.x > L.wx0 - w.set.w - (w.set.dogW || 0) - 12 && w.x < L.wx1 + (w.set.dogW || 0) + 12);
      this.nextCar -= dt;
      if (!this.car && this.nextCar <= 0) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        this.car = { dir, x: dir > 0 ? L.wx0 - 40 : L.wx1 + 4, set: this.sprites.cars[Math.floor(Math.random() * 3)], v: 55 + Math.random() * 25 };
        this.nextCar = 12 + Math.random() * 18;
      }
      if (this.car) {
        this.car.x += this.car.dir * this.car.v * dt;
        if (this.car.x < L.wx0 - 50 || this.car.x > L.wx1 + 10) this.car = null;
      }

      // Pluie, ronds dans les flaques, gouttes sur la vitre.
      if (this.wetGlass) {
        for (const d of raining ? this.rain : []) {
          d.y += d.v * dt;
          d.x -= d.v * dt * 0.12;
          if (d.y >= d.stop) {
            if (d.stop > L.street1 && this.ripples.length < 40) this.ripples.push({ x: Math.round(d.x), y: Math.round(d.stop), age: 0 });
            Object.assign(d, this.newDrop(false));
          }
        }
        for (const g of this.glass) {
          if (g.rest > 0) {
            g.rest -= dt;
            continue;
          }
          g.v = Math.min(18, g.v + 30 * dt);
          const oy = Math.round(g.y);
          g.y += g.v * dt;
          if (Math.round(g.y) !== oy) g.trail.push({ x: g.x, y: oy, age: 0 });
          if (Math.random() < dt * 0.8) {
            g.rest = Math.random() * 2;
            g.v = 0;
          }
          if (g.y > L.wy1 - 2) Object.assign(g, this.newGlassDrop(false));
        }
        for (const g of this.glass) {
          for (const p of g.trail) p.age += dt;
          g.trail = g.trail.filter((p) => p.age < 3);
        }
      }
      for (const rp of this.ripples) rp.age += dt;
      this.ripples = this.ripples.filter((rp) => rp.age < 0.6);

      // Fenêtres d'en face qui s'allument et s'éteignent ; silhouette derrière un rideau.
      this.nextToggle -= dt;
      if (this.nextToggle <= 0) {
        const w = this.windows[Math.floor(Math.random() * this.windows.length)];
        if (w) w.lit = !w.lit;
        this.nextToggle = 2 + Math.random() * 6;
      }
      const s = this.silhouette;
      if (s.win) {
        s.x += s.dir * dt * 1.2;
        if (s.x > 2 || s.x < -2) s.dir *= -1;
      }
      // Néon qui grésille de temps en temps.
      if (this.neon.flick > 0) this.neon.flick -= dt;
      else if (Math.random() < dt * 0.15) this.neon.flick = 0.6;
      this.neon.on = this.neon.flick > 0 ? Math.sin(this.t * 60) > 0 : true;

      // La cliente : tourne une page, boit une gorgée.
      const rd = this.reader;
      if (this.t > rd.until) rd.pose = 'idle';
      rd.nextPage -= dt;
      rd.nextSip -= dt;
      if (rd.pose === 'idle' && rd.nextPage <= 0) {
        rd.pose = 'page';
        rd.until = this.t + 0.5;
        rd.nextPage = 8 + Math.random() * 8;
      } else if (rd.pose === 'idle' && rd.nextSip <= 0) {
        rd.pose = 'sip';
        rd.until = this.t + 2.6;
        rd.nextSip = 16 + Math.random() * 12;
      }

      // Vapeur de sa tasse et de la machine à espresso.
      const mugX = L.readerX + 31;
      if (rd.pose !== 'sip' && Math.random() < dt * 5) this.steam.push({ x: mugX + 2 + Math.random() * 2, y: L.wy1 - 6, age: 0, life: 2 + Math.random() });
      if (Math.random() < dt * 3) {
        const sx = this.machine.spouts[Math.floor(Math.random() * 2)];
        this.steam.push({ x: sx + Math.random() * 2, y: this.machine.spoutY - 4, age: 0, life: 1.6 + Math.random() });
      }
      for (const p of this.steam) {
        p.age += dt;
        p.y -= dt * 7;
        p.x += Math.sin(p.age * 3 + p.y) * dt * 3;
      }
      this.steam = this.steam.filter((p) => p.age < p.life);

      // Notes de musique qui s'envolent de la radio.
      if (Math.random() < dt * 0.9) this.notes.push({ x: this.radio.x, y: this.radio.y, age: 0, life: 3.5, p: Math.random() * 6, kind: Math.random() < 0.5 ? 0 : 1 });
      for (const n of this.notes) {
        n.age += dt;
        n.y -= dt * 6;
        n.x += Math.sin(n.age * 2 + n.p) * dt * 5;
      }
      this.notes = this.notes.filter((n) => n.age < n.life);

      this.updateCat(dt);
      if (this.ext) this.updateExt(dt);
    }

    // Le chat : dort, se réveille, s'assoit, se lèche la patte, va ailleurs, se recouche.
    updateCat(dt) {
      const c = this.cat;
      const { W } = this;
      c.timer -= dt;
      c.frameT += dt;
      if (c.state === 'walk') {
        c.x += c.dir * 9 * dt;
        if ((c.dir < 0 && c.x <= c.target) || (c.dir > 0 && c.x >= c.target)) {
          c.state = 'sit';
          c.timer = 2 + Math.random() * 2;
          c.next = 'sleep';
        }
        return;
      }
      if (c.timer > 0) return;
      if (c.state === 'sleep') {
        c.state = 'sit';
        c.timer = 5 + Math.random() * 4;
        c.next = 'lick';
      } else if (c.state === 'sit' && c.next === 'lick') {
        c.state = 'lick';
        c.timer = 3;
      } else if (c.state === 'lick') {
        c.state = 'sit';
        c.timer = 2;
        c.next = 'walk';
      } else if (c.state === 'sit' && c.next === 'walk') {
        const minX = 82;
        const maxX = W - 120;
        c.target = Math.round(minX + Math.random() * (maxX - minX));
        if (Math.abs(c.target - c.x) < 30) c.target = c.x > (minX + maxX) / 2 ? minX + 10 : maxX - 10;
        c.dir = c.target < c.x ? -1 : 1;
        c.state = 'walk';
      } else {
        c.state = 'sleep';
        c.timer = 25 + Math.random() * 25;
      }
    }

    /* ================= Dessin d'une image ================= */
    draw(g) {
      const { L } = this;
      const t = this.t;
      g.imageSmoothingEnabled = false;
      if (this.ext) g.drawImage(this.outsideGap, 0, 0); // (monde élargi : la rue derrière les boiseries)
      g.drawImage(this.outside, -this.extL, 0);

      // ----- Dehors (tout est découpé à la vitre) -----
      g.save();
      g.beginPath();
      g.rect(L.wx0, L.wy0, L.wx1 - L.wx0, L.wy1 - L.wy0);
      if (this.ext) for (const w of this.E.windows) g.rect(w.x0, w.y0, w.x1 - w.x0, w.y1 - w.y0);
      g.clip();
      for (const w of this.windows) {
        if (w.lit) {
          g.fillStyle = '#ffd88a';
          g.fillRect(w.x, w.y, w.w, w.h);
          g.fillStyle = '#ffb562';
          g.fillRect(w.x, w.y + w.h - 3, w.w, 3);
          if (w.curtain) {
            g.fillStyle = `rgb(${w.curtain.join(',')})`;
            g.fillRect(w.x, w.y, 1, w.h);
            g.fillRect(w.x + w.w - 1, w.y, 1, w.h);
          }
        } else {
          g.fillStyle = '#171c33';
          g.fillRect(w.x, w.y, w.w, w.h);
          g.fillStyle = '#2c3456';
          g.fillRect(w.x + 1, w.y + 1, 1, 2);
        }
      }
      const s = this.silhouette;
      if (s.win && s.win.lit) {
        g.fillStyle = 'rgba(40,24,30,0.85)';
        g.fillRect(Math.round(s.win.x + 1 + s.x), s.win.y + 2, 2, 6);
        g.fillRect(Math.round(s.win.x + 1 + s.x), s.win.y + 1, 2, 1);
      }
      if (this.sign) this.drawSign(g);
      if (this.car) this.drawCar(g);
      const walkers = [...this.walkers].sort((a, b) => a.speed - b.speed);
      for (const w of walkers) this.drawWalker(g, w);
      if (this.raining) {
        g.fillStyle = 'rgba(170,190,230,0.55)';
        for (const d of this.rain) g.fillRect(Math.round(d.x), Math.round(d.y), 1, 3);
        g.fillStyle = 'rgba(180,200,235,0.6)';
        for (const rp of this.ripples) {
          const k = 1 + Math.floor(rp.age * 6);
          g.fillRect(rp.x - k, rp.y, 1, 1);
          g.fillRect(rp.x + k, rp.y, 1, 1);
        }
      }
      // Reflets sur la vitre.
      g.fillStyle = 'rgba(255,255,255,0.05)';
      for (let k = 0; k < 3; k++) {
        const bx = L.wx0 + 30 + k * 70;
        for (let y = L.wy0; y < L.wy1; y += 1) g.fillRect(bx + (L.wy1 - y) * 0.5, y, 2 + k, 1);
      }
      // Lucioles autour de l'arbre (nuit d'été).
      if (this.mood.fireflies && this.treeCenter) {
        for (let k = 0; k < 12; k++) {
          const a = t * (0.3 + k * 0.05) + k * 2.1;
          const fx = Math.round(this.treeCenter.x + Math.cos(a) * (18 + (k % 4) * 6));
          const fy = Math.round(this.treeCenter.y + 18 + Math.sin(a * 1.3) * 10);
          const on = Math.sin(t * 2 + k * 1.7) > 0.2;
          if (on) {
            g.fillStyle = 'rgba(230,255,140,0.9)';
            g.fillRect(fx, fy, 1, 1);
            g.fillStyle = 'rgba(230,255,140,0.25)';
            g.fillRect(fx - 1, fy - 1, 3, 3);
          }
        }
      }
      // Éclair d'orage sur toute la rue.
      if (this.flash > 0.05) {
        g.fillStyle = `rgba(220,230,255,${this.flash * 0.45})`;
        g.fillRect(L.wx0, L.wy0, L.wx1 - L.wx0, L.wy1 - L.wy0);
      }
      // Givre dans les coins de la vitre quand il neige.
      if (this.mood.snow) {
        for (let k = 0; k < 18; k++) {
          for (let j = 0; j < 18 - k; j++) {
            if ((k + j) % 2 && hash(k, j, 1) > 0.35) continue;
            const a = 0.28 * (1 - (k + j) / 18);
            g.fillStyle = `rgba(225,235,250,${a})`;
            g.fillRect(L.wx0 + k, L.wy1 - 1 - j, 1, 1);
            g.fillRect(L.wx1 - 1 - k, L.wy1 - 1 - j, 1, 1);
            g.fillRect(L.wx0 + k, L.wy0 + j, 1, 1);
          }
        }
      }
      // Gouttes sur la vitre.
      if (this.wetGlass) {
        for (const d of this.glass) {
          for (const p of d.trail) {
            g.fillStyle = `rgba(190,210,240,${0.22 * (1 - p.age / 3)})`;
            g.fillRect(p.x, p.y, 1, 1);
          }
          g.fillStyle = 'rgba(220,232,250,0.85)';
          g.fillRect(d.x, Math.round(d.y), 1, 1);
          g.fillStyle = 'rgba(40,50,80,0.6)';
          g.fillRect(d.x, Math.round(d.y) + 1, 1, 1);
        }
      }
      if (this.ext) this.drawExtOutside(g);
      g.restore();

      // ----- Dedans -----
      g.drawImage(this.inside, -this.extL, 0);
      // Ampoules de la guirlande.
      for (const b of this.garland) {
        const k = 0.6 + 0.4 * Math.sin(t * 1.7 + b.p);
        g.fillStyle = `rgb(${b.c.map((v) => Math.round(v * k)).join(',')})`;
        g.fillRect(b.x, b.y, 1, 2);
      }
      // Ampoules des lampes.
      g.fillStyle = '#fff3cc';
      for (const l of L.lamps) g.fillRect(l.x - 1, l.y, 3, 2);
      // Voyant de la machine.
      g.fillStyle = Math.sin(t * 2) > -0.3 ? '#ff3a3a' : '#7a1a1a';
      g.fillRect(this.machine.light.x, this.machine.light.y, 2, 2);

      // La cliente et sa tasse.
      const rd = this.reader;
      const rs = this.sprites.reader;
      let img = rs.frames[rd.pose] || rs.frames.idle;
      if (Array.isArray(img)) img = img[Math.floor(t / 1.8) % img.length]; // elle respire
      g.drawImage(img, rs.x, rs.y);
      if (rd.pose !== 'sip') g.drawImage(this.sprites.mug, L.readerX + 30, L.wy1 - 5);

      // Vapeur.
      for (const p of this.steam) {
        g.fillStyle = `rgba(235,235,245,${0.32 * (1 - p.age / p.life)})`;
        g.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      }

      this.drawCat(g);

      // Notes de musique.
      const NOTE = [
        ['..11', '..1.', '..1.', '111.', '11..'],
        ['1111', '1..1', '1..1', '11.11', '11.11'],
      ];
      for (const n of this.notes) {
        g.fillStyle = `rgba(255,232,170,${0.8 * Math.min(1, (n.life - n.age) / 1.2) * Math.min(1, n.age * 3)})`;
        NOTE[n.kind].forEach((row, y) => {
          for (let x = 0; x < row.length; x++) if (row[x] === '1') g.fillRect(Math.round(n.x) + x, Math.round(n.y) + y, 1, 1);
        });
      }

      if (this.ext) this.drawExtInside(g);

      // Halos des lampes, qui respirent doucement.
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.85 + 0.06 * Math.sin(t * 1.3) + 0.03 * Math.sin(t * 7.1);
      g.drawImage(this.halo, -this.extL, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }

    drawSign(g) {
      const { x, y } = this.sign;
      const on = this.neon.on;
      let cx = x;
      for (const ch of 'BAR') {
        FONT[ch].forEach((row, ry) => {
          for (let rx = 0; rx < 3; rx++) {
            if (row[rx] !== '1') continue;
            g.fillStyle = on ? '#ff5fa2' : '#4a2236';
            g.fillRect(cx + rx, y + ry, 1, 1);
          }
        });
        cx += 4;
      }
      if (on) {
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = 'rgba(255,80,150,0.18)';
        g.fillRect(x - 3, y - 3, 17, 11);
        g.fillStyle = 'rgba(255,80,150,0.12)';
        g.fillRect(x - 2, this.L.street0 + 2, 15, 6); // reflet sur la rue mouillée
        g.globalCompositeOperation = 'source-over';
      }
    }

    drawCar(g) {
      const c = this.car;
      const img = c.dir > 0 ? c.set.right : c.set.left;
      const y = this.L.street1 - c.set.h - 1;
      const x = Math.round(c.x);
      g.drawImage(img, x, y);
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = 'rgba(255,230,160,0.16)';
      const front = c.dir > 0 ? x + c.set.w : x - 26;
      g.fillRect(front, y + 4, 26, 3);
      g.fillRect(front + (c.dir > 0 ? 6 : 0), y + 3, 20, 5);
      g.globalCompositeOperation = 'source-over';
    }

    // La cliente au comptoir de la fenêtre (vue de dos, chignon, casque rose, pull
    // moutarde), éclairée par les mêmes lampes que la salle, avec un liseré de la lumière
    // froide de la rue sur sa silhouette.
    paintReader() {
      const { L } = this;
      const hh = L.readerHH;
      const look = {
        seed: 7, body: 'f', skin: '#e0ae8e', hairColor: '#3a2420', hairStyle: 'bun', scrunchie: '#e26a8e',
        top: '#d9a548', topStyle: 'sweater', bottom: '#3a3448', shoes: '#4a2c22',
        phones: '#2e2630', phonesHi: '#e26a8e', props: { book: '#3f6f8a', mug: '#ece4d8' },
      };
      const sh = B.People.heroes.counter(look, { hh, ledge: (L.readerY - L.wy1) / hh, seatH: 13 / hh, rim: { color: '#9fb4ee', dir: [[0, -1], [-1, 0], [1, 0]], k: 0.32 } });
      const x = L.seatX - sh.ax;
      const y = L.readerY - sh.ay;
      const lights = L.lamps.map((l) => ({ x: l.x - x, y: l.y + 6 - y, r: 46, k: 0.85, sy: 0.8 }));
      lights.push({ x: L.readerX + 12 - x, y: L.wy1 - 4 - y, r: 60, k: 0.25 });
      const out = B.People.bake(sh, (r) => applyLight(r, lights, [0.62, 0.6, 0.7], [0.95, 0.72, 0.45]));
      out.x = x;
      out.y = y;
      return out;
    }

    // Les passants de la rue d'en face, habillés selon le temps, un peu bleutés par la nuit.
    dressWalkers() {
      const m = this.mood;
      const sets = B.People.crowdSets({ hh: 4.4, season: m.snow ? 'winter' : m.tree === 'autumn' ? 'autumn' : m.tree === 'summer' ? 'summer' : 'spring', wet: !!m.wet, bake: B.People.tint('26,30,64', 0.22), seed: 5 });
      this.wsets = sets;
      this.walkers = [];
    }

    drawWalker(g, w) {
      B.People.drawWalker(g, w.set, Math.round(w.x), this.L.walkY, w.dir, w.t);
    }

    drawCat(g) {
      const c = this.cat;
      const S = this.sprites.cat;
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
      g.drawImage(img, Math.round(c.x), this.L.ct - img.height + 1);
    }
  }

  B.PixelScenes.cafe = Cafe;
})();
