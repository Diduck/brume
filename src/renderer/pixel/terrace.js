// Brume — scène « Terrasse », en pixel art.
//
// Une terrasse de ville, la nuit. À gauche, la façade d'un café (briques, fenêtres chaudes,
// store rayé, ardoise du menu). Au milieu, un lampadaire en fonte dont la lumière est
// PEINTE sur tout ce qui l'entoure : le feuillage de l'arbre en arche devient orange du
// côté de la lampe et reste bleu-vert sombre ailleurs, les pavés gardent une flaque de
// lumière. Derrière la rambarde : la ville bleue et brumeuse, ses fils électriques.
// La vie : un musicien qui joue de la guitare sur un banc, un chat sur la rambarde, des
// papillons de nuit autour de la lampe, des poussières dorées, des passants, un avion.
//
// Le décor est peint une fois en trois calques (fond, milieu, premier plan) ; il est
// repeint quand la météo change (neige, pluie, sakura, automne…). Chaque image ne
// dessine que ce qui bouge.
(function () {
  'use strict';
  const B = window.Brume;
  const { Raster, hex, mix, rng, hash, noise, fbm, bayer } = B.PX;
  const PXC = B.PXC;
  const SP = B.Sprites;
  const C = hex;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const pmod = (a, n) => ((a % n) + n) % n;

  /* ---------- Toile élargie (pour le travelling de l'animation d'ouverture) ----------
   * La scène peut peindre un monde plus large que l'écran : extL pixels à gauche, extR à
   * droite. On peint toujours en coordonnées de la scène (x de x0 = −extL à x1 = W + extR) ;
   * le pixel x de la scène est le pixel x + extL de la toile. Les trames (bayer) et le bruit
   * restent calculés en coordonnées de la scène : la partie [0, W) est exactement le fond
   * d'écran normal. « ext » : on peint le prolongement, sans jamais toucher à l'écran. */
  class Wide {
    constructor(W, H, extL = 0, extR = 0) {
      this.W = W;
      this.h = H;
      this.ox = extL;
      this.x0 = -extL;
      this.x1 = W + extR;
      this.sw = W + extL + extR;
      this.data = new Uint8ClampedArray(this.sw * H * 4);
      this.ext = false;
    }

    i(x, y) {
      return y * this.sw + x + this.ox;
    }

    set(x, y, c, a = 255) {
      x |= 0;
      y |= 0;
      if (x < this.x0 || y < 0 || x >= this.x1 || y >= this.h) return;
      if (this.ext && x >= 0 && x < this.W) return;
      const i = (y * this.sw + x + this.ox) * 4;
      this.data[i] = c[0];
      this.data[i + 1] = c[1];
      this.data[i + 2] = c[2];
      this.data[i + 3] = a;
    }

    get(x, y) {
      x = Math.max(this.x0, Math.min(this.x1 - 1, x | 0));
      y = Math.max(0, Math.min(this.h - 1, y | 0));
      const i = (y * this.sw + x + this.ox) * 4;
      return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
    }

    alpha(x, y) {
      if (x < this.x0 || y < 0 || x >= this.x1 || y >= this.h) return 0;
      return this.data[(y * this.sw + x + this.ox) * 4 + 3];
    }

    tint(x, y, c, t) {
      const p = this.get(x, y);
      if (!p[3]) return;
      this.set(x, y, mix(p, c, t));
    }

    rect(x, y, w, h, c) {
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
    }

    gradient(x, y, w, h, stops, steps = 10) {
      for (let j = y; j < y + h; j++) {
        const t = ((j - y) / Math.max(1, h - 1)) * (stops.length - 1);
        const k = Math.min(stops.length - 2, Math.floor(t));
        const f = t - k;
        for (let i = x; i < x + w; i++) {
          const q = Math.min(steps, Math.floor(f * steps + bayer(i, j)));
          this.set(i, j, mix(stops[k], stops[k + 1], q / steps));
        }
      }
    }

    clear(x, y, w, h) {
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, [0, 0, 0], 0);
    }

    // Peint le prolongement : fn s'exécute sans pouvoir toucher la partie [0, W).
    only(fn) {
      const was = this.ext;
      this.ext = true;
      fn();
      this.ext = was;
    }

    toCanvas() {
      const c = document.createElement('canvas');
      c.width = this.sw;
      c.height = this.h;
      c.getContext('2d').putImageData(new ImageData(this.data, this.sw, this.h), 0, 0);
      return c;
    }
  }

  // Éclairage peint (comme B.PXC.applyLight, en coordonnées de la scène). extra : lampes du
  // prolongement, qui n'éclairent que hors de l'écran (et s'effacent en approchant du bord).
  function applyLight(r, lights, ambient, warm, mask, extra) {
    const W = r.W;
    for (let y = 0; y < r.h; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        if (mask && !mask(x, y)) continue;
        const i = r.i(x, y) * 4;
        if (!r.data[i + 3]) continue;
        let I = 0;
        for (const l of lights) {
          const dx = x - l.x;
          const dy = (y - l.y) * (l.sy || 1);
          I += l.k / (1 + (dx * dx + dy * dy) / (l.r * l.r));
        }
        if (extra && extra.length && (x < 0 || x >= W)) {
          const d = x < 0 ? -x : x - W + 1;
          const f = clamp01(d / 28);
          const fs = f * f * (3 - 2 * f);
          for (const l of extra) {
            const dx = x - l.x;
            const dy = (y - l.y) * (l.sy || 1);
            I += (fs * l.k) / (1 + (dx * dx + dy * dy) / (l.r * l.r));
          }
        }
        const q = Math.floor(Math.min(1.3, I) * 6 + bayer(x, y)) / 6;
        for (let c = 0; c < 3; c++) r.data[i + c] = Math.min(255, r.data[i + c] * (ambient[c] + warm[c] * q));
      }
    }
  }

  // Halos (comme B.PXC.makeHalo, sur toute la largeur du monde). extra : halos du
  // prolongement, peints seulement hors de l'écran.
  function makeHalo(W, H, extL, extR, halos, extra) {
    const r = new Wide(W, H, extL, extR);
    for (let y = 0; y < H; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        let R = 0;
        let G = 0;
        let Bl = 0;
        const list = extra && extra.length && (x < 0 || x >= W) ? halos.concat(extra) : halos;
        for (const h of list) {
          const d = Math.hypot(x - h.x, (y - h.y) * 1.2);
          if (d > h.r) continue;
          const q = (Math.floor((1 - d / h.r) ** 1.6 * 5 + bayer(x, y) * 0.9) / 5) * (h.k || 0.55);
          R += h.c[0] * q;
          G += h.c[1] * q;
          Bl += h.c[2] * q;
        }
        if (R + G + Bl > 2) r.set(x, y, [R, G, Bl]);
      }
    }
    return r.toCanvas();
  }

  /* ---------- Ambiances selon la météo ---------- */
  const LOOKS = {
    none: {
      sky: ['#040a1e', '#071436', '#0d2654', '#173f78', '#2a6ea4', '#4aa0c8'],
      stars: 60, moon: true, clouds: 'haze', cloud: '#173a6c',
      far: '#2a6496', near: '#13305a', fog: '#4aa2c8',
      leaves: 'green', floor: 'dry', winLit: 0.6,
      ambient: [0.46, 0.54, 0.84], warm: [1.12, 0.74, 0.38], motes: 26,
    },
    starfall: {
      sky: ['#01030c', '#040a22', '#08173c', '#10285a', '#1e4a78', '#356e98'],
      stars: 240, milky: true, moon: false, clouds: 'none', cloud: '#10264a',
      far: '#1e4a74', near: '#0d2446', fog: '#33729a',
      leaves: 'green', floor: 'dry', winLit: 0.5,
      ambient: [0.42, 0.5, 0.82], warm: [1.12, 0.74, 0.38], motes: 22,
    },
    rain: {
      sky: ['#0a1020', '#101a2c', '#18263c', '#22344c', '#2e445c', '#405a70'],
      stars: 0, moon: false, clouds: 'overcast', cloud: '#26354c', cloudLit: '#3a4c64',
      far: '#2c425c', near: '#17263c', fog: '#4a6076',
      leaves: 'green', floor: 'wet', winLit: 0.7,
      ambient: [0.42, 0.48, 0.7], warm: [1.12, 0.76, 0.42], motes: 8,
    },
    storm: {
      sky: ['#06090f', '#0c121e', '#141c2c', '#1c283a', '#26364a', '#34485c'],
      stars: 0, moon: false, clouds: 'overcast', cloud: '#1e2a3c', cloudLit: '#323f54',
      far: '#243446', near: '#121e30', fog: '#3a4c60',
      leaves: 'green', floor: 'wet', winLit: 0.7, storm: true,
      ambient: [0.38, 0.44, 0.66], warm: [1.12, 0.76, 0.42], motes: 6,
    },
    snow: {
      sky: ['#10142a', '#1a2040', '#262e52', '#343e64', '#4a5678', '#66708e'],
      stars: 0, moon: false, clouds: 'overcast', cloud: '#2c3456', cloudLit: '#424c70',
      far: '#4a5878', near: '#263252', fog: '#76829e',
      leaves: 'green', floor: 'snow', snow: true, winLit: 0.75,
      ambient: [0.56, 0.62, 0.8], warm: [1.1, 0.8, 0.5], motes: 12,
    },
    sakura: {
      sky: ['#0a0a24', '#141842', '#24265e', '#3e3676', '#7a5486', '#c0849e'],
      stars: 40, moon: true, clouds: 'haze', cloud: '#34346c',
      far: '#5a5a8e', near: '#29295a', fog: '#b07ea2',
      leaves: 'sakura', floor: 'dry', litter: 'petals', winLit: 0.6,
      ambient: [0.5, 0.5, 0.8], warm: [1.12, 0.76, 0.5], motes: 26,
    },
    leaves: {
      sky: ['#0b0a1c', '#191534', '#2e2248', '#523256', '#904c56', '#c87a58'],
      stars: 30, moon: true, clouds: 'haze', cloud: '#36284c',
      far: '#6a4a6a', near: '#2c2140', fog: '#b87460',
      leaves: 'autumn', floor: 'dry', litter: 'leaves', winLit: 0.6,
      ambient: [0.5, 0.48, 0.72], warm: [1.15, 0.72, 0.36], motes: 22,
    },
    fireflies: {
      sky: ['#030b16', '#06192a', '#0b2a3c', '#124250', '#1c5e62', '#327e74'],
      stars: 80, moon: true, clouds: 'haze', cloud: '#0f3646',
      far: '#1e5a62', near: '#0d303e', fog: '#3a8a80',
      leaves: 'summer', floor: 'dry', winLit: 0.55,
      ambient: [0.44, 0.56, 0.74], warm: [1.15, 0.8, 0.4], motes: 60,
    },
  };

  // Rampes du feuillage : du plus sombre (loin de la lampe) au plus chaud (face à la lampe).
  const FOLIAGE = {
    green: ['#06111a', '#0a1c25', '#0f2a30', '#163b3a', '#224d40', '#46582e', '#865c22', '#c67a26', '#f0a43a', '#ffd47c'],
    summer: ['#05130f', '#092117', '#0f3121', '#18452b', '#275a30', '#506824', '#8e6a20', '#cc8a2a', '#f2b04a', '#ffdc8c'],
    sakura: ['#1e1430', '#2e1c40', '#462a54', '#68386a', '#8e4e80', '#b86a92', '#de8ea4', '#f4b0b0', '#ffd0bc', '#fff0dc'],
    autumn: ['#120a12', '#22101a', '#3a1618', '#5a2016', '#80301a', '#a8461c', '#cc6420', '#e88a2a', '#f8b444', '#ffdc80'],
  };
  // Verts « d'albédo » (éclairés ensuite par applyLight) pour les buissons en pot.
  const BUSH = ['#1c3626', '#284c32', '#36643c', '#4a8048', '#64a058'];

  /* ---------- Briques et pierre de l'immeuble du café ---------- */
  const BRICKS = ['#7c4a3a', '#71422f', '#86523f', '#6a3e34', '#7a4636', '#8a5844'].map(C);
  const MORTAR = C('#3e2c2a');
  const FSTONE = [C('#4a443c'), C('#8a8272'), C('#a49c8a'), C('#bab2a0')];
  function brickAt(x, y) {
    const row = Math.floor(y / 4);
    const off = (row % 2) * 5;
    const bx = Math.floor((x + off) / 10);
    if (y % 4 === 3 || pmod(x + off, 10) === 9) return MORTAR;
    let c = BRICKS[Math.floor(hash(bx, row, 4) * BRICKS.length)];
    if (y % 4 === 0) c = mix(c, [255, 230, 200], 0.08);
    if (noise(x * 0.25, y * 0.25, 9) > 0.7) c = mix(c, [24, 16, 20], 0.3);
    return c;
  }

  /* ---------- Outils de sprites ---------- */
  /* ---------- Le musicien et les promeneurs : peints par B.People (people.js) ---------- */
  const MUSICIAN = {
    seed: 12, body: 'm', skin: '#e0a882', hairColor: '#8a3228', hairStyle: 'messy',
    top: '#3e5a7a', topStyle: 'jacket', trim: '#d8c8a8', bottom: '#3a3a4c', shoes: '#18141a',
    scarf: '#d8a640', props: { guitar: '#e0a050', guitarDk: '#4a2410', fret: '#2a1810' },
  };

  /* ---------- Neige posée sur tout ce qui regarde vers le haut ---------- */
  const SNOW1 = C('#e4eaf6');
  const SNOW2 = C('#bcc6dc');
  function snowCaps(r, glow, skip) {
    const W = r.W;
    // Chaque région (l'écran, le prolongement gauche, le droit) ne regarde que ses voisins.
    const zone = (x) => (x < 0 ? -1 : x >= W ? 1 : 0);
    const top = (x, y, z) => {
      if (x < r.x0 || x >= r.x1 || y < 1 || zone(x) !== z) return false;
      return r.alpha(x, y) === 255 && r.alpha(x, y - 1) === 0 && !(glow && glow[r.i(x, y)]) && !(skip && skip(x, y));
    };
    const marks = [];
    for (let y = 1; y < r.h; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        const z = zone(x);
        if (top(x, y, z) && (top(x - 1, y, z) || top(x + 1, y, z))) marks.push(x, y);
      }
    }
    for (let k = 0; k < marks.length; k += 2) {
      const x = marks[k];
      const y = marks[k + 1];
      r.set(x, y, SNOW1);
      if (hash(x, y, 5) > 0.35) r.set(x, y - 1, SNOW1);
      if (hash(x, y, 6) > 0.8) r.set(x, y - 2, SNOW2);
      if (hash(x, y, 7) > 0.5) r.set(x, y + 1, SNOW2);
    }
  }
  function snowLine(r, x0, y, w) {
    for (let x = x0; x < x0 + w; x++) {
      r.set(x, y, SNOW1);
      if (hash(x, y, 8) > 0.45) r.set(x, y - 1, SNOW1);
      if (hash(x, y, 9) > 0.6) r.set(x, y + 1, SNOW2);
    }
  }

  // Courbe de Bézier quadratique.
  const bz = (p, t) => [
    (1 - t) * (1 - t) * p[0][0] + 2 * (1 - t) * t * p[1][0] + t * t * p[2][0],
    (1 - t) * (1 - t) * p[0][1] + 2 * (1 - t) * t * p[1][1] + t * t * p[2][1],
  ];

  class Terrace {
    constructor(W, H, opts = {}) {
      this.W = W;
      this.H = H;
      // Monde élargi (animation d'ouverture) : la place continue à gauche et à droite.
      const ext = opts.ext || {};
      this.extL = Math.max(0, Math.round(ext.left || 0));
      this.extR = Math.max(0, Math.round(ext.right || 0));
      this.wide = this.extL + this.extR > 0;
      const L = (this.L = {});
      L.FY0 = Math.round(H * 0.71); // fond du sol (pied du muret et de la façade)
      L.railTop = L.FY0 - 32; // main courante de la rambarde
      L.parapet = L.FY0 - 9; // haut du muret
      L.HZ = L.railTop + 12; // horizon brumeux de la ville
      L.walkY = L.FY0 + 14; // ligne de marche des passants
      L.FX = Math.max(84, Math.min(120, Math.round(W * 0.25))); // bord droit de la façade
      L.LX = Math.round(W * 0.55); // lampadaire
      L.LY = Math.round(H * 0.25);
      L.LB = Math.round(H * 0.83); // pied du lampadaire
      L.TX = Math.round(W * 0.87); // tronc de l'arbre
      L.SC1 = Math.round(H * 0.24); // bandeaux de pierre de la façade
      L.SC2 = Math.round(H * 0.47);
      L.seatY = L.LB - 2; // assise du banc
      L.benchX = L.LX + 12;
      L.tableX = L.FX + 44;
      L.tableY = L.LB - 9;
      L.moonX = Math.round(L.FX + (L.LX - L.FX) * 0.42);
      L.moonY = Math.round(H * 0.11);
      const cafe = { x0: 6, x1: Math.round(L.FX * 0.58), y0: L.SC2 + 22, y1: L.FY0 - 6 };
      cafe.cx = Math.round((cafe.x0 + cafe.x1) / 2);
      cafe.cy = Math.round((cafe.y0 + cafe.y1) / 2);
      L.cafe = cafe;
      L.door = { x0: cafe.x1 + 9, w: 16, y0: L.SC2 + 13 };
      L.sconce = { x: L.door.x0 + L.door.w + 5, y: L.door.y0 + 7 };
      L.cup = { x: L.tableX - 6, y: L.tableY - 5 };
      L.candle = { x: L.tableX + 5, y: L.tableY - 6 };
      if (this.wide) this.layoutExt();

      this.fast = PXC.fastTest();
      this.t = 0;
      this.sprites = { cat: SP.cat() };
      // Dans le monde élargi, les passants arpentent toute la place (même densité).
      const span = (W + this.extL + this.extR) / W;
      this.crowd = new PXC.Crowd({ x0: -12 - this.extL, x1: W + 12 + this.extR, walkY: L.walkY, rate: this.wide ? [8 / span, 18 / span] : [8, 18], hh: 5, style: false });
      this.notes = new PXC.Notes();
      this.steam = new PXC.Puffs('236,230,224');
      this.player = { playing: true, timer: 20 + Math.random() * 10, frameT: 0 };
      this.cat = { state: 'sit', x: L.FX + 46, dir: 1, timer: 6, frameT: 0, next: 'lick', target: 0 };
      this.plane = null;
      this.nextPlane = 8 + Math.random() * 12;
      this.nextToggle = 6;
      this.nextSky = 1;
      this.moths = Array.from({ length: 4 }, (_, i) => ({ a: Math.random() * 6.28, sp: (1.4 + Math.random() * 1.8) * (i % 2 ? 1 : -1), ph: Math.random() * 6, rad: 5 + Math.random() * 6 }));
      this.motes = [];
      this.flash = 0;
      this.nextBolt = 5;
      this.bolt = null;
      this.sil = { x: 0, dir: 1 };
      if (this.fast) {
        this.crowd.next = 0.2;
        this.cat.timer = 0.4;
        this.cat.next = 'walk';
        this.nextPlane = 0.3;
        this.nextBolt = 1.5;
      }
      this.effect = null;
      this.build('none');
    }

    // Plan du prolongement à gauche (x < 0) : le café continue (son immeuble et une
    // fleuriste), puis sa terrasse sous une guirlande, un kiosque à journaux, un second
    // lampadaire, une fontaine, un banc, des arbres en bac et une bouche de métro.
    layoutExt() {
      const { L } = this;
      const E = this.extL;
      const at = (f) => Math.round(-f * E);
      const X = (this.X = {});
      X.BX = -54; // bord gauche de l'immeuble du café
      X.shop = { x0: X.BX + 10, x1: -13, y0: L.cafe.y0, y1: L.cafe.y1 };
      X.tables = [-92, -154];
      // Le plan du milieu défile moins vite que le premier plan pendant le travelling :
      // ses objets restent assez près de l'immeuble pour être vus.
      X.pole = -194;
      X.bike = -126;
      X.kiosk = at(0.36);
      X.trees = [at(0.47), at(0.66)];
      // Premier plan.
      X.pots = [-218];
      X.lamp = at(0.5);
      X.fountain = at(0.62);
      X.bench = at(0.8);
      X.plants = [at(0.41), at(0.71)];
      X.metro = -E + 12;
      // Ville : silhouettes du fond (le fond défile encore moins vite).
      X.wheel = -30;
      X.dome = -96;
      X.spire = -140;
      X.relay = -178;
      // Les lumières du prolongement (elles n'éclairent que hors de l'écran).
      const ls = [
        { x: X.lamp, y: L.LY, r: 60, k: 1.0 },
        { x: X.lamp, y: L.LB + 3, r: 56, k: 1.15, sy: 2.6 },
        { x: Math.round((X.shop.x0 + X.shop.x1) / 2), y: L.cafe.cy, r: 22, k: 0.5 },
        { x: X.kiosk, y: L.FY0 - 26, r: 26, k: 0.6 },
        { x: X.kiosk, y: L.FY0 + 8, r: 26, k: 0.3, sy: 2 },
        { x: X.metro + 10, y: L.LB - 40, r: 22, k: 0.55 },
        { x: X.metro + 58, y: L.LB - 40, r: 22, k: 0.55 },
      ];
      for (let k = 0; k < 5; k++) ls.push({ x: Math.round(lerp(X.BX - 4, X.pole + 4, (k + 0.5) / 5)), y: L.SC2 + 14, r: 22, k: 0.3 });
      X.lights = ls.filter((l) => l.x > -E - 20);
    }

    /* ================= Construction des calques ================= */
    build(effect) {
      const t0 = performance.now();
      this.effect = effect;
      const look = (this.look = LOOKS[effect] || LOOKS.none);
      this.windows = [];
      this.skyWins = [];
      this.antennas = [];
      this.twinkles = [];
      this.coins = [];
      this.puddles = [];
      this.extHalos = [];
      this.bulbs = [];
      this.backR = this.paintBack();
      this.back = this.backR.toCanvas();
      this.mid = this.paintMid();
      if (this.wide) {
        // Vitres pré-composées (voir draw) : l'image de la vitre, puis le plan du milieu devant.
        for (const w of this.windows) {
          const mk = (img) => {
            const c = document.createElement('canvas');
            c.width = w.w;
            c.height = w.h;
            const cg = c.getContext('2d');
            if (img) cg.drawImage(img, 0, 0);
            cg.drawImage(this.mid, w.x + this.extL, w.y, w.w, w.h, 0, 0, w.w, w.h);
            return c;
          };
          w.compLit = mk(w.imgLit);
          w.compDark = mk(w.imgDark);
          w.front = mk(null);
        }
      }
      this.fore = this.paintFore();
      this.halo = this.paintHalo();
      this.musician = this.paintMusician();
      this.sil.win = this.windows.find((w) => w.lit) || this.windows[0];
      // Sous la pluie, les passants sortent les parapluies ; sinon, simples promeneurs.
      const wet = look.floor === 'wet';
      const season = effect === 'snow' ? 'winter' : effect === 'leaves' ? 'autumn' : 'spring';
      this.crowd.restyle({ wet, season, bake: B.People.tint('12,24,60', 0.18), seed: 8 });
      this.crowd.o.mix = wet ? { umbrella: 0.6, kid: 0.2, dog: 0.2 } : { umbrella: 0.7, kid: 0, dog: 0.3 };
      this.motes = Array.from({ length: look.motes }, () => this.newMote(true));
      if (this.wide) this.buildExtLife();
      this.buildMs = performance.now() - t0;
    }

    // Toutes les sources de lumière peintes (lampadaire, flaque au sol, café, applique, fenêtres).
    lights() {
      const { L } = this;
      const ls = [
        { x: L.LX, y: L.LY, r: 60, k: 1.0 },
        { x: L.LX, y: L.LB + 3, r: 56, k: 1.15, sy: 2.6 },
        { x: L.cafe.cx, y: L.cafe.cy, r: 24, k: 0.5 },
        { x: L.cafe.cx, y: L.FY0 + 10, r: 34, k: 0.38, sy: 2.2 },
        { x: L.sconce.x, y: L.sconce.y, r: 12, k: 0.6 },
      ];
      for (const w of this.windows) if (w.lit) ls.push({ x: w.x + w.w / 2, y: w.y + w.h / 2, r: 13, k: 0.3 });
      return ls;
    }

    /* ================= Calque du fond : ciel et ville ================= */
    paintBack() {
      const { W, H, L, look } = this;
      const R = rng(11);
      const r = new Wide(W, H, this.extL, this.extR);
      const fog = C(look.fog);
      r.gradient(r.x0, 0, r.sw, L.HZ + 2, look.sky.map(C), 12);
      r.rect(r.x0, L.HZ + 2, r.sw, H - L.HZ - 2, fog);

      // Voie lactée (nuit d'étoiles filantes).
      if (look.milky) {
        for (let y = 0; y < L.HZ - 16; y++) {
          for (let x = r.x0; x < r.x1; x++) {
            const d = Math.abs(y - 10 - (x - W * 0.25) * 0.32);
            const band = 1 - d / 30;
            if (band <= 0) continue;
            const v = band * fbm(x * 0.045, y * 0.06, 3);
            if (bayer(x, y) < (v - 0.22) * 1.6) r.tint(x, y, [110, 130, 200], 0.22);
            if (hash(x, y, 4) < v * 0.05) r.set(x, y, [210, 220, 245]);
          }
        }
      }
      // Étoiles (certaines scintilleront).
      const STAR = [[235, 240, 255], [255, 240, 210], [200, 220, 255]];
      for (let k = 0; k < look.stars; k++) {
        const x = Math.floor(R() * W);
        const y = Math.floor(R() * (L.HZ - 34));
        const c = STAR[Math.floor(R() * 3)];
        const b = 0.35 + R() * 0.6;
        r.tint(x, y, c, b);
        if (R() < 0.05) for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) r.tint(x + ox, y + oy, c, b * 0.35);
        if (this.twinkles.length < (look.milky ? 26 : 14) && R() < 0.3) this.twinkles.push({ x, y, c, p: R() * 6, s: 1 + R() * 2.5 });
      }
      // Les étoiles du prolongement (autre graine : le ciel de l'écran ne change pas).
      if (this.wide && look.stars) {
        const RS = rng(311);
        const n = Math.round((look.stars * (this.extL + this.extR)) / W);
        const tw = [];
        r.only(() => {
          for (let k = 0; k < n; k++) {
            const x = r.x0 + Math.floor(RS() * (this.extL + this.extR));
            const sx = x < 0 ? x : x + W;
            const y = Math.floor(RS() * (L.HZ - 34));
            const c = STAR[Math.floor(RS() * 3)];
            const b = 0.35 + RS() * 0.6;
            r.tint(sx, y, c, b);
            if (RS() < 0.05) for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) r.tint(sx + ox, y + oy, c, b * 0.35);
            if (tw.length < (look.milky ? 40 : 22) && RS() < 0.3) tw.push({ x: sx, y, c, p: RS() * 6, s: 1 + RS() * 2.5 });
          }
        });
        this.twinkles.push(...tw);
      }
      // Fin croissant de lune.
      if (look.moon) {
        const mx = L.moonX;
        const my = L.moonY;
        for (let y = -7; y <= 7; y++) {
          for (let x = -7; x <= 7; x++) {
            const d = Math.hypot(x, y);
            if (d > 6.4 || Math.hypot(x - 3, y + 2) < 5.4) continue;
            r.set(mx + x, my + y, d > 5.5 ? C('#d4caa8') : hash(x, y, 8) > 0.85 ? C('#e0d6b8') : C('#f6eed6'));
          }
        }
      }
      // Nuages : voiles fins par nuit claire, couverture épaisse sous la pluie ou la neige.
      if (look.clouds === 'haze') {
        const cc = C(look.cloud);
        for (let y = 26; y < L.HZ - 6; y++) {
          for (let x = r.x0; x < r.x1; x++) {
            const n = fbm(x * 0.011, y * 0.085, 21);
            if (n > 0.57) r.tint(x, y, cc, bayer(x, y) < (n - 0.57) * 6 ? 0.6 : 0.32);
          }
        }
      } else if (look.clouds === 'overcast') {
        const c1 = C(look.cloud);
        const c2 = C(look.cloudLit);
        for (let y = 0; y < L.HZ; y++) {
          for (let x = r.x0; x < r.x1; x++) {
            const n = fbm(x * 0.013 + y * 0.004, y * 0.042, 31);
            if (n < 0.36) continue;
            let c = n > 0.5 && noise(x * 0.05, (y + 3) * 0.12, 4) > 0.45 ? c2 : c1;
            if (n < 0.44 && bayer(x, y) > (n - 0.36) * 12) continue;
            c = mix(c, fog, (y / L.HZ) * 0.35);
            r.set(x, y, c);
          }
        }
      }

      // Ville lointaine, pâle dans la brume.
      const farC = mix(C(look.far), fog, 0.12);
      const farWin = mix(fog, [255, 236, 190], 0.5);
      const farCity = (x, xEnd, R) => {
        for (; x < xEnd; ) {
          const w = 6 + Math.floor(R() * 12);
          let top = L.HZ - 16 - Math.floor(Math.pow(R(), 1.6) * 44);
          const tower = R() < 0.1;
          if (tower) top -= 14;
          for (let y = top; y < H; y++) {
            const q = Math.floor(clamp01((y - (L.HZ - 30)) / 30) * 4 + bayer(x, y)) / 4;
            const c = mix(farC, fog, q * 0.6);
            for (let xx = x; xx < x + w; xx++) r.set(xx, y, y === top ? mix(c, fog, 0.3) : c);
          }
          for (let wy = top + 3; wy < L.HZ - 4; wy += 3) for (let wx = x + 1; wx < x + w - 1; wx += 2) if (R() < 0.1) r.set(wx, wy, farWin);
          if (tower) {
            r.rect(x + (w >> 1), top - 9, 1, 9, farC);
            this.antennas.push({ x: x + (w >> 1), y: top - 10, p: R() * 6 });
          }
          x += w + (R() < 0.2 ? 1 + Math.floor(R() * 4) : 0);
        }
        return x;
      };
      const farEnd = farCity(-4, W, R);
      if (this.wide) {
        const RF = rng(313);
        r.only(() => {
          farCity(r.x0 - 8, -4, RF);
          farCity(farEnd, r.x1, RF);
          this.paintExtFarCity(r, farC, fog, farWin);
        });
      }

      // Ville proche, plus sombre, avec ses fenêtres chaudes ou bleutées.
      const nearC = C(look.near);
      const edgeC = mix(nearC, fog, 0.28);
      const dimWin = mix(nearC, [0, 0, 0], 0.3);
      const WIN = [C('#ffcf7a'), C('#ffcf7a'), C('#ffb85c'), C('#9fe0ff'), C('#fff0d0')];
      const nearCity = (x, xEnd, R) => {
      for (; x < xEnd; ) {
        const w = 12 + Math.floor(R() * 18);
        const top = L.HZ - 12 - Math.floor(Math.pow(R(), 1.3) * 36);
        r.rect(x, top, w, H - top, nearC);
        r.rect(x, top, 1, H - top, edgeC);
        r.rect(x, top, w, 1, edgeC);
        // Toits : château d'eau, climatiseurs, antennes.
        const roof = R();
        if (roof < 0.25) {
          const tx = x + 3 + Math.floor(R() * Math.max(1, w - 9));
          r.rect(tx, top - 7, 5, 4, nearC);
          r.rect(tx, top - 8, 5, 1, edgeC);
          r.rect(tx + 1, top - 3, 1, 3, nearC);
          r.rect(tx + 3, top - 3, 1, 3, nearC);
        } else if (roof < 0.5) {
          r.rect(x + 2, top - 2, 3, 2, nearC);
          r.rect(x + w - 6, top - 2, 3, 2, nearC);
        } else if (roof < 0.66) {
          const ax = x + 2 + Math.floor(R() * (w - 4));
          r.rect(ax, top - 10, 1, 10, nearC);
          this.antennas.push({ x: ax, y: top - 11, p: R() * 6 });
        }
        for (let wy = top + 3; wy < L.HZ + 6; wy += 5) {
          for (let wx = x + 2; wx < x + w - 2; wx += 4) {
            const roll = R();
            if (roll < 0.2) {
              const c = WIN[Math.floor(R() * WIN.length)];
              if (R() < 0.25) this.skyWins.push({ x: wx, y: wy, c: `rgb(${c.join(',')})`, lit: R() < 0.5 });
              else r.rect(wx, wy, 2, 2, c);
            } else if (roll < 0.55) r.rect(wx, wy, 2, 2, dimWin);
          }
        }
        x += w + (R() < 0.25 ? 2 + Math.floor(R() * 6) : 0);
      }
      return x;
      };
      const nearEnd = nearCity(-6, W, R);
      if (this.wide) {
        const RN = rng(317);
        r.only(() => {
          nearCity(r.x0 - 10, -6, RN);
          nearCity(nearEnd, r.x1, RN);
          this.paintExtNearCity(r, nearC, edgeC, fog);
        });
      }
      // Brume au pied des immeubles.
      for (let y = L.HZ - 14; y < H; y++) {
        const t = clamp01((y - (L.HZ - 14)) / 22);
        for (let x = r.x0; x < r.x1; x++) if (bayer(x, y) < t) r.tint(x, y, fog, 0.35);
      }

      // Poteaux et fils électriques.
      const poleC = mix(nearC, [0, 0, 0], 0.5);
      const wireC = mix(nearC, [0, 0, 0], 0.4);
      const insC = mix(fog, [255, 255, 255], 0.3);
      const pTop = Math.round(H * 0.3);
      const poles = [L.FX + 30, L.FX + 30 + Math.round((W - L.FX) * 0.44)];
      for (const px of poles) {
        r.rect(px, pTop, 2, H - pTop, poleC);
        r.rect(px - 7, pTop + 3, 16, 1, poleC);
        r.rect(px - 5, pTop + 8, 12, 1, poleC);
        for (const ix of [px - 6, px + 7, px - 4, px + 5]) r.set(ix, ix === px - 6 || ix === px + 7 ? pTop + 2 : pTop + 7, insC);
      }
      const wire = (x0, y0, x1, y1, sag) => {
        const lo = r.ext ? r.x0 : 0;
        const hi = r.ext ? r.x1 - 1 : W - 1;
        for (let x = Math.max(lo, x0); x <= Math.min(hi, x1); x++) {
          const u = (x - x0) / (x1 - x0);
          r.set(x, Math.round(y0 + (y1 - y0) * u + sag * 4 * u * (1 - u)), wireC);
        }
      };
      const atts = [[-6, 2], [7, 2], [-4, 7], [5, 7]];
      const span = poles[1] - poles[0];
      for (const [ox, oy] of atts) {
        wire(poles[0] - span, pTop + oy - 6, poles[0] + ox, pTop + oy, 10);
        wire(poles[0] + ox, pTop + oy, poles[1] + ox, pTop + oy, 12);
        wire(poles[1] + ox, pTop + oy, poles[1] + span, pTop + oy + 8, 12);
      }
      // Quelques oiseaux endormis sur le fil.
      for (let k = 0; k < 3; k++) {
        const u = 0.25 + k * 0.12 + R() * 0.05;
        const bx = Math.round(poles[0] + 7 + (span) * u);
        const by = Math.round(pTop + 2 + 12 * 4 * u * (1 - u));
        r.rect(bx, by - 2, 2, 2, poleC);
        r.set(bx + (k % 2 ? -1 : 2), by - 3, poleC);
        r.set(bx + (k % 2 ? 2 : -1), by - 1, poleC);
      }
      // Prolongement : la ligne électrique continue de poteau en poteau.
      if (this.wide) {
        const RW = rng(331);
        r.only(() => {
          const pole = (px, top) => {
            r.rect(px, top, 2, H - top, poleC);
            r.rect(px - 7, top + 3, 16, 1, poleC);
            r.rect(px - 5, top + 8, 12, 1, poleC);
            for (const ix of [px - 6, px + 7, px - 4, px + 5]) r.set(ix, ix === px - 6 || ix === px + 7 ? top + 2 : top + 7, insC);
          };
          // À gauche : le premier poteau est caché derrière le café (là où le fil s'arrête).
          const t0 = pTop - 6;
          let px = poles[0] - span;
          let py = t0;
          while (px > r.x0 - span) {
            const nx = px - span;
            const ny = t0 + (RW() < 0.5 ? -2 : 2);
            pole(nx, ny);
            for (const [ox, oy] of atts) wire(nx + ox, ny + oy, px + ox, py + oy, 10 + Math.floor(RW() * 3));
            // Un oiseau qui dort sur le fil, de temps en temps.
            if (RW() < 0.6) {
              const u = 0.3 + RW() * 0.4;
              const bx = Math.round(nx + 7 + span * u);
              const by = Math.round(ny + 2 + (py - ny) * u + 10 * 4 * u * (1 - u));
              r.rect(bx, by - 2, 2, 2, poleC);
              r.set(bx + 2, by - 3, poleC);
              r.set(bx - 1, by - 1, poleC);
            }
            px = nx;
            py = ny;
          }
          // À droite : du dernier point d'attache vers un poteau hors champ.
          const ex = poles[1] + span;
          const rx = Math.max(W + 30, ex + 40);
          pole(rx, pTop + 6);
          for (const [ox, oy] of atts) wire(ex, pTop + oy + 8, rx + ox, pTop + 6 + oy, 8);
        });
      }
      return r;
    }

    /* ---------- Le prolongement du fond : quelques silhouettes de la ville ---------- */
    // Ville lointaine : un dôme d'église, une grande roue, une tour-relais.
    paintExtFarCity(r, farC, fog, farWin) {
      const { H, L, X } = this;
      const shade = (y) => mix(farC, fog, (Math.floor(clamp01((y - (L.HZ - 30)) / 30) * 4) / 4) * 0.6);
      // La grande roue (ses nacelles s'allument : voir drawSky).
      const wh = { x: X.wheel, y: L.HZ - 46, r: 27 };
      this.wheel = { ...wh, n: 12 };
      const wc = mix(farC, fog, 0.18);
      for (let a = 0; a < 720; a++) {
        const t = (a / 720) * Math.PI * 2;
        r.set(Math.round(wh.x + Math.cos(t) * wh.r), Math.round(wh.y + Math.sin(t) * wh.r), wc);
        if (a % 2 === 0) r.set(Math.round(wh.x + Math.cos(t) * (wh.r - 3)), Math.round(wh.y + Math.sin(t) * (wh.r - 3)), wc);
      }
      for (let k = 0; k < 12; k++) {
        const t = (k / 12) * Math.PI * 2;
        for (let d = 2; d < wh.r - 3; d++) if (d % 2 === 0 || k % 2 === 0) r.set(Math.round(wh.x + Math.cos(t) * d), Math.round(wh.y + Math.sin(t) * d), wc);
      }
      r.rect(wh.x - 1, wh.y - 1, 3, 3, farC);
      for (let y = wh.y; y < H; y++) {
        const k = (y - wh.y) * 0.42;
        r.set(Math.round(wh.x - k), y, shade(y));
        r.set(Math.round(wh.x + k), y, shade(y));
        r.set(Math.round(wh.x - k) + 1, y, shade(y));
        r.set(Math.round(wh.x + k) - 1, y, shade(y));
      }
      // Le dôme : un grand bâtiment, un tambour à colonnes, la coupole, son lanternon.
      const dx = X.dome;
      const dTop = L.HZ - 34;
      for (let y = dTop; y < H; y++) for (let x = dx - 22; x < dx + 22; x++) r.set(x, y, y === dTop ? mix(shade(y), fog, 0.3) : shade(y));
      for (const sx of [dx - 16, dx + 16]) {
        for (let y = -5; y <= 0; y++) for (let x = -5; x <= 5; x++) if (x * x + (y * 1.6) ** 2 <= 26) r.set(sx + x, dTop - 1 + y, shade(dTop));
        r.set(sx, dTop - 8, farC);
        r.set(sx, dTop - 9, farC);
      }
      const drum = dTop - 10;
      for (let y = drum; y < dTop; y++) for (let x = dx - 11; x <= dx + 11; x++) r.set(x, y, (x - dx) % 3 === 0 ? mix(farC, fog, 0.05) : shade(y));
      for (let x = dx - 12; x <= dx + 12; x++) r.set(x, drum, mix(farC, fog, 0.3));
      for (let y = -13; y <= 0; y++) {
        for (let x = -12; x <= 12; x++) {
          const e = (x * x) / 144 + (y * y) / 169;
          if (e > 1) continue;
          let c = mix(farC, fog, 0.1 + (x > 3 ? 0 : 0.12));
          if (e > 0.82 && y < -2) c = mix(c, fog, 0.28);
          if (x % 4 === 0 && e < 0.9) c = mix(c, [0, 0, 0], 0.08);
          r.set(dx + x, drum - 1 + y, c);
        }
      }
      r.rect(dx - 1, drum - 19, 3, 5, mix(farC, fog, 0.2));
      r.rect(dx - 2, drum - 15, 5, 1, farC);
      r.rect(dx, drum - 23, 1, 4, farC);
      r.rect(dx - 1, drum - 22, 3, 1, farC);
      for (let wy = dTop + 4; wy < L.HZ - 4; wy += 4) for (let wx = dx - 19; wx < dx + 19; wx += 5) if (hash(wx, wy, 71) < 0.3) r.set(wx, wy, farWin);
      // Une tour-relais en treillis, avec son feu rouge.
      const tx = X.relay;
      const tTop = L.HZ - 78;
      for (let y = tTop; y < H; y++) {
        const hw = Math.floor((y - tTop) / 14);
        r.set(tx - hw, y, shade(y));
        r.set(tx + hw + 1, y, shade(y));
        if ((y - tTop) % 7 === 0) for (let x = tx - hw; x <= tx + hw + 1; x++) r.set(x, y, shade(y));
        else if (hw > 0 && (y + tx) % 7 < 2) r.set(tx + ((y % 2) ? -hw + 1 : hw), y, shade(y));
      }
      r.rect(tx, tTop - 8, 1, 8, farC);
      this.antennas.push({ x: tx, y: tTop - 9, p: 1.3 });
      this.antennas.push({ x: tx + 1, y: tTop + 20, p: 2.9 });
    }

    // Ville proche : un clocher, un vieil immeuble à château d'eau.
    paintExtNearCity(r, nearC, edgeC, fog) {
      const { H, L, X } = this;
      const cx = X.spire;
      const top = L.HZ - 34;
      r.rect(cx - 9, top + 10, 18, H - top - 10, nearC);
      r.rect(cx - 9, top + 10, 18, 1, edgeC);
      r.rect(cx - 9, top + 10, 1, H - top - 10, edgeC);
      r.rect(cx - 4, top - 12, 8, 22, nearC);
      r.rect(cx - 4, top - 12, 1, 22, edgeC);
      r.rect(cx - 5, top - 12, 10, 1, edgeC);
      for (let k = 0; k < 18; k++) {
        const hw = Math.max(0, 4 - Math.floor(k / 4.5));
        r.rect(cx - hw, top - 13 - k, hw * 2 + 1, 1, nearC);
        r.set(cx - hw, top - 13 - k, edgeC);
      }
      r.rect(cx, top - 35, 1, 5, nearC);
      r.rect(cx - 1, top - 34, 3, 1, nearC);
      // Horloge éclairée et abat-sons.
      const clk = C('#f4e6b0');
      r.rect(cx - 1, top - 8, 3, 3, clk);
      r.set(cx - 2, top - 7, mix(clk, nearC, 0.5));
      r.set(cx + 2, top - 7, mix(clk, nearC, 0.5));
      r.set(cx, top - 9, mix(clk, nearC, 0.5));
      r.set(cx, top - 7, nearC);
      for (const yy of [top - 2, top + 2]) r.rect(cx - 2, yy, 4, 2, mix(nearC, [0, 0, 0], 0.3));
      for (let wy = top + 14; wy < L.HZ + 6; wy += 6) {
        r.rect(cx - 6, wy, 2, 3, hash(cx, wy, 3) < 0.4 ? C('#ffcf7a') : mix(nearC, [0, 0, 0], 0.3));
        r.rect(cx + 4, wy, 2, 3, hash(cx, wy, 5) < 0.4 ? C('#ffcf7a') : mix(nearC, [0, 0, 0], 0.3));
      }
    }

    /* ================= Calque du milieu : sol, rambarde, façade, arbre ================= */
    paintMid() {
      const { W, H, L, look } = this;
      const R = rng(5);
      const r = new Wide(W, H, this.extL, this.extR);
      const glow = (this.midGlow = new Uint8Array(r.sw * H));
      this.paintFloor(r, R);
      const floorCopy = r.data.slice();
      this.paintRailing(r, L.FX - 2, r.x1);
      this.paintFacade(r, glow, R);
      this.paintTree(r, glow, R);
      this.paintMidProps(r, glow, R);
      if (this.wide) r.only(() => this.paintExtMid(r, glow, rng(341)));
      // Ce qui reste du sol nu (pour la litière de feuilles et les reflets mouillés).
      const floor = (this.floorMask = new Uint8Array(r.sw * H));
      for (let i = L.FY0 * r.sw; i < r.sw * H; i++) {
        const j = i * 4;
        if (r.data[j] === floorCopy[j] && r.data[j + 1] === floorCopy[j + 1] && r.data[j + 2] === floorCopy[j + 2]) floor[i] = 1;
      }
      this.paintShadows(r);
      const BX = this.X ? this.X.BX : -Infinity;
      if (look.snow) snowCaps(r, glow, (x, y) => (x >= L.FX - 2 || x < BX) && y > L.railTop + 2 && y < L.parapet - 1);
      if (look.litter) this.paintLitter(r, R);
      applyLight(r, this.lights(), look.ambient, look.warm, (x, y) => !glow[r.i(x, y)], this.X && this.X.lights);
      if (look.floor === 'wet') this.wetFloor(r);
      return r.toCanvas();
    }

    paintFloor(r, R) {
      const { W, H, L, look } = this;
      const yh = L.FY0 - 52;
      const stones = ['#6c665c', '#625d54', '#736c61', '#5c574f', '#686056', '#6f665b'].map(C);
      const grout = C('#3c3833');
      const moss = C('#3e4a34');
      const wetC = C('#222c44');
      const snowC = [C('#b2bdcc'), C('#a6b2c4'), C('#8a96ac')];
      const wet = look.floor === 'wet';
      const snow = look.floor === 'snow';
      for (let y = L.FY0; y < H; y++) {
        const Z = 900 / (y - yh);
        const dZ = 900 / ((y - yh) * (y - yh)) / 2.2; // un pixel, en « rangées » de dalles
        const v = Z / 2.2;
        const tj = Math.floor(v);
        const fz = v - tj;
        const dX = Z / 100 / 2.6;
        for (let x = r.x0; x < r.x1; x++) {
          const X = ((x - L.LX) * Z) / 100 / 2.6 + (tj % 2) * 0.5;
          const ti = Math.floor(X);
          const fx = X - ti;
          const gz = fz < dZ;
          const gx = fx < dX;
          let c;
          if (snow) {
            const n = fbm(x * 0.06, y * 0.2, 41);
            c = (gz || gx) && n < 0.45 ? snowC[2] : n > 0.55 ? snowC[0] : snowC[1];
            if (hash(x, y, 3) > 0.97) c = mix(c, [255, 255, 255], 0.4);
          } else {
            if (gz || gx) c = gx && hash(ti, tj, 3) > 0.82 ? moss : grout;
            else {
              c = stones[Math.floor(hash(ti, tj, 1) * stones.length)];
              if (fz > 1 - dZ * 1.6 || fx < dX * 2.2) c = mix(c, [255, 245, 225], 0.14); // arête éclairée
              else if (fx > 1 - dX * 1.5) c = mix(c, [0, 0, 0], 0.18);
              if (hash(x, y, 7) > 0.96) c = mix(c, [0, 0, 0], 0.12);
              else if (noise(x * 0.4, y * 0.6, ti * 7 + tj) > 0.78) c = mix(c, [255, 255, 255], 0.06);
              // Une fissure de temps en temps.
              if (hash(ti, tj, 9) > 0.86 && Math.abs(fx - 0.3 - fz * 0.4) < dX * 0.8) c = grout;
            }
            if (wet) c = mix(c, wetC, 0.5);
          }
          r.set(x, y, c);
        }
      }
      // Traces de pas dans la neige.
      if (snow) {
        for (let x = 4, k = 0; x < W; x += 6, k++) {
          const y = Math.round(L.walkY + 4 + Math.sin(x * 0.02) * 3 + (k % 2) * 2);
          r.rect(x, y, 2, 1, C('#8e98b8'));
        }
        if (this.wide) {
          r.only(() => {
            for (let k = Math.floor((r.x0 - 4) / 6); 4 + k * 6 < r.x1; k++) {
              const x = 4 + k * 6;
              const y = Math.round(L.walkY + 4 + Math.sin(x * 0.02) * 3 + pmod(k, 2) * 2);
              r.rect(x, y, 2, 1, C('#8e98b8'));
            }
          });
        }
      }
      // Flaques sous la pluie.
      if (wet) {
        for (let k = 0; k < 7; k++) {
          const p = { x: Math.round(R() * W), y: Math.round(L.FY0 + 10 + R() * (H - L.FY0 - 16)), rx: 8 + Math.round(R() * 16) };
          p.ry = Math.max(2, Math.round(p.rx * (0.12 + ((p.y - L.FY0) / (H - L.FY0)) * 0.14)));
          this.puddles.push(p);
        }
        // Les flaques du prolongement : elles ne mouillent que hors de l'écran.
        this.extPuddles = [];
        if (this.wide) {
          const RP = rng(343);
          const n = Math.round((7 * (this.extL + this.extR)) / W);
          for (let k = 0; k < n; k++) {
            const u = RP() * (this.extL + this.extR);
            const p = { x: Math.round(u < this.extL ? -u : W + u - this.extL), y: Math.round(L.FY0 + 10 + RP() * (H - L.FY0 - 16)), rx: 8 + Math.round(RP() * 16) };
            p.ry = Math.max(2, Math.round(p.rx * (0.12 + ((p.y - L.FY0) / (H - L.FY0)) * 0.14)));
            this.extPuddles.push(p);
          }
        }
      }
    }

    // Muret et rambarde de x0 à xEnd (le motif part de x0).
    paintRailing(r, x0, xEnd) {
      const { L } = this;
      const W = xEnd;
      const iron = [C('#1a1e27'), C('#30353f'), C('#555c6a')];
      const stone = [C('#6a6458'), C('#817a6c'), C('#a39a88'), C('#48443c')];
      // Muret de pierre et son couronnement.
      for (let y = L.parapet; y < L.FY0; y++) {
        for (let x = x0; x < W; x++) {
          let c;
          if (y === L.parapet) c = stone[2];
          else if (y === L.parapet + 1) c = stone[1];
          else if (y === L.parapet + 2) c = stone[3];
          else {
            const off = y > L.parapet + 5 ? 7 : 0;
            c = (x - x0 + off) % 14 === 0 || y === L.parapet + 6 ? stone[3] : hash(x >> 1, y, 2) > 0.86 ? stone[0] : stone[1];
          }
          r.set(x, y, c);
        }
      }
      const top = L.railTop;
      // Barreaux, anneaux décoratifs, lisses.
      for (let x = x0 + 2; x < W; x += 6) r.rect(x, top + 3, 1, L.parapet - top - 3, iron[1]);
      for (let cx = x0 + 5; cx < W; cx += 6) {
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (Math.abs(Math.hypot(dx, dy) - 2) < 0.5) r.set(cx + dx, top + 8 + dy, dy < 0 ? iron[2] : iron[1]);
          }
        }
      }
      r.rect(x0, top + 11, W - x0, 1, iron[1]);
      r.rect(x0, L.parapet - 3, W - x0, 1, iron[1]);
      r.rect(x0, top, W - x0, 1, iron[2]);
      r.rect(x0, top + 1, W - x0, 1, iron[1]);
      r.rect(x0, top + 2, W - x0, 1, iron[0]);
      // Poteaux avec leur pommeau.
      for (let x = x0 + 34; x < W; x += 64) {
        r.rect(x - 1, top - 1, 3, L.parapet - top + 1, iron[1]);
        r.rect(x - 1, top - 1, 1, L.parapet - top + 1, iron[2]);
        r.rect(x - 1, top - 3, 3, 2, iron[1]);
        r.set(x, top - 4, iron[2]);
      }
    }

    paintFacade(r, glow, R) {
      const { L, look } = this;
      const FX = L.FX;
      const base = L.FY0;
      const stone = FSTONE;
      // Mur de briques.
      for (let y = 0; y < base; y++) for (let x = 0; x < FX; x++) r.set(x, y, brickAt(x, y));
      // Chaînage d'angle en pierre.
      for (let y = 0; y < base; y++) {
        const w = Math.floor(y / 7) % 2 ? 6 : 9;
        for (let x = FX - w; x < FX; x++) r.set(x, y, y % 7 === 6 ? stone[0] : x === FX - 1 ? stone[1] : x === FX - w ? stone[1] : stone[2]);
      }
      // Bandeaux de pierre.
      for (const sy of [L.SC1, L.SC2]) {
        r.rect(0, sy, FX, 1, stone[3]);
        r.rect(0, sy + 1, FX, 2, stone[2]);
        r.rect(0, sy + 3, FX, 1, stone[0]);
        if (look.snow) snowLine(r, 0, sy - 1, FX);
      }

      // Fenêtres des étages (la vitre est découpée : on y dessine chaque image allumée ou éteinte).
      const ww = Math.round(FX * 0.22);
      const wxs = [Math.round(FX * 0.1), Math.round(FX * 0.52)];
      const floors = [[7, L.SC1 - 8], [L.SC1 + 11, L.SC2 - 7]];
      this.facadeWin = { ww, floors };
      for (const [y0, y1] of floors) {
        for (const wx of wxs) this.paintFloorWindow(r, wx, y0, y1, ww, R);
      }

      this.paintCafeFront(r, glow);
      this.paintDoor(r, glow);

      // Enseigne drapeau (une tasse) accrochée à l'angle.
      const iron = [C('#1a1c24'), C('#3a3e4a')];
      const sy = L.SC1 + 16;
      r.rect(FX - 4, sy, 18, 1, iron[1]);
      r.rect(FX - 4, sy + 1, 2, 3, iron[0]);
      r.set(FX - 1, sy + 1, iron[1]);
      r.set(FX, sy + 2, iron[1]);
      r.set(FX + 3, sy + 1, iron[1]);
      r.set(FX + 11, sy + 1, iron[1]);
      r.rect(FX + 1, sy + 2, 13, 11, C('#c8a050'));
      r.rect(FX + 2, sy + 3, 11, 9, C('#24343a'));
      r.rect(FX + 4, sy + 7, 5, 3, C('#efe4cc'));
      r.set(FX + 9, sy + 8, C('#efe4cc'));
      r.rect(FX + 4, sy + 10, 6, 1, C('#efe4cc'));
      r.set(FX + 5, sy + 5, C('#a8b8b8'));
      r.set(FX + 7, sy + 4, C('#a8b8b8'));
      if (look.snow) snowLine(r, FX + 1, sy + 1, 13);

      // Lierre qui grimpe le long de l'angle.
      const ivy = [C('#1e3a26'), C('#2e5634'), C('#3e7040')];
      for (let v = 0; v < 3; v++) {
        let x = FX - 8 + v * 2;
        for (let y = base - 2; y > L.SC2 + 4 + v * 6; y--) {
          if (R() < 0.3) x += R() < 0.5 ? -1 : 1;
          r.set(x, y, ivy[0]);
          if (R() < 0.6) {
            const lx = x + (R() < 0.5 ? -1 : 1);
            r.set(lx, y, ivy[1 + Math.floor(R() * 2)]);
            r.set(lx + (lx > x ? 1 : -1), y - 1, ivy[2]);
          }
        }
      }
    }

    // Fenêtre d'étage : volets, encadrement, vitre découpée (image allumée ou éteinte
    // dessinée à chaque image), garde-corps et jardinière, appui.
    paintFloorWindow(r, wx, y0, y1, ww, R) {
      const { look } = this;
      const stone = FSTONE;
      const curtains = [C('#c4685a'), C('#d8b25a'), C('#5a8a8a'), C('#9a5a8a'), C('#e8d8c0')];
      const shutter = [C('#1e3e42'), C('#2f5e62'), C('#3e7276')];
      const h = y1 - y0;
      // Volets persiennés.
      for (const sx of [wx - 9, wx + ww + 3]) {
        r.rect(sx, y0, 6, h, shutter[1]);
        for (let yy = y0 + 1; yy < y0 + h - 1; yy += 2) r.rect(sx + 1, yy, 4, 1, shutter[0]);
        r.rect(sx, y0, 1, h, shutter[2]);
        r.rect(sx + 5, y0, 1, h, shutter[0]);
        r.set(sx + (sx < wx ? 5 : 0), y0 + Math.floor(h / 2), C('#8a8a7a'));
      }
      // Encadrement, linteau et clé de voûte.
      r.rect(wx - 2, y0 - 4, ww + 4, 4, stone[2]);
      r.rect(wx - 2, y0 - 4, ww + 4, 1, stone[3]);
      r.rect(wx + (ww >> 1) - 2, y0 - 6, 5, 6, stone[3]);
      r.rect(wx + (ww >> 1) - 2, y0 - 1, 5, 1, stone[1]);
      r.rect(wx - 2, y0, 2, h, stone[1]);
      r.rect(wx + ww, y0, 2, h, stone[1]);
      r.clear(wx, y0, ww, h);
      const curtain = curtains[Math.floor(R() * curtains.length)];
      const imgs = this.windowImages(ww, h, curtain);
      this.windows.push({ x: wx, y: y0, w: ww, h, lit: R() < look.winLit, imgLit: imgs.lit, imgDark: imgs.dark });
      // Garde-corps en fonte et jardinière fleurie, devant la vitre.
      const iron = C('#1e2028');
      r.rect(wx, y1 - 9, ww, 1, iron);
      for (let x = wx; x < wx + ww; x += 2) r.rect(x, y1 - 8, 1, 5, iron);
      r.rect(wx + 1, y1 - 4, ww - 2, 3, C('#6a3a26'));
      r.rect(wx + 1, y1 - 4, ww - 2, 1, C('#8a5234'));
      for (let x = wx + 1; x < wx + ww - 1; x++) {
        if (hash(x, y1, 11) > 0.25) r.set(x, y1 - 5, C('#2e5a34'));
        if (hash(x, y1, 12) > 0.55) r.set(x, y1 - 6, C('#3e7a40'));
        if (hash(x, y1, 13) > 0.72) r.set(x, y1 - 7, [C('#e84a4a'), C('#f08ab0'), C('#f4ecd8')][Math.floor(hash(x, 2, 14) * 3)]);
      }
      // Appui de fenêtre.
      r.rect(wx - 3, y1 - 1, ww + 6, 2, stone[3]);
      r.rect(wx - 3, y1 + 1, ww + 6, 1, stone[0]);
      if (look.snow) snowLine(r, wx - 3, y1 - 2, ww + 6);
    }

    windowImages(w, h, curtain) {
      const lit = new Raster(w, h);
      const dark = new Raster(w, h);
      lit.gradient(0, 0, w, h, [C('#ffe6a8'), C('#ffc070'), C('#e88a48')], 6);
      dark.gradient(0, 0, w, h, [C('#0c1428'), C('#142040'), C('#1b2b4c')], 6);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x + y) % 13 < 2) dark.tint(x, y, C('#3a5480'), 0.45);
      // Intérieur : plafonnier, tableau au mur, étagère.
      const lx = Math.floor(w * 0.32);
      lit.rect(lx, 0, 1, 3, C('#6a3a2a'));
      lit.rect(lx - 2, 3, 5, 2, C('#fff6dc'));
      lit.rect(w - 10, Math.floor(h * 0.42), 5, 6, C('#7a4a3a'));
      lit.rect(w - 9, Math.floor(h * 0.42) + 1, 3, 4, C('#5a8a8a'));
      // Rideaux en plis.
      const cd = mix(curtain, [0, 0, 0], 0.3);
      const cl = mix(curtain, [255, 255, 255], 0.2);
      const night = C('#0c1428');
      for (let y = 1; y < h; y++) {
        const cw = 3 + (y > h * 0.55 ? Math.round(((y - h * 0.55) / (h * 0.45)) * 2) : 0);
        for (let x = 0; x < cw; x++) {
          const c = x === cw - 1 ? cd : x % 2 ? curtain : cl;
          lit.set(x, y, c);
          lit.set(w - 1 - x, y, c);
          dark.set(x, y, mix(c, night, 0.7));
          dark.set(w - 1 - x, y, mix(c, night, 0.7));
        }
      }
      lit.rect(0, 0, w, 1, C('#4a2a1a'));
      dark.rect(0, 0, w, 1, C('#080c18'));
      // Croisillons.
      const hy = Math.floor(h * 0.4);
      lit.rect(w >> 1, 0, 1, h, C('#3a2a22'));
      lit.rect(0, hy, w, 1, C('#3a2a22'));
      dark.rect(w >> 1, 0, 1, h, C('#070a14'));
      dark.rect(0, hy, w, 1, C('#070a14'));
      return { lit: lit.toCanvas(), dark: dark.toCanvas() };
    }

    paintCafeFront(r, glow) {
      const { L, W, look } = this;
      const c = L.cafe;
      const wood = [C('#24160f'), C('#3a2418'), C('#5a3a26')];
      // Store rayé, sa pente puis son lambrequin écrit.
      const ax0 = c.x0 - 5;
      const ax1 = c.x1 + 5;
      const ay = L.SC2 + 5;
      const red = C('#b03a36');
      const cream = C('#e8dcc4');
      for (let k = 0; k < 7; k++) {
        const grow = k >> 1;
        for (let x = ax0 - grow; x < ax1 + grow; x++) {
          let col = Math.floor((x - ax0 + 40) / 4) % 2 ? cream : red;
          if (k === 0) col = mix(col, [0, 0, 0], 0.35);
          else if (k > 4) col = mix(col, [0, 0, 0], 0.12);
          r.set(x, ay + k, col);
        }
      }
      const vy = ay + 7;
      const vx0 = ax0 - 3;
      const vx1 = ax1 + 3;
      r.rect(vx0, vy, vx1 - vx0, 7, cream);
      r.rect(vx0, vy, vx1 - vx0, 1, red);
      r.rect(vx0, vy + 6, vx1 - vx0, 1, mix(cream, [0, 0, 0], 0.15));
      const label = 'CAFE LUNE';
      PXC.text(r, label, Math.round((vx0 + vx1) / 2 - (label.length * 4 - 1) / 2), vy + 1, red);
      for (let x = vx0; x < vx1; x++) if ((x - vx0) % 4 < 2) r.set(x, vy + 7, (x - vx0) % 8 < 4 ? red : cream);
      if (look.snow) snowLine(r, ax0, ay - 1, ax1 - ax0);

      // Vitrine du café, éclairée de l'intérieur (lumière propre : pas d'éclairage peint).
      r.rect(c.x0 - 3, c.y0 - 3, c.x1 - c.x0 + 6, c.y1 - c.y0 + 6, wood[1]);
      r.rect(c.x0 - 3, c.y0 - 3, c.x1 - c.x0 + 6, 1, wood[2]);
      r.gradient(c.x0, c.y0, c.x1 - c.x0, c.y1 - c.y0, [C('#ffe8b4'), C('#ffc77e'), C('#ee9c56')], 6);
      // Étagère et bouteilles au fond.
      const shelfY = c.y0 + 8;
      r.rect(c.x0, shelfY, c.x1 - c.x0, 1, C('#8a5030'));
      const BOT = [C('#4a7a4a'), C('#8a3a2a'), C('#c8a050'), C('#3a5a7a'), C('#f4ecd8')];
      for (let x = c.x0 + 2; x < c.x1 - 2; x += 3) {
        if (hash(x, 3) < 0.3) continue;
        const bh = 3 + Math.floor(hash(x, 4) * 3);
        const bc = BOT[Math.floor(hash(x, 5) * BOT.length)];
        r.rect(x, shelfY - bh, 1, bh, bc);
        r.set(x, shelfY - bh - 1, mix(bc, [0, 0, 0], 0.4));
      }
      // Suspensions.
      for (const px of [c.x0 + Math.round((c.x1 - c.x0) * 0.25), c.x0 + Math.round((c.x1 - c.x0) * 0.75)]) {
        r.rect(px, c.y0, 1, 11, C('#5a3420'));
        r.rect(px - 2, c.y0 + 11, 5, 2, C('#2a4440'));
        r.rect(px - 1, c.y0 + 13, 3, 1, C('#fffbe8'));
      }
      // Comptoir et clients attablés (silhouettes à contre-jour).
      r.rect(c.x0, c.y1 - 7, c.x1 - c.x0, 7, C('#a85e32'));
      r.rect(c.x0, c.y1 - 7, c.x1 - c.x0, 1, C('#d08a4e'));
      const sil = C('#4a2a20');
      const person = (px, hat) => {
        r.rect(px - 1, c.y1 - 16, 4, 4, sil);
        r.rect(px - 3, c.y1 - 12, 8, 5, sil);
        if (hat) r.rect(px - 2, c.y1 - 17, 6, 1, sil);
      };
      person(c.x0 + 9, false);
      person(c.x1 - 12, true);
      r.rect(c.x0 + 14, c.y1 - 9, 2, 2, C('#f4ecd8'));
      r.rect(c.x1 - 18, c.y1 - 9, 2, 2, C('#f4ecd8'));
      // Reflets en biais.
      for (let y = c.y0; y < c.y1; y++) for (let x = c.x0; x < c.x1; x++) if ((x - c.x0 + (c.y1 - y)) % 23 < 2) r.tint(x, y, [255, 255, 255], 0.16);
      for (let y = c.y0; y < c.y1; y++) for (let x = c.x0; x < c.x1; x++) glow[r.i(x, y)] = 1;
      r.rect(c.cx, c.y0, 1, c.y1 - c.y0, wood[1]);
      // Soubassement et appui.
      r.rect(c.x0 - 4, c.y1 + 2, c.x1 - c.x0 + 8, 2, C('#a49c8a'));
      r.rect(c.x0 - 3, c.y1 + 4, c.x1 - c.x0 + 6, L.FY0 - c.y1 - 4, wood[1]);
      if (look.snow) snowLine(r, c.x0 - 4, c.y1 + 1, c.x1 - c.x0 + 8);
    }

    paintDoor(r, glow) {
      const { L, W } = this;
      const d = L.door;
      const x0 = d.x0;
      const w = d.w;
      const y0 = d.y0;
      const y1 = L.FY0;
      const stone = [C('#4a443c'), C('#8a8272'), C('#a49c8a')];
      const wood = [C('#2e1a10'), C('#4e2e1e'), C('#6a4228')];
      r.rect(x0 - 3, y0 - 6, w + 6, y1 - y0 + 6, stone[1]);
      r.rect(x0 - 3, y0 - 6, w + 6, 1, stone[2]);
      // Imposte vitrée.
      r.rect(x0, y0 - 4, w, 3, C('#e8a860'));
      for (let x = x0 + 3; x < x0 + w; x += 4) r.set(x, y0 - 3, wood[0]);
      for (let y = y0 - 4; y < y0 - 1; y++) for (let x = x0; x < x0 + w; x++) glow[r.i(x, y)] = 1;
      // Porte en bois avec vitre haute.
      r.rect(x0, y0, w, y1 - y0, wood[1]);
      r.rect(x0, y0, 1, y1 - y0, wood[2]);
      r.rect(x0 + w - 1, y0, 1, y1 - y0, wood[0]);
      const gy1 = y0 + Math.round((y1 - y0) * 0.45);
      r.gradient(x0 + 3, y0 + 3, w - 6, gy1 - y0 - 3, [C('#f0c078'), C('#d88a48')], 4);
      for (let y = y0 + 3; y < gy1; y++) for (let x = x0 + 3; x < x0 + w - 3; x++) glow[r.i(x, y)] = 1;
      r.rect(x0 + (w >> 1), y0 + 3, 1, gy1 - y0 - 3, wood[0]);
      r.rect(x0 + 3, y0 + 3 + ((gy1 - y0 - 3) >> 1), w - 6, 1, wood[0]);
      for (const [py, ph] of [[gy1 + 3, 8], [gy1 + 14, y1 - gy1 - 18]]) {
        if (ph < 3) continue;
        r.rect(x0 + 3, py, w - 6, ph, wood[0]);
        r.rect(x0 + 4, py + 1, w - 8, ph - 2, wood[1]);
        r.rect(x0 + 4, py + 1, w - 8, 1, wood[2]);
      }
      r.rect(x0 + w - 4, gy1 + 1, 2, 1, C('#e8c070'));
      r.rect(x0 - 4, y1 - 2, w + 8, 2, stone[2]);
      // Plaque émaillée bleue.
      r.rect(x0 + (w >> 1) - 3, y0 - 13, 7, 5, C('#f4ecd8'));
      r.rect(x0 + (w >> 1) - 2, y0 - 12, 5, 3, C('#2a4a8a'));
      r.set(x0 + (w >> 1) - 1, y0 - 11, C('#f4ecd8'));
      r.set(x0 + (w >> 1) + 1, y0 - 11, C('#f4ecd8'));
      // Applique murale.
      const s = L.sconce;
      r.rect(s.x - 3, s.y + 1, 3, 1, C('#1a1c24'));
      r.rect(s.x - 1, s.y - 3, 3, 1, C('#1a1c24'));
      r.rect(s.x - 2, s.y - 2, 5, 1, C('#2a2e38'));
      r.rect(s.x - 1, s.y - 1, 3, 4, C('#ffe2a0'));
      r.set(s.x, s.y, C('#fffbe8'));
      r.rect(s.x - 1, s.y + 3, 3, 1, C('#1a1c24'));
      for (let y = s.y - 1; y < s.y + 3; y++) for (let x = s.x - 1; x < s.x + 2; x++) glow[r.i(x, y)] = 1;
    }

    // Une touffe de feuilles : un ovale festonné de petites feuilles, chaque feuille ombrée.
    // lampLit : la lumière de la lampe est calculée ici (feuillage de l'arbre, couleurs propres) ;
    // sinon on ne fait que le modelé et applyLight éclairera ensuite.
    paintClump(r, glow, cl, ramp, lampLit, bias = 0) {
      const { W, H, L, look } = this;
      const n = ramp.length - 1;
      const RL = 105;
      const x0 = Math.floor(cl.x - cl.r - 2);
      const x1 = Math.ceil(cl.x + cl.r + 2);
      const y0 = Math.floor(cl.y - cl.r - 2);
      const y1 = Math.ceil(cl.y + cl.r + 2);
      const r2 = cl.r * cl.r;
      for (let py = y0; py <= y1; py++) {
        if (py < 0 || py >= H) continue;
        for (let px = x0; px <= x1; px++) {
          if (px < r.x0 || px >= r.x1) continue;
          const dx = px - cl.x;
          const dy = py - cl.y;
          let best = null;
          let bestD = 9;
          for (const s of cl.subs) {
            const d = Math.hypot(dx - s.dx, dy - s.dy) / s.rr;
            if (d < bestD) {
              bestD = d;
              best = s;
            }
          }
          const core = (dx * dx) / (r2 * 0.5) + (dy * dy) / (r2 * 0.34) <= 1;
          if (!core && bestD > 1) continue;
          let nx = dx / cl.r;
          let ny = dy / cl.r;
          let sx = 0;
          let sy = 0;
          if (bestD <= 1) {
            sx = (dx - best.dx) / best.rr;
            sy = (dy - best.dy) / best.rr;
            nx = nx * 0.5 + sx * 0.5;
            ny = ny * 0.5 + sy * 0.5;
          }
          let s = 0.17 - ny * 0.12 + bias;
          let warm = 0;
          if (lampLit) {
            const ldx = L.LX - px;
            const ldy = L.LY - py;
            const dist = Math.hypot(ldx, ldy) || 1;
            const facing = (nx * ldx + ny * ldy) / dist;
            const I = 1 / (1 + (dist * dist) / (RL * RL));
            warm = I * (0.18 + 1.0 * Math.max(0, facing));
            s += warm * 1.1 + facing * 0.03;
          } else s = 0.45 - ny * 0.3 - nx * 0.1 + bias;
          // Liseré sombre sous chaque feuille, petit reflet au-dessus.
          if (bestD <= 1 && bestD > 0.72 && sy > 0.25) s -= 0.09;
          else if (bestD <= 0.5 && sy < -0.1 && sx < 0.2) s += 0.04;
          let idx = Math.floor(s * n + bayer(px, py) * 0.6 - 0.1);
          idx = idx < 0 ? 0 : idx > n ? n : idx;
          let col = ramp[idx];
          if (look.snow && ny < -0.4 && (bestD > 1 || sy < -0.3) && hash(px, py, 21) > 0.15) {
            col = mix([116, 132, 172], [255, 232, 196], clamp01(warm * 1.7));
            if (bayer(px, py) > 0.8) col = mix(col, [255, 255, 255], 0.15);
          }
          r.set(px, py, col);
          if (glow) glow[r.i(px, py)] = 1;
        }
      }
    }

    makeClump(x, y, rad, R, layer = 1) {
      const subs = [];
      const n = 5 + Math.floor(rad / 3);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * 6.283 + R() * 0.6;
        const d = rad * (0.5 + R() * 0.38);
        subs.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d * 0.85, rr: Math.max(2.4, rad * (0.36 + R() * 0.14)) });
      }
      subs.push({ dx: (R() - 0.5) * rad * 0.5, dy: -rad * 0.2, rr: Math.max(2.4, rad * 0.4) });
      return { x, y, r: rad, subs, layer };
    }

    paintTree(r, glow, R) {
      const { W, H, L } = this;
      const ramp = FOLIAGE[this.look.leaves].map(C);
      const TX = L.TX;
      const bark = [C('#1e1614'), C('#3a2c26'), C('#56443a'), C('#725c4a')];
      const tEnd = [TX - 4, Math.round(H * 0.42)];
      const trunk = { p: [[TX, L.FY0 + 4], [TX + 8, L.FY0 - 40], tEnd], w: [14, 9] };
      const main = { p: [tEnd, [TX - 22, Math.round(H * 0.03)], [L.LX + 8, L.LY - 38]], w: [8, 2] };
      const right = { p: [tEnd, [TX + 14, Math.round(H * 0.22)], [W + 14, Math.round(H * 0.05)]], w: [5, 2] };
      const droop = { p: [[tEnd[0] + 2, tEnd[1] - 8], [W - 6, Math.round(H * 0.28)], [W + 8, Math.round(H * 0.56)]], w: [4, 1] };
      const twig = { p: [bz(main.p, 0.72), [L.LX + 22, L.LY - 30], [L.LX - 16, L.LY - 13]], w: [3, 1] };
      const upper = { p: [bz(main.p, 0.45), [TX - 60, -14], [L.LX + 50, -10]], w: [3, 1] };
      const under = { p: [bz(main.p, 0.3), [TX - 44, Math.round(H * 0.3)], [TX - 80, Math.round(H * 0.29)]], w: [2, 1] };

      const clumps = [];
      const along = (limb, t0, n, r0, r1, up, down) => {
        for (let k = 0; k < n; k++) {
          const t = t0 + ((1 - t0) * (k + R() * 0.6)) / n;
          const [x, y] = bz(limb.p, t);
          const rad = lerp(r0, r1, t);
          clumps.push(this.makeClump(x + (R() - 0.5) * 6, y - R() * up, rad * (0.8 + R() * 0.35), R, 0));
          clumps.push(this.makeClump(x + (R() - 0.5) * 8, y - up * 0.3 + R() * down, rad * (0.65 + R() * 0.3), R, 1));
        }
      };
      along(main, 0.25, 14, 13, 8, 12, 6);
      along(right, 0.15, 9, 12, 9, 12, 6);
      along(droop, 0.2, 8, 9, 6, 4, 9);
      along(twig, 0.1, 6, 8, 5, 5, 5);
      along(upper, 0.1, 6, 10, 7, 8, 4);
      along(under, 0.2, 4, 7, 5, 3, 5);
      const hang = { p: [bz(main.p, 0.85), [L.LX + 40, L.LY - 26], [L.LX + 24, L.LY - 9]], w: [2, 1] };
      along(hang, 0.2, 4, 7, 6, 2, 4);
      // Masse du houppier en haut à droite (pour qu'il n'y ait pas de trou au coin).
      const limit = (x) => (x < TX ? lerp(16, 78, clamp01((x - (L.LX + 30)) / (TX - L.LX - 30))) : 78 + (x - TX) * 0.9);
      for (let y = -6; y < H * 0.45; y += 10) {
        for (let x = L.LX + 34; x < W + 10; x += 12) {
          const jx = x + (R() - 0.5) * 8;
          const jy = y + (R() - 0.5) * 8;
          if (jy > limit(jx)) continue;
          if (R() < 0.82) clumps.push(this.makeClump(jx, jy, 9 + R() * 4, R, 0));
        }
      }
      // Branche → tronc → feuillage de devant.
      const drawLimb = (limb) => {
        const steps = 90;
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const [bx, by] = bz(limb.p, t);
          const rad = lerp(limb.w[0], limb.w[1], t) / 2;
          for (let py = Math.floor(by - rad); py <= Math.ceil(by + rad); py++) {
            for (let px = Math.floor(bx - rad); px <= Math.ceil(bx + rad); px++) {
              const ox = px - bx;
              const oy = py - by;
              if (ox * ox + oy * oy > rad * rad + 0.4) continue;
              const ldx = L.LX - px;
              const ldy = L.LY - py;
              const f = (ox * ldx + oy * ldy) / ((Math.hypot(ldx, ldy) || 1) * Math.max(1, rad));
              let i = 1 + (f > 0.3 ? 1 : 0) + (f > 0.7 ? 1 : 0) - (f < -0.35 ? 1 : 0);
              if (hash(px, py >> 1, 41) > 0.8) i = Math.max(0, i - 1);
              r.set(px, py, bark[i]);
            }
          }
        }
      };
      const back = clumps.filter((c) => c.layer === 0).sort((a, b) => a.y - b.y);
      const front = clumps.filter((c) => c.layer === 1).sort((a, b) => a.y - b.y);
      for (const c of back) this.paintClump(r, glow, c, ramp, true, -0.09);
      for (const limb of [right, droop, upper, under, twig, hang, main, trunk]) drawLimb(limb);
      // Racines qui s'évasent.
      for (const [ox, rr] of [[-6, 3], [7, 3], [-3, 4], [4, 4]]) {
        for (let py = -rr; py <= 0; py++) for (let px = -rr; px <= rr; px++) if (px * px + py * py <= rr * rr) r.set(TX + ox + px, L.FY0 + 4 + py, bark[px < 0 ? 2 : 1]);
      }
      for (const c of front) this.paintClump(r, glow, c, ramp, true, 0.04);
      // Quelques feuilles isolées qui dépassent du bord.
      for (const c of front) {
        for (let k = 0; k < 4; k++) {
          const a = R() * 6.283;
          const x = Math.round(c.x + Math.cos(a) * (c.r + 1));
          const y = Math.round(c.y + Math.sin(a) * (c.r * 0.8 + 1));
          if (x < r.x0 || y < 0 || x >= r.x1 || y >= H) continue;
          const d = Math.hypot(L.LX - x, L.LY - y);
          const I = 1 / (1 + (d * d) / 5184);
          const idx = Math.min(9, Math.max(0, Math.floor((0.12 + I * 0.7) * 9)));
          r.set(x, y, ramp[idx]);
          r.set(x, y + 1, ramp[Math.max(0, idx - 1)]);
          glow[r.i(x, y)] = 1;
          if (y + 1 < H) glow[r.i(x, y + 1)] = 1;
        }
      }
    }

    paintMidProps(r, glow, R) {
      const { L, look } = this;
      // Grille de pied d'arbre.
      const iron = [C('#16181e'), C('#2a2e38'), C('#4a505e')];
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -14; dx <= 14; dx++) {
          const e = (dx * dx) / 196 + (dy * dy) / 9;
          if (e > 1) continue;
          const x = L.TX + dx;
          const y = L.FY0 + 6 + dy;
          const ang = Math.atan2(dy * 4, dx);
          let c = e > 0.75 ? iron[2] : Math.round(ang * 4) % 2 ? iron[1] : C('#20160e');
          if (Math.abs(dx) < 5 && dy < 0) continue; // le tronc passe ici
          r.set(x, y, c);
        }
      }
      // Jardinière d'angle (caisse en bois) avec un gros buis.
      const bush = BUSH.map(C);
      const jx = L.FX + 4;
      const jy = L.FY0 - 7;
      for (const [cx, cy, rr] of [[jx + 4, jy - 6, 6], [jx + 14, jy - 7, 6], [jx + 9, jy - 11, 8]]) this.paintClump(r, null, this.makeClump(cx, cy, rr, R), bush, false);
      r.rect(jx, jy, 19, 11, C('#6a4a30'));
      for (let y = jy + 2; y < jy + 11; y += 3) r.rect(jx, y, 19, 1, C('#4a3020'));
      r.rect(jx, jy, 19, 1, C('#8a6440'));
      r.rect(jx, jy, 1, 11, C('#8a6440'));
      // Pots de part et d'autre de la porte, avec une boule taillée.
      const d = L.door;
      for (const px of [d.x0 - 10, d.x0 + d.w + 3]) {
        this.paintClump(r, null, this.makeClump(px + 3.5, L.FY0 - 11, 5, R), bush, false);
        r.rect(px, L.FY0 - 7, 7, 7, C('#a85a38'));
        r.rect(px - 1, L.FY0 - 7, 9, 2, C('#c8784a'));
        r.rect(px + 5, L.FY0 - 5, 1, 5, C('#7a4028'));
      }
      // Petits pots d'herbes sur le muret.
      for (let k = 0; k < 3; k++) {
        const px = Math.round(L.FX + 40 + k * 15 + R() * 6);
        if (Math.abs(px - L.LX) < 10) continue;
        r.rect(px, L.parapet - 4, 5, 4, C('#b0643e'));
        r.rect(px - 1, L.parapet - 4, 7, 1, C('#c87a4e'));
        for (let j = 0; j < 9; j++) r.set(px + Math.floor(R() * 5), L.parapet - 5 - Math.floor(R() * 4), bush[1 + Math.floor(R() * 3)]);
      }
      if (look.snow) snowLine(r, jx, jy - 1, 19);
    }

    /* ================= Le prolongement, plan du milieu ================= */
    paintExtMid(r, glow, R) {
      const { H, L, look, X } = this;
      const BX = X.BX;
      const base = L.FY0;
      // Le muret et la rambarde continuent à gauche de l'immeuble.
      this.paintRailing(r, r.x0 - 3, BX);
      // L'immeuble du café, côté gauche : briques, chaînage d'angle, bandeaux, une fenêtre par étage.
      const stone = FSTONE;
      for (let y = 0; y < base; y++) for (let x = BX; x < 0; x++) r.set(x, y, brickAt(x, y));
      for (let y = 0; y < base; y++) {
        const w = Math.floor(y / 7) % 2 ? 6 : 9;
        for (let x = BX; x < BX + w; x++) r.set(x, y, y % 7 === 6 ? stone[0] : x === BX ? stone[1] : x === BX + w - 1 ? stone[1] : stone[2]);
      }
      for (const sy of [L.SC1, L.SC2]) {
        r.rect(BX, sy, -BX, 1, stone[3]);
        r.rect(BX, sy + 1, -BX, 2, stone[2]);
        r.rect(BX, sy + 3, -BX, 1, stone[0]);
        if (look.snow) snowLine(r, BX, sy - 1, -BX);
      }
      const { ww, floors } = this.facadeWin;
      const wx = Math.round(BX / 2 - ww / 2) + 2;
      for (const [y0, y1] of floors) this.paintFloorWindow(r, wx, y0, y1, ww, R);
      this.paintFlorist(r, glow);
      // Lierre sur l'angle gauche.
      const ivy = [C('#1e3a26'), C('#2e5634'), C('#3e7040')];
      for (let v = 0; v < 2; v++) {
        let x = BX + 3 + v * 3;
        for (let y = base - 2; y > L.SC2 + 10 + v * 9; y--) {
          if (R() < 0.3) x += R() < 0.5 ? -1 : 1;
          x = Math.max(BX - 1, Math.min(BX + 8, x));
          r.set(x, y, ivy[0]);
          if (R() < 0.6) {
            const lx = x + (R() < 0.5 ? -1 : 1);
            r.set(lx, y, ivy[1 + Math.floor(R() * 2)]);
            r.set(lx + (lx > x ? 1 : -1), y - 1, ivy[2]);
          }
        }
      }
      // Sur la place : arbres en bac, fontaine, kiosque à journaux, un vélo contre le muret.
      for (const tx of X.trees) if (tx > r.x0 + 12) this.paintTubTree(r, tx, R);
      if (X.kiosk > r.x0 + 18) this.paintKiosk(r, glow);
      this.paintBike(r, X.bike);
      // Prolongement à droite : le houppier du grand arbre continue.
      if (this.extR > 0) {
        const ramp = FOLIAGE[look.leaves].map(C);
        const cl = [];
        for (let y = -6; y < H * 0.5; y += 10) {
          for (let x = this.W + 6; x < r.x1 + 10; x += 12) {
            const jx = x + (R() - 0.5) * 8;
            const jy = y + (R() - 0.5) * 8;
            if (jy > Math.min(H * 0.52, 78 + (jx - L.TX) * 0.6)) continue;
            if (R() < 0.85) cl.push(this.makeClump(jx, jy, 9 + R() * 4, R, 0));
          }
        }
        cl.sort((a, b) => a.y - b.y);
        for (const c of cl) this.paintClump(r, glow, c, ramp, true, -0.05);
      }
    }

    // Petit tracé de ligne (vélo, fer forgé).
    line(r, x0, y0, x1, y1, c) {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let k = 0; k <= n; k++) r.set(Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n), c);
    }

    // La fleuriste, au rez-de-chaussée : store vert, vitrine pleine de plantes, seaux de fleurs.
    paintFlorist(r, glow) {
      const { L, look, X } = this;
      const s = X.shop;
      const green = C('#2e6a4c');
      const cream = C('#e8e0c8');
      const ay = L.SC2 + 5;
      const ax0 = s.x0 - 4;
      const ax1 = s.x1 + 4;
      for (let k = 0; k < 7; k++) {
        const grow = k >> 1;
        for (let x = ax0 - grow; x < ax1 + grow; x++) {
          let col = pmod(Math.floor((x - ax0 + 40) / 4), 2) ? cream : green;
          if (k === 0) col = mix(col, [0, 0, 0], 0.35);
          else if (k > 4) col = mix(col, [0, 0, 0], 0.12);
          r.set(x, ay + k, col);
        }
      }
      const vy = ay + 7;
      const vx0 = ax0 - 3;
      const vx1 = ax1 + 3;
      r.rect(vx0, vy, vx1 - vx0, 7, cream);
      r.rect(vx0, vy, vx1 - vx0, 1, green);
      r.rect(vx0, vy + 6, vx1 - vx0, 1, mix(cream, [0, 0, 0], 0.15));
      const label = 'FLEURS';
      PXC.text(r, label, Math.round((vx0 + vx1) / 2 - (label.length * 4 - 1) / 2), vy + 1, green);
      for (let x = vx0; x < vx1; x++) if (pmod(x - vx0, 4) < 2) r.set(x, vy + 7, pmod(x - vx0, 8) < 4 ? green : cream);
      if (look.snow) snowLine(r, ax0, ay - 1, ax1 - ax0);
      // Vitrine éclairée : étagères de plantes, bouquets, une suspension.
      const wood = [C('#16261e'), C('#24402e'), C('#3a5a44')];
      r.rect(s.x0 - 3, s.y0 - 3, s.x1 - s.x0 + 6, s.y1 - s.y0 + 6, wood[1]);
      r.rect(s.x0 - 3, s.y0 - 3, s.x1 - s.x0 + 6, 1, wood[2]);
      r.gradient(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0, [C('#fff2cc'), C('#ffd99a'), C('#f0b070')], 6);
      const leaf = [C('#2a5a30'), C('#3e7a3a'), C('#5a9a48'), C('#7ab858')];
      const FL = [C('#e84a5a'), C('#f4a0b8'), C('#f8d850'), C('#f4ecd8'), C('#b070d0'), C('#f08040')];
      for (const sy of [s.y0 + 9, s.y1 - 6]) {
        r.rect(s.x0, sy, s.x1 - s.x0, 1, C('#8a5a34'));
        for (let x = s.x0 + 2; x < s.x1 - 2; x += 5) {
          const h = 3 + Math.floor(hash(x, sy, 61) * 4);
          r.rect(x, sy - 2, 3, 2, C('#b8643c'));
          for (let j = 0; j < 9; j++) {
            const px = x - 1 + Math.floor(hash(x + j, sy, 62) * 5);
            const py = sy - 3 - Math.floor(hash(x, sy + j, 63) * h);
            r.set(px, py, leaf[Math.floor(hash(px, py, 64) * 4)]);
          }
          if (hash(x, sy, 65) > 0.35) r.set(x + 1, sy - 2 - h, FL[Math.floor(hash(x, sy, 66) * FL.length)]);
          if (hash(x, sy, 67) > 0.5) r.set(x, sy - 1 - h, FL[Math.floor(hash(x, sy, 68) * FL.length)]);
        }
      }
      // Plante suspendue.
      const hx = Math.round((s.x0 + s.x1) / 2);
      r.rect(hx, s.y0, 1, 3, C('#5a3420'));
      r.rect(hx - 2, s.y0 + 3, 5, 2, C('#b8643c'));
      for (let j = 0; j < 7; j++) r.set(hx - 3 + j, s.y0 + 5 + (j % 3), leaf[1 + (j % 3)]);
      for (let y = s.y0; y < s.y1; y++) for (let x = s.x0; x < s.x1; x++) if ((x - s.x0 + (s.y1 - y)) % 19 < 2) r.tint(x, y, [255, 255, 255], 0.16);
      for (let y = s.y0; y < s.y1; y++) for (let x = s.x0; x < s.x1; x++) glow[r.i(x, y)] = 1;
      r.rect(hx, s.y0, 1, s.y1 - s.y0, wood[1]);
      r.rect(s.x0 - 4, s.y1 + 2, s.x1 - s.x0 + 8, 2, C('#a49c8a'));
      r.rect(s.x0 - 3, s.y1 + 4, s.x1 - s.x0 + 6, L.FY0 - s.y1 - 4, wood[1]);
      if (look.snow) snowLine(r, s.x0 - 4, s.y1 + 1, s.x1 - s.x0 + 8);
      this.extHalos.push({ x: hx, y: L.cafe.cy, r: 28, c: [255, 196, 120], k: 0.16 });
      // Seaux de fleurs sur un gradin devant la boutique.
      const by = L.FY0 + 3;
      r.rect(s.x0 - 6, by - 4, s.x1 - s.x0 + 10, 4, C('#5a4030'));
      r.rect(s.x0 - 6, by - 4, s.x1 - s.x0 + 10, 1, C('#7a5a40'));
      const zinc = [C('#6a7480'), C('#8a96a2'), C('#b0bac4')];
      let k = 0;
      for (let x = s.x0 - 5; x < s.x1 + 1; x += 7, k++) {
        const top = by - 4 - (k % 2 ? 6 : 5);
        r.rect(x, top, 5, by - 4 - top, zinc[1]);
        r.rect(x, top, 1, by - 4 - top, zinc[2]);
        r.rect(x + 4, top, 1, by - 4 - top, zinc[0]);
        r.rect(x - 1, top, 7, 1, zinc[2]);
        const fc = FL[k % FL.length];
        for (let j = 0; j < 16; j++) {
          const px = x - 1 + Math.floor(hash(x, j, 71) * 7);
          const py = top - 1 - Math.floor(hash(j, x, 72) * 7);
          r.set(px, py, j % 3 ? fc : leaf[1 + (j % 2)]);
          if (j % 4 === 0) r.set(px, py + 1, leaf[0]);
        }
      }
    }

    // Arbre en bac (érable du square), lumière peinte ensuite par applyLight.
    paintTubTree(r, tx, R) {
      const { L, look } = this;
      const ramp = (look.leaves === 'sakura' ? ['#4a2c48', '#7a4870', '#ae6c92', '#dc98b4', '#f4c4d2'] : look.leaves === 'autumn' ? ['#40201a', '#6e341c', '#a0521e', '#cc7a2a', '#e8a444'] : BUSH).map(C);
      const bark = [C('#1e1614'), C('#3a2c26'), C('#56443a')];
      const by = L.FY0 + 4;
      const top = L.FY0 - 30;
      for (let y = top; y < by - 9; y++) {
        const wob = Math.round(Math.sin(y * 0.3 + tx) * 0.6);
        r.set(tx - 1 + wob, y, bark[1]);
        r.set(tx + wob, y, bark[2]);
        r.set(tx + 1 + wob, y, bark[0]);
      }
      this.line(r, tx, top + 8, tx - 7, top - 2, bark[1]);
      this.line(r, tx, top + 5, tx + 6, top - 4, bark[1]);
      const cl = [];
      for (let k = 0; k < 7; k++) cl.push(this.makeClump(tx + (R() - 0.5) * 18, top - 8 + (R() - 0.5) * 12, 6 + R() * 3, R));
      cl.push(this.makeClump(tx, top - 14, 8, R));
      cl.sort((a, b) => a.y - b.y);
      for (const c of cl) this.paintClump(r, null, c, ramp, false);
      // Le bac en bois.
      r.rect(tx - 8, by - 10, 17, 10, C('#6a4a30'));
      for (let y = by - 8; y < by; y += 3) r.rect(tx - 8, y, 17, 1, C('#4a3020'));
      r.rect(tx - 9, by - 11, 19, 2, C('#8a6440'));
      r.rect(tx - 8, by - 10, 1, 10, C('#8a6440'));
      if (look.snow) snowLine(r, tx - 9, by - 12, 19);
    }

    // La fontaine : bassin rond, colonne, vasque et pomme de pin (l'eau coule à chaque image).
    paintFountain(r) {
      const { L, look, X } = this;
      const fx = X.fountain;
      const cy = L.LB + 1;
      const rx = 30;
      const ry = 6;
      const st = [C('#4a463e'), C('#6a6458'), C('#8a8272'), C('#a8a090'), C('#c4bcaa')];
      const water = look.snow ? [C('#8a98b4'), C('#a8b4cc'), C('#d4dcec')] : [C('#1a3450'), C('#28506e'), C('#5a8cae')];
      this.fount = { x: fx, cy, rx, ry, vy: cy - 28, vr: 10 };
      // Paroi du bassin (devant) et margelle.
      for (let x = -rx; x <= rx; x++) {
        const e = Math.sqrt(Math.max(0, 1 - (x * x) / (rx * rx)));
        const yf = Math.round(cy + ry * e);
        for (let y = yf; y < yf + 6; y++) {
          let c = y === yf + 5 ? st[0] : x < -rx * 0.6 ? st[1] : x > rx * 0.5 ? st[1] : st[2];
          if (pmod(x + fx, 7) === 0 && y > yf) c = st[0];
          r.set(fx + x, y, c);
        }
      }
      for (let y = -ry - 2; y <= ry + 2; y++) {
        for (let x = -rx - 1; x <= rx + 1; x++) {
          const e = (x * x) / (rx * rx) + (y * y) / (ry * ry);
          const ei = (x * x) / ((rx - 3) * (rx - 3)) + (y * y) / ((ry - 1.6) * (ry - 1.6));
          if (e > 1.08) continue;
          let c;
          if (ei > 1) c = y < 0 ? st[3] : st[4];
          else {
            const q = (y + ry) / (2 * ry);
            c = q < 0.4 ? water[0] : water[1];
            if (hash(x, y, 81) > 0.9 || (y === 0 && pmod(x, 5) === 0)) c = water[2];
          }
          r.set(fx + x, cy + y, c);
        }
      }
      // Colonne, vasque, pomme de pin.
      r.rect(fx - 4, cy - 4, 9, 4, st[2]);
      r.rect(fx - 4, cy - 4, 9, 1, st[3]);
      r.rect(fx - 2, cy - 26, 5, 22, st[2]);
      r.rect(fx - 2, cy - 26, 1, 22, st[3]);
      r.rect(fx + 2, cy - 26, 1, 22, st[1]);
      r.rect(fx - 3, cy - 14, 7, 2, st[3]);
      const vy = cy - 28;
      for (let y = -2; y <= 3; y++) {
        const hw = y < 1 ? 10 : 10 - (y * 2 + 1);
        for (let x = -hw; x <= hw; x++) r.set(fx + x, vy + y, y === -2 ? st[4] : y < 0 ? (Math.abs(x) < hw - 1 ? water[1] : st[3]) : x < 0 ? st[3] : st[2]);
      }
      r.rect(fx - 1, vy - 6, 3, 4, st[2]);
      for (let y = -4; y <= 0; y++) for (let x = -2; x <= 2; x++) if (x * x + y * y * 0.6 <= 4.5) r.set(fx + x, vy - 7 + y, (x + y) % 2 ? st[3] : st[2]);
      r.set(fx, vy - 12, st[3]);
      if (look.snow) snowLine(r, fx - 9, vy - 3, 19);
    }

    // Le kiosque à journaux : vert, coupole festonnée, fronton « PRESSE », lucarne éclairée.
    paintKiosk(r, glow) {
      const { L, look, X } = this;
      const kx = X.kiosk;
      const by = L.FY0 + 4;
      const top = L.FY0 - 44;
      const g = [C('#132a20'), C('#1e3e2e'), C('#2a5640'), C('#3e7458'), C('#5a9472')];
      const gold = C('#d8b060');
      // Corps (un cylindre : clair au centre gauche, sombre sur les bords).
      for (let y = top; y < by; y++) {
        for (let x = -14; x <= 14; x++) {
          const u = x / 14;
          let i = u < -0.85 ? 1 : u < -0.2 ? 3 : u < 0.5 ? 2 : u < 0.85 ? 1 : 0;
          if (pmod(x + 14, 7) === 0) i = Math.max(0, i - 1);
          r.set(kx + x, y, g[i]);
        }
      }
      r.rect(kx - 14, by - 3, 29, 3, g[0]);
      // Affiches sous le comptoir.
      const posters = [['#e8e0cc', '#2a2a30'], ['#d8443c', '#f4ecd8'], ['#f0c63c', '#2a2a30'], ['#3a6ab0', '#f4ecd8']];
      for (let k = 0; k < 4; k++) {
        const px = kx - 13 + k * 7;
        const [bg, fg] = posters[k].map(C);
        r.rect(px, L.FY0 - 12, 6, 9, bg);
        r.rect(px + 1, L.FY0 - 11, 4, 1, fg);
        r.rect(px + 1, L.FY0 - 9, 3, 1, fg);
        r.rect(px + 1, L.FY0 - 7, 4, 2, mix(bg, fg, 0.4));
      }
      // Comptoir et ouverture éclairée : revues en rayons, le marchand.
      const oy0 = L.FY0 - 35;
      const oy1 = L.FY0 - 15;
      r.gradient(kx - 11, oy0, 23, oy1 - oy0, [C('#ffe8b0'), C('#ffcc80'), C('#e89a58')], 6);
      const MAG = ['#d8443c', '#3a6ab0', '#f0c63c', '#e8e0cc', '#4a9a6a', '#e070a0', '#2a2a30'].map(C);
      for (const sy of [oy0 + 4, oy0 + 10]) {
        for (let x = kx - 10; x < kx + 11; x += 3) {
          const c = MAG[Math.floor(hash(x, sy, 91) * MAG.length)];
          r.rect(x, sy, 2, 4, c);
          r.set(x, sy, mix(c, [255, 255, 255], 0.3));
        }
        r.rect(kx - 11, sy + 4, 23, 1, C('#8a5a34'));
      }
      const sil = C('#4a2a20');
      r.rect(kx + 2, oy1 - 9, 4, 4, sil);
      r.rect(kx, oy1 - 5, 8, 5, sil);
      r.rect(kx + 1, oy1 - 10, 6, 1, sil);
      for (let y = oy0; y < oy1; y++) for (let x = kx - 11; x < kx + 12; x++) glow[r.i(x, y)] = 1;
      r.rect(kx - 13, oy1, 27, 2, C('#6a4228'));
      r.rect(kx - 13, oy1, 27, 1, C('#8a5a36'));
      r.rect(kx - 11, oy1 + 2, 23, 1, g[0]);
      // Fronton écrit, corniche, coupole festonnée et sa flèche.
      r.rect(kx - 14, top, 29, 7, g[1]);
      r.rect(kx - 14, top + 6, 29, 1, gold);
      PXC.text(r, 'PRESSE', kx - 11, top + 1, gold);
      r.rect(kx - 16, top - 2, 33, 2, g[3]);
      r.rect(kx - 16, top - 2, 33, 1, g[4]);
      for (let x = -16; x <= 16; x++) if (pmod(x, 4) < 2) r.set(kx + x, top, g[2]);
      for (let k = 0; k < 11; k++) {
        const hw = Math.round(15 * Math.sqrt(1 - (k / 11) ** 2));
        for (let x = -hw; x <= hw; x++) {
          const u = x / Math.max(1, hw);
          r.set(kx + x, top - 3 - k, k % 3 === 0 && pmod(x, 3) === 0 ? g[1] : u < -0.3 ? g[3] : u < 0.4 ? g[2] : g[1]);
        }
      }
      r.rect(kx - 1, top - 16, 3, 2, gold);
      r.rect(kx, top - 20, 1, 4, gold);
      r.set(kx, top - 21, C('#f4dc98'));
      if (look.snow) {
        snowLine(r, kx - 16, top - 3, 33);
        snowLine(r, kx - 13, oy1 - 1, 27);
      }
      this.extHalos.push({ x: kx, y: L.FY0 - 25, r: 22, c: [255, 186, 110], k: 0.2 });
    }

    // Un vélo de ville appuyé contre le muret, une baguette dans le panier.
    paintBike(r, bx) {
      const { L } = this;
      const gy = L.FY0 + 1;
      const tyre = C('#16181e');
      const spoke = C('#4a505e');
      const frame = C('#3e9a8a');
      const frameD = C('#2a6a60');
      const wheel = (cx, cy) => {
        for (let a = 0; a < 48; a++) {
          const t = (a / 48) * Math.PI * 2;
          r.set(Math.round(cx + Math.cos(t) * 6), Math.round(cy + Math.sin(t) * 6), tyre);
          r.set(Math.round(cx + Math.cos(t) * 5), Math.round(cy + Math.sin(t) * 5), spoke);
        }
        for (let k = 0; k < 4; k++) this.line(r, cx, cy, Math.round(cx + Math.cos(k * 0.8) * 4), Math.round(cy + Math.sin(k * 0.8) * 4), spoke);
        r.set(cx, cy, C('#8a909a'));
      };
      const rw = [bx - 9, gy - 6];
      const fw = [bx + 10, gy - 6];
      wheel(...rw);
      wheel(...fw);
      const bb = [bx, gy - 5];
      const st = [bx - 3, gy - 14];
      const hd = [bx + 7, gy - 14];
      this.line(r, ...bb, ...st, frame);
      this.line(r, ...st, ...hd, frame);
      this.line(r, ...hd, ...bb, frame);
      this.line(r, ...bb, ...rw, frameD);
      this.line(r, ...st, ...rw, frameD);
      this.line(r, ...hd, ...fw, frame);
      this.line(r, hd[0], hd[1], hd[0] - 1, hd[1] - 3, frameD);
      r.rect(hd[0] - 3, hd[1] - 4, 4, 1, C('#2a2a30'));
      r.rect(st[0] - 3, st[1] - 2, 5, 1, C('#3a2418'));
      r.rect(st[0] - 2, st[1] - 1, 3, 1, C('#5a3a24'));
      // Panier en osier et sa baguette.
      const wk = [C('#8a6a3a'), C('#b08a4a')];
      for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) r.set(hd[0] + 2 + x, hd[1] - 3 + y, (x + y) % 2 ? wk[0] : wk[1]);
      this.line(r, hd[0] + 3, hd[1] - 4, hd[0] + 8, hd[1] - 10, C('#d8a050'));
      this.line(r, hd[0] + 4, hd[1] - 4, hd[0] + 9, hd[1] - 10, C('#b07a34'));
      r.set(hd[0] + 6, hd[1] - 5, C('#e84a5a'));
      r.set(hd[0] + 5, hd[1] - 5, C('#3e7a40'));
    }

    paintShadows(r) {
      const { L } = this;
      const shade = [12, 14, 28];
      const ell = (cx, cy, rx, ry, k) => {
        for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) r.tint(cx + x, cy + y, shade, k);
      };
      ell(L.benchX + 20, L.LB + 6, 24, 3, 0.45);
      ell(L.tableX, L.LB + 8, 26, 3, 0.4);
      ell(L.LX, L.LB + 1, 8, 2, 0.5);
      ell(L.TX, L.FY0 + 8, 18, 3, 0.35);
      if (this.wide) {
        const X = this.X;
        r.only(() => {
          for (const cx of X.tables) ell(cx, L.LB + 8, 26, 3, 0.4);
          ell(X.lamp, L.LB + 1, 8, 2, 0.5);
          ell(X.bench + 20, L.LB + 6, 24, 3, 0.45);
          ell(X.fountain, L.LB + 9, 34, 3, 0.4);
          ell(X.kiosk, L.FY0 + 5, 17, 2, 0.4);
          ell(X.bike, L.FY0 + 1, 16, 1, 0.35);
          for (const tx of X.trees) ell(tx, L.FY0 + 5, 11, 2, 0.35);
          ell(X.metro + 32, L.LB + 8, 34, 4, 0.4);
        });
      }
    }

    /* ================= Le prolongement, premier plan ================= */
    paintExtFore(r, glow, R) {
      const { L, look, X } = this;
      // Deux tables de la terrasse du café, sous une guirlande.
      this.paintTable(r, X.tables[0], { glasses: [-7, 4], carafe: true, candle: -2 });
      this.paintTable(r, X.tables[1], { cups: [-6, 3], candle: 8 });
      const pa = X.BX - 8;
      const pb = X.pole;
      const iron = [C('#121419'), C('#262a34'), C('#464c5a')];
      const ptop = L.SC2 + 4;
      for (const px of [pa, pb]) {
        r.rect(px, ptop, 2, L.LB + 7 - ptop, iron[1]);
        r.rect(px, ptop, 1, L.LB + 7 - ptop, iron[2]);
        r.rect(px - 2, L.LB + 6, 6, 2, iron[1]);
        r.rect(px - 1, ptop - 2, 4, 2, iron[2]);
        r.set(px, ptop - 3, iron[2]);
      }
      const BULB = ['#ffe6a0', '#ffd27a', '#ffb870', '#fff0c8'].map(C);
      for (const [y0, sag, ph] of [[ptop + 3, 14, 0], [ptop + 9, 10, 3]]) {
        const n = pb - pa;
        for (let k = 0; k <= -n; k++) {
          const x = pa - k;
          const u = k / -n;
          const y = Math.round(y0 + sag * 4 * u * (1 - u));
          r.set(x, y, iron[0]);
          if (pmod(k + ph, 7) === 3 && k > 2 && k < -n - 2) {
            const c = BULB[pmod(k + ph, 4)];
            r.set(x, y + 1, iron[1]);
            r.set(x, y + 2, c);
            r.set(x, y + 3, mix(c, [255, 255, 255], 0.3));
            glow[r.i(x, y + 2)] = 1;
            glow[r.i(x, y + 3)] = 1;
            this.bulbs.push({ x, y: y + 2, p: hash(x, y, 93) * 6 });
            this.extHalos.push({ x, y: y + 3, r: 5, c: [255, 200, 120], k: 0.3 });
          }
        }
      }
      // Le second lampadaire.
      this.paintLamp(r, glow, X.lamp);
      this.extHalos.push({ x: X.lamp, y: L.LY, r: 48, c: [255, 176, 96], k: 0.42 }, { x: X.lamp, y: L.LY, r: 15, c: [255, 232, 170], k: 0.65 });
      // La fontaine du square.
      if (X.fountain > r.x0 + 32) this.paintFountain(r);
      // De grandes plantes en pot, tout devant.
      if (X.plants[0] > r.x0 + 20) this.paintBigPlant(r, R, X.plants[0]);
      if (X.plants[1] > r.x0 + 20) this.paintLavender(r, X.plants[1], R);
      // Le banc du square (un lecteur s'y assoit : voir buildExtLife).
      if (X.bench > r.x0 + 4) this.paintBench(r, X.bench);
      // Pots de fleurs.
      for (const px of X.pots) if (px > r.x0 + 14) this.paintPots(r, px, R);
      // La bouche de métro, tout à gauche.
      if (X.metro > r.x0 + 4) this.paintMetro(r, glow);
    }

    // Une longue jardinière de lavande, tout devant.
    paintLavender(r, px, R) {
      const { H, look } = this;
      const base = H - 12;
      const stem = [C('#3a5a3a'), C('#4e7448'), C('#6a8a5a')];
      const flower = (look.leaves === 'autumn' ? ['#6a4a7a', '#8a6a9a'] : ['#7a5ab8', '#9a7ad0', '#b89ae0']).map(C);
      for (let k = 0; k < 26; k++) {
        const x0 = px - 16 + Math.floor(R() * 33);
        const len = 9 + Math.floor(R() * 9);
        const lean = (x0 - px) / 40 + (R() - 0.5) * 0.3;
        for (let j = 0; j < len; j++) {
          const x = Math.round(x0 + lean * j);
          const y = base - j;
          if (j < len - 5) r.set(x, y, stem[Math.min(2, Math.floor(j / 4))]);
          else {
            r.set(x, y, flower[(j + k) % flower.length]);
            if ((j + k) % 2) r.set(x + 1, y, flower[0]);
          }
        }
      }
      r.rect(px - 19, base, 39, 12, C('#5a3c26'));
      for (let y = base + 3; y < H; y += 3) r.rect(px - 19, y, 39, 1, C('#3e2818'));
      r.rect(px - 20, base - 1, 41, 2, C('#7a5638'));
      r.rect(px - 19, base, 1, 12, C('#7a5638'));
      if (look.snow) snowLine(r, px - 20, base - 2, 41);
    }

    // Groupe de pots : un grand avec un buis, deux petits avec des géraniums.
    paintPots(r, px, R) {
      const { L, look } = this;
      const bush = BUSH.map(C);
      const gy = L.LB + 8;
      const geranium = look.leaves === 'autumn' ? C('#e8803a') : C('#e04a4a');
      this.paintClump(r, null, this.makeClump(px, gy - 19, 7, R), bush, false);
      r.rect(px - 6, gy - 12, 13, 12, C('#a85a38'));
      r.rect(px - 7, gy - 12, 15, 2, C('#c8784a'));
      r.rect(px + 3, gy - 10, 2, 10, C('#7a4028'));
      r.rect(px - 5, gy - 10, 1, 10, C('#c06e46'));
      for (const [ox, sz] of [[-13, 4], [12, 3]]) {
        const cx = px + ox;
        this.paintClump(r, null, this.makeClump(cx, gy - sz - 6, sz + 1, R), bush, false);
        for (let j = 0; j < 7; j++) r.set(cx - sz + Math.floor(R() * sz * 2), gy - sz - 8 + Math.floor(R() * 5), j % 3 ? geranium : mix(geranium, [255, 255, 255], 0.3));
        r.rect(cx - sz, gy - sz - 2, sz * 2 + 1, sz + 2, C('#a85a38'));
        r.rect(cx - sz - 1, gy - sz - 2, sz * 2 + 3, 1, C('#c8784a'));
        r.rect(cx + sz - 1, gy - sz - 1, 1, sz + 1, C('#7a4028'));
      }
      if (look.snow) snowLine(r, px - 7, gy - 13, 15);
    }

    // Bouche de métro « Guimard » : garde-corps en fonte vert, deux lampes orange au bout
    // de leurs tiges, l'enseigne METRO, et les marches qui descendent.
    paintMetro(r, glow) {
      const { L, look, X } = this;
      const mx = X.metro;
      const gy = L.LB + 8;
      const w = 64;
      const g = [C('#14261e'), C('#22402f'), C('#356048'), C('#4e8064')];
      // La trémie : les marches plongent sous la place, de plus en plus sombres.
      const back = gy - 11;
      for (let y = back; y < gy - 1; y++) {
        for (let x = mx + 7; x < mx + w - 7; x++) {
          const d = (y - back) / (gy - 1 - back);
          let c = mix(C('#0c0c12'), C('#4a453e'), d * d);
          if ((gy - 1 - y) % 2 === 0) c = mix(c, [255, 226, 180], 0.12 * d);
          r.set(x, y, c);
        }
      }
      r.rect(mx + 6, back - 1, w - 12, 1, g[1]);
      r.rect(mx + 6, back - 1, 1, gy - back, g[1]);
      r.rect(mx + w - 7, back - 1, 1, gy - back, g[1]);
      // Garde-corps : lisse haute, barreaux, volutes.
      const ry = gy - 13;
      r.rect(mx + 5, ry, w - 10, 2, g[2]);
      r.rect(mx + 5, ry, w - 10, 1, g[3]);
      r.rect(mx + 5, gy - 2, w - 10, 1, g[1]);
      for (let x = mx + 8; x < mx + w - 7; x += 4) {
        r.rect(x, ry + 2, 1, gy - 2 - ry - 2, g[1]);
        if (pmod(x - mx, 8) === 0) {
          r.set(x + 1, ry + 5, g[2]);
          r.set(x + 2, ry + 6, g[2]);
          r.set(x + 1, ry + 7, g[2]);
          r.set(x - 1, ry + 8, g[2]);
          r.set(x - 2, ry + 9, g[2]);
        }
      }
      // Les deux tiges, recourbées comme des plantes, et leurs lampes.
      const lampC = [C('#ff7a3a'), C('#ffb060'), C('#ffe0a0')];
      const stems = [[mx + 4, 1], [mx + w - 5, -1]];
      this.metroLamps = [];
      for (const [sx, dir] of stems) {
        for (let y = gy; y > gy - 44; y--) {
          const bend = y < gy - 34 ? Math.round(((gy - 34 - y) ** 2) / 28) * dir : 0;
          r.set(sx + bend, y, g[1]);
          r.set(sx + bend + 1, y, y < gy - 2 ? g[2] : g[1]);
        }
        const lx = sx + Math.round((10 ** 2) / 28) * dir + (dir > 0 ? 1 : 0);
        const ly = gy - 48;
        for (let y = -3; y <= 3; y++) {
          for (let x = -2; x <= 2; x++) {
            if (x * x / 4 + y * y / 9 > 1.05) continue;
            r.set(lx + x, ly + y, Math.abs(x) + Math.abs(y) < 2 ? lampC[2] : y < 0 ? lampC[1] : lampC[0]);
            glow[r.i(lx + x, ly + y)] = 1;
          }
        }
        r.rect(lx - 1, ly - 4, 3, 1, g[2]);
        r.rect(lx - 1, ly + 4, 3, 1, g[1]);
        this.metroLamps.push({ x: lx, y: ly });
        this.extHalos.push({ x: lx, y: ly, r: 24, c: [255, 150, 80], k: 0.32 }, { x: lx, y: ly, r: 7, c: [255, 210, 150], k: 0.5 });
      }
      // L'enseigne, portée par un arc de fonte.
      const sy = gy - 40;
      const sx0 = mx + 20;
      const sx1 = mx + w - 20;
      for (let x = mx + 6; x < mx + w - 6; x++) {
        const u = (x - mx - 6) / (w - 12);
        r.set(x, Math.round(sy - 3 - Math.sin(u * Math.PI) * 4), g[2]);
      }
      r.rect(sx0 - 1, sy - 1, sx1 - sx0 + 2, 9, g[1]);
      r.rect(sx0, sy, sx1 - sx0, 7, C('#f0d890'));
      PXC.text(r, 'METRO', Math.round((sx0 + sx1) / 2 - 9.5), sy + 1, C('#1e3a2c'));
      for (let y = sy; y < sy + 7; y++) for (let x = sx0; x < sx1; x++) glow[r.i(x, y)] = 1;
      this.extHalos.push({ x: Math.round((sx0 + sx1) / 2), y: sy + 3, r: 16, c: [255, 220, 150], k: 0.16 });
      if (look.snow) snowLine(r, mx + 5, ry - 1, w - 10);
    }

    paintLitter(r, R) {
      const { W, H, L, look } = this;
      const cols = (look.litter === 'petals' ? ['#f4c0cc', '#e898ae', '#fbe0e6', '#f0a8bc'] : ['#d8742a', '#b84a20', '#e8a83a', '#8a3a1a', '#c8862a']).map(C);
      for (let k = 0; k < 520; k++) {
        const near = R() < 0.6;
        const x = near ? Math.round(L.LX - 40 + R() * (W - L.LX + 40)) : Math.floor(R() * W);
        const y = L.FY0 + 1 + Math.floor(Math.pow(R(), 0.9) * (H - L.FY0 - 2));
        if (!this.floorMask[r.i(x, y)]) continue;
        const c = cols[Math.floor(R() * cols.length)];
        r.set(x, y, c);
        if (R() < (look.litter === 'petals' ? 0.3 : 0.65)) r.set(x + 1, y, mix(c, [0, 0, 0], 0.2));
      }
      // Le prolongement a sa propre litière (autre graine).
      if (this.wide) {
        const RL = rng(347);
        const n = Math.round((300 * (this.extL + this.extR)) / W);
        r.only(() => {
          for (let k = 0; k < n; k++) {
            const u = RL() * (this.extL + this.extR);
            const x = Math.floor(u < this.extL ? -1 - u : W + u - this.extL);
            const y = L.FY0 + 1 + Math.floor(Math.pow(RL(), 0.9) * (H - L.FY0 - 2));
            const c = cols[Math.floor(RL() * cols.length)];
            if (!this.floorMask[r.i(x, y)]) continue;
            r.set(x, y, c);
            if (RL() < (look.litter === 'petals' ? 0.3 : 0.65)) r.set(x + 1, y, mix(c, [0, 0, 0], 0.2));
          }
          for (let k = 0; k < 40; k++) {
            const x = Math.round(r.x0 + RL() * (this.X.BX - r.x0));
            r.set(x, RL() < 0.5 ? L.parapet : L.railTop, cols[Math.floor(RL() * cols.length)]);
          }
        });
      }
      // Sur le couronnement du muret, la rambarde et le store.
      for (let k = 0; k < 50; k++) {
        const x = Math.round(L.FX + R() * (W - L.FX));
        r.set(x, R() < 0.5 ? L.parapet : L.railTop, cols[Math.floor(R() * cols.length)]);
      }
      for (let k = 0; k < 10; k++) r.set(Math.round(L.cafe.x0 + R() * (L.cafe.x1 - L.cafe.x0)), L.SC2 + 5 + Math.floor(R() * 3), cols[Math.floor(R() * cols.length)]);
    }

    // Sol mouillé : il reflète la ville, la vitrine, la rambarde et la lampe.
    wetFloor(r) {
      const { W, H, L } = this;
      const bk = this.backR;
      const inP = (list, x, y) => list.some((p) => ((x - p.x) * (x - p.x)) / (p.rx * p.rx) + ((y - p.y) * (y - p.y)) / (p.ry * p.ry) <= 1);
      const extP = this.extPuddles || [];
      // L'écran ne voit que ses flaques et ses reflets (comme sans prolongement).
      const inPuddle = (x, y) => inP(this.puddles, x, y) || ((x < 0 || x >= W) && inP(extP, x, y));
      for (let y = L.FY0; y < H; y++) {
        for (let x = r.x0; x < r.x1; x++) {
          if (!this.floorMask[r.i(x, y)]) continue;
          const sy = 2 * L.FY0 - y - 2 + Math.round(Math.sin(y * 1.3 + x * 0.05) * 0.8);
          let sx = x + Math.round(Math.sin(y * 0.9) * 1.2);
          if (x >= 0 && x < W) sx = Math.max(0, Math.min(W - 1, sx));
          let src = r.get(sx, sy);
          if (!src[3]) src = bk.get(sx, sy);
          const lum = src[0] + src[1] + src[2];
          const pud = inPuddle(x, y);
          let k = pud ? 0.62 : lum > 330 ? 0.4 : 0.16;
          if (!pud && y % 2 === 1 && hash(x >> 2, y, 12) < 0.45) k *= 0.35;
          r.tint(x, y, src, k);
          if (pud && hash(x, y, 13) > 0.97) r.tint(x, y, [200, 215, 240], 0.5);
        }
      }
      // Longue traînée de lumière sous le lampadaire.
      for (let y = L.LB + 2; y < H; y++) {
        const f = 1 - (y - L.LB) / (H - L.LB + 6);
        const w = 1 + (y - L.LB) / 12;
        for (let x = Math.floor(L.LX - w); x <= Math.ceil(L.LX + w); x++) {
          if (x < r.x0 || x >= r.x1 || !this.floorMask[r.i(x, y)]) continue;
          const side = Math.abs(x - L.LX) / (w + 1);
          if (hash(x, y >> 1, 14) < 0.75 - side * 0.5 && (y + (x & 1)) % 3 !== 0) r.tint(x, y, [255, 214, 140], 0.55 * f);
        }
      }
      // Et sous le second lampadaire, dans le prolongement.
      if (this.wide) {
        const lx = this.X.lamp;
        r.only(() => {
          for (let y = L.LB + 2; y < H; y++) {
            const f = 1 - (y - L.LB) / (H - L.LB + 6);
            const w = 1 + (y - L.LB) / 12;
            for (let x = Math.floor(lx - w); x <= Math.ceil(lx + w); x++) {
              if (x < r.x0 || x >= r.x1 || !this.floorMask[r.i(x, y)]) continue;
              const side = Math.abs(x - lx) / (w + 1);
              if (hash(x, y >> 1, 14) < 0.75 - side * 0.5 && (y + (x & 1)) % 3 !== 0) r.tint(x, y, [255, 214, 140], 0.55 * f);
            }
          }
        });
      }
    }

    /* ================= Calque de premier plan ================= */
    paintFore() {
      const { W, H, look } = this;
      const R = rng(23);
      const r = new Wide(W, H, this.extL, this.extR);
      const glow = new Uint8Array(r.sw * H);
      this.paintMenuBoard(r);
      this.paintTable(r);
      this.paintBench(r);
      this.paintCase(r, R);
      this.paintLamp(r, glow);
      this.paintBigPlant(r, R);
      if (this.wide) r.only(() => this.paintExtFore(r, glow, rng(353)));
      if (look.snow) snowCaps(r, glow);
      applyLight(r, this.lights(), look.ambient, look.warm, (x, y) => !glow[r.i(x, y)], this.X && this.X.lights);
      return r.toCanvas();
    }

    paintLamp(r, glow, x = this.L.LX) {
      const { L } = this;
      const y = L.LY;
      const b = L.LB;
      const iron = [C('#121419'), C('#262a34'), C('#464c5a'), C('#626a7a')];
      // Socle à gradins.
      r.rect(x - 5, b - 3, 11, 3, iron[1]);
      r.rect(x - 4, b - 6, 9, 3, iron[1]);
      r.rect(x - 3, b - 11, 7, 5, iron[1]);
      for (const [yy, hw] of [[b - 3, 5], [b - 6, 4], [b - 11, 3]]) {
        r.rect(x - hw, yy, 1, 2, iron[2]);
        r.rect(x - hw, yy, hw * 2 + 1, 1, iron[2]);
        r.rect(x + hw, yy + 1, 1, 2, iron[0]);
      }
      // Fût cannelé.
      const fTop = y + 11;
      r.rect(x - 1, fTop, 3, b - 11 - fTop, iron[1]);
      r.rect(x - 1, fTop, 1, b - 11 - fTop, iron[2]);
      r.rect(x + 1, fTop, 1, b - 11 - fTop, iron[0]);
      for (const ry of [fTop + 4, Math.round((fTop + b) / 2), b - 16]) {
        r.rect(x - 2, ry, 5, 2, iron[1]);
        r.rect(x - 2, ry, 5, 1, iron[2]);
      }
      // Console à volutes sous la lanterne.
      r.rect(x - 3, y + 8, 7, 2, iron[1]);
      r.rect(x - 3, y + 8, 7, 1, iron[2]);
      for (const s of [-1, 1]) {
        r.set(x + s * 4, y + 7, iron[1]);
        r.set(x + s * 5, y + 6, iron[1]);
        r.set(x + s * 5, y + 5, iron[2]);
        r.set(x + s * 4, y + 5, iron[1]);
        r.set(x + s * 2, y + 10, iron[1]);
      }
      // Lanterne : verre plus large en haut, montants de fonte.
      for (let k = 0; k < 11; k++) {
        const yy = y - 5 + k;
        const hw = k < 6 ? 4 : 3;
        for (let dx = -hw; dx <= hw; dx++) {
          const edge = Math.abs(dx) === hw;
          let c;
          if (edge || dx === 0) c = iron[1];
          else {
            const core = Math.abs(dx) <= 1 && k > 2 && k < 9;
            c = core ? C('#fffbe6') : k < 3 ? C('#ffe6a0') : C('#ffd27a');
            glow[r.i(x + dx, yy)] = 1;
          }
          r.set(x + dx, yy, c);
        }
      }
      r.rect(x - 4, y + 6, 9, 1, iron[2]);
      r.rect(x - 3, y + 7, 7, 1, iron[1]);
      // Chapeau et pointe.
      r.rect(x - 6, y - 6, 13, 1, iron[2]);
      r.rect(x - 5, y - 7, 11, 1, iron[1]);
      r.rect(x - 4, y - 8, 9, 1, iron[1]);
      r.rect(x - 3, y - 9, 7, 1, iron[2]);
      r.rect(x - 2, y - 10, 5, 1, iron[1]);
      r.rect(x - 1, y - 11, 3, 1, iron[1]);
      r.rect(x, y - 14, 1, 3, iron[2]);
      r.rect(x - 1, y - 13, 3, 1, iron[1]);
    }

    paintBench(r, x0 = this.L.benchX) {
      const { L } = this;
      const x1 = x0 + 40;
      const sy = L.seatY;
      const wood = [C('#4a2e1a'), C('#7a4e2c'), C('#a06a3e'), C('#c08850')];
      const iron = [C('#121419'), C('#262a34'), C('#464c5a')];
      // Lattes du dossier.
      for (const ly of [sy - 15, sy - 11, sy - 7]) {
        r.rect(x0 + 1, ly, x1 - x0 - 2, 3, wood[1]);
        r.rect(x0 + 1, ly, x1 - x0 - 2, 1, wood[2]);
        r.rect(x0 + 1, ly + 2, x1 - x0 - 2, 1, wood[0]);
        for (let x = x0 + 2; x < x1 - 2; x++) if (hash(x, ly, 31) > 0.85) r.set(x, ly + 1, wood[0]);
      }
      // Assise.
      r.rect(x0, sy, x1 - x0, 1, wood[3]);
      r.rect(x0, sy + 1, x1 - x0, 2, wood[1]);
      r.rect(x0, sy + 3, x1 - x0, 1, wood[0]);
      // Flancs en fonte : montant, accoudoir, pieds.
      for (const ex of [x0, x1 - 2]) {
        r.rect(ex, sy - 16, 2, 20, iron[1]);
        r.rect(ex, sy - 16, 1, 20, iron[2]);
        r.rect(ex - 1, sy - 6, 4, 1, iron[2]);
        r.rect(ex - 1, sy - 5, 1, 2, iron[1]);
        r.rect(ex, sy + 4, 1, L.LB + 6 - sy - 4, iron[1]);
        r.rect(ex + 1, sy + 4, 1, L.LB + 5 - sy - 4, iron[0]);
        r.set(ex - 1, L.LB + 5, iron[1]);
        r.set(ex + 2, L.LB + 5, iron[1]);
      }
    }

    // o : variante d'une autre table (prolongement) : { cup, candle, vase, menu }.
    paintTable(r, cx = this.L.tableX, o = null) {
      const { L } = this;
      const ty = L.tableY;
      const iron = [C('#121419'), C('#262a34'), C('#464c5a')];
      // Chaises bistrot en rotin, de part et d'autre.
      const frame = [C('#3a2014'), C('#5a3420'), C('#8a5a34')];
      const weave = [C('#c89a5a'), C('#9a7038')];
      for (const ox of [-24, 14]) {
        const x0 = cx + ox;
        const sy = L.LB - 1;
        r.rect(x0, sy - 14, 10, 1, frame[2]);
        r.rect(x0, sy - 13, 1, 13, frame[1]);
        r.rect(x0 + 9, sy - 13, 1, 13, frame[1]);
        for (let y = sy - 13; y < sy - 4; y++) for (let x = x0 + 1; x < x0 + 9; x++) r.set(x, y, (x + y) % 2 ? weave[0] : weave[1]);
        r.rect(x0 + 1, sy - 4, 8, 1, frame[0]);
        r.rect(x0 - 1, sy - 3, 12, 2, weave[0]);
        r.rect(x0 - 1, sy - 1, 12, 1, frame[1]);
        r.rect(x0 - 1, sy, 1, 10, frame[1]);
        r.rect(x0 + 10, sy, 1, 10, frame[1]);
        r.rect(x0 + 1, sy, 1, 8, frame[0]);
        r.rect(x0 + 8, sy, 1, 8, frame[0]);
        r.rect(x0 - 1, sy + 5, 12, 1, frame[0]);
      }
      // Pied en fonte.
      r.rect(cx - 1, ty + 4, 3, L.LB + 7 - ty - 4, iron[1]);
      r.rect(cx - 1, ty + 4, 1, L.LB + 7 - ty - 4, iron[2]);
      r.rect(cx - 6, L.LB + 7, 13, 1, iron[1]);
      r.rect(cx - 4, L.LB + 6, 9, 1, iron[2]);
      // Plateau de marbre.
      for (let y = -3; y <= 3; y++) {
        for (let x = -11; x <= 11; x++) {
          const e = (x * x) / 121 + (y * y) / 9;
          if (e > 1) continue;
          let c = C('#d8d2c4');
          if (y >= 2 || e > 0.8) c = C('#a8a294');
          else if (y < 0 && x < 0 && e < 0.5) c = C('#ece8dc');
          if (hash(x, y, 33) > 0.9) c = C('#bab4a8');
          r.set(cx + x, ty + y, c);
        }
      }
      r.rect(cx - 10, ty + 3, 21, 1, C('#6a6458'));
      if (o) {
        // Une autre table : verres, carafe, bougie… selon la variante.
        if (o.glasses) {
          for (const gx of o.glasses) {
            r.rect(cx + gx, ty - 4, 2, 3, C('#c8d8e0'));
            r.set(cx + gx, ty - 4, C('#eef4f6'));
            r.set(cx + gx + 1, ty - 2, C('#c04a4a'));
            r.set(cx + gx, ty - 2, C('#c04a4a'));
          }
        }
        if (o.carafe) {
          r.rect(cx - 1, ty - 6, 3, 5, C('#b8ccd4'));
          r.rect(cx, ty - 8, 1, 2, C('#b8ccd4'));
          r.rect(cx - 1, ty - 4, 3, 3, C('#e8a040'));
        }
        if (o.cups) {
          for (const gx of o.cups) {
            r.rect(gx + cx - 2, ty - 1, 6, 1, C('#e8e0d0'));
            r.rect(gx + cx - 1, ty - 4, 4, 3, C('#f0e8dc'));
            r.rect(gx + cx - 1, ty - 4, 4, 1, C('#5a321e'));
          }
        }
        if (o.candle != null) {
          r.rect(cx + o.candle - 1, ty - 4, 3, 4, C('#c8823e'));
          r.rect(cx + o.candle - 1, ty - 4, 3, 1, C('#e8b070'));
        }
        return;
      }
      // Tasse et soucoupe, bougie dans un photophore, petit vase.
      const u = L.cup;
      r.rect(u.x - 2, ty - 1, 7, 1, C('#e8e0d0'));
      r.rect(u.x - 1, u.y + 1, 5, 3, C('#f0e8dc'));
      r.rect(u.x - 1, u.y + 1, 5, 1, C('#5a321e'));
      r.rect(u.x + 4, u.y + 2, 1, 1, C('#d8d0c4'));
      r.rect(L.candle.x - 1, ty - 4, 3, 4, C('#c8823e'));
      r.rect(L.candle.x - 1, ty - 4, 3, 1, C('#e8b070'));
      r.rect(cx, ty - 4, 2, 3, C('#5a8ab0'));
      r.set(cx, ty - 5, C('#3e7a40'));
      r.set(cx + 1, ty - 6, C('#3e7a40'));
      r.set(cx + 1, ty - 7, C('#e84a5a'));
      r.set(cx + 2, ty - 7, C('#e84a5a'));
    }

    paintMenuBoard(r) {
      const { L } = this;
      const x0 = Math.round(L.FX * 0.36);
      const w = 20;
      const top = L.LB - 27;
      const h = 22;
      const wood = [C('#3e2414'), C('#6a4228'), C('#8a5a36')];
      // Pieds du chevalet.
      r.rect(x0 + 1, top + h, 2, 5, wood[1]);
      r.rect(x0 + w - 3, top + h, 2, 5, wood[1]);
      r.rect(x0 + 2, top + h + 2, w - 4, 1, wood[0]);
      r.rect(x0, top, w, h, wood[1]);
      r.rect(x0, top, w, 1, wood[2]);
      r.rect(x0 + w - 1, top, 1, h, wood[0]);
      r.rect(x0 + 2, top + 2, w - 4, h - 4, C('#1c2622'));
      const chalk = C('#e2e8de');
      PXC.text(r, 'MENU', x0 + 3, top + 3, chalk);
      for (let k = 0; k < 3; k++) {
        const ly = top + 10 + k * 3;
        const len = 7 + Math.floor(hash(k, 3) * 5);
        for (let x = x0 + 3; x < x0 + 3 + len; x++) if (hash(x, ly, 5) > 0.2) r.set(x, ly, chalk);
        r.rect(x0 + w - 6, ly, 3, 1, C('#e8a0a8'));
      }
    }

    paintCase(r) {
      const { L } = this;
      const x0 = L.benchX - 3;
      const y0 = L.LB + 8;
      // Étui de guitare ouvert, couvercle relevé derrière.
      r.rect(x0 + 1, y0 - 4, 18, 4, C('#2a1a12'));
      r.rect(x0 + 2, y0 - 3, 16, 2, C('#6a1a26'));
      r.rect(x0, y0, 20, 6, C('#24160e'));
      r.rect(x0 + 1, y0 + 1, 18, 4, C('#8a2232'));
      r.rect(x0 + 1, y0 + 1, 18, 1, C('#5a1420'));
      r.rect(x0 + 6, y0 + 2, 3, 2, C('#6a1a26'));
      for (const [cx, cy] of [[x0 + 4, y0 + 3], [x0 + 11, y0 + 2], [x0 + 14, y0 + 4]]) {
        r.set(cx, cy, C('#e8c050'));
        r.set(cx + 1, cy, C('#b8902a'));
        this.coins.push({ x: cx, y: cy, p: Math.random() * 6 });
      }
    }

    paintBigPlant(r, R, px = 14) {
      const { H } = this;
      const leaf = BUSH.map(C);
      const base = H - 14;
      // Palmes arquées qui retombent.
      for (let f = 0; f < 10; f++) {
        const ang = -Math.PI + 0.25 + (f / 9) * (Math.PI - 0.5) + (R() - 0.5) * 0.15;
        const len = 18 + R() * 16;
        for (let k = 0; k < len; k++) {
          const x = Math.round(px + Math.cos(ang) * k);
          const y = Math.round(base - 2 + Math.sin(ang) * k + (k * k) / 55);
          r.set(x, y, leaf[0]);
          if (k > 3 && k % 2 === 0) {
            const lw = Math.round(Math.sin((k / len) * Math.PI) * 4) + 1;
            for (let s = 1; s <= lw; s++) {
              r.set(x - Math.round(Math.sin(ang) * s), y + s, leaf[2 + (s === 1 ? 1 : 0)]);
              r.set(x + Math.round(Math.sin(ang) * s * 0.6), y + s, leaf[1]);
            }
          }
        }
      }
      // Pot en terre cuite.
      r.rect(px - 10, base, 21, 14, C('#a85a38'));
      r.rect(px - 11, base, 23, 3, C('#c8784a'));
      r.rect(px - 11, base + 3, 23, 1, C('#7a3a22'));
      r.rect(px + 6, base + 4, 3, 10, C('#8a4428'));
      r.rect(px - 8, base + 4, 2, 10, C('#c06e46'));
    }

    // Halos (ajoutés en mode « lumière ») : lanterne, vitrine, applique, lune.
    paintHalo() {
      const { W, H, L, look } = this;
      const halos = [
        { x: L.LX, y: L.LY, r: 48, c: [255, 176, 96], k: 0.42 },
        { x: L.LX, y: L.LY, r: 15, c: [255, 232, 170], k: 0.65 },
        { x: L.cafe.cx, y: L.cafe.cy, r: 32, c: [255, 186, 110], k: 0.18 },
        { x: L.sconce.x, y: L.sconce.y, r: 9, c: [255, 210, 140], k: 0.5 },
      ];
      if (look.moon) halos.push({ x: L.moonX, y: L.moonY, r: 18, c: [150, 170, 220], k: 0.16 });
      return makeHalo(W, H, this.extL, this.extR, halos, this.extHalos);
    }

    // Le musicien, éclairé par la lampe comme le reste du décor (et un liseré chaud du
    // côté du lampadaire).
    paintMusician() {
      const { L, look } = this;
      const hh = 8;
      const sh = B.People.heroes.guitarist(MUSICIAN, { hh, seatH: (L.LB + 5 - L.seatY) / hh, rim: { color: '#ffc27a', dir: [[-1, 0], [0, -1]], k: 0.35 } });
      const ox = L.benchX + 15 - sh.ax;
      const oy = L.seatY - sh.ay;
      const lights = this.lights().map((l) => ({ ...l, x: l.x - ox, y: l.y - oy }));
      const out = B.People.bake(sh, (r) => PXC.applyLight(r, lights, look.ambient, look.warm));
      out.x = ox;
      out.y = oy;
      return out;
    }

    /* ================= La vie du prolongement ================= */
    // Clients attablés, un lecteur sur le banc, des pigeons, un chat gris sur la fontaine,
    // des passants déjà en route sur toute la place.
    buildExtLife() {
      const { L, look, X, effect } = this;
      const season = effect === 'snow' ? 'winter' : effect === 'leaves' ? 'autumn' : 'spring';
      const lights = this.lights().concat(X.lights);
      const bakeAt = (sh, ox, oy) => {
        const ls = lights.map((l) => ({ ...l, x: l.x - ox, y: l.y - oy }));
        return B.People.bake(sh, (r) => PXC.applyLight(r, ls, look.ambient, look.warm));
      };
      const hh = 8;
      const seat = L.LB - 3;
      const seatH = (L.LB + 9 - seat) / hh;
      this.guests = [];
      const guest = (seed, sx, right) => {
        const lk = B.People.randomLook(seed, { season });
        const sh = B.People.heroes.desk(lk, { hh, seatH, desk: 0.75, view: right ? 0.7 : Math.PI - 0.7, sipHand: right ? 'R' : 'L' });
        const ox = sx - sh.ax;
        const oy = seat - sh.ay;
        const b = bakeAt(sh, ox, oy);
        this.guests.push({ b, x: ox, y: oy, t: Math.random() * 6, sip: 0, next: 3 + Math.random() * 8, cup: [sx + (right ? 9 : -9), seat - 8] });
      };
      guest(31, X.tables[0] - 19, true);
      guest(44, X.tables[0] + 19, false);
      guest(57, X.tables[1] - 19, true);
      // Le lecteur du banc.
      this.reader = null;
      if (X.bench > -this.extL + 4) {
        const lk = B.People.randomLook(73, { season, cold: true });
        const sh = B.People.heroes.bench(lk, { hh, seatH: (L.LB + 5 - L.seatY) / hh });
        const ox = X.bench + 20 - sh.ax;
        const oy = L.seatY - sh.ay;
        this.reader = { b: bakeAt(sh, ox, oy), x: ox, y: oy, pose: 'read', t: 0, until: 6 };
      }
      // Pigeons qui picorent devant le banc et la fontaine.
      this.pigeons = [];
      const RP = rng(97);
      for (let k = 0; k < 7; k++) {
        const near = k < 4 ? X.bench + 20 : X.fountain;
        this.pigeons.push({ x: near + (RP() - 0.5) * (k < 4 ? 50 : 70), y: k < 4 ? L.FY0 + 16 + Math.floor(RP() * 34) : L.LB + 15 + Math.floor(RP() * 18), dir: RP() < 0.5 ? -1 : 1, t: RP() * 4, peck: 0, walk: 0, c: RP() < 0.25 ? 1 : 0 });
      }
      // Un chat gris endormi sur la margelle de la fontaine.
      const S = this.sprites.cat;
      const grey = (cv) => {
        const c = document.createElement('canvas');
        c.width = cv.width;
        c.height = cv.height;
        const g = c.getContext('2d');
        g.drawImage(cv, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height);
        for (let i = 0; i < d.data.length; i += 4) {
          const l = d.data[i] * 0.3 + d.data[i + 1] * 0.55 + d.data[i + 2] * 0.15;
          d.data[i] = l * 0.62;
          d.data[i + 1] = l * 0.66;
          d.data[i + 2] = l * 0.78;
        }
        g.putImageData(d, 0, 0);
        return c;
      };
      this.cat2 = this.fount ? { frames: { sleep: S.sleepR.map(grey), sit: S.sitR.map(grey), lick: S.lickR.map(grey) }, x: this.fount.x + 9, y: this.fount.cy - 5, state: 'sleep', timer: 12, t: 0 } : null;
      this.drops = [];
      // Des passants déjà en route sur toute la place.
      for (let k = 0; k < 5; k++) {
        this.crowd.spawn();
        const w = this.crowd.list[this.crowd.list.length - 1];
        w.x = -this.extL + Math.random() * (this.extL + this.W * 0.6);
      }
    }

    updateExt(dt) {
      for (const g of this.guests) {
        g.t += dt;
        if (g.sip > 0) g.sip -= dt;
        else {
          g.next -= dt;
          if (g.next <= 0) {
            g.sip = 2.2;
            g.next = 6 + Math.random() * 10;
          }
        }
        if (Math.random() < dt * 0.5) this.steam.emit(g.cup[0] + Math.random() * 2, g.cup[1], 1.4, 5);
      }
      const rd = this.reader;
      if (rd) {
        rd.t += dt;
        rd.until -= dt;
        if (rd.until <= 0) {
          rd.pose = rd.pose === 'read' ? (Math.random() < 0.5 ? 'page' : 'look') : 'read';
          rd.until = rd.pose === 'read' ? 5 + Math.random() * 6 : rd.pose === 'page' ? 0.6 : 2.5;
        }
      }
      for (const p of this.pigeons) {
        p.t += dt;
        if (p.walk > 0) {
          p.walk -= dt;
          p.x += p.dir * 6 * dt;
        } else if (p.peck > 0) p.peck -= dt;
        else if (Math.random() < dt * 0.8) {
          if (Math.random() < 0.5) p.peck = 0.25;
          else {
            p.walk = 0.5 + Math.random();
            if (Math.random() < 0.4) p.dir *= -1;
          }
        }
      }
      const c = this.cat2;
      if (c) {
        c.t += dt;
        c.timer -= dt;
        if (c.timer <= 0) {
          c.state = c.state === 'sleep' ? 'sit' : c.state === 'sit' ? (Math.random() < 0.5 ? 'lick' : 'sleep') : 'sleep';
          c.timer = c.state === 'sleep' ? 14 + Math.random() * 10 : 3 + Math.random() * 3;
        }
      }
      // L'eau de la fontaine.
      const f = this.fount;
      if (f) {
        const n = Math.random() < dt * 40 ? 2 : 0;
        for (let k = 0; k < n; k++) {
          const side = Math.random() < 0.5 ? -1 : 1;
          this.drops.push({ x: f.x + side * (f.vr - 1 + Math.random() * 1.5), y: f.vy, vx: side * (2 + Math.random() * 3), vy: Math.random() * 4, bot: f.cy - 1 + Math.random() * 3 });
        }
        if (Math.random() < dt * 14) this.drops.push({ x: f.x + (Math.random() - 0.5), y: f.vy - 12, vx: (Math.random() - 0.5) * 3, vy: -14 - Math.random() * 6, bot: f.vy - 1 });
        for (const d of this.drops) {
          d.vy += 60 * dt;
          d.x += d.vx * dt;
          d.y += d.vy * dt;
        }
        this.drops = this.drops.filter((d) => d.y < d.bot);
      }
    }

    drawFountain(g, t) {
      // Le jet et les filets d'eau de la fontaine.
      const f = this.fount;
      if (f) {
        const wc = this.look.snow ? 'rgba(220,230,250,0.75)' : 'rgba(170,205,235,0.8)';
        g.fillStyle = wc;
        for (const d of this.drops) g.fillRect(Math.round(d.x), Math.round(d.y), 1, 1);
        g.fillStyle = 'rgba(200,225,250,0.5)';
        for (let k = 0; k < 6; k++) {
          const x = f.x - f.rx + 5 + ((k * 9 + Math.floor(t * 3)) % (f.rx * 2 - 8));
          if (Math.sin(t * 2 + k) > 0.2) g.fillRect(x, f.cy + (k % 3) - 1, 2, 1);
        }
      }
      const c = this.cat2;
      if (c) {
        const fr = c.frames[c.state];
        const img = fr[Math.floor(c.t / (c.state === 'sleep' ? 1.4 : c.state === 'lick' ? 0.3 : 0.7)) % fr.length];
        g.drawImage(img, c.x, c.y - img.height);
      }
    }

    // Pigeons : un petit corps gris-bleu, la tête qui picore.
    drawPigeons(g, t) {
      for (const p of this.pigeons) {
        const x = Math.round(p.x);
        const y = p.y;
        const d = p.dir;
        g.fillStyle = p.c ? '#d8d2c8' : '#6a7080';
        g.fillRect(x - 2, y - 3, 4, 2);
        g.fillStyle = p.c ? '#b0a89c' : '#4a5060';
        g.fillRect(x - 2 - d, y - 3, 1, 1);
        g.fillRect(x - 1, y - 1, 2, 1);
        const hy = p.peck > 0 ? y - 2 : y - 5;
        const hx = x + (p.peck > 0 ? 2 : 1) * d;
        g.fillStyle = p.c ? '#e8e2d8' : '#56606e';
        g.fillRect(hx, hy, 1, 2);
        g.fillStyle = '#7ab090';
        if (p.peck <= 0) g.fillRect(hx, hy + 2, 1, 1);
        g.fillStyle = '#d8a050';
        g.fillRect(hx + d, hy + (p.peck > 0 ? 1 : 0), 1, 1);
        if (p.walk > 0 && Math.floor(p.t * 8) % 2) {
          g.fillStyle = '#c86a5a';
          g.fillRect(x, y, 1, 1);
        }
      }
    }

    drawExtFore(g, t) {
      this.drawFountain(g, t);
      for (const gu of this.guests) {
        const F = gu.b.frames;
        const img = gu.sip > 0.3 && gu.sip < 1.9 ? F.sip : Math.sin(gu.t * 0.7) > 0.85 ? F.bob : F.idle;
        g.drawImage(img, gu.x, gu.y);
      }
      const rd = this.reader;
      if (rd) {
        const F = rd.b.frames;
        const img = rd.pose === 'read' ? F.read[Math.floor(rd.t / 1.8) % 2] : F[rd.pose];
        g.drawImage(img, rd.x, rd.y);
      }
      // La guirlande scintille un peu.
      for (const b of this.bulbs) {
        const v = Math.sin(t * 1.3 + b.p) + Math.sin(t * 3.1 + b.p * 2) * 0.4;
        if (v < -1.05) {
          g.fillStyle = 'rgba(60,40,30,0.55)';
          g.fillRect(b.x, b.y, 1, 2);
        }
      }
    }

    /* ================= Vie de la scène ================= */
    newMote(initial) {
      const { L } = this;
      const a = Math.random() * 6.283;
      const d = Math.sqrt(Math.random()) * 120;
      // Dans le monde élargi, une partie des poussières danse sous le second lampadaire.
      const cx = this.wide && Math.random() < 0.4 ? this.X.lamp : L.LX;
      return {
        x: cx + Math.cos(a) * d * 1.4,
        y: L.LY + 40 + Math.sin(a) * d * 0.65,
        vx: (Math.random() - 0.5) * 2.5,
        vy: -1 - Math.random() * 3,
        age: initial ? Math.random() * 8 : 0,
        life: 6 + Math.random() * 7,
        ph: Math.random() * 6.283,
        big: Math.random() < 0.15,
      };
    }

    update(dt, ctx) {
      const eff = (ctx && ctx.effect) || 'none';
      if (eff !== this.effect) this.build(eff);
      const { L, W } = this;
      this.t += dt;
      const t = this.t;

      this.crowd.update(dt);
      this.updateCat(dt);
      if (this.wide) this.updateExt(dt);

      // Le musicien joue, s'arrête un moment, reprend.
      const p = this.player;
      p.timer -= dt;
      p.frameT += dt;
      if (p.timer <= 0) {
        p.playing = !p.playing;
        p.timer = p.playing ? 18 + Math.random() * 14 : 3 + Math.random() * 3;
      }
      if (p.playing && Math.random() < dt * (this.fast ? 2.5 : 1.1)) this.notes.emit(L.benchX + 6 + Math.random() * 10, L.seatY - 34);
      this.notes.update(dt);

      // Vapeur du café sur la table.
      if (Math.random() < dt * 4) this.steam.emit(L.cup.x + Math.random() * 3, L.cup.y, 1.6 + Math.random(), 6);
      this.steam.update(dt);

      // Avion qui traverse le ciel.
      if (!this.plane) {
        this.nextPlane -= dt;
        if (this.nextPlane <= 0) {
          const dir = Math.random() < 0.5 ? -1 : 1;
          const px0 = this.wide ? -this.extL - 12 : L.FX - 12;
          this.plane = { x: dir > 0 ? px0 : W + 6 + this.extR, y: 10 + Math.random() * this.H * 0.18, dir, v: 8 + Math.random() * 4 };
        }
      } else {
        const pl = this.plane;
        pl.x += pl.dir * pl.v * dt;
        pl.y -= dt * 0.3;
        if (pl.x < (this.wide ? -this.extL : L.FX) - 20 || pl.x > W + 10 + this.extR) {
          this.plane = null;
          this.nextPlane = 25 + Math.random() * 35;
        }
      }

      // Fenêtres qui s'allument et s'éteignent (façade et ville).
      this.nextToggle -= dt;
      if (this.nextToggle <= 0 && this.windows.length) {
        const w = this.windows[Math.floor(Math.random() * this.windows.length)];
        w.lit = !w.lit;
        if (!this.windows.some((x) => x.lit)) w.lit = true;
        if (!this.sil.win || !this.sil.win.lit) this.sil.win = this.windows.find((x) => x.lit);
        this.nextToggle = 8 + Math.random() * 14;
      }
      this.nextSky -= dt;
      if (this.nextSky <= 0 && this.skyWins.length) {
        const w = this.skyWins[Math.floor(Math.random() * this.skyWins.length)];
        w.lit = !w.lit;
        this.nextSky = 0.8 + Math.random() * 2.5;
      }
      const s = this.sil;
      s.x += s.dir * dt * 1.5;
      if (s.x > 6 || s.x < -6) s.dir *= -1;

      // Papillons de nuit autour de la lanterne.
      for (const m of this.moths) m.a += m.sp * dt;

      // Poussières dorées.
      for (const q of this.motes) {
        q.age += dt;
        q.x += (q.vx + Math.sin(t * 0.8 + q.ph) * 2) * dt;
        q.y += q.vy * dt;
        if (q.age > q.life) Object.assign(q, this.newMote(false));
      }

      // Orage : éclairs de temps en temps.
      if (this.flash > 0) this.flash -= dt;
      if (this.look.storm) {
        this.nextBolt -= dt;
        if (this.nextBolt <= 0) {
          this.flash = 0.5;
          this.bolt = this.makeBolt();
          this.nextBolt = 7 + Math.random() * 14;
        }
      }
    }

    makeBolt() {
      const { L } = this;
      const pts = [];
      let x = this.wide ? -this.extL * 0.5 + Math.random() * (L.LX + this.extL * 0.5) : L.FX + 20 + Math.random() * (L.LX - L.FX - 30);
      for (let y = 0; y < L.HZ - 16; y += 3 + Math.floor(Math.random() * 5)) {
        pts.push([Math.round(x), y]);
        x += (Math.random() - 0.5) * 9;
      }
      return pts;
    }

    // Le chat sur la rambarde : assis, toilette, marche, sieste.
    updateCat(dt) {
      const c = this.cat;
      const { L } = this;
      c.timer -= dt;
      c.frameT += dt;
      if (c.state === 'walk') {
        c.x += c.dir * 10 * dt;
        if ((c.dir < 0 && c.x <= c.target) || (c.dir > 0 && c.x >= c.target)) {
          c.state = 'sit';
          c.timer = 3 + Math.random() * 3;
          c.next = Math.random() < 0.5 ? 'lick' : 'sleep';
        }
        return;
      }
      if (c.timer > 0) return;
      if (c.state === 'sleep') {
        c.state = 'sit';
        c.timer = 4 + Math.random() * 3;
        c.next = 'walk';
      } else if (c.state === 'sit' && c.next === 'lick') {
        c.state = 'lick';
        c.timer = 3 + Math.random() * 2;
      } else if (c.state === 'lick') {
        c.state = 'sit';
        c.timer = 3;
        c.next = 'walk';
      } else if (c.state === 'sit' && c.next === 'walk') {
        const minX = L.FX + 26;
        const maxX = L.TX - 40;
        let tg = Math.round(minX + Math.random() * (maxX - minX));
        if (Math.abs(tg - c.x) < 40) tg = c.x > (minX + maxX) / 2 ? minX + 10 : maxX - 10;
        if (Math.abs(tg - L.LX) < 12) tg += 24;
        c.target = Math.min(maxX, tg);
        c.dir = c.target < c.x ? -1 : 1;
        c.state = 'walk';
      } else if (c.state === 'sit' && c.next === 'sleep') {
        c.state = 'sleep';
        c.timer = 14 + Math.random() * 16;
      } else {
        c.state = 'sit';
        c.timer = 3;
        c.next = 'walk';
      }
    }

    /* ================= Dessin d'une image ================= */
    draw(g) {
      const { L, W, H } = this;
      const t = this.t;
      g.imageSmoothingEnabled = false;
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      const ox = -this.extL;
      g.drawImage(this.back, ox, 0);
      this.drawSky(g, t);
      const s = this.sil;
      const drawSil = () => {
        if (!s.win || !s.win.lit) return false;
        const sx = Math.round(s.win.x + s.win.w / 2 + s.x);
        const sy = s.win.y + s.win.h - 12;
        g.fillStyle = 'rgba(70,36,30,0.8)';
        g.fillRect(sx - 1, sy, 3, 3);
        g.fillRect(sx - 2, sy + 3, 5, 6);
        return true;
      };
      if (!this.wide) {
        // Les vitres sont des trous dans le plan du milieu : on les dessine dessous.
        for (const w of this.windows) g.drawImage(w.lit ? w.imgLit : w.imgDark, w.x, w.y);
        drawSil();
        g.drawImage(this.mid, ox, 0);
      } else {
        // Monde élargi (caméra multiplane) : les vitres doivent glisser avec la façade, donc
        // être dessinées APRÈS le plan du milieu. Chaque vitre est composée d'avance avec ce
        // qui est peint devant elle (garde-corps, jardinière) : l'image est la même.
        g.drawImage(this.mid, ox, 0);
        for (const w of this.windows) g.drawImage(w.lit ? w.compLit : w.compDark, w.x, w.y);
        if (drawSil()) g.drawImage(s.win.front, s.win.x, s.win.y);
      }
      this.drawCat(g);
      this.crowd.draw(g);
      if (this.wide) this.drawPigeons(g, t);
      g.drawImage(this.fore, ox, 0);
      if (this.wide) this.drawExtFore(g, t);

      // Le musicien.
      const p = this.player;
      const M = this.musician;
      const F = M.frames;
      let img = F.up;
      if (p.playing) {
        const beat = Math.floor(p.frameT / 0.16);
        const nod = Math.floor(beat / 8) % 2 === 0 && beat % 4 >= 2;
        img = beat % 2 ? (nod ? F.nodDown : F.down) : nod ? F.nodUp : F.up;
      }
      g.drawImage(img, M.x, M.y);

      // Vapeur, bougie, pièces qui brillent.
      this.steam.draw(g, 0.34);
      const fl = Math.sin(t * 13) + Math.sin(t * 7.7);
      g.fillStyle = fl > 0.6 ? '#fff0a8' : '#ffc860';
      g.fillRect(L.candle.x, L.candle.y + (fl > 1.2 ? 1 : 0), 1, fl > 1.2 ? 1 : 2);
      for (const c of this.coins) {
        if (Math.sin(t * 1.7 + c.p * 3) > 0.96) {
          g.fillStyle = '#fffbe0';
          g.fillRect(c.x, c.y, 1, 1);
        }
      }
      this.notes.draw(g, '255,226,160');

      // Papillons de nuit.
      const mothLamps = this.wide ? [L.LX, this.X.lamp] : [L.LX];
      for (const lx of mothLamps)
      for (const m of this.moths) {
        const rad = m.rad + Math.sin(t * 0.7 + m.ph) * 3;
        const mx = Math.round(lx + Math.cos(m.a) * rad + Math.sin(t * 7 + m.ph) + (lx === L.LX ? 0 : 3));
        const my = Math.round(L.LY - 1 + Math.sin(m.a * 1.3) * rad * 0.7 + Math.cos(t * 5 + m.ph));
        g.fillStyle = '#f6ead0';
        g.fillRect(mx, my, 1, 1);
        if (Math.floor(t * 16 + m.ph) % 2) {
          g.fillStyle = 'rgba(230,214,180,0.7)';
          g.fillRect(mx - 1, my - 1, 1, 1);
          g.fillRect(mx + 1, my - 1, 1, 1);
        }
      }

      // Lumières ajoutées : halos, fenêtres allumées, bougie, poussières dorées.
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.86 + 0.06 * Math.sin(t * 1.3) + 0.03 * Math.sin(t * 7.3);
      g.drawImage(this.halo, ox, 0);
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(255,170,90,0.06)';
      for (const w of this.windows) if (w.lit) g.fillRect(w.x - 3, w.y - 3, w.w + 6, w.h + 6);
      g.fillStyle = `rgba(255,170,80,${0.18 + 0.05 * fl})`;
      g.fillRect(L.candle.x - 2, L.candle.y - 1, 5, 4);
      for (const q of this.motes) {
        const fade = Math.min(1, q.age / 1.2, (q.life - q.age) / 1.5);
        if (fade <= 0) continue;
        const dx = this.wide && Math.abs(q.x - this.X.lamp) < Math.abs(q.x - L.LX) ? q.x - this.X.lamp : q.x - L.LX;
        const dy = q.y - L.LY;
        const near = 0.35 + 0.65 / (1 + (dx * dx + dy * dy) / 3600);
        const a = fade * near * (0.6 + 0.4 * Math.sin(t * 3 + q.ph));
        const x = Math.round(q.x);
        const y = Math.round(q.y);
        g.fillStyle = `rgba(255,196,110,${a.toFixed(3)})`;
        g.fillRect(x, y, 1, 1);
        if (q.big) {
          g.fillStyle = `rgba(255,170,80,${(a * 0.45).toFixed(3)})`;
          g.fillRect(x - 1, y, 1, 1);
          g.fillRect(x + 1, y, 1, 1);
          g.fillRect(x, y - 1, 1, 1);
          g.fillRect(x, y + 1, 1, 1);
        }
      }
      g.globalCompositeOperation = 'source-over';

      // Éclair d'orage : double flash sur toute la scène.
      if (this.flash > 0) {
        const f = this.flash;
        const a = f > 0.42 ? 0.38 : f > 0.34 ? 0.04 : f > 0.12 ? 0.22 * ((f - 0.12) / 0.22) : 0;
        if (a > 0) {
          g.fillStyle = `rgba(205,218,255,${a.toFixed(3)})`;
          g.fillRect(-this.extL, 0, W + this.extL + this.extR, H);
        }
      }
    }

    drawSky(g, t) {
      const { L } = this;
      // Étoiles qui scintillent.
      for (const s of this.twinkles) {
        const b = 0.5 + 0.5 * Math.sin(t * s.s + s.p);
        if (b < 0.55) continue;
        g.fillStyle = `rgba(${s.c.join(',')},${(b * 0.95).toFixed(2)})`;
        g.fillRect(s.x, s.y, 1, 1);
        if (b > 0.97) {
          g.fillStyle = `rgba(${s.c.join(',')},0.35)`;
          g.fillRect(s.x - 1, s.y, 3, 1);
          g.fillRect(s.x, s.y - 1, 1, 3);
        }
      }
      // Fenêtres de la ville qui s'allument / s'éteignent.
      for (const w of this.skyWins) {
        if (!w.lit) continue;
        g.fillStyle = w.c;
        g.fillRect(w.x, w.y, 2, 2);
      }
      // Feux rouges au sommet des antennes.
      g.fillStyle = '#ff4a3a';
      for (const a of this.antennas) if (Math.sin(t * 2.2 + a.p) > 0.35) g.fillRect(a.x, a.y, 1, 1);
      // La grande roue du prolongement : ses nacelles tournent, éclairées.
      const wh = this.wheel;
      if (wh && this.wide) {
        const COL = ['#ffd27a', '#ff8ab0', '#8ad8ff', '#ffd27a', '#b8ff9a', '#ffb070'];
        for (let k = 0; k < wh.n; k++) {
          const a = (k / wh.n) * Math.PI * 2 + t * 0.06;
          const on = Math.sin(t * 1.6 - k * 0.9) > -0.3;
          g.fillStyle = on ? COL[k % COL.length] : 'rgba(120,130,160,0.6)';
          g.fillRect(Math.round(wh.x + Math.cos(a) * wh.r), Math.round(wh.y + Math.sin(a) * wh.r) + 1, 1, 1);
        }
      }
      // Avion : feux de position et flash blanc.
      const pl = this.plane;
      if (pl) {
        const x = Math.round(pl.x);
        const y = Math.round(pl.y);
        g.fillStyle = 'rgba(10,16,34,0.9)';
        g.fillRect(x - 3, y, 7, 1);
        g.fillRect(x - 1, y - 1, 2, 1);
        g.fillStyle = Math.sin(t * 6) > 0 ? '#ff4a40' : '#6a1a18';
        g.fillRect(x - 3 * pl.dir, y, 1, 1);
        g.fillStyle = '#7aff9a';
        g.fillRect(x + 3 * pl.dir, y, 1, 1);
        if (t % 1.4 < 0.08) {
          g.fillStyle = '#ffffff';
          g.fillRect(x, y - 1, 1, 1);
        }
      }
      // Éclair (derrière le décor).
      if (this.bolt && this.flash > 0.12 && !(this.flash > 0.34 && this.flash < 0.42)) {
        g.fillStyle = '#eef2ff';
        const pts = this.bolt;
        for (let k = 0; k + 1 < pts.length; k++) {
          const [x0, y0] = pts[k];
          const [x1, y1] = pts[k + 1];
          const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
          for (let j = 0; j <= n; j++) g.fillRect(Math.round(x0 + ((x1 - x0) * j) / n), Math.round(y0 + ((y1 - y0) * j) / n), 1, 1);
        }
        g.fillStyle = 'rgba(200,215,255,0.25)';
        g.fillRect(-this.extL, 0, this.W + this.extL + this.extR, L.HZ);
      }
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
      g.drawImage(img, Math.round(c.x), this.L.railTop - img.height);
    }
  }

  B.PixelScenes.terrasse = Terrace;
})();
