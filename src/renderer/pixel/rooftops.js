// Brume — scène « Sur les toits », en pixel art.
//
// Le soir, sur un long toit d'ardoises. Deux jeunes sont assis côte à côte au bord du toit,
// les jambes dans le vide, la tête penchée l'un vers l'autre. Derrière eux, la rambarde du
// toit, puis le grand ciel du crépuscule : un dégradé violet-bleu et de gros cumulus roses,
// éclairés par en dessous par le soleil qui vient de se coucher derrière la ville. À gauche,
// une souche de cheminée ; à droite, un poteau électrique et ses fils qui pendent. En bas,
// d'autres toits dans l'ombre violette, une fenêtre chaude, une lanterne.
// La vie : ils respirent, leurs cheveux bougent dans le vent, l'un pose la tête sur l'épaule
// de l'autre, leurs mains se trouvent, leurs jambes se balancent ; des petits cœurs montent,
// les nuages dérivent, des oiseaux blancs passent, un chat se promène sur un faîtage, les
// fenêtres s'allument et s'éteignent.
//
// Le décor est peint une fois par ambiance en trois calques (fond, plan moyen, premier
// plan) ; chaque image ne dessine que ce qui bouge.
(function () {
  'use strict';
  const B = window.Brume;
  const { Raster, hex, mix, rng, hash, noise, fbm, bayer } = B.PX;
  const X = B.PXC;
  const C = hex;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const mul = (c, k) => [c[0] * k[0], c[1] * k[1], c[2] * k[2]];
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

  /* ================= Ambiances selon la météo ================= */
  // sky : dégradé du zénith à l'horizon ; cloud : 6 tons du nuage (ombre → liseré lumineux) ;
  // amb / desat : étalonnage du décor bâti ; rim : lumière du ciel sur les contours.
  const LOOKS = {
    none: {
      sky: ['#1f1d55', '#28256a', '#352f80', '#473893', '#5f42a2', '#7f4dab', '#a259ae', '#c76aae', '#e384b0', '#f2a0b2'],
      glow: '#ffb48e', glowK: 0.55, clouds: 'cumulus',
      cloud: ['#3b2a70', '#5f3584', '#94449a', '#c859a2', '#ef80ae', '#ffc6d2'],
      far: '#4a3a88', haze: '#c46ea8', stars: 16,
      amb: [1, 1, 1], desat: 0, rim: '#ffaccb', winLit: 0.45, birds: true, hearts: 1,
    },
    snow: {
      sky: ['#262850', '#30335e', '#3c406c', '#4a4e7a', '#5a5c88', '#6c6c94', '#8080a2', '#9890b0', '#ae9fbc', '#c2b0c4'],
      glow: '#f2c4cc', glowK: 0.32, clouds: 'overcast',
      cloud: ['#363660', '#444670', '#565884', '#6c6c96', '#8a86aa', '#b8b0cc'],
      far: '#585a88', haze: '#9c90b4', stars: 0,
      amb: [0.92, 0.94, 1.05], desat: 0.3, rim: '#e8dcf2', winLit: 0.65, snow: true, smoke: true, breath: true, scarf: true, hearts: 0.8,
    },
    rain: {
      sky: ['#121830', '#161d38', '#1c2440', '#222b4a', '#2a3354', '#323b5e', '#3c4466', '#484e70', '#56587a', '#646284'],
      glow: '#b08cae', glowK: 0.16, clouds: 'overcast',
      cloud: ['#161c32', '#1e253c', '#283048', '#333b56', '#434a66', '#585e7c'],
      far: '#2c3456', haze: '#56587a', stars: 0,
      amb: [0.66, 0.72, 0.92], desat: 0.4, rim: '#aab6de', winLit: 0.75, wet: true, umbrella: true, hearts: 0.6,
    },
    storm: {
      sky: ['#090c1a', '#0c1022', '#10162a', '#151c32', '#1a223a', '#202842', '#28304a', '#323852', '#3c405a', '#464862'],
      glow: '#7a6a9a', glowK: 0.1, clouds: 'overcast',
      cloud: ['#0c101e', '#121828', '#1a2134', '#242c42', '#323a52', '#48506c'],
      far: '#1c2240', haze: '#383a56', stars: 0,
      amb: [0.5, 0.55, 0.76], desat: 0.5, rim: '#9ca8d4', winLit: 0.8, wet: true, umbrella: true, storm: true, hearts: 0.5,
    },
    sakura: {
      sky: ['#5560b4', '#6168bf', '#6f72c8', '#827cce', '#9886d2', '#b090d2', '#c89acf', '#dca6cc', '#ecb4ca', '#f8c6cc'],
      glow: '#ffe2cc', glowK: 0.45, clouds: 'cumulus',
      cloud: ['#7e70b4', '#9a7ec0', '#bc8cc6', '#dea2cc', '#f8c2d6', '#fff0f2'],
      far: '#7a72b4', haze: '#dca6c8', stars: 0,
      amb: [1.1, 1.04, 1.1], desat: 0, rim: '#ffdce8', winLit: 0.3, birds: true, tree: 'sakura', litter: 'petals', hearts: 1.2,
    },
    leaves: {
      sky: ['#221a48', '#2c2056', '#3a2564', '#4e2c6c', '#683472', '#863e70', '#a6486a', '#c45a62', '#de7458', '#f2965a'],
      glow: '#ffb06e', glowK: 0.55, clouds: 'cumulus',
      cloud: ['#3a2456', '#5e2e68', '#8e3c6c', '#c0546a', '#ec7c68', '#ffc28c'],
      far: '#4c2e64', haze: '#c4625e', stars: 6,
      amb: [1.06, 0.9, 0.84], desat: 0, rim: '#ffb88e', winLit: 0.5, birds: true, tree: 'autumn', litter: 'leaves', smoke: true, hearts: 1,
    },
    fireflies: {
      sky: ['#0a0c2a', '#0d1132', '#11163c', '#161c46', '#1c214e', '#242656', '#2e2c5c', '#3a3262', '#483866', '#58406a'],
      glow: '#b06a84', glowK: 0.22, clouds: 'thin',
      cloud: ['#14183a', '#1a1f44', '#22284e', '#2c3058', '#3a3c66', '#504c78'],
      far: '#1c2048', haze: '#463862', stars: 90, moon: true,
      amb: [0.6, 0.64, 0.9], desat: 0.1, rim: '#c4a6e6', winLit: 0.7, fireflies: true, strings: true, hearts: 1,
    },
    starfall: {
      sky: ['#04051a', '#060920', '#090d28', '#0d1232', '#11173c', '#161c46', '#1c214e', '#242656', '#2c2a5a', '#36305e'],
      glow: '#5a4682', glowK: 0.2, clouds: 'thin',
      cloud: ['#0a0d22', '#0f132c', '#151a36', '#1c2140', '#262a4c', '#34365a'],
      far: '#141a3a', haze: '#2c2a52', stars: 230, milky: true,
      amb: [0.5, 0.56, 0.86], desat: 0.15, rim: '#aab6ff', winLit: 0.55, meteors: true, hearts: 1,
    },
  };

  /* ================= Palette du décor (crépuscule), étalonnée ensuite par ambiance ================= */
  const PAL = {
    tile: ['#2c2644', '#3a3456', '#463f63', '#524a70', '#61597e', '#746b8e'],
    ridge: ['#2a2440', '#4a4266', '#6a6088'],
    rail: ['#1a1428', '#2c2440', '#4a3e62'],
    gutter: ['#2a2440', '#4e4868', '#6e6888', '#8c84a4'],
    wall: ['#261c3a', '#2e2244', '#36284e', '#40305a'],
    lower: ['#170f26', '#1e1430', '#271a3c', '#322248', '#3e2c56'],
    house: ['#1f1840', '#29204e', '#33285a', '#3e3266'],
    brick: ['#2e2040', '#3a2a4c', '#4a3458', '#5a4066'],
    pot: ['#4a2a40', '#6a3a4c', '#8a4e5a'],
    wood: ['#1e1626', '#2c2032', '#3e2e42', '#56404e'],
    wire: '#150f22',
    glass: ['#1c1c42', '#2a2a58', '#3c3a6c'],
    lit: ['#ffe2a0', '#ffc46c', '#f0984e', '#b8603a'],
  };

  /* ================= Le couple ================= *
   * Dessins en texte : une lettre = une couleur, '.' = transparent. Chacun est découpé en
   * morceaux (cheveux, tête, buste, genoux, jambes) pour s'animer : respiration, tête qui se
   * penche, mèches au vent, mains qui se cherchent, jambes qui se balancent. Les contours
   * sombres et la lumière du ciel sur les bords sont ajoutés après coup, sur la silhouette
   * entière (voir Couple.compose). */

  // Elle : longs cheveux châtains, pull violet, jupe sombre, chaussettes blanches.
  const G_PAL = {
    a: '#26141f', b: '#3f2229', c: '#5c3330', d: '#80493a', e: '#a96c4c', f: '#c98d63',
    s: '#f4c9b0', S: '#d99a88', z: '#a86a6c', r: '#ee8c98', x: '#24101e', i: '#5a2a3c', m: '#c0606c',
    1: '#a585d6', 2: '#8264b8', 3: '#5a4290', 4: '#3e2c6c', u: '#cbb4ec',
    w: '#f2ecf6', W: '#bfb4d6',
    k: '#33294f', K: '#211a38', h: '#4a3d6e',
    o: '#ece6f2', O: '#b2a8c8', p: '#5c3330', P: '#3a1e24', q: '#80493a', g: '#24141c',
  };
  // Lui : cheveux noirs en bataille, veste noire à passepoil clair, pantalon, baskets.
  const Y_PAL = {
    a: '#0e0b18', b: '#191428', c: '#272038', d: '#3a3254', e: '#5a5080', f: '#7c72a6',
    s: '#f0c2a6', S: '#d4927e', z: '#a46468', r: '#e8868e', x: '#160e1c', i: '#3a2840', m: '#b65c64',
    1: '#3e3852', 2: '#2c2740', 3: '#1d1a2c', 4: '#131020', u: '#d8d0ea', v: '#b8aed0',
    w: '#f2ecf6', W: '#bfb4d6',
    n: '#383c5a', N: '#262840', h: '#4a4e6e',
    o: '#f0ecf4', O: '#b8b2cc', p: '#f0ecf4', P: '#b8b2cc', q: '#8a84a6', g: '#5a5474',
  };

  // Tête de la jeune fille, tournée de trois quarts vers lui (vers la droite).
  // Repère : sa propre grille ; elle est collée à x = 3 de la boîte de la jeune fille.
  const G_HEAD = [
    '.....bbbbb',
    '...bbccdccbb',
    '..bccdeedcccb',
    '.bccdeeddcccbb',
    '.bcdeedddccccb',
    'bccdddcdddcccbb',
    'bcdcddcdcdccdcb',
    'bcdcbcdbccbcbcb',
    'bcbbScbssbcsbcb',
    'bcbSsssssssSbcb',
    'bcbSxxsssxxSbcb',
    'bcbSwissswiSbcb',
    'bcb.srssssrSbcb',
    'bcbb.SssmsS.bcb',
    'bccb..SsssS.bcb',
    'bcdcb..zSz..bcb',
    'bcecb.......bcb',
    'abcdcb......bdb',
    'abcedb.......bc',
    'abcdcb.......bc',
    '.abcecb......b',
    '.abccb',
    '..abcb',
    '..abb',
    '...a',
  ];
  // Cheveux qui tombent derrière le dos (dépassent à gauche de l'épaule).
  const G_HAIRBACK = ['..abb', '.abcb', '.abcb', 'abcbb', 'abcb', 'abcb', 'abb', '.ab'];
  // Tête du garçon, tournée de trois quarts vers elle (vers la gauche) ; collée à x = 2.
  const Y_HEAD = [
    '.....a.aa..b',
    '....abbabbcbba',
    '...abccbccdccbba',
    '..abcddcddeddccba',
    '.abcdedcdeddcdcbba',
    'abcddcdcddcdcccbba',
    '.abcdcbdcbcdcbcbba',
    'abbbcbcbbcbcbbcbca',
    '.bcbsbcssbsbSbcbba',
    '..bSssssssssSbcba',
    '..bsxxsssxxsSzcba',
    '..bsiwsssiwsSzbba',
    '...srsssssrsSbbb',
    '....SsmsssSSbba',
    '.....SssSS.bb',
    '......zSz...b',
  ];

  // Buste vu de face, dans la boîte de la jeune fille (cou en x = 10 à 12) :
  // 1 clair, 2 moyen, 3 ombre, 4 creux entre le bras et le buste, u poignet, w col.
  const BODY_TOP = [
    '......321wsSsw123',
    '....32111wWWWw11123',
    '...3211421111124113',
    '...3211422111224113',
    '...3221422222224123',
    '...3221422323224123',
    '...3222422232224223',
  ];
  // Bas du buste (à partir de la ligne 23) : mains jointes, main tendue vers l'autre,
  // bras levé qui tient le parapluie (le bras « intérieur » est à droite).
  const BODY_LOW = {
    rest: ['...3222142232241223', '....322221423241223', '.....32uussSssuu23', '......3uusSsSsuu3', '.........zSzSz'],
    hold: ['...3222142232241223', '....322221423224122', '.....32uusSs42224122', '......3uusSs....uuu', '.........zSz......ss'],
    umbrella: ['...3222142232241223', '....322221423241223', '.....32uusSs4241223', '......3uusSs....323', '.........zSz'],
  };
  const ARM_UP = [
    '................ss',
    '...............sSsS',
    '...............uuuu',
    '...............1223',
    '...............1223',
    '...............1223',
    '...............12223',
    '................123',
  ];
  // Genoux : jupe plissée pour elle, pantalon pour lui (lignes 24 à 29).
  const G_LAP = [
    '....kkkkkkkkkkkkkkk',
    '...hkkkkkkkkkkkkkkkk',
    '...hkkkkkkkkkkkkkkkk',
    '..KhkkkkKkkkkKkkkkkK',
    '..KKkkKKkkkKKkkkKKkK',
    '...KK.KK.KKK.KK.KKK',
  ];
  const Y_LAP = [
    '..nnnnnnnnnnnnnnn',
    '.nnnnnnnnnnnnnnnnn',
    '.nnnnnnnNnnnnnnnhn',
    'NnnnnnnhnnnnnnnnhK',
    'NnnnnnnNNnnnnnnNNN',
    '.NNNNNNN..NNNNNNN',
  ];
  // Jambes qui pendent : au repos, puis lancée vers l'avant (plus courte, semelle visible).
  const G_LEG = {
    down: ['.SsS', 'SsssS', '.sssS', '.sssS', '.ssS', '.ssS', '.ssS', '.ssS', '.ssS', '.ssS', '.ooO', '.ooO', '.ooO', 'qpppP', 'qpppP', '.PPP'],
    up: ['.SsS', 'SsssS', '.sssS', '.ssS', '.ssS', '.ssS', '.ssS', '.ssS', '.ooO', '.ooO', 'qpppP', 'qpppP', 'gPPPg', '.ggg'],
  };
  const Y_LEG = {
    down: ['nnnnN', 'nnnnN', '.nnnN', '.nnnN', '.nnnN', '.nnN', '.nnN', '.nnN', '.nnN', '.nnN', '.NNN', '.ooO', 'oooOO', 'oqooO', 'ggggg'],
    up: ['nnnnN', 'nnnnN', '.nnnN', '.nnnN', '.nnN', '.nnN', '.nnN', '.nnN', '.NNN', '.ooO', 'oooOO', 'oqooO', 'gOOOg', '.ggg'],
  };

  // Miroir d'un dessin dans une boîte de 20 de large (le garçon est tourné vers elle).
  const mirror = (rows) => rows.map((row) => row.padEnd(20, '.').split('').reverse().join('').replace(/\.+$/, ''));
  // Sa veste : passepoil clair au milieu (fermeture) et le long des manches.
  function jacket(rows) {
    return rows.map((row, y) => row.split('').map((ch, x) => {
      if (ch === 'u') return 'v';
      if (!/[1234]/.test(ch)) return ch;
      if (y >= 1 && y <= 7 && x === 8) return 'v';
      if (y >= 2 && y <= 8 && (x === 15 || x === 3)) return 'v';
      return ch;
    }).join(''));
  }

  // Petits cœurs qui montent.
  const HEARTS = [
    ['h.h', 'hhh', '.h.'],
    ['hh.hh', 'hwhhh', 'hhhhd', '.hhd.', '..d..'],
    ['.hh.hh.', 'hwwhhhh', 'hwhhhhd', 'hhhhhhd', '.hhhdd.', '..hdd..', '...d...'],
  ];

  // Dessin en texte → Raster (couleurs déjà converties).
  function rasterOf(rows, pal, flip = false) {
    const h = rows.length;
    const w = Math.max(...rows.map((r) => r.length));
    const r = new Raster(w, h);
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = pal[row[x]];
        if (c) r.set(flip ? w - 1 - x : x, y, c);
      }
    });
    return r;
  }
  // Décale certaines lignes (tête penchée, mèches au vent).
  const shiftRows = (rows, fn) => rows.map((row, y) => {
    const d = fn(y);
    return d > 0 ? '.'.repeat(d) + row : d < 0 ? row.slice(-d) : row;
  });
  const put = (rows, pts) => {
    const out = rows.slice();
    for (const [x, y, ch] of pts) {
      while (out.length <= y) out.push('');
      const row = out[y].padEnd(x + 1, '.');
      out[y] = row.slice(0, x) + ch + row.slice(x + 1);
    }
    return out;
  };

  /* ---------- Le couple : assemblage, ombres de contact, contour et lumière du ciel ---------- */
  const CW = 48;
  const CH = 68;
  const TOP = 20; // haut des têtes dans l'image du couple (place pour le parapluie)
  const SEAT = TOP + 30; // ligne d'assise (gouttière)
  const GX = 4; // boîte de la jeune fille
  const YX = 22; // boîte du garçon

  class Couple {
    constructor(look) {
      this.look = look;
      const amb = look.amb.map((a) => 1 + (a - 1) * 0.6);
      const grade = (h) => {
        const c = C(h);
        const l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
        const d = (look.desat || 0) * 0.5;
        return mul([c[0] + (l - c[0]) * d, c[1] + (l - c[1]) * d, c[2] + (l - c[2]) * d], amb);
      };
      const pal = (p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, grade(v)]));
      const gp = pal(G_PAL);
      const yp = pal(Y_PAL);
      this.rim = C(look.rim);
      this.line = mul(C('#1a0e24'), amb);

      // Variantes de la tête : mèches au vent (-1, 0, 1) × yeux ouverts / fermés.
      // Tête penchée vers l'autre : le haut du crâne glisse d'un ou deux pixels.
      const tilt = (rows, k) => shiftRows(['..', ...rows].map((r) => '..' + r), (y) => (y < 6 ? k : y < 10 && Math.abs(k) > 1 ? Math.sign(k) : 0)).slice(1);
      const closeEyes = (rows, cols) => put(rows, cols.flatMap((x) => [[x, 10, 's'], [x, 11, 'x']]));
      const gSway = (rows, k) => shiftRows(rows, (y) => (y >= 16 ? Math.round(k * Math.min(1, (y - 15) / 4)) : 0));
      this.g = { head: {}, hairBack: {}, legs: {}, lap: rasterOf(G_LAP, gp) };
      for (const k of [-1, 0, 1]) {
        for (const closed of [false, true]) for (const tl of [1, 2]) this.g.head[`${k}${closed ? 'c' : 'o'}${tl}`] = rasterOf(gSway(tilt(closed ? closeEyes(G_HEAD, [4, 5, 9, 10]) : G_HEAD, tl), k), gp);
        this.g.hairBack[k] = rasterOf(shiftRows(G_HAIRBACK, (y) => (y >= 3 ? k : 0)), gp);
      }
      const ySway = (rows, k) => shiftRows(rows, (y) => (y < 2 ? k : 0));
      this.y = { head: {}, legs: {}, lap: rasterOf(Y_LAP, yp) };
      for (const k of [-1, 0, 1]) for (const closed of [false, true]) for (const tl of [1, 2]) this.y.head[`${k}${closed ? 'c' : 'o'}${tl}`] = rasterOf(ySway(tilt(closed ? closeEyes(Y_HEAD, [4, 5, 9, 10]) : Y_HEAD, -tl), k), yp);
      for (const pose of ['down', 'up']) {
        this.g.legs[pose] = rasterOf(G_LEG[pose], gp);
        this.y.legs[pose] = rasterOf(Y_LEG[pose], yp);
      }
      // Bustes : elle tournée vers lui, lui (en miroir, veste à passepoil) tourné vers elle.
      this.g.body = {};
      this.y.body = {};
      for (const k of Object.keys(BODY_LOW)) {
        this.g.body[k] = rasterOf([...BODY_TOP, ...BODY_LOW[k]], gp);
        this.y.body[k] = rasterOf(jacket(mirror([...BODY_TOP, ...BODY_LOW[k]])), yp);
      }
      this.y.armUp = rasterOf(jacket(mirror(['', ...ARM_UP])).slice(1), yp);
      this.umbrella = look.umbrella ? umbrellaRaster(look) : null;
      this.scarf = look.scarf ? scarfRaster() : null;

      this.R = new Raster(CW, CH);
      this.own = new Uint8Array(CW * CH);
      this.canvas = document.createElement('canvas');
      this.canvas.width = CW;
      this.canvas.height = CH;
      this.ctx = this.canvas.getContext('2d');
      this.key = '';
    }

    // Colle un morceau dans l'image du couple ; own retient qui est devant (pour les ombres).
    blit(part, ox, oy, id) {
      const { R, own } = this;
      for (let y = 0; y < part.h; y++) {
        for (let x = 0; x < part.w; x++) {
          const i = (y * part.w + x) * 4;
          if (!part.data[i + 3]) continue;
          const X0 = ox + x;
          const Y0 = oy + y;
          if (X0 < 0 || Y0 < 0 || X0 >= CW || Y0 >= CH) continue;
          const j = (Y0 * CW + X0) * 4;
          R.data[j] = part.data[i];
          R.data[j + 1] = part.data[i + 1];
          R.data[j + 2] = part.data[i + 2];
          R.data[j + 3] = 255;
          own[Y0 * CW + X0] = id;
        }
      }
    }

    // s : { gHead, yHead (décalages), gSway, ySway, gEyes, yEyes, hold, legs: [4 poses] }
    render(s) {
      const key = JSON.stringify(s);
      if (key === this.key) return this.canvas;
      this.key = key;
      const { R, own } = this;
      R.data.fill(0);
      own.fill(0);
      const umb = !!this.umbrella;
      const gBody = s.hold && !umb ? 'hold' : 'rest';
      const yBody = umb ? 'umbrella' : s.hold ? 'hold' : 'rest';

      this.blit(this.g.hairBack[s.gSway], GX + 1 + s.gHead[0], TOP + 15 + s.gHead[1], 1);
      // Jambes (derrière la jupe et le pantalon).
      this.blit(this.g.legs[s.legs[0]], GX + 6, SEAT - 1, 2);
      this.blit(this.g.legs[s.legs[1]], GX + 12, SEAT - 1, 2);
      this.blit(this.y.legs[s.legs[2]], YX + 3, SEAT - 1, 3);
      this.blit(this.y.legs[s.legs[3]], YX + 9, SEAT - 1, 3);
      this.blit(this.g.lap, GX, SEAT - 6, 4);
      this.blit(this.y.lap, YX, SEAT - 6, 5);
      // Bustes.
      this.blit(this.g.body[gBody], GX, TOP + 16, 6);
      this.blit(this.y.body[yBody], YX, TOP + 16, 7);
      if (umb) this.blit(this.y.armUp, YX, TOP + 17, 7);
      // Têtes (respiration et inclinaison comprises).
      // Celui qui pose la tête sur l'épaule de l'autre passe devant.
      const gh = () => this.blit(this.g.head[`${s.gSway}${s.gEyes ? 'c' : 'o'}${s.gHead[0] > 0 ? 2 : 1}`], GX + 1 + s.gHead[0], TOP + s.gHead[1], s.gHead[0] > 0 ? 10 : 8);
      const yh = () => this.blit(this.y.head[`${s.ySway}${s.yEyes ? 'c' : 'o'}${s.yHead[0] < 0 ? 2 : 1}`], YX - 1 + s.yHead[0], TOP + s.yHead[1], 9);
      if (s.gHead[0] > 0) {
        yh();
        gh();
      } else {
        gh();
        yh();
      }
      if (this.scarf) this.blit(this.scarf, GX + 9, TOP + 14, 10);
      if (umb) {
        // Le manche, de la main au parapluie, puis la toile.
        const hx = YX + 2;
        for (let y = TOP - 6; y < TOP + 19; y++) this.blitPx(hx, y, [70, 60, 86], 11);
        this.blit(this.umbrella, hx - 19, TOP - 18, 12);
      }
      this.finish();
      this.ctx.putImageData(new ImageData(R.data.slice(), CW, CH), 0, 0);
      return this.canvas;
    }

    blitPx(x, y, c, id) {
      if (this.own[y * CW + x]) return; // le manche passe derrière la main
      this.R.set(x, y, c);
      this.own[y * CW + x] = id;
    }

    // Ombres de contact entre les morceaux, lumière du ciel sur les bords, contour sélectif.
    finish() {
      const { R, own, rim } = this;
      const d = R.data;
      const src = d.slice();
      const at = (x, y) => (x < 0 || y < 0 || x >= CW || y >= CH ? 0 : own[y * CW + x]);
      for (let y = 0; y < CH; y++) {
        for (let x = 0; x < CW; x++) {
          const id = at(x, y);
          if (!id) continue;
          const i = (y * CW + x) * 4;
          let k = 1;
          // Un morceau posé devant projette une petite ombre sur celui de derrière.
          const up = at(x, y - 1);
          const l = at(x - 1, y);
          const r = at(x + 1, y);
          const front = (o) => o > id && o !== 11 && !(id <= 3 && o <= 3);
          if (front(up) || front(l) || front(r)) k = 0.72;
          let c = [src[i] * k, src[i + 1] * k, src[i + 2] * k];
          // Lumière du ciel (derrière eux) : un liseré sur le haut, plus discret sur les côtés.
          if (!up) c = mix(c, rim, id === 12 ? 0.3 : 0.5);
          else if (!at(x, y - 2) && id !== 12 && id !== 11) c = mix(c, rim, 0.16);
          else if (y < SEAT - 4 && (!l || !r)) c = mix(c, rim, 0.14);
          d[i] = c[0];
          d[i + 1] = c[1];
          d[i + 2] = c[2];
        }
      }
      // Contour sombre (violet presque noir) sur les côtés et le bas ; rien au-dessus des
      // têtes, où le ciel adoucit la silhouette.
      const line = this.line;
      for (let y = 0; y < CH; y++) {
        for (let x = 0; x < CW; x++) {
          if (at(x, y)) continue;
          if (!at(x - 1, y) && !at(x + 1, y) && !at(x, y - 1)) continue;
          const i = (y * CW + x) * 4;
          d[i] = line[0];
          d[i + 1] = line[1];
          d[i + 2] = line[2];
          d[i + 3] = 255;
        }
      }
    }
  }

  // Parapluie partagé : une coupole à six pans, festonnée, éclairée par le ciel.
  function umbrellaRaster(look) {
    const w = 39;
    const h = 15;
    const r = new Raster(w, h);
    const amb = look.amb;
    const L1 = mul(C('#d98ab8'), amb);
    const L2 = mul(C('#b86a9e'), amb);
    const L3 = mul(C('#8a4c80'), amb);
    const RIB = mul(C('#5a2e58'), amb);
    const cx = (w - 1) / 2;
    const ribs = [0, 1, 2, 3, 4, 5, 6].map((i) => (i / 6) * (w - 1));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const nx = (x - cx) / (w / 2);
        const ny = (h - 3 - y) / (h - 3);
        if (nx * nx + ny * ny > 1 || y < 1) continue;
        const p = Math.min(5, Math.floor(x / ((w - 1) / 6)));
        const u = (x - ribs[p]) / (ribs[p + 1] - ribs[p]);
        if (y > h - 3 - Math.round(Math.sin(u * Math.PI) * 2)) continue;
        let c = p % 2 ? L2 : L1;
        if (ny < 0.3) c = mix(c, L3, 0.5);
        if (Math.abs(nx) > 0.8) c = mix(c, L3, 0.4);
        if (ny > 0.75) c = mix(c, [255, 230, 240], 0.25);
        r.set(x, y, c);
      }
    }
    // Baleines : des méridiens qui montent jusqu'à la pointe.
    for (const bx of ribs.slice(1, 6)) {
      for (let y = 1; y < h - 2; y++) {
        const ny = (h - 3 - y) / (h - 3);
        const x = Math.round(cx + (bx - cx) * Math.sqrt(Math.max(0, 1 - ny * ny)));
        if (r.get(x, y)[3]) r.set(x, y, mix(r.get(x, y), RIB, 0.45));
      }
    }
    r.set(Math.round(cx), 0, RIB);
    for (const bx of ribs) r.set(Math.min(w - 1, Math.round(bx)), h - 3, RIB);
    return r;
  }

  // Écharpe partagée (neige) : une longue écharpe rouge autour des deux cous.
  function scarfRaster() {
    const rows = [
      '.RRRrrRRRrrrRRRRrrRR',
      'RrrRRRrrRRRRrrRRRrrR',
      '.RRrr...........RRr',
      '..Rr.............rR',
      '..rR..............',
    ];
    return rasterOf(rows, { R: C('#c8445a'), r: C('#e66a76') });
  }

  /* ================= Décor : nuages ================= */
  // Cumulus : des boules empilées (les plus basses devant), éclairées par en dessous.
  function cumulus(w, h, seed) {
    const R = rng(seed);
    const puffs = [];
    const rows = [
      { n: Math.max(1, Math.round(w / 70)), cy: 0.36, rad: 0.34, spread: 0.36 },
      { n: Math.max(2, Math.round(w / 34)), cy: 0.52, rad: 0.27, spread: 0.62 },
      { n: Math.max(2, Math.round(w / 20)), cy: 0.68, rad: 0.22, spread: 0.84 },
      { n: Math.max(3, Math.round(w / 12)), cy: 0.83, rad: 0.15, spread: 0.98 },
    ];
    for (const row of rows) {
      for (let i = 0; i < row.n; i++) {
        const u = row.n === 1 ? (R() - 0.5) * 0.4 : (i / (row.n - 1)) * 2 - 1;
        const uu = u * row.spread + (R() - 0.5) * 0.12;
        const k = 1 - Math.abs(uu) ** 2 * 0.55;
        const rad = h * row.rad * k * (0.8 + R() * 0.4);
        puffs.push({ x: w / 2 + uu * (w / 2 - rad * 0.9), y: h * row.cy + (R() - 0.5) * h * 0.12 + (1 - k) * h * 0.1, r: rad });
      }
    }
    return { w, h, puffs, base: Math.round(h * 0.93), seed };
  }

  // Peint un cumulus dans r à (ox, oy). sunX : abscisse du soleil (dans r).
  function paintCumulus(r, cl, ox, oy, tones, sunX) {
    const { w, h, puffs, base, seed } = cl;
    const own = new Int16Array(w * h).fill(-1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (y > base + (noise(x * 0.3, 0, seed) - 0.5) * 2) continue;
        for (let k = puffs.length - 1; k >= 0; k--) {
          const p = puffs[k];
          const d = Math.hypot(x - p.x, (y - p.y) * 1.15);
          const edge = p.r * (1 + (noise(x * 0.22, y * 0.22, seed + k) - 0.5) * 0.22);
          if (d < edge) {
            own[y * w + x] = k;
            break;
          }
        }
      }
    }
    const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && own[y * w + x] >= 0;
    const side = Math.sign(sunX - (ox + w / 2)) || 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = own[y * w + x];
        if (k < 0) continue;
        const p = puffs[k];
        const ly = (y - p.y) / p.r;
        const lx = (x - p.x) / p.r;
        const g = y / base;
        let v = 0.68 * ly + 0.42 * (g * 2 - 1) + 0.16 * lx * side + (fbm(x * 0.07, y * 0.07, seed, 3) - 0.5) * 0.3;
        // Bord du haut et des côtés : tramé, il se fond dans le ciel.
        const edge = !inside(x, y - 1) || !inside(x - 1, y) || !inside(x + 1, y);
        if (edge && ly < 0.2 && bayer(x + ox, y + oy) < 0.5) continue;
        let i = Math.floor((v + 1) * 2.4 + bayer(x + ox, y + oy) * 0.7);
        i = Math.max(0, Math.min(4, i));
        // Une boule posée devant fait de l'ombre au bas de celle de derrière : ça dessine
        // les bosses du chou-fleur.
        const below = y + 1 < h ? own[(y + 1) * w + x] : -1;
        const below2 = y + 2 < h ? own[(y + 2) * w + x] : -1;
        if ((below > k && below >= 0) || (below2 > k && below2 >= 0 && bayer(x + ox, y + oy) < 0.5)) i = Math.max(0, Math.min(i, 2) - 1);
        else if (y > 0 && own[(y - 1) * w + x] >= 0 && own[(y - 1) * w + x] < k && i < 4) i = Math.min(4, i + 1);
        // Liseré lumineux sous chaque boule, face au soleil couché.
        if (!inside(x, y + 1) && v > -0.5) i = 5;
        else if (!inside(x, y + 2) && v > 0.2) i = Math.max(i, 4);
        r.set(ox + x, oy + y, tones[i]);
      }
    }
  }

  /* ================= La scène ================= */
  class Toits {
    constructor(W, H, opts = {}) {
      this.W = W;
      this.H = H;
      // Monde élargi (animation d'ouverture) : le toit et la ville continuent à gauche
      // (et un peu à droite).
      const ext = opts.ext || {};
      this.extL = Math.max(0, Math.round(ext.left || 0));
      this.extR = Math.max(0, Math.round(ext.right || 0));
      this.wide = this.extL + this.extR > 0;
      const L = (this.L = {});
      L.seat = Math.round(H * 0.69); // bord du toit (gouttière) où ils sont assis
      L.ridge = L.seat - 25; // faîtage de leur toit
      L.railTop = L.ridge - 11;
      L.hz = L.ridge - 2; // horizon (caché par les toits)
      L.cx = Math.round(W * 0.47); // milieu du couple
      L.chimX = Math.round(Math.max(30, W * 0.13));
      L.poleX = Math.round(W - Math.max(30, W * 0.12));
      L.sunX = L.cx + 6;
      if (this.wide) this.layoutExt();

      this.fast = X.fastTest();
      this.t = 0;
      this.flock = new X.Flock({ x0: -this.extL, x1: W + this.extR, y0: 8, y1: Math.round(L.hz * 0.55), rate: [9, 20], color: '#f6eef8' });
      this.smoke = new X.Puffs('210,200,225');
      this.smoke2 = new X.Puffs('210,200,225');
      this.breath = new X.Puffs('240,240,250');
      this.hearts = [];
      this.nextHeart = 1.5;
      this.meteors = [];
      this.nextMeteor = 2;
      this.flash = 0;
      this.bolt = null;
      this.nextBolt = 6;
      this.drips = [];
      this.flies = [];
      this.cat = { state: 'sit', x: 0, dir: 1, timer: 5, frameT: 0, target: 0 };
      this.nextToggle = 5;
      // Le couple : poses et minuteries de leurs petits gestes.
      this.pose = {
        lean: 0, leanTimer: 9 + Math.random() * 8, leaner: 'g',
        hold: false, holdTimer: 14 + Math.random() * 10,
        blinkG: 3, blinkY: 4.5, gBlink: 0, yBlink: 0,
        legs: [0, 1.7, 0.8, 2.6],
        gx: 0, gy: 0, yx: 0, yy: 0,
      };
      if (this.fast) {
        this.flock.next = 0.3;
        this.nextHeart = 0.2;
        this.pose.leanTimer = 1;
        this.pose.holdTimer = 2.5;
        this.nextMeteor = 0.5;
        this.nextBolt = 1.2;
        this.cat.timer = 0.5;
      }
      this.effect = null;
      this.build('none');
    }

    // Plan du prolongement à gauche (x < 0). Le fond défile le moins vite pendant le
    // travelling, puis le plan moyen ; le premier plan (notre toit) défile en entier.
    layoutExt() {
      const E = this.extL;
      const at = (f) => Math.round(-f * E);
      this.XT = {
        // Notre toit (premier plan).
        dormer: -92,
        chimneys: [at(0.33), at(0.72)],
        laundry: [at(0.43), at(0.56)],
        antenna: at(0.64),
        coop: at(0.84),
        hatch: at(0.95),
        lantern: at(0.27),
        lower: [{ x0: -150, x1: -16, top: 33 }, { x0: at(0.57), x1: -158, top: 37 }, { x0: -E - 12, x1: at(0.57) - 8, top: 31 }],
        // Plan moyen : un toit-terrasse jardiné, un poteau.
        garden: [-178, -96],
        pole: -232,
        // Fond : la tour Eiffel, au loin.
        tower: -78,
      };
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
      this.rim = C(look.rim);
      this.skyWins = [];
      this.twinkles = [];
      this.windows = [];
      this.lamps = [];
      this.pots = [];
      this.bulbs = [];
      this.extLamps = [];
      this.extHalos = [];
      this.pots2 = [];
      this.laundry = [];
      this.coopBirds = [];
      this.back = this.paintBack().toCanvas();
      this.drift = this.makeDrift();
      this.mid = this.paintMid().toCanvas();
      this.fore = this.paintFore().toCanvas();
      this.halo = this.paintHalo();
      this.couple = new Couple(look);
      this.heartImgs = HEARTS.map((rows) => B.PX.sprite(rows, { h: look.storm ? '#d86a9c' : '#ff86b0', w: '#ffe0ec', d: '#d0508a' }));
      this.catImgs = this.makeCat();
      const bw = { w: css(mix(C('#f6eef8'), this.rim, 0.15)), d: css(mul(C('#6a5a7a'), look.amb)) };
      const hx = (c) => '#' + c.match(/\d+/g).slice(0, 3).map((v) => (+v).toString(16).padStart(2, '0')).join('');
      this.perchImgs = [['.ww', 'www', '.d.'], ['ww.', 'www', '.d.'], ['...', 'www', '.d.']].map((rows) => B.PX.sprite(rows, { w: hx(bw.w), d: hx(bw.d) }));
      // Pigeons gris (pigeonnier du prolongement).
      const pg = { w: hx(css(mul(C('#8a88a8'), look.amb))), h: hx(css(mix(mul(C('#6a6888'), look.amb), this.rim, 0.25))), d: hx(css(mul(C('#d8a070'), look.amb))) };
      this.coopImgs = [['.hh.', 'hwww', '.www'], ['hh..', 'hwww', '.www'], ['....', 'hwww', 'dwww']].map((rows) => B.PX.sprite(rows, pg));
      this.flock.o.color = '#f6eef8';
      this.flock.frames = X.birdSprites('#f6eef8');
      this.flies = look.fireflies ? Array.from({ length: this.wide ? Math.round((14 * (this.W + this.extL + this.extR)) / this.W) : 14 }, () => this.newFly()) : [];
      const c = this.cat;
      c.x = Math.round(lerp(this.catRidge.x0, this.catRidge.x1, 0.3));
      c.target = c.x;
    }

    /* ---------- Fond : ciel, nuages, ville lointaine ---------- */
    paintBack() {
      const { W, H, L, look } = this;
      const R = rng(7);
      const r = new Wide(W, H, this.extL, this.extR);
      const sky = look.sky.map(C);
      r.gradient(r.x0, 0, r.sw, L.hz + 4, sky, 8);
      r.rect(r.x0, L.hz + 4, r.sw, H - L.hz - 4, sky[sky.length - 1]);
      // Lueur du soleil couché, juste derrière le couple.
      const glow = C(look.glow);
      for (let y = 0; y < L.hz + 4; y++) {
        for (let x = r.x0; x < r.x1; x++) {
          const dd = Math.hypot((x - L.sunX) / (W * 0.42), (y - L.hz) / (L.hz * 0.62));
          if (dd >= 1) continue;
          const q = Math.floor((1 - dd) ** 1.6 * 6 + bayer(x, y) * 0.95) / 6;
          if (q > 0) r.tint(x, y, glow, q * look.glowK);
        }
      }
      // Voie lactée et étoiles.
      if (look.milky) {
        for (let y = 0; y < L.hz - 20; y++) {
          for (let x = r.x0; x < r.x1; x++) {
            const dd = Math.abs(y - 6 - (W - x) * 0.22);
            const band = 1 - dd / 34;
            if (band <= 0) continue;
            const v = band * fbm(x * 0.05, y * 0.07, 3);
            if (bayer(x, y) < (v - 0.2) * 1.6) r.tint(x, y, [120, 120, 200], 0.2);
            if (hash(x, y, 4) < v * 0.05) r.set(x, y, [210, 214, 245]);
          }
        }
      }
      const STAR = [[240, 236, 255], [255, 232, 220], [210, 220, 255]];
      for (let k = 0; k < look.stars; k++) {
        const x = Math.floor(R() * W);
        const y = Math.floor(Math.pow(R(), 1.4) * (L.hz - 30));
        const c = STAR[Math.floor(R() * 3)];
        const b = (0.3 + R() * 0.6) * (1 - y / L.hz);
        r.tint(x, y, c, b);
        if (this.twinkles.length < 22 && R() < 0.25) this.twinkles.push({ x, y, c, p: R() * 6, s: 1 + R() * 2.5 });
      }
      // Les étoiles du prolongement (autre graine : le ciel de l'écran ne change pas).
      if (this.wide && look.stars) {
        const RS = rng(311);
        const n = Math.round((look.stars * (this.extL + this.extR)) / W);
        const tw = [];
        r.only(() => {
          for (let k = 0; k < n; k++) {
            const u = Math.floor(RS() * (this.extL + this.extR));
            const x = u < this.extL ? -1 - u : W + u - this.extL;
            const y = Math.floor(Math.pow(RS(), 1.4) * (L.hz - 30));
            const c = STAR[Math.floor(RS() * 3)];
            const b = (0.3 + RS() * 0.6) * (1 - y / L.hz);
            r.tint(x, y, c, b);
            if (tw.length < 30 && RS() < 0.25) tw.push({ x, y, c, p: RS() * 6, s: 1 + RS() * 2.5 });
          }
        });
        this.twinkles.push(...tw);
      }
      if (look.moon) {
        const mx = Math.round(W * 0.7);
        const my = Math.round(L.hz * 0.22);
        this.moon = { x: mx, y: my };
        for (let y = -6; y <= 6; y++) {
          for (let x = -6; x <= 6; x++) {
            const dd = Math.hypot(x, y);
            if (dd > 5.6 || Math.hypot(x + 2.6, y - 1.4) < 4.6) continue;
            r.set(mx + x, my + y, dd > 4.8 ? C('#d8cfe6') : hash(x, y, 8) > 0.8 ? C('#e6dcef') : C('#f6f0f8'));
          }
        }
      } else this.moon = null;

      // Gros cumulus fixes, ou couverture nuageuse.
      const tones = look.cloud.map(C);
      // Les nuages du prolongement (peints d'abord : ceux de l'écran passent devant).
      if (this.wide && look.clouds === 'cumulus') {
        const ext = [
          { x: -0.4, y: 0.64, w: 0.46, h: 0.55, s: 101 },
          { x: -0.9, y: 0.7, w: 0.42, h: 0.46, s: 103 },
          { x: -1.36, y: 0.6, w: 0.5, h: 0.6, s: 107 },
          { x: -0.66, y: 0.99, w: 0.3, h: 0.24, s: 109 },
          { x: -1.12, y: 0.97, w: 0.34, h: 0.27, s: 113 },
          { x: -1.58, y: 0.96, w: 0.3, h: 0.25, s: 117 },
          { x: 1.22, y: 0.72, w: 0.36, h: 0.4, s: 121 },
        ];
        r.only(() => {
          for (const b of ext) {
            const cw = Math.round(W * b.w);
            const ch = Math.round(L.hz * b.h);
            const x0 = Math.round(W * b.x - cw / 2);
            if (x0 + cw < r.x0 || x0 > r.x1) continue;
            if (b.x < 0 && x0 + cw > -2) continue;
            if (b.x > 1 && x0 < W + 2) continue;
            paintCumulus(r, cumulus(cw, ch, b.s), x0, Math.round(L.hz * b.y - ch), tones, L.sunX);
          }
        });
      }
      if (look.clouds === 'cumulus') {
        const banks = [
          { x: 0.16, y: 0.66, w: 0.5, h: 0.52, s: 3 },
          { x: 0.84, y: 0.6, w: 0.52, h: 0.6, s: 5 },
          { x: 0.04, y: 0.99, w: 0.34, h: 0.26, s: 9 },
          { x: 0.97, y: 0.97, w: 0.32, h: 0.28, s: 15 },
        ];
        for (const b of banks) {
          const cw = Math.round(W * b.w);
          const ch = Math.round(L.hz * b.h);
          const cl = cumulus(cw, ch, b.s);
          paintCumulus(r, cl, Math.round(W * b.x - cw / 2), Math.round(L.hz * b.y - ch), tones, L.sunX);
        }
      } else if (look.clouds === 'overcast') {
        // Un plafond nuageux continu, puis des bourrelets qui pendent dessous.
        for (let y = 0; y < L.hz * 0.78; y++) {
          for (let x = r.x0; x < r.x1; x++) {
            const n = fbm(x * 0.012, y * 0.05, 33) - (y / (L.hz * 0.78)) * 0.35;
            if (n > 0.3) r.tint(x, y, tones[n > 0.42 ? 1 : 0], bayer(x, y) < (n - 0.3) * 6 ? 0.85 : 0.45);
          }
        }
        for (let k = 0; k < 9; k++) {
          const cw = Math.round(W * (0.36 + R() * 0.22));
          const ch = Math.round(L.hz * (0.22 + R() * 0.14));
          const cl = cumulus(cw, ch, 40 + k);
          const yb = Math.round(L.hz * (0.24 + (k % 3) * 0.19 + R() * 0.06));
          paintCumulus(r, cl, Math.round((k / 8) * W * 1.1 - cw * 0.6), yb - ch, tones, L.sunX);
        }
        if (this.wide) {
          const RC = rng(337);
          r.only(() => {
            for (let k = -2; (k / 8) * W * 1.1 > r.x0 - W * 0.3; k--) {
              const cw = Math.round(W * (0.36 + RC() * 0.22));
              const ch = Math.round(L.hz * (0.22 + RC() * 0.14));
              const yb = Math.round(L.hz * (0.24 + (pmod(k, 3)) * 0.19 + RC() * 0.06));
              paintCumulus(r, cumulus(cw, ch, 140 - k), Math.round((k / 8) * W * 1.1 - cw * 0.6), yb - ch, tones, L.sunX);
            }
          });
        }
      } else {
        // Voiles fins, nuit.
        const c1 = tones[2];
        for (let y = 10; y < L.hz - 10; y++) {
          for (let x = r.x0; x < r.x1; x++) {
            const n = fbm(x * 0.012, y * 0.09, 21);
            if (n > 0.58) r.tint(x, y, c1, bayer(x, y) < (n - 0.58) * 6 ? 0.55 : 0.28);
          }
        }
      }

      this.paintCity(r, R, -4, W, this.skyWins, 40);
      if (this.wide) {
        const RC = rng(331);
        const wins = [];
        r.only(() => {
          this.paintCity(r, RC, r.x0 - 8, -4, wins, 60);
          this.paintCity(r, RC, this.cityEnd, r.x1, wins, 70);
          this.paintTower(r);
        });
        this.skyWins.push(...wins);
      }
      return r;
    }

    // Ville lointaine, pâle dans la brume, plus basse derrière le couple.
    paintCity(r, R, x, xEnd, skyWins, maxWins) {
      const { W, L, look } = this;
      const far = C(look.far);
      const haze = C(look.haze);
      const win = mix(haze, [255, 226, 170], 0.55);
      const base = this.H;
      for (; x < xEnd; ) {
        const w = 5 + Math.floor(R() * 12);
        const away = clamp01(Math.abs(x + w / 2 - L.cx) / (W * 0.22));
        let top = L.hz - 6 - Math.floor((6 + Math.pow(R(), 1.5) * 26) * (0.3 + 0.7 * away));
        const kind = R();
        for (let y = top; y < base; y++) {
          const q = Math.floor(clamp01((y - top) / (L.ridge + 6 - top)) * 4 + bayer(x, y)) / 4;
          const c = mix(far, haze, 0.15 + q * 0.45);
          for (let xx = x; xx < x + w; xx++) r.set(xx, y, c);
        }
        // Toit pointu ou dôme, de temps en temps (silhouette de ville ancienne).
        if (kind < 0.18 && away > 0.5) {
          const cx = x + (w >> 1);
          for (let k = 1; k <= Math.floor(w / 2) + 3; k++) r.rect(cx - Math.max(0, Math.floor(w / 2) - Math.floor(k / 1.5)), top - k, Math.max(1, w - 2 * Math.floor(k / 1.5)), 1, far);
        } else if (kind > 0.93 && away > 0.5) {
          const cx = x + w / 2;
          for (let y = -5; y <= 0; y++) for (let xx = -4; xx <= 4; xx++) if (xx * xx + (y * 1.4) ** 2 <= 20) r.set(Math.round(cx + xx), top + y, far);
          r.rect(Math.round(cx), top - 9, 1, 4, far);
        }
        // Liseré de lumière (le ciel derrière) sur le haut des immeubles.
        for (let xx = x; xx < x + w; xx++) r.tint(xx, top, haze, 0.35);
        for (let wy = top + 3; wy < base - 2; wy += 3) {
          for (let wx = x + 1; wx < x + w - 1; wx += 2) {
            if (R() < 0.09) {
              const off = css(r.get(wx, wy));
              r.set(wx, wy, win);
              if (wy < L.hz - 2 && skyWins.length < maxWins && R() < 0.4) skyWins.push({ x: wx, y: wy, lit: true, off });
            }
          }
        }
        x += w + (R() < 0.2 ? 1 : 0);
      }
      this.cityEnd = x;
    }

    // La tour Eiffel, au loin dans la ville du prolongement (elle scintille : voir draw).
    paintTower(r) {
      const { L, look, XT } = this;
      const tx = XT.tower;
      const far = mix(C(look.far), [0, 0, 0], 0.12);
      const edge = mix(far, C(look.haze), 0.35);
      const top = L.hz - 82;
      const base = L.ridge + 4;
      const hgt = base - top;
      this.towerLights = [];
      for (let y = top; y < base; y++) {
        const u = (y - top) / hgt;
        const hw = 0.6 + 15 * Math.pow(u, 2.3);
        const x0 = Math.round(tx - hw);
        const x1 = Math.round(tx + hw);
        const archTop = base - 9;
        for (let x = x0; x <= x1; x++) {
          const d = Math.min(x - x0, x1 - x);
          // L'arche entre les pieds.
          if (y > archTop - Math.round(4 * Math.sqrt(Math.max(0, 1 - ((x - tx) / (hw * 0.62)) ** 2))) && Math.abs(x - tx) < hw * 0.62) continue;
          const lattice = d < 2 || (x + y) % 2 === 0 || u < 0.3;
          if (!lattice) continue;
          r.set(x, y, d === 0 ? edge : far);
        }
        if (y % 5 === 0 && u > 0.08) this.towerLights.push({ x: x0 + 1 + ((y * 7) % Math.max(1, x1 - x0 - 1)), y, p: (y * 1.7) % 6 });
      }
      // Les deux plates-formes et l'antenne.
      for (const u of [0.42, 0.66]) {
        const y = Math.round(top + u * hgt);
        const hw = Math.round(0.6 + 15 * Math.pow(u, 2.3)) + 2;
        r.rect(tx - hw, y, hw * 2 + 1, 2, far);
        r.rect(tx - hw, y, hw * 2 + 1, 1, edge);
      }
      r.rect(tx, top - 7, 1, 7, far);
      this.towerBeacon = { x: tx, y: top - 8 };
    }

    // Petits nuages qui dérivent lentement (dessinés juste après le fond).
    makeDrift() {
      const { W, L, look } = this;
      const tones = look.cloud.map(C);
      const out = [];
      const n = look.clouds === 'thin' ? 2 : 3;
      // Monde élargi : d'autres voiles au-dessus du prolongement (même dessin, autre graine).
      const m = this.wide ? n + Math.max(1, Math.round((this.extL + this.extR) / (W * 0.55))) : n;
      for (let k = 0; k < m; k++) {
        // Longs voiles effilochés, éclairés par en dessous, qui glissent devant le ciel.
        const kk = k % 3;
        const cw = Math.round(W * (0.24 + kk * 0.07));
        const ch = 9 + kk * 2;
        const r = new Raster(cw, ch);
        const seed = 70 + k * 7;
        for (let y = 0; y < ch; y++) {
          for (let x = 0; x < cw; x++) {
            const ex = (x / cw) * 2 - 1;
            const ey = (y / ch) * 2 - 1;
            const env = 1 - ex * ex - ey * ey * 0.8;
            if (env <= 0) continue;
            const v = fbm(x * 0.035, y * 0.3, seed) * env * 1.6;
            if (v < 0.42 || bayer(x, y) > (v - 0.42) * 5) continue;
            const lit = y / ch + (v - 0.5) * 0.6;
            r.set(x, y, tones[Math.max(1, Math.min(5, Math.floor(1 + lit * 4.4 + bayer(x, y) * 0.8)))]);
          }
        }
        const x = k < n ? Math.round(W * (0.3 + k * 0.33)) : Math.round(-this.extL + (k - n + 0.3) * W * 0.55);
        out.push({ img: r.toCanvas(), x, y: Math.round(L.hz * (0.06 + kk * 0.13)) + (k < n ? 0 : (k * 5) % 9), w: cw, v: 0.35 + kk * 0.18 });
      }
      return out;
    }

    /* ---------- Plan moyen : toits voisins, souche de cheminée, poteau, fils ---------- */
    paintMid() {
      const { W, H, L, look } = this;
      const R = rng(23);
      const r = new Wide(W, H, this.extL, this.extR);
      const g = this.grade;
      const rim = this.rim;
      const house = PAL.house.map((h) => mix(g(h), C(look.haze), 0.12));
      const lit = PAL.lit.map(C);
      const glass = PAL.glass.map(g);

      // Toits voisins, à gauche et à droite (moins hauts près du couple : on voit le ciel).
      const houses = [];
      const add = (x0, x1, h, kind) => houses.push({ x0, x1, h, kind });
      let x = -6;
      while (x < L.cx - 44) {
        const w = 26 + Math.floor(R() * 22);
        add(x, Math.min(x + w, L.cx - 40), 8 + Math.floor(R() * 14), R() < 0.5 ? 'mansard' : 'ridge');
        x += w + 2;
      }
      x = L.cx + 46;
      while (x < W + 6) {
        const w = 28 + Math.floor(R() * 24);
        add(x, x + w, 10 + Math.floor(R() * 14), R() < 0.5 ? 'ridge' : 'mansard');
        x += w + 2;
      }
      this.catRidge = { x0: 10, x1: 40, y: L.ridge - 10 };
      let best = 0;
      const drawHouse = (hs, R, ext) => {
        const top = L.ridge - hs.h;
        const inset = hs.kind === 'mansard' ? 4 : 6;
        for (let y = top; y < L.ridge + 4; y++) {
          const k = clamp01((y - top) / Math.max(1, hs.h * 0.7));
          const xa = Math.round(hs.x0 + inset * (1 - k));
          const xb = Math.round(hs.x1 - inset * (1 - k));
          for (let xx = xa; xx < xb; xx++) {
            let c = house[1];
            if ((y - top) % 3 === 2) c = house[0]; // rangs de tuiles
            if (xx === xa || xx === xb - 1) c = house[0];
            r.set(xx, y, c);
          }
        }
        // Faîtage éclairé par le ciel.
        for (let xx = hs.x0 + inset; xx < hs.x1 - inset; xx++) r.set(xx, top, mix(house[3], rim, 0.35));
        const span = hs.x1 - hs.x0 - inset * 2;
        if (!ext && hs.kind === 'ridge' && hs.x1 < L.cx && span > best && hs.x0 > L.chimX + 14) {
          best = span;
          this.catRidge = { x0: hs.x0 + inset + 2, x1: hs.x1 - inset - 10, y: top };
        }
        // Lucarnes.
        const nd = Math.max(1, Math.floor(span / 16));
        for (let k = 0; k < nd; k++) {
          const dx = Math.round(hs.x0 + inset + ((k + 0.5) * span) / nd) - 3;
          const dy = top + 3;
          if (dy + 7 > L.ridge + 2) continue;
          r.rect(dx, dy, 7, 7, house[2]);
          for (let j = 0; j < 4; j++) r.rect(dx + 3 - j, dy - 1 - j + 1, 1 + j * 2, 1, j === 3 ? house[0] : house[2]);
          r.set(dx + 3, dy - 3, mix(house[3], rim, 0.5));
          const on = R() < look.winLit;
          r.rect(dx + 2, dy + 2, 3, 4, on ? lit[1] : glass[1]);
          if (on) {
            r.set(dx + 2, dy + 2, lit[0]);
            (ext ? this.extLamps : this.lamps).push({ x: dx + 3, y: dy + 4, r: 8, k: 0.35, small: true });
          }
          this.windows.push({ x: dx + 2, y: dy + 2, w: 3, h: 4, lit: on, layer: 'mid' });
        }
        // Cheminée et pots, antenne.
        if (R() < 0.7) {
          const cx = Math.round(hs.x0 + inset + R() * (span - 6));
          const ctop = top - 5 - Math.floor(R() * 4);
          r.rect(cx, ctop, 4, top - ctop + 1, house[2]);
          r.rect(cx - 1, ctop, 6, 1, house[3]);
          r.set(cx + 1, ctop - 1, mix(g(PAL.pot[1]), C(look.haze), 0.15));
          r.set(cx + 2, ctop - 1, mix(g(PAL.pot[1]), C(look.haze), 0.15));
          this.pots.push({ x: cx + 1, y: ctop - 2, small: true });
        }
        if (R() < 0.35) {
          const ax = Math.round(hs.x0 + inset + 4 + R() * Math.max(1, span - 10));
          r.rect(ax, top - 9, 1, 9, house[0]);
          r.rect(ax - 3, top - 7, 7, 1, house[0]);
          r.rect(ax - 2, top - 5, 5, 1, house[0]);
        }
      };
      for (const hs of houses) drawHouse(hs, R, false);
      // Prolongement : d'autres toits voisins (autre graine), un toit-terrasse jardiné.
      if (this.wide) {
        const RH = rng(349);
        const [g0, g1] = this.XT.garden;
        const more = [];
        let xr = -8;
        while (xr > r.x0 - 30) {
          const w = 26 + Math.floor(RH() * 22);
          const h = 8 + Math.floor(RH() * 16);
          const kind = RH() < 0.5 ? 'mansard' : 'ridge';
          if (xr - w < g1 + 6 && xr > g0 - 6) {
            xr = g0 - 8;
            continue;
          }
          more.push({ x0: xr - w, x1: xr, h, kind });
          xr -= w + 2 + (RH() < 0.3 ? 4 : 0);
        }
        let xx = x;
        while (xx < r.x1 + 6) {
          const w = 28 + Math.floor(RH() * 24);
          more.push({ x0: xx, x1: xx + w, h: 10 + Math.floor(RH() * 14), kind: RH() < 0.5 ? 'ridge' : 'mansard' });
          xx += w + 2;
        }
        r.only(() => {
          for (const hs of more) drawHouse(hs, RH, true);
          this.paintRoofGarden(r, RH);
        });
      }

      // Arbre derrière les toits (printemps, automne).
      if (look.tree) this.paintTree(r, R);

      // La souche de cheminée, à gauche : briques, chapeau de pierre, trois pots.
      const cx = L.chimX;
      const cw = 15;
      const ctop = L.ridge - 34;
      const brick = PAL.brick.map(g);
      for (let y = ctop; y < L.ridge + 4; y++) {
        for (let xx = cx; xx < cx + cw; xx++) {
          const row = Math.floor((y - ctop) / 2);
          const joint = (y - ctop) % 2 === 1 || (xx - cx + (row % 2) * 2) % 4 === 0;
          let c = joint ? brick[0] : hash(xx >> 2, row, 3) > 0.6 ? brick[2] : brick[1];
          if (xx >= cx + cw - 2) c = mix(c, rim, xx === cx + cw - 1 ? 0.45 : 0.2);
          if (xx <= cx + 1) c = mix(c, brick[0], 0.5);
          r.set(xx, y, c);
        }
      }
      const capC = g('#4e4466');
      r.rect(cx - 2, ctop - 3, cw + 4, 3, capC);
      r.rect(cx - 2, ctop - 3, cw + 4, 1, mix(capC, rim, 0.55));
      r.rect(cx - 2, ctop - 1, cw + 4, 1, g('#2a2240'));
      const pot = PAL.pot.map(g);
      for (let k = 0; k < 3; k++) {
        const px = cx + 1 + k * 5;
        const ph = 5 + ((k * 7) % 3);
        r.rect(px, ctop - 3 - ph, 3, ph, pot[1]);
        r.rect(px - 1, ctop - 4 - ph, 5, 1, pot[2]);
        r.set(px + 2, ctop - 3 - ph + 1, mix(pot[2], rim, 0.4));
        r.rect(px, ctop - 3 - ph, 1, ph, pot[0]);
        this.pots.push({ x: px + 1, y: ctop - 5 - ph });
      }
      this.wireA = { x: cx + cw - 1, y: ctop + 6 };

      // Le poteau électrique, à droite, et ses fils.
      const px = L.poleX;
      const ptop = Math.round(L.ridge * 0.28);
      const wood = PAL.wood.map(g);
      for (let y = ptop; y < H; y++) {
        r.set(px - 1, y, mix(wood[2], rim, 0.4));
        r.set(px, y, wood[1]);
        r.set(px + 1, y, wood[0]);
        if (hash(px, y >> 2, 2) > 0.8) r.set(px, y, wood[0]);
      }
      r.rect(px - 1, ptop - 1, 3, 1, wood[1]);
      const arms = [ptop + 4, ptop + 11];
      for (const ay of arms) {
        r.rect(px - 10, ay, 21, 2, wood[1]);
        r.rect(px - 10, ay, 21, 1, mix(wood[2], rim, 0.3));
        for (const ix of [-9, -4, 4, 9]) {
          r.rect(px + ix, ay - 2, 1, 2, g('#c8c4d8'));
          r.set(px + ix, ay - 3, g('#e8e4f0'));
        }
        r.rect(px - 7, ay + 2, 1, 3, wood[0]);
        r.rect(px + 7, ay + 2, 1, 3, wood[0]);
      }
      // Transformateur.
      r.rect(px + 2, ptop + 20, 5, 8, g('#4a4660'));
      r.rect(px + 2, ptop + 20, 5, 1, mix(g('#7a7690'), rim, 0.3));
      r.rect(px + 6, ptop + 21, 1, 7, g('#2c2840'));
      // Fils : du poteau vers la cheminée et hors champ, avec leur courbe.
      const wire = g(PAL.wire);
      const wires = [];
      const wa = this.wireA;
      wires.push([px - 9, arms[0] - 3, wa.x, wa.y, 12]);
      wires.push([px - 4, arms[0] - 3, wa.x, wa.y + 3, 13]);
      wires.push([wa.x - cw + 1, wa.y + 1, -2, wa.y + 9, 5]);
      wires.push([wa.x - cw + 1, wa.y + 4, -2, wa.y + 12, 5]);
      wires.push([px + 4, arms[0] - 3, W + 2, arms[0] + 2, 3]);
      wires.push([px + 9, arms[0] - 3, W + 2, arms[0] + 3, 3]);
      wires.push([px + 4, arms[1] - 3, W + 2, arms[1] + 4, 4]);
      this.wires = wires;
      // Petits oiseaux blancs posés sur le premier fil.
      this.perched = [];
      if (look.birds) {
        const [x0, y0, x1, y1, sag] = wires[0];
        for (const u of [0.14, 0.2, 0.55]) {
          const bx = Math.round(x0 + (x1 - x0) * u);
          const by = Math.round(y0 + (y1 - y0) * u + sag * 4 * u * (1 - u));
          this.perched.push({ x: bx - 1, y: by - 3, p: u * 40 });
        }
      }
      // Prolongement : la ligne continue jusqu'à d'autres poteaux.
      const extWires = [];
      if (this.wide) {
        r.only(() => {
          const XT = this.XT;
          const pt = Math.round(L.ridge * 0.36);
          if (XT.pole > r.x0 + 12) {
            this.paintPole(r, XT.pole, pt);
            extWires.push([XT.pole + 9, pt + 1, -2, wa.y + 9, 8]);
            extWires.push([XT.pole + 4, pt + 1, -2, wa.y + 12, 9]);
            extWires.push([r.x0 - 2, pt + 6, XT.pole - 9, pt + 1, 6]);
            extWires.push([r.x0 - 2, pt + 9, XT.pole - 4, pt + 1, 7]);
            if (look.birds) {
              const [x0, y0, x1, y1, sag] = extWires[0];
              for (const u of [0.3, 0.38, 0.7]) {
                const bx = Math.round(x0 + (x1 - x0) * u);
                const by = Math.round(y0 + (y1 - y0) * u + sag * 4 * u * (1 - u));
                this.perched.push({ x: bx - 1, y: by - 3, p: u * 31 });
              }
            }
          }
          if (this.extR >= 30) {
            const prx = W + Math.round(this.extR * 0.7);
            const prt = Math.round(L.ridge * 0.3);
            this.paintPole(r, prx, prt);
            extWires.push([W + 2, arms[0] + 2, prx - 9, prt + 1, 3]);
            extWires.push([W + 2, arms[0] + 3, prx - 4, prt + 1, 3]);
            extWires.push([W + 2, arms[1] + 4, prx - 4, prt + 8, 3]);
            extWires.push([prx + 4, prt + 1, r.x1 + 2, prt + 5, 3]);
            extWires.push([prx + 9, prt + 1, r.x1 + 2, prt + 6, 3]);
          }
        });
      }
      if (look.snow) this.snowCaps(r, 0, L.ridge + 2);
      const drawWires = (list) => {
        for (const [x0, y0, x1, y1, sag] of list) {
          const n = Math.abs(x1 - x0);
          for (let i = 0; i <= n; i++) {
            const u = i / n;
            const wx = Math.round(x0 + (x1 - x0) * u);
            const wy = Math.round(y0 + (y1 - y0) * u + sag * 4 * u * (1 - u));
            r.set(wx, wy, wire);
            if (look.snow && hash(wx, wy, 13) > 0.72) r.set(wx, wy - 1, C('#dcdcee'));
          }
        }
      };
      drawWires(wires);
      if (extWires.length) r.only(() => drawWires(extWires));
      return r;
    }

    // Un poteau électrique en bois du prolongement (comme celui de l'écran, sans transformateur).
    paintPole(r, px, ptop) {
      const { H } = this;
      const g = this.grade;
      const rim = this.rim;
      const wood = PAL.wood.map(g);
      for (let y = ptop; y < H; y++) {
        r.set(px - 1, y, mix(wood[2], rim, 0.4));
        r.set(px, y, wood[1]);
        r.set(px + 1, y, wood[0]);
        if (hash(px, y >> 2, 2) > 0.8) r.set(px, y, wood[0]);
      }
      r.rect(px - 1, ptop - 1, 3, 1, wood[1]);
      for (const ay of [ptop + 4]) {
        r.rect(px - 10, ay, 21, 2, wood[1]);
        r.rect(px - 10, ay, 21, 1, mix(wood[2], rim, 0.3));
        for (const ix of [-9, -4, 4, 9]) {
          r.rect(px + ix, ay - 2, 1, 2, g('#c8c4d8'));
          r.set(px + ix, ay - 3, g('#e8e4f0'));
        }
        r.rect(px - 7, ay + 2, 1, 3, wood[0]);
        r.rect(px + 7, ay + 2, 1, 3, wood[0]);
      }
    }

    // Le toit-terrasse jardiné d'un voisin : parapet, citronnier en pot, parasol, transat,
    // jardinières et une guirlande.
    paintRoofGarden(r, R) {
      const { L, look, XT } = this;
      const g = this.grade;
      const rim = this.rim;
      const [x0, x1] = XT.garden;
      const top = L.ridge - 15;
      const house = PAL.house.map((h) => mix(g(h), C(look.haze), 0.12));
      // Le mur et le parapet.
      for (let y = top; y < L.ridge + 4; y++) for (let x = x0; x < x1; x++) r.set(x, y, (y - top) % 4 === 3 ? house[0] : x === x0 ? house[0] : house[1]);
      r.rect(x0 - 1, top - 3, x1 - x0 + 2, 3, house[2]);
      r.rect(x0 - 1, top - 3, x1 - x0 + 2, 1, mix(house[3], rim, 0.45));
      // Une lucarne éclairée dans le mur.
      const wx = x0 + Math.round((x1 - x0) * 0.62);
      r.rect(wx, top + 3, 5, 6, mix(g('#1a1230'), rim, 0.05));
      r.rect(wx + 1, top + 4, 3, 4, C(PAL.lit[1]));
      r.set(wx + 1, top + 4, C(PAL.lit[0]));
      this.windows.push({ x: wx + 1, y: top + 4, w: 3, h: 4, lit: true, layer: 'mid' });
      this.extLamps.push({ x: wx + 2, y: top + 6, r: 8, k: 0.35, small: true });
      // Le citronnier.
      const leaf = (look.tree === 'autumn' ? ['#4a3020', '#7a4a24', '#a8682c'] : ['#1e3a2c', '#2e5638', '#467a48']).map(g);
      const tx = x0 + 9;
      r.rect(tx - 3, top - 8, 7, 5, mix(g(PAL.pot[1]), rim, 0.1));
      r.rect(tx - 4, top - 8, 9, 1, g(PAL.pot[2]));
      r.rect(tx, top - 16, 1, 8, g('#2a1c2c'));
      for (let y = -6; y <= 6; y++) {
        for (let x = -7; x <= 7; x++) {
          if (x * x + y * y * 1.3 > 40 + noise(x * 0.6, y * 0.6, 3) * 14) continue;
          let c = leaf[y < -2 ? 2 : y < 3 ? 1 : 0];
          if (y < -3 && bayer(tx + x, y) < 0.4) c = mix(c, rim, 0.3);
          r.set(tx + x, top - 21 + y, c);
        }
      }
      for (const [fx, fy] of [[-3, -2], [2, 1], [4, -4], [-5, 2], [0, -5]]) r.set(tx + fx, top - 21 + fy, g('#f0d040'));
      // Le parasol fermé, le transat, les jardinières.
      const px = x0 + 24;
      r.rect(px, top - 22, 1, 19, g('#3a3046'));
      for (let k = 0; k < 12; k++) r.rect(px - Math.floor((12 - k) / 5), top - 22 + k, 1 + 2 * Math.floor((12 - k) / 5), 1, k % 4 < 2 ? g('#d86a6a') : g('#f0e4d8'));
      const dx = x0 + 34;
      for (let k = 0; k < 9; k++) r.set(dx + k, top - 4 - Math.floor(k / 2), g('#c89a5a'));
      for (let k = 0; k < 6; k++) r.set(dx + 2 + k, top - 4, g('#3a7ab0'));
      r.set(dx, top - 3, g('#5a4030'));
      r.set(dx + 8, top - 3, g('#5a4030'));
      const FL = ['#e84a5a', '#f4a0b8', '#f8d850', '#b070d0'].map(C);
      for (let x = x0 + 46; x < x1 - 4; x++) {
        r.set(x, top - 4, g('#6a4a30'));
        if (hash(x, top, 3) > 0.3) r.set(x, top - 5, leaf[1 + (x % 2)]);
        if (hash(x, top, 5) > 0.65) r.set(x, top - 6, FL[Math.floor(hash(x, 1, 6) * 4)]);
      }
      // La guirlande, entre deux piquets.
      const ga = x0 + 3;
      const gb = x1 - 3;
      r.rect(ga, top - 18, 1, 15, g('#2a2238'));
      r.rect(gb, top - 18, 1, 15, g('#2a2238'));
      const BUL = ['#ffd27a', '#ff9ab8', '#a8e0ff', '#ffe6a0'];
      for (let x = ga; x <= gb; x++) {
        const u = (x - ga) / (gb - ga);
        const y = Math.round(top - 18 + 7 * 4 * u * (1 - u));
        r.set(x, y, g('#2a2238'));
        if ((x - ga) % 6 === 3) {
          r.set(x, y + 1, C(BUL[((x - ga) / 6) % 4 | 0]));
          this.extLamps.push({ x, y: y + 1, r: 4, k: 0.3, small: true });
          this.bulbs.push({ x, y: y + 1, p: hash(x, y, 9) * 6, c: BUL[((x - ga) / 6) % 4 | 0], mid: true });
        }
      }
    }

    // Un arbre en fleurs (ou roux) qui dépasse des toits, à droite.
    paintTree(r, R) {
      const { L, look } = this;
      const ramp = look.tree === 'sakura' ? ['#7a4a7a', '#b06a96', '#e094b6', '#f8bcd0', '#ffe0ea'] : ['#5a2030', '#8e3628', '#c85a2a', '#ee8a34', '#ffc060'];
      const cols = ramp.map(C);
      const tx = L.cx + 70;
      const ty = L.ridge - 24;
      const trunk = this.grade('#2a1c2c');
      for (let y = ty; y < L.ridge + 2; y++) r.rect(tx + Math.round(Math.sin(y * 0.2)), y, 3, 1, trunk);
      const blobs = Array.from({ length: 9 }, () => ({ x: tx + 1 + (R() - 0.5) * 34, y: ty - 4 + (R() - 0.5) * 16, r: 6 + R() * 6 }));
      for (let y = ty - 20; y < L.ridge; y++) {
        for (let x = tx - 30; x < tx + 32; x++) {
          let inside = false;
          let ly = 0;
          for (const b of blobs) {
            const dd = Math.hypot(x - b.x, (y - b.y) * 1.2);
            if (dd < b.r * (0.85 + noise(x * 0.4, y * 0.4, 5) * 0.3)) {
              inside = true;
              ly = (b.y - y) / b.r;
            }
          }
          if (!inside) continue;
          const v = ly * 0.5 + (x - tx) / -60 + (fbm(x * 0.2, y * 0.2, 6) - 0.5);
          const i = Math.max(0, Math.min(4, Math.floor((v + 0.6) * 3 + bayer(x, y))));
          r.set(x, y, cols[i]);
        }
      }
    }

    /* ---------- Premier plan : leur toit, la rambarde, la gouttière, les toits du bas ---------- */
    paintFore() {
      const { W, H, L, look } = this;
      const R = rng(41);
      const r = new Wide(W, H, this.extL, this.extR);
      const g = this.grade;
      const rim = this.rim;
      const glow = new Uint8Array(r.sw * H); // pixels lumineux (pas d'éclairage par-dessus)

      // Ardoises : rangs qui grandissent en approchant du bord (perspective).
      const tile = PAL.tile.map(g);
      let y = L.ridge + 3;
      let row = 0;
      this.tileRows = [];
      while (y < L.seat) {
        const hgt = Math.min(L.seat - y, 2 + Math.floor((row + 2) / 2));
        this.tileRows.push({ y, h: hgt });
        const tw = 5 + Math.floor(row * 0.8);
        const off = Math.floor(hash(row, 1, 7) * tw);
        // Le ciel se reflète un peu sur les ardoises du haut.
        const sheen = 1 - (y - L.ridge) / (L.seat - L.ridge);
        for (let j = 0; j < hgt; j++) {
          for (let x = r.x0; x < r.x1; x++) {
            const col = Math.floor((x + off) / tw);
            const inX = pmod(x + off, tw);
            const v = hash(col, row, 3);
            let c = mix(tile[2], v > 0.5 ? tile[3] : tile[1], Math.abs(v - 0.5) * 0.9);
            if (j === 0) c = mix(tile[0], c, 0.25); // ombre du rang du dessus
            else if (inX === 0) c = mix(c, tile[0], 0.45); // joint
            else if (j === hgt - 1 && hgt > 3) c = mix(c, tile[4], 0.3); // bord de l'ardoise
            if (j > 0 && hash(x, y + j, 9) < 0.03) c = mix(c, tile[5], 0.35);
            if (j > 0 && bayer(x, y + j) < sheen * 0.5) c = mix(c, rim, 0.14 * sheen);
            r.set(x, y + j, c);
          }
        }
        y += hgt;
        row++;
      }
      // Faîtage arrondi, liseré du ciel dessus.
      const ridge = PAL.ridge.map(g);
      for (let x = r.x0; x < r.x1; x++) {
        const k = pmod(x, 9);
        r.set(x, L.ridge - 1, k === 0 ? ridge[0] : mix(ridge[2], rim, 0.55));
        r.set(x, L.ridge, k === 0 ? ridge[0] : ridge[2]);
        r.set(x, L.ridge + 1, k === 0 ? ridge[0] : ridge[1]);
        r.set(x, L.ridge + 2, ridge[0]);
      }

      // Châssis de toit allumé, à droite du couple.
      const sk = { x: L.cx + 44, y: L.ridge + 8, w: 13, h: 9 };
      if (sk.x + sk.w < L.poleX - 6) {
        r.rect(sk.x - 1, sk.y - 1, sk.w + 2, sk.h + 2, g('#2a2440'));
        r.rect(sk.x - 1, sk.y - 1, sk.w + 2, 1, mix(g('#6a6088'), rim, 0.4));
        const on = look !== LOOKS.sakura;
        for (let j = 0; j < sk.h; j++) {
          for (let i = 0; i < sk.w; i++) {
            const c = on ? (j < 3 ? C(PAL.lit[0]) : C(PAL.lit[1])) : g(PAL.glass[2]);
            r.set(sk.x + i, sk.y + j, i === 6 ? g('#2a2440') : c);
            if (on) glow[r.i(sk.x + i, sk.y + j)] = 1;
          }
        }
        if (on) this.lamps.push({ x: sk.x + 6, y: sk.y + 4, r: 18, k: 0.5 });
      }

      // La rambarde, derrière eux.
      const rail = PAL.rail.map(g);
      const rx0 = Math.round(L.cx - Math.min(80, W * 0.22));
      const rx1 = Math.round(L.cx + Math.min(84, W * 0.23));
      this.rail = { x0: rx0, x1: rx1 };
      for (let x = rx0; x <= rx1; x++) {
        r.set(x, L.railTop, mix(rail[2], rim, 0.55));
        r.set(x, L.railTop + 1, rail[1]);
        r.set(x, L.railTop + 6, rail[1]);
        if ((x - rx0) % 6 === 3) for (let yy = L.railTop + 2; yy < L.ridge - 1; yy++) if (yy !== L.railTop + 6) r.set(x, yy, rail[1]);
      }
      for (let x = rx0; x <= rx1; x += 24) {
        r.rect(x - 1, L.railTop - 1, 2, L.ridge - L.railTop + 1, rail[1]);
        r.set(x - 1, L.railTop - 2, mix(rail[2], rim, 0.6));
        r.set(x, L.railTop - 1, mix(rail[2], rim, 0.4));
        r.rect(x, L.railTop, 1, L.ridge - L.railTop, rail[0]);
      }
      // Guirlande lumineuse sur la rambarde (nuits d'été).
      if (look.strings) {
        for (let x = rx0; x <= rx1; x++) {
          const u = ((x - rx0) % 16) / 16;
          const yy = L.railTop + 1 + Math.round(Math.sin(u * Math.PI) * 4);
          r.set(x, yy, rail[0]);
          if ((x - rx0) % 5 === 2) this.bulbs.push({ x, y: yy + 1, p: Math.random() * 6, c: ['#ffd27a', '#ff9ab8', '#a8e0ff', '#c8ff9a'][this.bulbs.length % 4] });
        }
      }

      // Gouttière en zinc.
      const gut = PAL.gutter.map(g);
      for (let x = r.x0; x < r.x1; x++) {
        r.set(x, L.seat, mix(gut[3], rim, 0.3));
        r.set(x, L.seat + 1, gut[2]);
        r.set(x, L.seat + 2, gut[1]);
        r.set(x, L.seat + 3, gut[0]);
        if (pmod(x, 37) === 0) r.set(x, L.seat + 1, gut[3]);
      }

      // La façade sous eux : une rangée d'immeubles (murs mitoyens), puis les toits du bas.
      const wall = PAL.wall.map(g);
      const party = [];
      const kk = this.wide ? 6 + Math.ceil(Math.max(this.extL, this.extR) / 84) : 6;
      for (let k = -kk; k <= kk; k++) party.push(Math.round(L.cx + 58 + k * 84 + (k % 2) * 9));
      for (let yy = L.seat + 4; yy < H; yy++) {
        for (let x = r.x0; x < r.x1; x++) {
          const n = fbm(x * 0.09, yy * 0.12, 12);
          let c = bayer(x, yy) < (n - 0.42) * 3 ? wall[2] : wall[1];
          if (n < 0.36 && bayer(x, yy) < 0.5) c = wall[0];
          for (const p of party) {
            if (x === p) c = wall[0];
            else if (x === p + 1) c = wall[3];
          }
          if (yy < L.seat + 7) c = mix(c, wall[0], 0.6); // ombre sous la gouttière
          r.set(x, yy, c);
        }
      }
      // Descente de gouttière.
      const dpx = Math.round(L.cx - Math.min(110, W * 0.3));
      r.rect(dpx, L.seat + 3, 2, H - L.seat, gut[1]);
      r.rect(dpx, L.seat + 3, 1, H - L.seat, gut[2]);
      // Fenêtres du dernier étage : celle entre leurs jambes est toujours allumée.
      const wy = L.seat + 9;
      const spots = [L.cx - 6];
      for (let k = 1; k < 7; k++) {
        spots.push(L.cx - 6 - k * 42);
        spots.push(L.cx - 6 + k * 42);
      }
      for (const wx of spots) {
        if (wx < -14 || wx > W) continue;
        const on = wx === L.cx - 6 || R() < look.winLit;
        this.paintWindow(r, glow, wx, wy, 12, 17, on);
      }
      // Étage du dessous, au milieu (entre les deux toits bas).
      for (const wx of [L.cx - 33, L.cx + 22]) this.paintWindow(r, glow, wx, wy + 32, 12, 17, R() < look.winLit + 0.2);

      // Toits du bas, dans l'ombre violette.
      const lower = PAL.lower.map(g);
      const roofs = [
        { x0: -10, x1: Math.round(L.cx - 52), top: L.seat + 33 },
        { x0: Math.round(L.cx + 50), x1: W + 10, top: L.seat + 29 },
      ];
      for (const rf of roofs) this.paintLowerRoof(r, glow, rf, lower, R);
      // Lanterne accrochée à la façade.
      const lx = Math.round(L.cx + 34);
      const ly = L.seat + 12;
      r.rect(lx, ly - 6, 1, 5, lower[0]);
      r.rect(lx - 3, ly - 6, 4, 1, lower[0]);
      r.rect(lx - 2, ly - 1, 5, 1, lower[1]);
      r.rect(lx - 2, ly, 5, 5, lower[0]);
      r.rect(lx - 1, ly + 1, 3, 3, C(PAL.lit[1]));
      r.set(lx, ly + 2, C(PAL.lit[0]));
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) glow[r.i(lx - 1 + i, ly + 1 + j)] = 1;
      r.rect(lx - 2, ly + 5, 5, 1, lower[1]);
      this.lantern = { x: lx, y: ly + 2 };
      this.lamps.push({ x: lx, y: ly + 2, r: 26, k: 0.75 });

      // Le prolongement : la façade et notre toit continuent.
      if (this.wide) r.only(() => this.paintExtFore(r, glow, rng(353), { wy, lower, gut }));

      // Selon la météo : neige posée, toit mouillé, pétales ou feuilles.
      if (look.snow) this.snowCaps(r, L.ridge - 14, H, glow);
      if (look.wet) this.wetShine(r);
      if (look.litter) this.paintLitter(r, R);

      // Lumière chaude des fenêtres et des lanternes, peinte sur tout le premier plan.
      const lights = this.lamps.filter((l) => !l.small).map((l) => ({ x: l.x, y: l.y, r: l.r, k: l.k }));
      const extra = this.extLamps.filter((l) => !l.small).map((l) => ({ x: l.x, y: l.y, r: l.r, k: l.k }));
      applyLight(r, lights, [0.96, 0.95, 1], [0.7, 0.42, 0.18], (x, yy) => !glow[r.i(x, yy)], extra);
      return r;
    }

    /* ---------- Le prolongement du premier plan ---------- */
    // Sous la gouttière : la façade continue (fenêtres, descente, lanterne), d'autres toits
    // bas. Sur notre toit : une lucarne allumée, deux souches de cheminée, une antenne,
    // un fil à linge, un pigeonnier et un châssis de toit.
    paintExtFore(r, glow, R, o) {
      const { W, L, look, XT } = this;
      const g = this.grade;
      const rim = this.rim;
      const { wy, lower, gut } = o;
      // Fenêtres du dernier étage, au même rythme que sous le couple.
      for (let k = 1; L.cx - 6 - k * 42 > r.x0 - 14; k++) {
        const wx = L.cx - 6 - k * 42;
        if (wx < -14) this.paintWindow(r, glow, wx, wy, 12, 17, R() < look.winLit, this.extLamps);
      }
      for (let k = 1; L.cx - 6 + k * 42 < r.x1 + 2; k++) {
        const wx = L.cx - 6 + k * 42;
        if (wx > W) this.paintWindow(r, glow, wx, wy, 12, 17, R() < look.winLit, this.extLamps);
      }
      // Une autre descente de gouttière.
      const dpx = XT.lantern - 52;
      if (dpx > r.x0 + 2) {
        r.rect(dpx, L.seat + 3, 2, this.H - L.seat, gut[1]);
        r.rect(dpx, L.seat + 3, 1, this.H - L.seat, gut[2]);
      }
      // D'autres toits bas.
      for (const rf of XT.lower) this.paintLowerRoof(r, glow, { x0: rf.x0, x1: rf.x1, top: L.seat + rf.top }, lower, R, true);
      if (this.extR > 30) this.paintLowerRoof(r, glow, { x0: W + 14, x1: r.x1 + 12, top: L.seat + 32 }, lower, R, true);
      // Une lanterne sur la façade.
      {
        const lx = XT.lantern;
        const ly = L.seat + 12;
        r.rect(lx, ly - 6, 1, 5, lower[0]);
        r.rect(lx, ly - 6, 4, 1, lower[0]);
        r.rect(lx - 2, ly - 1, 5, 1, lower[1]);
        r.rect(lx - 2, ly, 5, 5, lower[0]);
        r.rect(lx - 1, ly + 1, 3, 3, C(PAL.lit[1]));
        r.set(lx, ly + 2, C(PAL.lit[0]));
        for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) glow[r.i(lx - 1 + i, ly + 1 + j)] = 1;
        r.rect(lx - 2, ly + 5, 5, 1, lower[1]);
        this.lantern2 = { x: lx, y: ly + 2 };
        this.extLamps.push({ x: lx, y: ly + 2, r: 26, k: 0.75 });
      }

      // Sur notre toit.
      if (XT.hatch > r.x0 + 10) this.paintHatch(r, XT.hatch);
      this.paintDormer(r, glow, XT.dormer);
      XT.chimneys.forEach((cx, k) => cx > r.x0 + 10 && this.paintRoofChimney(r, cx, k === 0));
      if (XT.antenna > r.x0 + 10) this.paintAntenna(r, XT.antenna);
      const [la, lb] = XT.laundry;
      if (lb > r.x0 + 6) this.paintLaundryLine(r, lb, la);
      if (XT.coop > r.x0 + 14) this.paintCoop(r, XT.coop);
    }

    // Lucarne de notre toit : fronton de zinc, fenêtre allumée, pots de fleurs sur l'appui.
    paintDormer(r, glow, d) {
      const { L, look } = this;
      const g = this.grade;
      const rim = this.rim;
      const zinc = [g('#2a2442'), g('#4a4468'), g('#6a6488'), g('#8a84a6')];
      const wall = [g('#3a3054'), g('#4a3e64'), g('#5a4e74')];
      const y0 = L.ridge;
      const y1 = L.seat - 2;
      // Joues et façade.
      r.rect(d - 9, y0, 19, y1 - y0, wall[1]);
      r.rect(d - 9, y0, 1, y1 - y0, wall[0]);
      r.rect(d + 9, y0, 1, y1 - y0, mix(wall[2], rim, 0.3));
      // Fronton.
      for (let k = 0; k < 10; k++) {
        const hw = 11 - k;
        const y = y0 - 1 - k;
        for (let x = -hw; x <= hw; x++) {
          let c = Math.abs(x) >= hw - 1 ? (x > 0 ? mix(zinc[3], rim, 0.5) : mix(zinc[2], rim, 0.3)) : k < 2 ? zinc[0] : zinc[1];
          if (Math.abs(x) < hw - 2 && k >= 2 && k < 7 && Math.abs(x) < 3 && Math.abs(k - 4) < 2) c = zinc[2]; // œil-de-bœuf
          r.set(d + x, y, c);
        }
      }
      r.set(d, y0 - 11, mix(zinc[3], rim, 0.6));
      // La fenêtre allumée : rideaux, croisillons.
      const wx = d - 5;
      const wy = y0 + 2;
      const ww = 10;
      const wh = y1 - y0 - 6;
      const lit = PAL.lit.map(C);
      r.rect(wx - 1, wy - 1, ww + 2, wh + 2, g('#1a1230'));
      for (let j = 0; j < wh; j++) {
        for (let i = 0; i < ww; i++) {
          let c = j / wh < 0.3 ? lit[0] : j / wh < 0.75 ? lit[1] : lit[2];
          if ((i < 2 || i > ww - 3) && j < wh - 1) c = mix(c, C('#c86a7a'), 0.55);
          if (i === ww >> 1 || j === Math.floor(wh * 0.45)) c = g('#1a1230');
          r.set(wx + i, wy + j, c);
          glow[r.i(wx + i, wy + j)] = 1;
        }
      }
      // L'appui, un pot de géraniums et un petit cactus.
      const sy = wy + wh + 1;
      r.rect(d - 8, sy, 17, 2, mix(wall[2], rim, 0.25));
      const pot = PAL.pot.map(g);
      r.rect(d - 6, sy - 3, 5, 3, pot[2]);
      r.rect(d - 6, sy - 3, 5, 1, mix(pot[2], rim, 0.3));
      const leaf = [C('#2e5a34'), C('#3e7a40')];
      const fl = look.litter === 'leaves' ? C('#f08a3a') : C('#e84a5a');
      for (const [x, y, c] of [[-7, -4, 0], [-6, -5, 1], [-5, -4, 0], [-4, -5, 1], [-3, -4, 0], [-2, -5, 0], [-6, -6, 2], [-4, -7, 2], [-3, -6, 2], [-5, -6, 1]]) r.set(d + x, sy + y, c === 2 ? fl : leaf[c]);
      r.rect(d + 2, sy - 2, 3, 2, pot[1]);
      r.rect(d + 3, sy - 5, 1, 3, C('#4a8a5a'));
      r.set(d + 2, sy - 4, C('#4a8a5a'));
      r.set(d + 3, sy - 6, C('#f4a0b8'));
      // Solin de zinc au pied.
      r.rect(d - 10, y1, 21, 1, zinc[2]);
      this.extLamps.push({ x: d, y: wy + 6, r: 24, k: 0.6 });
      this.windows.push({ x: wx, y: wy, w: ww, h: wh, lit: true, layer: 'fore', fixed: true });
    }

    // Souche de cheminée posée sur notre faîtage (avec, peut-être, une antenne râteau).
    paintRoofChimney(r, cx, antenna) {
      const { L } = this;
      const g = this.grade;
      const rim = this.rim;
      const brick = PAL.brick.map(g);
      const cw = 12;
      const top = L.ridge - 22;
      for (let y = top; y < L.ridge + 5; y++) {
        for (let x = cx; x < cx + cw; x++) {
          const row = Math.floor((y - top) / 2);
          const joint = (y - top) % 2 === 1 || pmod(x - cx + (row % 2) * 2, 4) === 0;
          let c = joint ? brick[0] : hash(x >> 2, row, 3) > 0.6 ? brick[2] : brick[1];
          if (x >= cx + cw - 2) c = mix(c, rim, x === cx + cw - 1 ? 0.45 : 0.2);
          if (x <= cx + 1) c = mix(c, brick[0], 0.5);
          r.set(x, y, c);
        }
      }
      const capC = g('#4e4466');
      r.rect(cx - 2, top - 3, cw + 4, 3, capC);
      r.rect(cx - 2, top - 3, cw + 4, 1, mix(capC, rim, 0.55));
      const pot = PAL.pot.map(g);
      for (let k = 0; k < 2; k++) {
        const px = cx + 2 + k * 5;
        const ph = 4 + k * 2;
        r.rect(px, top - 3 - ph, 3, ph, pot[1]);
        r.rect(px - 1, top - 4 - ph, 5, 1, pot[2]);
        r.rect(px, top - 3 - ph, 1, ph, pot[0]);
        this.pots2.push({ x: px + 1, y: top - 5 - ph });
      }
      if (antenna) {
        const ax = cx + cw - 2;
        const mast = g('#1e1830');
        r.rect(ax, top - 26, 1, 23, mast);
        r.rect(ax - 1, top - 6, 3, 1, mast);
        for (const [ay, hw] of [[top - 25, 7], [top - 17, 5]]) {
          r.rect(ax - hw, ay, hw * 2 + 1, 1, mast);
          for (let x = ax - hw; x <= ax + hw; x += 2) r.rect(x, ay - 2, 1, 5, mast);
          r.set(ax + hw, ay, mix(mast, this.rim, 0.5));
        }
      }
    }

    // Antenne râteau et petite parabole, plantées sur le faîtage.
    paintAntenna(r, ax) {
      const { L } = this;
      const g = this.grade;
      const mast = g('#1e1830');
      r.rect(ax, L.ridge - 34, 1, 36, mast);
      r.rect(ax - 2, L.ridge + 1, 5, 2, mast);
      for (const [ay, hw] of [[L.ridge - 33, 8], [L.ridge - 24, 6], [L.ridge - 17, 4]]) {
        r.rect(ax - hw, ay, hw * 2 + 1, 1, mast);
        for (let x = ax - hw + 1; x <= ax + hw; x += 2) r.rect(x, ay - 2, 1, 5, mast);
        r.set(ax - hw, ay, mix(mast, this.rim, 0.5));
      }
      // Parabole.
      const dy = L.ridge - 8;
      const dish = g('#b8b0cc');
      for (let y = -4; y <= 4; y++) {
        const hw = Math.round(Math.sqrt(16 - y * y) * 0.6);
        r.rect(ax + 3, dy + y, hw + 1, 1, y < 0 ? mix(dish, this.rim, 0.3) : dish);
      }
      r.rect(ax + 1, dy, 2, 1, mast);
      r.set(ax + 7, dy - 1, mast);
    }

    // Deux potences et un fil à linge (le linge flotte au vent : voir drawLaundry).
    paintLaundryLine(r, xa, xb) {
      const { L, look } = this;
      const g = this.grade;
      const pole = g('#2a2238');
      const ty = L.ridge - 24;
      for (const [px, base] of [[xa, L.ridge + 14], [xb, L.ridge + 10]]) {
        r.rect(px, ty, 1, base - ty, pole);
        r.rect(px - 3, ty, 7, 1, pole);
        r.set(px + 1, ty, mix(pole, this.rim, 0.5));
        r.rect(px - 1, base - 1, 3, 1, pole);
      }
      const line = g('#cfc4dc');
      const n = xb - xa;
      for (let k = 0; k <= n; k++) {
        const u = k / n;
        r.set(xa + k, Math.round(ty + 1 + 5 * 4 * u * (1 - u)), line);
      }
      // Le linge (dessiné à chaque image, il bouge au vent).
      const R = rng(57);
      const kinds = ['shirt', 'sock', 'sock', 'towel', 'dress', 'sheet', 'shirt', 'sock'];
      const cols = ['#e8e0f0', '#d86a7a', '#6a9ad8', '#f0d070', '#a8d0a0', '#f4f0f8', '#c8a0e0', '#e88a5a'];
      let x = xa + 4;
      let i = 0;
      while (x < xb - 6) {
        const kind = kinds[i % kinds.length];
        const w = kind === 'sock' ? 3 : kind === 'shirt' ? 9 : kind === 'towel' ? 8 : kind === 'dress' ? 8 : 12;
        if (x + w > xb - 3) break;
        const u = (x + w / 2 - xa) / n;
        this.laundry.push({ x, y: Math.round(ty + 1 + 5 * 4 * u * (1 - u)) + 1, w, kind, c: look.wet ? mix(C(cols[i % cols.length]), [60, 60, 90], 0.3) : C(cols[(i + 3) % cols.length]), p: R() * 6 });
        x += w + 2 + Math.floor(R() * 3);
        i++;
      }
    }

    // Le pigeonnier : une cabane de planches sur le faîtage, ses trous d'envol, sa planche.
    paintCoop(r, c) {
      const { L } = this;
      const g = this.grade;
      const rim = this.rim;
      const wood = PAL.wood.map(g);
      const plank = [g('#4a3848'), g('#5e4858'), g('#76606c')];
      const y0 = L.ridge - 12;
      const y1 = L.ridge + 5;
      for (let y = y0; y < y1; y++) for (let x = c - 12; x < c + 12; x++) r.set(x, y, pmod(x - c, 4) === 0 ? plank[0] : x > c + 8 ? mix(plank[2], rim, 0.2) : plank[1]);
      // Toit à deux pentes.
      for (let k = 0; k < 7; k++) {
        const hw = 14 - k * 2;
        r.rect(c - hw, y0 - 1 - k, hw * 2, 1, k === 6 ? mix(wood[3], rim, 0.5) : wood[k < 2 ? 1 : 2]);
        r.set(c + hw - 1, y0 - 1 - k, mix(wood[3], rim, 0.5));
      }
      // Trous d'envol et planche.
      for (const hx of [c - 8, c - 1, c + 6]) {
        r.rect(hx, y0 + 4, 3, 4, g('#120c1a'));
        r.set(hx + 1, y0 + 3, g('#120c1a'));
      }
      r.rect(c - 13, y0 + 8, 26, 1, mix(wood[3], rim, 0.4));
      r.rect(c - 13, y0 + 9, 26, 1, wood[0]);
      // Les pigeons (ils bougent la tête : voir drawCoop).
      for (const [px, py] of [[c - 10, y0 + 8], [c + 3, y0 + 8], [c - 4, y0 - 7], [c + 5, y0 - 6]]) this.coopBirds.push({ x: px, y: py, p: (px * 0.37) % 6 });
    }

    // Châssis de toit éteint, qui reflète le ciel.
    paintHatch(r, hx) {
      const { L } = this;
      const g = this.grade;
      const y = L.ridge + 9;
      r.rect(hx - 1, y - 1, 13, 10, g('#2a2440'));
      r.rect(hx - 1, y - 1, 13, 1, mix(g('#6a6088'), this.rim, 0.4));
      for (let j = 0; j < 8; j++) for (let i = 0; i < 11; i++) r.set(hx + i, y + j, j < 3 ? mix(g(PAL.glass[2]), this.rim, 0.35) : g(PAL.glass[1]));
      r.rect(hx + 5, y, 1, 8, g('#2a2440'));
    }

    // Fenêtre haute à la parisienne : volets ouverts, rideaux, petit garde-corps en fer.
    paintWindow(r, glow, x, y, w, h, on, lamps = this.lamps) {
      const g = this.grade;
      const { W } = this;
      const frame = g('#1a1230');
      const shutter = [g('#2a2246'), g('#362c58')];
      for (let j = 0; j <= h; j++) {
        for (const sx of [x - 5, x + w + 1]) {
          for (let i = 0; i < 4; i++) r.set(sx + i, y + j, j % 2 ? shutter[0] : i === 0 || i === 3 ? shutter[0] : shutter[1]);
        }
      }
      r.rect(x - 1, y - 3, w + 2, 2, mix(g('#3e3258'), this.rim, 0.12)); // linteau
      r.rect(x - 1, y - 1, w + 2, h + 2, frame);
      const lit = PAL.lit.map(C);
      const glass = PAL.glass.map(g);
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          let c;
          if (on) {
            const q = j / h;
            c = q < 0.3 ? lit[0] : q < 0.75 ? lit[1] : lit[2];
            if ((i < 3 || i > w - 4) && j < h - 1) c = mix(c, lit[3], 0.5); // rideaux
            if (x + i >= r.x0 && x + i < r.x1) glow[r.i(x + i, y + j)] = 1;
          } else {
            c = j < h * 0.3 ? mix(glass[2], this.rim, 0.22) : glass[j % 5 === 0 ? 0 : 1];
          }
          if (i === Math.floor(w / 2) || j === Math.floor(h * 0.4)) c = frame;
          r.set(x + i, y + j, c);
        }
      }
      // Garde-corps : deux lisses et des barreaux.
      const by = y + h - 6;
      for (let i = -1; i <= w; i++) {
        r.set(x + i, by, frame);
        r.set(x + i, by + 5, frame);
        if ((i + 1) % 2 === 0) for (let j = 1; j < 5; j++) r.set(x + i, by + j, frame);
        if (x + i >= r.x0 && x + i < r.x1) for (let j = 0; j < 6; j++) glow[r.i(x + i, by + j)] = 0;
      }
      r.rect(x - 2, y + h + 1, w + 4, 1, mix(g('#4a3e62'), this.rim, 0.15));
      r.rect(x - 2, y + h + 2, w + 4, 1, g('#1a1228'));
      this.windows.push({ x, y, w, h, lit: on, layer: 'fore' });
      if (on) lamps.push({ x: x + w / 2, y: y + h / 2, r: 20, k: 0.55 });
    }

    // Un toit plus bas, vu d'en haut : faîtage éclairé, ardoises sombres, lucarnes, cheminée.
    // ext : toit du prolongement (ses lucarnes ne touchent pas l'écran ; ses lampes à part).
    paintLowerRoof(r, glow, rf, tones, R, ext = false) {
      const { H, W } = this;
      const slope = 7;
      for (let y = rf.top; y < H; y++) {
        const ry = y - rf.top;
        const k = clamp01(ry / slope);
        const xa = Math.round(rf.x0 + slope * (1 - k));
        const xb = Math.round(rf.x1 - slope * (1 - k));
        const tr = Math.floor((ry - 2) / 4);
        for (let x = xa; x < xb; x++) {
          let c = tones[2];
          if (ry < 2) c = ry === 0 ? mix(tones[4], this.rim, 0.45) : tones[3];
          else if ((ry - 2) % 4 === 0) c = tones[1];
          else if ((x + (tr % 2) * 3) % 6 === 0) c = mix(tones[2], tones[1], 0.6);
          if (k < 1 && ry >= 2 && (x === xa || x === xb - 1)) c = mix(tones[4], this.rim, 0.25); // arêtiers
          c = mix(c, tones[0], clamp01((ry - 8) / 40) * 0.55);
          r.set(x, y, c);
        }
      }
      // Lucarnes, dont une allumée au moins.
      const n = Math.max(1, Math.round((rf.x1 - rf.x0) / 90));
      for (let d = 0; d < n; d++) {
        const lx = Math.round(rf.x0 + ((d + 0.5) / n) * (rf.x1 - rf.x0) + (R() - 0.5) * 16);
        if (ext ? lx > -8 && lx < W + 8 : lx < 4 || lx > W - 4) continue;
        const ly = rf.top + 7;
        r.rect(lx - 6, ly, 13, 13, tones[1]);
        r.rect(lx - 6, ly, 1, 13, mix(tones[3], this.rim, 0.2));
        for (let j = 0; j < 5; j++) r.rect(lx - 7 + j, ly - 1 - j, 15 - j * 2, 1, j === 4 ? mix(tones[4], this.rim, 0.45) : j === 0 ? tones[0] : tones[3]);
        const on = d === 0 || R() < 0.5;
        for (let j = 0; j < 8; j++) {
          for (let i = 0; i < 7; i++) {
            r.set(lx - 3 + i, ly + 3 + j, i === 3 || j === 3 ? tones[0] : on ? C(j < 2 ? PAL.lit[0] : PAL.lit[1]) : this.grade(PAL.glass[1]));
            if (on && lx - 3 + i >= r.x0 && lx - 3 + i < r.x1 && ly + 3 + j < H) glow[r.i(lx - 3 + i, ly + 3 + j)] = 1;
          }
        }
        if (on) (ext ? this.extLamps : this.lamps).push({ x: lx, y: ly + 7, r: 18, k: 0.5 });
      }
      // Cheminée et ses pots.
      const cx = Math.round(rf.x0 + (rf.x1 - rf.x0) * (rf.x0 < 0 ? 0.3 : 0.62));
      r.rect(cx, rf.top - 9, 6, 10, tones[2]);
      r.rect(cx - 1, rf.top - 10, 8, 1, mix(tones[4], this.rim, 0.45));
      r.rect(cx, rf.top - 9, 1, 10, tones[0]);
      r.rect(cx + 1, rf.top - 13, 2, 3, this.grade(PAL.pot[1]));
      r.rect(cx + 4, rf.top - 12, 2, 2, this.grade(PAL.pot[1]));
      this.pots.push({ x: cx + 2, y: rf.top - 14, small: true });
    }

    // Neige posée sur tout ce qui regarde vers le haut.
    snowCaps(r, y0, y1, glow) {
      const { W } = this;
      const S1 = C('#eceef8');
      const S2 = C('#c4c6dc');
      for (let y = Math.max(1, y0); y < y1; y++) {
        for (let x = r.x0; x < r.x1; x++) {
          if (r.alpha(x, y) !== 255 || r.alpha(x, y - 1) !== 0) continue;
          if (glow && glow[r.i(x, y)]) continue;
          r.set(x, y, S1);
          if (hash(x, y, 5) > 0.4) r.set(x, y - 1, S1);
          if (hash(x, y, 7) > 0.5) r.set(x, y + 1, S2);
        }
      }
      // Les ardoises : un liseré de neige sur le rebord de chaque rang, par plaques.
      const { L } = this;
      for (const tr of this.tileRows || []) {
        for (let x = r.x0; x < r.x1; x++) {
          if (glow && glow[r.i(x, tr.y)]) continue;
          const n = fbm(x * 0.06, tr.y * 0.4, 17);
          if (n > 0.38) r.set(x, tr.y, S1);
          if (n > 0.5 && tr.y > 0) r.set(x, tr.y - 1, bayer(x, tr.y) < (n - 0.5) * 4 ? S1 : S2);
          if (n > 0.62) r.set(x, tr.y + 1, S2);
        }
      }
      for (let x = r.x0; x < r.x1; x++) {
        r.set(x, L.seat, S1);
        if (hash(x, 1, 3) > 0.3) r.set(x, L.seat - 1, S1);
        r.set(x, L.ridge - 1, S1);
        r.set(x, L.ridge - 2, hash(x, 2, 3) > 0.5 ? S1 : S2);
        if (x >= this.rail.x0 && x <= this.rail.x1) r.set(x, L.railTop - 1, S1);
      }
    }

    // Toit mouillé : reflets du ciel sur les ardoises et flaques dans la gouttière.
    wetShine(r) {
      const { W, L } = this;
      const sheen = mix(C(this.look.sky[8]), this.rim, 0.45);
      // Le bord de chaque rang d'ardoises brille, par endroits, du reflet du ciel.
      for (const tr of this.tileRows || []) {
        const ly = tr.y + tr.h - 1;
        for (let x = r.x0; x < r.x1; x++) {
          const n = noise(x * 0.08, tr.y * 0.7, 31);
          if (n > 0.5) r.tint(x, ly, sheen, Math.min(0.6, (n - 0.5) * 1.6));
          if (n > 0.7 && tr.h > 3) r.tint(x, ly - 1, sheen, 0.2);
        }
      }
      for (let x = r.x0; x < r.x1; x++) if (hash(x, 4, 4) > 0.45) r.set(x, L.seat + 1, mix(sheen, [255, 255, 255], 0.2));
    }

    paintLitter(r, R) {
      const { W, L, look } = this;
      const cols = look.litter === 'petals' ? ['#f6a8c4', '#e6849f', '#ffc8da'] : ['#d8702a', '#b8442a', '#e8a038', '#8a3a22'];
      for (let k = 0; k < W * 0.22; k++) {
        const x = Math.floor(R() * W);
        const y = L.ridge + 3 + Math.floor(Math.pow(R(), 0.6) * (L.seat - L.ridge - 3));
        const c = C(cols[Math.floor(R() * cols.length)]);
        r.set(x, y, c);
        if (look.litter === 'leaves' && R() < 0.5) r.set(x + 1, y, c);
      }
      // Le prolongement a sa propre litière (autre graine).
      if (this.wide) {
        const RL = rng(359);
        r.only(() => {
          for (let k = 0; k < (this.extL + this.extR) * 0.22; k++) {
            const u = Math.floor(RL() * (this.extL + this.extR));
            const x = u < this.extL ? -1 - u : W + u - this.extL;
            const y = L.ridge + 3 + Math.floor(Math.pow(RL(), 0.6) * (L.seat - L.ridge - 3));
            const c = C(cols[Math.floor(RL() * cols.length)]);
            r.set(x, y, c);
            if (look.litter === 'leaves' && RL() < 0.5) r.set(x + 1, y, c);
          }
        });
      }
    }

    paintHalo() {
      const { W, H, L, look } = this;
      const glow = C(look.glow);
      const halos = [{ x: L.sunX, y: L.hz + 2, r: Math.round(W * 0.26), c: glow, k: 0.11 * (look.glowK / 0.5) }];
      for (const l of this.lamps) halos.push({ x: l.x, y: l.y, r: l.small ? 6 : Math.round(l.r * 0.7), c: [255, 180, 100], k: l.small ? 0.3 : 0.32 });
      if (this.moon) halos.push({ x: this.moon.x, y: this.moon.y, r: 20, c: [160, 160, 230], k: 0.16 });
      for (const b of this.bulbs) if (!b.mid) halos.push({ x: b.x, y: b.y, r: 4, c: C(b.c), k: 0.35 });
      const extra = this.extLamps.map((l) => ({ x: l.x, y: l.y, r: l.small ? 6 : Math.round(l.r * 0.7), c: [255, 180, 100], k: l.small ? 0.3 : 0.32 }));
      return makeHalo(W, H, this.extL, this.extR, halos, extra.concat(this.extHalos));
    }

    /* ---------- Le chat ---------- */
    makeCat() {
      const look = this.look;
      const pal = { k: css(mul(C('#1c1428'), look.amb)), r: css(mix(mul(C('#3a2c4c'), look.amb), this.rim, 0.5)), e: '#ffd27a' };
      const toHex = (s) => {
        const m = s.match(/\d+/g).map(Number);
        return `#${m.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      };
      const P = { k: toHex(pal.k), r: toHex(pal.r), e: pal.e };
      const WALK = [
        ['r.......r.r', '.k......kkk', '.k.rrrrrkek', '..kkkkkkkk.', '..kkkkkkk..', '..k.k..k.k.'],
        ['r.......r.r', '.k......kkk', '.k.rrrrrkek', '..kkkkkkkk.', '..kkkkkkk..', '...kk..kk..'],
        ['.r......r.r', '.k......kkk', '.k.rrrrrkek', '..kkkkkkkk.', '..kkkkkkk..', '..k..k.k..k'],
        ['.r......r.r', '.k......kkk', '.k.rrrrrkek', '..kkkkkkkk.', '..kkkkkkk..', '...kk..kk..'],
      ];
      const SIT = [
        ['....r.r', '....kkk', '....kek', '...rkkk', '..rkkkk', 'k.kkkkk', '.kkkkkk'],
        ['....r.r', '....kkk', '....kek', '...rkkk', '..rkkkk', '..kkkkk', 'kkkkkkk'],
      ];
      const mk = (rows, flip) => B.PX.sprite(rows, P, flip);
      return {
        walkR: WALK.map((f) => mk(f, false)),
        walkL: WALK.map((f) => mk(f, true)),
        sitR: SIT.map((f) => mk(f, false)),
        sitL: SIT.map((f) => mk(f, true)),
      };
    }

    newFly() {
      const { W, L } = this;
      const x0 = -this.extL;
      const w = W + this.extL + this.extR;
      return { x: x0 + Math.random() * w, y: L.ridge - 20 + Math.random() * 60, p: Math.random() * 6, s: 0.5 + Math.random(), hx: x0 + Math.random() * w, hy: L.ridge - 10 + Math.random() * 50 };
    }

    /* ================= Vie de la scène ================= */
    update(dt, ctx) {
      const eff = (ctx && ctx.effect) || 'none';
      if (eff !== this.effect) this.build(eff);
      const { L, W, look } = this;
      this.t += dt;
      const t = this.t;
      const fast = this.fast ? 4 : 1;

      for (const c of this.drift) {
        c.x += c.v * dt * fast;
        if (c.x > W + 4 + this.extR) c.x = -c.w - 4 - this.extL;
      }
      if (look.birds) this.flock.update(dt);
      this.updateCat(dt);
      this.updateCouple(dt);

      // Cœurs qui montent.
      this.nextHeart -= dt * look.hearts;
      if (this.nextHeart <= 0) {
        const lean = this.pose.lean > 0.5 || this.pose.hold;
        this.hearts.push({ x: L.cx + (Math.random() - 0.5) * 18, y: L.seat - 34 - (look.umbrella ? 14 : 0), age: 0, life: 4.5 + Math.random() * 2.5, ph: Math.random() * 6, size: Math.random() < 0.18 ? 2 : Math.random() < 0.6 ? 1 : 0 });
        this.nextHeart = (lean ? 1.2 : 2.6) + Math.random() * (lean ? 1.5 : 3.5);
        if (this.fast) this.nextHeart *= 0.25;
      }
      for (const h of this.hearts) {
        h.age += dt;
        h.y -= dt * (5 + h.size * 0.8);
        h.x += Math.sin(h.age * 1.6 + h.ph) * dt * 4;
      }
      this.hearts = this.hearts.filter((h) => h.age < h.life);

      // Fumée des cheminées, buée des souffles.
      if (look.smoke || look.snow) {
        for (const p of this.pots) if (Math.random() < dt * (p.small ? 1.2 : 2.2)) this.smoke.emit(p.x + (Math.random() - 0.5) * 2, p.y, 3 + Math.random() * 2, 5);
      }
      this.smoke.update(dt);
      if (this.wide) {
        if (look.smoke || look.snow) for (const p of this.pots2) if (Math.random() < dt * 2) this.smoke2.emit(p.x + (Math.random() - 0.5) * 2, p.y, 3 + Math.random() * 2, 5);
        this.smoke2.update(dt);
      }
      if (look.breath) {
        const P = this.pose;
        if (Math.random() < dt * 0.7) this.breath.emit(L.cx - 7 + P.gx, L.seat - 18 + P.gy, 1.4, 4);
        if (Math.random() < dt * 0.7) this.breath.emit(L.cx + 2 + P.yx, L.seat - 18 + P.yy, 1.4, 4);
      }
      this.breath.update(dt);

      // Gouttes qui tombent du parapluie.
      if (look.umbrella) {
        if (Math.random() < dt * (look.storm ? 9 : 5)) {
          const tips = [-19, -13, -6, 1, 7, 13, 19];
          const tx = tips[Math.floor(Math.random() * tips.length)];
          this.drips.push({ x: L.cx - 23 + YX + 2 + tx, y: L.seat - SEAT + TOP - 6, v: 20 });
        }
        for (const d of this.drips) {
          d.v += 160 * dt;
          d.y += d.v * dt;
        }
        this.drips = this.drips.filter((d) => d.y < L.seat + 30);
      }

      // Fenêtres qui s'allument et s'éteignent.
      this.nextToggle -= dt * fast;
      if (this.nextToggle <= 0) {
        const pool = this.windows.filter((w) => !w.fixed && !(w.layer === 'fore' && Math.abs(w.x - (L.cx - 6)) < 2));
        if (pool.length) {
          const w = pool[Math.floor(Math.random() * pool.length)];
          w.lit = !w.lit;
          w.changed = true;
        }
        for (const s of this.skyWins) if (Math.random() < 0.08) s.lit = !s.lit;
        this.nextToggle = 4 + Math.random() * 9;
      }

      // Étoiles filantes.
      if (look.meteors) {
        this.nextMeteor -= dt;
        if (this.nextMeteor <= 0) {
          this.meteors.push({ x: this.wide ? -this.extL + Math.random() * (this.extL + W * 0.9) : Math.random() * W * 0.8 + W * 0.1, y: Math.random() * L.hz * 0.35, age: 0, life: 0.9, dx: (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 20), dy: 18 + Math.random() * 10 });
          this.nextMeteor = 2 + Math.random() * 5;
        }
        for (const m of this.meteors) m.age += dt;
        this.meteors = this.meteors.filter((m) => m.age < m.life);
      }
      // Lucioles.
      for (const f of this.flies) {
        f.x = f.hx + Math.sin(t * 0.35 * f.s + f.p) * 18;
        f.y = f.hy + Math.sin(t * 0.5 * f.s + f.p * 2) * 6;
      }
      // Orage.
      if (this.flash > 0) this.flash -= dt;
      if (look.storm) {
        this.nextBolt -= dt;
        if (this.nextBolt <= 0) {
          this.flash = 0.55;
          const pts = [];
          let x = this.wide ? -this.extL * 0.6 + Math.random() * (this.extL * 0.6 + W * 0.85) : W * (0.15 + Math.random() * 0.7);
          for (let y = 0; y < L.hz - 10; y += 3 + Math.floor(Math.random() * 4)) {
            pts.push([Math.round(x), y]);
            x += (Math.random() - 0.5) * 8;
          }
          this.bolt = pts;
          this.nextBolt = 6 + Math.random() * 12;
        }
      }
    }

    // Les petits gestes du couple.
    updateCouple(dt) {
      const P = this.pose;
      const umb = !!this.look.umbrella;
      // Tête qui se pose sur l'épaule de l'autre, puis se relève.
      P.leanTimer -= dt;
      if (P.leanTimer <= 0) {
        if (P.lean) {
          P.lean = 0;
          P.leanTimer = this.fast ? 2 : 14 + Math.random() * 16;
        } else {
          P.lean = 1;
          P.leaner = Math.random() < 0.65 ? 'g' : 'y';
          P.leanTimer = this.fast ? 3 : 8 + Math.random() * 10;
        }
      }
      // Les mains qui se trouvent.
      P.holdTimer -= dt;
      if (P.holdTimer <= 0 && !umb) {
        P.hold = !P.hold;
        P.holdTimer = this.fast ? 3 : P.hold ? 10 + Math.random() * 12 : 12 + Math.random() * 18;
      }
      // Clignements d'yeux.
      P.blinkG -= dt;
      P.blinkY -= dt;
      if (P.blinkG <= 0) {
        P.gBlink = 0.14;
        P.blinkG = 2.5 + Math.random() * 4;
      }
      if (P.blinkY <= 0) {
        P.yBlink = 0.14;
        P.blinkY = 2.5 + Math.random() * 4;
      }
      P.gBlink -= dt;
      P.yBlink -= dt;
    }

    coupleState() {
      const P = this.pose;
      const t = this.t;
      const wind = this.look.storm ? 2 : 1;
      const breathG = Math.sin(t * 1.5) > 0.3 ? -1 : 0;
      const breathY = Math.sin(t * 1.3 + 2) > 0.3 ? -1 : 0;
      const gl = P.lean && P.leaner === 'g';
      const yl = P.lean && P.leaner === 'y';
      const gHead = [gl ? 2 : 0, (gl ? 2 : 0) + breathG];
      const yHead = [yl ? -2 : 0, (yl ? 2 : 0) + breathY];
      P.gx = gHead[0];
      P.gy = gHead[1];
      P.yx = yHead[0];
      P.yy = yHead[1];
      const sway = (ph) => {
        const v = Math.sin(t * 0.9 * wind + ph) + Math.sin(t * 2.3 * wind + ph * 2) * 0.4;
        return v > 0.8 ? 1 : v < -0.9 ? -1 : 0;
      };
      // Jambes : chacune se balance doucement à son rythme.
      const legs = [0, 1, 2, 3].map((k) => (Math.sin(t * (1.1 + k * 0.13) + P.legs[k] * 2) > 0.55 ? 'up' : 'down'));
      return {
        gHead, yHead,
        gSway: sway(0), ySway: sway(1.7),
        gEyes: gl || P.gBlink > 0, yEyes: (P.lean && P.leaner === 'g' && Math.sin(t * 0.3) > 0) || yl || P.yBlink > 0,
        hold: P.hold, legs,
      };
    }

    updateCat(dt) {
      const c = this.cat;
      const rd = this.catRidge;
      c.timer -= dt;
      c.frameT += dt;
      if (c.state === 'walk') {
        c.x += c.dir * 7 * dt * (this.fast ? 2 : 1);
        if ((c.dir < 0 && c.x <= c.target) || (c.dir > 0 && c.x >= c.target)) {
          c.state = 'sit';
          c.timer = 6 + Math.random() * 10;
        }
        return;
      }
      if (c.timer > 0) return;
      const span = rd.x1 - rd.x0;
      if (span < 8) return;
      let tg = rd.x0 + Math.random() * span;
      if (Math.abs(tg - c.x) < span * 0.3) tg = c.x > rd.x0 + span / 2 ? rd.x0 + 2 : rd.x1 - 2;
      c.target = tg;
      c.dir = tg > c.x ? 1 : -1;
      c.state = 'walk';
    }

    /* ================= Dessin d'une image ================= */
    draw(g) {
      const { W, H, L, look } = this;
      const t = this.t;
      g.imageSmoothingEnabled = false;
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;

      // 1. Ciel, nuages qui dérivent, ville lointaine.
      const wx0 = -this.extL;
      g.drawImage(this.back, wx0, 0);
      if (this.towerLights) this.drawTower(g, t);
      for (const s of this.twinkles) {
        const b = 0.5 + 0.5 * Math.sin(t * s.s + s.p);
        if (b < 0.6) continue;
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
      for (const s of this.skyWins) {
        if (s.lit) continue;
        g.fillStyle = s.off;
        g.fillRect(s.x, s.y, 1, 1);
      }
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
      if (look.birds) this.flock.draw(g);

      // 2. Toits voisins, cheminée, poteau ; le chat sur un faîtage ; la fumée.
      g.drawImage(this.mid, wx0, 0);
      this.drawWindows(g, 'mid');
      for (const b of this.bulbs) {
        if (!b.mid) continue;
        g.fillStyle = Math.sin(t * 1.7 + b.p) > -0.4 ? b.c : '#3a3046';
        g.fillRect(b.x, b.y, 1, 1);
      }
      for (const b of this.perched) {
        const v = Math.sin(t * 0.6 + b.p) + Math.sin(t * 1.7 + b.p * 2) * 0.5;
        g.drawImage(this.perchImgs[v > 1.1 ? 1 : v < -1.2 ? 2 : 0], b.x, b.y);
      }
      this.drawCat(g);
      this.smoke.draw(g, 0.3);

      // 3. Leur toit, la rambarde, la façade et les toits du bas.
      g.drawImage(this.fore, wx0, 0);
      this.drawWindows(g, 'fore');
      if (this.wide) this.drawExtFore(g, t);
      for (const b of this.bulbs) {
        if (b.mid) continue;
        const on = Math.sin(t * 1.7 + b.p) > -0.4;
        g.fillStyle = on ? b.c : '#3a3046';
        g.fillRect(b.x, b.y, 1, 1);
      }

      // 4. Le couple, puis leurs cœurs.
      const img = this.couple.render(this.coupleState());
      const ox = L.cx - 23;
      const oy = L.seat - SEAT;
      g.drawImage(img, ox, oy);
      this.breath.draw(g, 0.45);
      g.fillStyle = 'rgba(190,205,240,0.7)';
      for (const d of this.drips) g.fillRect(Math.round(d.x), Math.round(d.y), 1, 2);
      for (const h of this.hearts) {
        const a = Math.min(1, h.age / 0.8, (h.life - h.age) / 1.6);
        if (a <= 0) continue;
        g.globalAlpha = a * 0.92;
        g.drawImage(this.heartImgs[h.size], Math.round(h.x), Math.round(h.y));
      }
      g.globalAlpha = 1;

      // 5. Lumières ajoutées : halos, guirlande, lucioles.
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.88 + 0.05 * Math.sin(t * 1.3) + 0.04 * Math.sin(t * 7.7);
      g.drawImage(this.halo, wx0, 0);
      g.globalAlpha = 1;
      if (this.lantern) {
        const fl = 0.12 + 0.05 * Math.sin(t * 9) + 0.04 * Math.sin(t * 5.3);
        g.fillStyle = `rgba(255,170,90,${fl.toFixed(3)})`;
        g.fillRect(this.lantern.x - 3, this.lantern.y - 3, 7, 7);
        if (this.wide && this.lantern2) g.fillRect(this.lantern2.x - 3, this.lantern2.y - 3, 7, 7);
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
        const a = f > 0.44 ? 0.36 : f > 0.36 ? 0.05 : f > 0.12 ? 0.22 * ((f - 0.12) / 0.24) : 0;
        if (a > 0) {
          g.fillStyle = `rgba(205,215,255,${a.toFixed(3)})`;
          g.fillRect(-this.extL, 0, W + this.extL + this.extR, H);
        }
      }
    }

    /* ---------- Vie du prolongement ---------- */
    // La tour Eiffel scintille, et son phare tourne.
    drawTower(g, t) {
      const sparkle = Math.sin(t * 0.4) > -0.2;
      for (const l of this.towerLights) {
        const v = Math.sin(t * 9 + l.p * 7) + Math.sin(t * 5.3 + l.p * 3);
        if (sparkle && v > 1.2) {
          g.fillStyle = 'rgba(255,248,220,0.95)';
          g.fillRect(l.x, l.y, 1, 1);
        } else if (v > 0.2) {
          g.fillStyle = 'rgba(255,200,120,0.55)';
          g.fillRect(l.x, l.y, 1, 1);
        }
      }
      const b = this.towerBeacon;
      g.fillStyle = Math.sin(t * 2.2) > 0 ? '#fff0c0' : '#c89a5a';
      g.fillRect(b.x, b.y, 1, 1);
    }

    drawExtFore(g, t) {
      const look = this.look;
      // Le linge sur le fil : il se balance au vent.
      const wind = look.storm ? 2.2 : look.wet ? 1.2 : 1;
      for (const it of this.laundry) {
        const sw = Math.sin(t * 1.4 * wind + it.p) * wind;
        const c = it.c;
        const dk = css(mul(c, [0.72, 0.7, 0.8]));
        const lt = css(c);
        const x = it.x;
        const y = it.y;
        const lean = (j, h) => Math.round((sw * j) / h);
        const rows = (h, wf) => {
          for (let j = 0; j < h; j++) {
            const w = wf(j);
            const dx = lean(j, h);
            g.fillStyle = lt;
            g.fillRect(x + dx + Math.floor((it.w - w) / 2), y + j, w, 1);
            g.fillStyle = dk;
            g.fillRect(x + dx + Math.floor((it.w - w) / 2) + w - 1, y + j, 1, 1);
          }
        };
        if (it.kind === 'sock') rows(6, (j) => (j < 4 ? 2 : 3));
        else if (it.kind === 'shirt') rows(9, (j) => (j < 3 ? it.w : 5));
        else if (it.kind === 'dress') rows(11, (j) => Math.min(it.w, 4 + Math.floor(j / 2)));
        else if (it.kind === 'towel') rows(8, () => it.w);
        else rows(12, () => it.w);
        g.fillStyle = '#2a2238';
        g.fillRect(x + 1, y - 1, 1, 1);
        g.fillRect(x + it.w - 2, y - 1, 1, 1);
      }
      // Les pigeons du pigeonnier.
      const P = this.coopImgs;
      for (const b of this.coopBirds) {
        const v = Math.sin(t * 0.7 + b.p) + Math.sin(t * 2.1 + b.p * 2) * 0.5;
        g.drawImage(P[v > 1.05 ? 1 : v < -1.15 ? 2 : 0], b.x, b.y - 3);
      }
      this.smoke2.draw(g, 0.3);
    }

    drawWindows(g, layer) {
      for (const w of this.windows) {
        if (w.layer !== layer || !w.changed) continue;
        // Une fenêtre qui a changé d'état depuis la peinture du décor.
        if (w.lit) {
          g.fillStyle = PAL.lit[1];
          g.fillRect(w.x, w.y, w.w, w.h);
          g.fillStyle = PAL.lit[0];
          g.fillRect(w.x, w.y, w.w, Math.max(1, Math.floor(w.h * 0.35)));
        } else {
          g.fillStyle = css(this.grade(PAL.glass[1]));
          g.fillRect(w.x, w.y, w.w, w.h);
        }
        if (layer === 'fore') {
          g.fillStyle = css(this.grade('#1c1430'));
          g.fillRect(w.x + Math.floor(w.w / 2), w.y, 1, w.h);
          g.fillRect(w.x, w.y + Math.floor(w.h * 0.45), w.w, 1);
        }
      }
    }

    drawCat(g) {
      const c = this.cat;
      const S = this.catImgs;
      const right = c.dir > 0;
      let img;
      if (c.state === 'walk') img = (right ? S.walkR : S.walkL)[Math.floor(c.frameT / 0.16) % 4];
      else img = (right ? S.sitR : S.sitL)[Math.sin(this.t * 1.1) > 0.6 ? 1 : 0];
      g.drawImage(img, Math.round(c.x), this.catRidge.y - img.height);
    }
  }

  B.PixelScenes.toits = Toits;
})();
