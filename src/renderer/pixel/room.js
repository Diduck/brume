// Brume — scène « Chambre », en pixel art.
//
// Une chambre douillette, la nuit : la grande fenêtre donne sur la ville (lune, étoiles,
// immeubles aux fenêtres qui s'allument, un métro aérien, un avion qui clignote).
// Sous la fenêtre, un bureau : écran où défile du code, clavier, lampe d'architecte,
// tasse fumante et quelqu'un en sweat à capuche, casque sur les oreilles, qui tape.
// À droite le lit (couverture en patchwork) où dort un chat roux qui se réveille, s'étire,
// fait sa toilette et descend parfois rendre visite. Bibliothèque, tourne-disque,
// lampe à lave, horloge, guirlande lumineuse, plante suspendue, posters, tapis.
//
// Le dehors s'adapte à la météo choisie (neige, pluie, orage, sakura, automne, été…).
// Le décor est peint une fois par météo (éclairage calculé pixel par pixel), puis chaque
// image ne dessine que ce qui bouge.
(function () {
  'use strict';
  const B = window.Brume;
  const { Raster, sprite, hex, mix, rng, hash, noise, fbm, bayer } = B.PX;
  const SP = B.Sprites;
  const X = B.PXC;
  const C = hex;
  const BLACK = [0, 0, 0];
  const WHITE = [255, 255, 255];
  const shade = (c, t) => mix(c, BLACK, t);
  const lighten = (c, t) => mix(c, WHITE, t);
  const css = (c, a = 1) => (a >= 1 ? `rgb(${c.map(Math.round).join(',')})` : `rgba(${c.map(Math.round).join(',')},${a})`);

  // Écrit un petit dessin texte directement dans un Raster (une lettre = une couleur).
  function art(r, x, y, rows, pal) {
    const cols = {};
    for (const k of Object.keys(pal)) cols[k] = typeof pal[k] === 'string' ? C(pal[k]) : pal[k];
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const c = cols[row[i]];
        if (c) r.set(x + i, y + j, c);
      }
    });
  }

  /* ================= Monde élargi (animation d'ouverture) ================= */
  // Une toile plus large que l'écran, peinte en coordonnées de scène (x < 0 à gauche
  // de l'écran) ; la toile est décalée de ox. guard : interdit de peindre dans [0, guard).
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
  // Même éclairage que B.PXC.applyLight, en coordonnées de scène. ext : lumières du monde
  // élargi, pondérées par wt(x) (nul dans l'écran : le fond d'écran ne change pas).
  function applyLight(r, lights, ambient, warm, ext) {
    const ox = r.ox || 0;
    for (let y = 0; y < r.h; y++) {
      for (let px = 0; px < r.w; px++) {
        const i = (y * r.w + px) * 4;
        if (!r.data[i + 3]) continue;
        const x = px - ox;
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
  // Même halo que B.PXC.makeHalo, sur une toile donnée (x de scène de x0 à x1).
  function makeHalo(r, x0, x1, H, halos) {
    for (let y = 0; y < H; y++) {
      for (let x = x0; x < x1; x++) {
        let Rr = 0;
        let G = 0;
        let Bl = 0;
        for (const h of halos) {
          const d = Math.hypot(x - h.x, (y - h.y) * 1.2);
          if (d > h.r) continue;
          const q = (Math.floor((1 - d / h.r) ** 1.6 * 5 + bayer(x, y) * 0.9) / 5) * (h.k || 0.55);
          Rr += h.c[0] * q;
          G += h.c[1] * q;
          Bl += h.c[2] * q;
        }
        if (Rr + G + Bl > 2) r.set(x, y, [Rr, G, Bl]);
      }
    }
    return r.toCanvas();
  }
  const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  // Recolore une image (chat gris à partir du chat roux).
  function recolorCanvas(src, map) {
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4) {
      const k = `${d.data[i]},${d.data[i + 1]},${d.data[i + 2]}`;
      if (map[k]) [d.data[i], d.data[i + 1], d.data[i + 2]] = map[k];
    }
    g.putImageData(d, 0, 0);
    return c;
  }

  /* ================= Ambiances du dehors selon la météo ================= */
  const MOODS = {
    none: {
      sky: ['#080c26', '#121a42', '#24285a', '#3e366a'], moon: 'full', moonX: 0.8, moonY: 0.2, stars: 80, clouds: 0.3,
      cloud: ['#1c2250', '#2e3066'], far: '#18183a', bld: ['#141329', '#1a1834', '#1f1b3b', '#171a33'], edge: '#3a3a6a', win: 0.4, shooting: true,
    },
    starfall: {
      sky: ['#03061a', '#080e2e', '#141a44', '#242858'], moon: 'crescent', moonX: 0.18, moonY: 0.18, stars: 240, milky: true, clouds: 0,
      cloud: ['#141a40', '#202650'], far: '#121432', bld: ['#0f0f24', '#13132c', '#171630', '#111428'], edge: '#30346a', win: 0.3,
    },
    snow: {
      sky: ['#1a1f38', '#283052', '#3c4466', '#5a5f7e'], moon: 'hazy', moonX: 0.75, moonY: 0.22, stars: 6, clouds: 0.7,
      cloud: ['#363d60', '#4c5276'], far: '#2c3050', bld: ['#22243c', '#272a44', '#2c2c48', '#232842'], edge: '#6a7092', win: 0.55, snowy: true,
    },
    rain: {
      sky: ['#0b111e', '#131b2c', '#1b2537', '#273349'], moon: null, stars: 0, clouds: 0.95,
      cloud: ['#182033', '#232c42'], far: '#121826', bld: ['#0e1321', '#121928', '#151b2d', '#101726'], edge: '#2c3a52', win: 0.5, wet: true,
    },
    storm: {
      sky: ['#07090f', '#0e121e', '#151b2a', '#1f2738'], moon: null, stars: 0, clouds: 1,
      cloud: ['#111725', '#1b2232'], far: '#0d111c', bld: ['#0a0e18', '#0d121e', '#101522', '#0b101b'], edge: '#26324a', win: 0.45, wet: true, storm: true,
    },
    sakura: {
      sky: ['#2a2a5a', '#644a86', '#c07a9a', '#f2b6a2'], moon: 'thin', moonX: 0.3, moonY: 0.2, stars: 12, clouds: 0.25,
      cloud: ['#a46a8e', '#d494a8'], far: '#5a3e6e', bld: ['#3a2a4c', '#42304e', '#483454', '#382c4a'], edge: '#9a76a6', win: 0.3, branch: true, shooting: true,
    },
    leaves: {
      sky: ['#22183a', '#4c2c4c', '#984e46', '#de8a52'], moon: 'harvest', moonX: 0.72, moonY: 0.44, stars: 14, clouds: 0.3,
      cloud: ['#683446', '#8c4a4a'], far: '#4a2838', bld: ['#2c192b', '#331d2f', '#392131', '#2b1b2d'], edge: '#7c4c4a', win: 0.42, tree: true, shooting: true,
    },
    fireflies: {
      sky: ['#091530', '#13254a', '#213768', '#3a4b76'], moon: 'full', moonX: 0.22, moonY: 0.2, stars: 90, clouds: 0.15,
      cloud: ['#1c2c56', '#2c3c6a'], far: '#14203e', bld: ['#0f192e', '#131f38', '#17233e', '#111b32'], edge: '#34507a', win: 0.5, summer: true, open: true, shooting: true,
    },
  };

  // Versions nuit (météo en direct, il fait nuit) des ambiances qui ne sont pas déjà
  // nocturnes : la branche de cerisier et l'arbre d'automne restent, sous un ciel de nuit
  // (lune, étoiles), éclairés par la lune. nightFront : teinte de nuit du premier plan.
  const MOODS_NUIT = {
    sakura: {
      sky: ['#090b28', '#161844', '#2c2658', '#4c3670'], moon: 'full', moonX: 0.34, moonY: 0.24, stars: 70, clouds: 0.2,
      cloud: ['#1e1e4c', '#30305e'], far: '#17163a', bld: ['#141329', '#1a1834', '#1f1b3b', '#171a33'], edge: '#4e4a7e', win: 0.45, branch: true, shooting: true,
      nightFront: ['#262a62', 0.36],
    },
    leaves: {
      sky: ['#0a0a24', '#17163e', '#2a2050', '#46304e'], moon: 'full', moonX: 0.74, moonY: 0.2, stars: 64, clouds: 0.3,
      cloud: ['#201c46', '#322c58'], far: '#1a1534', bld: ['#170f22', '#1c1328', '#21162c', '#180f24'], edge: '#4a3c66', win: 0.5, tree: true, shooting: true,
      nightFront: ['#1c1c48', 0.36],
    },
  };

  /* ================= Sprites propres à la scène ================= */
  // Chat qui s'étire (même palette que le chat roux partagé), tête à gauche.
  const CAT_PAL = { o: '#e2893c', O: '#a85a26', l: '#f2b67c', e: '#3a2014', n: '#e58a8a', g: '#9adf6a' };
  const CAT_STRETCH = [
    ['.................o', '................o.', '...........oooooo.', '.........ooOooOoo.', 'o.o....ooooooooo..', 'ooo..oooOooooolloo', 'ogooooooooolll.oo.', 'nooooolll......oo.', 'llll...........ll.'],
    ['................o.', '.................o', '...........oooooo.', '.........ooOooOoo.', 'o.o....ooooooooo..', 'ooo..oooOooooolloo', 'oeooooooooolll.oo.', 'nooooolll......oo.', 'llll...........ll.'],
  ];

  // Figurines de la bibliothèque.
  const ROBOT = ['..a..', '.bbb.', '.beb.', '.bbb.', 'ccccc', '.ccc.', '.c.c.'];
  const LUCKY = ['w...w', 'wwwww', 'wewew', 'wwrww', '.wgw.', 'wwwww'];
  const SHROOM = ['.rrr.', 'rwrrw', 'rrrrr', '..s..', '..s..'];
  const CACTUS = ['.g.', 'ggg', 'gGg', 'ggg', 'ttt', 'ttt'];
  const GLOBE = ['.bgb.', 'bggbb', 'bbgbb', '.bbg.', '..k..', '.kkk.'];

  // Avion : une silhouette et ses feux (les feux clignotent à l'image).
  const PLANE = ['....d....', 'dddddddde', '...dd....'];

  const TOK = ['#ff79b0', '#7fe3ff', '#ffd27a', '#9adf6a', '#c6cbe0', '#b98cff', '#c6cbe0'];
  const FAIRY = [C('#ffd27a'), C('#ff9f6b'), C('#7fe3ff'), C('#ffe9b0'), C('#ff7ab0'), C('#b6f08a')];

  class Room {
    constructor(W, H, opts = {}) {
      this.W = W;
      this.H = H;
      // Monde élargi (animation d'ouverture) : la chambre continue à gauche (et un peu à
      // droite) de l'écran. Sans ext, la scène est exactement le fond d'écran habituel.
      const ext = opts.ext || null;
      this.extL = ext ? Math.max(0, Math.round(ext.left || 0)) : 0;
      this.extR = ext ? Math.max(0, Math.round(ext.right || 0)) : 0;
      this.ext = this.extL + this.extR > 0;
      this.WW = W + this.extL + this.extR;
      const L = (this.L = {});
      L.floorY = H - 40;
      // Fenêtre de largeur fixe centrée : sur un écran étroit, la bibliothèque et le lit
      // sont coupés par les bords plutôt que de se chevaucher.
      L.wx0 = Math.round(W / 2 - 99);
      L.wx1 = L.wx0 + 141;
      L.wy0 = 18;
      L.wy1 = Math.round(H * 0.5);
      L.wh = L.wy1 - L.wy0;
      L.mx = Math.round((L.wx0 + L.wx1) / 2); // meneau
      L.ty = L.wy0 + Math.round(L.wh * 0.36); // traverse
      L.deskY = L.floorY - 46;
      L.dx0 = L.wx0 - 16;
      L.dx1 = L.wx1 + 8;
      L.pX = L.wx0 + 56; // centre du dos de la personne (et de sa chaise)
      L.seatY = L.deskY + 8; // dessus de l'assise de la chaise
      L.pHH = 16; // taille d'une tête de la personne (px)
      L.lampX = L.dx0 + 8; // pied de la lampe de bureau
      L.mug = { x: L.wx0 + 24, y: L.deskY - 5 };
      L.mon = { x0: L.wx0 + 76, y0: L.deskY - 40, w: 52, h: 32 };
      L.scr = { x: L.mon.x0 + 3, y: L.mon.y0 + 3, w: 46, h: 25 };
      L.sx1 = L.wx0 - 28;
      L.sx0 = L.sx1 - Math.max(56, Math.min(90, L.sx1 - 10));
      L.shelfTop = 80;
      L.bx0 = L.wx1 + 44;
      L.bx1 = Math.max(L.bx0 + 100, Math.min(W - 4, L.bx0 + 150));
      L.bedY = L.floorY - 26;
      L.catFloor = L.floorY + 17;
      const nsX1 = L.bx0 - 5;
      L.ns = nsX1 - 22 >= L.dx1 + 3 ? { x0: nsX1 - 22, x1: nsX1, top: L.floorY - 24 } : null;
      L.lava = L.ns ? { x: L.ns.x0 + 7, base: L.ns.top } : { x: L.dx1 - 6, base: L.deskY };
      L.clock = { x: Math.round((L.wx1 + 20 + L.bx0) / 2), y: 66, r: 8 };
      if (this.ext) this.layoutExt();

      this.sprites = { cat: SP.cat(), mug: SP.mug() };
      this.sprites.catStretch = CAT_STRETCH.map((f) => sprite(f, CAT_PAL));
      this.sprites.catStretchR = CAT_STRETCH.map((f) => sprite(f, CAT_PAL, true));
      this.sprites.plane = sprite(PLANE, { d: '#1a1a26', e: '#2e2e40' });

      this.fast = X.fastTest();
      this.t = 0;
      this.eff = null;
      this.night = false; // version nuit (météo en direct, après le coucher du soleil)
      // Le décor est peint au premier update (selon la météo), ou au premier draw à défaut.

      // Ce qui vit dans la scène.
      this.steam = new X.Puffs('235,235,245');
      this.notes = new X.Notes();
      this.nextNote = 1;
      this.glassDrops = Array.from({ length: 40 }, () => this.newGlassDrop(true));
      this.plane = null;
      this.nextPlane = this.fast ? 0.4 : 8 + Math.random() * 20;
      this.train = null;
      this.nextTrain = this.fast ? 1.5 : 6 + Math.random() * 15;
      this.shoot = null;
      this.nextShoot = this.fast ? 2 : 20 + Math.random() * 40;
      this.flash = 0;
      this.bolt = null;
      this.nextFlash = this.fast ? 1 : 6 + Math.random() * 8;
      this.nextToggle = 2;
      this.person = { mode: 'type', until: 3, key: 0, nextKey: 0.15, nextStretch: this.fast ? 1 : 40 + Math.random() * 30, nextSip: this.fast ? 5 : 18 + Math.random() * 15 };
      this.initCode();
      this.cat = { x: L.bx0 + 30, y: L.bedY + 1, dir: 1, where: 'bed', state: 'sleep', t: 0, frameT: 0, queue: [{ type: 'sleep', dur: this.fast ? 0.8 : 15 + Math.random() * 20 }], visited: false };
      this.startStep();
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

    // (Re)peint tout le décor pour une météo donnée.
    build(eff, night = this.night) {
      this.eff = eff;
      this.night = night;
      this.mood = (night && MOODS_NUIT[eff]) || MOODS[eff] || MOODS.none;
      this.paintOutside();
      this.inside = this.paintInside();
      this.halo = this.paintHalo();
      this.litPerson = this.lightPerson();
    }

    // La personne au bureau, vue de dos (sweat à capuche bleu, lune brodée, casque rose),
    // peinte par B.People puis éclairée par les mêmes lumières que la pièce : la lampe de
    // bureau à gauche, la lueur froide de l'écran à droite.
    lightPerson() {
      const { L } = this;
      const hh = L.pHH;
      const look = {
        seed: 9, body: 'm', skin: '#d9a488', hairColor: '#3c2834', hairStyle: 'messy',
        top: '#6c82b2', topStyle: 'hoodie', moon: '#f2d27a', bottom: '#2e2c40', shoes: '#ece4d8',
        phones: '#24242c', phonesHi: '#de6c8c', props: { mug: '#ece4d8' },
      };
      const sh = B.People.heroes.desk(look, { hh, desk: (L.seatY - L.deskY) / hh, seatH: (L.floorY + 3 - L.seatY) / hh, kbS: -0.42, twist: -0.12, turn: -0.1, sipHand: 'L', rim: { color: '#7fa8ff', dir: [[1, 0], [0, -1]], k: 0.3, mats: ['hair', 'top', 'phones', 'skin'] } });
      const ox = L.pX - sh.ax;
      const oy = L.seatY - sh.ay;
      const { lights, cool, coolC } = this.lightSet;
      const shift = (ls) => ls.map((l) => ({ ...l, x: l.x - ox, y: l.y - oy }));
      const out = B.People.bake(sh, (r) => {
        X.applyLight(r, shift(lights), [0.62, 0.6, 0.76], [0.9, 0.66, 0.4]);
        X.applyLight(r, shift(cool), [1, 1, 1], coolC);
      });
      out.x = ox;
      out.y = oy;
      return out;
    }

    /* ================= Décor : dehors ================= */
    paintOutside() {
      const { W, H, L } = this;
      const m = this.mood;
      const R = rng(4321);
      const far = this.raster();
      const near = this.raster();
      const front = this.raster();
      const spans = []; // immeubles proches (pour raccorder la ville du monde élargi)
      const X0 = L.wx0 - 2;
      const X1 = L.wx1 + 2;
      const Y0 = L.wy0 - 2;
      const Y1 = L.wy1 + 2;
      const sky = m.sky.map(C);
      far.gradient(X0, Y0, X1 - X0, Y1 - Y0, sky, 12);
      const farTopMin = L.wy0 + Math.round(L.wh * 0.42);

      // Voie lactée (nuit d'étoiles filantes).
      if (m.milky) {
        const band = C('#6c6aa6');
        for (let y = Y0; y < farTopMin + 10; y++) {
          for (let x = X0; x < X1; x++) {
            const u = (x - X0) / (X1 - X0);
            const cyb = Y0 + L.wh * (0.75 - u * 0.75);
            const d = Math.abs(y - cyb) / 15;
            if (d > 1) continue;
            const n = fbm(x * 0.08, y * 0.08, 31);
            const q = Math.floor((1 - d) * n * 1.2 * 5 + bayer(x, y)) / 5;
            if (q > 0) far.tint(x, y, band, q * 0.5);
            if (hash(x, y, 8) < 0.06 * (1 - d)) far.set(x, y, lighten(band, 0.6));
          }
        }
      }
      // Étoiles (quelques-unes scintillent à l'image).
      this.twinkles = [];
      for (let k = 0; k < m.stars; k++) {
        const x = X0 + Math.floor(R() * (X1 - X0));
        const y = Y0 + Math.floor(R() * (L.wh * 0.6));
        const b = 0.35 + R() * 0.6;
        far.set(x, y, mix(far.get(x, y), WHITE, b));
        if (k % 9 === 0) this.twinkles.push({ x, y, p: R() * 6, big: k % 27 === 0 });
      }
      // Lune.
      this.moonPos = null;
      if (m.moon) {
        const cx = Math.round(L.wx0 + (L.wx1 - L.wx0) * m.moonX);
        const cy = Math.round(L.wy0 + L.wh * m.moonY);
        this.paintMoon(far, cx, cy, m.moon);
        this.moonPos = { x: cx, y: cy };
      }
      // Nuages.
      if (m.clouds > 0) {
        const th = 0.66 - m.clouds * 0.3;
        const [c1, c2] = m.cloud.map(C);
        for (let y = Y0; y < farTopMin + 14; y++) {
          for (let x = X0; x < X1; x++) {
            const n = fbm(x * 0.03, y * 0.1, 5 + (m.storm ? 3 : 0));
            if (n <= th) continue;
            // Les nuages ne mangent la lune que par temps de neige (lune voilée).
            if (this.moonPos && m.moon !== 'hazy' && Math.hypot(x - this.moonPos.x, y - this.moonPos.y) < 12) continue;
            let lit = (n - th) * 6;
            if (this.moonPos) lit += Math.max(0, 1 - Math.hypot(x - this.moonPos.x, y - this.moonPos.y) / 30);
            far.set(x, y, bayer(x, y) < lit ? c2 : c1);
          }
        }
      }
      // Ville lointaine.
      const farC = C(m.far);
      const farWin = C(m.snowy ? '#d8c08a' : '#c8946a');
      for (let x = X0; x < X1; ) {
        const w = 4 + Math.floor(R() * 9);
        const top = farTopMin + Math.floor(R() * L.wh * 0.16);
        far.rect(x, top, w, Y1 - top, farC);
        if (m.snowy) far.rect(x, top, w, 1, C('#aab2c8'));
        else if (R() < 0.3) far.set(x + 1, top - 2, farC);
        for (let wy = top + 2; wy < Y1; wy += 3) for (let wx = x + 1; wx < x + w - 1; wx += 2) if (R() < 0.1) far.set(wx, wy, farWin);
        x += w;
      }
      // Brume de pluie au pied de la ville.
      if (m.wet || m.snowy) {
        const fog = sky[3];
        for (let y = farTopMin; y < Y1; y++) for (let x = X0; x < X1; x++) far.tint(x, y, fog, Math.min(0.5, ((y - farTopMin) / (Y1 - farTopMin)) * 0.6) * (bayer(x, y) < 0.5 ? 1 : 0.7));
      }
      // Métro aérien : poutre et piliers.
      L.trackY = L.wy0 + Math.round(L.wh * 0.64);
      const girder = shade(farC, 0.35);
      far.rect(X0, L.trackY, X1 - X0, 2, girder);
      far.rect(X0, L.trackY, X1 - X0, 1, lighten(farC, 0.15));
      for (let x = X0 + 6; x < X1; x += 22) far.rect(x, L.trackY + 2, 2, Y1 - L.trackY, girder);
      if (m.snowy) far.rect(X0, L.trackY - 1, X1 - X0, 1, C('#c8d0e0'));

      // Immeubles proches (leurs fenêtres s'allument à l'image).
      this.wins = [];
      this.antenna = null;
      let x = X0 - Math.floor(R() * 10);
      let bi = 0;
      let tallest = null;
      let tower = false;
      const edge = C(m.edge);
      const moonRight = !this.moonPos || this.moonPos.x > (L.wx0 + L.wx1) / 2;
      const snow = C('#e6ecf6');
      const snowS = C('#aeb8d0');
      while (x < X1) {
        const w = 18 + Math.floor(R() * 18);
        const top = L.wy0 + Math.round(L.wh * (0.46 + R() * 0.3));
        const col = C(m.bld[bi % m.bld.length]);
        spans.push([x, w]);
        near.rect(x, top, w, Y1 - top, col);
        near.rect(moonRight ? x + w - 1 : x, top, 1, Y1 - top, mix(col, edge, 0.5));
        near.rect(x - 1, top, w + 2, 1, edge);
        near.rect(x, top + 1, w, 1, shade(col, 0.3));
        // Grille de fenêtres.
        const style = R();
        for (let wy = top + 4; wy < Y1 - 3; wy += 5) {
          for (let wx = x + 2; wx + 2 < x + w - 1; wx += 4) {
            near.rect(wx, wy, 2, 3, shade(col, 0.45));
            if (m.snowy) near.rect(wx, wy + 3, 2, 1, snowS);
            const r = R();
            this.wins.push({ x: wx, y: wy, w: 2, h: 3, lit: r < m.win, c: r < 0.08 ? '#9cc8ff' : r < 0.3 ? '#ffc070' : '#ffd98e' });
          }
          if (style < 0.25) near.rect(x + 1, wy + 3, w - 2, 1, shade(col, 0.2));
        }
        // Toits : clims, château d'eau, antenne.
        if (R() < 0.6) {
          near.rect(x + w - 8, top - 3, 5, 3, lighten(col, 0.12));
          if (m.snowy) near.rect(x + w - 8, top - 4, 5, 1, snow);
        }
        if (!tower && w > 22 && R() < 0.6) {
          tower = true;
          const tx = x + 5;
          const wood = C(m.snowy ? '#4e4450' : '#3e2e34');
          near.rect(tx + 1, top - 6, 1, 6, shade(wood, 0.3));
          near.rect(tx + 8, top - 6, 1, 6, shade(wood, 0.3));
          near.rect(tx, top - 13, 10, 7, wood);
          near.rect(tx, top - 11, 10, 1, shade(wood, 0.3));
          near.rect(tx, top - 8, 10, 1, shade(wood, 0.3));
          near.rect(moonRight ? tx + 9 : tx, top - 13, 1, 7, mix(wood, edge, 0.5));
          for (let k = 0; k < 4; k++) near.rect(tx + k, top - 14 - k, 10 - k * 2, 1, shade(wood, 0.15));
          if (m.snowy) for (let k = 0; k < 4; k++) near.rect(tx + k, top - 15 - k, 10 - k * 2, 1, snow);
        }
        if (!tallest || top < tallest.top) tallest = { x, w, top };
        if (m.snowy) {
          for (let xx = x - 1; xx < x + w + 1; xx++) {
            near.set(xx, top - 1, snow);
            if (hash(xx, top, 3) < 0.5) near.set(xx, top - 2, snow);
            near.set(xx, top, snowS);
          }
        }
        if (m.wet) for (let xx = x; xx < x + w; xx++) if (hash(xx, 1, 4) < 0.4) near.set(xx, top + 2, mix(col, edge, 0.35));
        x += w + Math.floor(R() * 4);
        bi++;
      }
      if (tallest) {
        const ax = tallest.x + Math.round(tallest.w / 2);
        const ay = tallest.top - 16;
        const mast = C('#3a3a4c');
        near.rect(ax, ay, 1, 16, mast);
        near.rect(ax - 2, ay + 5, 5, 1, mast);
        near.rect(ax - 3, ay + 9, 7, 1, mast);
        this.antenna = { x: ax, y: ay - 1 };
      }
      // Toit tout proche, sous la fenêtre.
      const roof = C(m.snowy ? '#2a2c40' : '#0b0b16');
      near.rect(X0, L.wy1 - 6, X1 - X0, 8, roof);
      near.rect(X0, L.wy1 - 6, X1 - X0, 1, mix(roof, edge, 0.6));
      for (const px of [X0 + 18, X1 - 30]) {
        near.rect(px, L.wy1 - 13, 3, 7, shade(edge, 0.5));
        near.rect(px - 1, L.wy1 - 14, 5, 1, shade(edge, 0.3));
        if (m.snowy) near.rect(px - 1, L.wy1 - 15, 5, 1, snow);
      }
      if (m.snowy) {
        for (let xx = X0; xx < X1; xx++) {
          near.set(xx, L.wy1 - 7, snow);
          near.set(xx, L.wy1 - 6, snow);
          if (fbm(xx * 0.2, 3, 9) > 0.5) near.set(xx, L.wy1 - 8, snow);
          near.set(xx, L.wy1 - 5, snowS);
        }
      }

      // Premier plan : arbre d'automne, branche de cerisier ou arbres d'été.
      if (m.tree) this.paintAutumnTree(front, R);
      if (m.summer) this.paintSummerTrees(front, R);
      if (m.branch) this.paintSakuraBranch(front, R);

      // Silhouette derrière une fenêtre allumée.
      const lit = this.wins.filter((w) => w.lit);
      this.silhouette = { win: lit[Math.floor(R() * lit.length)] || null, x: 0, dir: 1 };
      if (this.ext) this.paintOutsideWorld(far, near, front, spans);
      // La nuit, le premier plan (fleurs, feuillage) passe sous la lumière bleutée de la lune.
      if (m.nightFront) {
        const [tc, tk] = m.nightFront;
        const nc = C(tc);
        const d = front.data;
        for (let i = 0; i < d.length; i += 4) {
          if (!d[i + 3]) continue;
          for (let c = 0; c < 3; c++) d[i + c] = Math.round(d[i + c] + (nc[c] - d[i + c]) * tk);
        }
      }

      this.outFar = far.toCanvas();
      this.outNear = near.toCanvas();
      this.outFront = m.tree || m.summer || m.branch ? front.toCanvas() : null;
      this.glass = this.paintGlass();
    }

    paintMoon(r, cx, cy, kind) {
      const conf = {
        full: { rad: 7, c: '#f3ebd2', d: '#d6cdae', glow: '#46448a', gr: 22, cut: 0 },
        hazy: { rad: 7, c: '#e6e4dc', d: '#c8c8c4', glow: '#6a6e92', gr: 30, cut: 0 },
        crescent: { rad: 6, c: '#f6f0dc', d: '#d6cdae', glow: '#2a2c66', gr: 14, cut: 3 },
        thin: { rad: 5, c: '#fff4ea', d: '#f0d8d0', glow: '#c08aac', gr: 14, cut: 2 },
        harvest: { rad: 10, c: '#f6c070', d: '#dc9a52', glow: '#c86a48', gr: 28, cut: 0 },
      }[kind];
      const base = C(conf.c);
      const dark = C(conf.d);
      const glow = C(conf.glow);
      for (let y = cy - conf.gr; y <= cy + conf.gr; y++) {
        for (let x = cx - conf.gr; x <= cx + conf.gr; x++) {
          const d = Math.hypot(x - cx, y - cy);
          if (d >= conf.gr) continue;
          const t = (1 - Math.max(0, d - conf.rad) / (conf.gr - conf.rad)) ** 1.6 * 0.7;
          const q = Math.floor(t * 5 + bayer(x, y)) / 5;
          if (q > 0) r.tint(x, y, glow, q);
        }
      }
      for (let y = cy - conf.rad; y <= cy + conf.rad; y++) {
        for (let x = cx - conf.rad; x <= cx + conf.rad; x++) {
          const d = Math.hypot(x - cx, y - cy);
          if (d > conf.rad + 0.3) continue;
          if (conf.cut && Math.hypot(x - cx + conf.cut, y - cy + 1) < conf.rad) continue;
          let c = base;
          if (!conf.cut && noise(x * 0.45, y * 0.45, 77) > 0.6) c = dark;
          if (d > conf.rad - 0.8) c = mix(base, dark, 0.6);
          r.set(x, y, c);
        }
      }
    }

    paintAutumnTree(r, R) {
      const { L } = this;
      const tx = L.wx0 + 20;
      const trunk = C('#2a1a1c');
      r.rect(tx - 2, L.wy1 - 30, 5, 32, trunk);
      for (let k = 0; k < 12; k++) r.set(tx - 2 - Math.floor(k / 2), L.wy1 - 30 - k, trunk);
      for (let k = 0; k < 12; k++) r.set(tx + 2 + Math.floor(k / 2), L.wy1 - 34 - k, trunk);
      const leaves = ['#f2c25a', '#e8963c', '#d86a30', '#b8442a', '#7a2a24'].map(C);
      const crowns = [
        { x: tx, y: L.wy1 - 48, r: 20 },
        { x: tx + 16, y: L.wy1 - 40, r: 14 },
        { x: tx - 12, y: L.wy1 - 38, r: 13 },
        { x: L.wx1 - 4, y: L.wy1 - 26, r: 15 },
      ];
      for (const cr of crowns) {
        for (let y = cr.y - cr.r - 4; y < cr.y + cr.r + 4; y++) {
          for (let x = cr.x - cr.r - 4; x < cr.x + cr.r + 4; x++) {
            const d = Math.hypot(x - cr.x, (y - cr.y) * 1.1) / cr.r;
            const n = fbm(x * 0.18, y * 0.18, 21);
            if (d > 0.75 + n * 0.5) continue;
            // Lumière venant d'en haut à droite (la lune).
            const lit = (cr.x - x + (cr.y - y)) / cr.r;
            let i = Math.floor(2 - lit * 1.2 + n * 1.5 + bayer(x, y) * 0.8);
            i = Math.max(0, Math.min(4, i));
            r.set(x, y, leaves[i]);
          }
        }
      }
      // Trous dans le feuillage.
      for (let k = 0; k < 30; k++) {
        const cr = crowns[k % crowns.length];
        r.set(cr.x + Math.round((R() - 0.5) * cr.r * 1.4), cr.y + Math.round((R() - 0.5) * cr.r * 1.4), C('#3a1c22'));
      }
    }

    paintSummerTrees(r, R) {
      const { L } = this;
      const greens = ['#4e8a5a', '#3a6e48', '#2a5238', '#1c3a2a', '#122a20'].map(C);
      const crowns = [
        { x: L.wx0 + 10, y: L.wy1 - 18, r: 20 },
        { x: L.wx0 + 34, y: L.wy1 - 8, r: 14 },
        { x: L.wx1 - 12, y: L.wy1 - 14, r: 18 },
      ];
      for (const cr of crowns) {
        for (let y = cr.y - cr.r - 4; y < L.wy1 + 2; y++) {
          for (let x = cr.x - cr.r - 4; x < cr.x + cr.r + 4; x++) {
            const d = Math.hypot(x - cr.x, (y - cr.y) * 1.15) / cr.r;
            const n = fbm(x * 0.2, y * 0.2, 41);
            if (d > 0.75 + n * 0.45) continue;
            const lit = (cr.x - x) * (this.moonPos && this.moonPos.x < cr.x ? 1 : -1) / cr.r + (cr.y - y) / cr.r;
            let i = Math.floor(2.4 - lit * 1.3 + n + bayer(x, y) * 0.8);
            i = Math.max(0, Math.min(4, i));
            r.set(x, y, greens[i]);
          }
        }
      }
      for (let k = 0; k < 20; k++) r.set(L.wx0 + Math.floor(R() * (L.wx1 - L.wx0)), L.wy1 - Math.floor(R() * 20), greens[4]);
    }

    paintSakuraBranch(r, R) {
      const { L } = this;
      const bark = C('#3a2230');
      const barkHi = C('#5a3a48');
      const petals = ['#fff0f4', '#ffd0dc', '#f8a8c0', '#ec88a8', '#c45a80'].map(C);
      // Branche principale : courbe depuis le coin haut droit.
      const p0 = [L.wx1 + 3, L.wy0 + 16];
      const p1 = [L.wx1 - 50, L.wy0 - 4];
      const p2 = [L.wx0 + Math.round((L.wx1 - L.wx0) * 0.25), L.wy0 + 26];
      const pts = [];
      for (let i = 0; i <= 120; i++) {
        const t = i / 120;
        const x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0];
        const y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1];
        pts.push([x, y, t]);
        const th = Math.round(3 - t * 2.2);
        for (let k = 0; k < th; k++) r.set(Math.round(x), Math.round(y) + k, k === 0 ? barkHi : bark);
      }
      // Rameaux et grappes de fleurs.
      const clusters = [];
      for (let k = 0; k < 9; k++) {
        const [bx, by, t] = pts[10 + Math.floor((k / 9) * 105)];
        const up = k % 2 ? -1 : 1;
        const len = 6 + Math.floor(R() * 10) * (1 - t * 0.4);
        const dx = -0.6 - R() * 0.4;
        for (let s = 0; s < len; s++) r.set(Math.round(bx + dx * s), Math.round(by + up * s * 0.7), bark);
        clusters.push([bx + dx * len, by + up * len * 0.7, 3 + R() * 2]);
        clusters.push([bx + (R() - 0.5) * 6, by + (R() - 0.5) * 4, 2 + R() * 2]);
      }
      clusters.push([p2[0], p2[1], 4]);
      for (const [cx, cy, rad] of clusters) {
        for (let y = Math.floor(cy - rad - 1); y <= cy + rad + 1; y++) {
          for (let x = Math.floor(cx - rad - 1); x <= cx + rad + 1; x++) {
            const d = Math.hypot(x - cx, y - cy) / rad;
            if (d > 1 || hash(x, y, 13) < d * 0.5) continue;
            const lit = (cx - x + (cy - y)) / rad;
            const i = Math.max(0, Math.min(3, Math.floor(1.4 - lit + hash(x, y, 2) * 1.4)));
            r.set(x, y, petals[i]);
            if (hash(x, y, 5) < 0.06) r.set(x, y, petals[4]);
          }
        }
      }
    }

    // La vitre : reflets doux, givre dans les coins quand il neige.
    paintGlass() {
      const { W, H, L } = this;
      const m = this.mood;
      const r = this.raster();
      if (this.ext) this.paintGlassExt(r);
      for (let k = 0; k < 3; k++) {
        const bx = L.wx0 + 18 + k * Math.round((L.wx1 - L.wx0) / 3);
        for (let y = L.wy0; y < L.wy1; y++) {
          if (m.open && y > L.ty) continue;
          for (let s = 0; s < 2 + k; s++) r.set(Math.round(bx + (L.wy1 - y) * 0.5 + s), y, WHITE, 12);
        }
      }
      if (m.snowy) {
        const panes = [
          [L.wx0, L.wy0, L.mx - 1, L.ty],
          [L.mx + 2, L.wy0, L.wx1, L.ty],
          [L.wx0, L.ty + 3, L.mx - 1, L.wy1],
          [L.mx + 2, L.ty + 3, L.wx1, L.wy1],
        ];
        const frost = C('#e4ecfa');
        for (const [x0, y0, x1, y1] of panes) {
          for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
              const dc = Math.min(Math.hypot(x - x0, y - y0), Math.hypot(x - x1, y - y0), Math.hypot(x - x0, y - y1), Math.hypot(x - x1, y - y1));
              const de = Math.min(y1 - y, x - x0, x1 - x);
              const n = fbm(x * 0.3, y * 0.3, 61);
              const f = Math.max(1 - dc / (8 + n * 14), 1 - de / (1 + n * 4));
              if (f <= 0) continue;
              const a = Math.floor(f * 4 + bayer(x, y)) / 4;
              if (a > 0) r.set(x, y, hash(x, y, 7) < 0.08 ? WHITE : frost, Math.min(220, 70 + a * 150));
            }
          }
        }
      }
      return r.toCanvas();
    }

    /* ================= Décor : dedans ================= */
    paintInside() {
      const { W, H, L } = this;
      const R = rng(77);
      const r = this.raster();
      this.paintWall(r);
      this.paintFloor(r);
      this.paintRug(r);
      this.paintWindow(r, R);
      this.paintBookshelf(r, R);
      this.paintPostersLeft(r);
      this.paintHangingPlant(r, R);
      this.paintDesk(r, R);
      this.paintNightstand(r);
      this.paintClock(r);
      this.paintBed(r, R);
      this.paintPostersBed(r);
      this.paintWallShelf(r, R);
      this.paintCorkboard(r);
      this.paintFairyString(r);
      if (this.ext) this.paintInsideExt(r);

      // Éclairage chaud : lampe de bureau, lampe à lave, guirlande.
      const lp = this.lampBulb;
      const lights = [
        { x: lp.x + 4, y: L.deskY - 4, r: 26, k: 1.15, sy: 1.6 },
        { x: lp.x, y: lp.y, r: 18, k: 0.55 },
        { x: lp.x, y: lp.y - 20, r: 46, k: 0.22 },
        { x: L.lava.x, y: L.lava.base - 14, r: 22, k: 0.5 },
      ];
      for (const b of this.fairy) lights.push({ x: b.x, y: b.y + 2, r: 9, k: 0.26 });
      for (const f of this.candles) lights.push({ x: f.x, y: f.y, r: 12, k: 0.35 });
      const E = this.E;
      const wt = (x) => this.extWeight(x);
      if (E) for (const b of E.fairy) E.warm.push({ x: b.x, y: b.y + 2, r: 9, k: 0.26 });
      applyLight(r, lights, [0.42, 0.4, 0.58], [1.0, 0.72, 0.42], E && { lights: E.warm, wt });
      // Lumière froide : l'écran et la nuit qui entre par la fenêtre.
      const S = L.scr;
      const cool = [
        { x: S.x + S.w / 2, y: S.y + S.h / 2, r: 24, k: 0.9 },
        { x: (L.wx0 + L.wx1) / 2, y: L.wy1 + 6, r: 70, k: 0.35 },
      ];
      const coolC = this.mood.storm || this.mood.wet ? [0.08, 0.2, 0.42] : [0.1, 0.26, 0.52];
      applyLight(r, cool, [1, 1, 1], coolC, E && { lights: E.cool, wt });
      this.lightSet = { lights, cool, coolC };

      // La chaise, éclairée de la même façon (elle passe devant la personne).
      const ch = this.raster();
      this.paintChair(ch);
      applyLight(ch, lights, [0.42, 0.4, 0.58], [1.0, 0.72, 0.42]);
      applyLight(ch, cool, [1, 1, 1], [0.1, 0.26, 0.52]);
      this.chair = ch.toCanvas();
      return r.toCanvas();
    }

    paintWall(r) {
      const { W, L } = this;
      const A = C('#3c3553');
      const Bc = C('#37304d');
      const dot = C('#4a4264');
      const top = C('#211c33');
      const xa = -this.extL;
      const xb = W + this.extR;
      for (let y = 0; y < L.floorY; y++) {
        for (let x = xa; x < xb; x++) {
          let c = (x >> 3) & 1 ? Bc : A;
          const mx = (x + ((y >> 4) & 1) * 8) & 15;
          const my = y & 15;
          if ((mx === 4 && (my === 3 || my === 5)) || (my === 4 && (mx === 3 || mx === 5))) c = dot;
          r.set(x, y, c);
        }
      }
      for (let y = 0; y < 7; y++) for (let x = xa; x < xb; x++) if (bayer(x, y) < 1 - y / 7) r.tint(x, y, top, 0.6);
      // Plinthe.
      r.rect(xa, L.floorY - 5, xb - xa, 5, C('#2c2438'));
      r.rect(xa, L.floorY - 5, xb - xa, 1, C('#4e4462'));
    }

    paintFloor(r) {
      const { W, H, L } = this;
      const planks = [C('#5c3f2f'), C('#56392b'), C('#614433')];
      const seam = C('#36241b');
      let y = L.floorY;
      let row = 0;
      let h = 4;
      while (y < H) {
        const ph = Math.min(h, H - y);
        const off = Math.floor(hash(row, 5) * 40);
        const len = 40 + row * 6;
        for (let j = 0; j < ph; j++) {
          for (let x = -this.extL; x < W + this.extR; x++) {
            const pi = Math.floor((x + off) / len);
            let c = planks[Math.floor(hash(pi, row, 3) * 3)];
            if (j === 0 || (x + off) % len === 0) c = seam;
            else if (noise(x * 0.25, (y + j) * 0.9 + row * 7, 4) > 0.7) c = shade(c, 0.14);
            else if (j === 1) c = lighten(c, 0.06);
            r.set(x, y + j, c);
          }
        }
        y += ph;
        row++;
        h = Math.min(10, h + 1);
      }
      // Ombre au pied du mur.
      for (let j = 0; j < 3; j++) for (let x = -this.extL; x < W + this.extR; x++) r.tint(x, L.floorY + j, BLACK, 0.35 - j * 0.1);
    }

    paintRug(r) {
      const { L } = this;
      const cx = Math.round((L.dx0 + L.dx1) / 2) + 22;
      const cy = L.floorY + 21;
      const rx = Math.round((L.dx1 - L.dx0) / 2) + 26;
      const ry = 13;
      this.rug = { cx, cy, rx, ry };
      const border = C('#6a2a3a');
      const cream = C('#e2cba2');
      const rust = C('#b85a44');
      const gold = C('#e2a65e');
      const inner = C('#8a3a48');
      for (let y = cy - ry - 1; y <= cy + ry + 1; y++) {
        for (let x = cx - rx - 1; x <= cx + rx + 1; x++) {
          const u = Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2);
          if (u > 1) continue;
          let c;
          if (u > 0.9) c = border;
          else if (u > 0.84) c = cream;
          else if (u > 0.55) c = (Math.abs(x - cx) + Math.abs(y - cy) * 3) % 9 < 2 ? gold : rust;
          else if (u > 0.5) c = cream;
          else c = (Math.abs(x - cx) + Math.abs(y - cy) * 3) % 12 < 3 ? rust : inner;
          if (u < 0.18) c = gold;
          r.set(x, y, c);
        }
      }
      // Franges.
      for (let y = cy - 4; y <= cy + 4; y += 2) {
        r.rect(cx - rx - 3, y, 2, 1, cream);
        r.rect(cx + rx + 2, y, 2, 1, cream);
      }
    }

    paintWindow(r, R) {
      const { L } = this;
      const m = this.mood;
      const F = C('#d2c8b8');
      const Fd = C('#9a8e80');
      const Fs = C('#6a6058');
      const ww = L.wx1 - L.wx0;
      // Rideaux (derrière le cadre), tringle.
      const cur = C('#4c7684');
      const curD = C('#2e4a58');
      const curL = C('#6a96a0');
      const tieY = L.wy1 - 12;
      for (const side of [-1, 1]) {
        const ox = side < 0 ? L.wx0 - 21 : L.wx1 + 21;
        for (let y = L.wy0 - 8; y < L.wy1 + 22; y++) {
          let w = 15;
          if (y > tieY - 16 && y < tieY + 2) w = Math.round(15 - ((y - (tieY - 16)) / 18) * 7);
          if (y >= tieY + 2) w = Math.min(14, 8 + Math.round((y - tieY - 2) * 0.4));
          for (let k = 0; k < w; k++) {
            const x = side < 0 ? ox + k : ox - k;
            const f = Math.sin(k * 1.3 + (y > tieY ? 1 : 0));
            r.set(x, y, f > 0.55 ? curL : f < -0.5 ? curD : cur);
          }
          if (y === L.wy1 + 21) for (let k = 0; k < w; k++) r.set(side < 0 ? ox + k : ox - k, y, curD);
        }
        // Embrasse.
        r.rect(side < 0 ? ox : ox - 9, tieY - 1, 10, 2, C('#c89a4a'));
      }
      r.rect(L.wx0 - 26, L.wy0 - 11, ww + 52, 2, C('#2a2230'));
      r.rect(L.wx0 - 28, L.wy0 - 12, 3, 4, C('#8a6a3a'));
      r.rect(L.wx1 + 25, L.wy0 - 12, 3, 4, C('#8a6a3a'));
      for (let x = L.wx0 - 20; x < L.wx1 + 20; x += 5) r.set(x, L.wy0 - 9, C('#6a5a4a'));

      // Cadre de la fenêtre.
      r.clear(L.wx0, L.wy0, ww, L.wh);
      r.rect(L.wx0 - 5, L.wy0 - 5, ww + 10, 5, F);
      r.rect(L.wx0 - 5, L.wy0, 5, L.wh, F);
      r.rect(L.wx1, L.wy0, 5, L.wh, F);
      r.rect(L.wx0 - 1, L.wy0, 1, L.wh, Fd);
      r.rect(L.wx0, L.wy0 - 1, ww, 1, Fd);
      r.rect(L.wx1, L.wy0, 1, L.wh, Fs);
      r.rect(L.wx0 - 5, L.wy0 - 5, ww + 10, 1, lighten(F, 0.3));
      r.rect(L.mx - 1, L.wy0, 3, L.wh, F);
      r.rect(L.mx + 1, L.wy0, 1, L.wh, Fd);
      r.rect(L.wx0, L.ty, ww, 3, F);
      r.rect(L.wx0, L.ty + 2, ww, 1, Fd);
      // Fenêtre ouverte (été) : le châssis du bas est remonté derrière celui du haut.
      if (m.open) {
        r.rect(L.wx0, L.ty + 3, ww, 3, Fd);
        r.rect(L.wx0, L.ty + 5, ww, 1, Fs);
      } else {
        r.rect(L.mx - 2, L.ty + 3, 5, 2, C('#c8a050'));
      }
      // Rebord intérieur.
      r.rect(L.wx0 - 9, L.wy1, ww + 18, 2, lighten(F, 0.15));
      r.rect(L.wx0 - 9, L.wy1 + 2, ww + 18, 3, Fd);
      for (let x = L.wx0 - 9; x < L.wx1 + 9; x++) r.tint(x, L.wy1 + 5, BLACK, 0.4);
      // Petites plantes grasses et grenouille en céramique sur le rebord.
      const pot = { t: '#b8643e', T: '#8a4a2e', g: '#6aae63', G: '#3e7a48', f: '#7ac06a', e: '#20301a' };
      art(r, L.wx0 + 4, L.wy1 - 7, ['.g.g.', 'gGgGg', '.ggg.', 'ttttt', 'TtttT', '.TTT.'], pot);
      art(r, L.wx1 - 12, L.wy1 - 9, ['.g.', 'gGg', 'ggg', 'gGg', 'ttt', 'TtT', 'TTT'].map((s) => s.padEnd(3)), pot);
      art(r, L.wx1 - 26, L.wy1 - 4, ['e..e', 'ffff', 'ffff', '.ff.'].map((s) => s.replace(/e/g, 'e')), { f: '#7ac06a', e: '#20301a' });
    }

    paintBookshelf(r, R) {
      const { L } = this;
      const x0 = L.sx0;
      const x1 = L.sx1;
      const top = L.shelfTop;
      const bottom = L.floorY;
      const wood = C('#6a4632');
      const woodHi = C('#8a5e40');
      const woodD = C('#4a3022');
      const back = C('#2e1f18');
      r.rect(x0, top, x1 - x0, bottom - top, back);
      for (let y = top; y < bottom; y++) for (let x = x0; x < x1; x++) if ((x - x0) % 11 === 0) r.set(x, y, shade(back, 0.2));
      const boards = [top, top + 30, top + 60, top + 90, bottom - 3];
      this.shelfBoards = boards;
      const books = ['#b8483c', '#3e6e8e', '#d8a63a', '#4e7a4a', '#8a5a9a', '#d9d0bc', '#c47a3a', '#2e4a6a', '#a8445e'].map(C);
      const leaf = ['#21402b', '#33603d', '#4b8a50', '#6bae63'].map(C);
      // Rangées d'objets.
      for (let s = 0; s < boards.length - 1; s++) {
        const sy = boards[s + 1];
        let x = x0 + 4;
        let n = 0;
        while (x < x1 - 6) {
          const kind = (hash(s, n, 11) * 7) | 0;
          n++;
          if (kind <= 2) {
            // Livres debout, parfois un penché.
            const cnt = 3 + Math.floor(R() * 5);
            for (let k = 0; k < cnt && x < x1 - 4; k++) {
              const bw = 2 + Math.floor(R() * 2);
              const bh = 14 + Math.floor(R() * 9);
              const c = books[Math.floor(R() * books.length)];
              r.rect(x, sy - bh, bw, bh, c);
              r.rect(x, sy - bh, bw, 1, lighten(c, 0.3));
              r.rect(x + bw - 1, sy - bh, 1, bh, shade(c, 0.3));
              if (bh > 17) r.rect(x, sy - bh + 3, bw, 1, C('#e8d8a8'));
              x += bw;
            }
            if (R() < 0.5 && x < x1 - 10) {
              const c = books[Math.floor(R() * books.length)];
              for (let k = 0; k < 16; k++) r.rect(x + Math.floor(k * 0.45), sy - 1 - k, 3, 1, k === 15 ? lighten(c, 0.3) : c);
              x += 9;
            }
          } else if (kind === 3) {
            // Pile de livres couchés + figurine dessus.
            for (let k = 0; k < 3; k++) {
              const c = books[Math.floor(R() * books.length)];
              r.rect(x, sy - 3 - k * 3, 13 - k, 3, c);
              r.rect(x, sy - 3 - k * 3, 13 - k, 1, lighten(c, 0.25));
            }
            art(r, x + 3, sy - 15, ROBOT, { a: '#ff5a5a', b: '#a8b4c4', e: '#7fe3ff', c: '#6a7688' });
            x += 15;
          } else if (kind === 4) {
            // Plante en pot qui retombe.
            r.rect(x, sy - 7, 9, 7, C('#c4774a'));
            r.rect(x, sy - 7, 9, 1, C('#e09a68'));
            for (let k = 0; k < 40; k++) {
              const lx = x + 4 + Math.round((R() - 0.5) * 12);
              const ly = sy - 8 - Math.floor(R() * 10) + (Math.abs(lx - x - 4) > 4 ? 6 : 0);
              r.set(lx, ly, leaf[1 + Math.floor(R() * 3)]);
            }
            for (let k = 0; k < 8; k++) r.set(x - 1 - (k >> 2), sy - 4 + k, leaf[2]);
            x += 13;
          } else if (kind === 5) {
            const fig = [LUCKY, SHROOM, GLOBE][s % 3];
            const pal = { w: '#f2ece0', e: '#2a1a14', r: '#d84a3a', g: '#e8c040', s: '#e8dcc0', b: '#3e7ab0', k: '#8a6a3a' };
            art(r, x, sy - fig.length, fig, pal);
            x += 8;
          } else {
            // Vinyles rangés debout.
            const cnt = 4 + Math.floor(R() * 4);
            for (let k = 0; k < cnt; k++) {
              const c = books[Math.floor(R() * books.length)];
              r.rect(x + k, sy - 20, 1, 20, k % 2 ? shade(c, 0.2) : c);
            }
            x += cnt + 2;
          }
          x += 2 + Math.floor(R() * 3);
        }
      }
      // Montants et planches.
      r.rect(x0 - 3, top - 3, 3, bottom - top + 3, wood);
      r.rect(x1, top - 3, 3, bottom - top + 3, woodD);
      r.rect(x0 - 3, top - 3, 1, bottom - top + 3, woodHi);
      for (const by of boards) {
        r.rect(x0 - 3, by - 1, x1 - x0 + 6, 3, wood);
        r.rect(x0 - 3, by - 1, x1 - x0 + 6, 1, woodHi);
        r.rect(x0, by + 2, x1 - x0, 1, shade(back, 0.4));
      }
      // Dessus : tourne-disque et plante.
      const tx = x1 - 75;
      const ty = top - 4;
      r.rect(tx, ty - 5, 32, 5, C('#7a4e34'));
      r.rect(tx, ty - 5, 32, 1, C('#a06a48'));
      r.rect(tx, ty - 1, 32, 1, C('#4a2e20'));
      const rcx = tx + 13;
      const rcy = ty - 7;
      for (let y = -3; y <= 3; y++) for (let x = -11; x <= 11; x++) if ((x / 11) ** 2 + (y / 3.2) ** 2 <= 1) r.set(rcx + x, rcy + y, C('#141418'));
      for (let y = -3; y <= 3; y++) for (let x = -11; x <= 11; x++) if (Math.abs((x / 11) ** 2 + (y / 3.2) ** 2 - 0.55) < 0.06) r.set(rcx + x, rcy + y, C('#2a2a32'));
      r.rect(rcx - 2, rcy - 1, 5, 2, C('#e85a4a'));
      r.set(rcx, rcy, C('#f2e2c0'));
      // Bras de lecture.
      r.rect(tx + 27, ty - 12, 2, 2, C('#c8c8d0'));
      for (let k = 0; k < 7; k++) r.set(tx + 27 - k, ty - 11 + Math.round(k * 0.55), C('#b8b8c4'));
      r.rect(tx + 20, ty - 8, 2, 2, C('#e8e8f0'));
      this.record = { x: rcx, y: rcy };
      // Enceinte et plante sur le dessus.
      r.rect(x1 - 30, ty - 12, 9, 12, C('#2a2430'));
      r.rect(x1 - 30, ty - 12, 9, 1, C('#4a4058'));
      for (const [cy, rad] of [[ty - 8, 2], [ty - 3, 1]]) for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) if (x * x + y * y <= rad * rad + 1) r.set(x1 - 26 + x, cy + y, C('#141018'));
      r.rect(x1 - 15, ty - 7, 11, 7, C('#d8d0c0'));
      r.rect(x1 - 15, ty - 7, 11, 1, C('#f0eadc'));
      for (let k = 0; k < 9; k++) {
        const a = -Math.PI / 2 + (k - 4) * 0.32;
        const len = 8 + (k % 3) * 3;
        for (let s = 0; s < len; s++) {
          const px = Math.round(x1 - 10 + Math.cos(a) * s);
          const py = Math.round(ty - 8 + Math.sin(a) * s + (s * s) / 30);
          r.set(px, py, leaf[s > len * 0.5 ? 2 + (k & 1) : 1]);
          if (s > 3) r.set(px + 1, py, leaf[1]);
        }
      }
    }

    paintPostersLeft(r) {
      const { L } = this;
      // Poster « vague » au-dessus de la bibliothèque.
      const px = L.sx1 - 72;
      const py = 18;
      const pw = 30;
      const ph = 40;
      r.rect(px - 1, py - 1, pw + 2, ph + 2, C('#e8e0d0'));
      r.gradient(px, py, pw, ph, ['#1e2a5a', '#3a3a7a', '#e07a7a', '#f2c27a'].map(C), 6);
      for (let y = py; y < py + 20; y++) for (let x = px; x < px + pw; x++) if (Math.hypot(x - px - pw * 0.65, y - py - 12) < 5) r.set(x, y, C('#f6ead0'));
      for (let x = px; x < px + pw; x++) {
        const wy = Math.round(py + 28 + Math.sin((x - px) * 0.45) * 2);
        for (let y = wy; y < py + ph; y++) r.set(x, y, y === wy ? C('#e6f2ff') : (y - wy) % 4 === 1 ? C('#5a8ac4') : C('#3a6aa4'));
      }
      r.set(px + pw - 3, py + ph - 3, C('#d8d0c0'));
      // Fanion.
      const fx = px + pw + 8;
      if (fx + 22 < L.sx1 + 4) {
        r.rect(fx, 26, 1, 2, C('#2a2230'));
        for (let k = 0; k < 22; k++) {
          const hh = Math.round(9 * (1 - k / 22));
          r.rect(fx + k, 28 + (9 - hh) / 2, 1, Math.max(1, hh), k < 3 ? C('#f2e8d8') : C('#d8504a'));
        }
        X.text(r, 'LOFI', fx + 4, 30, C('#f6ead8'));
      }
    }

    paintHangingPlant(r, R) {
      const { L } = this;
      const px = L.wx0 - 13;
      const cord = C('#c8b898');
      for (let y = 0; y < 22; y++) {
        r.set(px, y, cord);
        if (y > 12) {
          r.set(px - Math.round((y - 12) * 0.5), y, cord);
          r.set(px + Math.round((y - 12) * 0.5), y, cord);
        }
      }
      r.rect(px - 6, 22, 13, 7, C('#e8e0d0'));
      r.rect(px - 6, 22, 13, 1, C('#fff8ec'));
      r.rect(px - 5, 28, 11, 1, C('#b8b0a0'));
      const leaf = ['#2a5a34', '#3e7a48', '#5a9a5a', '#7ab86a'].map(C);
      for (let v = 0; v < 8; v++) {
        let x = px - 6 + Math.floor(R() * 13);
        const len = 10 + Math.floor(R() * 32);
        for (let y = 26; y < 26 + len; y++) {
          if (R() < 0.3) x += R() < 0.5 ? -1 : 1;
          r.set(x, y, leaf[0]);
          if (y % 3 === 0) {
            r.set(x - 1, y, leaf[2]);
            r.set(x + 1, y + 1, leaf[3]);
            r.set(x - 1, y + 1, leaf[1]);
          }
        }
      }
      for (let k = 0; k < 50; k++) r.set(px - 7 + Math.floor(R() * 15), 18 + Math.floor(R() * 7), leaf[1 + Math.floor(R() * 3)]);
    }

    paintDesk(r, R) {
      const { L } = this;
      const top = C('#b0805a');
      const topHi = C('#d4a274');
      const front = C('#7a5236');
      const dark = C('#4e3424');
      const y = L.deskY;
      // Ombre sous le bureau.
      for (let yy = y + 5; yy < L.floorY + 4; yy++) for (let x = L.dx0 + 2; x < L.dx1 - 2; x++) r.tint(x, yy, BLACK, yy < L.floorY ? 0.45 : 0.3);
      // Câbles.
      for (let yy = y + 5; yy < L.floorY - 2; yy++) r.set(L.mon.x0 + 30 + Math.round(Math.sin(yy * 0.2) * 1.5), yy, C('#14121a'));
      // Tour de l'ordinateur.
      const pcx = L.dx1 - 26;
      r.rect(pcx, L.floorY - 32, 18, 32, C('#1e1e26'));
      r.rect(pcx, L.floorY - 32, 18, 1, C('#3a3a48'));
      r.rect(pcx + 2, L.floorY - 29, 12, 24, C('#2a2a3a'));
      for (let k = 0; k < 3; k++) {
        const fy = L.floorY - 25 + k * 8;
        for (let a = 0; a < 12; a++) r.set(pcx + 8 + Math.round(Math.cos(a / 1.9) * 3), fy + Math.round(Math.sin(a / 1.9) * 3), C('#3a3a50'));
      }
      this.pc = { x: pcx + 15, y: L.floorY - 29, h: 24 };
      // Caisson à tiroirs.
      const cx0 = L.dx0 + 3;
      r.rect(cx0, y + 5, 28, L.floorY - y - 5, front);
      r.rect(cx0, y + 5, 1, L.floorY - y - 5, C('#946446'));
      for (let k = 0; k < 3; k++) {
        const dy = y + 7 + k * 13;
        r.rect(cx0 + 2, dy, 24, 11, C('#8a5e40'));
        r.rect(cx0 + 2, dy, 24, 1, C('#a87650'));
        r.rect(cx0 + 2, dy + 10, 24, 1, dark);
        r.rect(cx0 + 11, dy + 4, 6, 2, C('#d8c090'));
      }
      // Pied droit.
      r.rect(L.dx1 - 4, y + 5, 3, L.floorY - y - 5, front);
      // Plateau.
      r.rect(L.dx0, y, L.dx1 - L.dx0, 1, topHi);
      r.rect(L.dx0, y + 1, L.dx1 - L.dx0, 2, top);
      r.rect(L.dx0, y + 3, L.dx1 - L.dx0, 2, front);
      r.rect(L.dx0, y + 5, L.dx1 - L.dx0, 1, dark);

      // Moniteur.
      const M = L.mon;
      const mc = M.x0 + Math.round(M.w / 2);
      r.rect(mc - 3, M.y0 + M.h, 6, y - M.y0 - M.h - 1, C('#2a2a34'));
      r.rect(mc - 10, y - 2, 20, 2, C('#2a2a34'));
      r.rect(mc - 10, y - 2, 20, 1, C('#4a4a58'));
      r.rect(M.x0, M.y0, M.w, M.h, C('#1a1a22'));
      r.rect(M.x0, M.y0, M.w, 1, C('#3a3a48'));
      r.rect(M.x0, M.y0 + M.h - 1, M.w, 1, C('#2a2a36'));
      r.set(mc, M.y0 + M.h - 2, C('#5a5a6a'));
      r.rect(L.scr.x, L.scr.y, L.scr.w, L.scr.h, C('#101320'));
      // Post-it sur le bord de l'écran.
      r.rect(M.x0 + M.w - 2, M.y0 + 4, 4, 4, C('#f2d65a'));
      r.rect(M.x0 + M.w - 1, M.y0 + 10, 4, 4, C('#ff8ab0'));
      r.rect(M.x0 + M.w, M.y0 + 5, 1, 1, C('#8a7a3a'));
      // Clavier, tapis et souris.
      const kx = L.pX - 3;
      r.rect(kx, y - 2, 34, 2, C('#26262e'));
      for (let x = kx + 1; x < kx + 33; x += 2) r.set(x, y - 2, C('#56566a'));
      r.rect(kx, y - 1, 34, 1, C('#3a3646'));
      r.rect(kx + 37, y - 1, 15, 1, C('#3a3a5a'));
      r.rect(kx + 42, y - 3, 4, 2, C('#d8d8e2'));
      r.set(kx + 43, y - 3, C('#9a9aaa'));
      // Pile de livres et petit cactus.
      const bx = L.dx1 - 22;
      const bc = ['#3e6e8e', '#d8a63a', '#a8445e'].map(C);
      for (let k = 0; k < 3; k++) {
        r.rect(bx + k, y - 3 - k * 3, 16 - k * 2, 3, bc[k]);
        r.rect(bx + k, y - 3 - k * 3, 16 - k * 2, 1, lighten(bc[k], 0.25));
        r.rect(bx + 14 - k * 2 + k, y - 3 - k * 3, 1, 3, C('#efe6d4'));
      }
      art(r, bx + 5, y - 15, CACTUS, { g: '#5a9a5a', G: '#7ac06a', t: '#c4774a' });
      // Carnet et crayon.
      r.rect(L.dx0 + 16, y - 1, 12, 1, C('#e8dcc4'));
      r.rect(L.dx0 + 17, y - 2, 10, 1, C('#d84a4a'));
      r.rect(L.dx0 + 18, y - 3, 8, 1, C('#e8c040'));
      // Lampe d'architecte.
      const lx = L.lampX;
      const lamp = C('#2f6a6e');
      const lampHi = C('#4e9a96');
      r.rect(lx - 5, y - 2, 11, 2, lamp);
      r.rect(lx - 5, y - 2, 11, 1, lampHi);
      for (let k = 0; k < 20; k++) {
        r.set(lx - Math.round(k * 0.3), y - 3 - k, lamp);
        r.set(lx + 1 - Math.round(k * 0.3), y - 3 - k, lampHi);
      }
      const ex = lx - 6;
      const ey = y - 23;
      r.rect(ex - 1, ey - 1, 3, 3, lampHi);
      for (let k = 0; k < 14; k++) {
        r.set(ex + k, ey - Math.round(k * 0.5), lamp);
        r.set(ex + k, ey - 1 - Math.round(k * 0.5), lampHi);
      }
      const hx = ex + 13;
      const hy = ey - 9;
      art(r, hx - 1, hy - 2, ['..TT....', '.TTTT...', 'TTTTTT..', 'tTTTTTT.', '.tttttTT', '...ttttt'], { T: '#3e8a88', t: '#2a5a5c' });
      this.lampBulb = { x: hx + 5, y: hy + 4 };
    }

    paintNightstand(r) {
      const { L } = this;
      const lv = L.lava;
      if (L.ns) {
        const n = L.ns;
        const wood = C('#8a5e40');
        r.rect(n.x0, n.top, n.x1 - n.x0, L.floorY - n.top, C('#6a4632'));
        r.rect(n.x0 - 1, n.top, n.x1 - n.x0 + 2, 2, wood);
        r.rect(n.x0 - 1, n.top, n.x1 - n.x0 + 2, 1, C('#b07a52'));
        r.rect(n.x0 + 2, n.top + 4, n.x1 - n.x0 - 4, 8, wood);
        r.rect(n.x0 + 2, n.top + 11, n.x1 - n.x0 - 4, 1, C('#4a3022'));
        r.rect(Math.round((n.x0 + n.x1) / 2) - 1, n.top + 7, 3, 2, C('#d8c090'));
        r.rect(n.x0 + 2, n.top + 14, n.x1 - n.x0 - 4, 8, C('#4a3022'));
        r.rect(n.x0 + 3, n.top + 16, 10, 6, C('#3e6e8e'));
        r.rect(n.x0 + 13, n.top + 17, 4, 5, C('#d8a63a'));
        // Téléphone posé.
        r.rect(n.x0 + 13, n.top - 1, 6, 1, C('#1a1a22'));
        this.phone = { x: n.x0 + 13, y: n.top - 1 };
      }
      // Lampe à lave : socle, globe (rempli à l'image), capuchon.
      const b = lv.base;
      art(r, lv.x - 4, b - 6, ['.mmmmmmm.', 'mMMMMMMMm', '.mmmmmmm.', '..mmmmm..', '.mmmmmmm.', 'mmmmmmmmm'], { m: '#7a6a8a', M: '#b0a0c0' });
      art(r, lv.x - 2, b - 25, ['.mmm.', 'mMMMm', 'mmmmm'], { m: '#7a6a8a', M: '#b0a0c0' });
      this.lavaGlass = [];
      for (let y = b - 22; y < b - 6; y++) {
        const u = (y - (b - 22)) / 16;
        const hw = Math.round(1 + u * 2.6);
        this.lavaGlass.push({ y, x0: lv.x - hw, x1: lv.x + hw });
      }
    }

    paintClock(r) {
      const { x, y, r: rad } = this.L.clock;
      for (let j = -rad - 1; j <= rad + 1; j++) {
        for (let i = -rad - 1; i <= rad + 1; i++) {
          const d = Math.hypot(i, j);
          if (d <= rad - 1) r.set(x + i, y + j, C('#efe6d2'));
          else if (d <= rad + 0.6) r.set(x + i, y + j, C('#3a2c40'));
        }
      }
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        r.set(Math.round(x + Math.cos(a) * (rad - 2)), Math.round(y + Math.sin(a) * (rad - 2)), k % 3 ? C('#a89e90') : C('#3a2c40'));
      }
      r.rect(x - 1, y - rad - 3, 3, 2, C('#3a2c40'));
    }

    paintBed(r, R) {
      const { L } = this;
      const x0 = L.bx0;
      const x1 = L.bx1;
      const y = L.bedY;
      const wood = C('#7a4e36');
      const woodHi = C('#9a6a4a');
      const woodD = C('#4e3022');
      // Ombre sous le lit.
      for (let yy = L.floorY - 6; yy < L.floorY + 5; yy++) for (let x = x0 - 2; x < x1 + 2; x++) r.tint(x, yy, BLACK, 0.45);
      // Tête de lit (à droite).
      const hx = x1 - 6;
      r.rect(hx, y - 28, 6, L.floorY - y + 28, wood);
      r.rect(hx, y - 28, 6, 1, woodHi);
      r.rect(hx, y - 28, 1, L.floorY - y + 28, woodHi);
      r.rect(hx - 1, y - 29, 8, 2, woodHi);
      // Cadre et pieds.
      r.rect(x0, y + 10, x1 - x0 - 6, 10, wood);
      r.rect(x0, y + 10, x1 - x0 - 6, 1, woodHi);
      r.rect(x0, y + 19, x1 - x0 - 6, 1, woodD);
      r.rect(x0 + 1, y + 20, 3, L.floorY - y - 20, woodD);
      r.rect(hx - 4, y + 20, 3, L.floorY - y - 20, woodD);
      // Pied de lit (à gauche).
      r.rect(x0 - 3, y - 6, 4, L.floorY - y + 6, wood);
      r.rect(x0 - 3, y - 6, 4, 1, woodHi);
      r.rect(x0 - 4, y - 7, 6, 2, woodHi);
      // Matelas et drap.
      r.rect(x0 + 1, y + 1, hx - x0 - 1, 9, C('#d8d0c8'));
      r.rect(x0 + 1, y + 8, hx - x0 - 1, 2, C('#b8b0a8'));
      // Oreillers.
      const pil = [C('#efe8dc'), C('#d0c8bc')];
      for (let j = 0; j < 10; j++) {
        const hw = Math.round(13 - Math.abs(j - 5) * 0.6);
        for (let i = -hw; i <= hw; i++) r.set(hx - 15 + i, y - 9 + j, j > 6 || i > hw - 2 ? pil[1] : pil[0]);
      }
      const pin = [C('#e8a0b4'), C('#c47a90')];
      for (let j = 0; j < 7; j++) {
        const hw = Math.round(9 - Math.abs(j - 3) * 0.7);
        for (let i = -hw; i <= hw; i++) r.set(hx - 18 + i, y - 4 + j, j > 4 || i > hw - 2 ? pin[1] : pin[0]);
      }
      // Couverture en patchwork, rabattue près des oreillers.
      const blanketEnd = hx - 32;
      const patches = ['#e0705a', '#f2c870', '#5aa6a2', '#f2e6d2', '#9a78b8', '#ec9a74'].map(C);
      for (let yy = y - 1; yy < y + 15; yy++) {
        for (let x = x0 + 1; x < blanketEnd; x++) {
          if (yy > y + 12) {
            // Bord ondulé qui pend.
            const wave = y + 13 + Math.round(Math.sin(x * 0.45) * 1.2);
            if (yy > wave) continue;
          }
          const topSurf = yy < y + 3;
          const pw = 7;
          const ph = topSurf ? 2 : 4;
          const py = topSurf ? Math.floor((yy - y + 1) / ph) : 10 + Math.floor((yy - y - 3) / ph);
          const pxI = Math.floor((x - x0 - 1 + (py % 2) * 3) / pw);
          let c = patches[Math.floor(hash(pxI, py, 17) * patches.length)];
          const lx = (x - x0 - 1 + (py % 2) * 3) % pw;
          const ly = topSurf ? (yy - y + 1) % ph : (yy - y - 3) % ph;
          if (!topSurf && (lx === 0 || ly === 0)) c = shade(c, 0.28);
          else if (!topSurf && lx === 3 && ly === 2) c = lighten(c, 0.4);
          if (topSurf) c = lighten(c, 0.12);
          if (yy === y + 3) c = shade(c, 0.35);
          // Plis.
          if (!topSurf && Math.sin(x * 0.21) > 0.85) c = shade(c, 0.15);
          r.set(x, yy, c);
        }
      }
      // Revers du drap.
      r.rect(blanketEnd, y - 1, 4, 14, C('#f2ece2'));
      r.rect(blanketEnd + 3, y - 1, 1, 14, C('#c8c0b4'));
      this.blanketEnd = blanketEnd;
      // Chaussons au pied du lit.
      const sx = x0 - 18;
      for (const [ox, oy] of [[0, 0], [7, 2]]) {
        r.rect(sx + ox, L.floorY + 6 + oy, 6, 3, C('#e89aac'));
        r.rect(sx + ox, L.floorY + 6 + oy, 6, 1, C('#f8c4d0'));
        r.rect(sx + ox + 4, L.floorY + 7 + oy, 2, 1, C('#f8f0f0'));
      }
    }

    paintPostersBed(r) {
      const { L } = this;
      let x = L.bx0 + 8;
      const kinds = ['space', 'sunset', 'plant', 'vinyl'];
      for (let i = 0; i < 4; i++) {
        const w = [24, 20, 18, 20][i];
        const h = [32, 26, 24, 26][i];
        const y = 50 + (i % 2) * 7;
        if (x + w > Math.min(L.bx1, this.W) - 8) break;
        r.rect(x - 1, y - 1, w + 2, h + 2, C('#efe6d4'));
        const kind = kinds[i];
        if (kind === 'space') {
          r.gradient(x, y, w, h, ['#0e1030', '#2a1e5a', '#5a2a6a'].map(C), 6);
          for (let k = 0; k < 18; k++) r.set(x + Math.floor(hash(k, i, 1) * w), y + Math.floor(hash(k, i, 2) * h), C('#f0f0ff'));
          const pcx = x + Math.round(w / 2);
          const pcy = y + Math.round(h * 0.55);
          for (let j = -6; j <= 6; j++) for (let k = -6; k <= 6; k++) if (k * k + j * j <= 30) r.set(pcx + k, pcy + j, k + j < -2 ? C('#f2b06a') : C('#d8784a'));
          for (let k = -10; k <= 10; k++) {
            const ry = Math.round(k * 0.3);
            if (Math.abs(k) > 4 || ry > 0) r.set(pcx + k, pcy + ry, C('#f6e0b0'));
          }
        } else if (kind === 'sunset') {
          r.gradient(x, y, w, h, ['#ffb46a', '#ff7a8a', '#8a4a9a'].map(C), 6);
          for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) if (Math.hypot(k - w / 2, j - h * 0.5) < 6 && (j < h * 0.5 - 1 || j % 2)) r.set(x + k, y + j, C('#fff0b0'));
          for (let k = 0; k < w; k++) {
            const my = Math.round(h * 0.62 + Math.abs(((k * 7) % 13) - 6) * 0.6);
            for (let j = my; j < h; j++) r.set(x + k, y + j, j === my ? C('#5a2a5a') : C('#3a1e4a'));
          }
        } else if (kind === 'vinyl') {
          r.rect(x, y, w, h, C('#2e7a78'));
          const vcx = x + Math.round(w / 2);
          const vcy = y + Math.round(h * 0.42);
          for (let j = -8; j <= 8; j++) {
            for (let k = -8; k <= 8; k++) {
              const d = Math.hypot(k, j);
              if (d > 8) continue;
              r.set(vcx + k, vcy + j, d < 2.5 ? C('#f2c870') : Math.round(d) % 2 ? C('#1a1a22') : C('#2c2c38'));
            }
          }
          r.set(vcx, vcy, C('#1a1a22'));
          X.text(r, 'LOFI', x + 2, y + h - 6, C('#f2e6d2'));
        } else {
          r.rect(x, y, w, h, C('#e8e0c8'));
          r.rect(x + Math.round(w / 2), y + 6, 1, h - 8, C('#3e6a48'));
          for (let k = 0; k < 5; k++) {
            const ly = y + 6 + k * 3;
            const side = k % 2 ? 1 : -1;
            for (let s = 1; s < 6; s++) r.set(x + Math.round(w / 2) + side * s, ly - Math.round(s * 0.4), C('#5a9a5a'));
          }
          X.text(r, 'ZEN', x + 3, y + 1, C('#6a4a3a'));
        }
        // Scotch dans les coins.
        r.rect(x - 2, y - 2, 3, 2, C('#f2e6a8'));
        r.rect(x + w - 1, y - 2, 3, 2, C('#f2e6a8'));
        x += w + 8;
      }
    }

    // Étagère murale au-dessus du lit : bougies, plante, cadre photo, livres.
    paintWallShelf(r, R) {
      const { L } = this;
      const y = L.bedY - 50;
      const x0 = L.bx0 + 12;
      const x1 = Math.min(L.bx1 - 16, x0 + 84);
      this.candles = [];
      // Objets.
      let x = x0 + 3;
      // Bougies de tailles différentes.
      for (const h of [7, 5, 9]) {
        r.rect(x, y - h, 3, h, C('#f2e8d6'));
        r.rect(x + 2, y - h, 1, h, C('#d0c4b0'));
        r.set(x + 1, y - h - 1, C('#2a1a14'));
        this.candles.push({ x: x + 1, y: y - h - 2, p: R() * 6 });
        x += 5;
      }
      x += 3;
      // Cadre photo.
      r.rect(x, y - 12, 10, 12, C('#c8a060'));
      r.rect(x + 1, y - 11, 8, 10, C('#f2ece0'));
      r.gradient(x + 2, y - 10, 6, 6, ['#6a9ad0', '#f2c08a'].map(C), 3);
      r.rect(x + 2, y - 5, 6, 2, C('#4a7a4a'));
      x += 14;
      // Livres couchés + petite plante.
      for (let k = 0; k < 3; k++) {
        const c = C(['#8a5a9a', '#d8a63a', '#3e6e8e'][k]);
        r.rect(x + k, y - 3 - k * 3, 14 - k * 2, 3, c);
        r.rect(x + k, y - 3 - k * 3, 14 - k * 2, 1, lighten(c, 0.25));
      }
      x += 18;
      if (x + 10 < x1) {
        r.rect(x, y - 6, 8, 6, C('#e8e0d0'));
        r.rect(x, y - 6, 8, 1, C('#fff8ec'));
        const leaf = ['#3e7a48', '#5a9a5a', '#7ab86a'].map(C);
        for (let k = 0; k < 30; k++) r.set(x + 4 + Math.round((R() - 0.5) * 10), y - 7 - Math.floor(R() * 7), leaf[Math.floor(R() * 3)]);
        // Lianes qui pendent de l'étagère.
        for (let v = 0; v < 3; v++) {
          let vx = x + 1 + v * 3;
          for (let k = 0; k < 6 + v * 5; k++) {
            if (R() < 0.3) vx += R() < 0.5 ? -1 : 1;
            r.set(vx, y + 3 + k, leaf[k % 3 === 0 ? 2 : 0]);
          }
        }
        x += 12;
      }
      if (x + 6 < x1) art(r, x, y - 6, LUCKY, { w: '#f2ece0', e: '#2a1a14', r: '#d84a3a', g: '#e8c040' });
      // Planche et équerres.
      r.rect(x0, y, x1 - x0, 2, C('#a87650'));
      r.rect(x0, y, x1 - x0, 1, C('#c8966a'));
      r.rect(x0, y + 2, x1 - x0, 1, C('#5a3a28'));
      for (const bx of [x0 + 6, x1 - 8]) {
        r.rect(bx, y + 3, 2, 5, C('#2a2230'));
        for (let k = 0; k < 4; k++) r.set(bx + 2 + k, y + 3 + k, C('#2a2230'));
      }
    }

    // Petit tableau de liège sous l'horloge.
    paintCorkboard(r) {
      const { L } = this;
      const x0 = L.wx1 + 24;
      const x1 = L.bx0 - 6;
      if (x1 - x0 < 12) return;
      const y0 = L.clock.y + 16;
      const y1 = y0 + 24;
      r.rect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2, C('#7a5a3a'));
      r.dither(x0, y0, x1 - x0, y1 - y0, C('#c8955e'), C('#b0804e'), 0.4);
      const notes = [['#f2d65a', 2, 2], ['#8ad0f0', x1 - x0 - 8, 4], ['#ff9ab4', 4, 12], ['#f2ece0', x1 - x0 - 9, 14]];
      for (const [c, nx, ny] of notes) {
        r.rect(x0 + nx, y0 + ny, 6, 6, C(c));
        r.rect(x0 + nx + 1, y0 + ny + 2, 4, 1, shade(C(c), 0.35));
        r.rect(x0 + nx + 1, y0 + ny + 4, 3, 1, shade(C(c), 0.35));
        r.set(x0 + nx + 3, y0 + ny, C('#d83a3a'));
      }
    }

    paintFairyString(r) {
      const { W, L } = this;
      const wire = C('#1a1420');
      this.fairy = [];
      const x0 = L.wx1 + 26;
      const x1 = W - 2;
      const spans = Math.max(2, Math.round((x1 - x0) / 38));
      const sw = (x1 - x0) / spans;
      let bi = 0;
      for (let x = x0; x <= x1; x++) {
        const u = ((x - x0) % sw) / sw;
        const y = Math.round(26 + Math.sin(u * Math.PI) * 9);
        r.set(x, y, wire);
        if ((x - x0) % 7 === 3) {
          this.fairy.push({ x, y: y + 1, c: FAIRY[bi % FAIRY.length], p: hash(bi, 3) * 6.28, s: 0.8 + hash(bi, 4) * 1.6 });
          bi++;
        }
        // Polaroïds accrochés aux creux.
        if (Math.abs(u - 0.5) < 0.5 / sw && Math.floor((x - x0) / sw) % 2 === 0) {
          r.rect(x - 3, y + 1, 7, 8, C('#f2ece0'));
          r.rect(x - 2, y + 2, 5, 4, [C('#5a8ac4'), C('#e8a06a'), C('#6aae63')][Math.floor((x - x0) / sw) % 3]);
          r.set(x, y, C('#c8a050'));
        }
      }
      // Guirlande aussi le long de la tringle.
      for (let x = L.wx0 - 18; x < L.wx1 + 18; x += 8) {
        this.fairy.push({ x, y: L.wy0 - 8, c: FAIRY[bi % FAIRY.length], p: hash(bi, 3) * 6.28, s: 0.8 + hash(bi, 4) * 1.6 });
        bi++;
      }
    }

    // Chaise de bureau, vue de dos : le dossier cache le bas du dos de la personne.
    paintChair(r) {
      const { L } = this;
      const cx = L.pX;
      const cb0 = L.seatY - 12; // haut du dossier
      const base = C('#2b2735');
      const side = C('#3d3750');
      const hi = C('#55506c');
      const accent = C('#c44e6c');
      for (let j = 0; j < 13; j++) {
        const hw = j === 0 ? 9 : j === 1 ? 10 : j > 9 ? 11 - (j - 9) * 0.6 : 11;
        for (let i = -Math.floor(hw); i <= Math.floor(hw); i++) {
          const a = Math.abs(i);
          let c = a >= hw - 3 ? side : base;
          if (a === Math.floor(hw) - 4) c = accent;
          if (j === 0 || (j === 1 && a > 7)) c = hi;
          if (a === Math.floor(hw)) c = shade(side, 0.3);
          r.set(cx + i, cb0 + j, c);
        }
      }
      // Assise, vérin, piètement étoile et roulettes.
      const sy = L.seatY + 1;
      r.rect(cx - 14, sy, 29, 4, C('#24202e'));
      r.rect(cx - 14, sy, 29, 1, hi);
      r.rect(cx - 1, sy + 4, 3, L.floorY + 3 - sy - 4, C('#7a7a88'));
      r.rect(cx - 1, sy + 4, 1, L.floorY + 3 - sy - 4, C('#b0b0bc'));
      r.rect(cx - 14, L.floorY + 3, 29, 2, C('#2a2a32'));
      r.rect(cx - 14, L.floorY + 3, 29, 1, C('#4a4a56'));
      for (const wx of [-15, -7, 6, 14]) r.rect(cx + wx, L.floorY + 5, 3, 2, C('#141418'));
      r.rect(cx - 1, L.floorY + 6, 3, 2, C('#141418'));
    }

    // Halos des lumières (ajoutés en mode « lumière » à chaque image).
    paintHalo() {
      const { W, H, L } = this;
      const S = L.scr;
      const halos = [
        { x: this.lampBulb.x, y: this.lampBulb.y + 2, r: 22, c: [255, 190, 110], k: 0.6 },
        { x: L.lava.x, y: L.lava.base - 14, r: 14, c: [255, 110, 120], k: 0.45 },
        { x: S.x + S.w / 2, y: S.y + S.h / 2, r: 36, c: [80, 140, 255], k: 0.22 },
      ];
      if (this.ext) halos.push(...this.E.halos); // (assez loin de l'écran pour ne jamais l'atteindre)
      return makeHalo(this.raster(), -this.extL, W + this.extR, H, halos);
    }

    /* ================= La chambre continue (monde élargi) ================= */
    // À gauche du fond d'écran : une guitare sur son support et un petit ampli, un panier
    // où dort un chat gris, un fauteuil sous un lampadaire arqué, une deuxième fenêtre
    // au-dessus d'une commode (aquarium, lampe de sel), la porte (la lumière du couloir
    // passe dessous), un skate, l'armoire et une grande plante. Une guirlande court au mur.
    layoutExt() {
      const { W, L } = this;
      const E = (this.E = {});
      const xL = -this.extL;
      const fy = L.floorY;
      E.win = { x0: -300, x1: -200, y0: L.wy0 + 10, y1: L.wy1 - 8 };
      E.win.mx = Math.round((E.win.x0 + E.win.x1) / 2);
      E.win.ty = E.win.y0 + Math.round((E.win.y1 - E.win.y0) * 0.4);
      E.windows = [E.win];
      E.dresser = { x0: -296, x1: -204, top: fy - 32 };
      E.tank = { x0: -290, x1: -252, y0: E.dresser.top - 24, y1: E.dresser.top - 1 };
      E.salt = { x: -214, y: E.dresser.top - 1 };
      E.chair = { x0: -132, x1: -88, seat: fy - 17 };
      E.lamp = { base: -150, x: -116, y: 56 };
      E.catBed = { x: -62, y: fy + 13 };
      E.guitar = { x: -30 };
      E.amp = { x0: -52, x1: -38 };
      E.door = { x0: -424, x1: -378, top: fy - 108 };
      E.hooks = { x0: -364, x1: -334, y: 92 };
      E.skate = { x: -444 };
      E.wardrobe = { x1: -458, x0: Math.max(-536, xL + 34), top: fy - 126 };
      if (E.wardrobe.x1 - E.wardrobe.x0 < 40) E.wardrobe = null;
      E.plant = E.wardrobe && E.wardrobe.x0 - 20 > xL + 4 ? { x: E.wardrobe.x0 - 16 } : null;
      E.fairySpans = [
        [xL + 4, -332],
        [-178, -26],
      ];
      E.lights = [
        { x: E.lamp.x, y: E.lamp.y + 6, r: 34, k: 1.0, sy: 0.9 },
        { x: E.lamp.x, y: E.lamp.y + 40, r: 56, k: 0.22 },
        { x: E.salt.x, y: E.salt.y - 5, r: 16, k: 0.55 },
        { x: (E.door.x0 + E.door.x1) / 2, y: fy, r: 22, k: 0.35, sy: 2 },
      ];
      E.cool = [
        { x: (E.tank.x0 + E.tank.x1) / 2, y: (E.tank.y0 + E.tank.y1) / 2, r: 30, k: 0.9 },
        { x: (E.win.x0 + E.win.x1) / 2, y: E.win.y1 + 6, r: 52, k: 0.32 },
      ];
      E.halos = [
        { x: E.lamp.x, y: E.lamp.y + 4, r: 24, c: [255, 190, 110], k: 0.6 },
        { x: E.salt.x, y: E.salt.y - 5, r: 12, c: [255, 140, 90], k: 0.5 },
        { x: (E.tank.x0 + E.tank.x1) / 2, y: (E.tank.y0 + E.tank.y1) / 2, r: 26, c: [80, 190, 255], k: 0.3 },
      ];
      E.snake = this.extR >= 50 ? { x: W + 30 } : null;
    }

    // La ville du monde élargi : ciel, ville lointaine et métro sur toute la largeur
    // (même dégradé et mêmes nuages que derrière la vitre), immeubles proches de part et
    // d'autre de ceux du fond d'écran. Elle est glissée derrière les plans du fond d'écran,
    // seulement hors de l'écran ; ce qui tombe dans l'écran (caché par les murs dans le
    // fond d'écran) sert de fond à l'animation.
    paintOutsideWorld(far, near, front, spans) {
      const { W, H, L } = this;
      const m = this.mood;
      const E = this.E;
      const R = rng(8080);
      const xa = -this.extL;
      const xb = W + this.extR;
      const X0 = L.wx0 - 2;
      const X1 = L.wx1 + 2;
      const Y0 = L.wy0 - 2;
      const Y1 = L.wy1 + 2;
      const sky = m.sky.map(C);
      const farTopMin = L.wy0 + Math.round(L.wh * 0.42);
      const fw = this.raster();
      const nw = this.raster();
      fw.rect(xa, 0, xb - xa, Y0, sky[0]);
      fw.gradient(xa, Y0, xb - xa, Y1 - Y0, sky, 12);
      // Étoiles (celles de la deuxième fenêtre scintillent à l'image).
      E.twinkles = [];
      const ns = Math.round((m.stars * (xb - xa)) / (X1 - X0));
      for (let k = 0; k < ns; k++) {
        const x = xa + Math.floor(R() * (xb - xa));
        const y = Y0 + Math.floor(R() * (L.wh * 0.6));
        fw.set(x, y, mix(fw.get(x, y), WHITE, 0.35 + R() * 0.6));
        if (k % 7 === 0 && x > E.win.x0 && x < E.win.x1) E.twinkles.push({ x, y, p: R() * 6, big: k % 21 === 0 });
      }
      if (m.clouds > 0) {
        const th = 0.66 - m.clouds * 0.3;
        const [c1, c2] = m.cloud.map(C);
        for (let y = Y0; y < farTopMin + 14; y++) {
          for (let x = xa; x < xb; x++) {
            const n = fbm(x * 0.03, y * 0.1, 5 + (m.storm ? 3 : 0));
            if (n > th) fw.set(x, y, bayer(x, y) < (n - th) * 6 ? c2 : c1);
          }
        }
      }
      const farC = C(m.far);
      const farWin = C(m.snowy ? '#d8c08a' : '#c8946a');
      for (let x = xa; x < xb; ) {
        const w = 4 + Math.floor(R() * 9);
        const top = farTopMin + Math.floor(R() * L.wh * 0.16);
        fw.rect(x, top, w, H - top, farC);
        if (m.snowy) fw.rect(x, top, w, 1, C('#aab2c8'));
        else if (R() < 0.3) fw.set(x + 1, top - 2, farC);
        for (let wy = top + 2; wy < Y1; wy += 3) for (let wx = x + 1; wx < x + w - 1; wx += 2) if (R() < 0.1) fw.set(wx, wy, farWin);
        x += w;
      }
      if (m.wet || m.snowy) {
        const fog = sky[3];
        for (let y = farTopMin; y < Y1; y++) for (let x = xa; x < xb; x++) fw.tint(x, y, fog, Math.min(0.5, ((y - farTopMin) / (Y1 - farTopMin)) * 0.6) * (bayer(x, y) < 0.5 ? 1 : 0.7));
      }
      const trackY = L.wy0 + Math.round(L.wh * 0.64);
      const girder = shade(farC, 0.35);
      fw.rect(xa, trackY, xb - xa, 2, girder);
      fw.rect(xa, trackY, xb - xa, 1, lighten(farC, 0.15));
      for (let x = X0 + 6 + 22 * Math.floor((xa - X0 - 6) / 22); x < xb; x += 22) fw.rect(x, trackY + 2, 2, H - trackY - 2, girder);
      if (m.snowy) fw.rect(xa, trackY - 1, xb - xa, 1, C('#c8d0e0'));

      // Immeubles proches, de part et d'autre de ceux du fond d'écran.
      const wins = [];
      let bi = 1;
      let x = spans.length ? spans[0][0] - 1 : X0;
      while (x > xa) {
        const w = 18 + Math.floor(R() * 18);
        x -= w;
        this.paintBuildingW(nw, x, w, bi++, R, wins);
        x -= Math.floor(R() * 4);
      }
      const last = spans[spans.length - 1];
      x = last ? last[0] + last[1] + 1 : X1;
      while (x < xb) {
        const w = 18 + Math.floor(R() * 18);
        this.paintBuildingW(nw, x, w, bi++, R, wins);
        x += w + Math.floor(R() * 4);
      }
      // Le toit tout proche, sous les fenêtres.
      const edge = C(m.edge);
      const roof = C(m.snowy ? '#2a2c40' : '#0b0b16');
      nw.rect(xa, L.wy1 - 6, xb - xa, H - L.wy1 + 6, roof);
      nw.rect(xa, L.wy1 - 6, xb - xa, 1, mix(roof, edge, 0.6));
      for (let px = -40; px > xa; px -= 150) {
        nw.rect(px, L.wy1 - 13, 3, 7, shade(edge, 0.5));
        nw.rect(px - 1, L.wy1 - 14, 5, 1, shade(edge, 0.3));
        if (m.snowy) nw.rect(px - 1, L.wy1 - 15, 5, 1, C('#e6ecf6'));
      }
      if (m.snowy) {
        for (let xx = xa; xx < xb; xx++) {
          nw.set(xx, L.wy1 - 7, C('#e6ecf6'));
          nw.set(xx, L.wy1 - 6, C('#e6ecf6'));
          if (fbm(xx * 0.2, 3, 9) > 0.5) nw.set(xx, L.wy1 - 8, C('#e6ecf6'));
          nw.set(xx, L.wy1 - 5, C('#aeb8d0'));
        }
      }
      // Arbre devant la deuxième fenêtre (automne, été).
      if (m.tree || m.summer) {
        const cols = m.tree ? ['#f2c25a', '#e8963c', '#d86a30', '#b8442a', '#7a2a24'] : ['#4e8a5a', '#3a6e48', '#2a5238', '#1c3a2a', '#122a20'];
        const leaves = cols.map(C);
        const cr = { x: E.win.x0 + 16, y: L.wy1 - 22, r: 18 };
        front.guard = W;
        for (let y = cr.y - cr.r - 4; y < L.wy1 + 2; y++) {
          for (let xx = cr.x - cr.r - 4; xx < cr.x + cr.r + 4; xx++) {
            const d = Math.hypot(xx - cr.x, (y - cr.y) * 1.1) / cr.r;
            const n = fbm(xx * 0.18, y * 0.18, 21);
            if (d > 0.75 + n * 0.5) continue;
            const lit = (cr.x - xx + (cr.y - y)) / cr.r;
            front.set(xx, y, leaves[Math.max(0, Math.min(4, Math.floor(2 - lit * 1.2 + n * 1.5 + bayer(xx, y) * 0.8)))]);
          }
        }
        front.guard = 0;
      }
      // Fenêtres des immeubles (allumées ou non), peintes une fois pour toutes.
      for (const w of wins) if (w.lit) nw.rect(w.x, w.y, w.w, w.h, C(w.c));

      // Assemblage : seulement hors de l'écran dans les plans du fond d'écran…
      const ox = this.extL;
      const fill = (dst, src) => {
        for (let y = 0; y < H; y++) {
          for (let px = 0; px < dst.w; px++) {
            if (px >= ox && px < ox + W) continue;
            const i = (y * dst.w + px) * 4;
            if (dst.data[i + 3]) continue;
            for (let c = 0; c < 4; c++) dst.data[i + c] = src.data[i + c];
          }
        }
      };
      fill(far, fw);
      fill(near, nw);
      // … et, à part, ce qui manque dans l'écran : tout le ciel, et les immeubles des
      // colonnes où le fond d'écran n'en a pas.
      const gapFar = new Raster(W, H);
      const gapNear = new Raster(W, H);
      for (let y = 0; y < H; y++) gapFar.data.set(fw.data.subarray((y * fw.w + ox) * 4, (y * fw.w + ox + W) * 4), y * W * 4);
      for (let px = 0; px < W; px++) {
        let empty = true;
        for (let y = 0; y < H && empty; y++) if (near.data[(y * near.w + px + ox) * 4 + 3]) empty = false;
        if (!empty) continue;
        for (let y = 0; y < H; y++) {
          const i = (y * nw.w + px + ox) * 4;
          const j = (y * W + px) * 4;
          for (let c = 0; c < 4; c++) gapNear.data[j + c] = nw.data[i + c];
        }
      }
      this.outFarGap = gapFar.toCanvas();
      this.outNearGap = gapNear.toCanvas();
    }

    // Un immeuble proche du monde élargi (même dessin que ceux du fond d'écran).
    paintBuildingW(r, x, w, bi, R, wins) {
      const { L } = this;
      const m = this.mood;
      const Y1 = L.wy1 + 2;
      const top = L.wy0 + Math.round(L.wh * (0.46 + R() * 0.3));
      const col = C(m.bld[bi % m.bld.length]);
      const edge = C(m.edge);
      r.rect(x, top, w, Y1 - top, col);
      r.rect(x + w - 1, top, 1, Y1 - top, mix(col, edge, 0.5));
      r.rect(x - 1, top, w + 2, 1, edge);
      r.rect(x, top + 1, w, 1, shade(col, 0.3));
      const style = R();
      for (let wy = top + 4; wy < Y1 - 3; wy += 5) {
        for (let wx = x + 2; wx + 2 < x + w - 1; wx += 4) {
          r.rect(wx, wy, 2, 3, shade(col, 0.45));
          if (m.snowy) r.rect(wx, wy + 3, 2, 1, C('#aeb8d0'));
          const q = R();
          wins.push({ x: wx, y: wy, w: 2, h: 3, lit: q < m.win, c: q < 0.08 ? '#9cc8ff' : q < 0.3 ? '#ffc070' : '#ffd98e' });
        }
        if (style < 0.25) r.rect(x + 1, wy + 3, w - 2, 1, shade(col, 0.2));
      }
      if (R() < 0.6) {
        r.rect(x + w - 8, top - 3, 5, 3, lighten(col, 0.12));
        if (m.snowy) r.rect(x + w - 8, top - 4, 5, 1, C('#e6ecf6'));
      }
      if (m.snowy) {
        for (let xx = x - 1; xx < x + w + 1; xx++) {
          r.set(xx, top - 1, C('#e6ecf6'));
          if (hash(xx, top, 3) < 0.5) r.set(xx, top - 2, C('#e6ecf6'));
          r.set(xx, top, C('#aeb8d0'));
        }
      }
      if (m.wet) for (let xx = x; xx < x + w; xx++) if (hash(xx, 1, 4) < 0.4) r.set(xx, top + 2, mix(col, edge, 0.35));
    }

    // Vitre de la deuxième fenêtre : reflets, givre quand il neige.
    paintGlassExt(r) {
      const m = this.mood;
      const w = this.E.win;
      r.guard = this.W;
      for (let k = 0; k < 2; k++) {
        const bx = w.x0 + 14 + k * Math.round((w.x1 - w.x0) / 2);
        for (let y = w.y0; y < w.y1; y++) {
          if (m.open && y > w.ty) continue;
          for (let s = 0; s < 2 + k; s++) {
            const x = Math.round(bx + (w.y1 - y) * 0.5 + s);
            if (x < w.x1) r.set(x, y, WHITE, 12);
          }
        }
      }
      if (m.snowy) {
        const panes = [
          [w.x0, w.y0, w.mx - 1, w.ty],
          [w.mx + 2, w.y0, w.x1, w.ty],
          [w.x0, w.ty + 3, w.mx - 1, w.y1],
          [w.mx + 2, w.ty + 3, w.x1, w.y1],
        ];
        const frost = C('#e4ecfa');
        for (const [x0, y0, x1, y1] of panes) {
          for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
              const dc = Math.min(Math.hypot(x - x0, y - y0), Math.hypot(x - x1, y - y0), Math.hypot(x - x0, y - y1), Math.hypot(x - x1, y - y1));
              const de = Math.min(y1 - y, x - x0, x1 - x);
              const n = fbm(x * 0.3, y * 0.3, 61);
              const f = Math.max(1 - dc / (8 + n * 14), 1 - de / (1 + n * 4));
              if (f <= 0) continue;
              const a = Math.floor(f * 4 + bayer(x, y)) / 4;
              if (a > 0) r.set(x, y, hash(x, y, 7) < 0.08 ? WHITE : frost, Math.min(220, 70 + a * 150));
            }
          }
        }
      }
      r.guard = 0;
    }

    // La chambre du monde élargi (rien n'est peint dans l'écran : r.guard).
    paintInsideExt(r) {
      const { W, L, E } = this;
      const m = this.mood;
      const R = rng(5151);
      const fy = L.floorY;
      const xL = -this.extL;
      r.guard = W;
      E.warm = E.lights.slice();

      // Tapis rond sous le fauteuil et le panier du chat.
      {
        const cx = -84;
        const cy = fy + 19;
        const rx = 58;
        const ry = 11;
        const ring = [C('#2e6a6a'), C('#e2cba2'), C('#c8784a'), C('#3e8a84')];
        for (let y = cy - ry; y <= cy + ry; y++) {
          for (let x = cx - rx; x <= cx + rx; x++) {
            const u = Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2);
            if (u > 1) continue;
            const band = Math.floor(u * 7);
            r.set(x, y, u > 0.92 ? ring[0] : ring[band % 4]);
          }
        }
      }

      // Deuxième fenêtre : rideaux, tringle, cadre, rebord.
      const w = E.win;
      const ww = w.x1 - w.x0;
      const wh = w.y1 - w.y0;
      const F = C('#d2c8b8');
      const Fd = C('#9a8e80');
      const Fs = C('#6a6058');
      const cur = C('#8a4a5a');
      const curD = C('#5a2a3a');
      const curL = C('#b06a78');
      const tieY = w.y1 - 10;
      for (const side of [-1, 1]) {
        const ox = side < 0 ? w.x0 - 19 : w.x1 + 19;
        for (let y = w.y0 - 8; y < w.y1 + 18; y++) {
          let cw = 13;
          if (y > tieY - 14 && y < tieY + 2) cw = Math.round(13 - ((y - (tieY - 14)) / 16) * 6);
          if (y >= tieY + 2) cw = Math.min(12, 7 + Math.round((y - tieY - 2) * 0.4));
          for (let k = 0; k < cw; k++) {
            const f = Math.sin(k * 1.3 + (y > tieY ? 1 : 0));
            r.set(side < 0 ? ox + k : ox - k, y, f > 0.55 ? curL : f < -0.5 ? curD : cur);
          }
        }
        r.rect(side < 0 ? ox : ox - 8, tieY - 1, 9, 2, C('#c89a4a'));
      }
      r.rect(w.x0 - 24, w.y0 - 11, ww + 48, 2, C('#2a2230'));
      r.rect(w.x0 - 26, w.y0 - 12, 3, 4, C('#8a6a3a'));
      r.rect(w.x1 + 23, w.y0 - 12, 3, 4, C('#8a6a3a'));
      r.clear(w.x0, w.y0, ww, wh);
      r.rect(w.x0 - 5, w.y0 - 5, ww + 10, 5, F);
      r.rect(w.x0 - 5, w.y0, 5, wh, F);
      r.rect(w.x1, w.y0, 5, wh, F);
      r.rect(w.x0 - 1, w.y0, 1, wh, Fd);
      r.rect(w.x0, w.y0 - 1, ww, 1, Fd);
      r.rect(w.x1, w.y0, 1, wh, Fs);
      r.rect(w.x0 - 5, w.y0 - 5, ww + 10, 1, lighten(F, 0.3));
      r.rect(w.mx - 1, w.y0, 3, wh, F);
      r.rect(w.mx + 1, w.y0, 1, wh, Fd);
      r.rect(w.x0, w.ty, ww, 3, F);
      r.rect(w.x0, w.ty + 2, ww, 1, Fd);
      if (!m.open) r.rect(w.mx - 2, w.ty + 3, 5, 2, C('#c8a050'));
      r.rect(w.x0 - 8, w.y1, ww + 16, 2, lighten(F, 0.15));
      r.rect(w.x0 - 8, w.y1 + 2, ww + 16, 3, Fd);
      for (let x = w.x0 - 8; x < w.x1 + 8; x++) r.tint(x, w.y1 + 5, BLACK, 0.4);
      const pot = { t: '#b8643e', T: '#8a4a2e', g: '#6aae63', G: '#3e7a48' };
      art(r, w.x0 + 6, w.y1 - 7, ['.g.g.', 'gGgGg', '.ggg.', 'ttttt', 'TtttT', '.TTT.'], pot);
      art(r, w.x1 - 30, w.y1 - 6, CACTUS, { g: '#5a9a5a', G: '#7ac06a', t: '#c4774a' });

      // Commode sous la fenêtre : aquarium, lampe de sel, disques.
      const D = E.dresser;
      const wood = C('#7a4e36');
      const woodHi = C('#9a6a4a');
      const woodD = C('#4e3022');
      for (let yy = fy - 3; yy < fy + 4; yy++) for (let x = D.x0; x < D.x1; x++) r.tint(x, yy, BLACK, 0.4);
      r.rect(D.x0, D.top, D.x1 - D.x0, fy - D.top, wood);
      r.rect(D.x0 - 2, D.top, D.x1 - D.x0 + 4, 3, woodHi);
      r.rect(D.x0 - 2, D.top + 2, D.x1 - D.x0 + 4, 1, woodD);
      for (let k = 0; k < 2; k++) {
        const dy = D.top + 5 + k * 12;
        for (const [a, b] of [
          [D.x0 + 3, D.x0 + (D.x1 - D.x0) / 2 - 1],
          [D.x0 + (D.x1 - D.x0) / 2 + 1, D.x1 - 3],
        ]) {
          r.rect(Math.round(a), dy, Math.round(b - a), 10, C('#8a5e40'));
          r.rect(Math.round(a), dy, Math.round(b - a), 1, C('#a87650'));
          r.rect(Math.round(a), dy + 9, Math.round(b - a), 1, woodD);
          r.rect(Math.round((a + b) / 2) - 2, dy + 4, 4, 2, C('#d8c090'));
        }
      }
      r.rect(D.x0 + 2, fy - 4, 3, 4, woodD);
      r.rect(D.x1 - 5, fy - 4, 3, 4, woodD);
      // Aquarium (eau, sable, plantes ; les poissons et les bulles bougent à l'image).
      const T = E.tank;
      r.rect(T.x0 - 1, T.y0 - 2, T.x1 - T.x0 + 2, 2, C('#2a2a34'));
      r.gradient(T.x0, T.y0, T.x1 - T.x0, T.y1 - T.y0, [C('#3a9ac8'), C('#1e6a9a'), C('#14486e')], 5);
      r.rect(T.x0, T.y0, T.x1 - T.x0, 1, C('#8ad8f0'));
      for (let x = T.x0; x < T.x1; x++) {
        const sh = 3 + Math.round(Math.sin(x * 0.4) + hash(x, 2) * 1.2);
        r.rect(x, T.y1 - sh, 1, sh, hash(x, 5) > 0.5 ? C('#d8c08a') : C('#b8a070'));
      }
      for (const px of [T.x0 + 5, T.x0 + 9, T.x1 - 8]) {
        let x = px;
        for (let y = T.y1 - 3; y > T.y0 + 5 + (px % 5); y--) {
          if (hash(px, y, 1) > 0.6) x += hash(px, y, 2) > 0.5 ? 1 : -1;
          r.set(x, y, (T.y1 - y) % 3 ? C('#3e9a4a') : C('#6ac06a'));
          if ((T.y1 - y) % 4 === 0) r.set(x + 1, y, C('#4eaa5a'));
        }
      }
      art(r, T.x1 - 17, T.y1 - 8, ['..s..', '.sss.', 'sssss', 'sdsds'], { s: '#8a8a9a', d: '#4a4a5a' });
      r.rect(T.x0 - 1, T.y0, 1, T.y1 - T.y0, C('#b8e0f0'));
      r.rect(T.x1, T.y0, 1, T.y1 - T.y0, C('#6a9ab0'));
      r.rect(T.x0 - 1, T.y1, T.x1 - T.x0 + 2, 1, C('#2a2a34'));
      // Lampe de sel.
      const sx = E.salt.x;
      const sy = E.salt.y;
      r.rect(sx - 4, sy - 2, 9, 2, C('#4a3022'));
      art(r, sx - 3, sy - 11, ['..oo...', '.oOoo..', 'oOoooo.', 'ooOooo.', 'oooOoo.', '.ooooo.', '.oooo..', '..ooo..', '.ooooo.'], { o: '#f29a5a', O: '#ffd0a0' });
      // Pile de vinyles et petite plante.
      const vx = T.x1 + 6;
      for (let k = 0; k < 4; k++) r.rect(vx, sy - 2 - k * 2, 20, 2, [C('#2e4a6a'), C('#c84a3a'), C('#e8c040'), C('#3e7a48')][k]);
      r.rect(vx + 4, sy - 13, 8, 5, C('#e8e0d0'));
      for (let k = 0; k < 24; k++) r.set(vx + 8 + Math.round((R() - 0.5) * 12), sy - 14 - Math.floor(R() * 8), [C('#3e7a48'), C('#5a9a5a'), C('#7ab86a')][Math.floor(R() * 3)]);

      // Lampadaire arqué au-dessus du fauteuil.
      const lp = E.lamp;
      const pole = C('#2a2630');
      const poleHi = C('#5a5468');
      r.rect(lp.base - 5, fy - 2, 11, 3, pole);
      r.rect(lp.base - 5, fy - 2, 11, 1, poleHi);
      for (let y = fy - 2; y > lp.y - 8; y--) r.set(lp.base, y, pole);
      for (let k = 0; k <= 24; k++) {
        const u = k / 24;
        const x = Math.round(lp.base + (lp.x - lp.base) * u);
        const y = Math.round(lp.y - 8 - Math.sin(u * Math.PI) * 10 + u * 2);
        r.set(x, y, k < 12 ? poleHi : pole);
      }
      art(r, lp.x - 6, lp.y - 6, ['....mm....', '..mMMMMm..', '.mMMMMMMm.', 'mMMMMMMMMm', 'mmmmmmmmmm'], { m: '#c8a050', M: '#e8c47c' });

      // Fauteuil moutarde, plaid et coussin.
      const ch = E.chair;
      const must = [C('#7a5420'), C('#a8782e'), C('#c8963a'), C('#e0b456')];
      for (let yy = fy - 1; yy < fy + 4; yy++) for (let x = ch.x0 - 2; x < ch.x1 + 2; x++) r.tint(x, yy, BLACK, 0.45);
      for (let y = ch.seat - 26; y < ch.seat; y++) {
        const inset = y < ch.seat - 22 ? Math.round((ch.seat - 22 - y) * 0.8) : 0;
        for (let x = ch.x0 + 4 + inset; x < ch.x1 - 4 - inset; x++) r.set(x, y, x < ch.x0 + 7 ? must[1] : y < ch.seat - 22 ? must[3] : must[2]);
      }
      r.rect(ch.x0 + 6, ch.seat - 3, ch.x1 - ch.x0 - 12, 5, must[3]);
      r.rect(ch.x0 + 6, ch.seat + 2, ch.x1 - ch.x0 - 12, 1, must[0]);
      r.rect(ch.x0 + 6, ch.seat + 3, ch.x1 - ch.x0 - 12, fy - ch.seat - 6, must[1]);
      for (const ax of [ch.x0, ch.x1 - 7]) {
        r.rect(ax, ch.seat - 12, 7, fy - ch.seat + 9, must[2]);
        r.rect(ax, ch.seat - 12, 7, 2, must[3]);
        r.rect(ax + (ax === ch.x0 ? 0 : 6), ch.seat - 10, 1, fy - ch.seat + 7, must[0]);
      }
      for (const fx of [ch.x0 + 2, ch.x1 - 4]) r.rect(fx, fy - 3, 2, 4, C('#3a2418'));
      // Coussin et plaid à carreaux posé en travers.
      art(r, ch.x0 + 9, ch.seat - 14, ['.pppppp.', 'pPpppPpp', 'pppPpppp', 'ppppppPp', '.pppppp.'], { p: '#4c7684', P: '#6a96a0' });
      for (let y = ch.seat - 4; y < ch.seat + 14; y++) {
        const x0 = ch.x1 - 18 + Math.round((y - ch.seat) * 0.3);
        for (let x = x0; x < x0 + 12; x++) r.set(x, y, ((x >> 2) + (y >> 2)) & 1 ? C('#c84a4a') : C('#e8d8c0'));
      }
      // Livre ouvert posé sur l'accoudoir.
      r.rect(ch.x0, ch.seat - 14, 7, 2, C('#f2ead8'));
      r.rect(ch.x0 + 3, ch.seat - 14, 1, 2, C('#b8ac98'));

      // Panier du chat (le chat gris dort dedans, dessiné à l'image).
      const cb = E.catBed;
      for (let y = 0; y < 9; y++) {
        const hw = Math.round(16 - Math.max(0, y - 5) * 1.2);
        for (let x = -hw; x <= hw; x++) {
          let c = (x + y * 2) % 4 === 0 ? C('#8a5a2e') : C('#b07a3e');
          if (y === 0) c = C('#d8a050');
          r.set(cb.x + x, cb.y - 9 + y, c);
        }
      }
      r.rect(cb.x - 13, cb.y - 10, 27, 2, C('#c84a4a'));
      r.rect(cb.x - 12, cb.y - 11, 25, 1, C('#e06a6a'));

      // Guitare sur son support et petit ampli.
      const gx = E.guitar.x;
      const gy = fy - 2;
      r.rect(gx - 6, gy - 1, 13, 2, C('#1e1a22'));
      r.rect(gx - 5, gy - 9, 1, 8, C('#1e1a22'));
      r.rect(gx + 5, gy - 9, 1, 8, C('#1e1a22'));
      const body = C('#c8823a');
      const bodyD = C('#8a4e22');
      for (let y = -24; y <= 0; y++) {
        const t = (y + 24) / 24;
        const hw = Math.round(t < 0.4 ? 5 + Math.sin((t / 0.4) * Math.PI) * 1.5 : 4 + Math.sin(((t - 0.4) / 0.6) * Math.PI) * 4);
        for (let x = -hw; x <= hw; x++) r.set(gx + x, gy - 4 + y, Math.abs(x) === hw ? bodyD : x < -hw + 2 ? C('#e0a050') : body);
      }
      for (let y = -14; y <= -10; y++) for (let x = -2; x <= 2; x++) if (x * x + (y + 12) * (y + 12) <= 5) r.set(gx + x, gy - 4 + y, C('#2a1408'));
      r.rect(gx - 2, gy - 6, 5, 1, C('#4a2a14'));
      r.rect(gx, gy - 52, 1, 24, C('#5a3a22'));
      r.rect(gx + 1, gy - 52, 1, 24, C('#3a2414'));
      for (let y = gy - 50; y < gy - 30; y += 3) r.set(gx, y, C('#d8d0c0'));
      r.rect(gx - 1, gy - 58, 4, 6, C('#3a2414'));
      for (const y of [gy - 57, gy - 55, gy - 53]) {
        r.set(gx - 2, y, C('#d8d0c0'));
        r.set(gx + 3, y, C('#d8d0c0'));
      }
      const A = E.amp;
      r.rect(A.x0, fy - 16, A.x1 - A.x0, 16, C('#1e1a22'));
      r.rect(A.x0, fy - 16, A.x1 - A.x0, 1, C('#4a4458'));
      for (let y = fy - 12; y < fy - 2; y++) for (let x = A.x0 + 2; x < A.x1 - 2; x++) r.set(x, y, (x + y) % 2 ? C('#2e2a36') : C('#3a3644'));
      r.rect(A.x0 + 2, fy - 15, A.x1 - A.x0 - 4, 2, C('#c8a050'));
      E.led = { x: A.x1 - 4, y: fy - 15 };
      // Câble de la guitare à l'ampli.
      for (let x = A.x1; x < gx - 3; x++) r.set(x, fy - 1 + Math.round(Math.sin(x * 0.5) * 0.6), C('#14121a'));

      // Poster de concert au-dessus du panier.
      {
        const px = -76;
        const py = 70;
        r.rect(px - 1, py - 1, 30, 40, C('#efe6d4'));
        r.gradient(px, py, 28, 38, ['#2a1e4a', '#8a3a6a', '#f2906a'].map(C), 6);
        for (let k = 0; k < 28; k++) {
          const my = Math.round(py + 26 + Math.abs(((k * 5) % 11) - 5) * 0.8);
          for (let y = my; y < py + 38; y++) r.set(px + k, y, C('#1a1430'));
        }
        r.rect(px + 9, py + 10, 10, 10, C('#ffd88a'));
        r.rect(px + 8, py + 11, 12, 8, C('#ffd88a'));
        X.text(r, 'LIVE', px + 7, py + 3, C('#f6ead8'));
        r.rect(px - 2, py - 2, 3, 2, C('#f2e6a8'));
        r.rect(px + 27, py - 2, 3, 2, C('#f2e6a8'));
      }

      // La porte (la lumière du couloir passe dessous, dessinée à l'image).
      const d = E.door;
      const dw = d.x1 - d.x0;
      r.rect(d.x0 - 5, d.top - 5, dw + 10, fy - d.top + 5, F);
      r.rect(d.x0 - 5, d.top - 5, dw + 10, 1, lighten(F, 0.3));
      r.rect(d.x1 + 4, d.top - 4, 1, fy - d.top + 4, Fs);
      const dc = C('#4a5a78');
      const dcHi = C('#5c6e90');
      const dcD = C('#34405a');
      r.rect(d.x0, d.top, dw, fy - d.top - 1, dc);
      for (const [py0, py1] of [
        [d.top + 6, d.top + 46],
        [d.top + 54, fy - 8],
      ]) {
        for (const [px0, px1] of [
          [d.x0 + 5, d.x0 + dw / 2 - 2],
          [d.x0 + dw / 2 + 2, d.x1 - 5],
        ]) {
          r.rect(Math.round(px0), py0, Math.round(px1 - px0), py1 - py0, dcD);
          r.rect(Math.round(px0) + 1, py0 + 1, Math.round(px1 - px0) - 2, py1 - py0 - 2, dc);
          r.rect(Math.round(px0) + 1, py1 - 1, Math.round(px1 - px0) - 1, 1, dcHi);
        }
      }
      r.rect(d.x1 - 8, d.top + 52, 4, 2, C('#d8b064'));
      r.rect(d.x1 - 7, d.top + 54, 2, 2, C('#a8803a'));
      // Autocollants et un petit poster sur la porte.
      r.rect(d.x0 + 9, d.top + 12, 12, 16, C('#f2e6d2'));
      r.gradient(d.x0 + 10, d.top + 13, 10, 14, ['#3a6aa4', '#6aae63'].map(C), 3);
      r.rect(d.x1 - 15, d.top + 18, 5, 5, C('#ff79b0'));
      r.rect(d.x1 - 12, d.top + 30, 6, 4, C('#ffd27a'));
      r.set(d.x1 - 10, d.top + 31, C('#2a1a14'));
      // Interrupteur.
      r.rect(d.x1 + 9, d.top + 50, 4, 6, C('#e8e0d0'));
      r.rect(d.x1 + 10, d.top + 52, 2, 2, C('#b8b0a0'));
      // Patères : sac à dos jaune et sweat rouge.
      const hk = E.hooks;
      r.rect(hk.x0, hk.y, hk.x1 - hk.x0, 3, C('#7a5236'));
      r.rect(hk.x0, hk.y, hk.x1 - hk.x0, 1, C('#a87650'));
      for (const px of [hk.x0 + 7, hk.x0 + 21]) r.rect(px, hk.y + 3, 2, 2, C('#c8a050'));
      art(r, hk.x0 + 1, hk.y + 4, ['..yyyyy...', '.yYYYYYy..', 'yyYYYYyyy.', 'yyyyyyyyy.', 'yYbbbbbYy.', 'yybbbbbyy.', 'yyyyyyyyy.', 'yyyyyyyyy.', 'yyyyyyyyy.', 'yyyyyyyyy.', '.yyyyyyy..'], { y: '#d8a83a', Y: '#f0c85a', b: '#b0802a' });
      art(r, hk.x0 + 16, hk.y + 4, ['..rrrr...', '.rrRRrr..', 'rrrrrrrr.', 'rrrrrrrrr', 'rrrRrrrrr', 'rrrrrrrrr', 'rrrrrrrrr', 'rrrrRrrrr', 'rrrrrrrr.', 'rrrrrrrr.', 'rrrrrrrr.', 'rrrrrrrr.', 'rrrrrrrr.', 'RRRRRRRR.'], { r: '#b8443c', R: '#d8645a' });
      // Skate posé contre le mur.
      const sk = E.skate;
      for (let k = 0; k < 40; k++) {
        const x = sk.x + Math.round(k * 0.18);
        const y = fy - 4 - k;
        r.rect(x, y, 4, 1, k < 2 || k > 37 ? C('#2a2230') : C('#3e8a84'));
        if (k % 9 === 4) r.set(x + 1, y, C('#f2d27a'));
      }
      for (const k of [5, 34]) r.rect(sk.x - 1 + Math.round(k * 0.18), fy - 4 - k, 1, 3, C('#e8e0d0'));

      // L'armoire, ses boîtes et une plante dessus.
      const wd = E.wardrobe;
      if (wd) {
        for (let yy = fy - 2; yy < fy + 4; yy++) for (let x = wd.x0; x < wd.x1; x++) r.tint(x, yy, BLACK, 0.4);
        r.rect(wd.x0, wd.top, wd.x1 - wd.x0, fy - wd.top, wood);
        r.rect(wd.x0 - 2, wd.top - 3, wd.x1 - wd.x0 + 4, 3, woodHi);
        r.rect(wd.x0, wd.top, 1, fy - wd.top, woodHi);
        r.rect(wd.x1 - 1, wd.top, 1, fy - wd.top, woodD);
        const mid = Math.round((wd.x0 + wd.x1) / 2);
        const dTop = wd.top + 4;
        const dBot = fy - 20;
        for (const [a, b] of [
          [wd.x0 + 3, mid - 1],
          [mid + 1, wd.x1 - 3],
        ]) {
          r.rect(a, dTop, b - a, dBot - dTop, C('#8a5e40'));
          r.rect(a + 3, dTop + 4, b - a - 6, dBot - dTop - 8, C('#7a5236'));
          r.rect(a + 3, dTop + 4, b - a - 6, 1, woodD);
          r.rect(a, dTop, b - a, 1, C('#a87650'));
        }
        r.rect(mid - 4, Math.round((dTop + dBot) / 2), 2, 4, C('#d8c090'));
        r.rect(mid + 3, Math.round((dTop + dBot) / 2), 2, 4, C('#d8c090'));
        r.rect(wd.x0 + 3, dBot + 3, wd.x1 - wd.x0 - 6, 12, C('#8a5e40'));
        r.rect(wd.x0 + 3, dBot + 3, wd.x1 - wd.x0 - 6, 1, C('#a87650'));
        r.rect(mid - 3, dBot + 8, 6, 2, C('#d8c090'));
        // Sur l'armoire : cartons, une valise, une plante qui retombe.
        r.rect(wd.x0 + 4, wd.top - 15, 20, 12, C('#a8845a'));
        r.rect(wd.x0 + 4, wd.top - 15, 20, 1, C('#c8a478'));
        r.rect(wd.x0 + 13, wd.top - 15, 2, 12, C('#d8c8a0'));
        r.rect(wd.x0 + 26, wd.top - 10, 18, 7, C('#3e6e8e'));
        r.rect(wd.x0 + 26, wd.top - 10, 18, 1, C('#5e8eae'));
        r.rect(wd.x0 + 33, wd.top - 12, 4, 2, C('#2a2230'));
        const ppx = wd.x1 - 14;
        r.rect(ppx, wd.top - 9, 10, 6, C('#e8e0d0'));
        r.rect(ppx, wd.top - 9, 10, 1, C('#fff8ec'));
        const leaf = ['#2a5a34', '#3e7a48', '#5a9a5a', '#7ab86a'].map(C);
        for (let k = 0; k < 40; k++) r.set(ppx + 5 + Math.round((R() - 0.5) * 16), wd.top - 10 - Math.floor(R() * 8), leaf[1 + Math.floor(R() * 3)]);
        for (let v = 0; v < 4; v++) {
          let vx = ppx + 1 + v * 3;
          for (let y = wd.top - 4; y < wd.top + 10 + v * 9; y++) {
            if (R() < 0.3) vx += R() < 0.5 ? -1 : 1;
            r.set(vx, y, leaf[0]);
            if (y % 3 === 0) r.set(vx + 1, y, leaf[2]);
          }
        }
      }
      // Grande plante (monstera) dans le coin.
      if (E.plant) this.paintMonstera(r, E.plant.x, fy + 3);
      // À droite de l'écran : une sansevière et un petit cadre.
      if (E.snake) {
        const sx2 = E.snake.x;
        r.rect(sx2 - 6, fy - 12, 13, 12, C('#e8e0d0'));
        r.rect(sx2 - 6, fy - 12, 13, 1, C('#fff8ec'));
        for (let k = 0; k < 7; k++) {
          const lx = sx2 - 5 + k * 2;
          const len = 18 + ((k * 7) % 11);
          for (let j = 0; j < len; j++) r.rect(lx + Math.round(Math.sin(j * 0.1 + k) * 0.8), fy - 13 - j, 2, 1, j % 5 === 2 ? C('#a8c86a') : k % 2 ? C('#3e7a48') : C('#5a9a5a'));
        }
        r.rect(W + 48, 46, 22, 28, C('#efe6d4'));
        r.gradient(W + 49, 47, 20, 26, ['#f2c27a', '#e07a7a', '#3a3a7a'].map(C), 5);
      }

      // Guirlande lumineuse avec des polaroïds.
      const wire = C('#1a1420');
      E.fairy = [];
      let bi = 0;
      for (const [x0, x1] of E.fairySpans) {
        if (x1 - x0 < 30) continue;
        const spans = Math.max(2, Math.round((x1 - x0) / 40));
        const sw = (x1 - x0) / spans;
        for (let x = x0; x <= x1; x++) {
          const u = ((x - x0) % sw) / sw;
          const y = Math.round(24 + Math.sin(u * Math.PI) * 9);
          r.set(x, y, wire);
          if ((x - x0) % 7 === 3) {
            E.fairy.push({ x, y: y + 1, c: FAIRY[bi % FAIRY.length], p: hash(bi, 13) * 6.28, s: 0.8 + hash(bi, 14) * 1.6 });
            bi++;
          }
          if (Math.abs(u - 0.5) < 0.5 / sw && Math.floor((x - x0) / sw) % 2 === 1) {
            r.rect(x - 3, y + 1, 7, 8, C('#f2ece0'));
            r.rect(x - 2, y + 2, 5, 4, [C('#e8a06a'), C('#5a8ac4'), C('#b98cff'), C('#6aae63')][Math.floor((x - x0) / sw) % 4]);
            r.set(x, y, C('#c8a050'));
          }
        }
      }
      r.guard = 0;
    }

    paintMonstera(r, x, ground) {
      r.rect(x - 8, ground - 15, 17, 15, C('#c4774a'));
      r.rect(x - 8, ground - 15, 17, 2, C('#e09a68'));
      r.rect(x - 7, ground - 2, 15, 2, C('#8a4a2e'));
      const leaf = ['#21402b', '#33603d', '#4b8a50', '#6bae63'].map(C);
      for (let li = 0; li < 9; li++) {
        const ang = -Math.PI / 2 + (li - 4) * 0.3;
        const len = 22 + ((li * 7) % 13);
        for (let k = 0; k < len; k++) {
          const bx = Math.round(x + Math.cos(ang) * k);
          const by = Math.round(ground - 16 + Math.sin(ang) * k + (k * k) / 70);
          r.set(bx, by, leaf[0]);
          if (k > len * 0.45) {
            const half = Math.round(Math.sin(((k - len * 0.45) / (len * 0.55)) * Math.PI) * 5);
            for (let s = -half; s <= half; s++) {
              if (Math.abs(s) === half && hash(k, s, li) > 0.6) continue;
              r.set(bx - Math.round(Math.sin(ang) * s), by + Math.round(Math.cos(ang) * s), s < 0 ? leaf[2] : leaf[1]);
            }
          }
        }
      }
    }

    /* ---------- La vie du monde élargi (son propre hasard : this.xr) ---------- */
    initExt() {
      const E = this.E;
      this.xr = rng(2718);
      const grey = { '226,137,60': [138, 138, 150], '168,90,38': [92, 92, 106], '242,182,124': [200, 200, 210] };
      const S = this.sprites.cat;
      this.greyCat = {};
      for (const k of ['sleep', 'sit', 'lick']) this.greyCat[k] = S[k].map((c) => recolorCanvas(c, grey));
      this.cat2 = { state: 'sleep', until: 12 + this.xr() * 10, frameT: 0 };
      const T = E.tank;
      this.fish = [
        { c: '#ff8a3a', y: T.y0 + 6, x: T.x0 + 8, v: 4, dir: 1 },
        { c: '#ffd25a', y: T.y0 + 11, x: T.x1 - 10, v: 3, dir: -1 },
        { c: '#ff5a8a', y: T.y0 + 15, x: T.x0 + 18, v: 5, dir: 1 },
      ];
      this.bubbles = [];
      this.extGlassDrops = [];
      const w = E.win;
      for (let k = 0; k < 14; k++) this.extGlassDrops.push({ x: Math.round(w.x0 + 2 + this.xr() * (w.x1 - w.x0 - 4)), y: w.y0 + this.xr() * (w.y1 - w.y0), rest: this.xr() * 6, v: 0, trail: [] });
      this.hall = { shadow: -1, next: 6 }; // quelqu'un passe dans le couloir
    }

    updateExt(dt) {
      const E = this.E;
      const R = this.xr;
      const T = E.tank;
      for (const f of this.fish) {
        f.x += f.dir * f.v * dt;
        if (f.x < T.x0 + 2 || f.x > T.x1 - 5) {
          f.dir *= -1;
          f.x = Math.max(T.x0 + 2, Math.min(T.x1 - 5, f.x));
        }
        if (R() < dt * 0.3) f.dir *= -1;
      }
      if (R() < dt * 2.5) this.bubbles.push({ x: T.x1 - 15 + Math.floor(R() * 3), y: T.y1 - 6, ph: R() * 6 });
      for (const b of this.bubbles) {
        b.y -= dt * 9;
        b.x += Math.sin(b.y * 0.8 + b.ph) * dt * 2;
      }
      this.bubbles = this.bubbles.filter((b) => b.y > T.y0 + 1);
      // Le chat gris : dort, se redresse, fait sa toilette, se rendort.
      const c = this.cat2;
      c.frameT += dt;
      if (this.t > c.until) {
        c.state = c.state === 'sleep' ? 'sit' : c.state === 'sit' ? (R() < 0.6 ? 'lick' : 'sleep') : 'sleep';
        c.until = this.t + (c.state === 'sleep' ? 18 + R() * 20 : 2.5 + R() * 2);
        c.frameT = 0;
      }
      // Quelqu'un passe dans le couloir : son ombre glisse sous la porte.
      const h = this.hall;
      h.next -= dt;
      if (h.shadow < 0 && h.next <= 0) {
        h.shadow = 0;
        h.dir = R() < 0.5 ? 1 : -1;
      }
      if (h.shadow >= 0) {
        h.shadow += dt * 0.45;
        if (h.shadow > 1) {
          h.shadow = -1;
          h.next = 12 + R() * 15;
        }
      }
      if (this.mood.wet) {
        const w = E.win;
        for (const g of this.extGlassDrops) {
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
      }
    }

    // Étoiles qui scintillent par la deuxième fenêtre ; éclairs.
    drawExtSky(g) {
      const t = this.t;
      for (const s of this.E.twinkles) {
        const k = Math.sin(t * 2.2 + s.p);
        if (k < 0.2) continue;
        g.fillStyle = `rgba(255,255,240,${0.4 + k * 0.5})`;
        g.fillRect(s.x, s.y, 1, 1);
        if (s.big && k > 0.7) {
          g.fillStyle = 'rgba(255,255,240,0.35)';
          g.fillRect(s.x - 1, s.y, 3, 1);
          g.fillRect(s.x, s.y - 1, 1, 3);
        }
      }
      if (this.flash > 0) {
        const w = this.E.win;
        g.fillStyle = `rgba(200,210,255,${Math.min(0.5, this.flash * 0.6) * (Math.sin(t * 50) > -0.3 ? 1 : 0.4)})`;
        g.fillRect(w.x0, w.y0, w.x1 - w.x0, w.y1 - w.y0);
      }
    }

    drawExtGlass(g) {
      if (!this.mood.wet) return;
      for (const d of this.extGlassDrops) {
        for (const p of d.trail) {
          g.fillStyle = `rgba(190,210,240,${0.22 * (1 - p.age / 3)})`;
          g.fillRect(p.x, p.y, 1, 1);
        }
        g.fillStyle = 'rgba(150,170,210,0.55)';
        g.fillRect(d.x - 1, Math.round(d.y), 3, 2);
        g.fillStyle = 'rgba(230,240,255,0.9)';
        g.fillRect(d.x, Math.round(d.y), 1, 1);
      }
    }

    drawExtInside(g) {
      const { L, E } = this;
      const t = this.t;
      // Poissons et bulles.
      for (const f of this.fish) {
        const x = Math.round(f.x);
        const y = Math.round(f.y + Math.sin(t * 1.3 + f.v) * 1.2);
        g.fillStyle = f.c;
        g.fillRect(x, y, 3, 2);
        g.fillRect(f.dir > 0 ? x - 1 : x + 3, y + (Math.sin(t * 9 + f.v) > 0 ? 0 : 1), 1, 1);
        g.fillStyle = '#1a1a22';
        g.fillRect(f.dir > 0 ? x + 2 : x, y, 1, 1);
      }
      g.fillStyle = 'rgba(220,245,255,0.75)';
      for (const b of this.bubbles) g.fillRect(Math.round(b.x), Math.round(b.y), 1, 1);
      // Le chat gris dans son panier.
      const c = this.cat2;
      const fr = this.greyCat[c.state];
      const img = fr[Math.floor(c.frameT / (c.state === 'sleep' ? 1.4 : c.state === 'lick' ? 0.3 : 0.7)) % fr.length];
      g.drawImage(img, Math.round(E.catBed.x - img.width / 2), E.catBed.y - 8 - img.height + 1);
      // Bord avant du panier (devant le chat).
      g.fillStyle = '#7a4e2a';
      g.fillRect(E.catBed.x - 15, E.catBed.y - 8, 31, 2);
      g.fillStyle = '#9a6a36';
      g.fillRect(E.catBed.x - 15, E.catBed.y - 8, 31, 1);
      // Lumière du couloir sous la porte (et l'ombre de quelqu'un qui passe).
      const d = E.door;
      g.fillStyle = '#ffcf7a';
      g.fillRect(d.x0, L.floorY - 1, d.x1 - d.x0, 1);
      if (this.hall.shadow >= 0) {
        const u = this.hall.dir > 0 ? this.hall.shadow : 1 - this.hall.shadow;
        g.fillStyle = '#2a1e1a';
        g.fillRect(Math.round(d.x0 - 10 + u * (d.x1 - d.x0 + 10)), L.floorY - 1, 8, 1);
      }
      // Ampoule du lampadaire, voyant de l'ampli, guirlande.
      g.fillStyle = '#fff3cc';
      g.fillRect(E.lamp.x - 3, E.lamp.y - 1, 7, 1);
      g.fillStyle = Math.sin(t * 1.1) > -0.6 ? '#ff4a4a' : '#7a1a1a';
      g.fillRect(E.led.x, E.led.y, 1, 1);
      for (const b of E.fairy) {
        const k = 0.55 + 0.45 * Math.sin(t * b.s + b.p);
        g.fillStyle = css(b.c.map((v) => v * k));
        g.fillRect(b.x, b.y, 1, 2);
      }
    }

    // (mode « lumière ») lueurs de la guirlande, du couloir, de la lampe de sel.
    drawExtGlow(g) {
      const { L, E } = this;
      const t = this.t;
      for (const b of E.fairy) {
        const k = 0.5 + 0.5 * Math.sin(t * b.s + b.p);
        g.fillStyle = css(b.c, 0.12 * k);
        g.fillRect(b.x - 1, b.y - 1, 3, 4);
      }
      const d = E.door;
      g.fillStyle = 'rgba(255,190,110,0.12)';
      g.fillRect(d.x0 - 4, L.floorY, d.x1 - d.x0 + 8, 3);
      g.fillStyle = 'rgba(255,190,110,0.06)';
      g.fillRect(d.x0 - 10, L.floorY + 3, d.x1 - d.x0 + 20, 4);
      g.fillStyle = `rgba(255,140,80,${0.1 + 0.03 * Math.sin(t * 0.8)})`;
      g.fillRect(E.salt.x - 5, E.salt.y - 13, 11, 13);
      g.fillStyle = `rgba(90,190,255,${0.08 + 0.02 * Math.sin(t * 1.7)})`;
      g.fillRect(E.tank.x0, E.tank.y0, E.tank.x1 - E.tank.x0, E.tank.y1 - E.tank.y0);
    }

    /* ================= L'écran : du code qui s'écrit ================= */
    initCode() {
      this.code = [];
      const n = Math.floor((this.L.scr.h - 4) / 3);
      this.codeRows = n;
      for (let k = 0; k < n; k++) {
        const l = this.newLine();
        l.typed = l.len;
        this.code.push(l);
      }
      this.code[n - 1].typed = 0;
    }

    newLine() {
      const maxW = this.L.scr.w - 9;
      if (Math.random() < 0.15) return { ind: 0, segs: [], len: 0, typed: 0 };
      const ind = Math.floor(Math.random() * 4);
      const segs = [];
      let len = 0;
      const n = 1 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) {
        const w = 2 + Math.floor(Math.random() * 7);
        if (ind * 3 + len + w > maxW) break;
        segs.push({ w, c: TOK[Math.floor(Math.random() * TOK.length)] });
        len += w + 1;
      }
      return { ind, segs, len, typed: 0 };
    }

    keystroke() {
      const cur = this.code[this.code.length - 1];
      cur.typed += 1 + (Math.random() < 0.4 ? 1 : 0);
      if (cur.typed >= cur.len) {
        this.code.push(this.newLine());
        if (this.code.length > this.codeRows) this.code.shift();
      }
    }

    /* ================= Vie de la scène ================= */
    newGlassDrop(initial) {
      const { L } = this;
      return {
        x: Math.round(L.wx0 + 2 + Math.random() * (L.wx1 - L.wx0 - 4)),
        y: initial ? L.wy0 + Math.random() * L.wh : L.wy0 + Math.random() * 20,
        rest: Math.random() * 6,
        v: 0,
        trail: [],
      };
    }

    update(dt, ctx) {
      const { L } = this;
      const eff = (ctx && ctx.effect) || 'none';
      // Sans « night » dans le contexte (caméra d'ouverture), on garde l'état courant.
      const night = ctx && 'night' in ctx ? !!ctx.night : this.night;
      if (eff !== this.eff || night !== this.night) this.build(eff, night);
      const m = this.mood;
      this.t += dt;

      // Gouttes qui glissent sur la vitre (pluie, orage).
      if (m.wet) {
        for (const g of this.glassDrops) {
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
          if (Math.random() < dt * 0.8) {
            g.rest = Math.random() * 2;
            g.v = 0;
          }
          if (g.y > L.wy1 - 2) Object.assign(g, this.newGlassDrop(false));
        }
      }

      // Éclairs (orage).
      if (m.storm) {
        this.nextFlash -= dt;
        if (this.nextFlash <= 0) {
          this.flash = 1;
          this.bolt = this.makeBolt();
          this.nextFlash = 5 + Math.random() * 10;
        }
      }
      if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 1.6);

      // Fenêtres d'en face qui s'allument et s'éteignent ; silhouette.
      this.nextToggle -= dt;
      if (this.nextToggle <= 0 && this.wins.length) {
        const w = this.wins[Math.floor(Math.random() * this.wins.length)];
        if (w !== this.silhouette.win) w.lit = !w.lit;
        this.nextToggle = 1.5 + Math.random() * 4;
      }
      const s = this.silhouette;
      s.x += s.dir * dt * 0.6;
      if (s.x > 1 || s.x < 0) s.dir *= -1;

      // Avion qui traverse le ciel, feux clignotants.
      this.nextPlane -= dt;
      if (!this.plane && this.nextPlane <= 0) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        this.plane = { dir, x: dir > 0 ? L.wx0 - 12 : L.wx1 + 4, y: L.wy0 + 6 + Math.floor(Math.random() * L.wh * 0.25), v: 7 + Math.random() * 3, t: 0 };
        this.nextPlane = 30 + Math.random() * 40;
      }
      if (this.plane) {
        const p = this.plane;
        p.x += p.dir * p.v * dt;
        p.y -= dt * 0.25;
        p.t += dt;
        if (p.x < L.wx0 - 20 || p.x > L.wx1 + 12) this.plane = null;
      }
      // Métro aérien.
      this.nextTrain -= dt;
      if (!this.train && this.nextTrain <= 0) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        this.train = { dir, x: dir > 0 ? L.wx0 - 75 : L.wx1 + 4, v: 26 + Math.random() * 8 };
        this.nextTrain = 25 + Math.random() * 35;
      }
      if (this.train) {
        this.train.x += this.train.dir * this.train.v * dt;
        if (this.train.x < L.wx0 - 80 || this.train.x > L.wx1 + 10) this.train = null;
      }
      // Étoile filante (nuits dégagées seulement ; la pluie d'étoiles a sa propre couche).
      if (m.shooting) {
        this.nextShoot -= dt;
        if (!this.shoot && this.nextShoot <= 0) {
          this.shoot = { x: L.wx0 + 20 + Math.random() * (L.wx1 - L.wx0 - 40), y: L.wy0 + 4 + Math.random() * 14, age: 0, dir: Math.random() < 0.5 ? 1 : -1 };
          this.nextShoot = 30 + Math.random() * 50;
        }
      }
      if (this.shoot) {
        this.shoot.age += dt;
        if (this.shoot.age > 0.7) this.shoot = null;
      }

      this.updatePerson(dt);
      this.updateCat(dt);

      // Vapeur de la tasse, notes du tourne-disque.
      if (this.person.mode !== 'sip' && Math.random() < dt * 5) this.steam.emit(L.mug.x + 1 + Math.random() * 3, L.mug.y - 1, 1.8 + Math.random(), 7);
      this.steam.update(dt);
      this.nextNote -= dt;
      if (this.nextNote <= 0) {
        this.notes.emit(this.record.x - 2 + Math.random() * 4, this.record.y - 8);
        this.nextNote = 1.2 + Math.random() * 1.8;
      }
      this.notes.update(dt);
      if (this.ext) this.updateExt(dt);
    }

    makeBolt() {
      const { L } = this;
      const pts = [];
      let x = L.wx0 + 20 + Math.random() * (L.wx1 - L.wx0 - 40);
      for (let y = L.wy0; y < L.trackY; y += 3) {
        pts.push([Math.round(x), y]);
        x += (Math.random() - 0.5) * 6;
      }
      return pts;
    }

    // La personne : tape par rafales, écoute la musique, s'étire, boit une gorgée.
    updatePerson(dt) {
      const p = this.person;
      const t = this.t;
      p.nextStretch -= dt;
      p.nextSip -= dt;
      if ((p.mode === 'stretch' || p.mode === 'sip') && t < p.until) return;
      if (p.mode === 'stretch' || p.mode === 'sip') {
        p.mode = 'type';
        p.until = t + 2 + Math.random() * 4;
      }
      if (p.nextStretch <= 0) {
        p.mode = 'stretch';
        p.until = t + 3;
        p.nextStretch = 45 + Math.random() * 40;
        return;
      }
      if (p.nextSip <= 0) {
        p.mode = 'sip';
        p.until = t + 3;
        p.nextSip = 20 + Math.random() * 20;
        return;
      }
      if (t >= p.until) {
        p.mode = p.mode === 'type' ? 'listen' : 'type';
        p.until = t + (p.mode === 'type' ? 2.5 + Math.random() * 5 : 1.5 + Math.random() * 3);
      }
      if (p.mode === 'type') {
        p.nextKey -= dt;
        if (p.nextKey <= 0) {
          p.key++;
          this.keystroke();
          p.nextKey = 0.09 + Math.random() * 0.14;
        }
      }
    }

    /* ---------- Le chat : une suite d'actions (dormir, s'étirer, descendre du lit…) ---------- */
    startStep() {
      const c = this.cat;
      const s = c.queue[0];
      if (!s) return;
      c.state = s.type;
      c.t = 0;
      c.frameT = 0;
      if (s.type === 'walk') c.dir = s.to < c.x ? -1 : 1;
      if (s.type === 'jump') {
        s.x0 = c.x;
        s.y0 = c.y;
        c.dir = s.x1 < c.x ? -1 : 1;
      }
    }

    planCat() {
      const { L } = this;
      const c = this.cat;
      const bedMin = L.bx0 + 6;
      const bedMax = this.blanketEnd - 18;
      const spot = Math.round(bedMin + 8 + Math.random() * (bedMax - bedMin - 8));
      const sleep = { type: 'sleep', dur: this.fast ? 8 : 35 + Math.random() * 40 };
      const wake = [{ type: 'sit', dur: 2.5 }, { type: 'lick', dur: 3 }, { type: 'stretch', dur: 1.8 }, { type: 'sit', dur: 1.2 }];
      const visit = (this.fast && !c.visited) || Math.random() < 0.5;
      if (visit) {
        c.visited = true;
        const floorX = L.bx0 - 24;
        const seat = L.pX + 22;
        c.queue = [
          ...wake,
          { type: 'walk', to: L.bx0 + 1 },
          { type: 'jump', x1: floorX, y1: L.catFloor, dur: 0.55 },
          { type: 'walk', to: seat },
          { type: 'sit', dur: 5 },
          { type: 'lick', dur: 2.5 },
          { type: 'sit', dur: 4 },
          { type: 'walk', to: floorX },
          { type: 'jump', x1: L.bx0 + 2, y1: L.bedY + 1, dur: 0.55 },
          { type: 'walk', to: spot },
          { type: 'sit', dur: 1.5 },
          sleep,
        ];
      } else {
        c.queue = [...wake, { type: 'walk', to: spot }, { type: 'sit', dur: 2 }, sleep];
      }
    }

    updateCat(dt) {
      const c = this.cat;
      c.t += dt;
      c.frameT += dt;
      const s = c.queue[0];
      if (!s) {
        this.planCat();
        this.startStep();
        return;
      }
      let done = false;
      if (s.type === 'walk') {
        c.x += c.dir * 11 * dt;
        if ((c.dir < 0 && c.x <= s.to) || (c.dir > 0 && c.x >= s.to)) {
          c.x = s.to;
          done = true;
        }
      } else if (s.type === 'jump') {
        const u = Math.min(1, c.t / s.dur);
        c.x = s.x0 + (s.x1 - s.x0) * u;
        c.y = s.y0 + (s.y1 - s.y0) * u - Math.sin(u * Math.PI) * 12;
        if (u >= 1) {
          c.y = s.y1;
          done = true;
        }
      } else if (c.t >= s.dur) done = true;
      if (done) {
        c.queue.shift();
        if (c.queue.length) this.startStep();
      }
    }

    /* ================= Dessin d'une image ================= */
    draw(g) {
      const { L, W, H } = this;
      const t = this.t;
      if (!this.eff) this.build('none');
      const m = this.mood;
      g.imageSmoothingEnabled = false;
      g.clearRect(-this.extL, 0, this.WW, H);

      // ----- Dehors (tout est découpé à la vitre) -----
      g.save();
      g.beginPath();
      g.rect(L.wx0, L.wy0, L.wx1 - L.wx0, L.wh);
      if (this.ext) for (const w of this.E.windows) g.rect(w.x0, w.y0, w.x1 - w.x0, w.y1 - w.y0);
      g.clip();
      if (this.ext) g.drawImage(this.outFarGap, 0, 0); // (monde élargi : le ciel derrière les murs)
      g.drawImage(this.outFar, -this.extL, 0);
      // Étoiles qui scintillent.
      for (const s of this.twinkles) {
        const k = Math.sin(t * 2.2 + s.p);
        if (k < 0.2) continue;
        g.fillStyle = `rgba(255,255,240,${0.4 + k * 0.5})`;
        g.fillRect(s.x, s.y, 1, 1);
        if (s.big && k > 0.7) {
          g.fillStyle = 'rgba(255,255,240,0.35)';
          g.fillRect(s.x - 1, s.y, 3, 1);
          g.fillRect(s.x, s.y - 1, 1, 3);
        }
      }
      if (this.shoot) {
        const s = this.shoot;
        const a = 1 - s.age / 0.7;
        for (let k = 0; k < 7; k++) {
          g.fillStyle = `rgba(255,250,230,${a * (1 - k / 7)})`;
          g.fillRect(Math.round(s.x + s.dir * (s.age * 60 - k)), Math.round(s.y + s.age * 30 - k * 0.5), 1, 1);
        }
      }
      if (this.flash > 0 && this.bolt) {
        const f = this.flash;
        g.fillStyle = `rgba(200,210,255,${Math.min(0.5, f * 0.6) * (Math.sin(t * 50) > -0.3 ? 1 : 0.4)})`;
        g.fillRect(L.wx0, L.wy0, L.wx1 - L.wx0, L.wh);
        if (f > 0.4) {
          g.fillStyle = '#f2f4ff';
          for (const [x, y] of this.bolt) g.fillRect(x, y, 1, 3);
        }
      }
      if (this.plane) this.drawPlane(g);
      if (this.train) this.drawTrain(g);
      if (this.ext) this.drawExtSky(g);
      g.drawImage(this.outNear, -this.extL, 0);
      if (this.ext) g.drawImage(this.outNearGap, 0, 0);
      for (const w of this.wins) {
        if (!w.lit) continue;
        g.fillStyle = w.c;
        g.fillRect(w.x, w.y, w.w, w.h);
      }
      const s = this.silhouette;
      if (s.win && s.win.lit) {
        g.fillStyle = 'rgba(30,20,30,0.85)';
        g.fillRect(Math.round(s.win.x + s.x), s.win.y + 1, 1, 2);
      }
      if (this.antenna) {
        const on = Math.sin(t * 2.5) > 0.4;
        g.fillStyle = on ? '#ff3a3a' : '#5a1a1a';
        g.fillRect(this.antenna.x, this.antenna.y, 1, 1);
        if (on) {
          g.fillStyle = 'rgba(255,60,60,0.25)';
          g.fillRect(this.antenna.x - 1, this.antenna.y - 1, 3, 3);
        }
      }
      if (this.outFront) g.drawImage(this.outFront, -this.extL, 0);
      g.drawImage(this.glass, -this.extL, 0);
      if (m.wet) {
        for (const d of this.glassDrops) {
          for (const p of d.trail) {
            g.fillStyle = `rgba(190,210,240,${0.22 * (1 - p.age / 3)})`;
            g.fillRect(p.x, p.y, 1, 1);
          }
          g.fillStyle = 'rgba(150,170,210,0.55)';
          g.fillRect(d.x - 1, Math.round(d.y), 3, 2);
          g.fillStyle = 'rgba(230,240,255,0.9)';
          g.fillRect(d.x, Math.round(d.y), 1, 1);
          g.fillStyle = 'rgba(30,40,70,0.6)';
          g.fillRect(d.x, Math.round(d.y) + 2, 1, 1);
        }
      }
      if (this.ext) this.drawExtGlass(g);
      g.restore();

      // ----- Dedans -----
      g.drawImage(this.inside, -this.extL, 0);
      this.drawScreen(g);
      this.drawLava(g);
      this.drawClock(g);
      // Disque qui tourne.
      const rc = this.record;
      const a = t * 3.5;
      g.fillStyle = '#5a5a6a';
      g.fillRect(Math.round(rc.x + Math.cos(a) * 7), Math.round(rc.y + Math.sin(a) * 2), 1, 1);
      g.fillStyle = '#3a3a48';
      g.fillRect(Math.round(rc.x + Math.cos(a + 3.1) * 5), Math.round(rc.y + Math.sin(a + 3.1) * 1.5), 1, 1);
      // Diode de l'ordinateur (dégradé arc-en-ciel qui défile).
      for (let k = 0; k < this.pc.h; k += 2) {
        const hue = (t * 40 + k * 8) % 360;
        g.fillStyle = `hsl(${hue},80%,62%)`;
        g.fillRect(this.pc.x, this.pc.y + k, 1, 2);
      }
      // Téléphone qui reçoit un message de temps en temps.
      if (this.phone && Math.sin(t * 0.35) > 0.93) {
        g.fillStyle = '#9ad0ff';
        g.fillRect(this.phone.x + 1, this.phone.y, 4, 1);
      }
      // Ampoule de la lampe.
      g.fillStyle = '#fff3cc';
      g.fillRect(this.lampBulb.x - 2, this.lampBulb.y, 4, 1);

      // La tasse, la personne, la chaise.
      const p = this.person;
      if (p.mode !== 'sip') g.drawImage(this.sprites.mug, L.mug.x, L.mug.y);
      const LP = this.litPerson;
      const P = LP.frames;
      let img = P.idle;
      if (p.mode === 'type') img = p.key % 2 ? P.typeA : P.typeB;
      else if (p.mode === 'listen') img = Math.floor(t / 0.42) % 2 ? P.bob : P.idle;
      else if (p.mode === 'stretch') img = P.stretch;
      else if (p.mode === 'sip') img = P.sip;
      g.drawImage(img, LP.x, LP.y);
      g.drawImage(this.chair, -this.extL, 0);
      this.steam.draw(g, 0.34);

      this.drawCat(g);
      this.notes.draw(g);

      // Guirlande : ampoules qui scintillent.
      for (const b of this.fairy) {
        const k = 0.55 + 0.45 * Math.sin(t * b.s + b.p);
        g.fillStyle = css(b.c.map((v) => v * k));
        g.fillRect(b.x, b.y, 1, 2);
      }

      // Bougies sur l'étagère.
      for (const f of this.candles) {
        const fl = Math.sin(t * 9 + f.p) + Math.sin(t * 13.7 + f.p * 2);
        g.fillStyle = '#ffe9a8';
        g.fillRect(f.x, f.y - 1, 1, 2);
        g.fillStyle = fl > 0.6 ? '#ffb04a' : '#ff9a3a';
        g.fillRect(f.x + (fl > 1.2 ? 1 : 0), f.y - 2, 1, 1);
      }

      if (this.ext) this.drawExtInside(g);

      // Halos des lampes, qui respirent doucement.
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.85 + 0.06 * Math.sin(t * 1.3) + 0.03 * Math.sin(t * 7.1);
      g.drawImage(this.halo, -this.extL, 0);
      g.globalAlpha = 1;
      for (const b of this.fairy) {
        const k = 0.5 + 0.5 * Math.sin(t * b.s + b.p);
        g.fillStyle = css(b.c, 0.12 * k);
        g.fillRect(b.x - 1, b.y - 1, 3, 4);
      }
      for (const f of this.candles) {
        g.fillStyle = `rgba(255,170,80,${0.1 + 0.03 * Math.sin(t * 11 + f.p)})`;
        g.fillRect(f.x - 2, f.y - 4, 5, 6);
      }
      if (this.ext) this.drawExtGlow(g);
      if (this.flash > 0) {
        g.fillStyle = `rgba(150,170,255,${0.14 * this.flash})`;
        g.fillRect(-this.extL, 0, this.WW, H);
      }
      g.globalCompositeOperation = 'source-over';
    }

    drawPlane(g) {
      const p = this.plane;
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      g.drawImage(this.sprites.plane, x, y);
      const tail = p.dir > 0 ? x : x + 8;
      const nose = p.dir > 0 ? x + 8 : x;
      g.fillStyle = Math.sin(p.t * 6) > 0.5 ? '#ff4040' : '#5a1a1a';
      g.fillRect(x + 4, y + 2, 1, 1);
      if (Math.floor(p.t * 1.5) % 2 === 0 && (p.t * 1.5) % 1 < 0.15) {
        g.fillStyle = '#ffffff';
        g.fillRect(tail, y, 1, 1);
        g.fillStyle = 'rgba(255,255,255,0.3)';
        g.fillRect(tail - 1, y - 1, 3, 3);
      }
      g.fillStyle = '#7aff9a';
      g.fillRect(nose, y + 1, 1, 1);
    }

    drawTrain(g) {
      const tr = this.train;
      const y = this.L.trackY - 5;
      const x0 = Math.round(tr.x);
      for (let c = 0; c < 3; c++) {
        const cx = x0 + c * 24;
        g.fillStyle = '#262838';
        g.fillRect(cx, y, 22, 5);
        g.fillStyle = '#3a3e56';
        g.fillRect(cx, y, 22, 1);
        g.fillStyle = '#ffe2a0';
        for (let k = 2; k < 20; k += 3) g.fillRect(cx + k, y + 2, 2, 1);
      }
      g.fillStyle = '#fff6d0';
      g.fillRect(tr.dir > 0 ? x0 + 70 : x0 - 1, y + 3, 1, 1);
    }

    drawScreen(g) {
      const S = this.L.scr;
      const t = this.t;
      g.fillStyle = '#141828';
      g.fillRect(S.x, S.y, S.w, S.h);
      g.fillStyle = '#232843';
      g.fillRect(S.x, S.y, S.w, 2);
      g.fillStyle = '#ff6a7a';
      g.fillRect(S.x + 1, S.y, 1, 1);
      g.fillStyle = '#ffd27a';
      g.fillRect(S.x + 3, S.y, 1, 1);
      g.fillStyle = '#3a4268';
      g.fillRect(S.x + 8, S.y, 10, 2);
      g.fillStyle = '#1a1f34';
      g.fillRect(S.x, S.y + 2, 4, S.h - 2);
      const n = this.code.length;
      for (let k = 0; k < n; k++) {
        const l = this.code[k];
        const ly = S.y + 4 + k * 3;
        const cur = k === n - 1;
        if (cur) {
          g.fillStyle = '#1e2440';
          g.fillRect(S.x + 4, ly - 1, S.w - 4, 3);
        }
        g.fillStyle = cur ? '#8a92c0' : '#3e4466';
        g.fillRect(S.x + 1, ly, 2, 1);
        let x = S.x + 6 + l.ind * 3;
        let left = l.typed;
        for (const sg of l.segs) {
          if (left <= 0) break;
          const w = Math.min(sg.w, left);
          g.fillStyle = sg.c;
          g.fillRect(x, ly, w, 1);
          x += sg.w + 1;
          left -= sg.w + 1;
        }
        if (cur && (this.person.mode === 'type' || Math.sin(t * 6) > 0)) {
          g.fillStyle = '#e8ecff';
          g.fillRect(S.x + 6 + l.ind * 3 + Math.min(l.typed, l.len), ly - 1, 1, 3);
        }
      }
      // Mini-carte à droite.
      g.fillStyle = 'rgba(120,140,200,0.18)';
      g.fillRect(S.x + S.w - 3, S.y + 3, 2, S.h - 4);
    }

    drawLava(g) {
      const t = this.t;
      const base = this.L.lava.base;
      const blobs = [
        { y: base - 14 + Math.sin(t * 0.35) * 6, r: 2.6 },
        { y: base - 12 + Math.sin(t * 0.27 + 2) * 5, r: 2 },
        { y: base - 9 + Math.sin(t * 0.21 + 4) * 2, r: 2.8 },
      ];
      for (const row of this.lavaGlass) {
        g.fillStyle = '#6a2a6e';
        g.fillRect(row.x0, row.y, row.x1 - row.x0 + 1, 1);
        let best = 0;
        for (const b of blobs) {
          const dy = Math.abs(row.y - b.y);
          if (dy < b.r) best = Math.max(best, Math.sqrt(b.r * b.r - dy * dy));
        }
        if (row.y > base - 8) best = Math.max(best, 3);
        if (best > 0.5) {
          const hw = Math.min(Math.round(best), Math.floor((row.x1 - row.x0) / 2));
          const cx = Math.round((row.x0 + row.x1) / 2);
          g.fillStyle = '#ff8a4a';
          g.fillRect(cx - hw, row.y, hw * 2 + 1, 1);
          g.fillStyle = '#ffc07a';
          g.fillRect(cx - hw, row.y, 1, 1);
        }
        g.fillStyle = 'rgba(255,255,255,0.25)';
        g.fillRect(row.x0, row.y, 1, 1);
      }
    }

    drawClock(g) {
      const { x, y, r } = this.L.clock;
      const now = new Date();
      const sec = now.getSeconds();
      const min = now.getMinutes() + sec / 60;
      const hr = (now.getHours() % 12) + min / 60;
      const hand = (ang, len, col) => {
        g.fillStyle = col;
        for (let k = 0; k <= len; k++) g.fillRect(Math.round(x + Math.sin(ang) * k), Math.round(y - Math.cos(ang) * k), 1, 1);
      };
      hand((hr / 12) * Math.PI * 2, r - 4, '#2a1e30');
      hand((min / 60) * Math.PI * 2, r - 2, '#2a1e30');
      hand((sec / 60) * Math.PI * 2, r - 2, '#d84a4a');
    }

    drawCat(g) {
      const c = this.cat;
      const S = this.sprites.cat;
      const right = c.dir > 0;
      let img;
      if (c.state === 'sleep') img = (right ? S.sleepR : S.sleep)[Math.floor(c.frameT / 1.4) % 2];
      else if (c.state === 'walk') img = (right ? S.walkR : S.walk)[Math.floor(c.frameT / 0.15) % 4];
      else if (c.state === 'jump') img = (right ? S.walkR : S.walk)[0];
      else if (c.state === 'lick') img = (right ? S.lickR : S.lick)[Math.floor(c.frameT / 0.3) % 2];
      else if (c.state === 'stretch') img = (right ? this.sprites.catStretchR : this.sprites.catStretch)[Math.floor(c.frameT / 0.6) % 2];
      else img = (right ? S.sitR : S.sit)[Math.floor(c.frameT / 0.7) % 2];
      g.drawImage(img, Math.round(c.x), Math.round(c.y) - img.height + 1);
    }
  }

  B.PixelScenes.chambre = Room;
})();
