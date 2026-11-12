// Brume — animation d'ouverture : la caméra « multiplane ».
//
// L'idée vient des studios d'animation des années 1930 : le décor est peint sur plusieurs
// plaques de verre placées à des profondeurs différentes, et la caméra se déplace entre
// elles. Les plaques proches défilent plus vite que les lointaines (parallaxe) : on a une
// vraie impression de profondeur avec des dessins à plat.
//
// Ici, les plaques sont les vrais plans du fond d'écran (ciel et ville / plan moyen /
// premier plan), séparés pendant que la scène se dessine. Quand la scène sait peindre
// un monde plus large que l'écran (option « ext »), la caméra arrive de loin en longeant
// ce monde — la rue continue, la forêt continue — et les plans glissent à des vitesses
// différentes. À la fin, toutes les plaques sont alignées : l'image est exactement le
// fond d'écran, qui continue de vivre. Rien n'est remplacé, il n'y a aucun raccord.
//
// Projection : une plaque à la profondeur Z, vue par une caméra avancée de cz et décalée
// de T, est agrandie de s = Z / (Z − cz) et décalée de −T / (Z − cz). Avec |T| ≤ cz · W/2,
// les plaques couvrent toujours l'écran (aucun bord visible).
(function () {
  'use strict';
  const B = window.Brume;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

  /* ---------- Les plans de chaque scène ----------
   * layers : du plus loin au plus proche. « img » = la plaque commence quand la scène
   *          dessine cette image ; « call » = quand elle appelle cette méthode.
   * solo   : une méthode dessinée sur sa propre plaque, à une profondeur qui varie.
   * window : scène vue depuis l'intérieur (café, chambre). Le dehors n'est peint que
   *          derrière la vitre : on ne le découpe plus, on prolonge ses bords, et la
   *          caméra reste dans la partie peinte tant qu'elle est dehors. « window » est la
   *          profondeur de la vitre (en deçà, l'intérieur cache le reste).
   * fade   : distance sur laquelle une plaque s'efface quand la caméra la traverse.
   * path   : la promenade au fond de la scène, en images clés
   *          { t, cz, look: [x, y] (fraction de l'écran), Z (plan visé) }.
   *          Le recul est calculé ensuite : pour chaque plan à traverser, la caméra vise
   *          l'ouverture la plus proche (ciel, vitre, trouée entre deux arbres…), comme un
   *          vrai cadreur qui passe entre les décors au lieu de passer au travers. */
  const CITY = {
    // Façades lointaines assez proches pour qu'on voie défiler la rue (église, cinéma…).
    layers: [{ Z: 2.5 }, { call: 'crowd.draw', Z: 1.6 }],
    path: () => [
      { t: 0, cz: 2.3, look: [0.18, 0.42], Z: 5 },
      { t: 3, cz: 2.0, look: [0.82, 0.46], Z: 5 },
    ],
  };
  const SPECS = {
    cafe: {
      layers: [{ Z: 2.4 }, { img: 'inside', Z: 1.3 }],
      window: true,
      path: () => [
        { t: 0, cz: 1.75, look: [0.3, 0.3], Z: 2.4 },
        { t: 3, cz: 1.6, look: [0.9, 0.4], Z: 2.4 },
      ],
    },
    terrasse: {
      layers: [{ Z: 6 }, { img: 'mid', Z: 2.6 }, { img: 'fore', Z: 1.35 }],
      path: () => [
        { t: 0, cz: 3.1, look: [0.25, 0.3], Z: 6 },
        { t: 3, cz: 2.8, look: [0.72, 0.34], Z: 6 },
      ],
    },
    foret: {
      layers: [{ Z: 6 }, { img: 'ground', Z: 2.4 }, { img: 'front', Z: 1.3 }],
      path: () => [
        { t: 0, cz: 3.0, look: [0.28, 0.42], Z: 6 },
        { t: 3, cz: 2.65, look: [0.68, 0.48], Z: 6 },
      ],
    },
    mer: {
      layers: [{ Z: 6 }, { img: 'mid', Z: 2.6 }, { img: 'front', Z: 1.35 }],
      path: () => [
        { t: 0, cz: 3.0, look: [0.22, 0.38], Z: 6 },
        { t: 3, cz: 2.75, look: [0.74, 0.42], Z: 6 },
      ],
    },
    chambre: {
      // La vitre et ses montants appartiennent à l'intérieur.
      layers: [{ Z: 2.2 }, { img: 'outNear', Z: 1.95 }, { img: 'glass', Z: 1.25 }],
      window: true,
      path: () => [
        { t: 0, cz: 1.5, look: [0.35, 0.3], Z: 2.2 },
        { t: 3, cz: 1.4, look: [0.62, 0.38], Z: 2.2 },
      ],
    },
    // Drones : la caméra suit le drone d'inspection qui rentre du pont jusqu'au pad.
    drones: {
      // Ciel et montagnes / viaduc et vallée / la colline de la pilote.
      layers: [{ Z: 6 }, { img: 'mid', Z: 2.6 }, { img: 'fg', Z: 1.4 }],
      solo: { call: 'drawInspection', Z: (s) => lerp(2.8, 1.4, s.insp.depth) },
      from: 'right', // on arrive par la droite, côté pilote
      path: () => [
        { t: 0, cz: 2.0, look: [0.35, 0.4], Z: 2.6 },
        { t: 3, cz: 1.8, look: [0.6, 0.45], Z: 2.6 },
      ],
    },
  };
  for (const k of ['nuit', 'crepuscule', 'pluie', 'sakura', 'automne']) SPECS[k] = CITY;
  // « Sur les toits » : ciel, toits du milieu, notre toit (même découpage que la terrasse).
  SPECS.toits = {
    layers: [{ Z: 6 }, { img: 'mid', Z: 2.6 }, { img: 'fore', Z: 1.35 }],
    path: () => [
      { t: 0, cz: 3.1, look: [0.3, 0.25], Z: 6 },
      { t: 3, cz: 2.8, look: [0.65, 0.3], Z: 6 },
    ],
  };
  // « Lac d'Annecy » : ciel et montagnes / ville, rive et lac / grands arbres et port.
  // On arrive par la gauche, en longeant la vieille ville et le lac.
  SPECS.annecy = {
    layers: [{ Z: 6 }, { img: 'mid', Z: 2.8 }, { img: 'fore', Z: 1.35 }],
    from: 'left',
    path: () => [
      { t: 0, cz: 3.0, look: [0.3, 0.32], Z: 6 },
      { t: 3, cz: 2.7, look: [0.7, 0.36], Z: 6 },
    ],
  };

  /* ---------- Un contexte 2D qui range chaque dessin sur la bonne plaque ----------
   * Les changements d'état (couleur, transparence…) sont mémorisés et appliqués à la
   * plaque qui dessine ; les chemins, découpes et transformations vont à toutes. */
  const DRAW = new Set(['drawImage', 'fillRect', 'fill', 'stroke', 'fillText', 'strokeText', 'strokeRect', 'putImageData', 'clearRect']);

  // ox : décalage de l'origine (la scène dessine en coordonnées d'écran ; son monde
  // élargi commence à x = −ox).
  function layeredContext(plates, onImage, noClip, ox = 0) {
    let cur = 0;
    let shadow = {};
    const stack = [];
    const applied = new Map();
    const all = plates.flatMap((p) => [p.g, p.lg]);

    function target() {
      const p = plates[cur];
      // Les lumières additives d'une plaque transparente vont sur sa plaque « lumière ».
      const c = shadow.globalCompositeOperation === 'lighter' && !p.opaque ? p.lg : p.g;
      let a = applied.get(c);
      if (!a) applied.set(c, (a = {}));
      for (const k in shadow) {
        if (a[k] !== shadow[k]) {
          c[k] = shadow[k];
          a[k] = shadow[k];
        }
      }
      return c;
    }

    const ctl = {
      get layer() {
        return cur;
      },
      set layer(i) {
        cur = i;
      },
      begin() {
        for (const c of all) {
          c.reset();
          if (ox) c.translate(ox, 0);
        }
        shadow = {};
        stack.length = 0;
        applied.clear();
        cur = 0;
      },
    };

    return new Proxy(
      {},
      {
        get(_, k) {
          if (k === '__plates') return ctl;
          if (DRAW.has(k)) {
            return (...a) => {
              if (k === 'drawImage') onImage(a[0]);
              return target()[k](...a);
            };
          }
          if (k === 'save') {
            return () => {
              stack.push({ ...shadow });
              for (const c of all) c.save();
            };
          }
          if (k === 'restore') {
            return () => {
              shadow = stack.pop() || {};
              for (const c of all) c.restore();
              applied.clear();
            };
          }
          if (k === 'clip' && noClip) return () => {};
          if (k in shadow) return shadow[k];
          const c0 = plates[cur].g;
          const v = c0[k];
          if (typeof v === 'function') {
            return (...a) => {
              let r;
              for (const c of all) r = c[k](...a);
              return r;
            };
          }
          return v;
        },
        set(_, k, v) {
          shadow[k] = v;
          return true;
        },
      },
    );
  }

  function makePlate(W, H, Z, opaque) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const lc = document.createElement('canvas');
    lc.width = W;
    lc.height = H;
    return { c, g: c.getContext('2d'), lc, lg: lc.getContext('2d'), Z, opaque };
  }

  /* ---------- Courbe de caméra : Catmull-Rom entre les images clés ---------- */
  function catmull(p0, p1, p2, p3, u) {
    const u2 = u * u;
    const u3 = u2 * u;
    return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
  }

  class Multiplane {
    constructor(scene, key, effect, W, H, k, duration = 8) {
      this.scene = scene;
      this.effect = effect;
      this.W = W;
      this.H = H;
      this.k = k;
      this.duration = duration;
      this.t = 0;
      const spec = (this.spec = SPECS[key] || SPECS.cafe);
      // Monde élargi (si la scène le peint) : EL pixels à gauche de l'écran, ER à droite.
      this.EL = scene.extL || 0;
      this.ER = scene.extR || 0;
      this.travel = this.EL + this.ER > 0;
      const PW = (this.PW = W + this.EL + this.ER);
      this.plates = spec.layers.map((l, i) => Object.assign(makePlate(PW, H, l.Z, i === 0), { fade: l.fade || 0.12 }));
      this.coverZ = 0; // mesuré à la première image (voir analyse())
      if (spec.solo) this.soloPlate = this.plates[this.plates.push(makePlate(PW, H, 1, false)) - 1];
      this.ctx = layeredContext(this.plates, (img) => this.onImage(img), !!spec.window, this.EL);
      this.ctl = this.ctx.__plates;
      this.weather = this.buildWeather();
      this.fx = document.createElement('canvas');
      this.fx.width = W;
      this.fx.height = H;
      this.fxg = this.fx.getContext('2d');
      this.keys = null;
      // Drones : le drone d'inspection rentre se poser pendant l'animation.
      if (scene.introReturn) scene.introReturn(duration);
    }

    // À la première image, on regarde ce que chaque plaque peint vraiment.
    analyse() {
      const { PW, H } = this;
      const n = PW * H;
      this.alphas = this.plates.map((p) => {
        const d = p.g.getImageData(0, 0, PW, H).data;
        const a = new Uint8Array(n);
        for (let i = 0; i < n; i++) a[i] = d[i * 4 + 3] > 40 ? 1 : 0;
        return a;
      });
      const bb = this.paintedBox(this.alphas[0]); // en pixels de la toile élargie
      this.canvasBox = bb;
      this.bbox = { x0: bb.x0 - this.EL, y0: bb.y0, x1: bb.x1 - this.EL, y1: bb.y1 }; // en pixels de la scène
      // Profondeur à partir de laquelle les plans réunis couvrent tout l'écran.
      const union = new Uint8Array(n);
      this.coverZ = this.spec.layers[this.spec.layers.length - 1].Z;
      for (let i = 0; i < this.spec.layers.length; i++) {
        let cov = 0;
        const a = this.alphas[i];
        for (let j = 0; j < n; j++) {
          if (a[j]) union[j] = 1;
          cov += union[j];
        }
        if (cov >= n * 0.995) {
          this.coverZ = i === 0 ? 0 : this.plates[i].Z;
          break;
        }
      }
      if (!this.travel) this.keys = this.buildPath();
    }

    // La promenade, puis le recul à travers les ouvertures de chaque plan.
    buildPath() {
      const { W, H, duration: D } = this;
      const keys = this.spec.path(this.scene, W, H).map((p) => this.keyToCam(p));
      const te = keys[keys.length - 1].t;
      const cze = keys[keys.length - 1].cz;
      const crossings = this.spec.layers
        .map((l, i) => ({ i, Z: l.Z }))
        .filter((c) => c.i > 0 && c.Z < cze - 0.05)
        .sort((a, b) => b.Z - a.Z);
      let prev = te;
      for (const c of crossings) {
        const t = Math.max(prev + 0.7, te + (D - te) * ((cze - c.Z) / cze));
        prev = t;
        // Le point de cette plaque qui serait au centre de l'écran avec le cadrage actuel…
        const ref = keys[keys.length - 1];
        const [hx, hy] = this.opening(c.i, W / 2 + ref.tx / c.Z, H / 2 + ref.ty / c.Z);
        // … remplacé par l'ouverture la plus proche, que la caméra vise en traversant.
        keys.push({ t, cz: c.Z + 0.04, tx: (hx - W / 2) * c.Z, ty: (hy - H / 2) * c.Z });
      }
      keys.push({ t: D, cz: 0, tx: 0, ty: 0 });
      return keys;
    }

    // Point transparent le plus proche de (px, py) sur la plaque i, entouré d'un carré vide.
    opening(i, px, py) {
      const { W, H } = this;
      const a = this.alphas[i];
      const S = new Int32Array((W + 1) * (H + 1)); // image intégrale
      for (let y = 0; y < H; y++) {
        let row = 0;
        for (let x = 0; x < W; x++) {
          row += a[y * W + x];
          S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row;
        }
      }
      const r = Math.max(4, Math.round(Math.min(W, H) * 0.04));
      const filled = (x, y) => {
        const x0 = x - r;
        const y0 = y - r;
        const x1 = x + r + 1;
        const y1 = y + r + 1;
        return S[y1 * (W + 1) + x1] - S[y0 * (W + 1) + x1] - S[y1 * (W + 1) + x0] + S[y0 * (W + 1) + x0];
      };
      let best = [px, py];
      let bd = Infinity;
      for (let y = r; y < H - r - 1; y += 2) {
        for (let x = r; x < W - r - 1; x += 2) {
          const dd = (x - px) ** 2 + (y - py) ** 2;
          if (dd < bd && filled(x, y) === 0) {
            bd = dd;
            best = [x, y];
          }
        }
      }
      return best;
    }

    keyToCam(p) {
      const { W, H } = this;
      return { t: p.t, cz: p.cz, tx: (p.look[0] - 0.5) * W * p.Z, ty: (p.look[1] - 0.5) * H * p.Z };
    }

    // Les plaques changent quand la scène dessine certaines images.
    onImage(img) {
      const layers = this.spec.layers;
      for (let i = 1; i < layers.length; i++) if (layers[i].img && this.scene[layers[i].img] === img) this.ctl.layer = i;
    }

    // Les méthodes qui ouvrent une plaque (ou dessinent sur une plaque à part) sont
    // enveloppées sur l'instance de la scène.
    hookCalls() {
      const ctl = this.ctl;
      const wrap = (path, fn) => {
        const parts = path.split('.');
        const name = parts.pop();
        let obj = this.scene;
        for (const p of parts) obj = obj && obj[p];
        if (!obj || typeof obj[name] !== 'function' || obj[name].__plate) return;
        const orig = obj[name];
        const w = function (...a) {
          return fn(() => orig.apply(this, a));
        };
        w.__plate = true;
        obj[name] = w;
      };
      this.spec.layers.forEach((l, i) => {
        if (l.call) {
          wrap(l.call, (run) => {
            ctl.layer = i;
            return run();
          });
        }
      });
      if (this.spec.solo) {
        const idx = this.plates.indexOf(this.soloPlate);
        wrap(this.spec.solo.call, (run) => {
          const prev = ctl.layer;
          ctl.layer = idx;
          const r = run();
          ctl.layer = prev;
          return r;
        });
      }
    }

    buildWeather() {
      const { W, H } = this;
      const fx = this.effect;
      if (fx === 'rain' || fx === 'storm') return new B.PXC.RainFx({ x0: 0, x1: W, y0: 0, y1: H, groundY0: H * 0.6, count: 160 });
      const colors = { snow: ['#ffffff', '#dfe8f6'], sakura: ['#f6b8c8', '#fbd8e2'], leaves: ['#e07a2a', '#c4482a', '#f2b03a'] }[fx];
      if (colors) return new B.PXC.Drift({ x0: 0, x1: W, y0: 0, y1: H, count: fx === 'snow' ? 140 : 50, colors, size: fx === 'snow' ? 1 : 2, fall: [14, 30], sway: 10 });
      return null;
    }

    // Position de la caméra à l'instant t.
    camera(t) {
      const { W, H } = this;
      if (this.travel) return this.travelCam(t);
      let cam;
      {
        const K = this.keys;
        let i = 0;
        while (i < K.length - 2 && t > K[i + 1].t) i++;
        const a = K[Math.max(0, i - 1)];
        const b = K[i];
        const c = K[i + 1];
        const d = K[Math.min(K.length - 1, i + 2)];
        const u = clamp((t - b.t) / (c.t - b.t), 0, 1);
        // Dernier tronçon : on ralentit en douceur jusqu'à l'arrêt complet.
        const v = i === K.length - 2 ? smooth(u) : u;
        cam = {
          cz: Math.max(0, catmull(a.cz, b.cz, c.cz, d.cz, v)),
          tx: catmull(a.tx, b.tx, c.tx, d.tx, v),
          ty: catmull(a.ty, b.ty, c.ty, d.ty, v),
        };
      }
      // Petit mouvement « caméra à l'épaule », qui s'éteint à l'arrivée.
      const wob = Math.min(1, cam.cz);
      cam.tx += Math.sin(t * 1.3) * 3 * wob;
      cam.ty += Math.sin(t * 1.7 + 1) * 2 * wob;
      // Jamais de bord visible : tant que les plans proches ne couvrent pas tout, la caméra
      // reste dans la partie peinte du fond ; ensuite, dans le cadre entier.
      const box = this.bbox || { x0: 0, y0: 0, x1: W, y1: H };
      const w = smooth((cam.cz - (this.coverZ - 0.15)) / 0.15);
      cam.tx = lerp(this.clampAxis(cam.tx, cam.cz, 0, W), this.clampAxis(cam.tx, cam.cz, box.x0, box.x1, W), w);
      cam.ty = lerp(this.clampAxis(cam.ty, cam.cz, 0, H), this.clampAxis(cam.ty, cam.cz, box.y0, box.y1, H), w);
      return cam;
    }

    // Garde la vue de la plaque du fond dans [a, b] (le long d'un axe de taille n).
    clampAxis(T, cz, a, b, n = b - a) {
      const Z0 = this.plates[0].Z;
      const z0 = Z0 - cz;
      const s0 = Z0 / z0;
      const c = n / 2;
      const lo = z0 * ((a - c) * s0 + c);
      const hi = z0 * ((b - c) * s0 - c);
      return lo > hi ? (lo + hi) / 2 : clamp(T, lo, hi);
    }

    // Le travelling : la caméra longe le monde élargi depuis un bord et vient se poser sur
    // le cadre du fond d'écran. Le premier plan (le plus proche) sert de repère : c'est lui
    // qui défile le plus vite ; les plans lointains glissent lentement derrière.
    travelCam(t) {
      const { W, H } = this;
      const u = clamp(t / this.duration, 0, 1);
      const e = 0.5 - 0.5 * Math.cos(Math.PI * u); // départ et arrivée en douceur
      const Zn = this.spec.layers[this.spec.layers.length - 1].Z;
      const right = this.spec.from === 'right';
      const ext = right ? this.ER : this.EL;
      const q = W / 2 + (right ? 1 : -1) * ext * (1 - e); // centre de la vue sur le premier plan
      const rest = (1 - e) * (1 - e);
      const cam = {
        cz: 0.22 * rest, // un léger rapproché au départ, qui se relâche
        tx: (q - W / 2) * Zn,
        ty: -H * 0.05 * Zn * rest, // la caméra regarde un peu plus haut au départ
      };
      return this.clampTravel(cam);
    }

    // Aucune plaque ne doit montrer son bord : on borne la caméra pour chacune.
    clampTravel(cam) {
      const { W, H, EL, ER } = this;
      let lo = -Infinity;
      let hi = Infinity;
      let loY = -Infinity;
      let hiY = Infinity;
      this.spec.layers.forEach((l, i) => {
        const Z = this.plates[i].Z;
        const box = i === 0 && this.bbox ? this.bbox : { x0: -EL, y0: 0, x1: W + ER, y1: H };
        const ax = this.axisRange(cam.cz, box.x0, box.x1, W, Z);
        const ay = this.axisRange(cam.cz, box.y0, box.y1, H, Z);
        lo = Math.max(lo, ax[0]);
        hi = Math.min(hi, ax[1]);
        loY = Math.max(loY, ay[0]);
        hiY = Math.min(hiY, ay[1]);
      });
      cam.tx = lo > hi ? (lo + hi) / 2 : clamp(cam.tx, lo, hi);
      cam.ty = loY > hiY ? (loY + hiY) / 2 : clamp(cam.ty, loY, hiY);
      return cam;
    }

    // Plage de décalage permise pour qu'une plaque de profondeur Z montre seulement [a, b].
    axisRange(cz, a, b, n, Z) {
      const z = Z - cz;
      const s = Z / z;
      const c = n / 2;
      return [z * ((a - c) * s + c), z * ((b - c) * s - c)];
    }

    // Zone réellement peinte de la plaque du fond : on part du cadre englobant et on
    // rogne les bords tant qu'ils ne sont pas peints presque entièrement.
    paintedBox(a) {
      const { PW: W, H } = this;
      let x0 = W;
      let y0 = H;
      let x1 = -1;
      let y1 = -1;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (a[y * W + x]) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0) return { x0: 0, y0: 0, x1: W, y1: H };
      const row = (y) => {
        let n = 0;
        for (let x = x0; x <= x1; x++) n += a[y * W + x];
        return n / (x1 - x0 + 1);
      };
      const col = (x) => {
        let n = 0;
        for (let y = y0; y <= y1; y++) n += a[y * W + x];
        return n / (y1 - y0 + 1);
      };
      for (let guard = 0; guard < W + H && x0 < x1 && y0 < y1; guard++) {
        // On rogne d'abord le bord le moins peint.
        const f = [row(y0), row(y1), col(x0), col(x1)];
        const m = Math.min(...f);
        if (m >= 0.97) break;
        const k = f.indexOf(m);
        if (k === 0) y0++;
        else if (k === 1) y1--;
        else if (k === 2) x0++;
        else x1--;
      }
      return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
    }

    // Prolonge les bords peints de la plaque du fond (ciel vers le haut, sol vers le bas…)
    // là où elle est transparente : ce qu'on aperçoit en biais (par la vitre, sous un
    // premier plan qui arrive) n'est jamais un trou noir.
    extendEdges(p) {
      const { PW: W, H } = this;
      const { x0, y0, x1, y1 } = this.canvasBox;
      const g = p.g;
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'destination-over'; // seulement là où rien n'est peint
      g.imageSmoothingEnabled = false;
      if (y0 > 0) g.drawImage(p.c, x0, y0 + 1, x1 - x0, 1, x0, 0, x1 - x0, y0 + 1);
      if (y1 < H) g.drawImage(p.c, x0, y1 - 2, x1 - x0, 1, x0, y1 - 1, x1 - x0, H - y1 + 1);
      if (x0 > 0) g.drawImage(p.c, x0 + 1, 0, 1, H, 0, 0, x0 + 1, H);
      if (x1 < W) g.drawImage(p.c, x1 - 2, 0, 1, H, x1 - 1, 0, W - x1 + 1, H);
      g.restore();
    }

    draw(out, dt) {
      const { W, H, k } = this;
      this.t += dt;
      this.lastDt = dt;
      const t = this.t;

      // 1. La scène se dessine, chaque élément sur sa plaque.
      this.scene.update(dt, { effect: this.effect });
      this.hookCalls();
      this.ctl.begin();
      this.ctx.imageSmoothingEnabled = false;
      this.scene.draw(this.ctx);
      if (this.soloPlate) this.soloPlate.Z = this.spec.solo.Z(this.scene);
      if (!this.alphas) this.analyse();
      this.extendEdges(this.plates[0]); // aucun trou noir derrière les plans proches

      // 2. La caméra photographie les plaques, de la plus lointaine à la plus proche.
      const cam = this.camera(t);
      out.imageSmoothingEnabled = false;
      out.globalCompositeOperation = 'source-over';
      out.fillStyle = '#000';
      out.fillRect(0, 0, W * k, H * k);
      const order = [...this.plates].sort((a, b) => b.Z - a.Z);
      for (const p of order) {
        const dz = p.Z - cam.cz;
        if (dz < 0.05) continue; // derrière la caméra
        const s = p.Z / dz;
        // Une plaque qui frôle l'objectif s'efface (on la traverse).
        const alpha = p.opaque ? 1 : clamp((dz - 0.05) / p.fade, 0, 1);
        if (alpha <= 0) continue;
        // Le bord gauche de la toile (x = −EL dans la scène) arrive à l'écran en :
        const x = W / 2 + (-this.EL - W / 2) * s - cam.tx / dz;
        const y = (H / 2) * (1 - s) - cam.ty / dz;
        const X0 = Math.round(x * k);
        const Y0 = Math.round(y * k);
        const X1 = Math.round((x + this.PW * s) * k);
        const Y1 = Math.round((y + H * s) * k);
        out.globalAlpha = alpha;
        out.drawImage(p.c, X0, Y0, X1 - X0, Y1 - Y0);
        out.globalCompositeOperation = 'lighter';
        out.drawImage(p.lc, X0, Y0, X1 - X0, Y1 - Y0);
        out.globalCompositeOperation = 'source-over';
      }
      out.globalAlpha = 1;

      // 3. La météo de l'app tombe devant l'objectif.
      if (this.weather) {
        this.fxg.clearRect(0, 0, W, H);
        this.weather.update(dt, t);
        this.weather.draw(this.fxg, t);
        out.drawImage(this.fx, 0, 0, W * k, H * k);
      }
      return t >= this.duration + 0.3;
    }
  }

  // Côté par lequel la caméra arrive pour une scène (gauche par défaut).
  Multiplane.from = (key) => (SPECS[key] && SPECS[key].from) || 'left';
  B.Multiplane = Multiplane;
})();
