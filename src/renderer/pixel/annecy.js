// Brume — scène « Lac d'Annecy », en pixel art.
//
// Le point de vue des hauts d'Annecy, vers le nord-ouest : un grand ciel bleu chargé de
// gros cumulus, des collines bleutées à gauche, la vallée ouverte au centre et, à droite,
// une montagne qui monte franchement avec sa petite falaise claire près du sommet. Dessous,
// la ville étalée (toits, immeubles clairs, beaucoup de verdure), la longue rangée d'arbres
// du Pâquier, l'Impérial tout blanc et sa jetée ; puis le lac turquoise, ses voiliers et ses
// reflets ; au premier plan, de grands arbres sombres, le port et ses mâts, des toits
// d'immeubles (balcons orangés, toit plat technique) et un lampadaire.
// La vie : les nuages avancent, les voiliers dérivent et virent de bord, le bateau de
// croisière blanc traverse le lac de temps en temps, un paddle, des cygnes et des canards
// près du port, des parapentes qui tournent au-dessus de la montagne, des oiseaux, quelqu'un
// qui se promène sur le ponton, les lumières de la ville le soir qui se reflètent dans l'eau.
//
// Comme « Sur les toits » : le décor est peint une fois par ambiance en trois calques
// (fond : ciel et montagnes ; plan moyen : ville, rive et lac ; premier plan : arbres, port,
// immeubles), puis chaque image ne dessine que ce qui bouge.
(function () {
  'use strict';
  const B = window.Brume;
  const { Raster, hex, mix, rng, hash, noise, fbm, bayer } = B.PX;
  const X = B.PXC;
  const C = hex;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const lerp = (a, b, t) => a + (b - a) * t;
  const frac = (v) => v - Math.floor(v);

  /* ---------- Toile élargie (pour le travelling de l'animation d'ouverture) ----------
   * Même principe que « Sur les toits » : on peint toujours en coordonnées de la scène
   * (x de −extL à W + extR) ; la partie [0, W) est exactement le fond d'écran normal.
   * Tout le décor est une fonction de la position (bruit, hachage par case) : rien ne
   * dépend de l'ordre des tirages, si bien que le prolongement ne change pas l'écran. */
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

  // Éclairage peint (en coordonnées de la scène). extra : lampes du prolongement, qui
  // n'éclairent que hors de l'écran (et s'effacent en approchant du bord).
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
          if (dx > l.r * 6 || dx < -l.r * 6) continue;
          I += l.k / (1 + (dx * dx + dy * dy) / (l.r * l.r));
        }
        if (extra && extra.length && (x < 0 || x >= W)) {
          const d = x < 0 ? -x : x - W + 1;
          const f = clamp01(d / 28);
          const fs = f * f * (3 - 2 * f);
          for (const l of extra) {
            const dx = x - l.x;
            const dy = (y - l.y) * (l.sy || 1);
            if (dx > l.r * 6 || dx < -l.r * 6) continue;
            I += (fs * l.k) / (1 + (dx * dx + dy * dy) / (l.r * l.r));
          }
        }
        if (I < 0.02) {
          for (let c = 0; c < 3; c++) r.data[i + c] = Math.min(255, r.data[i + c] * ambient[c]);
          continue;
        }
        const q = Math.floor(Math.min(1.3, I) * 6 + bayer(x, y)) / 6;
        for (let c = 0; c < 3; c++) r.data[i + c] = Math.min(255, r.data[i + c] * (ambient[c] + warm[c] * q));
      }
    }
  }

  // Halos (à dessiner en mode « lighter »), sur toute la largeur du monde. extra : halos du
  // prolongement, peints seulement hors de l'écran.
  function makeHalo(W, H, extL, extR, halos, extra) {
    const r = new Wide(W, H, extL, extR);
    const all = halos.concat(extra || []);
    for (const h of all) {
      const isExtra = extra && extra.includes(h);
      const x0 = Math.max(r.x0, Math.floor(h.x - h.r));
      const x1 = Math.min(r.x1 - 1, Math.ceil(h.x + h.r));
      const y0 = Math.max(0, Math.floor(h.y - h.r));
      const y1 = Math.min(H - 1, Math.ceil(h.y + h.r));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (isExtra && x >= 0 && x < W) continue;
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
    // Les pixels trop faibles restent transparents.
    for (let i = 0; i < r.data.length; i += 4) if (r.data[i] + r.data[i + 1] + r.data[i + 2] <= 2) r.data[i + 3] = 0;
    return r.toCanvas();
  }

  // Profil d'un relief : interpolation de Catmull-Rom entre des points [u, y] (fractions
  // de W et de H), aplatie au-delà des extrémités.
  function profile(P, u) {
    const n = P.length;
    if (u <= P[0][0]) return P[0][1];
    if (u >= P[n - 1][0]) return P[n - 1][1];
    let i = 1;
    while (P[i][0] < u) i++;
    const p0 = P[Math.max(0, i - 2)][1];
    const p1 = P[i - 1][1];
    const p2 = P[i][1];
    const p3 = P[Math.min(n - 1, i + 1)][1];
    const t = (u - P[i - 1][0]) / (P[i][0] - P[i - 1][0]);
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }

  /* ================= Reliefs (fractions de W en x, de H en y) ================= */
  // La montagne de droite : elle monte franchement, petite falaise claire sous le sommet,
  // puis une longue crête qui continue hors du cadre.
  const MOUNT_R = [
    [0.66, 0.505], [0.7, 0.49], [0.73, 0.462], [0.76, 0.424], [0.79, 0.384], [0.82, 0.347], [0.845, 0.318],
    [0.865, 0.302], [0.885, 0.294], [0.91, 0.297], [0.95, 0.305], [1.0, 0.301], [1.06, 0.295], [1.14, 0.3], [1.22, 0.32], [1.3, 0.34],
  ];
  // Le Semnoz, à gauche du cadre (dans le prolongement) : un grand dos boisé.
  const MOUNT_L = [
    [-1.75, 0.4], [-1.55, 0.37], [-1.38, 0.33], [-1.2, 0.3], [-1.05, 0.286], [-0.92, 0.29], [-0.78, 0.31],
    [-0.62, 0.35], [-0.48, 0.4], [-0.36, 0.44], [-0.24, 0.47], [-0.14, 0.49],
  ];
  // La crête boisée, plus proche, sous la montagne de droite.
  const RIDGE = [[0.7, 0.505], [0.76, 0.49], [0.81, 0.474], [0.86, 0.458], [0.92, 0.446], [1.0, 0.434], [1.1, 0.425], [1.3, 0.43]];
  // Collines vertes de gauche (plus proches que les lointaines).
  const HILL = [
    [-1.75, 0.47], [-1.4, 0.47], [-1.1, 0.462], [-0.8, 0.468], [-0.5, 0.472], [-0.28, 0.465], [-0.12, 0.458], [0.0, 0.452],
    [0.06, 0.446], [0.12, 0.443], [0.18, 0.44], [0.22, 0.442], [0.27, 0.455], [0.32, 0.474], [0.38, 0.486], [0.5, 0.49], [1.3, 0.49],
  ];
  // La rive du lac (bord haut de l'eau).
  const SHORE = [
    [-1.75, 0.63], [-1.2, 0.632], [-0.7, 0.63], [-0.3, 0.628], [0.0, 0.628], [0.3, 0.627], [0.5, 0.625], [0.58, 0.622],
    [0.66, 0.619], [0.76, 0.616], [0.86, 0.613], [1.3, 0.61],
  ];

  /* ================= Ambiances selon la météo ================= */
  // sky : dégradé du zénith à l'horizon ; cloud : 6 tons (base ombrée → haut éclatant) ;
  // haze : brume des lointains ; lake : 5 tons de l'eau (loin → près) ;
  // leaf : tons des feuillages ; amb / desat : étalonnage du décor ; lights : part des
  // fenêtres allumées (le soir).
  const GREEN = ['#0b1912', '#122619', '#1b3622', '#27492b', '#365c34', '#4c7440', '#6a8e50'];
  const CHERRY = ['#3e2032', '#6a3650', '#9a5072', '#c86e92', '#e494b2', '#f4bccf', '#ffe2ec'];
  const FRESH = ['#0e2214', '#173620', '#244e28', '#346a32', '#4c863c', '#6ca44c', '#96c266'];
  const AUT = [
    ['#2a1608', '#4a2410', '#763614', '#a2501c', '#cc7228', '#e89a3c', '#f6c45a'],
    ['#220c0a', '#3e1612', '#682018', '#922e1e', '#bc4628', '#d86c38', '#eca05a'],
    ['#262010', '#463a14', '#74601e', '#a28626', '#caa832', '#e2c44a', '#f2e07a'],
    ['#14200e', '#223416', '#344c1e', '#4a6426', '#667c2e', '#88943a', '#aaa850'],
  ];
  const LOOKS = {
    none: {
      sky: ['#1b56a6', '#2160ae', '#2a6bb6', '#3476be', '#4081c4', '#4e8cca', '#6098d0', '#76a6d6', '#8eb6dc', '#a8c6e2'],
      cloud: ['#56688a', '#7f90aa', '#adb9ca', '#dbe1e9', '#f3f5f7', '#fffaf0'],
      clouds: 'cumulus', haze: '#a8bfd4', hazeK: 1,
      far: '#86a2bc', hill: ['#4e6e6a', '#5e7e76', '#749486'],
      mount: ['#183024', '#21402e', '#2e553a', '#416c46', '#5e8656'], rock: '#e2e0d6',
      lake: ['#b0d2da', '#9cc8d2', '#88bccb', '#74aec2', '#64a0b6'], ripple: ['#dcf0f2', '#5c94ac'],
      leaf: [GREEN], amb: [1, 1, 1], desat: 0,
      glitter: 0.7, sails: 8, steamer: true, para: 3, birds: true, swans: true, paddle: true, motor: true, lights: 0, walkers: true,
    },
    sakura: {
      sky: ['#3a7cc6', '#4486cc', '#5090d0', '#5e9ad4', '#6ea4d8', '#80aedc', '#94badf', '#aac6e2', '#c2d4e6', '#dae2ea'],
      cloud: ['#8a8aa8', '#a6a4bc', '#c4c0d2', '#e0dae6', '#f6f0f4', '#ffffff'],
      clouds: 'cumulus', haze: '#c4cede', hazeK: 1,
      far: '#9cb0c8', hill: ['#56786a', '#68887a', '#80a088'],
      mount: ['#1c3628', '#264834', '#365e40', '#4a784c', '#6a945e'], rock: '#e6e4dc',
      lake: ['#bcdee2', '#a2d4da', '#88c6d0', '#70b8c6', '#5eaabc'], ripple: ['#e6f6f6', '#5a9cb0'],
      leaf: [FRESH, FRESH, CHERRY], amb: [1.04, 1.02, 1.04], desat: 0, cherry: true,
      glitter: 0.7, sails: 7, steamer: true, para: 3, birds: true, swans: true, paddle: true, motor: true, lights: 0, walkers: true,
    },
    leaves: {
      sky: ['#2c5a9c', '#3462a2', '#406ca8', '#5078ac', '#6484ae', '#7c90ae', '#989cac', '#b8aaa6', '#d6b8a0', '#ecc89c'],
      cloud: ['#6a6478', '#8a7e8a', '#b09c98', '#d8bca6', '#f2d8b8', '#fff0d4'],
      clouds: 'cumulus', haze: '#d2bca4', hazeK: 1, warmLight: true,
      far: '#9c9cac', hill: ['#5c6a56', '#6e7a5e', '#8a8c66'],
      mount: ['#3a3e2e', '#4e4e34', '#685e3a', '#86743e', '#a89052'], rock: '#e0d4bc',
      lake: ['#d2d0c0', '#b4c6c2', '#98b8bc', '#80a8b2', '#6c98a8'], ripple: ['#fff0d0', '#587c90'],
      leaf: AUT, amb: [1.04, 0.98, 0.9], desat: 0, autumn: true,
      glitter: 0.9, sails: 5, steamer: true, para: 2, birds: true, swans: true, paddle: false, motor: true, lights: 0.08, walkers: true,
    },
    snow: {
      sky: ['#7a8698', '#808c9e', '#8794a4', '#8e9aaa', '#96a2b0', '#9eaab6', '#a8b2bc', '#b2bac2', '#bcc2c8', '#c6cace'],
      cloud: ['#6e7888', '#7c8696', '#8c96a4', '#9ea6b2', '#b2b8c2', '#c8ccd2'],
      clouds: 'overcast', haze: '#b4bcc6', hazeK: 1.2,
      far: '#a4aebc', hill: ['#8a96a2', '#9aa4ae', '#b0b8c0'],
      mount: ['#4a5460', '#5c6670', '#707a84', '#8a929a', '#a8aeb4'], rock: '#e8ecf0',
      lake: ['#a4b2bc', '#90a2ae', '#7e94a2', '#6e8696', '#62798a'], ripple: ['#c8d4dc', '#566a7a'],
      leaf: [['#16201c', '#1e2a24', '#28362e', '#34443a', '#425246', '#56645a', '#6c786e']], amb: [0.94, 0.96, 1.02], desat: 0.35, snow: true,
      glitter: 0, sails: 1, steamer: true, para: 1, birds: true, swans: true, paddle: false, motor: false, lights: 0.35, smoke: true, walkers: true,
    },
    rain: {
      sky: ['#3c4654', '#414b59', '#46505e', '#4c5664', '#535c6a', '#5a6370', '#626a76', '#6a727c', '#737a83', '#7c828a'],
      cloud: ['#2e3642', '#38404c', '#444c58', '#525a66', '#626a74', '#737a84'],
      clouds: 'overcast', haze: '#6e7682', hazeK: 1.1, mist: true,
      far: '#5e6876', hill: ['#38483e', '#425246', '#4e5e52'],
      mount: ['#26342c', '#2e3e34', '#3a4a3e', '#48584a', '#5a6a5a'], rock: '#8a9090',
      lake: ['#7a8a90', '#6a7e86', '#5c727c', '#506872', '#465e68'], ripple: ['#9aaab0', '#3a4e58'],
      leaf: [['#0a140e', '#101c14', '#18281c', '#203424', '#2c422e', '#3a5238', '#4a6244']], amb: [0.72, 0.76, 0.84], desat: 0.3, wet: true,
      glitter: 0, sails: 1, steamer: true, para: 0, birds: false, swans: true, paddle: false, motor: false, lights: 0.4, rings: 1, walkers: true, umbrella: true,
    },
    storm: {
      sky: ['#1e242e', '#222832', '#262c36', '#2a303a', '#30363f', '#363c45', '#3c424a', '#444950', '#4c5056', '#54585c'],
      cloud: ['#14181e', '#1c2128', '#262c34', '#323842', '#424852', '#585e66'],
      clouds: 'overcast', haze: '#4a5058', hazeK: 1.2, mist: true,
      far: '#3e4652', hill: ['#26322a', '#2e3a30', '#384438'],
      mount: ['#1a2420', '#222c26', '#2a352e', '#344036', '#424e42'], rock: '#686e70',
      lake: ['#566268', '#4a585e', '#3e4e56', '#36464e', '#2e3e46'], ripple: ['#8a989e', '#24323a'],
      leaf: [['#070e0a', '#0c160f', '#122016', '#1a2a1c', '#223424', '#2c3e2c', '#384a36']], amb: [0.56, 0.6, 0.7], desat: 0.4, wet: true, storm: true,
      glitter: 0, sails: 0, steamer: false, para: 0, birds: false, swans: true, paddle: false, motor: false, lights: 0.5, rings: 2, caps: true, walkers: false,
    },
    fireflies: {
      sky: ['#070b22', '#0a0f2a', '#0d1332', '#11183a', '#151d42', '#1a234a', '#202a52', '#283258', '#323a5e', '#3e4462'],
      cloud: ['#0c1028', '#121834', '#1a2040', '#242a4e', '#343a5e', '#4c5274'],
      clouds: 'night', haze: '#2c3456', hazeK: 0.8, night: true, moon: { u: 0.58, y: 0.12 }, stars: 70,
      far: '#1e2848', hill: ['#121c2a', '#16212e', '#1c2834'],
      mount: ['#0c1420', '#101a26', '#16202c', '#1c2834', '#26323e'], rock: '#4a5262',
      lake: ['#1a2a4a', '#162544', '#12203c', '#0f1c36', '#0c1830'], ripple: ['#3a4c72', '#0a1228'],
      leaf: [GREEN], amb: [0.3, 0.34, 0.52], desat: 0.25, fireworks: true,
      glitter: 0, sails: 2, steamer: true, para: 0, birds: false, swans: false, paddle: false, motor: false, lights: 0.62, fireflies: true, walkers: true,
    },
    starfall: {
      sky: ['#03041a', '#05071e', '#070a24', '#0a0e2a', '#0d1230', '#111636', '#151b3c', '#1b2142', '#222848', '#2a2e4c'],
      cloud: ['#06081a', '#0a0e22', '#10142a', '#181c34', '#22263e', '#30344c'],
      clouds: 'none', haze: '#1c2240', hazeK: 0.7, night: true, stars: 260, milky: true,
      far: '#141a34', hill: ['#0c1220', '#101624', '#141a2a'],
      mount: ['#080e18', '#0b121c', '#0f1622', '#141c28', '#1c2430'], rock: '#3a4050',
      lake: ['#121c38', '#0f1832', '#0c142c', '#0a1226', '#080f20'], ripple: ['#2e3a62', '#060a1a'],
      leaf: [GREEN], amb: [0.24, 0.28, 0.44], desat: 0.3, meteors: true, fireworks: true,
      glitter: 0, sails: 0, steamer: false, para: 0, birds: false, swans: false, paddle: false, motor: false, lights: 0.36, walkers: false,
    },
  };

  // Couleurs des feux d'artifice : or, rouge, vert, bleu, blanc scintillant, violet, orange.
  const FW_COLORS = [[255, 214, 110], [255, 84, 72], [96, 255, 136], [96, 170, 255], [255, 255, 255], [214, 124, 255], [255, 156, 64]];

  // Murs et toits de la ville (le jour) : enduits clairs, toits gris d'ardoise ou de tôle,
  // tuiles brunes, quelques toits rouges savoyards.
  const WALLS = ['#eeeae2', '#e6dccb', '#f2efe8', '#d8cdb8', '#e8d8c0', '#d6d4ce', '#f0e4d2', '#c9c2b4'];
  const ROOFS = ['#6a6460', '#7a5a4c', '#5a5c62', '#8c5a44', '#9a6a4e', '#4e5258', '#a0563e', '#74706a'];

  /* ================= La scène ================= */
  class Annecy {
    constructor(W, H, opts = {}) {
      this.W = W;
      this.H = H;
      // Monde élargi (animation d'ouverture) : le lac, la vieille ville et le Semnoz à
      // gauche ; la montagne et les grands arbres continuent à droite.
      const ext = opts.ext || {};
      this.extL = Math.max(0, Math.round(ext.left || 0));
      this.extR = Math.max(0, Math.round(ext.right || 0));
      this.wide = this.extL + this.extR > 0;
      this.X0 = -this.extL;
      this.X1 = W + this.extR;
      const L = (this.L = {});
      L.hz = Math.round(H * 0.47);
      L.cityTop = Math.round(H * 0.484);
      L.rowTop = Math.round(H * 0.566); // haut de la rangée d'arbres du Pâquier
      L.rowEnd = Math.round(W * 0.525);
      L.lakeTop = Math.floor(H * 0.6);
      L.lakeBot = Math.round(H * 0.9);
      L.pierY = Math.round(H * 0.812);
      L.pierX0 = Math.round(W * 0.368);
      L.pierX1 = Math.round(W * 0.488);
      L.lampX = Math.round(W * 0.432);
      this.fast = X.fastTest();
      this.t = 0;
      this.effect = null;
      this.build('none');
    }

    /* ---------- Reliefs, en pixels ---------- */
    u(x) {
      return x / this.W;
    }
    mountY(x) {
      const u = x / this.W;
      const H = this.H;
      let y = H;
      if (u > 0.64) y = H * profile(MOUNT_R, u);
      else if (u < -0.12) y = H * profile(MOUNT_L, u);
      if (y >= H) return H;
      return y + (fbm(x * 0.07, 0.5, 9, 3) - 0.5) * 3 + (noise(x * 0.3, 2.5, 4) - 0.5) * 0.8;
    }
    ridgeY(x) {
      const u = x / this.W;
      if (u < 0.69) return this.H;
      return this.H * profile(RIDGE, u) + (fbm(x * 0.12, 3.5, 21, 3) - 0.5) * 3;
    }
    hillY(x) {
      return this.H * profile(HILL, x / this.W) + (fbm(x * 0.06, 7.5, 31, 3) - 0.5) * 2.4;
    }
    farY(x) {
      const H = this.H;
      const u = x / this.W;
      // Lointaines collines bleues : plus hautes à gauche, basses au fond de la vallée.
      const left = clamp01((0.34 - u) / 0.3);
      return H * (0.476 - 0.036 * left * left) + (fbm(x * 0.035, 9.5, 41, 3) - 0.5) * 4;
    }
    shoreY(x) {
      return Math.round(this.H * profile(SHORE, x / this.W));
    }
    // Sol du premier plan (bord proche du lac) : la berge de gauche, le port, les arbres.
    groundY(x) {
      const { W, H } = this;
      const u = x / W;
      let f;
      if (u < -0.02) f = 0.722 + (noise(x * 0.02, 1.5, 51) - 0.5) * 0.02;
      else if (u < 0.335) f = 0.718;
      else if (u < 0.362) f = lerp(0.718, 0.838, (u - 0.335) / 0.027);
      else if (u < 0.5) f = 0.838;
      else if (u < 0.52) f = lerp(0.838, 0.8, (u - 0.5) / 0.02);
      else f = 0.8;
      return Math.round(H * f);
    }

    /* ---------- Construction des calques ---------- */
    build(effect) {
      this.effect = effect;
      const look = (this.look = LOOKS[effect] || LOOKS.none);
      const amb = look.amb;
      const d = look.desat || 0;
      this.grade = (h) => {
        const c = typeof h === 'string' ? C(h) : h;
        const l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
        return [Math.min(255, (c[0] + (l - c[0]) * d) * amb[0]), Math.min(255, (c[1] + (l - c[1]) * d) * amb[1]), Math.min(255, (c[2] + (l - c[2]) * d) * amb[2])];
      };
      this.haze = C(look.haze);
      this.lamps = [];
      this.extLamps = [];
      this.cityLights = [];
      this.shoreLights = [];
      this.extShore = [];
      this.moon = null;
      this.lampHead = null;
      this.twinkles = [];
      this.chimneys = [];
      this.windows = [];
      this.back = this.paintBack().toCanvas();
      this.drift = this.makeDrift();
      const mid = this.paintMid();
      this.mid = mid.toCanvas();
      this.makeWater(mid);
      this.fore = this.paintFore().toCanvas();
      this.halo = this.paintHalo();
      this.makeSprites();
      if (!this.fwGlow) this.makeFireworks();
      this.resetLife();
    }

    /* ================= Fond : ciel, nuages, montagnes ================= */
    paintBack() {
      const { W, H, L, look } = this;
      const r = new Wide(W, H, this.extL, this.extR);
      const sky = look.sky.map(C);
      r.gradient(r.x0, 0, r.sw, L.hz + 6, sky, 8);
      r.rect(r.x0, L.hz + 6, r.sw, H - L.hz - 6, sky[sky.length - 1]);
      this.paintStars(r);
      if (look.moon) this.paintMoon(r);
      this.paintClouds(r);

      // Lointaines collines bleues, la vallée.
      const far = this.grade(look.far);
      const farTop = mix(far, this.haze, 0.45);
      for (let x = r.x0; x < r.x1; x++) {
        const top = Math.round(this.farY(x));
        for (let y = top; y < H; y++) {
          const d = y - top;
          let c = d === 0 ? farTop : far;
          if (d > 0 && fbm(x * 0.09, y * 0.2, 43, 2) > 0.6) c = mix(far, this.haze, 0.25);
          if (look.snow && d < 3 + noise(x * 0.1, 1, 44) * 3) c = mix(C('#e8ecf0'), far, 0.25);
          r.set(x, y, c);
        }
      }
      // Les deux montagnes (celle de droite, et le Semnoz dans le prolongement).
      this.paintMountain(r);
      if (look.mist) this.paintMist(r, Math.round(H * 0.29), 0.4);
      // Collines vertes de gauche et crête boisée de droite.
      this.paintSlope(r, (x) => this.hillY(x), look.hill.map((h) => this.grade(h)), 61, 0.18);
      this.paintSlope(r, (x) => this.ridgeY(x), look.mount.slice(0, 3).map((h) => mix(this.grade(h), this.haze, 0.06)), 71, 0.06, 0.12);
      return r;
    }

    paintStars(r) {
      const { W, L, look } = this;
      if (!look.stars) return;
      if (look.milky) {
        for (let y = 0; y < L.hz - 6; y++) {
          for (let x = r.x0; x < r.x1; x++) {
            const dd = Math.abs(y - 4 - (x - W * 0.1) * 0.28);
            const band = 1 - dd / 36;
            if (band <= 0) continue;
            const v = band * fbm(x * 0.05, y * 0.07, 3);
            if (bayer(x, y) < (v - 0.2) * 1.6) r.tint(x, y, [110, 120, 190], 0.22);
            if (hash(x, y, 4) < v * 0.05) r.set(x, y, [210, 214, 245]);
          }
        }
      }
      const STAR = [[240, 236, 255], [255, 232, 220], [210, 220, 255]];
      // Les étoiles sont tirées par case (hachage) : celles du prolongement n'influencent pas
      // celles de l'écran.
      const cell = 12;
      const per = (look.stars * cell * cell) / (W * L.hz);
      for (let cx = Math.floor(r.x0 / cell); cx * cell < r.x1; cx++) {
        for (let cy = 0; cy * cell < L.hz - 4; cy++) {
          for (let k = 0; k < 3; k++) {
            if (hash(cx, cy * 3 + k, 5) > per) continue;
            const x = cx * cell + Math.floor(hash(cx, cy * 3 + k, 6) * cell);
            const y = cy * cell + Math.floor(hash(cx, cy * 3 + k, 7) * cell);
            if (y >= L.hz - 4) continue;
            const c = STAR[Math.floor(hash(cx, cy, 8 + k) * 3)];
            const b = (0.35 + hash(x, y, 9) * 0.6) * (1 - (y / L.hz) * 0.6);
            r.tint(x, y, c, b);
            if (hash(x, y, 10) < 0.22) this.twinkles.push({ x, y, c, p: hash(x, y, 11) * 6, s: 1 + hash(x, y, 12) * 2.5 });
          }
        }
      }
    }

    paintMoon(r) {
      const { W, H, look } = this;
      const mx = Math.round(W * look.moon.u);
      const my = Math.round(H * look.moon.y);
      this.moon = { x: mx, y: my };
      for (let y = -6; y <= 6; y++) {
        for (let x = -6; x <= 6; x++) {
          const dd = Math.hypot(x, y);
          if (dd > 5.6) continue;
          let c = C('#f6f0e2');
          if (dd > 4.8) c = C('#d8d0c0');
          else if (noise((x + 9) * 0.5, (y + 9) * 0.5, 13) > 0.62) c = C('#e2dac8');
          r.set(mx + x, my + y, c);
        }
      }
    }

    /* ---------- Nuages ---------- */
    paintClouds(r) {
      const { W, H, L, look } = this;
      const tones = look.cloud.map(C);
      if (look.clouds === 'cumulus') {
        // Peu de nuages, bien séparés : un ou deux gros cumulus bourgeonnants, quelques
        // petits, et une fine rangée basse au-dessus des collines (perspective : plus petits
        // et plus serrés près de l'horizon). Chaque nuage du prolongement est peint tout
        // entier hors de l'écran (r.only).
        const hz = tones.map((c) => mix(c, this.haze, 0.32));
        const put = (b, tn) => {
          const cw = Math.round(W * b.w);
          const ch = Math.round(H * b.h);
          const x0 = Math.round(W * b.u - cw / 2);
          const paint = () => this.paintCumulus(r, cumulus(cw, ch, b.s, b.kind), x0, Math.round(H * b.b - ch), tn);
          if (x0 + cw < -1 || x0 > W) r.only(paint);
          else paint();
        };
        // La rangée de l'horizon, par cases calées sur le monde.
        const cw0 = 0.085;
        for (let k = Math.floor(r.x0 / W / cw0) - 1; k * cw0 * W < r.x1 + W * 0.1; k++) {
          if (hash(k, 1, 36) < 0.3) continue;
          const b = { u: (k + hash(k, 2, 36) * 0.6) * cw0, b: 0.452 + hash(k, 3, 36) * 0.012, w: 0.06 + hash(k, 4, 36) * 0.06, h: 0.03 + hash(k, 5, 36) * 0.022, s: 400 + k, kind: 'flat' };
          const x0 = W * b.u - (W * b.w) / 2;
          // Pas de nuage à cheval sur le bord de l'écran dans le prolongement.
          if (x0 < 0 && x0 + W * b.w > 0 && k < 0) continue;
          put(b, hz);
        }
        const banks = [
          { u: 0.6, b: 0.375, w: 0.13, h: 0.07, s: 23, kind: 'flat' },
          { u: 0.36, b: 0.11, w: 0.09, h: 0.05, s: 19 },
          { u: 0.5, b: 0.215, w: 0.15, h: 0.085, s: 22 },
          { u: 0.16, b: 0.33, w: 0.3, h: 0.24, s: 21, kind: 'tower' },
          { u: 0.8, b: 0.25, w: 0.3, h: 0.22, s: 24, kind: 'tower' },
        ];
        if (this.wide) {
          const RX = rng(501);
          for (let u = -0.3; u > r.x0 / W - 0.2; u -= 0.38 + RX() * 0.2) {
            if (RX() < 0.55) banks.push({ u, b: 0.3 + RX() * 0.05, w: 0.24 + RX() * 0.1, h: 0.2 + RX() * 0.06, s: 700 + Math.round(-u * 10), kind: 'tower' });
            else banks.push({ u, b: 0.2 + RX() * 0.15, w: 0.1 + RX() * 0.06, h: 0.06 + RX() * 0.03, s: 760 + Math.round(-u * 10) });
          }
          banks.push({ u: 1.15, b: 0.22, w: 0.12, h: 0.07, s: 790 });
        }
        for (const b of banks) put(b, tones);
      } else if (look.clouds === 'overcast') {
        // Un plafond continu, puis des bourrelets plus sombres qui pendent dessous.
        for (let y = 0; y < L.hz + 2; y++) {
          for (let x = r.x0; x < r.x1; x++) {
            const n = fbm(x * 0.014, y * 0.06, 33) - (y / L.hz) * 0.25;
            if (n > 0.28) r.set(x, y, tones[n > 0.5 ? 4 : n > 0.4 ? 3 : 2]);
            else if (n > 0.2 && bayer(x, y) < (n - 0.2) * 10) r.set(x, y, tones[2]);
          }
        }
        for (let k = Math.floor((r.x0 - W * 0.3) / (W * 0.16)); k * W * 0.16 < r.x1 + W * 0.2; k++) {
          const cw = Math.round(W * (0.26 + hash(k, 1, 34) * 0.2));
          const ch = Math.round(H * (0.09 + hash(k, 2, 34) * 0.06));
          const yb = Math.round(H * (0.18 + (((k % 3) + 3) % 3) * 0.09 + hash(k, 3, 34) * 0.04));
          const x0 = Math.round(k * W * 0.16 - cw * 0.5);
          const paint = () => this.paintCumulus(r, cumulus(cw, ch, 140 + k), x0, yb - ch, tones.map((c, i) => tones[Math.max(0, i - 1)]));
          if (x0 + cw < -2 || x0 > W + 2) r.only(paint);
          else paint();
        }
      } else if (look.clouds === 'night') {
        // Nuit d'été : quelques nuages sombres, liserés de lune.
        for (let k = Math.floor((r.x0 - W * 0.3) / (W * 0.3)); k * W * 0.3 < r.x1 + W * 0.3; k++) {
          if (hash(k, 9, 35) < 0.35) continue;
          const cw = Math.round(W * (0.16 + hash(k, 1, 35) * 0.16));
          const ch = Math.round(H * (0.05 + hash(k, 2, 35) * 0.05));
          const yb = Math.round(H * (0.26 + hash(k, 3, 35) * 0.16));
          const x0 = Math.round(k * W * 0.3 + hash(k, 4, 35) * W * 0.12);
          const paint = () => this.paintCumulus(r, cumulus(cw, ch, 160 + k), x0, yb - ch, tones);
          if (x0 + cw < -2 || x0 > W + 2) r.only(paint);
          else paint();
        }
      }
    }

    // Peint un cumulus en aplats propres (pixel art) : sommets éclairés d'un blanc chaud,
    // bourgeons modelés par le haut (soleil haut, à gauche), trait d'ombre entre deux
    // bourgeons, dessous gris-bleu, base plate nettement plus sombre. La trame n'apparaît
    // que dans les transitions entre deux tons.
    paintCumulus(r, cl, ox, oy, tones) {
      const { w, h, D, O, P, base } = cl;
      const night = this.look.night;
      const side = night || this.look.warmLight ? 1 : -1; // côté d'où vient la lumière
      const dTop = new Int16Array(w * h);
      for (let x = 0; x < w; x++) {
        let run = 0;
        for (let y = 0; y < h; y++) {
          run = D[y * w + x] > 0 ? run + 1 : 0;
          dTop[y * w + x] = run;
        }
      }
      const own = (x, y) => (x < 0 || y < 0 || x >= w || y >= h || D[y * w + x] <= 0 ? -1 : O[y * w + x]);
      const n = tones.length - 1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (D[y * w + x] <= 0) continue;
          const X0 = x + ox;
          const Y0 = y + oy;
          const k = O[y * w + x];
          const p = P[k];
          const nx = (x - p.x) / p.rx;
          const ny = (y - p.y) / p.ry;
          const top = Math.exp(-dTop[y * w + x] / Math.max(3, h * 0.16));
          let v = 0.22 + 0.45 * top + 0.5 * clamp01(0.5 - ny * 0.55 - nx * side * 0.24);
          // Le dessous s'assombrit franchement vers la base plate.
          const bb = clamp01((y - (base - h * 0.36)) / (h * 0.36));
          v *= 1 - 0.78 * bb;
          // Trait d'ombre sous un bourgeon posé devant (son voisin du dessus).
          const up = own(x, y - 1);
          if (up >= 0 && up !== k && !P[up].col && !p.col && P[up].y < p.y && P[up].ry > 2.5 && y < base - h * 0.4) v -= 0.22;
          const q = clamp01(v) * (n + 0.6);
          let i = Math.floor(q);
          const f = q - i;
          if (f > 0.72 && bayer(X0, Y0) < (f - 0.72) / 0.28) i++;
          i = Math.max(0, Math.min(n, i));
          if (y >= base - 1) i = 0;
          else if (y >= base - 3) i = Math.min(i, 1);
          r.set(X0, Y0, tones[i]);
        }
      }
    }

    // Brume basse (pluie) : des bancs qui avalent le haut des montagnes.
    paintMist(r, y0, k) {
      const { H } = this;
      const c = mix(C(this.look.cloud[3]), this.haze, 0.3);
      for (let y = y0; y < y0 + Math.round(H * 0.12); y++) {
        for (let x = r.x0; x < r.x1; x++) {
          const fall = 1 - Math.abs(y - y0 - H * 0.05) / (H * 0.07);
          const n = fbm(x * 0.02, y * 0.1, 91) * fall;
          if (n > 0.28) r.tint(x, y, c, bayer(x, y) < (n - 0.28) * 5 ? 0.85 : k);
        }
      }
    }

    // Montagnes : forêt sombre, ravines en lumière rasante (soleil à gauche), prairies
    // d'altitude, falaise calcaire claire sous le sommet de droite. L'hiver : neige.
    paintMountain(r) {
      const { W, H, look } = this;
      const tones = look.mount.map((h) => this.grade(h));
      const rock = this.grade(look.rock);
      const snow = [C('#f2f4f6'), C('#d6dce4'), C('#b4bcc8')];
      // Contreforts et ravines qui descendent la pente (vers le bas à gauche), et un grain plus fin.
      const relief = (x, y) => fbm((x + y * 0.8) * 0.07, (y - x * 0.25) * 0.02, 17, 3) + fbm(x * 0.14, y * 0.14, 19, 2) * 0.2;
      for (let x = r.x0; x < r.x1; x++) {
        const top = Math.round(this.mountY(x));
        if (top >= H - 1) continue;
        const u = x / W;
        const bot = Math.round(H * 0.56);
        for (let y = top; y < bot; y++) {
          const d = y - top;
          const sl = relief(x + 1.5, y) - relief(x - 1.5, y);
          let i = 2;
          if (sl < -0.04 || (sl < -0.016 && bayer(x, y) < 0.5)) i = 3;
          else if (sl > 0.05) i = 0;
          else if (sl > 0.02 || (sl > 0.008 && bayer(x, y) < 0.5)) i = 1;
          if (hash(x, y, 23) > 0.93) i = Math.max(0, i - 1); // les arbres
          let c = tones[i];
          // Prairies d'alpage, près des crêtes.
          const meadow = fbm(x * 0.05, y * 0.11, 27, 3);
          const mt = 0.61 - d * 0.004;
          if (d < 26 && (meadow > mt + 0.025 || (meadow > mt && bayer(x, y) < 0.5))) c = i >= 3 ? tones[4] : tones[3];
          // La falaise claire, sous le sommet de droite.
          // Une vraie paroi : bandeau calcaire sous le sommet, fissures verticales, vire
          // horizontale, ombre franche au pied et un peu d'éboulis.
          const cu = (u - 0.872) / 0.024;
          const ch = Math.round(1 + 6 * Math.sqrt(Math.max(0, 1 - cu * cu)) + (noise(x * 0.5, 4, 28) - 0.5) * 3);
          let isRock = false;
          if (Math.abs(cu) < 1 && d >= 2 && d <= 2 + ch) {
            isRock = true;
            const col = hash(x, 0, 28);
            c = mix(rock, tones[2], 0.12);
            if (col > 0.72) c = mix(rock, tones[1], 0.3);
            if (col > 0.9 && d > 3) c = mix(rock, tones[0], 0.6);
            if (d === 2) c = mix(rock, [255, 255, 255], 0.35);
            else if (d === 2 + Math.round(ch / 2) && col < 0.6) c = mix(rock, tones[1], 0.45);
            if (d === 2 + ch) c = tones[0];
            if (d > 3 && d < 2 + ch && noise(x * 0.6, y * 0.6, 31) > 0.68) c = tones[3]; // touffes sur les vires
          } else if (Math.abs(cu) < 0.9 && d > 2 + ch && d <= 4 + ch && hash(x, y, 29) > 0.55) c = mix(rock, tones[2], 0.5);
          // Neige : tout blanc là-haut, piqué de sapins sombres.
          if (look.snow) {
            const sn = d < 30 + noise(x * 0.05, 3, 29) * 30;
            if (sn) c = hash(x, y, 30) > 0.94 || sl > 0.035 || (sl > 0.02 && bayer(x, y) < 0.5) ? mix(tones[1], snow[2], 0.3) : snow[sl < 0 ? 0 : 1];
          }
          // Liseré lumineux de la crête, brume des lointains vers le haut.
          if (d === 0) c = mix(c, this.haze, 0.4);
          const hz = clamp01((isRock ? 0.05 : 0.17) - d * 0.004) * (look.hazeK || 1);
          if (hz > 0) c = mix(c, this.haze, hz);
          r.set(x, y, c);
        }
      }
      // L'antenne du Crêt de Châtillon, sur le Semnoz (prolongement).
      if (this.wide) {
        r.only(() => {
          const ax = Math.round(-0.98 * W);
          if (ax < r.x0 + 4) return;
          const top = Math.round(this.mountY(ax));
          const c = mix(tones[0], this.haze, 0.3);
          r.rect(ax, top - 7, 1, 7, c);
          r.rect(ax - 1, top - 4, 3, 1, c);
          r.set(ax, top - 8, look.night ? C('#ff4a3a') : c);
          if (look.night) this.extLamps.push({ x: ax, y: top - 8, r: 3, k: 0.3, small: true, c: [255, 80, 60] });
        });
      }
    }

    // Une pente boisée vue de loin (collines, crête) : forêt tramée, liseré en haut.
    paintSlope(r, topFn, tones, seed, hazeK, edgeK = 0.4) {
      const { H, look } = this;
      const snow = C('#e4e8ee');
      for (let x = r.x0; x < r.x1; x++) {
        const top = Math.round(topFn(x));
        if (top >= H - 1) continue;
        for (let y = top; y < H; y++) {
          const d = y - top;
          const n = fbm(x * 0.12, y * 0.16, seed, 3);
          let c = tones[n > 0.56 ? 2 : n > 0.42 ? 1 : 0];
          if (hash(x, y, seed) > 0.85) c = tones[0];
          if (d === 0) c = mix(c, this.haze, edgeK);
          if (look.snow && (d < 2 || hash(x, y, seed + 1) > 0.55)) c = mix(snow, c, d < 2 ? 0.1 : 0.35);
          c = mix(c, this.haze, hazeK * (look.hazeK || 1));
          r.set(x, y, c);
        }
      }
    }

    /* ---------- Petits nuages qui dérivent (dessinés juste après le fond) ---------- */
    makeDrift() {
      const { W, H, look } = this;
      if (look.clouds === 'none') return [];
      const tones = look.cloud.map(C);
      const out = [];
      const span = W + this.extL + this.extR;
      // Deux petits nuages sur l'écran (et quelques autres dans le prolongement).
      const n = Math.max(2, Math.round((2 * span) / W));
      for (let k = 0; k < n; k++) {
        const ch = Math.round(H * (0.05 + (k % 2) * 0.015));
        const cw = Math.round(ch * (2 + (k % 3) * 0.3));
        const r = new Wide(cw, ch);
        this.paintCumulus(r, cumulus(cw, ch, 300 + k), 0, 0, look.clouds === 'overcast' ? tones.map((c, i) => tones[Math.max(0, i - 1)]) : tones);
        const x = k < 2 ? Math.round(W * (0.3 + k * 0.36)) : Math.round(-this.extL + ((k - 2 + 0.4) * span) / (n - 1));
        out.push({ img: r.toCanvas(), x, y: Math.round(H * (0.05 + ((k * 3) % 4) * 0.03)), w: cw, v: 0.5 + (k % 3) * 0.3 });
      }
      return out;
    }

    /* ================= Plan moyen : ville, rive, lac ================= */
    paintMid() {
      const { W, H, L, look } = this;
      const r = new Wide(W, H, this.extL, this.extR);
      this.paintCity(r);
      this.paintLandmarks(r);
      this.paintTreeRow(r);
      this.paintLake(r);
      this.paintOnWater(r);
      if (look.snow) this.snowCaps(r, L.cityTop - 4, L.lakeTop + 12);
      return r;
    }

    // La ville : une mosaïque de toits, de murs clairs et de jardins, rangée par rangée
    // (les plus lointaines d'abord), de plus en plus grande en approchant.
    paintCity(r) {
      const { W, H, L, look } = this;
      const g = this.grade;
      const night = look.night;
      const walls = WALLS.map(g);
      const roofs = ROOFS.map(g);
      const leaf = look.autumn ? ['#3a3a1e', '#5a5226', '#7a6a2e', '#9a7a34'] : look.snow ? ['#3e4a44', '#56625a', '#a8b0b4', '#d8dee2'] : ['#1e3422', '#2c4a2c', '#3e6034', '#56783e'];
      const leafC = leaf.map(g);
      const lit = [C('#ffe2a0'), C('#ffc870'), C('#f4a860')];
      const yB = L.rowTop + 6;
      const baseC = mix(g(look.snow ? '#9aa4a8' : look.autumn ? '#5e6040' : '#465e3c'), this.haze, 0.25);
      // Le sol de la ville (sous les maisons) : jardins et rues, tramés.
      for (let x = r.x0; x < r.x1; x++) {
        const top = this.cityTopAt(x);
        for (let y = top; y < Math.min(H, L.lakeTop + 14); y++) {
          const n = fbm(x * 0.2, y * 0.3, 81, 2);
          let c = n > 0.55 ? leafC[1] : n > 0.4 ? baseC : leafC[0];
          if (y === top) c = mix(c, this.haze, 0.4);
          const depth = clamp01((y - L.cityTop) / (yB - L.cityTop));
          r.set(x, y, mix(c, this.haze, (1 - depth) * 0.35 * (look.hazeK || 1)));
        }
      }
      // Les maisons et les bouquets d'arbres, par cases calées sur le monde.
      let row = 0;
      for (let y = L.cityTop - Math.round(H * 0.03); y < yB; row++) {
        const depth = clamp01((y - L.cityTop) / (yB - L.cityTop));
        const rh = depth < 0.35 ? 2 : depth < 0.75 ? 3 : 4;
        const cw = 3 + Math.round(depth * 3);
        const off = Math.floor(hash(row, 1, 82) * cw);
        const k0 = Math.floor((r.x0 - 8 + off) / cw);
        const k1 = Math.ceil((r.x1 + 8 + off) / cw);
        for (let k = k0; k <= k1; k++) {
          const x = k * cw - off;
          const top = this.cityTopAt(x + 1);
          if (y < top - 1) continue;
          const paint = () => this.paintCityCell(r, x, y, cw, rh, depth, k, row, { walls, roofs, leafC, lit, night });
          if (x + cw < -8 || x > W + 8) r.only(paint);
          else paint();
        }
        y += rh;
      }
    }

    // Haut de la ville en x : sous les collines au fond, elle grimpe sur la crête à droite.
    cityTopAt(x) {
      const { L, W } = this;
      const u = x / W;
      let top = L.cityTop + Math.round((noise(x * 0.05, 2, 83) - 0.5) * 3);
      if (u > 0.7) top = Math.min(top, Math.round(Math.max(this.ridgeY(x) + 5, this.H * 0.466)));
      if (u < -0.1) top = Math.min(top, Math.round(Math.max(this.mountY(x) + 18, this.H * 0.47)));
      return Math.max(top, Math.round(this.hillY(x)) + 1, Math.round(this.farY(x)) + 1);
    }

    paintCityCell(r, x, y, cw, rh, depth, k, row, P) {
      const { look, W } = this;
      const v = hash(k, row, 84);
      const hz = (1 - depth) * 0.42 * (look.hazeK || 1);
      const top = this.cityTopAt(x + 1);
      const u = x / W;
      // Moins de maisons en grimpant la crête (à droite), et dans les hauts.
      const sparse = clamp01((y - top) / 10);
      let pB = 0.36 + sparse * 0.16;
      if (u > 0.72) pB *= 0.6 + 0.4 * sparse;
      if (u < 0) pB += 0.08; // la vieille ville est plus serrée
      const fx = (c) => mix(c, this.haze, hz);
      if (v < pB) {
        // Une maison ou un immeuble : toit (vu d'en haut), mur clair, fenêtres.
        const bw = Math.min(cw, 2 + Math.floor(hash(k, row, 85) * (1.5 + depth * 3)));
        const roofH = depth < 0.4 ? 1 : 2;
        const bh = roofH + 1 + Math.floor(hash(k, row, 86) * (1 + depth * 2));
        const bx = x + Math.floor(hash(k, row, 87) * Math.max(1, cw - bw + 1));
        const wall = P.walls[Math.floor(hash(k, row, 88) * P.walls.length)];
        const roof = P.roofs[Math.floor(hash(k, row, 89) * P.roofs.length)];
        const by = y + rh - bh;
        for (let j = 0; j < bh; j++) {
          for (let i = 0; i < bw; i++) {
            let c;
            if (j < roofH) {
              c = roof;
              if (i < bw / 2 && j === 0) c = mix(roof, [255, 255, 255], 0.18); // pan au soleil
              if (look.snow) c = j === 0 || i < bw / 2 ? C('#eef2f6') : C('#cdd4dc');
            } else {
              c = i === bw - 1 && bw > 2 ? mix(wall, [60, 70, 90], 0.25) : wall;
              if (bw > 2 && j > roofH && (i + j) % 2 === 1 && hash(bx + i, by + j, 90) > 0.5) c = mix(wall, [50, 60, 80], 0.5);
            }
            r.set(bx + i, by + j, fx(c));
          }
        }
        // Fenêtres allumées le soir.
        if (look.lights && bw >= 2 && bh > roofH + 0) {
          for (let i = 0; i < bw; i++) {
            const h = hash(bx + i, by, 91);
            if (h < look.lights * (0.6 + depth * 0.5)) {
              const wy = by + roofH + Math.floor(hash(bx + i, by, 92) * (bh - roofH));
              const c = P.lit[Math.floor(hash(bx + i, wy, 93) * 3)];
              const off = r.get(bx + i, wy);
              r.set(bx + i, wy, c);
              const inScreen = bx + i >= 0 && bx + i < W;
              if (hash(bx + i, wy, 94) < 0.25) this.cityLights.push({ x: bx + i, y: wy, c, off: css(off), on: true, ext: !inScreen });
            }
          }
        }
        // Cheminée qui fume (l'hiver).
        if (look.smoke && depth > 0.4 && hash(k, row, 95) < 0.12) this.chimneys.push({ x: bx + 1, y: by - 1 });
      } else if (v < pB + 0.4) {
        // Un bouquet d'arbres : une boule tramée, éclairée en haut à gauche.
        const rad = 1 + Math.floor(hash(k, row, 96) * (1 + depth * 1.8));
        const cx = x + Math.floor(hash(k, row, 97) * cw);
        const cy = y + rh - rad;
        let tones = P.leafC;
        if (look.cherry && hash(k, row, 98) < 0.12) tones = [C('#a85a7a'), C('#d07a9c'), C('#ee9ebc'), C('#ffd0e0')];
        if (look.autumn) {
          const pal = AUT[Math.floor(hash(k, row, 99) * AUT.length)];
          tones = [C(pal[2]), C(pal[3]), C(pal[4]), C(pal[5])];
        }
        for (let j = -rad; j <= rad; j++) {
          for (let i = -rad; i <= rad; i++) {
            if (i * i + j * j > rad * rad + 0.6) continue;
            let t = 1;
            if (i + j < -rad * 0.5) t = 2;
            if (i + j > rad * 0.6) t = 0;
            if (i + j < -rad && rad > 1) t = 3;
            if (hash(cx + i, cy + j, 100) > 0.8) t = Math.max(0, t - 1);
            r.set(cx + i, cy + j, fx(tones[t]));
          }
        }
      }
    }

    // Grands immeubles blancs, clochers, l'Impérial et sa jetée ; dans le prolongement, la
    // vieille ville, le château et la basilique de la Visitation.
    paintLandmarks(r) {
      const { W, H, look } = this;
      const g = this.grade;
      const white = g('#f2f0ea');
      const shade = g('#c8c6c4');
      const blocks = [
        [0.035, 0.548, 9, 5], [0.07, 0.552, 7, 4], [0.125, 0.55, 10, 5], [0.205, 0.552, 12, 6], [0.24, 0.546, 6, 7],
        [0.285, 0.556, 9, 4], [0.405, 0.558, 11, 4], [0.44, 0.552, 6, 5], [0.565, 0.566, 12, 4], [0.6, 0.56, 7, 5],
        [0.79, 0.55, 8, 4], [0.84, 0.538, 6, 4],
      ];
      for (const [u, yf, w, h] of blocks) this.paintBlock(r, Math.round(W * u), Math.round(H * yf), w, h, white, shade);
      // Deux clochers fins dans la ville.
      for (const [u, yf] of [[0.165, 0.548], [0.505, 0.556]]) this.paintSpire(r, Math.round(W * u), Math.round(H * yf));
      // L'Impérial : grand palace blanc, toit d'ardoise bleutée, deux tours à dôme.
      this.paintImperial(r, Math.round(W * 0.657), Math.round(H * 0.613));
      if (this.wide) r.only(() => this.paintOldTown(r));
    }

    paintBlock(r, x, yb, w, h, white, shade) {
      const { look } = this;
      const roof = this.grade('#8a8c90');
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          let c = i >= w - 2 ? shade : white;
          if (j === 0) c = look.snow ? C('#f4f6f8') : roof;
          else if (j % 2 === 0 && i % 2 === 1 && i < w - 1) c = mix(c, [70, 80, 100], 0.35);
          r.set(x + i, yb - h + j, mix(c, this.haze, 0.15));
        }
      }
      if (look.lights) {
        for (let j = 2; j < h; j += 2) {
          for (let i = 1; i < w - 1; i += 2) {
            if (hash(x + i, yb + j, 120) > look.lights) continue;
            const c = C(hash(x + i, j, 121) > 0.5 ? '#ffd890' : '#ffefc0');
            r.set(x + i, yb - h + j, c);
            if (hash(x + i, j, 122) < 0.3) this.cityLights.push({ x: x + i, y: yb - h + j, c, off: css(mix(white, [70, 80, 100], 0.35)), on: true, ext: x + i < 0 || x + i >= this.W });
          }
        }
      }
    }

    paintSpire(r, x, yb) {
      const c = mix(this.grade('#5a5654'), this.haze, 0.2);
      const w = mix(this.grade('#e8e2d8'), this.haze, 0.2);
      r.rect(x, yb - 6, 2, 6, w);
      r.rect(x + 1, yb - 6, 1, 6, mix(w, [60, 70, 90], 0.3));
      r.rect(x, yb - 9, 2, 3, c);
      r.set(x, yb - 10, c);
      r.set(x, yb - 11, c);
    }

    // L'Impérial Palace (x = milieu, yb = pied de la façade).
    paintImperial(r, cx, yb) {
      const { look } = this;
      const g = this.grade;
      const wall = g('#f6f2ea');
      const wallS = g('#d4d0cc');
      const roof = g('#6c7684');
      const roofL = g('#8a96a4');
      const win = g('#8a8c96');
      const w = 17;
      const x0 = cx - 8;
      const h = 6;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) r.set(x0 + i, yb - h + j, i > w - 3 ? wallS : j > 0 && j % 2 === 0 && i % 2 === 1 ? win : wall);
      // Toit à la Mansart, et les deux tours d'angle à dôme.
      for (let j = 0; j < 3; j++) r.rect(x0 + j, yb - h - 1 - j, w - 2 * j, 1, j === 2 ? roofL : roof);
      for (const tx of [x0, x0 + w - 3]) {
        r.rect(tx, yb - h - 3, 3, 3, wall);
        r.rect(tx, yb - h - 5, 3, 2, roof);
        r.set(tx + 1, yb - h - 6, roofL);
        r.set(tx + 1, yb - h - 7, roof);
      }
      if (look.snow) {
        r.rect(x0 + 2, yb - h - 3, w - 4, 1, C('#f4f6f8'));
        for (const tx of [x0, x0 + w - 3]) r.rect(tx, yb - h - 5, 3, 1, C('#f4f6f8'));
      }
      // Le soir : la façade est illuminée.
      if (look.lights >= 0.3) {
        for (let i = 1; i < w - 1; i += 2) {
          r.set(x0 + i, yb - 2, C('#ffe0a0'));
          r.set(x0 + i, yb - 4, C('#ffd080'));
        }
        this.lamps.push({ x: cx, y: yb - 3, r: 9, k: 0.4, small: true, c: [255, 210, 140] });
        this.shoreLights.push({ x: x0 + 2, c: [255, 214, 150], k: 0.8 }, { x: cx, c: [255, 224, 170], k: 1 }, { x: x0 + w - 3, c: [255, 214, 150], k: 0.8 });
      }
      this.imperial = { x0, x1: x0 + w, yb };
    }

    // Le prolongement à gauche : la vieille ville, son château sur la butte, la basilique.
    paintOldTown(r) {
      const { W, H, look } = this;
      const g = this.grade;
      const stone = g('#e2d8c4');
      const stoneS = g('#b8ac98');
      const roof = g('#6a6a72');
      const roofL = g('#868892');
      const fx = (c, k = 0.12) => mix(c, this.haze, k);
      // Le château d'Annecy : courtines, grosse tour ronde à toit pointu, logis.
      const cx = Math.round(-0.42 * W);
      const yb = Math.round(H * 0.556);
      if (cx > r.x0 + 20) {
        for (let j = 0; j < 7; j++) for (let i = -13; i <= 13; i++) r.set(cx + i, yb - j, fx(i > 9 ? stoneS : stone));
        for (let i = -13; i <= 13; i += 2) r.set(cx + i, yb - 7, fx(stone));
        // Logis à grands toits.
        for (let j = 0; j < 5; j++) r.rect(cx - 9 + j, yb - 8 - j, 14 - 2 * j, 1, fx(j < 2 ? roof : roofL));
        // Tour de la Reine (ronde) et sa flèche.
        for (let j = 0; j < 10; j++) for (let i = 0; i < 6; i++) r.set(cx + 7 + i, yb - j, fx(i > 3 ? stoneS : stone));
        for (let j = 0; j < 7; j++) r.rect(cx + 7 + Math.floor(j / 2), yb - 10 - j, Math.max(1, 6 - 2 * Math.floor(j / 2)), 1, fx(j < 3 ? roof : roofL));
        for (let j = 0; j < 12; j++) for (let i = 0; i < 4; i++) r.set(cx - 14 + i, yb - j, fx(i > 2 ? stoneS : stone));
        for (let j = 0; j < 5; j++) r.rect(cx - 14 + Math.floor(j / 2), yb - 12 - j, Math.max(1, 4 - 2 * Math.floor(j / 2)), 1, fx(roof));
        if (look.lights >= 0.3) {
          this.extLamps.push({ x: cx, y: yb - 3, r: 14, k: 0.45, small: true, c: [255, 200, 120] });
          for (let i = -11; i <= 11; i += 3) r.set(cx + i, yb - 3, C('#ffd88a'));
        }
      }
      // La basilique de la Visitation, sur les pentes du Semnoz : nef claire, haut clocher.
      const bx = Math.round(-0.86 * W);
      const by = Math.round(this.mountY(bx) + 26);
      if (bx > r.x0 + 12 && by < H * 0.52) {
        for (let j = 0; j < 5; j++) for (let i = -8; i <= 6; i++) r.set(bx + i, by - j, fx(i > 4 ? stoneS : stone, 0.2));
        for (let j = 0; j < 3; j++) r.rect(bx - 8 + j, by - 5 - j, 15 - 2 * j, 1, fx(roof, 0.2));
        for (let j = 0; j < 14; j++) for (let i = 0; i < 3; i++) r.set(bx + 7 + i, by - j, fx(i === 2 ? stoneS : stone, 0.2));
        r.rect(bx + 7, by - 16, 3, 2, fx(roof, 0.2));
        r.set(bx + 8, by - 17, fx(roof, 0.2));
        r.set(bx + 8, by - 18, fx(C('#c8a040'), 0.2));
      }
      // Clochers à bulbe savoyards dans la vieille ville.
      for (const u of [-0.28, -0.62, -1.18]) {
        const x = Math.round(u * W);
        if (x < r.x0 + 6) continue;
        this.paintBulb(r, x, Math.round(H * 0.566), fx);
      }
      // Grands immeubles de la ville basse.
      const white = g('#efece4');
      const shade = g('#c4c0bc');
      for (let k = 0; k < 9; k++) {
        const x = Math.round(-0.14 * W - k * W * 0.13 - hash(k, 1, 130) * W * 0.05);
        if (x < r.x0 + 4) continue;
        if (Math.abs(x - cx) < 22) continue;
        this.paintBlock(r, x, Math.round(H * (0.552 + hash(k, 2, 130) * 0.01)), 6 + Math.floor(hash(k, 3, 130) * 7), 4 + Math.floor(hash(k, 4, 130) * 3), white, shade);
      }
    }

    // Clocher à bulbe (Savoie) : tour claire, bulbe en fer-blanc, flèche.
    paintBulb(r, x, yb, fx) {
      const g = this.grade;
      const wall = fx(g('#ece4d4'));
      const sh = fx(g('#c4b8a4'));
      const tin = fx(g('#8a929a'));
      const tinL = fx(g('#c4ccd2'));
      for (let j = 0; j < 10; j++) for (let i = 0; i < 4; i++) r.set(x + i, yb - j, i === 3 ? sh : wall);
      r.set(x + 1, yb - 7, fx(g('#4a4a50')));
      const bulb = ['.tt.', 'tTtt', 'tTtt', '.tt.', '..t.', '.tt.', 'tTtt', '.tt.', '..t.', '..t.'];
      bulb.forEach((row, j) => {
        for (let i = 0; i < 4; i++) if (row[i] !== '.') r.set(x + i, yb - 10 - (bulb.length - j), row[i] === 'T' ? tinL : tin);
      });
    }

    // La longue rangée d'arbres du Pâquier (à gauche), puis la rive boisée jusqu'à la
    // montagne ; une pelouse claire au bord de l'eau.
    paintTreeRow(r) {
      const { W, H, L, look } = this;
      const tones = this.crownRamp(0, 7).map((c) => mix(c, this.haze, 0.08));
      const lawn = this.grade(look.snow ? '#e4e8ec' : look.autumn ? '#9a9a52' : '#78a04e');
      const lawnD = this.grade(look.snow ? '#c4ccd4' : look.autumn ? '#7a7a40' : '#5e8640');
      const cw = 5;
      const k0 = Math.floor((r.x0 - 10) / cw);
      const k1 = Math.ceil((r.x1 + 10) / cw);
      for (let k = k0; k <= k1; k++) {
        const x = k * cw;
        const u = x / W;
        const sh = this.shoreY(x);
        let top;
        let rad;
        if (x < L.rowEnd) {
          // L'allée de platanes : une rangée dense et régulière.
          top = L.rowTop + Math.round((hash(k, 1, 140) - 0.5) * 3);
          rad = 4 + Math.floor(hash(k, 2, 140) * 2);
          if (u < -0.3) top = sh - 9 - Math.floor(hash(k, 3, 140) * 6); // les quais : arbres plus épars
        } else if (u < 0.9) {
          top = Math.round(H * 0.584) + Math.round((hash(k, 1, 141) - 0.5) * 6);
          rad = 3 + Math.floor(hash(k, 2, 141) * 3);
          if (this.imperial && x > this.imperial.x0 - 4 && x < this.imperial.x1 + 2) continue;
          if (hash(k, 3, 141) < 0.25) continue;
        } else {
          top = Math.round(H * 0.585);
          rad = 4;
        }
        const cy = top + rad;
        const paint = () => {
          // Ombre sous les arbres jusqu'à l'eau.
          for (let y = cy; y < sh; y++) for (let i = -cw; i <= cw; i++) if (r.alpha(x + i, y) && hash(x + i, y, 142) > 0.15) r.set(x + i, y, y < sh - 1 ? tones[0] : tones[1]);
          this.blob(r, x + Math.floor(hash(k, 4, 140) * 3), cy, rad, rad, tones, 140 + k);
        };
        if (x + cw + rad < -2 || x - cw - rad > W + 2) r.only(paint);
        else paint();
      }
      // La pelouse du Pâquier au bord de l'eau, et le quai de pierre.
      for (let x = r.x0; x < r.x1; x++) {
        const sh = this.shoreY(x);
        const u = x / W;
        if (u > -0.3 && u < 0.32) {
          r.set(x, sh - 1, hash(x, 1, 143) > 0.3 ? lawn : lawnD);
          r.set(x, sh - 2, lawnD);
        } else if (u <= -0.3) {
          r.set(x, sh - 1, this.grade(look.snow ? '#e8ecf0' : '#cfc8b8'));
          r.set(x, sh - 2, this.grade('#9a9488'));
        }
      }
      // Lampadaires du bord de l'eau (le soir).
      if (look.lights >= 0.3) {
        for (let x = Math.ceil(r.x0 / 9) * 9; x < r.x1; x += 9) {
          const u = x / W;
          if (u > 0.53 && u < 0.62) continue;
          if (u > 0.86) continue;
          if (hash(x, 1, 144) < 0.25) continue;
          const sh = this.shoreY(x);
          const c = C(hash(x, 2, 144) > 0.5 ? '#ffd890' : '#fff0c8');
          r.set(x, sh - 2, c);
          const inScreen = x >= 0 && x < W;
          (inScreen ? this.shoreLights : this.extShore).push({ x, c, k: 0.7 });
          (inScreen ? this.lamps : this.extLamps).push({ x, y: sh - 2, r: 4, k: 0.35, small: true, c: [255, 210, 140] });
        }
      }
    }

    // Une boule de feuillage (petite échelle) : tons du plus sombre au plus clair.
    blob(r, cx, cy, rx, ry, tones, seed) {
      const n = tones.length;
      for (let j = -ry - 1; j <= ry; j++) {
        for (let i = -rx - 1; i <= rx + 1; i++) {
          const x = cx + i;
          const y = cy + j;
          const e = (i / (rx + 0.5)) ** 2 + (j / (ry + 0.5)) ** 2;
          if (e > 1 + (noise(x * 0.6, y * 0.6, seed) - 0.5) * 0.5) continue;
          const v = -(i / rx) * 0.45 - (j / ry) * 0.75 + (hash(x >> 1, y >> 1, seed) - 0.5) * 0.6;
          const t = Math.max(0, Math.min(n - 2, Math.floor((v + 1) * (n - 1) * 0.5 + bayer(x, y) * 0.7)));
          r.set(x, y, tones[t]);
        }
      }
    }

    // Les feuillages d'une ambiance : un ton par « famille » (saison).
    crownRamp(seedV, n = 7) {
      const look = this.look;
      const list = look.leaf;
      const pal = list[Math.floor(seedV * list.length) % list.length];
      return pal.slice(0, n).map((h) => this.grade(h));
    }

    // Le lac : dégradé turquoise (clair au loin, plus profond près de nous), rides
    // horizontales, reflet sombre de la rive.
    paintLake(r) {
      const { W, H, L, look } = this;
      const lake = look.lake.map((h) => (look.night ? C(h) : this.grade(h)));
      const hi = look.night ? C(look.ripple[0]) : this.grade(look.ripple[0]);
      const lo = look.night ? C(look.ripple[1]) : this.grade(look.ripple[1]);
      const nearY = Math.round(H * 0.84);
      this.lakeMask = new Uint8Array(r.sw * H);
      for (let x = r.x0; x < r.x1; x++) {
        const sh = this.shoreY(x);
        for (let y = sh; y < L.lakeBot; y++) {
          const t = clamp01((y - sh) / (nearY - sh));
          const f = t * (lake.length - 1);
          const k = Math.min(lake.length - 2, Math.floor(f));
          const q = Math.floor((f - k) * 6 + bayer(x, y)) / 6;
          let c = mix(lake[k], lake[k + 1], q);
          // Rides : des tirets clairs et sombres, plus longs en approchant.
          const fx = 0.22 / (0.4 + t * 2.2);
          const n = noise(x * fx, y * 0.9, 61);
          if (n > 0.74 - t * 0.04) c = mix(c, hi, 0.4 + t * 0.2);
          else if (n < 0.22) c = mix(c, lo, 0.25 + t * 0.15);
          // Reflet de la rive (arbres sombres) juste sous le bord.
          const d = y - sh;
          if (d < 7) {
            const m = r.get(x, sh - 1 - d);
            const brk = noise(x * 0.3, y * 1.3, 62);
            if (m[3] && brk > 0.3 + d * 0.06) c = mix(c, mix(m, lake[2], 0.3), 0.55 - d * 0.06);
          }
          r.set(x, y, c);
          this.lakeMask[r.i(x, y)] = 1;
        }
        // Liseré clair au bord de l'eau.
        if (hash(x, sh, 63) > 0.4) r.set(x, sh, mix(r.get(x, sh), hi, 0.35));
      }
    }

    // Ce qui est posé sur l'eau au bord de la rive : la jetée blanche, les petits bateaux
    // amarrés, la plage de l'Impérial ; reflets de l'Impérial.
    paintOnWater(r) {
      const { W, H, look } = this;
      const g = this.grade;
      const white = g('#f4f2ee');
      const grey = g('#9aa0a8');
      // La longue jetée blanche, à droite de l'Impérial.
      const jx0 = Math.round(W * 0.684);
      const jx1 = Math.round(W * 0.738);
      const jy = Math.round(H * 0.624);
      for (let x = jx0; x < jx1; x++) {
        r.set(x, jy - 2, grey);
        r.set(x, jy - 1, white);
        r.set(x, jy, x % 3 === 0 ? grey : white);
        r.set(x, jy + 1, mix(white, C(look.lake[1]), 0.6));
        this.lakeMask[r.i(x, jy - 2)] = 0;
        this.lakeMask[r.i(x, jy - 1)] = 0;
        this.lakeMask[r.i(x, jy)] = 0;
      }
      r.rect(jx0 - 2, jy - 3, 4, 2, grey);
      r.rect(jx0 - 2, jy - 3, 4, 1, white);
      if (look.lights >= 0.3) {
        for (let x = jx0 + 2; x < jx1; x += 5) r.set(x, jy - 1, C('#ffe2a8'));
        this.shoreLights.push({ x: jx0 + 10, c: [255, 220, 160], k: 0.6 }, { x: jx0 + 24, c: [255, 220, 160], k: 0.6 });
      }
      // Reflet de l'Impérial (blanc tremblé) et de sa jetée.
      if (this.imperial) {
        const im = this.imperial;
        for (let x = im.x0; x < im.x1; x++) {
          const sh = this.shoreY(x);
          for (let d = 1; d < 6; d++) if (noise(x * 0.5, d * 1.4, 64) > 0.35 + d * 0.05) r.tint(x, sh + d, white, look.night ? 0.12 : 0.35 - d * 0.04);
        }
      }
      // Petits bateaux amarrés le long de la rive (points blancs).
      for (let k = Math.floor(r.x0 / 7); k * 7 < r.x1; k++) {
        const x = k * 7 + Math.floor(hash(k, 1, 150) * 5);
        const u = x / W;
        const ok = (u > 0.12 && u < 0.33) || (u > 0.6 && u < 0.68) || (u < -0.25 && hash(k, 3, 150) < 0.5);
        if (!ok || hash(k, 2, 150) < 0.35) continue;
        const paint = () => {
          const y = this.shoreY(x) + 1 + Math.floor(hash(k, 4, 150) * 3);
          r.set(x, y, white);
          r.set(x + 1, y, white);
          r.set(x, y + 1, mix(white, C(look.lake[0]), 0.5));
          if (hash(k, 5, 150) > 0.5) r.set(x, y - 1, g('#d8dce0'));
          if (hash(k, 5, 150) > 0.5) r.set(x, y - 2, g('#d8dce0'));
        };
        if (x < -4 || x > W + 4) r.only(paint);
        else paint();
      }
      // Le grand bateau de croisière à quai, devant la vieille ville (prolongement).
      if (this.wide) {
        r.only(() => {
          const bx = Math.round(-0.3 * W);
          if (bx < r.x0 + 30) return;
          const y = this.shoreY(bx) + 3;
          this.paintSteamerTo(r, bx, y, 1, look.lights >= 0.3);
        });
      }
    }

    // Peint un bateau de croisière (le même que celui qui navigue) dans une toile.
    paintSteamerTo(r, x, y, dir, lit) {
      const S = this.steamerRows();
      const pal = this.steamerPal(lit);
      S.forEach((row, j) => {
        for (let i = 0; i < row.length; i++) {
          const ch = row[dir > 0 ? i : row.length - 1 - i];
          if (ch === '.') continue;
          r.set(x + i, y - S.length + j, pal[ch]);
        }
      });
    }

    steamerRows() {
      return [
        '..........f...............',
        '.........fff..............',
        '.....nnnnnnnnnnnnnnnn.....',
        '....nwwwwwwwwwwwwwwwwn....',
        '...wwkwkwkwkwkwkwkwkwww...',
        '.sswwwwwwwwwwwwwwwwwwwwwww',
        'sswwkwkwkwkwkwkwkwkwkwkwwB',
        '.bbbbbbbbbbbbbbbbbbbbbbbb.',
        '..bbbbbbbbbbbbbbbbbbbbbb..',
      ];
    }

    steamerPal(lit) {
      const g = this.look.night ? (h) => mix(C(h), [20, 30, 60], 0.55) : this.grade;
      return {
        w: g('#f6f6f2'),
        s: g('#d8dade'),
        n: g('#2e4a6e'),
        k: lit ? C('#ffd890') : g('#4a5a70'),
        b: g('#2c3e5a'),
        B: g('#c84a3a'),
        f: g('#e04a3a'),
      };
    }

    // Le masque du lac (là où l'eau se voit dans le plan moyen) et la texture des rides
    // qui ondulent (dessinée par bandes décalées, puis découpée au masque).
    makeWater(mid) {
      const { H, L, look } = this;
      const sw = mid.sw;
      const y0 = L.lakeTop;
      const h = L.lakeBot - y0;
      this.water = { y0, h, sw };
      const m = new Raster(sw, h);
      const mask = this.lakeMask;
      for (let y = 0; y < h; y++) for (let x = 0; x < sw; x++) if (mask[(y + y0) * sw + x]) m.set(x, y, [255, 255, 255]);
      this.maskCanvas = m.toCanvas();
      const tex = new Raster(sw, h);
      const hi = look.night ? C(look.ripple[0]) : this.grade(look.ripple[0]);
      const lo = look.night ? C(look.ripple[1]) : this.grade(look.ripple[1]);
      const nearY = Math.round(H * 0.84);
      const choppy = look.caps ? 1.6 : look.wet ? 1.25 : 1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < sw; x++) {
          const wx = x - this.extL;
          const yy = y + y0;
          const sh = this.shoreY(wx);
          if (yy <= sh) continue;
          const t = clamp01((yy - sh) / (nearY - sh));
          const fx = 0.25 / (0.4 + t * 2.4);
          const n = noise(wx * fx + 40, yy * 0.95 * choppy, 65);
          if (n > 0.76 - t * 0.05 - (choppy - 1) * 0.08) tex.set(x, y, hi, Math.round(70 + t * 90));
          else if (n < 0.2 + (choppy - 1) * 0.06) tex.set(x, y, lo, Math.round(50 + t * 60));
        }
      }
      this.waterTex = tex.toCanvas();
      this.wbuf = document.createElement('canvas');
      this.wbuf.width = sw;
      this.wbuf.height = h;
      this.wg = this.wbuf.getContext('2d');
      // Points où le lac est visible, pour poser les paillettes et les ronds de pluie.
      const pts = [];
      for (let y = 2; y < h; y += 1) for (let x = 0; x < sw; x += 2) if (mask[(y + y0) * sw + x] && hash(x, y, 66) < 0.18) pts.push([x - this.extL, y + y0]);
      this.waterPts = pts;
    }

    // Neige posée sur ce qui regarde vers le haut.
    snowCaps(r, y0, y1, glow) {
      const S1 = C('#eef1f6');
      const S2 = C('#c8d0dc');
      for (let y = Math.max(1, y0); y < y1; y++) {
        for (let x = r.x0; x < r.x1; x++) {
          if (r.alpha(x, y) !== 255 || r.alpha(x, y - 1) !== 0) continue;
          if (glow && glow[r.i(x, y)]) continue;
          r.set(x, y, S1);
          if (hash(x, y, 5) > 0.5) r.set(x, y + 1, S2);
        }
      }
    }

    /* ================= Premier plan : arbres, port, immeubles ================= */
    paintFore() {
      const { W, H, L, look } = this;
      const r = new Wide(W, H, this.extL, this.extR);
      const glow = new Uint8Array(r.sw * H);
      this.glow = glow;
      const g = this.grade;
      // Le sol : feuillages sombres, de la berge jusqu'en bas.
      const floor = this.crownRamp(0.1, 7);
      for (let x = r.x0; x < r.x1; x++) {
        const top = this.groundY(x);
        for (let y = top; y < H; y++) {
          const n = fbm(x * 0.15, y * 0.15, 201, 3);
          const t = n > 0.6 ? 3 : n > 0.48 ? 2 : n > 0.36 ? 1 : 0;
          r.set(x, y, floor[t]);
        }
      }
      // La berge de gauche : pelouse claire, un chemin, puis les arbres du parc.
      this.paintBank(r);
      // Le port et ses voiliers amarrés.
      this.paintPort(r);
      // Les arbres, du plus loin au plus proche (puis les immeubles du bas, devant).
      const trees = this.treeList();
      const builds = this.paintBuildings.bind(this, r, glow);
      let builtDone = false;
      for (const t of trees) {
        if (!builtDone && t.order > 0.9) {
          builds();
          builtDone = true;
        }
        const paint = () => this.paintTree(r, t);
        if (t.ext || t.x + t.rx + 4 < -2 || t.x - t.rx - 4 > W + 2) r.only(paint);
        else paint();
      }
      if (!builtDone) builds();
      // Le lampadaire du premier plan.
      this.paintLamp(r, glow, L.lampX, Math.round(H * 0.942));
      if (this.wide) {
        r.only(() => {
          for (const u of [-0.3, -0.72, -1.15]) {
            const x = Math.round(u * W);
            if (x > r.x0 + 4) this.paintLamp(r, glow, x, Math.round(H * 0.942), true);
          }
        });
      }
      if (look.snow) this.snowCaps(r, Math.round(H * 0.55), H, glow);
      if (look.wet) this.wetShine(r, glow);
      // Lumière des fenêtres et du lampadaire, la nuit.
      if (look.night || look.lights >= 0.3) {
        const lights = this.lamps.filter((l) => !l.small && l.fore).map((l) => ({ x: l.x, y: l.y, r: l.r, k: l.k }));
        const extra = this.extLamps.filter((l) => !l.small && l.fore).map((l) => ({ x: l.x, y: l.y, r: l.r, k: l.k }));
        applyLight(r, lights, [1, 1, 1], [0.9, 0.6, 0.3], (x, y) => !glow[r.i(x, y)], extra);
      }
      return r;
    }

    // La berge proche, à gauche : la pelouse du parc, un chemin clair, la presqu'île boisée.
    paintBank(r) {
      const { W, H, look } = this;
      const g = this.grade;
      const lawn = [g(look.snow ? '#dfe4ea' : look.autumn ? '#8c904c' : '#5f8c42'), g(look.snow ? '#f0f2f6' : look.autumn ? '#a8a65a' : '#78a650'), g(look.snow ? '#c4ccd6' : look.autumn ? '#6c7038' : '#4a7436')];
      const path = g(look.snow ? '#d4d8de' : '#c8bfa8');
      const edge = g('#d6d2c8');
      for (let x = r.x0; x < r.x1; x++) {
        const u = x / W;
        if (u > 0.36) continue;
        const top = this.groundY(x);
        r.set(x, top, hash(x, 2, 212) > 0.3 ? mix(edge, C(look.lake[1]), 0.4) : lawn[0]);
        for (let y = top + 1; y < top + 4; y++) {
          const n = fbm(x * 0.1, y * 0.3, 211, 2);
          r.set(x, y, n > 0.55 ? lawn[1] : n < 0.38 ? lawn[2] : lawn[0]);
        }
        // Le chemin du bord de l'eau.
        const py = top + 2 + Math.round(Math.sin(x * 0.03) * 0.8);
        if (noise(x * 0.08, 3, 213) > 0.35) r.set(x, py, mix(path, lawn[0], 0.35));
      }
      // La presqu'île boisée, à gauche, qui avance sur l'eau.
      const tones = this.crownRamp(0.3, 7);
      const ix = Math.round(W * 0.025);
      const iy = Math.round(H * 0.69);
      for (let x = -14; x < Math.round(W * 0.075); x++) {
        const y0 = Math.round(H * 0.705 - 4 * Math.exp(-(((x - ix) / (W * 0.04)) ** 2)));
        for (let y = y0; y < H * 0.722; y++) r.set(x, y, tones[1]);
        r.set(x, y0, g('#c8c4b8'));
      }
      this.blob(r, ix - 10, iy - 10, 12, 10, tones, 221);
      this.blob(r, ix + 6, iy - 6, 9, 8, tones, 222);
      this.blob(r, ix + 16, iy - 1, 6, 5, tones, 223);
    }

    // Le port : une jetée et ses pontons, les voiliers amarrés (les mâts sont dessinés à
    // part, ils se balancent), une capitainerie.
    paintPort(r) {
      const { W, H, L, look } = this;
      const g = this.grade;
      const deck = g(look.snow ? '#eef0f4' : '#d6d0c2');
      const deckS = g('#8a8478');
      const hull = g('#f6f6f2');
      const hullS = g('#b8bcc4');
      const covers = ['#2e5a8a', '#f6f6f2', '#2e4a6a', '#c8c4b8', '#f6f6f2', '#a84a3a'].map(g);
      const y = L.pierY;
      // La jetée principale, et un ponton qui part de la berge.
      for (let x = L.pierX0 - 2; x < L.pierX1; x++) {
        r.set(x, y, deck);
        r.set(x, y + 1, deckS);
        if ((x - L.pierX0) % 5 === 0) r.set(x, y + 2, deckS);
      }
      for (let yy = y; yy < this.groundY(L.pierX0 - 3) + 2; yy++) {
        r.set(L.pierX0 - 3, yy, deck);
        r.set(L.pierX0 - 2, yy, deckS);
      }
      // Les voiliers amarrés, de part et d'autre de la jetée.
      this.masts = [];
      for (let x = L.pierX0 + 1, k = 0; x < L.pierX1 - 3; x += 4, k++) {
        for (const side of [-1, 1]) {
          if (hash(k, side + 2, 230) < 0.2) continue;
          const by = side < 0 ? y - 2 : y + 3;
          const len = 3 + Math.floor(hash(k, side + 5, 230) * 2);
          for (let i = 0; i < len; i++) {
            r.set(x + i, by, i === len - 1 ? hullS : hull);
            r.set(x + i, by + 1, hullS);
          }
          r.set(x + 1, by - 1, covers[Math.floor(hash(k, side + 8, 230) * covers.length)]);
          if (hash(k, side + 11, 230) < 0.75) this.masts.push({ x: x + 1, y: by - 1, h: 6 + Math.floor(hash(k, side + 14, 230) * 5), p: hash(k, side, 231) * 6 });
          for (let i = 0; i < len; i++) if (r.alpha(x + i, by + 2) === 0) r.set(x + i, by + 2, mix(hull, C(look.lake[3]), 0.65), 200);
        }
      }
      // Petite capitainerie au bout de la berge.
      const cx = L.pierX0 - 9;
      const cy = this.groundY(cx) + 1;
      r.rect(cx, cy - 4, 6, 4, g('#ece8e0'));
      r.rect(cx + 4, cy - 4, 2, 4, g('#c4c0b8'));
      r.rect(cx - 1, cy - 5, 8, 1, g('#7a6a5a'));
      r.set(cx + 2, cy - 2, g('#4a5a70'));
      // Le chemin du ponton (le promeneur y marche).
      this.pier = { x0: L.pierX0, x1: L.pierX1 - 2, y };
    }

    // Arbres du premier plan : positions calées sur la photo, puis le prolongement.
    treeList() {
      const { W, H } = this;
      const T = [];
      const add = (u, top, rx, ry, o = {}) => T.push({ x: Math.round(u * W), top: Math.round(top * H), rx: Math.round(rx * W), ry: Math.round(ry * H), seed: T.length * 7 + 11, ...o });
      // Les arbres du parc, sur la berge de gauche (plus loin, plus petits, un peu de brume).
      const parks = [
        [0.045, 0.698, 0.03, 0.05], [0.1, 0.71, 0.034, 0.055], [0.15, 0.716, 0.03, 0.05], [0.19, 0.7, 0.036, 0.06],
        [0.245, 0.712, 0.034, 0.058], [0.3, 0.705, 0.036, 0.06], [0.34, 0.735, 0.03, 0.06],
        [0.02, 0.76, 0.04, 0.07], [0.075, 0.77, 0.04, 0.07], [0.13, 0.775, 0.045, 0.075], [0.22, 0.772, 0.045, 0.07], [0.28, 0.78, 0.04, 0.07],
      ];
      for (const [u, tp, rx, ry] of parks) add(u, tp, rx, ry, { far: true });
      add(0.07, 0.71, 0.018, 0.075, { kind: 'fir', far: true });
      add(0.205, 0.708, 0.014, 0.08, { kind: 'fir', far: true });
      // Les grands arbres du premier plan.
      const big = [
        [0.31, 0.758, 0.07, 0.15], [0.385, 0.832, 0.035, 0.075], [0.47, 0.856, 0.045, 0.08], [0.552, 0.766, 0.062, 0.14],
        [0.612, 0.79, 0.05, 0.11], [0.665, 0.84, 0.05, 0.1], [0.716, 0.694, 0.07, 0.17], [0.782, 0.734, 0.05, 0.13],
        [0.862, 0.6, 0.065, 0.2], [0.945, 0.548, 0.095, 0.24], [1.035, 0.585, 0.07, 0.2],
        [0.235, 0.86, 0.05, 0.1], [0.36, 0.9, 0.045, 0.07], [0.5, 0.905, 0.05, 0.07], [0.6, 0.885, 0.05, 0.09],
        [0.755, 0.865, 0.06, 0.1], [0.83, 0.8, 0.05, 0.12], [0.03, 0.93, 0.035, 0.06], [0.205, 0.93, 0.035, 0.06],
      ];
      for (const [u, tp, rx, ry] of big) add(u, tp, rx, ry);
      // Le prolongement : à gauche, un parc et des jardins ; à droite, les grands arbres.
      if (this.wide) {
        const RX = rng(250);
        // Le parc de la berge : deux rangées serrées, comme sous l'écran.
        for (let u = -0.07; u * W > this.X0 - W * 0.1; u -= 0.03 + RX() * 0.02) {
          add(u, 0.7 + RX() * 0.025, 0.028 + RX() * 0.01, 0.05 + RX() * 0.012, { far: true, kind: RX() < 0.12 ? 'fir' : null, ext: true });
          add(u - 0.015, 0.75 + RX() * 0.03, 0.035 + RX() * 0.012, 0.065 + RX() * 0.012, { far: true, ext: true });
        }
        // Les grands arbres du premier plan, entre les maisons.
        for (let u = -0.09; u * W > this.X0 - W * 0.1; u -= 0.07 + RX() * 0.05) add(u, 0.8 + RX() * 0.1, 0.04 + RX() * 0.025, 0.09 + RX() * 0.05, { ext: true });
        for (let u = 1.08; u * W < this.X1 + W * 0.1; u += 0.05 + RX() * 0.04) add(u, 0.56 + RX() * 0.1, 0.06 + RX() * 0.03, 0.2 + RX() * 0.05, { ext: true });
      }
      for (const t of T) {
        t.cy = t.top + t.ry;
        t.order = t.far ? (t.cy / H) * 0.1 : (t.cy + t.ry * 0.6) / H;
      }
      // Les immeubles du bas passent devant tout sauf les arbres du tout premier plan.
      for (const t of T) if (!t.far && t.top > H * 0.9) t.order = 1;
      return T.sort((a, b) => a.order - b.order || a.x - b.x);
    }

    // Un grand arbre feuillu (ou un sapin) : tronc, puis grappes de feuilles empilées,
    // éclairées en haut à gauche, ombre portée sous chaque grappe, bord découpé.
    paintTree(r, t) {
      const { H, look } = this;
      const fam = hash(t.seed, 1, 260);
      let tones = this.crownRamp(fam, 7);
      if (look.cherry && !t.far && hash(t.seed, 2, 260) < 0.22) tones = CHERRY.map((h) => this.grade(h));
      if (t.far) tones = tones.map((c) => mix(c, this.haze, 0.12));
      const trunk = this.grade('#2a2420');
      const trunkL = this.grade('#4a4038');
      if (t.kind === 'fir') {
        // Les sapins restent verts en toute saison.
        const fir = (look.autumn ? AUT[3] : look.cherry ? FRESH : look.leaf[0]).map((h) => this.grade(h));
        this.paintFir(r, t, t.far ? fir.map((c) => mix(c, this.haze, 0.12)) : fir);
        return;
      }
      // Tronc et départ des branches (caché par les feuillages pour les arbres du fond).
      const base = t.far ? t.cy + t.ry : Math.min(H + 2, t.cy + t.ry + Math.round(t.ry * 0.6));
      for (let y = t.cy; y < base; y++) {
        const w = Math.max(1, Math.round(t.rx * 0.12));
        for (let i = 0; i < w; i++) r.set(t.x - (w >> 1) + i, y, i === 0 ? trunkL : trunk);
      }
      const R = rng(t.seed * 13 + 5);
      const n = Math.max(5, Math.min(42, Math.round((t.rx * t.ry) / 14)));
      const blobs = [];
      for (let i = 0; i < n; i++) {
        const a = R() * Math.PI * 2;
        const d = Math.sqrt(R());
        const br = Math.max(2, (0.3 + R() * 0.22) * Math.min(t.rx, t.ry) * 0.95);
        blobs.push({ x: t.x + Math.cos(a) * d * (t.rx - br * 0.6), y: t.cy + Math.sin(a) * d * (t.ry - br * 0.6), r: br });
      }
      // Les grappes du haut d'abord : celles du bas passent devant.
      blobs.sort((a, b) => a.y - b.y);
      const x0 = Math.floor(t.x - t.rx - 3);
      const x1 = Math.ceil(t.x + t.rx + 3);
      const y0 = Math.floor(t.top - 3);
      const y1 = Math.ceil(t.cy + t.ry + 3);
      const bw = x1 - x0;
      const bh = y1 - y0;
      const own = new Int16Array(bw * bh).fill(-1);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          for (let k = blobs.length - 1; k >= 0; k--) {
            const b = blobs[k];
            const dd = Math.hypot(x - b.x, (y - b.y) * 1.08);
            if (dd < b.r * (1 + (noise(x * 0.45, y * 0.45, t.seed + k) - 0.5) * 0.42)) {
              own[(y - y0) * bw + (x - x0)] = k;
              break;
            }
          }
        }
      }
      const at = (x, y) => (x < x0 || y < y0 || x >= x1 || y >= y1 ? -1 : own[(y - y0) * bw + (x - x0)]);
      const nt = tones.length;
      const snow = look.snow;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const k = at(x, y);
          if (k < 0) continue;
          const b = blobs[k];
          const lx = (x - b.x) / b.r;
          const ly = (y - b.y) / b.r;
          const gy = (y - t.top) / (t.ry * 2);
          let v = -0.42 * lx - 0.62 * ly + 0.55 * (0.45 - gy) + (hash(x >> 1, y >> 1, t.seed) - 0.5) * 0.55;
          // Ombre portée d'une grappe posée devant.
          const up = at(x, y - 1);
          const up2 = at(x, y - 2);
          if ((up >= 0 && up < k) || (up2 >= 0 && up2 < k && bayer(x, y) < 0.5)) v += 0.15;
          const dn = at(x, y + 1);
          if (dn > k) v -= 0.75;
          let i = Math.floor((v + 1) * (nt - 1) * 0.5 + bayer(x, y) * 0.75);
          // Trouées sombres dans le feuillage.
          if (noise(x * 0.35, y * 0.35, t.seed + 99) < 0.2) i -= 2;
          i = Math.max(0, Math.min(nt - 1, i));
          // Bord découpé : feuilles isolées sur le pourtour.
          if (up < 0 && hash(x, y, t.seed + 7) > 0.62 && ly < -0.4) continue;
          let c = tones[i];
          if (snow && (up < 0 || (up !== k && ly < -0.5)) && ly < -0.2) c = hash(x, y, 9) > 0.25 ? C('#eef2f6') : C('#c8d0da');
          else if (snow && ly < -0.45 && i >= nt - 3) c = hash(x, y, 11) > 0.3 ? C('#e2e8ee') : C('#b8c2ce');
          r.set(x, y, c);
        }
      }
    }

    // Un sapin : étages de branches qui retombent, plus larges vers le bas.
    paintFir(r, t, tones) {
      const { H, look } = this;
      const h = t.ry * 2;
      const trunk = this.grade('#2a2420');
      for (let y = t.top + h - 2; y < Math.min(H, t.top + h + 4); y++) r.set(t.x, y, trunk);
      for (let y = 0; y < h; y++) {
        const tier = (y % 5) / 5;
        const w = Math.round((y / h) * t.rx * 1.6 * (0.7 + tier * 0.4)) + 1;
        for (let i = -w; i <= w; i++) {
          const v = -i / (w + 1) * 0.6 - tier * 0.5 + 0.2 + (hash(t.x + i, y, t.seed) - 0.5) * 0.4;
          let c = tones[Math.max(0, Math.min(4, Math.floor((v + 1) * 2.2 + bayer(t.x + i, y))))];
          if (look.snow && tier < 0.25 && hash(t.x + i, y, 3) > 0.3) c = C('#e8ecf2');
          r.set(t.x + i, t.top + y, c);
        }
      }
    }

    // Les immeubles du bas, à gauche : une maison au toit brun, l'immeuble au toit plat
    // technique (blocs de clim, gravier), sa façade et ses balcons orangés.
    paintBuildings(r, glow) {
      const { W, H, look } = this;
      const g = this.grade;
      const lit = look.night || look.lights >= 0.3;
      const winC = (x, y, top) => (lit && hash(x, y, 270) < (look.night ? 0.55 : 0.35) ? C(hash(x, y, 271) > 0.5 ? '#ffd890' : '#ffeab0') : g(top ? '#a4b6c8' : '#55657c'));
      // La maison au toit brun (deux pans), tout à gauche.
      const hx0 = -4;
      const hx1 = Math.round(W * 0.115);
      const ry = Math.round(H * 0.818);
      const ey = Math.round(H * 0.858);
      const roofA = g(look.snow ? '#eef2f6' : '#5a4a44');
      const roofB = g(look.snow ? '#c8d0da' : '#463a36');
      for (let y = ry; y < ey; y++) {
        const k = (y - ry) / (ey - ry);
        for (let x = hx0; x < hx1; x++) {
          let c = (x + Math.floor(y / 2)) % 4 === 0 ? roofB : roofA;
          if (x > hx0 + (hx1 - hx0) * (0.55 + k * 0.1)) c = mix(c, [20, 20, 30], 0.25);
          if (y === ry) c = mix(c, [255, 255, 255], 0.2);
          r.set(x, y, c);
        }
      }
      // Cheminée.
      r.rect(Math.round(W * 0.07), ry - 4, 3, 5, g('#8a7a6a'));
      r.rect(Math.round(W * 0.07) - 1, ry - 5, 5, 1, g('#5a4e46'));
      if (look.smoke) this.chimneys.push({ x: Math.round(W * 0.07) + 1, y: ry - 6, fore: true });
      // Façade crème sous le toit (se voit à gauche de l'immeuble).
      const wallC = g('#e2d6c0');
      for (let y = ey; y < H; y++) {
        for (let x = hx0; x < Math.round(W * 0.05); x++) {
          let c = x >= Math.round(W * 0.05) - 2 ? mix(wallC, [40, 40, 60], 0.25) : wallC;
          if ((y - ey) % 7 >= 2 && (y - ey) % 7 <= 4 && ((x % 6) + 6) % 6 >= 2 && ((x % 6) + 6) % 6 <= 3) {
            c = winC(x >> 2, (y - ey) / 7 | 0, (y - ey) % 7 === 2);
            if (c[0] > 200 && c[2] < 200) glow[r.i(x, y)] = 1;
          }
          r.set(x, y, c);
        }
      }
      // L'immeuble au toit plat : le toit vu d'en haut (gravier), l'acrotère, les blocs.
      const bx0 = Math.round(W * 0.045);
      const bx1 = Math.round(W * 0.24);
      const ty = Math.round(H * 0.872);
      const fy = Math.round(H * 0.918);
      const grav = [g(look.snow ? '#f0f2f6' : '#b4b2ac'), g(look.snow ? '#dce2ea' : '#a2a09a'), g(look.snow ? '#c8d0da' : '#c4c2bc')];
      for (let y = ty; y < fy; y++) {
        for (let x = bx0 + Math.round((fy - y) * 0.2); x < bx1; x++) {
          let c = grav[hash(x, y, 272) > 0.7 ? 1 : hash(x, y, 273) > 0.8 ? 2 : 0];
          if (y === ty || x === bx1 - 1) c = g('#dcdad4');
          if (y === fy - 1) c = g('#8a8884');
          r.set(x, y, c);
        }
      }
      // Blocs techniques (climatisation), une cage d'ascenseur.
      const box = (x, y, w, h) => {
        r.rect(x, y - h, w, h, g('#cfcdc8'));
        r.rect(x, y - h, w, 1, g('#eceae6'));
        r.rect(x + w - 1, y - h, 1, h, g('#8e8c88'));
        r.rect(x, y, w, 1, g('#7a7874'));
      };
      box(Math.round(W * 0.09), ty + 7, 7, 4);
      box(Math.round(W * 0.15), ty + 6, 5, 3);
      box(Math.round(W * 0.19), ty + 8, 9, 6);
      box(Math.round(W * 0.12), ty + 9, 3, 2);
      // Les grilles des blocs.
      for (let i = 1; i < 8; i += 2) r.set(Math.round(W * 0.19) + i, ty + 5, g('#7a7874'));
      // La façade : bandeaux, fenêtres, balcons orangés en colonne.
      const fac = g('#e6e4de');
      const facS = g('#c4c2bc');
      for (let y = fy; y < H; y++) {
        for (let x = bx0; x < bx1; x++) {
          const fl = (y - fy) % 8;
          let c = x > bx1 - 4 ? facS : fac;
          if (fl === 0) c = g('#9a9894');
          else if (fl >= 2 && fl <= 4 && (x - bx0) % 5 >= 1 && (x - bx0) % 5 <= 2) {
            c = winC((x - bx0) / 5 | 0, (y - fy) / 8 | 0, fl === 2);
            if (c[0] > 200 && c[2] < 200) glow[r.i(x, y)] = 1;
          }
          r.set(x, y, c);
        }
      }
      const bal = [g('#e0703a'), g('#c8542c'), g('#f09050')];
      const bxL = Math.round(W * 0.133);
      for (let y = fy + 3; y < H; y += 8) {
        r.rect(bxL, y, 9, 4, bal[0]);
        r.rect(bxL, y, 9, 1, bal[2]);
        r.rect(bxL + 8, y, 1, 4, bal[1]);
        r.rect(bxL - 1, y + 4, 11, 1, g('#5a5a5e'));
      }
      if (lit) {
        this.lamps.push({ x: bxL + 4, y: fy + 4, r: 14, k: 0.3, fore: true });
      }
      // Prolongement : d'autres toits savoyards (tuiles brunes, croupes).
      if (this.wide) r.only(() => this.paintExtRoofs(r, glow));
    }

    paintExtRoofs(r, glow) {
      const { W, H, look } = this;
      const g = this.grade;
      const roofs = ['#7a4a3a', '#5a4a44', '#8a5a42', '#6a5a50'];
      for (let k = 0; k < 12; k++) {
        const x0 = Math.round(-0.03 * W - k * W * 0.14 - hash(k, 1, 280) * W * 0.04);
        if (x0 < this.X0 - W * 0.1) break;
        const w = Math.round(W * (0.07 + hash(k, 2, 280) * 0.06));
        const top = Math.round(H * (0.83 + hash(k, 3, 280) * 0.06));
        const rc = g(look.snow ? '#eef2f6' : roofs[k % roofs.length]);
        const rs = mix(rc, [20, 20, 30], 0.3);
        const ey = top + Math.round(H * 0.07);
        for (let y = top; y < ey; y++) {
          const inset = Math.round((ey - y) * 0.6);
          for (let x = x0 - w + inset; x < x0 - inset; x++) r.set(x, y, (x + y) % 5 === 0 ? rs : x > x0 - w * 0.45 ? rs : rc);
        }
        const wall = g(hash(k, 4, 280) > 0.5 ? '#e8dcc6' : '#ded8cc');
        for (let y = ey; y < H; y++) {
          for (let x = x0 - w + 2; x < x0 - 2; x++) {
            let c = x > x0 - 6 ? mix(wall, [40, 40, 60], 0.25) : wall;
            if ((y - ey) % 7 >= 2 && (y - ey) % 7 <= 4 && (x - x0) % 6 === 0) {
              const on = (look.night || look.lights >= 0.3) && hash(x, y, 281) < 0.5;
              c = on ? C('#ffd890') : g('#3a4250');
              if (on) glow[r.i(x, y)] = 1;
            }
            r.set(x, y, c);
          }
        }
      }
    }

    // Lampadaire (fût gris, lanterne) ; allumé le soir.
    paintLamp(r, glow, x, y0, ext = false) {
      const { H, look } = this;
      const g = this.grade;
      const pole = g('#3a3e44');
      const poleL = g('#6a7078');
      for (let y = y0; y < H; y++) {
        r.set(x, y, pole);
        r.set(x - 1, y, y % 3 === 0 ? poleL : pole);
      }
      r.rect(x - 2, y0 - 1, 4, 1, pole);
      const on = look.night || look.lights >= 0.3;
      r.rect(x - 2, y0 - 3, 4, 2, on ? C('#fff0c0') : g('#c8ccd0'));
      r.rect(x - 2, y0 - 4, 4, 1, pole);
      if (on) {
        for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) if (x - 2 + i >= r.x0) glow[r.i(x - 2 + i, y0 - 3 + j)] = 1;
        (ext ? this.extLamps : this.lamps).push({ x, y: y0 - 2, r: 16, k: 0.6, fore: true });
        if (!ext) this.lampHead = { x, y: y0 - 2 };
      }
    }

    // Pluie : reflets mouillés sur les toits et le lampadaire.
    wetShine(r, glow) {
      const { H } = this;
      const sheen = C(this.look.sky[7]);
      for (let y = Math.round(H * 0.8); y < H; y++) {
        for (let x = r.x0; x < r.x1; x++) {
          if (glow[r.i(x, y)] || r.alpha(x, y - 1) !== 0) continue;
          if (hash(x, y, 290) > 0.5) r.tint(x, y, sheen, 0.4);
        }
      }
    }

    paintHalo() {
      const { W, H, look } = this;
      const halos = [];
      const night = look.night;
      for (const l of this.lamps) halos.push({ x: l.x, y: l.y, r: l.small ? (night ? 7 : 5) : Math.round(l.r * 0.8), c: l.c || [255, 190, 110], k: l.small ? 0.28 : 0.34 });
      if (this.moon) halos.push({ x: this.moon.x, y: this.moon.y, r: 22, c: [170, 180, 230], k: 0.18 });
      const extra = this.extLamps.map((l) => ({ x: l.x, y: l.y, r: l.small ? 7 : Math.round(l.r * 0.8), c: l.c || [255, 190, 110], k: l.small ? 0.28 : 0.34 }));
      return makeHalo(W, H, this.extL, this.extR, halos, extra);
    }

    /* ================= Petits personnages et bateaux ================= */
    makeSprites() {
      const { look } = this;
      const night = look.night;
      const tone = (h) => (night ? mix(C(h), [20, 28, 56], 0.5) : this.grade(h));
      const hx = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
      const P = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hx(tone(v))]));
      const S = (rows, pal, flip) => B.PX.sprite(rows, P(pal), flip);
      // Voiliers : trois tailles, voile blanche (parfois un spi coloré), coque, reflet.
      const SAILS = [
        ['.w.', 'ww.', 'ww.', 'hhh'],
        ['..w..', '..ww.', '.www.', '.www.', 'hhhhh'],
        ['...w...', '...ww..', '..www..', '..wwww.', '.wwwww.', '.wwwww.', 'hhhhhhh', '.hhhhh.'],
      ];
      const sailCols = ['#fbfbf8', '#fbfbf8', '#fbfbf8', '#f2d44a', '#e05a48', '#4a8ad8'];
      this.sailImgs = sailCols.map((sc) => SAILS.map((rows) => ({ r: S(rows, { w: sc, h: '#f4f4f0' }), l: S(rows, { w: sc, h: '#f4f4f0' }, true), w: rows[0].length, h: rows.length })));
      // Cygne, canard (deux images : la tête bouge).
      const SW = [['..wb', '..w.', 'www.'], ['.wb.', '..w.', 'www.']];
      this.swanImgs = SW.map((rows) => S(rows, { w: '#fbfbf6', b: '#e8903a' })).concat(SW.map((rows) => S(rows, { w: '#fbfbf6', b: '#e8903a' }, true)));
      this.duckImgs = [S(['.g', 'bbb'], { g: '#2e6a3a', b: '#7a5a3a' }), S(['g.', 'bbb'], { g: '#2e6a3a', b: '#7a5a3a' })];
      // Le paddle : quelqu'un debout sur une planche, la pagaie de chaque côté.
      this.paddleImgs = [
        S(['.h..', '.t..', '.tp.', '.l.p', 'bbbbb'], { h: '#e8b48c', t: '#e05a48', l: '#2a3a5a', p: '#3a2a20', b: '#f2f2ee' }),
        S(['.h..', 'pt..', 'pt..', '.l..', 'bbbbb'], { h: '#e8b48c', t: '#e05a48', l: '#2a3a5a', p: '#3a2a20', b: '#f2f2ee' }),
      ];
      // Promeneurs minuscules sur le ponton (vus de loin) : deux images de marche.
      const walkerPal = (top) => ({ h: '#e8b48c', t: top, l: '#2a3048', u: look.umbrella ? '#d4564f' : top });
      this.tinyWalkers = ['#3a6ad8', '#e0703a', '#f2f2ee', '#4a8a5a'].map((top) => {
        const pal = walkerPal(top);
        const rows = look.umbrella ? [['uuu', '.h.', '.t.', '.l.'], ['uuu', '.h.', '.t.', 'l.l']] : [['h.', 'tt', 'tt', 'll'], ['h.', 'tt', 'tt', 'l.']];
        return rows.map((r) => S(r, pal));
      });
      // Bateau à moteur (petit, blanc) et sa vague.
      this.motorImgs = [S(['..ww.', 'hhhhh'], { w: '#c8d4e0', h: '#f6f6f2' }), S(['.ww..', 'hhhhh'], { w: '#c8d4e0', h: '#f6f6f2' })];
      // Oiseaux (petits) pour le vol.
      const bc = night ? '#1a2030' : look.wet ? '#2c323a' : '#3a4450';
      this.birdFrames = [S(['b...b', '.b.b.', '..b..'], { b: bc }), S(['.....', 'bbbbb', '..b..'], { b: bc })];
      // Parapentes : voile en arc colorée, suspentes, pilote.
      const PARA = ['.cccc.', 'cCCCCc', 'c....c', '.l..l.', '..lp..', '...p..'];
      this.paraImgs = ['#e8483c', '#f2c230', '#3a8ad8', '#56b86a', '#e070b0', '#f08a30'].map((cc) => S(PARA, { c: cc, C: hx(mix(C(cc), [255, 255, 255], 0.35)), l: '#6a6a70', p: '#2a2a34' }));
      this.steamerImgs = {};
      for (const dir of [1, -1]) {
        const rows = this.steamerRows();
        const pal = this.steamerPal(look.night || look.lights >= 0.3);
        const r = new Raster(rows[0].length, rows.length);
        rows.forEach((row, j) => {
          for (let i = 0; i < row.length; i++) {
            const ch = row[dir > 0 ? i : row.length - 1 - i];
            if (ch !== '.') r.set(i, j, pal[ch]);
          }
        });
        this.steamerImgs[dir] = r.toCanvas();
      }
    }

    // Remet en place la vie de la scène (à chaque changement d'ambiance).
    resetLife() {
      const { W, H, L, look } = this;
      const X0 = this.X0;
      const X1 = this.X1;
      const span = X1 - X0;
      // Couloirs de navigation : du large (loin, petits) au près.
      const lanes = [0.645, 0.655, 0.668, 0.682, 0.695, 0.708];
      this.sails = [];
      const nS = look.sails ? Math.round((look.sails * span) / W) : 0;
      for (let i = 0; i < nS; i++) {
        const lane = lanes[i % lanes.length];
        const y = Math.round(H * (lane + hash(i, 1, 300) * 0.006));
        const size = lane < 0.66 ? 0 : lane < 0.69 ? 1 : 2;
        // Au début, une petite régate près de l'Impérial (comme sur la photo).
        let x = X0 + hash(i, 2, 300) * span;
        if (i < 3) x = W * (0.63 + i * 0.04);
        this.sails.push({ x, y, size: i < 3 ? 0 : size, dir: hash(i, 3, 300) < 0.5 ? 1 : -1, v: 0.6 + hash(i, 4, 300) * 1.4, col: hash(i, 5, 300) < 0.2 ? 3 + (i % 3) : i % 3, p: hash(i, 6, 300) * 6, tack: 20 + hash(i, 7, 300) * 40 });
      }
      // Le bateau de croisière : déjà au milieu du lac au début.
      this.steamer = look.steamer ? { x: W * 0.42, y: Math.round(H * 0.706), dir: 1, v: 3.2 } : null;
      this.nextSteamer = 30 + Math.random() * 30;
      this.wake = [];
      this.motor = null;
      this.nextMotor = 8 + Math.random() * 12;
      this.paddle = look.paddle ? { x: W * 0.16, y: Math.round(H * 0.705), dir: 1, v: 0.9, t: 0 } : null;
      // Cygnes et canards près du port.
      this.swans = [];
      if (look.swans) {
        const n = look.night ? 0 : 3;
        for (let i = 0; i < n; i++) this.swans.push({ x: W * (0.36 + i * 0.05), y: Math.round(H * (0.78 + i * 0.008)), hx: W * (0.36 + i * 0.05), p: i * 2.1, kind: i === 2 ? 'duck' : 'swan', dir: i % 2 ? -1 : 1 });
        this.swans.push({ x: W * 0.415, y: Math.round(H * 0.792), hx: W * 0.415, p: 4, kind: 'duck', dir: 1 });
      }
      // Promeneurs sur le ponton.
      this.walkers = [];
      if (look.walkers && this.pier) {
        const n = 2;
        for (let i = 0; i < n; i++) this.walkers.push({ x: this.pier.x0 + 4 + i * 18, dir: i ? -1 : 1, v: 1.6 + i * 0.4, pause: 0, set: this.tinyWalkers[i % this.tinyWalkers.length], t: 0 });
      }
      // Parapentes : au-dessus de la montagne de droite (et du Semnoz).
      this.paras = [];
      const nP = look.para || 0;
      for (let i = 0; i < nP; i++) this.paras.push(this.newPara(i, true));
      if (this.wide && nP) for (let i = 0; i < 2; i++) this.paras.push(this.newPara(10 + i, true, true));
      // Oiseaux.
      this.flock = look.birds ? new X.Flock({ x0: X0, x1: X1, y0: Math.round(H * 0.18), y1: Math.round(H * 0.42), rate: [8, 18], color: '#3a4450' }) : null;
      if (this.flock) {
        this.flock.frames = this.birdFrames;
        if (this.fast) this.flock.next = 0.3;
      }
      this.flies = look.fireflies ? Array.from({ length: Math.round((22 * span) / W) }, () => this.newFly()) : [];
      this.smoke = new X.Puffs(look.wet ? '170,176,186' : '226,230,236');
      // Feux d'artifice : les nuits d'été (forcés avec #fireworks dans l'adresse, pour les captures).
      this.fwForce = typeof location !== 'undefined' && location.hash === '#fireworks';
      this.fwOn = !!look.fireworks || this.fwForce;
      this.rockets = [];
      this.sparks = [];
      this.fwSmoke = [];
      this.flashes = [];
      this.nextSalvo = this.fwForce ? 0.1 : 1.5 + Math.random() * 3;
      this.meteors = [];
      this.nextMeteor = 1.5;
      this.rings = [];
      this.flash = 0;
      this.bolt = null;
      this.nextBolt = 5;
      this.nextToggle = 4;
      // Un drone qui se balade au-dessus du lac (pas sous la pluie, l'orage ou la neige),
      // et, pendant les feux d'artifice, un drone qui tient une boule à facettes au bout
      // d'une corde.
      this.drone = look.wet || look.snow || this.effect === 'snow' ? null : this.newDrone();
      this.disco = this.fwOn ? this.newDisco() : null;
    }

    /* ================= Les drones ================= */

    // Les sprites du drone (celui de la scène Drones), et leur version de nuit : une
    // silhouette sombre, qu'on repère à ses feux.
    droneSet() {
      if (this._drone && this._droneNight === !!this.look.night) return this._drone;
      const D = B.DroneSprite && B.DroneSprite.mid;
      if (!D) return null;
      const dark = (img) => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height);
        for (let i = 0; i < d.data.length; i += 4) {
          d.data[i] = d.data[i] * 0.3 + 10;
          d.data[i + 1] = d.data[i + 1] * 0.32 + 12;
          d.data[i + 2] = d.data[i + 2] * 0.42 + 22;
        }
        g.putImageData(d, 0, 0);
        return c;
      };
      const night = !!this.look.night;
      this._droneNight = night;
      this._drone = { ...D, fly: night ? D.fly.map(dark) : D.fly };
      return this._drone;
    }

    newDrone() {
      const { W, H } = this;
      const d = { x: W * (0.3 + Math.random() * 0.4), y: H * (0.34 + Math.random() * 0.12), vx: 0, vy: 0, wait: 1 + Math.random() * 2, tx: 0, ty: 0 };
      this.droneTarget(d);
      return d;
    }

    // Prochaine étape : au-dessus du lac, de la ville ou de la rive, à hauteur variable.
    droneTarget(d) {
      const { W, H } = this;
      const lo = Math.max(this.X0 + 12, -W * 0.4);
      const hi = Math.min(this.X1 - 12, W * 1.25);
      d.tx = lo + Math.random() * (hi - lo);
      d.ty = H * (0.28 + Math.random() * 0.24);
    }

    newDisco() {
      const { W, H } = this;
      const hx = W * 0.2;
      return { hx, hy: H * 0.27, x: hx, y: H * 0.27, px: hx, pvx: 0, ang: 0.2, angV: 0, rope: 16, rot: 0 };
    }

    // Un drone qui se balade : il accélère, freine, s'arrête un moment en vol stationnaire.
    updateDrone(dt) {
      const d = this.drone;
      if (!d) return;
      if (d.wait > 0) {
        d.wait -= dt;
        d.vx *= Math.pow(0.05, dt);
        d.vy *= Math.pow(0.05, dt);
      } else {
        const dx = d.tx - d.x;
        const dy = d.ty - d.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 3) {
          d.wait = 1.5 + Math.random() * 4;
          this.droneTarget(d);
        } else {
          const vmax = Math.min(16, dist * 0.9); // freine en arrivant
          const ax = (dx / dist) * vmax - d.vx;
          const ay = (dy / dist) * vmax - d.vy;
          d.vx += ax * Math.min(1, dt * 1.6);
          d.vy += ay * Math.min(1, dt * 1.6);
        }
      }
      d.x += d.vx * dt;
      d.y += d.vy * dt;
    }

    // La boule à facettes : le drone flotte en huit au-dessus du lac, la boule se balance
    // au bout de sa corde (un pendule poussé par les mouvements du drone) et tourne.
    updateDisco(dt) {
      const b = this.disco;
      if (!b) return;
      const t = this.t;
      b.x = b.hx + Math.sin(t * 0.21) * this.W * 0.07;
      b.y = b.hy + Math.sin(t * 0.42) * 4;
      const vx = (b.x - b.px) / Math.max(dt, 1e-3);
      const ax = (vx - b.pvx) / Math.max(dt, 1e-3);
      b.px = b.x;
      b.pvx = vx;
      const acc = -(60 / b.rope) * Math.sin(b.ang) - (Math.max(-40, Math.min(40, ax)) / b.rope) * Math.cos(b.ang) - b.angV * 0.6;
      b.angV += acc * dt;
      b.ang += b.angV * dt;
      b.rot += dt * 1.4;
    }

    // Dessine un drone (centre x, y) ; la nuit, ses feux : rouge à gauche, vert à droite,
    // un flash blanc régulier.
    paintDrone(g, x, y, t, phase) {
      const S = this.droneSet();
      if (!S) return;
      const img = S.fly[Math.floor(t * 24) % 2];
      const x0 = Math.round(x - S.w / 2);
      const y0 = Math.round(y - S.h / 2);
      g.drawImage(img, x0, y0);
      if (!this.look.night) return;
      g.fillStyle = '#ff3a2e';
      g.fillRect(x0 + S.navL[0], y0 + S.navL[1], 1, 1);
      g.fillStyle = '#3cff7a';
      g.fillRect(x0 + S.navR[0], y0 + S.navR[1], 1, 1);
      if ((t + phase) % 1.3 < 0.09) {
        g.fillStyle = '#ffffff';
        g.fillRect(x0 + S.strobe[0], y0 + S.strobe[1], 1, 1);
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillRect(x0 + S.strobe[0] - 1, y0 + S.strobe[1], 3, 1);
        g.fillRect(x0 + S.strobe[0], y0 + S.strobe[1] - 1, 1, 3);
      }
    }

    drawDrone(g, t) {
      const d = this.drone;
      if (!d) return;
      this.paintDrone(g, d.x, d.y + Math.sin(t * 2.3) * 0.6, t, 0);
    }

    drawDisco(g, t) {
      const b = this.disco;
      if (!b) return;
      const S = this.droneSet();
      const dy = b.y + Math.sin(t * 2.1) * 0.5;
      this.paintDrone(g, b.x, dy, t, 0.6);
      // La corde, du ventre du drone jusqu'à la boule.
      const ax = Math.round(b.x);
      const ay = Math.round(dy + (S ? S.h / 2 : 3));
      const bx = Math.round(ax + Math.sin(b.ang) * b.rope);
      const by = Math.round(ay + Math.cos(b.ang) * b.rope);
      const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
      g.fillStyle = this.look.night ? 'rgba(150,156,176,0.75)' : 'rgba(70,74,86,0.9)';
      for (let i = 0; i <= n; i++) g.fillRect(Math.round(ax + ((bx - ax) * i) / n), Math.round(ay + ((by - ay) * i) / n), 1, 1);
      // La boule : des facettes en damier qui défilent en tournant, éclairées par les
      // feux d'artifice proches.
      const R = 4.6;
      const cx = bx;
      const cy = by + 5;
      // Un léger halo autour de la boule, la nuit.
      if (this.look.night) {
        for (let y = -9; y <= 9; y++) {
          for (let x = -9; x <= 9; x++) {
            const d = Math.hypot(x, y) / 9;
            if (d >= 1 || d < 0.45) continue;
            const q = Math.floor((1 - d) * 3 + bayer(cx + x, cy + y) * 0.9) / 3;
            if (q <= 0) continue;
            g.fillStyle = `rgba(190,205,255,${(q * 0.16).toFixed(3)})`;
            g.fillRect(cx + x, cy + y, 1, 1);
          }
        }
      }
      let tint = null;
      for (const f of this.flashes || []) {
        const dd = Math.hypot(f.x - cx, f.y - cy);
        if (dd < 70) {
          const w = (1 - dd / 70) * (1 - f.age / 0.7);
          if (!tint || w > tint.w) tint = { w, c: FW_COLORS[f.ci] };
        }
      }
      const tones = [[70, 76, 92], [130, 138, 156], [196, 204, 220], [244, 248, 255]];
      for (let y = -5; y <= 5; y++) {
        for (let x = -5; x <= 5; x++) {
          const r2 = (x * x) / (R * R) + (y * y) / (R * R);
          if (r2 > 1) continue;
          const lon = Math.asin(Math.max(-1, Math.min(1, x / (R * Math.sqrt(1 - Math.min(0.99, (y * y) / (R * R))) || 1))));
          const col = Math.floor((lon / Math.PI) * 6 + b.rot * 2);
          const row = y + 5;
          let k = ((col + row) & 1) + (x < 0 ? 1 : 0) + (y < 0 ? 1 : 0);
          if (r2 > 0.7) k = Math.max(0, k - 1);
          let c = tones[Math.min(3, k)];
          if (hash(col & 1023, row, Math.floor(t * 6)) > 0.93) c = [255, 255, 255]; // une facette qui brille
          if (tint) c = [c[0] + (tint.c[0] - c[0]) * tint.w * 0.6, c[1] + (tint.c[1] - c[1]) * tint.w * 0.6, c[2] + (tint.c[2] - c[2]) * tint.w * 0.6];
          g.fillStyle = css(c, 1);
          g.fillRect(cx + x, cy + y, 1, 1);
        }
      }
      // L'étoile qui scintille sur la boule.
      if (Math.sin(t * 3.1) > 0.2) {
        const sx = cx - 2;
        const sy = cy - 2;
        g.fillStyle = 'rgba(255,255,255,0.95)';
        g.fillRect(sx, sy, 1, 1);
        g.fillStyle = 'rgba(255,255,255,0.55)';
        g.fillRect(sx - 2, sy, 5, 1);
        g.fillRect(sx, sy - 2, 1, 5);
      }
      // Les reflets de la boule : des petits points de lumière qui tournent autour d'elle,
      // dans le ciel et sur le lac.
      g.globalCompositeOperation = 'lighter';
      const sh = this.shoreY(cx);
      const SPOTS = [[255, 255, 255], [255, 170, 220], [150, 220, 255], [255, 236, 160]];
      for (let i = 0; i < 26; i++) {
        const a = i * 2.39996 + b.rot * (i % 2 ? 0.9 : -0.7);
        const rr = 9 + ((i * 37) % 34);
        const x = Math.round(cx + Math.cos(a) * rr);
        const y = Math.round(cy + Math.sin(a) * rr * 0.55);
        const tw = 0.5 + 0.5 * Math.sin(t * 5 + i * 1.7);
        g.fillStyle = css(SPOTS[i % SPOTS.length], (this.look.night ? 0.75 : 0.3) * tw);
        g.fillRect(x, y, 1, 1);
        // Sur l'eau, le même point, renvoyé plus bas.
        const ry = Math.round(sh + (sh - y) * 0.3 + 6);
        if (this.lakeMask && this.lakeMask[ry * this.water.sw + x + this.extL]) {
          g.fillStyle = css(SPOTS[i % SPOTS.length], (this.look.night ? 0.3 : 0.15) * tw);
          g.fillRect(x, ry, 2, 1);
        }
      }
      g.globalCompositeOperation = 'source-over';
    }

    newPara(i, initial, semnoz = false) {
      const { W, H } = this;
      const cu = semnoz ? -0.95 + hash(i, 1, 310) * 0.4 : 0.8 + hash(i, 1, 310) * 0.32;
      // Juste au-dessus de la crête (les thermiques du relief), pas dans les nuages.
      return {
        cx: W * cu,
        cy: this.mountY(W * cu) - H * (0.035 + hash(i, 2, 310) * 0.07),
        rad: 8 + hash(i, 3, 310) * 10,
        a: hash(i, 4, 310) * 6.28,
        w: (0.18 + hash(i, 5, 310) * 0.12) * (hash(i, 6, 310) < 0.5 ? 1 : -1),
        drift: (hash(i, 7, 310) - 0.5) * 0.6,
        sink: 0.15 + hash(i, 8, 310) * 0.2,
        img: Math.floor(hash(i, 9, 310) * 6),
        semnoz,
        id: i,
      };
    }

    newFly() {
      const { H } = this;
      const x0 = this.X0;
      const w = this.X1 - this.X0;
      return { x: 0, y: 0, p: Math.random() * 6, s: 0.5 + Math.random(), hx: x0 + Math.random() * w, hy: H * (0.62 + Math.random() * 0.34) };
    }

    /* ================= Vie de la scène ================= */
    update(dt, ctx) {
      const eff = (ctx && ctx.effect) || 'none';
      if (eff !== this.effect) this.build(eff);
      const { W, H, L, look } = this;
      this.t += dt;
      const t = this.t;
      const fast = this.fast ? 4 : 1;
      const X0 = this.X0;
      const X1 = this.X1;

      for (const c of this.drift) {
        c.x += c.v * dt * fast;
        if (c.x > X1 + 4) c.x = X0 - c.w - 4;
      }
      if (this.flock) this.flock.update(dt);

      // Voiliers : ils dérivent, tanguent, et virent de bord de temps en temps.
      for (const s of this.sails) {
        s.x += s.dir * s.v * dt * fast;
        s.tack -= dt * fast;
        if (s.tack <= 0 || s.x < X0 + 4 || s.x > X1 - 10) {
          s.dir = s.x < X0 + 4 ? 1 : s.x > X1 - 10 ? -1 : -s.dir;
          s.tack = 25 + Math.random() * 45;
        }
      }
      // Le bateau de croisière et son sillage.
      if (this.steamer) {
        const st = this.steamer;
        st.x += st.dir * st.v * dt * fast;
        if (Math.random() < dt * 6) this.wake.push({ x: st.dir > 0 ? st.x + 1 : st.x + 25, y: st.y + 1, age: 0, dir: st.dir });
        if (st.x > X1 + 40 || st.x < X0 - 40) this.steamer = null;
      } else if (look.steamer) {
        this.nextSteamer -= dt * fast;
        if (this.nextSteamer <= 0) {
          const dir = Math.random() < 0.5 ? 1 : -1;
          this.steamer = { x: dir > 0 ? X0 - 30 : X1 + 4, y: Math.round(H * (0.69 + Math.random() * 0.02)), dir, v: 3 + Math.random() };
          this.nextSteamer = 50 + Math.random() * 60;
        }
      }
      // Bateau à moteur : il file et laisse une vague.
      if (this.motor) {
        const m = this.motor;
        m.x += m.dir * m.v * dt;
        if (Math.random() < dt * 14) this.wake.push({ x: m.dir > 0 ? m.x : m.x + 5, y: m.y + 1, age: 0, dir: m.dir, small: true });
        if (m.x > X1 + 10 || m.x < X0 - 10) this.motor = null;
      } else if (look.motor) {
        this.nextMotor -= dt * fast;
        if (this.nextMotor <= 0) {
          const dir = Math.random() < 0.5 ? 1 : -1;
          this.motor = { x: dir > 0 ? X0 - 8 : X1 + 2, y: Math.round(H * (0.66 + Math.random() * 0.05)), dir, v: 14 + Math.random() * 8 };
          if (!this.wide) this.motor.x = dir > 0 ? -8 : W + 2;
          this.nextMotor = 25 + Math.random() * 40;
        }
      }
      for (const w of this.wake) w.age += dt;
      this.wake = this.wake.filter((w) => w.age < (w.small ? 3 : 6));
      // Le paddle : il longe la berge, fait demi-tour.
      if (this.paddle) {
        const p = this.paddle;
        p.t += dt;
        p.x += p.dir * p.v * dt * fast;
        if (p.x > W * 0.31) p.dir = -1;
        if (p.x < W * 0.09) p.dir = 1;
      }
      // Cygnes et canards : ils glissent autour de leur coin, près du port.
      for (const s of this.swans) {
        const nx = s.hx + Math.sin(t * 0.05 + s.p) * 14;
        s.dir = nx > s.x ? 1 : -1;
        s.x = nx;
      }
      // Promeneurs du ponton : ils vont et viennent, s'arrêtent regarder l'eau.
      if (this.pier) {
        for (const w of this.walkers) {
          w.t += dt;
          if (w.pause > 0) {
            w.pause -= dt;
            continue;
          }
          w.x += w.dir * w.v * dt * fast;
          if (w.x > this.pier.x1 - 2) {
            w.dir = -1;
            w.pause = 3 + Math.random() * 5;
          }
          if (w.x < this.pier.x0) {
            w.dir = 1;
            w.pause = 2 + Math.random() * 4;
          }
          if (Math.random() < dt * 0.04) w.pause = 2 + Math.random() * 4;
        }
      }
      // Parapentes : ils spiralent dans les thermiques, dérivent, descendent doucement.
      for (let i = 0; i < this.paras.length; i++) {
        const p = this.paras[i];
        p.a += p.w * dt * fast;
        p.cx += p.drift * dt * fast;
        p.cy += p.sink * dt * fast * 0.25;
        const pu = p.cx / W;
        if (p.cy > this.mountY(p.cx) - 6 || (p.semnoz ? pu < -1.4 || pu > -0.35 : pu < 0.74 || pu > 1.3)) this.paras[i] = this.newPara(p.id + 17 + Math.floor(t), false, p.semnoz);
      }
      this.updateFireworks(dt);
      this.updateDrone(dt);
      this.updateDisco(dt);
      // Fumées des cheminées.
      if (look.smoke) for (const c of this.chimneys) if (Math.random() < dt * (c.fore ? 2 : 0.6)) this.smoke.emit(c.x + (Math.random() - 0.5), c.y, c.fore ? 4 : 2.5, c.fore ? 5 : 3);
      this.smoke.update(dt);
      // Ronds de pluie sur le lac.
      if (look.rings && this.waterPts.length) {
        const n = dt * 40 * look.rings * ((X1 - X0) / W);
        for (let k = 0; k < n || Math.random() < n - k; k++) {
          const p = this.waterPts[Math.floor(Math.random() * this.waterPts.length)];
          this.rings.push({ x: p[0], y: p[1], age: 0 });
          if (k > 8) break;
        }
        for (const r of this.rings) r.age += dt;
        this.rings = this.rings.filter((r) => r.age < 0.7);
      }
      // Fenêtres qui s'allument et s'éteignent en ville.
      this.nextToggle -= dt * fast;
      if (this.nextToggle <= 0) {
        for (const l of this.cityLights) if (Math.random() < 0.06) l.on = !l.on;
        this.nextToggle = 3 + Math.random() * 6;
      }
      // Lucioles.
      for (const f of this.flies) {
        f.x = f.hx + Math.sin(t * 0.35 * f.s + f.p) * 16;
        f.y = f.hy + Math.sin(t * 0.5 * f.s + f.p * 2) * 6;
      }
      // Étoiles filantes.
      if (look.meteors) {
        this.nextMeteor -= dt;
        if (this.nextMeteor <= 0) {
          this.meteors.push({ x: X0 + Math.random() * (X1 - X0) * 0.9, y: Math.random() * L.hz * 0.4, age: 0, life: 0.9, dx: (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 20), dy: 18 + Math.random() * 10 });
          this.nextMeteor = 2 + Math.random() * 5;
        }
        for (const m of this.meteors) m.age += dt;
        this.meteors = this.meteors.filter((m) => m.age < m.life);
      }
      // Orage : un éclair au-dessus des montagnes.
      if (this.flash > 0) this.flash -= dt;
      if (look.storm) {
        this.nextBolt -= dt * fast;
        if (this.nextBolt <= 0) {
          this.flash = 0.55;
          const pts = [];
          let x = this.wide ? X0 * 0.6 + Math.random() * (W * 0.9 - X0 * 0.6) : W * (0.15 + Math.random() * 0.75);
          const yEnd = Math.min(this.mountY(x), H * 0.47) - 2;
          for (let y = Math.round(H * 0.1); y < yEnd; y += 3 + Math.floor(Math.random() * 4)) {
            pts.push([Math.round(x), y]);
            x += (Math.random() - 0.5) * 8;
          }
          this.bolt = pts;
          this.nextBolt = 6 + Math.random() * 12;
        }
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

      // 1. Ciel, montagnes ; nuages qui avancent, parapentes, oiseaux.
      g.drawImage(this.back, wx0, 0);
      for (const s of this.twinkles) {
        const b = 0.5 + 0.5 * Math.sin(t * s.s + s.p);
        if (b < 0.55) continue;
        g.fillStyle = `rgba(${s.c.join(',')},${(b * 0.9).toFixed(2)})`;
        g.fillRect(s.x, s.y, 1, 1);
      }
      for (const m of this.meteors) {
        const k = m.age / m.life;
        const x = m.x + m.dx * m.age;
        const y = m.y + m.dy * m.age;
        for (let i = 0; i < 10; i++) {
          g.fillStyle = `rgba(235,240,255,${((1 - i / 10) * (1 - k) * 0.9).toFixed(2)})`;
          g.fillRect(Math.round(x - (m.dx / 60) * i * 1.6), Math.round(y - (m.dy / 60) * i * 1.6), 1, 1);
        }
      }
      for (const c of this.drift) g.drawImage(c.img, Math.round(c.x), c.y);
      if (this.bolt && this.flash > 0.12 && !(this.flash > 0.36 && this.flash < 0.44)) {
        g.fillStyle = '#eef0ff';
        const pts = this.bolt;
        for (let k = 0; k + 1 < pts.length; k++) {
          const [x0, y0] = pts[k];
          const [x1, y1] = pts[k + 1];
          const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
          for (let j = 0; j <= n; j++) g.fillRect(Math.round(x0 + ((x1 - x0) * j) / n), Math.round(y0 + ((y1 - y0) * j) / n), 1, 1);
        }
      }
      this.drawParas(g, t);
      if (this.flock) this.flock.draw(g);

      // 2. La ville, la rive, le lac.
      g.drawImage(this.mid, wx0, 0);
      for (const l of this.cityLights) {
        if (l.on) continue;
        g.fillStyle = l.off;
        g.fillRect(l.x, l.y, 1, 1);
      }
      this.drawWater(g, t);
      this.drawBoats(g, t);
      this.smoke.draw(g, 0.35);
      this.drawDrone(g, t);
      this.drawFireworks(g, t);
      this.drawDisco(g, t);

      // 3. Le premier plan : grands arbres, port, immeubles.
      g.drawImage(this.fore, wx0, 0);
      this.drawPort(g, t);

      // 4. Lumières ajoutées : halos, lampadaire, lucioles.
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.88 + 0.05 * Math.sin(t * 1.3) + 0.04 * Math.sin(t * 7.7);
      g.drawImage(this.halo, wx0, 0);
      g.globalAlpha = 1;
      if (this.lampHead) {
        const fl = 0.1 + 0.04 * Math.sin(t * 9) + 0.03 * Math.sin(t * 5.3);
        g.fillStyle = `rgba(255,190,110,${fl.toFixed(3)})`;
        g.fillRect(this.lampHead.x - 3, this.lampHead.y - 3, 6, 6);
      }
      for (const f of this.flies) {
        const a = Math.max(0, Math.sin(t * 2 * f.s + f.p));
        if (a < 0.1) continue;
        const x = Math.round(f.x);
        const y = Math.round(f.y);
        g.fillStyle = `rgba(200,255,120,${(a * 0.25).toFixed(3)})`;
        g.fillRect(x - 1, y - 1, 3, 3);
        g.fillStyle = `rgba(230,255,160,${a.toFixed(3)})`;
        g.fillRect(x, y, 1, 1);
      }
      g.globalCompositeOperation = 'source-over';

      // Éclair d'orage : tout blanchit un instant.
      if (this.flash > 0) {
        const f = this.flash;
        const a = f > 0.44 ? 0.34 : f > 0.36 ? 0.05 : f > 0.12 ? 0.2 * ((f - 0.12) / 0.24) : 0;
        if (a > 0) {
          g.fillStyle = `rgba(205,215,255,${a.toFixed(3)})`;
          g.fillRect(wx0, 0, this.X1 - wx0, H);
        }
      }
    }

    // L'eau qui vit : rides qui ondulent (découpées au masque du lac), paillettes du
    // soleil, reflets des lumières de la rive, de la lune, ronds de pluie.
    drawWater(g, t) {
      const { W, H, look } = this;
      const wat = this.water;
      const wg = this.wg;
      wg.globalCompositeOperation = 'source-over';
      wg.clearRect(0, 0, wat.sw, wat.h);
      const amp = look.caps ? 2.2 : look.wet ? 1.5 : 1;
      for (let j = 0; j < wat.h; j += 2) {
        const hh = Math.min(2, wat.h - j);
        const k = j / wat.h;
        const ox = Math.round(Math.sin(t * 0.7 * amp + j * 0.45) * (0.6 + k * 1.8 * amp));
        wg.drawImage(this.waterTex, 0, j, wat.sw, hh, ox, j, wat.sw, hh);
      }
      wg.globalCompositeOperation = 'destination-in';
      wg.drawImage(this.maskCanvas, 0, 0);
      wg.globalCompositeOperation = 'source-over';
      g.drawImage(this.wbuf, this.X0, wat.y0);

      const pts = this.waterPts;
      // Paillettes du soleil (le jour) ou moutons d'écume (orage).
      if ((look.glitter || look.caps) && pts.length) {
        const m = Math.min(260, Math.round(((look.caps ? 60 : 36) * (this.X1 - this.X0)) / W));
        for (let k = 0; k < m; k++) {
          const ph = t * (look.caps ? 0.6 : 0.5) + hash(k, 1, 401);
          const life = frac(ph);
          const id = Math.floor(ph);
          const p = pts[Math.floor(hash(k, id, 402) * pts.length)];
          const a = Math.sin(life * Math.PI);
          if (a < 0.2) continue;
          const near = clamp01((p[1] - H * 0.62) / (H * 0.2));
          if (look.caps) {
            g.fillStyle = `rgba(230,236,240,${(0.75 * a).toFixed(2)})`;
            g.fillRect(p[0], p[1], 1 + Math.floor(near * 3), 1);
          } else {
            g.fillStyle = `rgba(255,255,250,${(look.glitter * a).toFixed(2)})`;
            g.fillRect(p[0], p[1], 1 + (near > 0.5 && a > 0.7 ? 1 : 0), 1);
          }
        }
      }
      // Reflets des lumières de la rive : des colonnes qui tremblent dans l'eau.
      const shore = this.wide && this.extShore ? this.shoreLights.concat(this.extShore) : this.shoreLights;
      if (shore.length) {
        g.globalCompositeOperation = 'lighter';
        const step = Math.floor(t * 5);
        for (const l of shore) {
          const sh = this.shoreY(l.x);
          const len = Math.round((look.night ? 14 : 8) * l.k);
          for (let j = 1; j < len; j++) {
            const hh = hash(l.x, j + step * 7, 410);
            if (hh < 0.35) continue;
            const dx = Math.round((hash(l.x, j + step * 3, 411) - 0.5) * (1 + j * 0.15));
            const a = (1 - j / len) * 0.6 * l.k;
            g.fillStyle = `rgba(${l.c[0]},${l.c[1]},${l.c[2]},${a.toFixed(2)})`;
            g.fillRect(l.x + dx, sh + j, 1, 1);
          }
        }
        // Les fenêtres de la ville se reflètent aussi, plus faiblement.
        if (look.night) {
          for (const l of this.cityLights) {
            if (!l.on || l.y < H * 0.58) continue;
            const sh = this.shoreY(l.x);
            const j = 2 + Math.floor(hash(l.x, step, 412) * 6);
            if (hash(l.x, step, 413) < 0.5) continue;
            g.fillStyle = 'rgba(255,210,140,0.25)';
            g.fillRect(l.x, sh + j, 1, 1);
          }
        }
        g.globalCompositeOperation = 'source-over';
      }
      // La lune : une traînée de paillettes.
      if (this.moon) {
        g.fillStyle = 'rgba(240,236,220,0.55)';
        const mx = this.moon.x;
        const step = Math.floor(t * 4);
        for (let y = this.shoreY(mx) + 1; y < H * 0.8; y++) {
          const tt = (y - H * 0.62) / (H * 0.2);
          const hh = hash(y, step, 420);
          if (hh < 0.45) continue;
          const x = Math.round(mx + (hash(y, step, 421) - 0.5) * (3 + tt * 8));
          if (!this.lakeMask[(y * this.water.sw) + x + this.extL]) continue;
          g.fillRect(x, y, 1 + Math.floor(hh * 2), 1);
        }
      }
      // Ronds de pluie.
      if (this.rings.length) {
        g.fillStyle = 'rgba(200,214,226,0.55)';
        for (const r of this.rings) {
          const k = 1 + Math.floor(r.age * 5);
          g.fillRect(r.x - k, r.y, 1, 1);
          g.fillRect(r.x + k, r.y, 1, 1);
          if (r.age < 0.15) g.fillRect(r.x, r.y - 1, 1, 1);
        }
      }
    }

    // Voiliers, bateau de croisière, bateau à moteur, paddle, cygnes et canards.
    drawBoats(g, t) {
      const { H, look } = this;
      const night = look.night;
      // Sillages.
      for (const w of this.wake) {
        const life = w.small ? 3 : 6;
        const a = (1 - w.age / life) * (night ? 0.25 : 0.5);
        const spread = Math.round(w.age * (w.small ? 2 : 1.6));
        g.fillStyle = `rgba(240,248,250,${a.toFixed(2)})`;
        g.fillRect(Math.round(w.x), w.y + Math.floor(spread / 3), 1, 1);
        if (spread > 1) {
          g.fillRect(Math.round(w.x) - w.dir * 1, w.y + spread, 1, 1);
        }
      }
      // Voiliers (tri par profondeur).
      const sails = this.sails.slice().sort((a, b) => a.y - b.y);
      for (const s of sails) {
        const set = this.sailImgs[s.col][s.size];
        const img = s.dir > 0 ? set.r : set.l;
        const bob = Math.sin(t * 1.3 + s.p) > 0.6 ? 1 : 0;
        const x = Math.round(s.x);
        const y = s.y - set.h + bob;
        // Reflet : la voile, pâle et tremblée, sous la coque.
        g.globalAlpha = night ? 0.15 : 0.32;
        g.save();
        g.translate(x, s.y + 1 + bob);
        g.scale(1, -1);
        g.drawImage(img, Math.round(Math.sin(t * 2 + s.p) * 0.6), -set.h + 1);
        g.restore();
        g.globalAlpha = night ? 0.6 : 1;
        g.drawImage(img, x, y);
        g.globalAlpha = 1;
        if (night) {
          g.fillStyle = 'rgba(255,230,160,0.9)';
          g.fillRect(x + (set.w >> 1), y, 1, 1);
        }
      }
      // Le bateau de croisière.
      if (this.steamer) {
        const st = this.steamer;
        const img = this.steamerImgs[st.dir];
        const x = Math.round(st.x);
        const y = st.y - img.height + 1;
        g.globalAlpha = night ? 0.2 : 0.3;
        g.save();
        g.translate(x, st.y + 2);
        g.scale(1, -1);
        g.drawImage(img, 0, -img.height + 2);
        g.restore();
        g.globalAlpha = 1;
        g.drawImage(img, x, y);
        if (night || look.lights >= 0.3) {
          g.globalCompositeOperation = 'lighter';
          g.fillStyle = 'rgba(255,200,120,0.18)';
          g.fillRect(x + 2, y + 2, img.width - 4, 6);
          g.fillStyle = 'rgba(255,210,140,0.2)';
          for (let i = 3; i < img.width - 3; i += 2) if (hash(i, Math.floor(t * 4), 430) > 0.4) g.fillRect(x + i, st.y + 2 + Math.floor(hash(i, Math.floor(t * 4), 431) * 5), 1, 1);
          g.globalCompositeOperation = 'source-over';
        }
      }
      // Bateau à moteur.
      if (this.motor) {
        const m = this.motor;
        g.drawImage(this.motorImgs[m.dir > 0 ? 0 : 1], Math.round(m.x), m.y - 1);
      }
      // Le paddle.
      if (this.paddle) {
        const p = this.paddle;
        const img = this.paddleImgs[Math.floor(p.t * 1.5) % 2];
        g.drawImage(img, Math.round(p.x), p.y - img.height + 1);
        g.fillStyle = 'rgba(240,248,250,0.35)';
        g.fillRect(Math.round(p.x) - p.dir * 2, p.y + 1, 1, 1);
      }
      // Cygnes et canards.
      for (const s of this.swans) {
        const x = Math.round(s.x);
        if (s.kind === 'swan') {
          const fr = Math.sin(t * 0.8 + s.p) > 0.7 ? 1 : 0;
          const img = this.swanImgs[(s.dir > 0 ? 0 : 2) + fr];
          g.drawImage(img, x, s.y - 2);
          g.fillStyle = 'rgba(240,248,250,0.4)';
          g.fillRect(x - s.dir, s.y + 1, 1, 1);
        } else {
          g.drawImage(this.duckImgs[s.dir > 0 ? 0 : 1], x, s.y - 1);
        }
      }
    }

    // Les mâts du port qui se balancent, les promeneurs du ponton.
    drawPort(g, t) {
      const look = this.look;
      const mastC = look.night ? 'rgba(150,160,180,0.8)' : look.wet ? '#a8b0b8' : '#e6e8ea';
      g.fillStyle = mastC;
      for (const m of this.masts || []) {
        const sw = Math.sin(t * 0.9 + m.p) + Math.sin(t * 2.1 + m.p * 2) * 0.4;
        const lean = sw > 0.8 ? 1 : sw < -0.8 ? -1 : 0;
        g.fillRect(m.x, m.y - m.h + 2, 1, m.h - 2);
        g.fillRect(m.x + lean, m.y - m.h, 1, 2);
      }
      if (this.pier) {
        for (const w of this.walkers) {
          const frames = w.set;
          const img = w.pause > 0 ? frames[0] : frames[Math.floor(w.t * 4) % 2];
          g.drawImage(img, Math.round(w.x), this.pier.y - img.height);
        }
      }
    }

    /* ================= Feux d'artifice de la Fête du lac ================= */
    // Tirés depuis des barges sur la partie gauche du lac, les soirs d'été : une salve toutes
    // les quelques secondes, parfois un bouquet. Fusée et sa traînée, éclatement en pivoine,
    // chrysanthème, palmier, anneau ou scintillements ; les étincelles retombent et
    // s'éteignent, une fumée claire dérive, l'eau reflète les couleurs, une lueur éclaire
    // brièvement le lac et le dessous des nuages.
    makeFireworks() {
      const R = 36;
      this.fwGlow = FW_COLORS.map((c) => {
        const r = new Raster(R * 2 + 1, R * 2 + 1);
        for (let y = -R; y <= R; y++) {
          for (let x = -R; x <= R; x++) {
            const d = Math.hypot(x, y) / R;
            if (d >= 1) continue;
            const q = Math.floor((1 - d) ** 2 * 5 + bayer(x + R, y + R) * 0.9) / 5;
            if (q <= 0) continue;
            r.set(x + R, y + R, [c[0] * q * 0.7, c[1] * q * 0.7, c[2] * q * 0.7]);
          }
        }
        return r.toCanvas();
      });
    }

    launchRocket(delay) {
      const { W, H } = this;
      const lo = this.wide ? -0.55 * W : 0.04 * W;
      const hi = 0.36 * W;
      const x = Math.round(lo + Math.random() * (hi - lo));
      const y = this.shoreY(x) + 5 + Math.random() * 8;
      const ty = H * (0.27 + Math.random() * 0.14);
      const A = 34;
      this.rockets.push({ x, y, vx: (Math.random() - 0.5) * 4, vy: -Math.sqrt(2 * A * (y - ty)), A, delay, trail: [], kind: Math.random(), ci: Math.floor(Math.random() * FW_COLORS.length) });
    }

    burst(rk) {
      const k = rk.kind;
      const type = k < 0.36 ? 'peony' : k < 0.6 ? 'chrys' : k < 0.75 ? 'palm' : k < 0.88 ? 'ring' : 'glitter';
      const ci = type === 'palm' || type === 'chrys' ? (Math.random() < 0.6 ? 0 : rk.ci) : type === 'glitter' ? 4 : rk.ci;
      const ci2 = Math.random() < 0.3 ? Math.floor(Math.random() * FW_COLORS.length) : ci; // deux couleurs, parfois
      const n = { peony: 64, chrys: 72, palm: 12, ring: 40, glitter: 56 }[type];
      const sp = { peony: 38, chrys: 40, palm: 42, ring: 36, glitter: 30 }[type] * (0.85 + Math.random() * 0.3);
      const tilt = Math.random() * Math.PI;
      for (let i = 0; i < n; i++) {
        let a = (i / n) * Math.PI * 2 + Math.random() * 0.12;
        let s = sp * (type === 'ring' ? 1 : 0.55 + Math.random() * 0.45);
        let vx = Math.cos(a) * s;
        let vy = Math.sin(a) * s;
        if (type === 'ring') {
          // Anneau vu de biais : un cercle aplati, incliné.
          const ex = Math.cos(a) * s;
          const ey = Math.sin(a) * s * 0.35;
          vx = ex * Math.cos(tilt) - ey * Math.sin(tilt);
          vy = ex * Math.sin(tilt) + ey * Math.cos(tilt);
        }
        const life = (type === 'palm' ? 2.6 : type === 'chrys' ? 2.4 : type === 'glitter' ? 2 : 1.8) * (0.8 + Math.random() * 0.35);
        this.sparks.push({ x: rk.x, y: rk.y, vx, vy, age: 0, life, ci: i % 2 ? ci2 : ci, type, tr: [], p: Math.random() * 6 });
      }
      this.flashes.push({ x: rk.x, y: rk.y, ci, age: 0 });
      for (let i = 0; i < 12; i++) this.fwSmoke.push({ x: rk.x + (Math.random() - 0.5) * 14, y: rk.y + (Math.random() - 0.5) * 10, age: 0, life: 6 + Math.random() * 5, vx: 0.8 + Math.random() * 0.8, vy: -0.3 + Math.random() * 0.4, ph: Math.random() * 6 });
    }

    updateFireworks(dt) {
      if (!this.fwOn) return;
      this.nextSalvo -= dt;
      if (this.nextSalvo <= 0) {
        const bouquet = Math.random() < 0.22;
        const n = bouquet ? 3 + Math.floor(Math.random() * 3) : Math.random() < 0.4 ? 2 : 1;
        for (let i = 0; i < n; i++) this.launchRocket(i * (bouquet ? 0.18 : 0.6) + Math.random() * 0.1);
        this.nextSalvo = this.fwForce ? 0.9 + Math.random() * 1.2 : bouquet ? 5 + Math.random() * 4 : 2.2 + Math.random() * 3.5;
      }
      for (const r of this.rockets) {
        if (r.delay > 0) {
          r.delay -= dt;
          continue;
        }
        r.trail.push([Math.round(r.x), Math.round(r.y)]);
        if (r.trail.length > 7) r.trail.shift();
        r.vy += r.A * dt;
        r.x += r.vx * dt;
        r.y += r.vy * dt;
        if (r.vy > -5) {
          r.done = true;
          this.burst(r);
        }
      }
      this.rockets = this.rockets.filter((r) => !r.done);
      const drag = Math.pow(0.4, dt); // les étincelles ralentissent vite
      for (const s of this.sparks) {
        s.age += dt;
        if (s.type === 'chrys' || s.type === 'palm') {
          s.tr.push([Math.round(s.x), Math.round(s.y)]);
          if (s.tr.length > (s.type === 'palm' ? 6 : 4)) s.tr.shift();
        }
        s.vx *= drag;
        s.vy = s.vy * drag + (s.type === 'palm' ? 8 : 10) * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
      }
      this.sparks = this.sparks.filter((s) => s.age < s.life);
      for (const f of this.flashes) f.age += dt;
      this.flashes = this.flashes.filter((f) => f.age < 0.7);
      for (const p of this.fwSmoke) {
        p.age += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      this.fwSmoke = this.fwSmoke.filter((p) => p.age < p.life);
      if (this.fwSmoke.length > 260) this.fwSmoke.splice(0, this.fwSmoke.length - 260);
    }

    drawFireworks(g, t) {
      if (!this.fwOn) return;
      const H = this.H;
      const sw = this.water.sw;
      const mask = this.lakeMask;
      const inLake = (x, y) => y >= 0 && y < H && mask[y * sw + x + this.extL];
      // La fumée, éclairée un instant par les éclatements proches.
      for (const p of this.fwSmoke) {
        const k = p.age / p.life;
        let a = 0.16 * Math.min(1, p.age * 2) * (1 - k);
        let c = [176, 182, 204];
        for (const f of this.flashes) {
          const d = Math.hypot(p.x - f.x, p.y - f.y);
          if (d < 30) {
            const fc = FW_COLORS[f.ci];
            const w = (1 - d / 30) * (1 - f.age / 0.7);
            c = [c[0] + (fc[0] - c[0]) * w, c[1] + (fc[1] - c[1]) * w, c[2] + (fc[2] - c[2]) * w];
            a += 0.2 * w;
          }
        }
        g.fillStyle = css(c, a.toFixed(3));
        const x = Math.round(p.x + Math.sin(p.age * 0.7 + p.ph) * 1.5);
        const y = Math.round(p.y);
        g.fillRect(x, y, 2, 1);
        if (k < 0.6) g.fillRect(x + 1, y - 1, 1, 1);
      }
      g.globalCompositeOperation = 'lighter';
      // Lueurs : autour de l'éclatement, et sur l'eau en dessous.
      for (const f of this.flashes) {
        const a = Math.max(0, 1 - f.age / 0.7);
        const img = this.fwGlow[f.ci];
        const R = (img.width - 1) / 2;
        g.globalAlpha = a;
        g.drawImage(img, Math.round(f.x - R), Math.round(f.y - R));
        const sh = this.shoreY(f.x);
        const wy = sh + (sh - f.y) * 0.3;
        g.globalAlpha = a * 0.5;
        g.drawImage(img, Math.round(f.x - R * 1.4), Math.round(wy - R * 0.3), Math.round(R * 2.8), Math.round(R * 0.6));
      }
      g.globalAlpha = 1;
      // Les fusées et leur traînée dorée.
      for (const r of this.rockets) {
        if (r.delay > 0) continue;
        r.trail.forEach(([x, y], i) => {
          g.fillStyle = `rgba(255,200,120,${((i + 1) / r.trail.length) * 0.5})`;
          g.fillRect(x + (hash(x, y, 501) > 0.5 ? 1 : 0), y, 1, 1);
        });
        g.fillStyle = '#fff2cc';
        g.fillRect(Math.round(r.x), Math.round(r.y), 1, 1);
      }
      // Les étincelles, leurs traînées, et leur reflet tremblé dans le lac.
      const step = Math.floor(t * 8);
      for (const s of this.sparks) {
        const k = s.age / s.life;
        let a = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        if (k > 0.55 && hash(Math.round(s.p * 100), step, 502) < 0.3) a *= 0.2; // ça crépite en s'éteignant
        if (s.type === 'glitter' && Math.sin(t * 40 + s.p * 10) < 0) a *= 0.15;
        const c = FW_COLORS[s.ci];
        // Au début, le cœur est presque blanc ; ensuite, la couleur ; à la fin, elle fond.
        const hot = s.age < 0.18 ? 0.6 : 0;
        const col = [c[0] + (255 - c[0]) * hot, c[1] + (255 - c[1]) * hot, c[2] + (255 - c[2]) * hot];
        if (s.tr.length) {
          s.tr.forEach(([x, y], i) => {
            g.fillStyle = css(s.type === 'palm' ? [255, 190, 90] : col, (a * 0.35 * (i + 1)) / s.tr.length);
            g.fillRect(x, y, 1, 1);
          });
        }
        const x = Math.round(s.x);
        const y = Math.round(s.y);
        g.fillStyle = css(col, a.toFixed(2));
        g.fillRect(x, y, 1, 1);
        if (s.age < 0.3) g.fillRect(x - 1, y, 1, 1);
        if (s.age < 0.15) g.fillRect(x, y - 1, 1, 1);
        // Reflet : la hauteur au-dessus de l'eau se retrouve, tassée, sous la rive.
        const sh = this.shoreY(x);
        const ry = Math.round(sh + (sh - s.y) * 0.3 + (hash(x, step, 503) - 0.5) * 2);
        const rx = x + Math.round((hash(y, step, 504) - 0.5) * 2);
        if (inLake(rx, ry) && hash(x, y + step, 505) > 0.35) {
          g.fillStyle = css(col, (a * 0.45).toFixed(2));
          g.fillRect(rx, ry, 1 + (hash(x, step, 506) > 0.6 ? 1 : 0), 1);
        }
      }
      g.globalCompositeOperation = 'source-over';
    }

    drawParas(g, t) {
      for (const p of this.paras) {
        const x = Math.round(p.cx + Math.cos(p.a) * p.rad);
        const y = Math.round(p.cy + Math.sin(p.a) * p.rad * 0.35);
        g.drawImage(this.paraImgs[p.img], x - 3, y - 3);
      }
    }
  }

  // Forme d'un cumulus, tenue dans sa boîte. kind : 'tower' (gros cumulus bourgeonnant,
  // haut au milieu), 'flat' (étalé, près de l'horizon), sinon un petit nuage moyen.
  // Un corps plat à la base, des boules qui dessinent le dôme (chacune reliée à la base par
  // une colonne), des petits bourgeons sur le dessus ; champ de densité peu bruité (bords
  // nets), base plate.
  function cumulus(w, h, seed, kind) {
    const R = rng(seed);
    const P = [];
    const base = Math.round(h * 0.95);
    const tower = kind === 'tower';
    const flat = kind === 'flat';
    const fit = (p) => {
      p.rx = Math.max(1.5, Math.min(p.rx, p.x - 1, w - 2 - p.x));
      p.ry = Math.max(1.5, Math.min(p.ry, p.y - 1));
      return p;
    };
    P.push(fit({ x: w / 2, y: base - h * 0.15, rx: w * (flat ? 0.42 : 0.3), ry: h * (flat ? 0.22 : 0.15) }));
    const n = Math.max(2, Math.round(w / (h * (tower ? 0.3 : flat ? 0.9 : 0.45))));
    const body = [];
    for (let i = 0; i < n; i++) {
      const u = 0.15 + (i / (n - 1)) * 0.7 + (R() - 0.5) * 0.06;
      const e = Math.pow(Math.max(0, 1 - (2 * u - 1) ** 2), tower ? 1.2 : 0.8) * (0.75 + R() * 0.35);
      const r = h * (flat ? 0.24 + 0.16 * e : tower ? 0.12 + 0.2 * e : 0.17 + 0.2 * e) * (0.85 + R() * 0.3);
      const lift = flat ? 0.3 : tower ? 0.44 : 0.4;
      // Le haut des boules ne touche jamais le bord de la boîte (pas de dessus plat).
      const cy = Math.max(r + 2 + h * 0.1 * R(), base - h * 0.2 - e * h * lift);
      const p = fit({ x: u * w, y: cy, rx: r * (flat ? 1.4 : 1.05), ry: r });
      body.push(p);
      P.push(fit({ x: p.x, y: (p.y + base) / 2, rx: p.rx * 0.74, ry: (base - p.y) / 2 + 1, col: true }));
      P.push(p);
    }
    for (const b of body) {
      if (b.ry < 4) continue;
      const nb = 2 + Math.floor(R() * (tower ? 4 : 2));
      for (let k = 0; k < nb; k++) {
        const a = -Math.PI * (0.12 + R() * 0.76);
        const by = b.y + Math.sin(a) * b.ry * 0.8;
        const br = Math.min(b.ry * (0.3 + R() * 0.18), by - 1);
        if (br < 1.5) continue;
        P.push(fit({ x: b.x + Math.cos(a) * b.rx * 0.8, y: by, rx: br, ry: br }));
      }
    }
    const D = new Float32Array(w * h);
    const O = new Int16Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (y > base) {
          D[y * w + x] = -1;
          continue;
        }
        let m = -1;
        for (let k = 0; k < P.length; k++) {
          const p = P[k];
          const d = Math.hypot((x - p.x) / p.rx, (y - p.y) / p.ry);
          if (1 - d > m) {
            m = 1 - d;
            O[y * w + x] = k;
          }
        }
        D[y * w + x] = m + (noise(x * 0.35, y * 0.35, seed) - 0.5) * 0.12;
      }
    }
    return { w, h, D, O, P, base, seed };
  }

  B.PixelScenes.annecy = Annecy;
})();
