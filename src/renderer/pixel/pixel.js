// Brume — moteur pixel art.
//
// • Raster : une toile de pixels en mémoire, avec des outils de peintre (aplats, dégradés
//   tramés, bruit, mélange). Le décor d'une scène y est peint UNE fois, puis réutilisé.
// • sprite() : compile un dessin écrit en texte (une lettre = une couleur) en image.
// Tout est en « pixels logiques » (~430 × 240), agrandis d'un facteur entier à l'écran.
(function () {
  'use strict';
  const B = (window.Brume = window.Brume || {});

  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
  const bayer = (x, y) => BAYER[(x & 3) + (y & 3) * 4];

  const hex = (h) => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  // Générateur pseudo-aléatoire déterministe : la même scène est toujours peinte pareil.
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const hash = (x, y, s = 0) => {
    let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  function noise(x, y, s = 0) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = hash(xi, yi, s);
    const b = hash(xi + 1, yi, s);
    const c = hash(xi, yi + 1, s);
    const d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, s = 0, oct = 4) {
    let sum = 0;
    let amp = 0.5;
    for (let i = 0; i < oct; i++) {
      sum += amp * noise(x, y, s + i * 17);
      x *= 2.03;
      y *= 2.03;
      amp *= 0.5;
    }
    return sum;
  }

  class Raster {
    constructor(w, h) {
      this.w = w;
      this.h = h;
      this.data = new Uint8ClampedArray(w * h * 4);
    }

    set(x, y, c, a = 255) {
      x |= 0;
      y |= 0;
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
      const i = (y * this.w + x) * 4;
      this.data[i] = c[0];
      this.data[i + 1] = c[1];
      this.data[i + 2] = c[2];
      this.data[i + 3] = a;
    }

    get(x, y) {
      x = Math.max(0, Math.min(this.w - 1, x | 0));
      y = Math.max(0, Math.min(this.h - 1, y | 0));
      const i = (y * this.w + x) * 4;
      return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
    }

    // Mélange la couleur existante vers c (t de 0 à 1).
    tint(x, y, c, t) {
      const p = this.get(x, y);
      if (!p[3]) return;
      this.set(x, y, mix(p, c, t));
    }

    rect(x, y, w, h, c) {
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
    }

    // Aplat tramé entre deux couleurs (t = part de c2).
    dither(x, y, w, h, c1, c2, t) {
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, bayer(i, j) < t ? c2 : c1);
    }

    // Dégradé vertical tramé à travers une liste de couleurs (en paliers, à la pixel art).
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

    toCanvas() {
      const c = document.createElement('canvas');
      c.width = this.w;
      c.height = this.h;
      c.getContext('2d').putImageData(new ImageData(this.data, this.w, this.h), 0, 0);
      return c;
    }
  }

  // Dessin en texte → image. rows : tableau de chaînes ; pal : { lettre: '#rrggbb' }.
  // '.' et ' ' sont transparents. flip : miroir horizontal.
  function sprite(rows, pal, flip = false) {
    const h = rows.length;
    const w = Math.max(...rows.map((r) => r.length));
    const r = new Raster(w, h);
    const cols = {};
    for (const k of Object.keys(pal)) cols[k] = hex(pal[k]);
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = cols[row[x]];
        if (c) r.set(flip ? w - 1 - x : x, y, c);
      }
    });
    return r.toCanvas();
  }

  // Remplace des lettres dans un dessin (pour décliner un sprite en variantes).
  const recolor = (rows, map) => rows.map((row) => row.replace(/./g, (ch) => map[ch] || ch));

  B.PX = { Raster, sprite, recolor, hex, mix, rng, hash, noise, fbm, bayer };
  B.PixelScenes = B.PixelScenes || {};
})();
