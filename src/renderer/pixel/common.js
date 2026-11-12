// Brume — boîte à outils commune des scènes pixel art.
// Éclairage peint, halos, police d'enseigne, foule de passants, circulation, pluie,
// neige, pétales/feuilles, vols d'oiseaux, vapeur et notes de musique.
// Toutes les coordonnées sont en pixels logiques ; tout se dessine avec des entiers.
(function () {
  'use strict';
  const B = window.Brume;
  const { Raster, sprite, bayer } = B.PX;
  const SP = B.Sprites;

  /* ---------- Éclairage peint (multiplie chaque pixel d'un Raster) ----------
   * lights : [{ x, y, r, k, sy }] ; ambient / warm : multiplicateurs RVB (0–1+).
   * Les paliers tramés donnent le rendu « peint » du pixel art. */
  function applyLight(r, lights, ambient, warm, mask) {
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        if (mask && !mask(x, y)) continue;
        const i = (y * r.w + x) * 4;
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

  /* ---------- Halos lumineux (à dessiner en mode « lighter ») ----------
   * halos : [{ x, y, r, c: [r, g, b], k }] */
  function makeHalo(W, H, halos) {
    const r = new Raster(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let R = 0;
        let G = 0;
        let Bl = 0;
        for (const h of halos) {
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

  /* ---------- Police 3 × 5 pour les enseignes ---------- */
  const FONT = {
    A: ['010', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'], C: ['011', '100', '100', '100', '011'],
    D: ['110', '101', '101', '101', '110'], E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'],
    G: ['011', '100', '101', '101', '011'], H: ['101', '101', '111', '101', '101'], I: ['111', '010', '010', '010', '111'],
    K: ['101', '101', '110', '101', '101'], L: ['100', '100', '100', '100', '111'], M: ['101', '111', '111', '101', '101'],
    N: ['101', '111', '111', '111', '101'], O: ['010', '101', '101', '101', '010'], P: ['110', '101', '110', '100', '100'],
    R: ['110', '101', '110', '101', '101'], S: ['011', '100', '010', '001', '110'], T: ['111', '010', '010', '010', '010'],
    U: ['101', '101', '101', '101', '111'], V: ['101', '101', '101', '101', '010'], Y: ['101', '101', '010', '010', '010'],
    Z: ['111', '001', '010', '100', '111'], ' ': ['000', '000', '000', '000', '000'],
  };
  // Écrit un texte (majuscules) ; renvoie la largeur. Fonctionne sur un contexte 2D ou un Raster.
  function text(target, str, x, y, color) {
    let cx = x;
    for (const ch of str) {
      const glyph = FONT[ch] || FONT[' '];
      glyph.forEach((row, ry) => {
        for (let rx = 0; rx < 3; rx++) {
          if (row[rx] !== '1') continue;
          if (target.set) target.set(cx + rx, y + ry, color);
          else {
            target.fillStyle = color;
            target.fillRect(cx + rx, y + ry, 1, 1);
          }
        }
      });
      cx += 4;
    }
    return cx - x - 1;
  }

  /* ---------- Oiseaux en vol (silhouette) et mouettes ---------- */
  const BIRD = [
    ['1.....1', '.1...1.', '..111..'],
    ['.......', '.11111.', '1..1..1'],
  ];
  const GULL = [
    ['ww.....ww', '.ww...ww.', '..wwgww..', '....d....'],
    ['.........', '.wwwgwww.', 'ww..d..ww', '.........'],
  ];
  const birdSprites = (color) => BIRD.map((f) => sprite(f.map((r) => r.replace(/1/g, 'b')), { b: color }));
  const gullSprites = () => GULL.map((f) => sprite(f, { w: '#f2f0ea', g: '#a8b0b8', d: '#e8a23a' }));

  /* ---------- Foule de passants (marche sur une ligne de sol) ----------
   * opts : { x0, x1, walkY, rate: [min, max] secondes, mix: { umbrella, kid, dog },
   *          hh : taille d'une tête (px), season, wet }
   * Les passants sont peints par B.People (volumes, ombres, contour) ; restyle() permet à
   * une scène de les rhabiller (saison, pluie) ou de les éclairer à sa lumière. */
  class Crowd {
    constructor(opts) {
      this.o = { rate: [3, 9], mix: { umbrella: 0.55, kid: 0.2, dog: 0.25 }, hh: 5, ...opts };
      this.list = [];
      this.next = 0.5 + Math.random() * 2;
      this.sets = null;
      if (this.o.style !== false) this.restyle({ wet: true });
    }

    // Rhabille la foule. o : { season, wet, bake (éclairage d'un Raster), seed }.
    // Avec wet, les passants « umbrella » ont un parapluie ; sinon ce sont des promeneurs.
    restyle(o = {}) {
      const sets = B.People.crowdSets({ hh: this.o.hh, season: o.season, wet: o.wet, bake: o.bake, seed: o.seed || 1 + Math.floor(Math.random() * 50), n: o.n || 5 });
      this.sets = { umbrella: o.wet ? sets.umbrella : sets.dry, kid: sets.kid, dog: sets.dog, rain: sets.umbrella, dry: sets.dry };
      this.list = [];
      return this.sets;
    }

    spawn() {
      const o = this.o;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const m = o.mix;
      const total = m.umbrella + m.kid + m.dog;
      const roll = Math.random() * total;
      let kind = 'dog';
      if (roll < m.umbrella) kind = 'umbrella';
      else if (roll < m.umbrella + m.kid) kind = 'kid';
      const pool = this.sets.umbrella;
      const set = kind === 'umbrella' ? pool[Math.floor(Math.random() * pool.length)] : this.sets[kind];
      const speed = (kind === 'kid' ? 12 + Math.random() * 3 : 9 + Math.random() * 4) * (o.hh / 5);
      const span = set.w + (set.dogW || 0) + 6;
      this.list.push({ kind, set, dir, speed, x: dir > 0 ? o.x0 - span : o.x1 + span - set.w, t: Math.random() });
    }

    update(dt) {
      this.next -= dt;
      if (this.next <= 0) {
        this.spawn();
        this.next = this.o.rate[0] + Math.random() * (this.o.rate[1] - this.o.rate[0]);
      }
      for (const w of this.list) {
        w.x += w.dir * w.speed * dt;
        w.t += dt;
      }
      this.list = this.list.filter((w) => w.x > this.o.x0 - w.set.w - (w.set.dogW || 0) - 12 && w.x < this.o.x1 + (w.set.dogW || 0) + 12);
    }

    draw(g) {
      for (const w of this.list) B.People.drawWalker(g, w.set, Math.round(w.x), this.o.walkY, w.dir, w.t);
    }
  }

  /* ---------- Circulation : une voiture de temps en temps, phares allumés ----------
   * opts : { x0, x1, groundY, rate: [min, max], headlights: bool } */
  class Traffic {
    constructor(opts) {
      this.o = { rate: [10, 25], headlights: true, ...opts };
      this.cars = [0, 1, 2].map(SP.car);
      this.car = null;
      this.next = 3 + Math.random() * 6;
    }
    update(dt) {
      const o = this.o;
      this.next -= dt;
      if (!this.car && this.next <= 0) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        this.car = { dir, x: dir > 0 ? o.x0 - 40 : o.x1 + 4, set: this.cars[Math.floor(Math.random() * 3)], v: 50 + Math.random() * 30 };
        this.next = o.rate[0] + Math.random() * (o.rate[1] - o.rate[0]);
      }
      if (this.car) {
        this.car.x += this.car.dir * this.car.v * dt;
        if (this.car.x < o.x0 - 50 || this.car.x > o.x1 + 10) this.car = null;
      }
    }
    draw(g) {
      const c = this.car;
      if (!c) return;
      const img = c.dir > 0 ? c.set.right : c.set.left;
      const y = this.o.groundY - c.set.h;
      const x = Math.round(c.x);
      g.drawImage(img, x, y);
      if (this.o.headlights) {
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = 'rgba(255,230,160,0.16)';
        const front = c.dir > 0 ? x + c.set.w : x - 26;
        g.fillRect(front, y + 4, 26, 3);
        g.fillRect(front + (c.dir > 0 ? 6 : 0), y + 3, 20, 5);
        g.globalCompositeOperation = 'source-over';
      }
    }
  }

  /* ---------- Pluie de la scène (traits + ronds au sol) ----------
   * opts : { x0, x1, y0, y1 (sol le plus bas), groundY0 (début du sol), count, slant } */
  class RainFx {
    constructor(opts) {
      this.o = { count: 120, slant: 0.12, ...opts };
      this.drops = Array.from({ length: this.o.count }, () => this.drop(true));
      this.ripples = [];
    }
    drop(initial) {
      const o = this.o;
      return {
        x: o.x0 + Math.random() * (o.x1 - o.x0 + 30) - 10,
        y: initial ? o.y0 + Math.random() * (o.y1 - o.y0) : o.y0 - Math.random() * 20,
        v: 150 + Math.random() * 70,
        stop: o.groundY0 + Math.random() * (o.y1 - o.groundY0),
      };
    }
    update(dt) {
      for (const d of this.drops) {
        d.y += d.v * dt;
        d.x -= d.v * dt * this.o.slant;
        if (d.y >= d.stop) {
          if (this.ripples.length < 50) this.ripples.push({ x: Math.round(d.x), y: Math.round(d.stop), age: 0 });
          Object.assign(d, this.drop(false));
        }
      }
      for (const r of this.ripples) r.age += dt;
      this.ripples = this.ripples.filter((r) => r.age < 0.6);
    }
    draw(g) {
      g.fillStyle = 'rgba(170,190,230,0.55)';
      for (const d of this.drops) g.fillRect(Math.round(d.x), Math.round(d.y), 1, 3);
      g.fillStyle = 'rgba(180,200,235,0.6)';
      for (const r of this.ripples) {
        const k = 1 + Math.floor(r.age * 6);
        g.fillRect(r.x - k, r.y, 1, 1);
        g.fillRect(r.x + k, r.y, 1, 1);
      }
    }
  }

  /* ---------- Particules qui tombent en virevoltant : neige, pétales, feuilles ----------
   * opts : { x0, x1, y0, y1, count, colors: ['#rrggbb'], size: 1|2, fall: [min, max], sway } */
  class Drift {
    constructor(opts) {
      this.o = { count: 60, size: 1, fall: [8, 18], sway: 6, ...opts };
      this.p = Array.from({ length: this.o.count }, () => this.make(true));
    }
    make(initial) {
      const o = this.o;
      return {
        x: o.x0 + Math.random() * (o.x1 - o.x0),
        y: initial ? o.y0 + Math.random() * (o.y1 - o.y0) : o.y0 - Math.random() * 10,
        v: o.fall[0] + Math.random() * (o.fall[1] - o.fall[0]),
        ph: Math.random() * 6.28,
        c: o.colors[Math.floor(Math.random() * o.colors.length)],
      };
    }
    update(dt, t) {
      for (const q of this.p) {
        q.y += q.v * dt;
        q.x += Math.sin(t * 1.3 + q.ph) * this.o.sway * dt;
        if (q.y > this.o.y1) Object.assign(q, this.make(false));
      }
    }
    draw(g, t) {
      const s = this.o.size;
      for (const q of this.p) {
        g.fillStyle = q.c;
        const flip = s > 1 && Math.sin(t * 3 + q.ph) > 0;
        g.fillRect(Math.round(q.x), Math.round(q.y), flip ? 1 : s, s);
      }
    }
  }

  /* ---------- Vols d'oiseaux (ou de mouettes) qui traversent le ciel ----------
   * opts : { x0, x1, y0, y1, rate: [min, max], kind: 'bird' | 'gull', color } */
  class Flock {
    constructor(opts) {
      this.o = { rate: [8, 20], kind: 'bird', color: '#1a1622', ...opts };
      this.frames = this.o.kind === 'gull' ? gullSprites() : birdSprites(this.o.color);
      this.birds = [];
      this.next = 2 + Math.random() * 5;
    }
    update(dt) {
      const o = this.o;
      this.next -= dt;
      if (this.next <= 0) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        const y = o.y0 + Math.random() * (o.y1 - o.y0);
        const n = 1 + Math.floor(Math.random() * 4);
        for (let k = 0; k < n; k++) {
          this.birds.push({ x: (dir > 0 ? o.x0 - 12 : o.x1 + 4) - dir * k * 9, y: y + (k % 2) * 4 + k * 2, dir, v: 18 + Math.random() * 8, t: Math.random(), bob: Math.random() * 6 });
        }
        this.next = o.rate[0] + Math.random() * (o.rate[1] - o.rate[0]);
      }
      for (const b of this.birds) {
        b.x += b.dir * b.v * dt;
        b.t += dt;
      }
      this.birds = this.birds.filter((b) => b.x > o.x0 - 30 && b.x < o.x1 + 30);
    }
    draw(g) {
      for (const b of this.birds) {
        const img = this.frames[Math.floor(b.t / 0.22) % 2];
        g.drawImage(img, Math.round(b.x), Math.round(b.y + Math.sin(b.t * 2 + b.bob) * 1.5));
      }
    }
  }

  /* ---------- Vapeur / fumée / notes de musique ---------- */
  class Puffs {
    constructor(color = '235,235,245') {
      this.color = color;
      this.p = [];
    }
    emit(x, y, life = 2, rise = 7) {
      this.p.push({ x, y, age: 0, life, rise, ph: Math.random() * 6 });
    }
    update(dt) {
      for (const q of this.p) {
        q.age += dt;
        q.y -= dt * q.rise;
        q.x += Math.sin(q.age * 3 + q.ph) * dt * 3;
      }
      this.p = this.p.filter((q) => q.age < q.life);
    }
    draw(g, alpha = 0.32) {
      for (const q of this.p) {
        g.fillStyle = `rgba(${this.color},${alpha * (1 - q.age / q.life)})`;
        g.fillRect(Math.round(q.x), Math.round(q.y), 1, 1);
      }
    }
  }

  const NOTE = [
    ['..11', '..1.', '..1.', '111.', '11..'],
    ['1111', '1..1', '1..1', '11.11', '11.11'],
  ];
  class Notes {
    constructor() {
      this.n = [];
    }
    emit(x, y) {
      this.n.push({ x, y, age: 0, life: 3.5, p: Math.random() * 6, kind: Math.random() < 0.5 ? 0 : 1 });
    }
    update(dt) {
      for (const n of this.n) {
        n.age += dt;
        n.y -= dt * 6;
        n.x += Math.sin(n.age * 2 + n.p) * dt * 5;
      }
      this.n = this.n.filter((n) => n.age < n.life);
    }
    draw(g, rgb = '255,232,170') {
      for (const n of this.n) {
        g.fillStyle = `rgba(${rgb},${0.8 * Math.min(1, (n.life - n.age) / 1.2) * Math.min(1, n.age * 3)})`;
        NOTE[n.kind].forEach((row, y) => {
          for (let x = 0; x < row.length; x++) if (row[x] === '1') g.fillRect(Math.round(n.x) + x, Math.round(n.y) + y, 1, 1);
        });
      }
    }
  }

  // Mode test accéléré pour les captures (#fauna dans l'URL de la page).
  const fastTest = () => typeof location !== 'undefined' && location.hash === '#fauna';

  B.PXC = { applyLight, makeHalo, text, FONT, birdSprites, gullSprites, Crowd, Traffic, RainFx, Drift, Flock, Puffs, Notes, fastTest };
})();
