// Brume — scène « Planète lointaine », en pixel art.
//
// Un plan large de cinéma, au crépuscule, sur une autre planète. Un immense ciel violet qui
// vire à l'orange autour du soleil couchant (à droite) et au turquoise de l'autre côté ;
// à gauche, une géante gazeuse annelée se lève, énorme : ses bandes glissent lentement, ses
// anneaux passent devant et derrière elle, et leur ombre la raye. Une petite lune, une
// nébuleuse discrète, les premières étoiles.
// Au loin, cinq rangées de mesas monumentales de plus en plus pâles dans la brume, une ville
// de flèches lumineuses posée sur un plateau et le faisceau de son ascenseur orbital qui
// monte droit dans le ciel ; les rayons du soleil traversent la brume entre les falaises.
// Au plan moyen, des îlots rocheux flottent, leurs cascades tombent dans le vide ; dans la
// vallée, les ruines d'une ancienne colonie (arches, pylônes brisés, panneaux qui pulsent en
// cyan) et l'épave d'un grand vaisseau à moitié enfouie dans une dune, couverte de verdure.
// Au premier plan, un promontoire sombre à contre-jour, liseré d'orange, avec de l'herbe
// bleutée et des plantes luminescentes : une exploratrice y est assise au bord, son écharpe
// flotte au vent ; à côté d'elle, son petit robot compagnon ; derrière, sa moto
// antigravité garée, qui flotte doucement.
// La vie : les bandes de la planète, les nuages fins, les créatures volantes aux longues
// ailes, les vaisseaux lointains et leurs traînées, les étoiles filantes, les cascades, la
// brume, la poussière lumineuse, les lueurs qui pulsent, le robot qui regarde autour de lui.
//
// Le décor est peint une fois par ambiance en quatre calques (ciel ; mesas ; vallée ;
// premier plan), puis chaque image ne dessine que ce qui bouge.
(function () {
  'use strict';
  const B = window.Brume;
  const { Raster, hex, mix, hash, noise, fbm, bayer } = B.PX;
  const X = B.PXC;
  const C = hex;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const pmod = (a, n) => ((a % n) + n) % n;
  // Palier tramé : v (0–1) arrondi en « steps » paliers, la trame décide entre deux.
  const quant = (v, steps, x, y) => Math.floor(clamp01(v) * steps + bayer(x, y)) / steps;
  const toHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

  /* ---------- Toile élargie (pour le travelling de l'animation d'ouverture) ----------
   * On peint toujours en coordonnées de la scène (x de −extL à W + extR) ; la partie
   * [0, W) est exactement le fond d'écran normal. Tout le décor est une fonction de la
   * position (bruit, hachage par case) : rien ne dépend de l'ordre des tirages. */
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
      x |= 0;
      y |= 0;
      if (x < this.x0 || y < 0 || x >= this.x1 || y >= this.h) return 0;
      return this.data[(y * this.sw + x + this.ox) * 4 + 3];
    }

    tint(x, y, c, t) {
      const p = this.get(x, y);
      if (!p[3]) return;
      this.set(x, y, mix(p, c, t), p[3]);
    }

    rect(x, y, w, h, c) {
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
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

  // Halos (à dessiner en mode « lighter »), sur toute la largeur du monde.
  function makeHalo(W, H, extL, extR, halos) {
    const r = new Wide(W, H, extL, extR);
    for (const h of halos) {
      const x0 = Math.max(r.x0, Math.floor(h.x - h.r));
      const x1 = Math.min(r.x1 - 1, Math.ceil(h.x + h.r));
      const y0 = Math.max(0, Math.floor(h.y - h.r));
      const y1 = Math.min(H - 1, Math.ceil(h.y + h.r));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x - h.x, (y - h.y) * 1.2);
          if (d > h.r) continue;
          const q = (Math.floor((1 - d / h.r) ** 1.6 * 5 + bayer(x, y) * 0.9) / 5) * (h.k || 0.55);
          if (q <= 0) continue;
          const i = r.i(x, y) * 4;
          r.data[i] = Math.min(255, r.data[i] + h.c[0] * q);
          r.data[i + 1] = Math.min(255, r.data[i + 1] + h.c[1] * q);
          r.data[i + 2] = Math.min(255, r.data[i + 2] + h.c[2] * q);
          r.data[i + 3] = 255;
        }
      }
    }
    for (let i = 0; i < r.data.length; i += 4) if (r.data[i] + r.data[i + 1] + r.data[i + 2] <= 2) r.data[i + 3] = 0;
    return r.toCanvas();
  }

  /* ================= Ambiances selon la météo =================
   * sky : dégradé du zénith à l'horizon (côté froid) ; glow / glow2 : halo du soleil (bord,
   * cœur) ; haze / hazeW : brume des lointains (froide, côté soleil) ; mesa : roche des
   * falaises ; rim : liseré de lumière ; sand : vallée (ombre → crête) ; rock : premier plan ;
   * grass / leaf : végétation ; bulb : lueur des plantes ; planet : éclairage de la géante
   * (jour ou nuit) ; amb / desat : étalonnage des matériaux. */
  const LOOKS = {
    none: {
      sky: ['#140b30', '#1f113f', '#2e1751', '#421f62', '#592870', '#743678', '#8f4c7e', '#a26683', '#a9828c', '#9fa19c'],
      glow: '#ff8448', glow2: '#ffe2a2', glowK: 1, glowR: 0.5, glowRy: 0.3, band: 0.6, sun: true,
      haze: '#8a7cae', hazeW: '#f0a284', mesa: '#2a1c40', rim: '#ffa464', rimK: 1,
      sand: ['#2c1e3c', '#4e3450', '#80505e', '#b87266', '#e6a07a'],
      rock: ['#0c0816', '#150e20', '#20152c', '#2e1f3a', '#412c4a'],
      grass: ['#16203e', '#22345a', '#34507c', '#5a7aa6'],
      leaf: ['#141e3a', '#1e3054', '#2e4a74', '#4a6c98', '#7aa2c4'],
      bulb: '#5ef0e0', bulbK: 0.55, panel: '#4af0ff', panelK: 0.55,
      planet: 'day', planetVis: 1, veil: 0.12, ring: '#f2d6b6',
      stars: 34, nebula: 0.28, clouds: 'wisps', cloud: ['#3c2152', '#6a3264', '#a64c6a', '#e07c6a', '#ffb88a'],
      amb: [1, 0.93, 0.92], desat: 0, rays: 0.24, beam: 0.7, ships: true, flyers: true, dust: true, falls: 'flow',
    },
    sakura: {
      sky: ['#1c1240', '#2a1850', '#3e2062', '#582a72', '#76387e', '#964a88', '#b4628e', '#c87e98', '#d49ca6', '#d6b6b4'],
      glow: '#ff9a8a', glow2: '#ffe8cc', glowK: 0.95, glowR: 0.5, glowRy: 0.3, band: 0.6, sun: true,
      haze: '#a28ab8', hazeW: '#f6b0a6', mesa: '#2e1e46', rim: '#ffb490', rimK: 1,
      sand: ['#32203e', '#583856', '#8c5a6c', '#c27e80', '#ecac9c'],
      rock: ['#0e0918', '#170f22', '#22162e', '#30203c', '#442e4e'],
      grass: ['#1a2242', '#283860', '#3a5682', '#6082ac'],
      leaf: ['#141e3a', '#1e3054', '#2e4a74', '#4a6c98', '#7aa2c4'],
      bloom: ['#5a1e4a', '#9a3a74', '#e060a6', '#ff9ccc', '#ffd8ec'],
      bulb: '#ff9ad8', bulbK: 0.6, panel: '#4af0ff', panelK: 0.5,
      planet: 'day', planetVis: 1, veil: 0.14, ring: '#f6dccc',
      stars: 24, nebula: 0.22, clouds: 'wisps', cloud: ['#422458', '#76386c', '#b85a7c', '#ee9496', '#ffcab4'],
      amb: [1.02, 0.94, 0.98], desat: 0, rays: 0.24, beam: 0.6, ships: true, flyers: true, dust: true, falls: 'flow', petals: true,
    },
    leaves: {
      sky: ['#1a0e2a', '#2a1436', '#3e1c40', '#562646', '#70324a', '#8a444c', '#a05c4e', '#ae7854', '#b0925e', '#a8a46e'],
      glow: '#ff8a2c', glow2: '#ffe08a', glowK: 1.05, glowR: 0.52, glowRy: 0.32, band: 0.7, sun: true,
      haze: '#94828e', hazeW: '#f2a86a', mesa: '#2c1c2c', rim: '#ffa04c', rimK: 1,
      sand: ['#2e1e26', '#54362e', '#885232', '#bc7a3c', '#e8aa5a'],
      rock: ['#0e0810', '#170e18', '#221620', '#30202a', '#442e34'],
      grass: ['#2a1a16', '#4a2a1a', '#784020', '#b0662a'],
      leaf: ['#2a1208', '#4e200e', '#823414', '#bc5a1e', '#ee9636'],
      bulb: '#ffc25a', bulbK: 0.5, panel: '#4af0ff', panelK: 0.5,
      planet: 'day', planetVis: 1, veil: 0.14, ring: '#f4d4a6',
      stars: 26, nebula: 0.2, clouds: 'wisps', cloud: ['#3a1a34', '#6a2c3e', '#a8483e', '#e47e44', '#ffbe6a'],
      amb: [1.04, 0.94, 0.86], desat: 0, rays: 0.3, beam: 0.6, ships: true, flyers: true, dust: true, falls: 'flow', autumn: true,
    },
    snow: {
      sky: ['#1c2244', '#262c52', '#343a62', '#464a72', '#5a5c80', '#706e8c', '#888298', '#9e96a4', '#b0aab2', '#b8bcc0'],
      glow: '#ffb0a0', glow2: '#fff0e0', glowK: 0.75, glowR: 0.45, glowRy: 0.26, band: 0.45, sun: true,
      haze: '#a4aac8', hazeW: '#f2c4c0', mesa: '#3a3a5a', rim: '#ffd0c0', rimK: 0.7,
      sand: ['#5a6084', '#7c84a6', '#a4acc8', '#cad0e2', '#eef0f8'],
      rock: ['#0e1020', '#181a2e', '#24263c', '#34364c', '#4a4c62'],
      grass: ['#3a4660', '#5a6884', '#8a98b0', '#c4ccdc'],
      leaf: ['#1e2840', '#2e3c58', '#465876', '#6a7e9a', '#a0b0c6'],
      bulb: '#9ae6ff', bulbK: 0.35, panel: '#7af0ff', panelK: 0.45,
      planet: 'day', planetVis: 0.85, veil: 0.24, ring: '#e8e6ee',
      stars: 20, nebula: 0.12, clouds: 'wisps', cloud: ['#3a3a60', '#5a5878', '#8a8498', '#c2b4bc', '#f2dcd6'],
      amb: [0.92, 0.94, 1.04], desat: 0.3, rays: 0.16, beam: 0.6, ships: true, flyers: false, dust: false, falls: 'frozen', snow: true,
    },
    rain: {
      sky: ['#1a1a2a', '#202032', '#26263a', '#2e2c42', '#36344a', '#3e3c52', '#48465a', '#525062', '#5c5a6a', '#666672'],
      glow: '#c88a7a', glow2: '#e8c4b0', glowK: 0.35, glowR: 0.45, glowRy: 0.22, band: 0.3, sun: false,
      haze: '#5e5e74', hazeW: '#8a7680', mesa: '#22202e', rim: '#c89a8a', rimK: 0.35,
      sand: ['#22202c', '#34303e', '#4a4452', '#625a66', '#7c7280'],
      rock: ['#08080e', '#101018', '#181822', '#22222e', '#30303c'],
      grass: ['#141c2e', '#1e2a44', '#2c3e5c', '#466080'],
      leaf: ['#101a30', '#182844', '#243a5c', '#365276', '#567494'],
      bulb: '#5ef0e0', bulbK: 0.6, panel: '#4af0ff', panelK: 0.65,
      planet: 'day', planetVis: 0.55, veil: 0.45, ring: '#c8c0c0',
      stars: 0, nebula: 0, clouds: 'overcast', cloud: ['#1c1c28', '#262634', '#323242', '#40404e', '#52525e'],
      amb: [0.7, 0.72, 0.82], desat: 0.35, rays: 0, beam: 0.85, ships: true, flyers: false, dust: false, falls: 'flow', wet: true, mist: true,
    },
    storm: {
      sky: ['#0c0a16', '#110e1c', '#161222', '#1c1628', '#221a2e', '#281e34', '#2e233a', '#352840', '#3c2e46', '#44344c'],
      glow: '#9a6a8a', glow2: '#c8a0b0', glowK: 0.32, glowR: 0.4, glowRy: 0.2, band: 0.2, sun: false,
      haze: '#3e3450', hazeW: '#5a4458', mesa: '#16121e', rim: '#a088c8', rimK: 0.25,
      sand: ['#16121c', '#221c2a', '#302838', '#403648', '#524658'],
      rock: ['#06050a', '#0c0a12', '#12101a', '#1a1624', '#24202e'],
      grass: ['#10162a', '#18223c', '#243452', '#384e6e'],
      leaf: ['#0c1428', '#14203a', '#1e3050', '#2e466a', '#4a6488'],
      bulb: '#5ef0e0', bulbK: 0.65, panel: '#4af0ff', panelK: 0.75,
      planet: 'day', planetVis: 0.3, veil: 0.6, ring: '#a8a0b0',
      stars: 0, nebula: 0, clouds: 'storm', cloud: ['#0a0812', '#120e1a', '#1a1524', '#241e30', '#30283c'],
      amb: [0.55, 0.54, 0.66], desat: 0.4, rays: 0, beam: 0.9, ships: false, flyers: false, dust: false, falls: 'flow', wet: true, storm: true, mist: true,
    },
    fireflies: {
      sky: ['#04061a', '#060920', '#080c26', '#0b102c', '#0e1432', '#121a3a', '#162040', '#1a2846', '#1e3048', '#22384a'],
      glow: '#2a4a6a', glow2: '#4a7a8a', glowK: 0.4, glowR: 0.6, glowRy: 0.18, band: 0.5, sun: false,
      haze: '#1e2a4a', hazeW: '#24385a', mesa: '#0a0c1c', rim: '#4ab8d0', rimK: 0.35,
      sand: ['#0a0c1a', '#121628', '#1a2034', '#242c42', '#323c54'],
      rock: ['#030409', '#06070f', '#0a0c16', '#10121e', '#181a28'],
      grass: ['#0a1228', '#10203e', '#1a3458', '#2c5078'],
      leaf: ['#08122a', '#0e1e40', '#163058', '#224672', '#3a6490'],
      bulb: '#62ffd8', bulbK: 1, panel: '#4af0ff', panelK: 1,
      planet: 'night', planetVis: 1, veil: 0.06, ring: '#b8c4e8',
      stars: 120, nebula: 0.7, clouds: 'none', cloud: ['#06081a', '#0a0e24', '#10162e', '#182038', '#222c46'],
      amb: [0.3, 0.36, 0.56], desat: 0.2, rays: 0, beam: 1, ships: true, flyers: false, dust: false, falls: 'flow', night: true, spores: true,
    },
    starfall: {
      sky: ['#020310', '#030514', '#050718', '#070a1e', '#090d24', '#0c112a', '#101630', '#141b36', '#18213c', '#1c2840'],
      glow: '#203454', glow2: '#3a5a7a', glowK: 0.35, glowR: 0.6, glowRy: 0.16, band: 0.4, sun: false,
      haze: '#182240', hazeW: '#1e2c4c', mesa: '#080a18', rim: '#6a8ad0', rimK: 0.3,
      sand: ['#080a16', '#0e1222', '#161a2e', '#20263a', '#2c344a'],
      rock: ['#020308', '#05060c', '#080a14', '#0e101c', '#161826'],
      grass: ['#0a1026', '#101c38', '#182c50', '#28446c'],
      leaf: ['#081028', '#0e1a3a', '#162a52', '#223e6a', '#385a86'],
      bulb: '#62e8ff', bulbK: 0.75, panel: '#4af0ff', panelK: 0.85,
      planet: 'night', planetVis: 1, veil: 0.05, ring: '#c4ccf0',
      stars: 280, nebula: 0.55, milky: true, clouds: 'none', cloud: ['#04061a', '#080c22', '#0e142c', '#161e36', '#202a44'],
      amb: [0.26, 0.3, 0.5], desat: 0.25, rays: 0, beam: 0.9, ships: true, flyers: false, dust: false, falls: 'flow', night: true, meteors: true,
    },
  };

  /* ================= Les mesas, par rangée (loin → près) =================
   * c : centre (fraction de W), w : demi-largeur du sommet (fraction de W), h : hauteur
   * (fraction de H, depuis la base de la rangée). kind : 'spire' (aiguille coiffée),
   * step : un gradin plus bas autour du sommet. */
  const PLANES = [
    { base: 0.586, fog: 0.8, mesas: [
      { c: -0.04, w: 0.07, h: 0.08 }, { c: 0.19, w: 0.05, h: 0.062 }, { c: 0.44, w: 0.06, h: 0.105, step: true },
      { c: 0.585, w: 0.025, h: 0.07 }, { c: 0.99, w: 0.085, h: 0.095 },
    ] },
    { base: 0.602, fog: 0.66, mesas: [
      { c: 0.075, w: 0.03, h: 0.125 }, { c: 0.31, w: 0.065, h: 0.088 }, { c: 0.645, w: 0.05, h: 0.066 }, { c: 0.905, w: 0.035, h: 0.112 },
    ] },
    { base: 0.622, fog: 0.52, mesas: [
      { c: 0.17, w: 0.085, h: 0.1, step: true }, { c: 0.375, w: 0.006, h: 0.11, kind: 'spire' }, { c: 0.5, w: 0.055, h: 0.128 },
      { c: 0.745, w: 0.018, h: 0.05 }, { c: 1.01, w: 0.07, h: 0.14 },
    ] },
    { base: 0.646, fog: 0.38, mesas: [
      { c: -0.01, w: 0.065, h: 0.2, step: true }, { c: 0.268, w: 0.011, h: 0.13, kind: 'spire' }, { c: 0.565, w: 0.035, h: 0.075 },
      { c: 0.865, w: 0.055, h: 0.118, step: true },
    ] },
    { base: 0.672, fog: 0.25, mesas: [
      { c: 0.115, w: 0.055, h: 0.09 }, { c: 0.435, w: 0.075, h: 0.05 }, { c: 0.79, w: 0.045, h: 0.068 },
    ] },
  ];

  // Îlots flottants de l'écran : u, y (fractions), largeur et hauteur (en pixels pour H = 240).
  const ISLES = [
    { u: 0.555, y: 0.245, w: 54, h: 34, fall: true, tree: true, depth: 0.25, seed: 11 },
    { u: 0.385, y: 0.455, w: 28, h: 18, fall: true, depth: 0.35, seed: 12 },
    { u: 0.905, y: 0.335, w: 17, h: 11, fall: false, depth: 0.55, seed: 13 },
  ];

  /* ================= La scène ================= */
  class Planete {
    constructor(W, H, opts = {}) {
      this.W = W;
      this.H = H;
      // Monde élargi (animation d'ouverture) : les mesas, les îlots, les ruines et le
      // promontoire continuent des deux côtés.
      const ext = opts.ext || {};
      this.extL = Math.max(0, Math.round(ext.left || 0));
      this.extR = Math.max(0, Math.round(ext.right || 0));
      this.wide = this.extL + this.extR > 0;
      this.X0 = -this.extL;
      this.X1 = W + this.extR;
      this.S = H / 240; // échelle des objets peints en pixels
      const L = (this.L = {});
      L.hz = Math.round(H * 0.58);
      L.sun = { x: Math.round(W * 0.79), y: Math.round(H * 0.535), r: Math.max(5, Math.round(H * 0.028)) };
      L.planet = { x: Math.round(W * 0.225), y: Math.round(H * 0.425), R: Math.round(H * 0.285) };
      L.moon = { x: Math.round(W * 0.7), y: Math.round(H * 0.11), r: Math.max(5, Math.round(H * 0.024)) };
      L.edgeX = Math.round(W * 0.598); // bord du promontoire
      L.topY = Math.round(H * 0.728); // dessus du promontoire
      L.beamX = Math.round(W * 0.648);
      this.fast = X.fastTest();
      this.t = 0;
      this.effect = null;
      this.build('none');
    }

    /* ---------- Couleurs ---------- */
    grade(h) {
      const c = typeof h === 'string' ? C(h) : h;
      const { amb, desat: d } = this.look;
      const l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
      return [Math.min(255, (c[0] + (l - c[0]) * d) * amb[0]), Math.min(255, (c[1] + (l - c[1]) * d) * amb[1]), Math.min(255, (c[2] + (l - c[2]) * d) * amb[2])];
    }

    // Proximité du soleil (0–1) : réchauffe la brume, les liserés.
    sunNear(x, y) {
      const s = this.L.sun;
      const dx = (x - s.x) / (this.W * 0.42);
      const dy = (y - s.y) / (this.H * 0.4);
      return Math.exp(-(dx * dx + dy * dy));
    }

    hazeAt(x, y) {
      return mix(this.hazeC, this.hazeW, clamp01(this.sunNear(x, y) * (this.look.sun ? 0.9 : 0.6)));
    }

    // Couleur du ciel en (x, y), sans les étoiles (sert aussi à fondre la planète).
    skyAt(x, y) {
      const { L, look } = this;
      const st = this.skyStops;
      const t = clamp01(y / L.hz) * (st.length - 1);
      const k = Math.min(st.length - 2, Math.floor(t));
      let c = mix(st[k], st[k + 1], quant(t - k, 5, x, y));
      const s = L.sun;
      const gx = (x - s.x) / (this.W * look.glowR);
      const gy = (y - s.y) / (this.H * look.glowRy);
      const gd = gx * gx + gy * gy;
      const hz = (L.hz - y) / (this.H * 0.075);
      const band = look.band * Math.exp(-hz * hz) * (0.35 + 0.65 * Math.exp(-(((x - s.x) / (this.W * 0.75)) ** 2)));
      const g = look.glowK * Math.exp(-gd) + band;
      if (g > 0.02) c = mix(c, this.glowC, quant(Math.min(0.92, g), 7, x, y));
      const g2 = look.glowK * Math.exp(-gd * 7);
      if (g2 > 0.03) c = mix(c, this.glow2C, quant(Math.min(1, g2 * 1.1), 6, x, y));
      return c;
    }

    /* ---------- Construction des calques ---------- */
    build(effect) {
      this.effect = effect;
      const look = (this.look = LOOKS[effect] || LOOKS.none);
      this.skyStops = look.sky.map(C);
      this.glowC = C(look.glow);
      this.glow2C = C(look.glow2);
      this.hazeC = C(look.haze);
      this.hazeW = C(look.hazeW);
      this.rimC = C(look.rim);
      this.twinkles = [];
      this.cityLights = [];
      this.panels = [];
      this.glows = [];
      this.puddles = [];
      this.sandC = null;
      this.sky = this.paintSky().toCanvas();
      this.makePlanet();
      this.cover = this.paintCover();
      this.back = this.paintBack().toCanvas();
      this.rays = look.rays ? this.paintRays() : null;
      this.mid = this.paintMid().toCanvas();
      this.makeIslands();
      this.mist = this.makeMist();
      this.fore = this.paintFore().toCanvas();
      this.halo = makeHalo(this.W, this.H, this.extL, this.extR, this.glows);
      this.makeSprites();
      this.resetLife();
    }

    /* ================= Le ciel ================= */
    paintSky() {
      const { W, H, L, look } = this;
      const r = new Wide(W, H, this.extL, this.extR);
      const lim = Math.min(H, L.hz + Math.round(H * 0.16));
      for (let y = 0; y < lim; y++) for (let x = r.x0; x < r.x1; x++) r.set(x, y, this.skyAt(x, y));
      const bot = this.skyAt(0, L.hz);
      for (let y = lim; y < H; y++) for (let x = r.x0; x < r.x1; x++) r.set(x, y, bot);
      if (look.nebula) this.paintNebula(r);
      if (look.milky) this.paintMilky(r);
      this.paintStars(r);
      if (look.sun) this.paintSun(r);
      if (look.clouds === 'wisps') this.paintWisps(r);
      this.paintMoon(r);
      return r;
    }

    // Une nébuleuse discrète, en haut à droite : voiles magenta et turquoise.
    paintNebula(r) {
      const { W, H, look } = this;
      const cx = W * 0.8;
      const cy = H * 0.16;
      const a = C(look.night ? '#7a3a9a' : '#a24a8a');
      const b = C(look.night ? '#2a8a9a' : '#4a8a9a');
      for (let y = 0; y < H * 0.42; y++) {
        for (let x = r.x0; x < r.x1; x++) {
          const dx = (x - cx) / (W * 0.32);
          const dy = (y - cy) / (H * 0.2);
          const env = Math.exp(-(dx * dx + dy * dy)) + (this.wide ? 0.6 * Math.exp(-(((x + W * 0.9) / (W * 0.3)) ** 2 + ((y - H * 0.12) / (H * 0.16)) ** 2)) : 0);
          if (env < 0.05) continue;
          const n = fbm(x * 0.03 + fbm(x * 0.02, y * 0.03, 81, 2) * 2, y * 0.05, 82, 4);
          const v = (n - 0.42) * 2.4 * env * look.nebula;
          if (v <= 0.04) continue;
          const c = fbm(x * 0.015, y * 0.03, 83, 2) > 0.5 ? a : b;
          r.tint(x, y, c, quant(Math.min(0.5, v), 5, x, y));
        }
      }
    }

    paintMilky(r) {
      const { W, L } = this;
      for (let y = 0; y < L.hz; y++) {
        for (let x = r.x0; x < r.x1; x++) {
          const dd = Math.abs(y - 6 - (W * 0.95 - x) * 0.42);
          const band = 1 - dd / 46;
          if (band <= 0) continue;
          const v = band * fbm(x * 0.05, y * 0.07, 3);
          if (bayer(x, y) < (v - 0.12) * 1.8) r.tint(x, y, [130, 130, 210], 0.3);
          if (band > 0.55 && bayer(x, y) < (v - 0.3) * 2) r.tint(x, y, [210, 190, 230], 0.25);
          if (fbm(x * 0.09, y * 0.12, 5, 2) > 0.62 && band > 0.5) r.tint(x, y, [10, 10, 30], 0.4); // poussières sombres
          if (hash(x, y, 4) < v * 0.06) r.set(x, y, [214, 216, 250]);
        }
      }
    }

    paintStars(r) {
      const { W, L, look } = this;
      if (!look.stars) return;
      const STAR = [[240, 236, 255], [255, 228, 214], [206, 220, 255]];
      const cell = 12;
      const per = (look.stars * cell * cell) / (W * L.hz);
      for (let cx = Math.floor(r.x0 / cell); cx * cell < r.x1; cx++) {
        for (let cy = 0; cy * cell < L.hz; cy++) {
          for (let k = 0; k < 3; k++) {
            if (hash(cx, cy * 3 + k, 5) > per) continue;
            const x = cx * cell + Math.floor(hash(cx, cy * 3 + k, 6) * cell);
            const y = cy * cell + Math.floor(hash(cx, cy * 3 + k, 7) * cell);
            if (y >= L.hz - 4) continue;
            const fade = look.night ? 1 - (y / L.hz) * 0.55 : clamp01(1 - (y / L.hz) * 1.7);
            const b = (0.3 + hash(x, y, 9) * 0.65) * fade * (1 - this.sunNear(x, y));
            if (b < 0.08) continue;
            const c = STAR[Math.floor(hash(cx, cy, 8 + k) * 3)];
            r.tint(x, y, c, b);
            if (b > 0.5 && hash(x, y, 13) < 0.12) {
              // Une étoile plus vive, en petite croix.
              for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) r.tint(x + dx, y + dy, c, b * 0.35);
            }
            if (hash(x, y, 10) < 0.25) this.twinkles.push({ x, y, c, p: hash(x, y, 11) * 6, s: 1 + hash(x, y, 12) * 2.5, b });
          }
        }
      }
    }

    paintSun(r) {
      const s = this.L.sun;
      const core = C('#fff8e4');
      const edge = C('#ffd890');
      for (let y = -s.r; y <= s.r; y++) {
        for (let x = -s.r; x <= s.r; x++) {
          const d = Math.hypot(x, y * 1.08);
          if (d > s.r + 0.3) continue;
          r.set(s.x + x, s.y + y, d > s.r - 1.2 ? edge : core);
        }
      }
    }

    // Une petite lune en croissant (éclairée du côté du soleil).
    paintMoon(r) {
      const { look } = this;
      const m = this.L.moon;
      const lit = C(look.night ? '#e8ecf6' : '#f6e6dc');

      const k = look.planet === 'night' ? 0.42 : 0.38;
      for (let y = -m.r; y <= m.r; y++) {
        for (let x = -m.r; x <= m.r; x++) {
          const d = Math.hypot(x, y);
          if (d > m.r + 0.3) continue;
          // Croissant : partie éclairée = hors d'un disque décalé vers la gauche.
          const sh = Math.hypot(x + m.r * k, y + m.r * 0.1);
          const dark = mix(this.skyAt(m.x + x, m.y + y), C('#2a2040'), 0.22);
          let c = sh > m.r * 0.92 ? lit : dark;
          if (c === lit && d > m.r - 0.7) c = mix(lit, dark, 0.3);
          if (c === lit && noise((x + 9) * 0.6, (y + 9) * 0.6, 14) > 0.68) c = mix(lit, dark, 0.2);
          r.set(m.x + x, m.y + y, c);
        }
      }
      this.glowList = [{ x: m.x, y: m.y, r: m.r * 4, c: look.night ? [150, 170, 230] : [200, 160, 170], k: 0.14 }];
    }

    // Longs nuages fins (stratus) éclairés par en dessous.
    paintWisps(r) {
      const { W, H, L, look } = this;
      const tones = look.cloud.map(C);
      for (let y = Math.round(H * 0.05); y < L.hz - 6; y++) {
        const yn = y / L.hz;
        for (let x = r.x0; x < r.x1; x++) {
          const env = Math.exp(-(((yn - 0.42) / 0.16) ** 2)) * 0.9 + Math.exp(-(((yn - 0.2) / 0.05) ** 2)) * 0.3;
          if (env < 0.05) continue;
          const n = fbm(x * 0.006 + fbm(x * 0.01, y * 0.08, 61, 2) * 0.6, y * 0.17, 62, 4);
          const v = (n - 0.56) * 4 * env;
          if (v <= 0) continue;
          // Dessous éclairé (près du soleil) ; dessus dans l'ombre.
          const under = fbm(x * 0.006, (y + 2) * 0.17, 62, 4) < n ? 1 : 0;
          const warm = this.sunNear(x, y);
          let i = Math.min(4, Math.floor(v * 3 + warm * 2.2 + under * 0.8 + bayer(x, y) * 0.45));
          if (i < 0) i = 0;
          const c = mix(tones[i], this.skyAt(x, y), clamp01(0.55 - v));
          r.set(x, y, c);
        }
      }
    }

    /* ---------- Plafond nuageux (pluie, orage) : dessiné devant la planète ---------- */
    paintCover() {
      const { W, H, L, look } = this;
      if (look.clouds !== 'overcast' && look.clouds !== 'storm') return null;
      const r = new Wide(W, H, this.extL, this.extR);
      const tones = look.cloud.map(C);
      const storm = look.clouds === 'storm';
      for (let y = 0; y < L.hz + 4; y++) {
        for (let x = r.x0; x < r.x1; x++) {
          const yn = y / L.hz;
          const n = fbm(x * 0.012 + fbm(x * 0.02, y * 0.05, 71, 2) * 0.8, y * 0.045, 72, 4);
          // Une trouée au-dessus de la planète (on la devine) et le long de l'horizon.
          const P = L.planet;
          const hole = Math.exp(-(((x - P.x) / (W * 0.2)) ** 2 + ((y - P.y + H * 0.04) / (H * 0.16)) ** 2)) * (storm ? 0.16 : 0.42);
          const v = n + (storm ? 0.1 : 0.02) - hole - Math.max(0, yn - 0.72) * 0.9;
          if (v < 0.42) continue;
          const lightUnder = clamp01((fbm(x * 0.012, (y + 3) * 0.045, 72, 4) - n) * 8 + 0.5);
          let i = Math.floor((v - 0.42) * 7 + (1 - lightUnder) * 1.4 + bayer(x, y) * 0.9);
          i = Math.max(0, Math.min(4, 4 - i));
          if (v < 0.47 && bayer(x, y) > (v - 0.42) * 20) continue;
          r.set(x, y, tones[i]);
        }
      }
      return r.toCanvas();
    }

    /* ================= La géante gazeuse ================= */
    // Densité des anneaux selon la distance au centre (en rayons de la planète).
    ringDen(q) {
      if (q < 1.3 || q > 2.32) return 0;
      if (q < 1.47) return 0.22 + 0.08 * Math.sin(q * 80);
      if (q < 1.87) return clamp01(0.72 + 0.16 * Math.sin(q * 130) + (noise(q * 45, 1.5, 91) - 0.5) * 0.35);
      if (q < 1.94) return 0.04;
      if (q < 2.17) return q > 2.08 && q < 2.1 ? 0.08 : clamp01(0.55 + (noise(q * 50, 2.5, 92) - 0.5) * 0.3);
      if (q > 2.24 && q < 2.28) return 0.42;
      return 0;
    }

    makePlanet() {
      const { look } = this;
      const P = this.L.planet;
      const R = P.R;
      const night = look.planet === 'night';
      const si = 0.24;
      const ci = Math.sqrt(1 - si * si);
      const th = -0.21; // inclinaison des anneaux (le côté droit monte)
      const cth = Math.cos(th);
      const sth = Math.sin(th);
      const nrm = [0, -ci, si];
      const u2 = [0, si, ci];
      let Ls = night ? [0.82, 0.42, -0.2] : [0.94, 0.14, 0.22];
      const ll = Math.hypot(...Ls);
      Ls = Ls.map((v) => v / ll);
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const Ln = dot(Ls, nrm);
      const ext = Math.ceil(R * 2.34) + 2;
      const bw = ext * 2 + 1;
      const bh = Math.ceil(R * 1.3) * 2 + 1;
      const by = Math.floor(bh / 2);
      this.pl = { x0: P.x - ext, y0: P.y - by, bw, bh };
      const ringBack = new Raster(bw, bh);
      const ringFront = new Raster(bw, bh);
      const ringC = this.grade(look.ring);
      const ringC2 = mix(ringC, C('#b07a62'), 0.5);
      const vis = look.planetVis;
      const pix = [];
      for (let j = 0; j < bh; j++) {
        for (let i = 0; i < bw; i++) {
          const sx = i - ext;
          const sy = j - by;
          const x = P.x + sx;
          const y = P.y + sy;
          if (y >= this.L.hz + 4) continue;
          const Xp = sx * cth + sy * sth;
          const Yp = -sx * sth + sy * cth;
          const d2 = sx * sx + sy * sy;
          const inDisc = d2 < R * R;
          const Z = inDisc ? Math.sqrt(R * R - d2) : -1;
          // Fondu dans la brume de l'horizon.
          const fade = clamp01((y - (this.L.hz - this.H * 0.16)) / (this.H * 0.16));
          const veil = clamp01(look.veil + fade * fade * 0.85 + (1 - vis));
          const sky = this.skyAt(x, y);
          // Anneaux.
          const Yr = Yp / si;
          const rho = Math.hypot(Xp, Yr);
          const den = this.ringDen(rho / R);
          let ringPix = null;
          if (den > 0) {
            const Zr = Yr * ci;
            const Pr = [Xp, Yp, Zr];
            const pd = dot(Pr, Ls);
            const shadow = pd < 0 && dot(Pr, Pr) - pd * pd < R * R;
            let c = mix(ringC2, ringC, clamp01((rho / R - 1.3) / 0.8));
            const lit = night ? 0.55 + 0.25 * (Xp / (R * 2.3)) : 0.85 + 0.2 * (Xp / (R * 2.3));
            c = c.map((v) => v * lit);
            if (shadow) c = mix(c, C('#140c22'), night ? 0.8 : 0.55);
            const front = Zr > 0;
            if (inDisc && Zr < Z) {
              // Derrière la planète : caché.
            } else ringPix = { c, a: den, front: front && inDisc };
          }
          if (ringPix && !ringPix.front) {
            // Opaque, fondu dans le ciel.
            const a = quant(ringPix.a * 0.95, 5, x, y);
            const target = inDisc ? ringFront : ringBack;
            if (a > 0) target.set(i, j, mix(sky, mix(ringPix.c, sky, veil), a));
          }
          if (inDisc) {
            const N = [Xp / R, Yp / R, Z / R];
            const I = dot(N, Ls);
            // Ombre des anneaux sur la planète.
            let rs = 0;
            if (Ln !== 0) {
              const t = -dot([Xp, Yp, Z], nrm) / Ln;
              if (t > 0) {
                const Q = [Xp + t * Ls[0], Yp + t * Ls[1], Z + t * Ls[2]];
                rs = this.ringDen(Math.hypot(...Q) / R);
              }
            }
            const lat = dot(N, nrm);
            const lon = Math.atan2(dot(N, u2), N[0]);
            // Éclairage : jour lambertien adouci, nuit en mince croissant.
            const litv = smooth((I + 0.06) / 0.5);
            let m = night ? 0.07 + 1.05 * litv : 0.1 + 1.0 * litv;
            m *= 1 - rs * (night ? 0.6 : 0.55);
            m = Math.floor(m * 7 + bayer(x, y)) / 7;
            const limb = 1 - N[2];
            const rim = limb > 0.82 ? clamp01(I + 0.25) * (night ? 0.9 : 0.6) : 0;
            pix.push({ i, j, lat, lon, m, rim, veil, sky, lightK: litv });
          }
          if (ringPix && ringPix.front) {
            const a = Math.floor(ringPix.a * 0.9 * 4 + bayer(x, y) * 0.8) / 4;
            if (a > 0) ringFront.set(i, j, mix(ringPix.c, sky, veil), Math.round(a * 255));
          }
        }
      }
      this.ringBack = ringBack.toCanvas();
      this.ringFront = ringFront.toCanvas();
      this.planetPix = pix;
      this.planetImg = new ImageData(bw, bh);
      this.planetCv = document.createElement('canvas');
      this.planetCv.width = bw;
      this.planetCv.height = bh;
      this.makePlanetTexture();
      this.planetOff = -1;
      this.renderPlanet(0);
    }

    // Texture des bandes (longitude × latitude), périodique en longitude.
    makePlanetTexture() {
      const { look } = this;
      const TW = 400;
      const TH = 96;
      const pal = (look.planet === 'night'
        ? ['#3a2e4a', '#6a5470', '#a08a8a', '#c4ae9a', '#7a8a9a', '#4a5a74', '#d8c4a8']
        : ['#33224a', '#74405a', '#b4685a', '#e0a272', '#f6dcb2', '#7aaaa6', '#467484']).map((h) => this.grade(h));
      const light = this.glow2C;
      const tex = new Uint8ClampedArray(TW * TH * 3);
      for (let ty = 0; ty < TH; ty++) {
        const lat = (ty / (TH - 1)) * 2 - 1;
        for (let tx = 0; tx < TW; tx++) {
          const lon = (tx / TW) * Math.PI * 2;
          const cx = Math.cos(lon);
          const sx = Math.sin(lon);
          const turb = (noise(cx * 2.2 + 7, sx * 2.2 + lat * 9, 101) - 0.5) * 0.09 + Math.sin(lon * 3 + lat * 14) * 0.012;
          const l2 = lat + turb;
          const bv = fbm(l2 * 4.2 + 20, 0.5, 102, 3) + (noise(cx * 4 + 3, sx * 4 + l2 * 40, 103) - 0.5) * 0.12;
          let p = clamp01((bv - 0.3) * 2.7) * 4.6;
          // Bandes plus nettes à l'équateur, une ceinture turquoise au sud.
          if (Math.abs(l2 + 0.36) < 0.07) p = 5 + (noise(cx * 3, sx * 3 + 50, 104) - 0.5) * 1.2;
          if (Math.abs(l2 - 0.05) < 0.035) p = 4;
          const k = Math.max(0, Math.min(pal.length - 2, Math.floor(p)));
          let c = mix(pal[k], pal[k + 1], clamp01(p - k));
          // Une grande tempête ovale, turquoise pâle cerclée de sombre.
          let dl = lon - 2.1;
          dl = Math.atan2(Math.sin(dl), Math.cos(dl));
          const e = (dl / 0.28) ** 2 + ((l2 + 0.2) / 0.075) ** 2;
          if (e < 1) c = e < 0.55 ? mix(C('#bfe0d6'), C('#e8f2e6'), 1 - e) : mix(pal[0], pal[5], 0.4);
          c = mix(c, light, 0.05);
          const o = (ty * TW + tx) * 3;
          tex[o] = c[0];
          tex[o + 1] = c[1];
          tex[o + 2] = c[2];
        }
      }
      this.tex = { TW, TH, data: tex };
    }

    // Repeint la planète quand ses bandes ont glissé d'un cran.
    renderPlanet(off) {
      if (off === this.planetOff) return;
      this.planetOff = off;
      const { TW, TH, data } = this.tex;
      const out = this.planetImg.data;
      const bw = this.pl.bw;
      const night = this.look.planet === 'night';
      const lc = night ? [0.9, 0.95, 1.1] : [1.08, 0.98, 0.9];
      const dark = night ? [8, 8, 22] : [26, 16, 44];
      const rimC = night ? [170, 190, 255] : [255, 200, 160];
      for (const p of this.planetPix) {
        const tx = pmod(Math.floor(((p.lon / (Math.PI * 2)) * TW) + off), TW);
        const ty = Math.max(0, Math.min(TH - 1, Math.round(((p.lat + 1) / 2) * (TH - 1))));
        const o = (ty * TW + tx) * 3;
        const o2 = (p.j * bw + p.i) * 4;
        for (let c = 0; c < 3; c++) {
          let v = dark[c] * (1 - p.lightK) + data[o + c] * p.m * lc[c];
          v += rimC[c] * p.rim * 0.5;
          v = v * (1 - p.veil) + p.sky[c] * p.veil;
          out[o2 + c] = Math.min(255, v);
        }
        out[o2 + 3] = 255;
      }
      this.planetCv.getContext('2d').putImageData(this.planetImg, 0, 0);
    }

    /* ================= Les lointains : rangées de mesas ================= */
    // Hauteur (px) d'une mesa en x.
    mesaH(m, x, k) {
      const { W, H } = this;
      const d = Math.abs(x - m.c * W);
      const h = m.h * H;
      const w = m.w * W;
      let v;
      if (m.kind === 'spire') {
        // Aiguille : une colonne fine, un chapeau un peu plus large, un pied évasé.
        const cap = d <= w + 1.5 ? h : 0;
        const col = d <= w ? h - 1 : 0;
        const foot = d < w + h * 0.35 ? h * 0.32 * (1 - (d - w) / (h * 0.35)) ** 1.5 : 0;
        v = Math.max(cap && d > w ? h - 2 : col || cap, foot);
        if (d > w && d <= w + 1.5 && hash(Math.round(x), 3, k) < 0.5) v = Math.max(foot, h - 1);
        return v;
      }
      const cs = Math.max(1.5, h * 0.1);
      const ts = h * 0.85;
      if (d <= w) v = h;
      else if (d <= w + cs) v = h - h * 0.4 * ((d - w) / cs);
      else if (d <= w + cs + ts) v = h * 0.6 * (1 - (d - w - cs) / ts) ** 1.7;
      else v = 0;
      if (m.step) v = Math.max(v, this.mesaH({ c: m.c, w: m.w * 1.9, h: m.h * 0.62 }, x, k));
      return v;
    }

    // Les mesas d'une rangée, au voisinage de x : celles de l'écran, puis, au-delà, des
    // mesas tirées par case (prolongement).
    planeMesas(k, x) {
      const { W } = this;
      const out = PLANES[k].mesas.filter((m) => Math.abs(x - m.c * W) < W * 0.4);
      const cw = W * (0.17 + k * 0.035);
      const j0 = Math.floor(x / cw);
      for (let j = j0 - 3; j <= j0 + 3; j++) {
        const u = ((j + 0.2 + hash(j, k, 201) * 0.6) * cw) / W;
        if (u > -0.2 && u < 1.2) continue;
        if (hash(j, k, 202) < 0.25) continue;
        const r = hash(j, k, 203);
        const m = { c: u, w: 0.02 + hash(j, k, 204) * 0.07, h: 0.05 + hash(j, k, 205) * (0.08 + k * 0.015), step: hash(j, k, 206) < 0.3 };
        if (r < 0.15) Object.assign(m, { kind: 'spire', w: 0.005 + hash(j, k, 207) * 0.007, h: 0.08 + hash(j, k, 208) * 0.06 });
        out.push(m);
      }
      return out;
    }

    mesaTop(k, x) {
      const { H } = this;
      const pl = PLANES[k];
      let h = 0;
      for (const m of this.planeMesas(k, x)) h = Math.max(h, this.mesaH(m, x, k));
      // Ondulations basses entre les mesas, et petites échancrures des sommets.
      h += (fbm(x * 0.05, k * 3.1, 210 + k, 3) - 0.35) * H * 0.012;
      if (h > H * 0.03 && hash(Math.floor(x / 3), k, 211) > 0.9) h -= 1;
      return pl.base * H - h;
    }

    paintBack() {
      const { W, H, look } = this;
      const r = new Wide(W, H, this.extL, this.extR);
      const snowC = this.grade('#eef2fa');
      const mesaC = C(look.mesa);
      for (let k = 0; k < PLANES.length; k++) {
        const pl = PLANES[k];
        const base = pl.base * H;
        const tops = new Float32Array(r.sw + 8);
        for (let x = r.x0 - 4; x < r.x1 + 4; x++) tops[x - r.x0 + 4] = this.mesaTop(k, x);
        const top = (x) => tops[x - r.x0 + 4];
        const fogH = H * 0.03;
        for (let x = r.x0; x < r.x1; x++) {
          const ty = top(x);
          const y0 = Math.max(0, Math.ceil(ty));
          for (let y = y0; y < H; y++) {
            const d = y - ty;
            const hz = this.hazeAt(x, y);
            let c = mesaC;
            // Strates horizontales et ravines verticales.
            const s = noise(x * 0.015, y * 0.42 + noise(x * 0.04, y * 0.06, 220 + k) * 1.6, 221 + k);
            if (s > 0.62) c = mix(c, hz, 0.12);
            else if (s < 0.3) c = mix(c, [0, 0, 0], 0.18);
            if (noise(x * 0.7, y * 0.05, 222 + k) > 0.7 && d > 2) c = mix(c, [0, 0, 0], 0.2);
            // Lumière : faces tournées vers le soleil (à droite), liseré du sommet.
            let rd = 0;
            for (let j = 1; j <= 3; j++) if (top(x + j) > y + 0.5) {
              rd = j;
              break;
            }
            let ld = 0;
            for (let j = 1; j <= 2; j++) if (top(x - j) > y + 0.5) {
              ld = j;
              break;
            }
            const rk = look.rimK * (1 - pl.fog * 0.55) * (0.45 + 0.55 * this.sunNear(x, y) + 0.2);
            if (rd === 1) c = mix(c, this.rimC, 0.75 * rk);
            else if (rd === 2) c = mix(c, this.rimC, 0.38 * rk);
            else if (rd === 3) c = mix(c, this.rimC, 0.16 * rk);
            if (d < 1) c = mix(c, this.rimC, 0.5 * rk);
            else if (d < 2) c = mix(c, this.rimC, 0.18 * rk);
            if (ld && !rd) c = mix(c, [0, 0, 0], 0.22);
            if (look.snow && (d < 2.2 + noise(x * 0.2, k, 223) * 2 || (s > 0.68 && noise(x * 0.3, y * 0.5, 224 + k) > 0.45))) c = mix(snowC, c, 0.15);
            // Brume : la rangée entière, et plus épaisse à sa base.
            const f = clamp01(pl.fog + (1 - pl.fog) * smooth((y - (base - fogH)) / fogH) * 0.92);
            c = mix(c, hz, quant(f, 8, x, y));
            r.set(x, y, c);
          }
        }
        if (k === 1) this.paintCity(r, top);
      }
      return r;
    }

    // La ville de flèches lumineuses, sur un plateau lointain ; son ascenseur orbital.
    paintCity(r, top) {
      const { W, H, look } = this;
      const pl = PLANES[1];
      const cx = W * 0.645;
      const half = W * 0.05;
      let beamTop = H;
      for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
        const base = Math.round(top(x));
        const u = (x - cx) / half;
        let h = 0;
        if (hash(x, 1, 230) < 0.55) h = Math.round((2 + hash(x, 2, 230) * 7) * (1 - u * u * 0.7));
        if (Math.abs(x - this.L.beamX) < 1) h = Math.round(H * 0.075);
        else if (Math.abs(x - this.L.beamX) < 2) h = Math.round(H * 0.045);
        if (hash(x, 3, 230) < 0.08) h += Math.round(4 + hash(x, 4, 230) * 6);
        for (let j = 1; j <= h; j++) {
          const y = base - j;
          let c = mix(C(look.mesa), this.hazeAt(x, y), pl.fog * 0.85);
          if (hash(x, 5, 230) < 0.5) c = mix(c, this.rimC, 0.25 * look.rimK);
          r.set(x, y, c);
          if (j > 1 && j < h && hash(x, y, 231) < (look.night ? 0.35 : 0.18)) {
            const lc = hash(x, y, 232) < 0.6 ? [255, 214, 150] : [110, 240, 255];
            r.set(x, y, mix(c, lc, look.night ? 0.95 : 0.6));
            this.cityLights.push({ x, y, c: lc, p: hash(x, y, 233) * 6 });
          }
        }
        if (Math.abs(x - this.L.beamX) < 1) beamTop = base - h;
      }
      this.beamTop = beamTop;
    }

    // Rayons du soleil dans la brume (dessinés en mode « lighter »).
    paintRays() {
      const { W, H, L, look } = this;
      const r = new Wide(W, H, this.extL, this.extR);
      const s = L.sun;
      const col = mix(this.glowC, this.glow2C, 0.4);
      for (let y = 0; y < Math.min(H, L.hz + H * 0.12); y++) {
        for (let x = r.x0; x < r.x1; x++) {
          const dx = x - s.x;
          const dy = y - s.y;
          const d = Math.hypot(dx, dy * 1.3);
          if (d < s.r * 2) continue;
          const a = Math.atan2(dy, dx);
          const beam = noise(a * 11 + 40, 0.5, 240) * 0.7 + noise(a * 31 + 9, 1.5, 241) * 0.3;
          const b = clamp01((beam - 0.48) * 3.2);
          if (b <= 0) continue;
          const fall = Math.exp(-d / (W * 0.42)) * clamp01((d - s.r * 2) / (W * 0.06));
          const vm = Math.exp(-(((y - s.y) / (H * 0.26)) ** 2));
          const v = look.rays * b * fall * vm * 2.2;
          const q = Math.floor(Math.min(1, v) * 5 + bayer(x, y) * 0.9) / 5;
          if (q <= 0) continue;
          r.set(x, y, col.map((c) => c * q * 0.55));
        }
      }
      return r.toCanvas();
    }

    /* ================= Plan moyen : la vallée, l'épave, les ruines ================= */
    groundTop(x) {
      const { H } = this;
      return H * 0.668 + (fbm(x * 0.012, 3.3, 301, 3) - 0.5) * H * 0.028;
    }
    // La dune proche, qui enterre la poupe de l'épave.
    duneTop(x) {
      const { W, H } = this;
      const u = x / W;
      let y = H * 0.752 + (fbm(x * 0.02, 5.5, 302, 3) - 0.5) * H * 0.03;
      y -= H * 0.05 * Math.exp(-(((u - 0.545) / 0.06) ** 2));
      y -= H * 0.018 * Math.exp(-(((u - 0.3) / 0.05) ** 2));
      return y;
    }

    sandAt(x, y, top, fogK) {
      const { look } = this;
      const sand = this.sandC || (this.sandC = look.sand.map((h) => this.grade(h)));
      // Relief des dunes : on éclaire la pente (le soleil est à droite, bas).
      const hd = (a, b) => fbm(a * 0.014 + b * 0.02, b * 0.06, 303, 3) + Math.sin(a * 0.05 + b * 0.3 + fbm(a * 0.01, b * 0.02, 306, 2) * 6) * 0.03;
      const h0 = hd(x, y);
      const lam = (h0 - hd(x + 1, y)) * 60 + (hd(x, y + 1) - h0) * 10;
      let i = 2;
      if (lam > 0.12) i = 3;
      if (lam > 0.45) i = 4;
      if (lam < -0.15) i = 1;
      if (lam < -0.55) i = 0;
      const d = y - top;
      if (d < 1) i = 4;
      let c = sand[i];
      const warm = this.sunNear(x, y);
      if (look.sun && i >= 3) c = mix(c, this.rimC, 0.18 * warm);
      if (fbm(x * 0.06, y * 0.14, 305, 2) > 0.68) c = mix(c, this.grade(look.grass[i >= 3 ? 3 : 1]), 0.6); // touffes
      if (hash(x, y, 307) < 0.012) c = sand[0]; // cailloux
      return mix(c, this.hazeAt(x, y), quant(fogK, 8, x, y));
    }

    paintMid() {
      const { W, H, look } = this;
      const r = new Wide(W, H, this.extL, this.extR);
      // Le fond de la vallée, dans la brume.
      for (let x = r.x0; x < r.x1; x++) {
        const top = this.groundTop(x);
        for (let y = Math.ceil(top); y < H; y++) {
          const f = 0.62 - 0.5 * smooth((y - top) / (H * 0.09));
          r.set(x, y, this.sandAt(x, y, top, f));
        }
      }
      if (look.mist) this.paintLowMist(r, H * 0.66, 0.5);
      // Les ruines lointaines du fond de la vallée.
      this.paintRuinsFar(r);
      // L'épave, puis la dune qui l'enterre.
      this.paintWreck(r);
      for (let x = r.x0; x < r.x1; x++) {
        const top = this.duneTop(x);
        for (let y = Math.ceil(top); y < H; y++) {
          const f = 0.22 - 0.2 * smooth((y - top) / (H * 0.1));
          r.set(x, y, this.sandAt(x, y, top, f));
        }
      }
      this.paintRuinsNear(r);
      if (look.wet) this.paintValleyPuddles(r);
      return r;
    }

    paintLowMist(r, y0, k) {
      const { H } = this;
      const c = mix(C(this.look.cloud[3]), this.hazeC, 0.5);
      for (let y = Math.round(y0 - H * 0.03); y < y0 + H * 0.05; y++) {
        for (let x = r.x0; x < r.x1; x++) {
          if (!r.alpha(x, y)) continue;
          const fall = 1 - Math.abs(y - y0) / (H * 0.05);
          const n = fbm(x * 0.02, y * 0.12, 391) * fall;
          if (n > 0.25) r.tint(x, y, c, bayer(x, y) < (n - 0.25) * 4 ? 0.7 : k * 0.6);
        }
      }
    }

    paintValleyPuddles(r) {
      const { H } = this;
      for (let y = Math.round(H * 0.68); y < H; y++) {
        for (let x = r.x0; x < r.x1; x++) {
          if (!r.alpha(x, y)) continue;
          const n = fbm(x * 0.03, y * 0.25, 392, 2);
          if (n > 0.62) {
            const sky = this.skyAt(x, Math.max(0, this.L.hz * 2 - y * 1.1));
            r.set(x, y, mix(sky, [255, 255, 255], hash(x, y, 393) < 0.05 ? 0.25 : 0.05));
          }
        }
      }
    }

    // Matériaux des ruines : pierre claire patinée, liserés, brume selon la profondeur.
    stone(x, y, fog, lit) {
      const { look } = this;
      let c = this.grade(fbm(x * 0.2, y * 0.2, 310, 2) > 0.55 ? '#a8968e' : '#8a7a7a');
      if (lit > 0) c = mix(c, this.rimC, Math.min(0.7, lit) * look.rimK);
      if (lit < 0) c = mix(c, this.grade('#2a2038'), -lit);
      return mix(c, this.hazeAt(x, y), quant(fog, 6, x, y));
    }

    // Une arche (deux piliers, un arc en plein cintre, un linteau). x : bord gauche, yb : sol.
    // broken : 1 = le haut droit effondré, 2 = le pilier droit cassé.
    paintArch(r, x, yb, w, h, fog, broken, seed) {
      const S = this.S;
      const pw = Math.max(3, Math.round(4 * S));
      const lint = Math.max(2, Math.round(3 * S));
      const rad = (w - pw * 2) / 2;
      const jc = h - lint - rad;
      const cxl = w / 2 - 0.5;
      const cutX = Math.round(w * (0.42 + hash(seed, 1, 311) * 0.25));
      for (let j = 0; j < h; j++) {
        const y = yb - j;
        for (let i = 0; i < w; i++) {
          const px = x + i;
          const open = i >= pw && i < w - pw && (j < jc || (i - cxl) ** 2 + (j - jc) ** 2 < rad * rad);
          if (open) continue;
          if (broken === 1 && i > cutX && j > jc - 2 + hash(px, seed, 312) * 4 + (i - cutX) * 0.3) continue;
          if (broken === 2 && i >= w - pw - 1 && j > h * 0.4 + hash(px, 2, 313) * 4) continue;
          if (broken === 2 && i > cutX && j > h - lint - 1) continue;
          // Liserés : à droite (soleil), dessus ; ombre sous l'arc et à gauche.
          const solidR = i + 1 < w && !(i + 1 >= pw && i + 1 < w - pw && (j < jc || (i + 1 - cxl) ** 2 + (j - jc) ** 2 < rad * rad));
          let lit = 0;
          if (i === w - 1 || !solidR) lit = 0.6;
          else if (j === h - 1) lit = 0.4;
          else if (i === 0 || (i === pw && j < jc)) lit = -0.25;
          let c = this.stone(px, y, fog, lit);
          if (j % 5 === 0 && j < h - lint && hash(px, y, 314) < 0.6) c = mix(c, [0, 0, 0], 0.14);
          if (j === h - lint && hash(px, 7, 314) < 0.7) c = mix(c, [0, 0, 0], 0.2);
          if (this.look.snow && j >= h - 2 && hash(px, 0, 315) < 0.8) c = mix(this.grade('#f0f4fa'), c, fog);
          r.set(px, y, c);
        }
      }
    }

    // Un pylône brisé, en biseau, avec un panneau qui pulse.
    paintPylon(r, x, yb, w, h, fog, seed, panel = true) {
      const cut = hash(seed, 1, 320) < 0.5 ? 1 : -1;
      for (let j = 0; j < h + w; j++) {
        const y = yb - j;
        for (let i = 0; i < w; i++) {
          const topJ = h + Math.round((cut > 0 ? i : w - 1 - i) * 0.9);
          if (j > topJ) continue;
          const lit = i === w - 1 ? 0.55 : j === topJ ? 0.45 : i === 0 ? -0.25 : 0;
          let c = this.stone(x + i, y, fog, lit);
          if (j % 6 === 3) c = mix(c, [0, 0, 0], 0.12);
          if (this.look.snow && j >= topJ - 1) c = mix(this.grade('#f0f4fa'), c, fog);
          r.set(x + i, y, c);
        }
      }
      if (panel && w >= 3) {
        const py = yb - Math.round(h * 0.55);
        const ph = Math.max(2, Math.round(h * 0.18));
        const pc = mix(C(this.look.panel), this.hazeC, fog * 0.6);
        for (let j = 0; j < ph; j++) r.set(x + 1, py - j, mix(pc, [10, 20, 30], 0.35));
        this.panels.push({ x: x + 1, y: py - ph + 1, w: 1, h: ph, p: hash(seed, 3, 320) * 6, k: 1 - fog * 0.6 });
      }
    }

    paintRuinsFar(r) {
      const { W, H } = this;
      const yb = Math.round(this.groundTop(W * 0.13) + 2);
      const S = this.S;
      // Une colonnade d'arches, à gauche, et des pylônes.
      for (let k = 0; k < 4; k++) {
        const x = Math.round(W * 0.05 + k * 17 * S);
        this.paintArch(r, x, yb + (k % 2), Math.round(17 * S), Math.round(19 * S), 0.45, k === 2 ? 1 : k === 3 ? 2 : 0, k + 1);
      }
      this.paintPylon(r, Math.round(W * 0.245), Math.round(this.groundTop(W * 0.245) + 2), Math.max(3, Math.round(4 * S)), Math.round(26 * S), 0.42, 5);
      this.paintPylon(r, Math.round(W * 0.268), Math.round(this.groundTop(W * 0.268) + 2), Math.max(2, Math.round(3 * S)), Math.round(15 * S), 0.45, 6, false);
      // Prolongement : d'autres ruines, tirées par case.
      if (this.wide) {
        r.only(() => {
          const cw = W * 0.22;
          for (let j = Math.floor(r.x0 / cw); j * cw < r.x1; j++) {
            const x = Math.round((j + hash(j, 1, 330) * 0.6) * cw);
            if (x > -W * 0.1 && x < W * 1.05) continue;
            if (hash(j, 2, 330) < 0.4) continue;
            const yb2 = Math.round(this.groundTop(x) + 2);
            if (hash(j, 3, 330) < 0.5) {
              const n = 1 + Math.floor(hash(j, 4, 330) * 3);
              for (let k = 0; k < n; k++) this.paintArch(r, x + Math.round(k * 17 * S), yb2, Math.round(17 * S), Math.round(19 * S), 0.45, hash(j, k, 331) < 0.4 ? 1 : 0, j * 7 + k);
            } else {
              this.paintPylon(r, x, yb2, Math.max(3, Math.round(4 * S)), Math.round((16 + hash(j, 5, 330) * 14) * S), 0.42, j * 3 + 1);
            }
          }
        });
      }
    }

    paintRuinsNear(r) {
      const { W, H } = this;
      const S = this.S;
      // Deux pylônes et un tablier de pont effondré, juste sous le promontoire.
      const x1 = Math.round(W * 0.548);
      const yb = Math.round(this.duneTop(x1) + 3);
      this.paintPylon(r, x1, yb, Math.max(4, Math.round(5 * S)), Math.round(30 * S), 0.16, 21);
      const x2 = Math.round(W * 0.505);
      this.paintPylon(r, x2, Math.round(this.duneTop(x2) + 3), Math.max(3, Math.round(4 * S)), Math.round(17 * S), 0.18, 22);
      // Tablier : une dalle inclinée entre les deux, à moitié tombée.
      const ty = yb - Math.round(22 * S);
      for (let i = 0; i < x1 - x2; i++) {
        const y = ty + Math.round(i * 0.25) + Math.round((x1 - x2 - i) * 0.35);
        for (let j = 0; j < 2; j++) r.set(x2 + 2 + i, y + j, this.stone(x2 + 2 + i, y + j, 0.16, j === 0 ? 0.4 : -0.1));
      }
      // Arche isolée, à gauche de l'épave.
      const xa = Math.round(W * 0.205);
      this.paintArch(r, xa, Math.round(this.duneTop(xa + 8) + 3), Math.round(20 * S), Math.round(22 * S), 0.18, 1, 9);
      if (this.wide) {
        r.only(() => {
          const cw = W * 0.3;
          for (let j = Math.floor(r.x0 / cw); j * cw < r.x1; j++) {
            const x = Math.round((j + hash(j, 1, 340) * 0.5) * cw);
            if (x > -W * 0.12 && x < W * 1.05) continue;
            if (hash(j, 2, 340) < 0.45) continue;
            const yb2 = Math.round(this.duneTop(x) + 3);
            if (hash(j, 3, 340) < 0.5) this.paintArch(r, x, yb2, Math.round(20 * S), Math.round(22 * S), 0.18, hash(j, 4, 340) < 0.5 ? 1 : 0, 50 + j);
            else this.paintPylon(r, x, yb2, Math.max(4, Math.round(5 * S)), Math.round((20 + hash(j, 5, 340) * 14) * S), 0.16, 60 + j);
          }
        });
      }
    }

    // L'épave d'un grand vaisseau, le nez levé hors de la dune, couverte de végétation.
    paintWreck(r) {
      const { W, H, look } = this;
      const S = this.S;
      const cx = W * 0.4;
      const cy = H * 0.7;
      const len = W * 0.29;
      const thick = 21 * S;
      const ang = 0.24; // le nez (à gauche) se lève
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const metal = [this.grade('#221c2c'), this.grade('#3e3646'), this.grade('#625866'), this.grade('#8c8086'), this.grade('#bcaca4')];
      const moss = [this.grade(look.leaf[1]), this.grade(look.leaf[2]), this.grade(look.leaf[3])];
      const fog = 0.2;
      const hz = this.hazeAt(cx, cy);
      const put = (x, y, c) => r.set(x, y, mix(c, hz, quant(fog, 6, x, y)));
      const x0 = Math.floor(cx - len * 0.6);
      const x1 = Math.ceil(cx + len * 0.6);
      const y0 = Math.floor(cy - len * 0.25 - thick);
      const y1 = Math.ceil(cy + len * 0.2 + thick);
      // Profil de la coque : nez en ogive à gauche, bosse de la passerelle, poupe large.
      const hw = (s) => {
        if (s < -0.55) return (thick / 2) * Math.sqrt(Math.max(0, (s + 1) / 0.45)) * 0.95;
        return (thick / 2) * (0.95 + 0.12 * smooth((s + 0.2) / 0.5));
      };
      const toLocal = (x, y) => {
        const dx = x - cx;
        const dy = y - cy;
        return [(dx * ca + dy * sa) / (len / 2), -dx * sa + dy * ca];
      };
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const [s, across] = toLocal(x, y);
          if (s < -1 || s > 1) continue;
          const h2 = hw(s);
          // La passerelle : une bosse sur le dessus, vers l'avant.
          const bridge = s > -0.5 && s < -0.22 ? 4 * S * Math.sqrt(1 - ((s + 0.36) / 0.14) ** 2) : 0;
          if (across > h2 || across < -h2 - bridge) continue;
          const v = across < -h2 ? -1.05 : across / h2; // −1 dessus, +1 dessous
          // La coque est éventrée au milieu : on voit les membrures.
          const brk = s > 0.02 && s < 0.3;
          const jag = -0.2 + noise(x * 0.5, 1, 350) * 0.6 + Math.sin(s * 50) * 0.12;
          const along = s * (len / 2);
          if (brk && v < jag) {
            // Les membrures à nu, en arceaux au-dessus de la déchirure.
            if (pmod(Math.round(along), 5) === 0 && v > -1 + hash(Math.round(along), 1, 356) * 0.5) put(x, y, v < -0.85 ? mix(metal[3], this.rimC, 0.5) : metal[1]);
            continue;
          }
          let i = v < -0.75 ? 4 : v < -0.3 ? 3 : v < 0.2 ? 2 : v < 0.6 ? 1 : 0;
          if (brk && v < jag + 0.4) i = pmod(Math.round(along), 4) === 0 ? 2 : 0;
          let c = metal[i];
          if (!brk && pmod(Math.round(along), 8) === 0 && Math.abs(v) < 0.92) c = mix(c, metal[0], 0.4); // tôles
          if (Math.abs(v - 0.3) < 0.07) c = mix(c, metal[0], 0.4); // ligne de flottaison
          if (v > -0.62 && v < -0.42 && noise(x * 0.3, y * 0.3, 357) > 0.3) c = mix(c, this.grade('#c0643a'), 0.45); // peinture passée
          // Hublots de la passerelle.
          if (bridge && across < -h2 && across > -h2 - bridge * 0.6 && pmod(Math.round(along), 3) === 0) c = this.grade('#141018');
          if (!brk && Math.abs(v + 0.05) < 0.08 && pmod(Math.round(along), 5) === 0 && s < 0.7) c = metal[0];
          if (fbm(x * 0.1, y * 0.25, 351, 2) > 0.63) c = mix(c, this.grade('#8a4a32'), 0.4); // rouille
          if (v < -0.85) c = mix(c, this.rimC, 0.55 * look.rimK);
          // Mousse sur le dessus.
          if (v < -0.4 && fbm(x * 0.12, y * 0.2, 352, 3) > 0.52 - (v + 1) * 0.4) c = moss[v < -0.8 ? 2 : fbm(x * 0.3, y * 0.3, 353, 2) > 0.5 ? 1 : 0];
          if (look.snow && v < -0.5) c = mix(this.grade('#f2f6fc'), c, 0.12);
          put(x, y, c);
        }
      }
      // Deux grands réacteurs à la poupe (à moitié enterrés).
      for (const [sAt, off] of [[0.62, 0.15], [0.84, -0.05]]) {
        const ex = cx + sAt * (len / 2) * ca - off * thick * sa;
        const ey = cy + sAt * (len / 2) * sa + off * thick * ca;
        const rr = 6 * S;
        for (let j = -rr; j <= rr; j++) {
          for (let i = -rr; i <= rr; i++) {
            const d = Math.hypot(i, j);
            if (d > rr) continue;
            let c = d > rr - 1.2 ? metal[3] : d > rr - 2.5 ? metal[1] : metal[0];
            if (i > 0 && d > rr - 1.2) c = mix(c, this.rimC, 0.4);
            put(Math.round(ex + i), Math.round(ey + j), c);
          }
        }
      }
      // L'aileron dorsal, cassé.
      const fs = 0.42;
      const fx = Math.round(cx + fs * (len / 2) * ca + hw(fs) * sa);
      const fy = Math.round(cy + fs * (len / 2) * sa - hw(fs) * ca);
      const fh = Math.round(16 * S);
      for (let j = 0; j < fh; j++) {
        const wj = Math.round((fh - j) * 0.55) + 2;
        for (let i = 0; i < wj; i++) {
          if (j > fh * 0.7 && i > wj * 0.6 + hash(j, 1, 355) * 2) continue;
          const lit = i === wj - 1 ? 0.55 : i === 0 ? -0.2 : 0;
          let c = mix(metal[2], lit > 0 ? this.rimC : metal[0], Math.abs(lit));
          if (j === Math.round(fh * 0.45) && i > 0 && i < wj - 1) c = mix(C(look.panel), metal[0], 0.35);
          put(fx + i + Math.round(j * 0.55), fy - j, c);
        }
      }
      this.panels.push({ x: fx + 1 + Math.round(fh * 0.45 * 0.55), y: fy - Math.round(fh * 0.45), w: 3, h: 1, p: 1.7, k: 0.8 });
      // Lianes qui pendent du flanc.
      for (let x = x0; x <= x1; x++) {
        if (hash(x, 1, 354) > 0.32) continue;
        const s0 = ((x - cx) / ca) / (len / 2);
        if (s0 < -0.8 || s0 > 0.9 || (s0 > 0.02 && s0 < 0.3)) continue;
        let yTop = null;
        for (let y = y0; y <= y1; y++) if (r.alpha(x, y) && toLocal(x, y)[1] > -hw(s0) * 0.5) {
          yTop = y;
          break;
        }
        if (yTop === null) continue;
        const n = 2 + Math.floor(hash(x, 2, 354) * 7 * S);
        for (let j = 0; j < n; j++) put(x, yTop + j, moss[j < 2 ? 1 : 0]);
      }
      // Des arbres ont poussé sur la coque.
      const topAt = (sv) => [Math.round(cx + sv * (len / 2) * ca + hw(sv) * sa), Math.round(cy + sv * (len / 2) * sa - hw(sv) * ca)];
      const [t1x, t1y] = topAt(-0.62);
      this.paintAlienTree(r, t1x, t1y + 1, Math.round(13 * S), fog, 31);
      const [t2x, t2y] = topAt(0.62);
      this.paintAlienTree(r, t2x, t2y + 1, Math.round(9 * S), fog, 32);
    }

    // Un petit arbre extraterrestre : tronc fin courbé, couronne en ombrelle.
    paintAlienTree(r, x, yb, h, fog, seed) {
      const { look } = this;
      const leaf = (look.bloom || look.leaf).map((c) => this.grade(c));
      const trunk = this.grade('#3a2a3a');
      const bend = (hash(seed, 1, 360) - 0.5) * 0.6;
      let tx = x;
      for (let j = 0; j < h; j++) {
        tx = x + Math.round(bend * j * j * 0.08);
        r.set(tx, yb - j, mix(trunk, this.hazeAt(tx, yb - j), fog));
      }
      const cy = yb - h;
      const rw = Math.round(h * 0.55) + 2;
      const rh = Math.max(2, Math.round(h * 0.28));
      for (let j = -rh; j <= rh; j++) {
        for (let i = -rw; i <= rw; i++) {
          const e = (i / rw) ** 2 + ((j + (i / rw) ** 2 * rh * 0.6) / rh) ** 2;
          if (e > 1 + (noise((x + i) * 0.5, (cy + j) * 0.5, 361) - 0.5) * 0.6) continue;
          const v = -j / rh + i / rw * 0.4;
          let k = v > 0.5 ? 4 : v > 0.1 ? 3 : v > -0.4 ? 2 : 1;
          if (!look.bloom && k === 4 && hash(x + i, cy + j, 362) < 0.7) k = 3;
          let c = leaf[k];
          if (look.snow && v > 0.3) c = this.grade('#f0f4fa');
          r.set(x + i + Math.round(bend * h * h * 0.08), cy + j, mix(c, this.hazeAt(x + i, cy + j), fog));
        }
      }
      if (look.bloom || look.bulbK > 0.5) this.glows.push({ x: x + Math.round(bend * h * h * 0.08), y: cy, r: rw + 4, c: C(look.bloom ? look.bloom[3] : look.bulb), k: look.night ? 0.22 : 0.12 });
    }

    /* ---------- Îlots flottants (sprites qui se balancent) ---------- */
    makeIslands() {
      const { W, H, look } = this;
      const S = this.S;
      const list = ISLES.map((d) => ({ ...d }));
      if (this.wide) {
        // Prolongement : d'autres îlots, tirés par case, entièrement hors de l'écran.
        const cw = W * 0.34;
        for (let j = Math.floor(this.X0 / cw); j * cw < this.X1; j++) {
          const u = (j + 0.2 + hash(j, 1, 370) * 0.6) * cw / W;
          const w = Math.round(16 + hash(j, 2, 370) * 40);
          if (u * W + w * S > -4 && u * W - w * S < W + 4) continue;
          if (hash(j, 3, 370) < 0.3) continue;
          list.push({ u, y: 0.18 + hash(j, 4, 370) * 0.3, w, h: Math.round(w * (0.55 + hash(j, 5, 370) * 0.2)), fall: hash(j, 6, 370) < 0.6, tree: w > 36, depth: 0.2 + hash(j, 7, 370) * 0.4, seed: 100 + j });
        }
      }
      this.isles = list.map((d) => this.makeIsle(d));
    }

    makeIsle(d) {
      const { W, H, look } = this;
      const S = this.S;
      const w = Math.max(8, Math.round(d.w * S));
      const h = Math.max(6, Math.round(d.h * S));
      const th = Math.max(2, Math.round(h * 0.16));
      const extra = d.tree ? Math.round(16 * S) : 3;
      const r = new Raster(w + 4, h + extra + 6);
      const oy = extra;
      const ox = 2;
      const rock = [this.grade('#1e1628'), this.grade('#33263c'), this.grade('#4e3a50'), this.grade('#6e5464')];
      const grass = look.grass.map((c) => this.grade(c));
      const depth = (x) => {
        const u = (x + 0.5) / w;
        const e = 1 - Math.abs(u * 2 - 1);
        return th + (h - th) * e ** 1.3 * (0.75 + 0.35 * noise(x * 0.35, d.seed, 371));
      };
      const ax = d.u * W;
      const ay = d.y * H;
      for (let x = 0; x < w; x++) {
        const dep = depth(x);
        const topOff = Math.round((noise(x * 0.3, d.seed, 372) - 0.5) * 2);
        for (let y = topOff; y < dep; y++) {
          const yy = y;
          let i = 1;
          const st = noise(x * 0.1, yy * 0.5, 373 + d.seed);
          if (st > 0.6) i = 2;
          else if (st < 0.32) i = 0;
          // Le soleil est à droite : flanc droit éclairé, flanc gauche dans l'ombre.
          if (x > w * 0.7 && y < depth(x + 1) - 0.5 && x === w - 1) i = 3;
          if (y >= depth(x + 1) - 1 && x < w - 1 && depth(x + 1) < dep) i = Math.max(i, 2);
          let c = rock[i];
          if (x >= w - 2 || (x < w - 1 && y >= depth(x + 1))) c = mix(c, this.rimC, 0.55 * look.rimK);
          if (y < topOff + 2) {
            c = grass[y === topOff ? 3 : 2];
            if (look.snow) c = this.grade(y === topOff ? '#f6f8fc' : '#d8dee8');
          }
          if (y === Math.ceil(dep) - 1 && hash(x, 1, d.seed) < 0.4) c = rock[0];
          r.set(ox + x, oy + y, mix(c, this.hazeAt(ax, ay), quant(d.depth, 6, x, y)));
        }
        // Racines qui pendent.
        if (hash(x, 2, d.seed) < 0.18 && x > 1 && x < w - 2) {
          const n = 2 + Math.floor(hash(x, 3, d.seed) * 5 * S);
          for (let j = 0; j < n; j++) r.set(ox + x, oy + Math.floor(dep) + j, mix(rock[0], this.hazeAt(ax, ay), d.depth + j * 0.08));
        }
        // Herbe haute et petites plantes sur le dessus.
        if (hash(x, 4, d.seed) < 0.35) {
          const gh = 1 + Math.floor(hash(x, 5, d.seed) * 2);
          for (let j = 1; j <= gh; j++) r.set(ox + x, oy + topOff - j, mix(look.snow ? this.grade('#e8ecf4') : grass[2 + (j === gh ? 1 : 0)], this.hazeAt(ax, ay), d.depth));
        }
      }
      // Glaçons sous l'îlot (monde gelé).
      if (look.snow) {
        for (let x = 1; x < w - 1; x += 2) if (hash(x, 9, d.seed) < 0.4) for (let j = 0; j < 1 + hash(x, 10, d.seed) * 3; j++) r.set(ox + x, oy + Math.floor(depth(x)) + j, mix(this.grade('#dff0ff'), this.hazeAt(ax, ay), d.depth));
      }
      // Un arbre extraterrestre sur le grand îlot.
      if (d.tree) {
        const tx = ox + Math.round(w * 0.36);
        const leaf = (look.bloom || look.leaf).map((c) => this.grade(c));
        const trunk = this.grade('#2e2234');
        const th2 = Math.round(10 * S);
        for (let j = 0; j < th2; j++) r.set(tx + Math.round(j * j * 0.02), oy - j, mix(trunk, this.hazeAt(ax, ay), d.depth));
        const cx = tx + Math.round(th2 * th2 * 0.02);
        const cyy = oy - th2;
        const rw = Math.round(8 * S);
        const rh = Math.round(4 * S);
        for (let j = -rh; j <= rh; j++) {
          for (let i = -rw; i <= rw; i++) {
            const e = (i / rw) ** 2 + ((j + (i / rw) ** 2 * rh * 0.5) / rh) ** 2;
            if (e > 1 + (noise(i * 0.6, j * 0.6, d.seed + 380) - 0.5) * 0.5) continue;
            const v = -j / rh + (i / rw) * 0.5;
            let c = leaf[v > 0.55 ? 4 : v > 0.1 ? 3 : v > -0.4 ? 2 : 1];
            if (look.snow && v > 0.2) c = this.grade('#f2f6fc');
            r.set(cx + i, cyy + j, mix(c, this.hazeAt(ax, ay), d.depth));
          }
        }
        // Une colonne de ruine, à droite.
        const px = ox + Math.round(w * 0.74);
        for (let j = 0; j < Math.round(7 * S); j++) {
          r.set(px, oy - j, mix(this.stone(px, 0, 0, 0), this.hazeAt(ax, ay), d.depth));
          r.set(px + 1, oy - j, mix(this.stone(px, 0, 0, 0.5), this.hazeAt(ax, ay), d.depth));
        }
      }
      const img = r.toCanvas();
      const x = Math.round(ax - w / 2 - ox);
      const y = Math.round(ay - oy);
      // Cascade : elle part du bord droit et tombe dans le vide.
      const fall = d.fall ? { x: x + ox + w - Math.max(3, Math.round(w * 0.12)), y: y + oy + 1, len: Math.round(H * (0.12 + d.w / 240)) , wid: d.w > 40 ? 2 : 1, depth: d.depth } : null;
      if (fall && look.falls === 'frozen') {
        // Cascade gelée : une coulée de glace figée, peinte une fois.
        const fr = new Raster(5, fall.len);
        const n = Math.round(fall.len * 0.32);
        for (let j = 0; j < n; j++) {
          // Une coulée figée qui s'amincit, et quelques glaçons à côté.
          const wj = Math.max(1, Math.round((fall.wid + 2) * (1 - j / n)));
          for (let i = 0; i < wj; i++) fr.set(i, j, mix(this.grade(i === 0 ? '#ffffff' : '#bcd8f0'), this.hazeC, d.depth * 0.6));
        }
        for (let i = 0; i < 5; i += 2) for (let j = 0; j < 2 + (i % 3); j++) fr.set(i, j, this.grade('#e4f2ff'));
        fall.ice = fr.toCanvas();
      }
      return { img, x, y, w: w + 4, ph: hash(d.seed, 1, 390) * 6, amp: 1 + (d.w > 40 ? 1 : 0), fall };
    }

    /* ---------- Bancs de brume qui dérivent dans la vallée ---------- */
    makeMist() {
      const { W, H, look } = this;
      const span = this.X1 - this.X0;
      const c = mix(this.hazeAt(W * 0.6, H * 0.66), this.glow2C, look.sun ? 0.2 : 0);
      const r = new Raster(span + W, Math.round(H * 0.08));
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) {
          const env = 1 - Math.abs(y / r.h - 0.5) * 2;
          const n = fbm(x * 0.012, y * 0.15, 395, 3) * env;
          const v = (n - 0.2) * (look.mist ? 3.2 : 2.2);
          if (v <= 0) continue;
          if (bayer(x, y) < Math.min(0.7, v)) r.set(x, y, c);
        }
      }
      return { img: r.toCanvas(), y: Math.round(H * 0.655), w: r.w };
    }

    /* ================= Premier plan : le promontoire ================= */
    // Dessus du promontoire (à droite) et des rochers du bas (à gauche).
    foreTop(x) {
      const { W, H, L } = this;
      const u = x / W;
      // Bord bas de l'image : une crête de rochers sombres.
      let y = H * (0.925 + (fbm(x * 0.03, 1.5, 401, 3) - 0.5) * 0.07);
      // Grands rochers en bas à gauche, qui encadrent l'image.
      const lo = H * (0.75 + 0.17 * smooth((u + 0.02) / 0.4) + (fbm(x * 0.05, 2.5, 402, 3) - 0.5) * 0.035);
      if (u < 0.42) y = Math.min(y, lo);
      // Le promontoire : il monte un peu vers la droite, quelques blocs.
      if (x >= L.edgeX) {
        let p = L.topY + (fbm(x * 0.04, 3.5, 403, 3) - 0.5) * H * 0.016 + (noise(x * 0.35, 3.5, 406) - 0.5) * 2.2;
        p -= H * 0.022 * smooth((u - 0.83) / 0.2);
        p -= H * 0.01 * Math.exp(-(((u - 0.88) / 0.02) ** 2)); // un bloc
        // Prolongement à droite : la crête ondule, plonge parfois vers la vallée.
        if (u > 1.04) {
          const n = fbm(x * 0.008, 8.5, 408, 3);
          const q = H * (0.69 + smooth((n - 0.5) / 0.14) * 0.2 + (noise(x * 0.04, 9.5, 409) - 0.5) * 0.03);
          p = lerp(p, q, smooth((u - 1.04) / 0.1));
        }
        y = Math.min(y, p);
      }
      // Prolongement à gauche : rochers qui montent et descendent.
      if (u < -0.04) {
        // Des éperons rocheux de temps en temps, des creux où l'on voit la vallée.
        const n = fbm(x * 0.009, 6.5, 404, 3);
        const rise = H * (0.93 - smooth((n - 0.42) / 0.2) * 0.2 - (noise(x * 0.05, 7.5, 407) - 0.5) * 0.03);
        y = Math.min(y, Math.max(H * 0.7, rise));
      }
      return y;
    }
    // Bord gauche de la falaise du promontoire, à la hauteur y : presque vertical en haut
    // (un léger surplomb), puis la paroi s'évase vers la gauche, par ressauts.
    cliffX(y) {
      const { L } = this;
      const d = y - L.topY;
      const steps = Math.floor(d / 7) * 2.2;
      return L.edgeX + Math.min(d, 6) * 0.25 - Math.max(0, d - 6) * 0.22 - steps + (noise(y * 0.2, 4.5, 405) - 0.5) * 3;
    }

    paintFore() {
      const { W, H, L, look } = this;
      const r = new Wide(W, H, this.extL, this.extR);
      const rock = look.rock.map((h) => this.grade(h));
      const rim = this.rimC;
      const snowC = [this.grade('#f4f6fc'), this.grade('#c8d0e4'), this.grade('#8c96b6')];
      const top = new Float32Array(r.sw + 4);
      for (let x = r.x0 - 2; x < r.x1 + 2; x++) top[x - r.x0 + 2] = this.foreTop(x);
      const T = (x) => top[Math.max(0, Math.min(top.length - 1, x - r.x0 + 2))];
      // Dans la roche ? (le dessus, ou la falaise du promontoire qui s'avance à gauche)
      const edgeTop = T(L.edgeX);
      const inside = (x, y) => y >= T(x) || (x < L.edgeX && y >= edgeTop && x >= this.cliffX(y));
      for (let x = r.x0; x < r.x1; x++) {
        for (let y = Math.max(0, Math.floor(Math.min(T(x), L.topY - 8))); y < H; y++) {
          if (!inside(x, y)) continue;
          const d = y >= T(x) ? y - T(x) : y - edgeTop + 3; // la falaise : pas de liseré du dessus
          // Roche : facettes (pente du bruit, éclairées depuis la droite), strates, fissures.
          const hf = (a, b) => fbm(a * 0.06 + b * 0.015, b * 0.08, 410, 3);
          const h0 = hf(x, y);
          const lam = (h0 - hf(x + 1, y)) * 34 + (h0 - hf(x, y - 1)) * 14;
          let i = 1;
          if (lam > 0.18) i = 2;
          if (lam > 0.55) i = 3;
          if (lam < -0.35) i = 0;
          const st = (y + noise(x * 0.04, 0.5, 414) * 5) / 8;
          const sf = st - Math.floor(st);
          if (sf < 0.1 && d > 3 && noise(x * 0.08, y * 0.2, 416) > 0.5) i = Math.min(4, i + 1);
          else if (sf < 0.24 && d > 3) i = Math.max(0, i - 1);
          if (noise(x * 0.3, y * 0.07, 411) > 0.74) i = 0;
          // Le bas de l'image s'assombrit (vignettage vertical).
          if (y > H * 0.92 && i > 0) i--;
          let c = rock[i];
          // Liseré du dessus, côté soleil.
          const edge = d < 1;
          const outR = !inside(x + 1, y);
          const outR2 = !inside(x + 2, y);
          const outL = !inside(x - 1, y);
          const rimOn = noise(x * 0.2, 1.5, 415) > 0.3;
          if (d < 1) c = rimOn ? mix(rock[4], rim, (0.5 + 0.35 * this.sunNear(x, y)) * look.rimK) : rock[3];
          else if (d < 2) c = rimOn ? mix(rock[3], rim, 0.12 * look.rimK) : rock[2];
          if (outR) c = mix(c, rim, 0.6 * look.rimK);
          else if (outR2) c = mix(c, rim, 0.25 * look.rimK);
          if (i >= 3 && this.look.sun) c = mix(c, rim, 0.12 * this.sunNear(x, y) + 0.06);
          if (outL && !edge) c = mix(c, rock[0], 0.5);
          if (look.snow && (d < 2.5 + noise(x * 0.2, 7, 412) * 2.5 || (sf < 0.1 && d > 3 && d < 22 && noise(x * 0.12, y * 0.3, 413) > 0.6))) c = snowC[d < 1 ? 0 : d < 3 ? 1 : 2];
          if (look.wet && d < 1.2) c = mix(c, [255, 255, 255], 0.15);
          r.set(x, y, c);
        }
      }
      this.paintForeGrass(r, T);
      if (look.wet) this.paintPuddles(r, T);
      // Le grand arbre extraterrestre, au bout du promontoire.
      this.paintBigTree(r, Math.round(W * 0.965), Math.round(T(Math.round(W * 0.965)) + 1), 1);
      if (this.wide) {
        r.only(() => {
          const cw = W * 0.45;
          for (let j = Math.floor(r.x0 / cw); j * cw < r.x1; j++) {
            const x = Math.round((j + 0.2 + hash(j, 1, 420) * 0.6) * cw);
            if (x > -W * 0.25 && x < W * 1.25) continue;
            if (hash(j, 2, 420) < 0.35) continue;
            this.paintBigTree(r, x, Math.round(T(x) + 1), 0.7 + hash(j, 3, 420) * 0.4, j);
          }
        });
      }
      if (this.wide) r.only(() => this.paintBoulders(r, T));
      this.paintForePlants(r, T);
      return r;
    }

    // Blocs de rocher posés sur la crête (prolongement seulement).
    paintBoulders(r, T) {
      const { W, H, look } = this;
      const rock = look.rock.map((h) => this.grade(h));
      const cw = W * 0.16;
      for (let j = Math.floor(r.x0 / cw); j * cw < r.x1; j++) {
        if (hash(j, 1, 470) < 0.45) continue;
        const cx = Math.round((j + 0.2 + hash(j, 2, 470) * 0.6) * cw);
        if (cx > -W * 0.08 && cx < W * 1.08) continue;
        const rw = Math.round((5 + hash(j, 3, 470) * 10) * this.S);
        const rh = Math.round(rw * (0.55 + hash(j, 4, 470) * 0.4));
        const base = Math.round(T(cx)) + 2;
        for (let y = base - rh; y <= base; y++) {
          for (let x = cx - rw; x <= cx + rw; x++) {
            const u = (x - cx) / rw;
            const v = (base - y) / rh;
            if (u * u + v * v > 1 + (noise(x * 0.3, y * 0.3, 471) - 0.5) * 0.4) continue;
            let c = rock[u > 0.3 && v > 0.3 ? 3 : u > -0.2 ? 2 : 1];
            const outR = (u + 1 / rw) ** 2 + v * v > 1;
            const outT = u * u + (v + 1 / rh) ** 2 > 1;
            if (outT) c = mix(rock[4], this.rimC, 0.45 * look.rimK);
            else if (outR) c = mix(c, this.rimC, 0.4 * look.rimK);
            if (look.snow && v > 0.55) c = this.grade('#eef2fa');
            r.set(x, y, c);
          }
        }
      }
    }

    // Herbe bleutée sur le dessus des rochers.
    paintForeGrass(r, T) {
      const { H, look } = this;
      const g = look.grass.map((c) => this.grade(c));
      for (let x = r.x0; x < r.x1; x++) {
        const ty = Math.round(T(x));
        if (ty >= H - 2) continue;
        if (fbm(x * 0.05, 9.5, 430, 2) < 0.4) continue;
        const n = hash(x, 1, 431);
        const gh = n < 0.5 ? 1 : n < 0.8 ? 2 : n < 0.95 ? 3 : 4;
        const lean = hash(x, 2, 431) < 0.5 ? 0 : 1;
        for (let j = 1; j <= gh; j++) {
          let c = j === gh ? g[3] : g[2 - (j === 1 ? 1 : 0)];
          if (look.snow) c = j === gh ? this.grade('#ffffff') : this.grade('#c8d4e8');
          if (look.autumn && hash(x, 3, 431) < 0.5) c = mix(c, this.grade('#d07a2a'), 0.5);
          r.set(x + (j > 2 ? lean : 0), ty - j, c);
        }
        // Rim : le bout des herbes accroche le soleil.
        if (gh >= 2 && this.look.sun) r.tint(x + (gh > 2 ? lean : 0), ty - gh, this.rimC, 0.5);
      }
    }

    paintPuddles(r, T) {
      const { W, H } = this;
      for (let x = r.x0; x < r.x1; x++) {
        const ty = Math.round(T(x));
        if (ty > H * 0.9 || fbm(x * 0.06, 4.5, 440, 2) < 0.54) continue;
        for (let j = 1; j < 3; j++) {
          const y = ty + j;
          const sky = this.skyAt(x, Math.max(0, this.L.hz - (y - this.L.hz) * 2));
          r.set(x, y, mix(sky, [255, 255, 255], 0.1));
          if (j === 1) this.puddles.push({ x, y });
        }
      }
    }

    // Plantes luminescentes : tiges à bulbes, fougères en crosse, champignons.
    paintForePlants(r, T) {
      const { W, H, L, look } = this;
      const S = this.S;
      const leaf = look.leaf.map((c) => this.grade(c));
      const bulb = C(look.bulb);
      const stem = this.grade('#1a1830');
      for (let kk = Math.floor(r.x0 / 7) - 1; kk * 7 < r.x1 + 7; kk++) {
        const x = kk * 7 + Math.floor(hash(kk, 1, 450) * 5);
        const ty = Math.round(T(x));
        if (ty > H - 3 || hash(kk, 2, 450) < 0.45) continue;
        // Pas de plantes sous l'exploratrice, son robot et sa moto.
        if (x > L.edgeX - 2 && x < W * 0.82) continue;
        const kind = hash(kk, 3, 450);
        const big = ty > H * 0.85 ? 1.6 : 1;
        if (kind < 0.45) {
          // Tige à bulbe lumineux.
          const h = Math.round((3 + hash(kk, 4, 450) * 6) * S * big);
          const bend = hash(kk, 5, 450) < 0.5 ? -1 : 1;
          let bx = x;
          for (let j = 1; j <= h; j++) {
            bx = x + (j > h * 0.6 ? bend : 0);
            r.set(bx, ty - j, stem);
          }
          const bc = look.snow ? mix(bulb, [255, 255, 255], 0.5) : bulb;
          r.set(bx, ty - h - 1, bc);
          r.set(bx + bend, ty - h - 1, mix(bc, stem, 0.4));
          r.set(bx, ty - h - 2, mix(bc, [255, 255, 255], 0.4));
          this.glows.push({ x: bx, y: ty - h - 1, r: (look.night ? 9 : 6) * big, c: bulb, k: 0.35 * look.bulbK, pulse: hash(kk, 6, 450) * 6 });
        } else if (kind < 0.75) {
          // Fougère en crosse.
          const h = Math.round((4 + hash(kk, 7, 450) * 5) * S * big);
          for (let j = 1; j <= h; j++) {
            const ox = Math.round(Math.sin((j / h) * 2.2) * 2);
            r.set(x + ox, ty - j, leaf[j > h - 2 ? 4 : 2]);
            if (j % 2 === 0) r.set(x + ox - 1, ty - j, leaf[1]);
          }
          r.set(x + 1, ty - h - 1, leaf[3]);
          if (look.night || look.bulbK > 0.55) this.glows.push({ x: x + 1, y: ty - h, r: 4, c: C(look.leaf[4]), k: 0.25 * look.bulbK });
        } else {
          // Champignon aplati, chapeau lumineux par dessous.
          const h = Math.round((2 + hash(kk, 8, 450) * 3) * S * big);
          const cw = Math.round(2 + hash(kk, 9, 450) * 2 * big);
          for (let j = 1; j <= h; j++) r.set(x, ty - j, stem);
          for (let i = -cw; i <= cw; i++) {
            const top = Math.abs(i) < cw - 0.5 ? 2 : 1;
            for (let q = 1; q <= top; q++) r.set(x + i, ty - h - q, look.snow && q === top ? this.grade('#f4f6fc') : q === top && i > 0 ? leaf[4] : leaf[3]);
            if (Math.abs(i) < cw) r.set(x + i, ty - h, mix(bulb, leaf[2], 0.35));
          }
          r.set(x + Math.round(cw / 2), ty - h - 2, look.snow ? this.grade('#ffffff') : mix(leaf[4], [255, 255, 255], 0.3));
          this.glows.push({ x, y: ty - h, r: (look.night ? 6 : 3) + cw * 2, c: bulb, k: 0.3 * look.bulbK, pulse: hash(kk, 10, 450) * 6 });
        }
      }
    }

    // Le grand arbre au bout du promontoire : tronc tordu, couronnes en ombrelles
    // étagées, cosses lumineuses qui pendent.
    paintBigTree(r, x, yb, sc, seed = 0) {
      const { W, H, look } = this;
      const S = this.S * sc;
      const leaf = (look.bloom || look.leaf).map((c) => this.grade(c));
      const bark = [this.grade('#0c0814'), this.grade('#1c1424'), this.grade('#2e2234')];
      const h = Math.round(64 * S);
      // Tronc : il part vers la gauche puis se redresse.
      const pts = [];
      for (let j = 0; j <= h; j++) {
        const t = j / h;
        const lean = seed ? (hash(seed, 2, 465) < 0.5 ? -1 : 1) * (0.5 + hash(seed, 3, 465)) : 1;
        pts.push([x - Math.round((Math.sin(t * 2.4) * 14 * S + t * 4 * S) * lean), yb - j]);
      }
      for (let j = 0; j <= h; j++) {
        const [px, py] = pts[j];
        const tw = Math.max(1, Math.round((5 - (j / h) * 3.5) * S));
        for (let i = -tw; i <= tw; i++) {
          let c = bark[i >= tw - 1 ? 2 : i <= -tw + 1 ? 0 : 1];
          if (i === tw) c = mix(bark[2], this.rimC, 0.6 * look.rimK);
          if (look.snow && i >= tw - 1 && hash(px, py, 460) < 0.4) c = this.grade('#e8eef8');
          r.set(px + i, py, c);
        }
        // Racines au pied.
        if (j < 4 * S) for (let i = 0; i < (4 * S - j) * 2.5; i++) {
          r.set(px - Math.round(tw + i), py, bark[0]);
          r.set(px + Math.round(tw + i * 0.7), py, bark[1]);
        }
      }
      // Branches et couronnes en ombrelle, étagées.
      let crowns = [
        [0.62, -16, 15, 6], [0.78, 10, 17, 6], [0.93, -6, 20, 7], [0.48, 14, 11, 5],
      ];
      if (seed) {
        const n = 2 + Math.floor(hash(seed, 1, 465) * 3);
        crowns = Array.from({ length: n }, (_, k) => [
          0.45 + (k / n) * 0.45 + hash(seed, k, 466) * 0.08,
          Math.round((hash(seed, k, 467) - 0.5) * 34),
          10 + Math.round(hash(seed, k, 468) * 11),
          4 + Math.round(hash(seed, k, 469) * 3),
        ]);
        crowns.push([1, Math.round((hash(seed, 9, 467) - 0.5) * 10), 12 + Math.round(hash(seed, 9, 468) * 8), 5]);
      }
      for (const [t, dx, rw0, rh0] of crowns) {
        const j = Math.round(t * h);
        const [px, py] = pts[j];
        const cx = px + Math.round(dx * S);
        const cy = py - Math.round(4 * S);
        // Branche.
        const n = Math.abs(cx - px);
        for (let i = 0; i <= n; i++) {
          const bx = px + Math.sign(cx - px) * i;
          r.set(bx, py - Math.round((i / Math.max(1, n)) * 4 * S), bark[1]);
        }
        const rw = Math.round(rw0 * S);
        const rh = Math.round(rh0 * S);
        for (let jj = -rh; jj <= rh; jj++) {
          for (let i = -rw; i <= rw; i++) {
            const u = i / rw;
            const e = u * u + ((jj + u * u * rh * 0.8) / rh) ** 2;
            if (e > 1 + (noise((cx + i) * 0.3, (cy + jj) * 0.3, 461 + seed) - 0.5) * 0.7) continue;
            const v = -jj / rh + u * 0.6;
            let k = v > 0.7 ? 4 : v > 0.2 ? 3 : v > -0.3 ? 2 : v > -0.7 ? 1 : 0;
            let c = leaf[k];
            if (look.snow && v > 0.1) c = this.grade(v > 0.6 ? '#ffffff' : '#d4dcec');
            // Liseré du soleil sur le haut et le côté droit.
            if (u > 0.75 && v > 0) c = mix(c, this.rimC, 0.5 * look.rimK);
            r.set(cx + i, cy + jj, c);
          }
        }
        // Cosses lumineuses qui pendent sous la couronne.
        for (let i = -rw + 2; i < rw - 1; i += 3) {
          if (hash(cx + i, cy, 462 + seed) < 0.5) continue;
          const len = 1 + Math.floor(hash(cx + i, cy, 463) * 4 * S);
          const by = cy + Math.round(rh * (1 - ((i / rw) ** 2) * 0.8) * 0.3) + 1;
          for (let q = 0; q < len; q++) r.set(cx + i, by + q, leaf[0]);
          const bc = look.bloom ? C(look.bloom[3]) : C(look.bulb);
          r.set(cx + i, by + len, look.snow ? this.grade('#e0f4ff') : bc);
          this.glows.push({ x: cx + i, y: by + len, r: 5, c: bc, k: 0.3 * look.bulbK, pulse: hash(cx + i, 1, 464) * 6 });
        }
        if (look.bloom) this.glows.push({ x: cx, y: cy, r: rw + 6, c: C(look.bloom[2]), k: look.night ? 0.2 : 0.1 });
      }
    }

    /* ================= Sprites : l'exploratrice, le robot, la moto, les créatures ================= */
    makeSprites() {
      const { look } = this;
      const night = look.night;
      const S = (rows, pal, flip) => B.PX.sprite(rows, pal, flip);
      // Contre-jour : les couleurs des personnages sont assombries, le liseré est chaud.
      const shade = (h, k = 1) => toHex(mix(this.grade(h), C(night ? '#0a0c1e' : '#1a1028'), (night ? 0.55 : 0.32) * k));
      const rim = toHex(mix(this.rimC, [255, 255, 255], 0.1));
      // L'exploratrice, assise au bord, tournée vers la gauche (l'horizon), les jambes
      // dans le vide. 16 × 20 ; le bord de la falaise passe à la colonne 5, le rocher à la
      // ligne 16.
      const pal = {
        k: shade('#120e1c'), h: shade('#e4e6ee', 0.7), H: shade('#a4aabc', 0.8), v: '#ff9a3a', V: '#ffd690',
        s: shade('#8c9ab4'), d: shade('#525a76'), p: shade('#7a6450'), P: shade('#4a3c34'), b: shade('#2a2634'),
        g: shade('#3c3c4c'), r: rim, y: shade('#e8b040'),
      };
      const SEAT = [
        '......kkkk......',
        '.....khhhhk.....',
        '....khhhhhhr....',
        '...kvVhhhhhr....',
        '...kvvVhhhhr....',
        '...kvvvHhhhr....',
        '....kkvHHhr.....',
        '.....kkkkkPPk...',
        '....kssssPPPpr..',
        '...kdssssPPPpr..',
        '...kdsssdPPPpr..',
        '..kgdsssdPPPpr..',
        '..kg.dssdyPPpr..',
        '.kgg.dsssdkkr...',
        'kssssssssssr....',
        'kddddddddssr....',
        'kbbk............',
        '.kbbk...........',
        '.kbbk...........',
        'kbbbk...........',
      ];
      // Tête tournée vers le robot (à droite).
      const LOOK = SEAT.slice();
      LOOK[3] = '...khhhhhVvk....';
      LOOK[4] = '...khhhhVvvk....';
      LOOK[5] = '...khHhhvvvk....';
      LOOK[6] = '....kHHHvvk.....';
      this.girl = { seat: S(SEAT, pal), look: S(LOOK, pal), w: 16, h: 20, edge: 5, seatRow: 16 };
      this.scarfC = [this.grade('#7a1e3a'), this.grade('#c83a4e'), this.grade('#ff7a6a')].map((c) => (night ? mix(c, [10, 12, 30], 0.45) : c));
      // La moto antigravité, garée, tournée vers la gauche. 34 × 10.
      const bpal = {
        k: shade('#141220'), b: shade('#d4d0d8', 0.8), B: shade('#8a8696', 0.9), d: shade('#4a4658'), w: '#7ae8ff', W: '#d8fbff',
        r: rim, o: '#ff8a3a', O: '#ffc070', s: shade('#3a3040'), S: shade('#5a4c5a'), e: '#5af0ff',
      };
      const BIKE = [
        '..........kk......................',
        '.........kWwk.....................',
        '........kwwwk.....kkkkk...........',
        '.....kkkkbbbbkkkkkSSSSSk..........',
        '...kkbbbbbbbbbbbbbsssssskkk.......',
        '.kkbbbbbbbbooooOObbbbbbbbbbkkkk...',
        'kOobbbbbbbbbbbbbbbbbbbbbbbbbbbbkk.',
        '.kkBBBBBBBBBBBBBBBBBBBBBBBBBBBBBrre',
        '...kkddddddkkkkkkkkkkkdddddddkkkk.',
        '....kkkkkkk..........kkkkkkkkk....',
      ];
      this.bike = { img: S(BIKE, bpal), w: 34, h: 10 };
      // Le robot compagnon : dessiné à la main dans drawRobot (couleurs ici).
      this.botC = {
        body: mix(this.grade('#e6e0d4'), C(night ? '#0a0c1e' : '#1a1028'), night ? 0.5 : 0.25),
        shade: mix(this.grade('#9a9088'), C(night ? '#0a0c1e' : '#1a1028'), night ? 0.5 : 0.3),
        dark: C('#1a1420'),
        rim: this.rimC,
        eye: C('#5ff0ff'),
      };
      // Les créatures volantes : silhouette sombre, longues ailes.
      this.flyC = night ? '#0a0c18' : look.snow ? '#3a3a52' : '#1e1430';
    }

    /* ================= La vie ================= */
    resetLife() {
      const { W, H, L, look } = this;
      const X0 = this.X0;
      const X1 = this.X1;
      this.flyers = [];
      this.nextFlyer = look.flyers ? (this.fast ? 0.3 : 3 + Math.random() * 6) : Infinity;
      if (look.flyers) {
        // Un premier vol, déjà dans le ciel.
        this.spawnFlyers(W * 0.74, H * 0.17, -1, 3);
      }
      this.ships = [];
      this.nextShip = look.ships ? 4 + Math.random() * 8 : Infinity;
      this.meteors = [];
      this.nextMeteor = look.meteors ? 1 : look.night || look.sun ? 12 + Math.random() * 20 : Infinity;
      this.capsule = null;
      this.nextCapsule = 3 + Math.random() * 6;
      this.flash = 0;
      this.bolt = null;
      this.nextBolt = 3 + Math.random() * 4;
      // La poussière lumineuse, les spores, les pétales.
      const span = X1 - X0;
      const nd = look.dust ? Math.round((26 * span) / W) : 0;
      this.dust = Array.from({ length: nd }, () => ({ x: X0 + Math.random() * span, y: H * (0.45 + Math.random() * 0.5), p: Math.random() * 6, v: 1.5 + Math.random() * 3 }));
      const ns = look.spores ? Math.round((60 * span) / W) : 0;
      this.spores = Array.from({ length: ns }, () => this.newSpore(true));
      const np = look.petals ? Math.round((24 * span) / W) : 0;
      this.petals = Array.from({ length: np }, () => this.newPetal(true));
      // Le robot.
      this.bot = { x: L.edgeX + Math.round(16 * this.S), hop: 0, look: -1, eye: 0, blink: 0, next: 2, state: 'idle', t: 0 };
      this.girlLook = 0;
      this.nextGirlLook = 14 + Math.random() * 10;
    }

    spawnFlyers(x, y, dir, n) {
      const S = this.S;
      for (let k = 0; k < n; k++) {
        const sc = 0.7 + Math.random() * 0.5;
        this.flyers.push({ x: x - dir * k * 14 * S, y: y + (k % 2) * 5 * S + k * 2, dir, v: (6 + Math.random() * 3) * sc, ph: Math.random() * 6, sc: sc * S, t: 0 });
      }
    }

    newSpore(initial) {
      const { H } = this;
      const span = this.X1 - this.X0;
      return { x: this.X0 + Math.random() * span, y: initial ? H * (0.4 + Math.random() * 0.6) : H * (0.85 + Math.random() * 0.15), v: 1 + Math.random() * 3, p: Math.random() * 6, s: 0.5 + Math.random(), c: Math.random() < 0.7 ? 0 : 1 };
    }

    newPetal(initial) {
      const { H } = this;
      const span = this.X1 - this.X0;
      return { x: this.X0 + Math.random() * span, y: initial ? Math.random() * H : -4, v: 5 + Math.random() * 6, p: Math.random() * 6, c: Math.random() < 0.5 ? 0 : 1 };
    }

    // Pour l'animation d'ouverture : un vol de créatures traverse l'image vers la gauche.
    introReturn() {
      const { W, H, look } = this;
      if (look.flyers) this.spawnFlyers(W * 0.95, H * 0.24, -1, 3);
    }

    update(dt, ctx) {
      const eff = (ctx && ctx.effect) || 'none';
      if (eff !== this.effect) this.build(eff);
      const { W, H, L, look } = this;
      this.t += dt;
      const t = this.t;
      const fast = this.fast ? 4 : 1;
      const X0 = this.X0;
      const X1 = this.X1;

      // Les bandes de la planète glissent (très lentement).
      this.renderPlanet(Math.floor(t / 2.5));

      // Créatures volantes.
      if (look.flyers) {
        this.nextFlyer -= dt * fast;
        if (this.nextFlyer <= 0) {
          const dir = Math.random() < 0.5 ? 1 : -1;
          this.spawnFlyers(dir > 0 ? X0 - 20 : X1 + 20, H * (0.18 + Math.random() * 0.3), dir, 1 + Math.floor(Math.random() * 3));
          this.nextFlyer = 14 + Math.random() * 20;
        }
      }
      for (const f of this.flyers) {
        f.x += f.dir * f.v * dt * fast;
        f.t += dt;
        f.y += Math.sin(f.t * 0.4 + f.ph) * dt * 0.8;
      }
      this.flyers = this.flyers.filter((f) => f.x > X0 - 40 && f.x < X1 + 40);

      // Vaisseaux lointains, avec leur traînée.
      if (look.ships) {
        this.nextShip -= dt * fast;
        if (this.nextShip <= 0) {
          const dir = Math.random() < 0.5 ? 1 : -1;
          const y = H * (0.06 + Math.random() * 0.3);
          this.ships.push({ x: dir > 0 ? X0 - 6 : X1 + 6, y, dir, v: 10 + Math.random() * 14, rise: (Math.random() - 0.6) * 1.5, trail: [], big: Math.random() < 0.25 });
          this.nextShip = 18 + Math.random() * 26;
        }
      }
      for (const s of this.ships) {
        s.x += s.dir * s.v * dt;
        s.y += s.rise * dt;
        if (!s.trail.length || Math.abs(s.trail[s.trail.length - 1].x - s.x) >= 1) s.trail.push({ x: Math.round(s.x), y: Math.round(s.y), age: 0 });
        for (const p of s.trail) p.age += dt;
        s.trail = s.trail.filter((p) => p.age < 5);
      }
      this.ships = this.ships.filter((s) => (s.dir > 0 ? s.x < X1 + 10 : s.x > X0 - 10) || s.trail.length);
      for (const s of this.ships) if (s.x > X1 + 10 || s.x < X0 - 10) s.trail = s.trail.filter((p) => p.age < 5);

      // Étoiles filantes.
      this.nextMeteor -= dt * fast;
      if (this.nextMeteor <= 0) {
        this.meteors.push({ x: X0 + Math.random() * (X1 - X0), y: Math.random() * L.hz * 0.45, age: 0, life: 0.8 + Math.random() * 0.4, dx: (Math.random() < 0.5 ? -1 : 1) * (45 + Math.random() * 25), dy: 16 + Math.random() * 12 });
        this.nextMeteor = look.meteors ? 0.6 + Math.random() * 2.2 : 20 + Math.random() * 30;
      }
      for (const m of this.meteors) m.age += dt;
      this.meteors = this.meteors.filter((m) => m.age < m.life);

      // Une capsule monte le long de l'ascenseur orbital.
      if (this.capsule) {
        this.capsule.y -= dt * 9;
        if (this.capsule.y < -4) this.capsule = null;
      } else {
        this.nextCapsule -= dt * fast;
        if (this.nextCapsule <= 0) {
          this.capsule = { y: this.beamTop };
          this.nextCapsule = 12 + Math.random() * 16;
        }
      }

      // Poussière, spores, pétales.
      for (const p of this.dust) {
        p.x += p.v * dt;
        p.y += Math.sin(t * 0.7 + p.p) * dt * 1.5;
        if (p.x > X1) p.x = X0;
      }
      for (const s of this.spores) {
        s.y -= s.v * dt * 0.6;
        s.x += Math.sin(t * 0.5 * s.s + s.p) * dt * 3;
        if (s.y < H * 0.35) Object.assign(s, this.newSpore(false));
      }
      for (const p of this.petals) {
        p.y += p.v * dt;
        p.x += (Math.sin(t * 1.2 + p.p) * 6 + 5) * dt;
        if (p.y > H || p.x > X1) Object.assign(p, this.newPetal(false));
      }

      // L'orage : des éclairs violets entre les mesas.
      if (this.flash > 0) this.flash -= dt;
      if (look.storm) {
        this.nextBolt -= dt * fast;
        if (this.nextBolt <= 0) {
          this.flash = 0.55;
          const pts = [];
          let x = this.wide ? X0 * 0.5 + Math.random() * (W * 0.95 - X0 * 0.5) : W * (0.1 + Math.random() * 0.8);
          const yEnd = this.mesaTop(2, x) + 2;
          for (let y = Math.round(H * 0.12); y < yEnd; y += 2 + Math.floor(Math.random() * 4)) {
            pts.push([Math.round(x), y]);
            x += (Math.random() - 0.5) * 7;
          }
          this.bolt = pts;
          this.nextBolt = 4 + Math.random() * 9;
        }
      }

      // Le robot : il regarde autour, sautille, cligne de l'œil.
      const b = this.bot;
      b.t += dt;
      b.next -= dt;
      if (b.blink > 0) b.blink -= dt;
      if (b.hop > 0) b.hop = Math.max(0, b.hop - dt);
      if (b.next <= 0) {
        const r = Math.random();
        if (r < 0.35) b.look = -b.look;
        else if (r < 0.55) b.hop = 0.5;
        else if (r < 0.75) b.blink = 0.18;
        else b.look = Math.random() < 0.7 ? -1 : 1;
        b.next = 1.5 + Math.random() * 3.5;
      }
      // L'exploratrice tourne la tête vers son robot, de temps en temps.
      this.nextGirlLook -= dt;
      if (this.girlLook > 0) this.girlLook -= dt;
      if (this.nextGirlLook <= 0) {
        this.girlLook = 3.5;
        b.look = -1;
        b.hop = 0.5;
        this.nextGirlLook = 18 + Math.random() * 16;
      }
    }

    /* ================= Dessin d'une image ================= */
    draw(g) {
      const { W, H, L, look } = this;
      const t = this.t;
      g.imageSmoothingEnabled = false;
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      const wx0 = this.X0;

      // 1. Le ciel, la géante gazeuse et ses anneaux.
      g.drawImage(this.sky, wx0, 0);
      for (const s of this.twinkles) {
        const v = 0.5 + 0.5 * Math.sin(t * s.s + s.p);
        if (v < 0.6) continue;
        g.fillStyle = css(s.c, Math.min(1, v * s.b * 1.4));
        g.fillRect(s.x, s.y, 1, 1);
      }
      this.drawMeteors(g);
      this.drawShips(g);
      g.drawImage(this.ringBack, this.pl.x0, this.pl.y0);
      g.drawImage(this.planetCv, this.pl.x0, this.pl.y0);
      g.drawImage(this.ringFront, this.pl.x0, this.pl.y0);
      if (this.cover) g.drawImage(this.cover, wx0, 0);
      if (look.sun) this.drawSunFlare(g, t);

      // 2. Les mesas, la ville, le faisceau, les rayons du soleil, les éclairs.
      g.drawImage(this.back, wx0, 0);
      for (const l of this.cityLights) {
        const v = 0.5 + 0.5 * Math.sin(t * 1.7 + l.p);
        if (v > 0.25) continue;
        g.fillStyle = css(mix(l.c, this.hazeC, 0.7), 1);
        g.fillRect(l.x, l.y, 1, 1);
      }
      this.drawBeam(g, t);
      if (this.rays) {
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.75 + 0.2 * Math.sin(t * 0.21) + 0.05 * Math.sin(t * 0.73);
        g.drawImage(this.rays, wx0, 0);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
      }
      this.drawBolt(g);
      this.drawFlyers(g, t, 0.6);

      // 3. La vallée, l'épave, les ruines ; les îlots flottants, la brume.
      g.drawImage(this.mid, wx0, 0);
      const m = this.mist;
      const off = pmod(t * 1.2, m.w - (this.X1 - this.X0));
      g.globalAlpha = look.mist ? 0.55 : 0.32;
      g.drawImage(m.img, Math.round(wx0 - off), m.y);
      g.globalAlpha = 1;
      this.drawPanels(g, t);
      this.drawIsles(g, t);
      this.drawFlyers(g, t, 1.2);

      // 4. Le premier plan, l'exploratrice, son robot, sa moto.
      g.drawImage(this.fore, wx0, 0);
      this.drawBike(g, t);
      this.drawRobot(g, t);
      this.drawGirl(g, t);
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.8 + 0.12 * Math.sin(t * 1.1);
      g.drawImage(this.halo, wx0, 0);
      g.globalAlpha = 1;
      this.drawParticles(g, t);
      g.globalCompositeOperation = 'source-over';
      this.drawPetals(g, t);
      if (look.wet) this.drawPuddleRings(g, t);

      // Éclair : tout s'illumine un instant de violet.
      if (this.flash > 0) {
        const f = this.flash;
        const a = f > 0.44 ? 0.3 : f > 0.36 ? 0.05 : f > 0.12 ? 0.18 * ((f - 0.12) / 0.24) : 0;
        if (a > 0) {
          g.fillStyle = `rgba(190,160,255,${a.toFixed(3)})`;
          g.fillRect(wx0, 0, this.X1 - wx0, H);
        }
      }
    }

    drawMeteors(g) {
      for (const m of this.meteors) {
        const k = m.age / m.life;
        const x = m.x + m.dx * m.age;
        const y = m.y + m.dy * m.age;
        for (let i = 0; i < 12; i++) {
          g.fillStyle = `rgba(240,240,255,${((1 - i / 12) * (1 - k) * 0.95).toFixed(2)})`;
          g.fillRect(Math.round(x - (m.dx / 60) * i * 1.5), Math.round(y - (m.dy / 60) * i * 1.5), 1, 1);
        }
      }
    }

    drawShips(g) {
      const night = this.look.night;
      for (const s of this.ships) {
        for (const p of s.trail) {
          const a = (1 - p.age / 5) * 0.35;
          g.fillStyle = night ? `rgba(140,200,255,${a.toFixed(3)})` : `rgba(255,226,200,${a.toFixed(3)})`;
          g.fillRect(p.x, p.y, 1, 1);
        }
        const x = Math.round(s.x);
        const y = Math.round(s.y);
        if (x < this.X0 - 8 || x > this.X1 + 8) continue;
        g.fillStyle = night ? '#1a1e30' : '#2a1e34';
        if (s.big) {
          g.fillRect(x - 2, y, 5, 1);
          g.fillRect(x - 1, y - 1, 2, 1);
        } else g.fillRect(x - 1, y, 3, 1);
        g.fillStyle = '#9af4ff';
        g.fillRect(s.dir > 0 ? x - (s.big ? 3 : 2) : x + (s.big ? 3 : 2), y, 1, 1);
      }
    }

    // Reflet anamorphique : une fine ligne horizontale qui traverse le soleil.
    drawSunFlare(g, t) {
      const s = this.L.sun;
      const k = 0.85 + 0.15 * Math.sin(t * 0.5);
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = `rgba(255,190,120,${(0.08 * k).toFixed(3)})`;
      g.fillRect(s.x - 90, s.y, 180, 1);
      g.fillStyle = `rgba(255,220,170,${(0.12 * k).toFixed(3)})`;
      g.fillRect(s.x - 40, s.y, 80, 1);
      g.fillStyle = `rgba(255,240,210,${(0.18 * k).toFixed(3)})`;
      g.fillRect(s.x - 16, s.y, 32, 1);
      g.globalCompositeOperation = 'source-over';
    }

    // Le faisceau de l'ascenseur orbital, qui pulse ; parfois une capsule y monte.
    drawBeam(g, t) {
      const { look } = this;
      const x = this.L.beamX;
      const top = this.beamTop;
      const k = look.beam * (0.82 + 0.18 * Math.sin(t * 1.3));
      g.globalCompositeOperation = 'lighter';
      for (let y = 0; y < top; y += 2) {
        const f = (y / top) ** 0.6;
        const a = k * (0.25 + 0.75 * f);
        g.fillStyle = `rgba(150,240,255,${(a * 0.55).toFixed(3)})`;
        g.fillRect(x, y, 1, 2);
        g.fillStyle = `rgba(90,200,255,${(a * 0.14).toFixed(3)})`;
        g.fillRect(x - 1, y, 1, 2);
        g.fillRect(x + 1, y, 1, 2);
        g.fillStyle = `rgba(90,180,255,${(a * 0.05).toFixed(3)})`;
        g.fillRect(x - 3, y, 2, 2);
        g.fillRect(x + 2, y, 2, 2);
      }
      // Le pied du faisceau.
      g.fillStyle = `rgba(200,250,255,${(k * 0.5).toFixed(3)})`;
      g.fillRect(x - 1, top - 1, 3, 2);
      if (this.capsule) {
        g.fillStyle = `rgba(255,255,255,${(0.6 + 0.3 * k).toFixed(3)})`;
        g.fillRect(x, Math.round(this.capsule.y), 1, 2);
      }
      g.globalCompositeOperation = 'source-over';
    }

    drawBolt(g) {
      if (!this.bolt || this.flash <= 0.12 || (this.flash > 0.36 && this.flash < 0.44)) return;
      const pts = this.bolt;
      for (let pass = 0; pass < 2; pass++) {
        g.fillStyle = pass ? '#f4ecff' : 'rgba(170,120,255,0.5)';
        for (let k = 0; k + 1 < pts.length; k++) {
          const [x0, y0] = pts[k];
          const [x1, y1] = pts[k + 1];
          const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
          for (let j = 0; j <= n; j++) {
            const x = Math.round(x0 + ((x1 - x0) * j) / n);
            const y = Math.round(y0 + ((y1 - y0) * j) / n);
            if (pass) g.fillRect(x, y, 1, 1);
            else g.fillRect(x - 1, y, 3, 1);
          }
        }
      }
    }

    // Créatures volantes : corps fin, longues ailes qui battent lentement, longue queue.
    // band : on dessine les plus petites (loin) avant la vallée, les grandes après.
    drawFlyers(g, t, band) {
      g.fillStyle = this.flyC;
      for (const f of this.flyers) {
        if ((f.sc < 0.9 * this.S) !== band < 1) continue;
        const x = Math.round(f.x);
        const y = Math.round(f.y);
        const span = Math.round(7 * f.sc);
        const ph = Math.sin(f.t * 1.6 + f.ph);
        const glide = Math.sin(f.t * 0.3 + f.ph) > 0.3; // planés
        const tip = glide ? -1 : Math.round(ph * 3 * f.sc);
        for (let i = 1; i <= span; i++) {
          const k = i / span;
          const dy = Math.round(tip * k * k - (1 - k) * 0.5);
          g.fillRect(x - i, y + dy, 1, 1);
          g.fillRect(x + i, y + dy, 1, 1);
        }
        g.fillRect(x - 1, y, 3, 1);
        // Tête et queue (vers l'arrière du vol).
        g.fillRect(x + f.dir * 2, y - 1, 1, 1);
        for (let i = 1; i <= Math.round(4 * f.sc); i++) g.fillRect(x - f.dir * (1 + i), y + Math.round(Math.sin(f.t * 2 + i * 0.8) * 0.6 + i * 0.2), 1, 1);
      }
    }

    drawPanels(g, t) {
      const pc = C(this.look.panel);
      g.globalCompositeOperation = 'lighter';
      for (const p of this.panels) {
        const v = 0.5 + 0.5 * Math.sin(t * 1.1 + p.p);
        const a = this.look.panelK * p.k * (0.25 + 0.75 * v);
        g.fillStyle = css(pc, a);
        g.fillRect(p.x, p.y, p.w, p.h);
        g.fillStyle = css(pc, a * 0.18);
        g.fillRect(p.x - 2, p.y - 2, p.w + 4, p.h + 4);
      }
      g.globalCompositeOperation = 'source-over';
    }

    drawIsles(g, t) {
      const { look } = this;
      for (const s of this.isles) {
        const dy = Math.round(Math.sin(t * 0.35 + s.ph) * s.amp);
        g.drawImage(s.img, s.x, s.y + dy);
        const f = s.fall;
        if (!f) continue;
        if (f.ice) {
          g.drawImage(f.ice, f.x, f.y + dy);
          continue;
        }
        // La cascade : un ruban qui file vers le bas et se disperse en bruine.
        const water = look.night ? [150, 190, 230] : look.wet ? [190, 200, 215] : [235, 225, 235];
        for (let j = 0; j < f.len; j++) {
          const k = j / f.len;
          const spread = Math.floor(k * k * 4);
          const a = (1 - k) ** 1.4 * (1 - f.depth * 0.5);
          for (let i = -spread; i < f.wid + spread; i++) {
            const h = hash(f.x + i, Math.floor(j - t * 22), 9);
            if (h > 0.7 - k * 0.5 && !(i >= 0 && i < f.wid && j < f.len * 0.4)) continue;
            g.fillStyle = css(water, a * (0.45 + h * 0.5));
            g.fillRect(f.x + i + Math.round(k * 2), f.y + dy + j, 1, 1);
          }
        }
      }
    }

    drawBike(g, t) {
      const { L } = this;
      const S = this.S;
      const bx = Math.round(L.edgeX + 38 * S);
      const by0 = Math.round(this.foreTop(bx + 15) - this.bike.h - 4 * S);
      const by = by0 + Math.round(Math.sin(t * 1.1) * 1);
      // Lueur sous la moto (pulse), reflet sur la roche.
      g.globalCompositeOperation = 'lighter';
      const k = 0.7 + 0.3 * Math.sin(t * 2.3);
      const gy = by + this.bike.h - 1;
      const floor = by0 + this.bike.h + Math.round(4 * S);
      for (let yy = gy; yy <= floor; yy++) {
        const f = (yy - gy) / Math.max(1, floor - gy);
        g.fillStyle = `rgba(80,220,255,${(0.16 * k * (1 - f * 0.6)).toFixed(3)})`;
        g.fillRect(bx + 5 - Math.round(f * 2), yy, 6 + Math.round(f * 4), 1);
        g.fillRect(bx + 22 - Math.round(f * 2), yy, 8 + Math.round(f * 4), 1);
      }
      g.fillStyle = `rgba(80,220,255,${(0.2 * k).toFixed(3)})`;
      g.fillRect(bx + 2, floor, 30, 1);
      g.globalCompositeOperation = 'source-over';
      g.drawImage(this.bike.img, bx, by);
      this.bikePos = { x: bx, y: by };
    }

    drawRobot(g, t) {
      const b = this.bot;
      const c = this.botC;
      const S = this.S;
      const x = Math.round(this.L.edgeX + 24 * S);
      const ground = Math.round(this.foreTop(x + 3));
      const hopY = b.hop > 0 ? Math.round(Math.sin((b.hop / 0.5) * Math.PI) * 3) : 0;
      const y = ground - 9 - hopY;
      const P = (col, px, py, w = 1, h = 1) => {
        g.fillStyle = css(col);
        g.fillRect(x + px, y + py, w, h);
      };
      // Jambes (repliées pendant le saut).
      if (hopY) {
        P(c.dark, 1, 7, 2, 1);
        P(c.dark, 5, 7, 2, 1);
      } else {
        P(c.dark, 2, 7, 1, 2);
        P(c.dark, 5, 7, 1, 2);
        P(c.dark, 1, 8, 2, 1);
        P(c.dark, 5, 8, 2, 1);
      }
      // Corps arrondi.
      P(c.dark, 1, 1, 6, 1);
      P(c.dark, 0, 2, 8, 4);
      P(c.dark, 1, 6, 6, 1);
      P(c.body, 1, 2, 6, 4);
      P(c.shade, 1, 5, 6, 1);
      P(c.shade, 1, 2, 1, 4);
      P(c.rim, 7, 2, 1, 4);
      P(c.rim, 2, 1, 4, 1);
      // Antenne et sa petite lumière.
      P(c.dark, 4, -1, 1, 2);
      const on = Math.sin(b.t * 3) > 0.2;
      P(on ? [255, 150, 70] : [120, 60, 40], 4, -2, 1, 1);
      // L'œil rond (il regarde à gauche ou à droite, il cligne).
      const ex = b.look < 0 ? 2 : 4;
      if (b.blink > 0) P(c.dark, ex, 3, 2, 1);
      else {
        P(c.dark, ex, 2, 2, 3);
        P(c.eye, ex, 3, 2, 1);
        P([220, 255, 255], ex + (b.look < 0 ? 0 : 1), 3, 1, 1);
      }
      if (b.blink <= 0) {
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = 'rgba(90,240,255,0.18)';
        g.fillRect(x + ex - 1, y + 2, 4, 3);
        g.globalCompositeOperation = 'source-over';
      }
    }

    drawGirl(g, t) {
      const { L } = this;
      const gi = this.girl;
      const x = L.edgeX - gi.edge;
      const seatY = Math.round(this.foreTop(L.edgeX + 2));
      const y = seatY - gi.seatRow;
      const img = this.girlLook > 0 ? gi.look : gi.seat;
      g.drawImage(img, x, y);
      // L'écharpe : elle part du cou et flotte vers l'arrière (à droite), ondule au vent.
      const sc = this.scarfC;
      const n = Math.round(12 * this.S);
      const nx = x + 10;
      const ny = y + 7;
      const gust = 0.6 + 0.4 * Math.sin(t * 0.37);
      for (let i = 0; i < n; i++) {
        const k = i / n;
        const wave = Math.sin(t * 5 - i * 0.7) * (0.4 + k * 2.2) * gust;
        const px = nx + Math.round(i * (0.6 + 0.4 * gust));
        const py = ny + Math.round(k * (3 - 2 * gust) + wave);
        g.fillStyle = css(sc[1]);
        g.fillRect(px, py, 1, 1);
        if (i < n - 3) {
          g.fillStyle = css(Math.sin(t * 5 - i * 0.7) > 0 ? sc[2] : sc[0]);
          g.fillRect(px, py + 1, 1, 1);
        }
      }
      g.fillStyle = css(sc[1]);
      g.fillRect(nx - 4, ny, 5, 1);
      g.fillStyle = css(sc[0]);
      g.fillRect(nx - 4, ny + 1, 2, 1);
      // Reflet de la visière.
      if (this.girlLook <= 0) {
        const v = 0.5 + 0.5 * Math.sin(t * 0.8);
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = `rgba(255,170,80,${(0.2 + 0.25 * v).toFixed(3)})`;
        g.fillRect(x + 4, y + 3, 2, 3);
        g.globalCompositeOperation = 'source-over';
      }
    }

    drawParticles(g, t) {
      // Poussière dorée dans la lumière.
      for (const p of this.dust) {
        const a = 0.25 + 0.25 * Math.sin(t * 1.5 + p.p);
        g.fillStyle = `rgba(255,200,140,${a.toFixed(3)})`;
        g.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      }
      // Spores bioluminescentes.
      for (const s of this.spores) {
        const a = Math.max(0, Math.sin(t * 1.4 * s.s + s.p));
        if (a < 0.1) continue;
        const x = Math.round(s.x);
        const y = Math.round(s.y);
        const c = s.c ? [255, 140, 220] : [110, 255, 220];
        g.fillStyle = css(c, a * 0.22);
        g.fillRect(x - 1, y - 1, 3, 3);
        g.fillStyle = css(c, a);
        g.fillRect(x, y, 1, 1);
      }
    }

    drawPetals(g, t) {
      for (const p of this.petals) {
        g.fillStyle = p.c ? '#ffb0d8' : '#ff8ac4';
        const flip = Math.sin(t * 3 + p.p) > 0;
        g.fillRect(Math.round(p.x), Math.round(p.y), flip ? 1 : 2, 1);
      }
    }

    drawPuddleRings(g, t) {
      if (!this.puddles.length) return;
      g.fillStyle = 'rgba(210,220,240,0.5)';
      const n = Math.min(6, Math.floor(this.puddles.length / 40) + 2);
      for (let k = 0; k < n; k++) {
        const ph = t * 1.7 + k * 1.37;
        const i = Math.floor(hash(Math.floor(ph), k, 9) * this.puddles.length);
        const p = this.puddles[i];
        const a = ph - Math.floor(ph);
        const rr = 1 + Math.floor(a * 3);
        g.fillRect(p.x - rr, p.y, 1, 1);
        g.fillRect(p.x + rr, p.y, 1, 1);
      }
    }
  }

  B.PixelScenes.planete = Planete;
})();
