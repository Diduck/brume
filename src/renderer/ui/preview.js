// Brume — aperçu animé de la fenêtre de Brume (en-tête).
// Une petite scène lofi en basse résolution (pixels nets) : le ciel de l'ambiance
// choisie, une ville, et une mini-fenêtre sur laquelle le temps choisi tombe pour de
// vrai — la neige s'accumule sur son toit. Change d'effet : l'aperçu suit aussitôt.
(function () {
  'use strict';
  const B = window.Brume;
  const P = window.BRUME_PALETTES;
  const SCALE = 2; // 1 pixel de la scène = 2 × 2 points

  const rand = (a, b) => a + Math.random() * (b - a);
  const rgb = (hex, a = 1) => {
    const [r, g, b] = P.hexToRgb(hex);
    return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
  };

  class Preview {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.effect = 'snow';
      this.paletteKey = 'nuit';
      this.aurora = false;
      this.items = [];
      this.running = false;
      this.flash = 0;
      this.nextFlash = 2;
      this.nextMeteor = 1;
      this.meteors = [];
      this.t = 0;
      this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.frame = this.frame.bind(this);
    }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      this.W = Math.max(40, Math.round(r.width / SCALE));
      this.H = Math.max(20, Math.round(r.height / SCALE));
      this.canvas.width = this.W;
      this.canvas.height = this.H;
      // La mini-fenêtre et sa neige posée.
      this.win = { x: Math.round(this.W * 0.56), y: Math.round(this.H * 0.5), w: Math.round(this.W * 0.34) };
      this.roof = new Float32Array(this.win.w);
      this.stars = Array.from({ length: 26 }, () => ({ x: Math.random() * this.W, y: Math.random() * this.H * 0.45, p: Math.random() * 6 }));
      this.city = [];
      for (let x = 0; x < this.W; ) {
        const w = Math.round(rand(5, 11));
        this.city.push({ x, w, h: Math.round(rand(6, 18)) });
        x += w;
      }
      this.reset();
    }

    // Vignettes des vraies scènes (images), peintes par la page du fond d'écran.
    setBackdrops(images) {
      this.backdrops = images;
      if (!this.running) this.draw();
    }

    set(effect, wallpaper, aurora) {
      const key = P.resolve(wallpaper, effect) || 'nuit';
      const changed = effect !== this.effect;
      this.effect = effect;
      this.paletteKey = key;
      this.sceneKey = P.resolve(wallpaper, effect); // null : pas de scène, le ciel générique
      this.aurora = !!aurora;
      if (changed && this.W) this.reset();
      if (!this.running) this.draw();
    }

    reset() {
      const counts = { snow: 70, rain: 55, storm: 80, sakura: 16, leaves: 14, fireflies: 14, starfall: 0, none: 0 };
      this.items = Array.from({ length: counts[this.effect] || 0 }, () => this.spawn(true));
      this.meteors = [];
      // Quelques secondes simulées d'avance : le toit est déjà enneigé à l'ouverture.
      if (this.effect === 'snow' && !this.roof.some((h) => h > 1)) {
        for (let k = 0; k < 600; k++) this.step(1 / 30);
      }
    }

    spawn(initial) {
      const fx = this.effect;
      const it = { x: rand(0, this.W), y: initial ? rand(-this.H, this.H) : rand(-10, -1), p: rand(0, 6.28), rest: 0 };
      if (fx === 'snow') Object.assign(it, { vy: rand(6, 16), size: Math.random() < 0.3 ? 2 : 1 });
      if (fx === 'rain' || fx === 'storm') Object.assign(it, { vy: rand(90, 140) });
      if (fx === 'sakura') Object.assign(it, { vy: rand(5, 9), c: Math.random() < 0.5 ? '#f7b7c8' : '#ef97b0' });
      if (fx === 'leaves') Object.assign(it, { vy: rand(7, 12), c: ['#e9772a', '#c9402a', '#efb43c'][(Math.random() * 3) | 0] });
      if (fx === 'fireflies') Object.assign(it, { hx: rand(4, this.W * 0.5), hy: rand(this.H * 0.45, this.H - 6) });
      return it;
    }

    roofTop(x) {
      const i = Math.floor(x - this.win.x);
      return i >= 0 && i < this.win.w ? this.win.y - this.roof[i] : null;
    }

    start() {
      if (this.running) return;
      this.resize();
      if (this.reduced) {
        for (let k = 0; k < 240; k++) this.step(1 / 30); // une image fixe, déjà enneigée
        this.draw();
        return;
      }
      this.running = true;
      this.last = 0;
      requestAnimationFrame(this.frame);
    }

    stop() {
      this.running = false;
    }

    frame(now) {
      if (!this.running) return;
      requestAnimationFrame(this.frame);
      const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60;
      this.last = now;
      this.step(dt);
      this.draw();
    }

    step(dt) {
      this.t += dt;
      const fx = this.effect;
      const t = this.t;
      if (fx !== 'snow') for (let i = 0; i < this.roof.length; i++) this.roof[i] = Math.max(0, this.roof[i] - dt * 1.5);
      for (let i = 0; i < this.items.length; i++) {
        const it = this.items[i];
        if (fx === 'fireflies') {
          it.x = it.hx + Math.sin(t * 0.7 + it.p) * 6;
          it.y = it.hy + Math.sin(t * 0.9 + it.p * 2) * 3;
          continue;
        }
        if (it.rest > 0) {
          it.rest -= dt;
          if (it.rest <= 0) this.items[i] = this.spawn(false);
          continue;
        }
        const sway = fx === 'snow' ? Math.sin(t + it.p) * 4 : fx === 'sakura' || fx === 'leaves' ? Math.sin(t * 1.4 + it.p) * 9 : -14;
        const y0 = it.y;
        it.x += sway * dt;
        it.y += it.vy * dt;
        const top = this.roofTop(it.x);
        if (top !== null && y0 < top && it.y >= top) {
          if (fx === 'snow') {
            const i0 = Math.floor(it.x - this.win.x);
            for (let k = -1; k <= 1; k++) {
              const j = i0 + k;
              if (j >= 0 && j < this.roof.length) this.roof[j] = Math.min(5, this.roof[j] + (k ? 0.6 : 1.2));
            }
            this.items[i] = this.spawn(false);
            continue;
          }
          if (fx === 'sakura' || fx === 'leaves') {
            it.y = top - 1;
            it.rest = rand(2, 4);
            continue;
          }
          if (fx === 'rain' || fx === 'storm') {
            this.items[i] = this.spawn(false);
            continue;
          }
        }
        if (it.y > this.H + 2 || it.x < -4) this.items[i] = this.spawn(false);
      }
      // Éclairs et étoiles filantes.
      if (fx === 'storm') {
        this.nextFlash -= dt;
        if (this.nextFlash <= 0) {
          this.flash = 1;
          this.nextFlash = rand(2.5, 5);
        }
      }
      this.flash = Math.max(0, this.flash - dt * 4);
      if (fx === 'starfall') {
        this.nextMeteor -= dt;
        if (this.nextMeteor <= 0) {
          this.meteors.push({ x: rand(this.W * 0.1, this.W * 0.8), y: rand(2, this.H * 0.3), age: 0 });
          this.nextMeteor = rand(0.9, 2);
        }
        this.meteors = this.meteors.filter((m) => (m.age += dt) < 0.8);
      }
    }

    draw() {
      if (!this.W) return;
      const c = this.ctx;
      const pal = P.PALETTES[this.paletteKey];
      const { W, H, win } = this;
      const night = pal.stars > 0.5;

      // Une vraie scène choisie et sa vignette prête : elle sert de décor, cadrée vers le bas
      // (là où vivent les personnages). Sinon : le ciel et la ville génériques.
      const img = this.sceneKey && this.backdrops && this.backdrops[this.sceneKey];
      if (img && img.complete && img.naturalWidth) {
        const k = Math.max(W / img.naturalWidth, H / img.naturalHeight);
        const dw = img.naturalWidth * k;
        const dh = img.naturalHeight * k;
        c.imageSmoothingEnabled = true;
        c.drawImage(img, (W - dw) / 2, (H - dh) * 0.62, dw, dh);
        this.drawWeather(c, W, H, win, false);
        return;
      }

      // Ciel.
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, pal.skyTop);
      g.addColorStop(0.55, pal.skyMid);
      g.addColorStop(1, pal.horizon);
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      if (night || this.effect === 'starfall') {
        for (const s of this.stars) {
          c.fillStyle = `rgba(255,248,230,${0.35 + 0.35 * Math.sin(this.t * 1.5 + s.p)})`;
          c.fillRect(Math.floor(s.x), Math.floor(s.y), 1, 1);
        }
      }
      if (pal.sun[3] >= 0) {
        const sx = W * 0.2;
        const sy = H * 0.3;
        const halo = c.createRadialGradient(sx, sy, 0, sx, sy, 22);
        halo.addColorStop(0, rgb(pal.sunColor, 0.45));
        halo.addColorStop(1, rgb(pal.sunColor, 0));
        c.fillStyle = halo;
        c.fillRect(sx - 22, sy - 22, 44, 44);
        if (pal.sun[3] > 0.5) {
          // Croissant de lune : un disque « mordu » par un autre, sur un calque à part.
          const m = this.moon || (this.moon = document.createElement('canvas'));
          m.width = 12;
          m.height = 12;
          const mc = m.getContext('2d');
          mc.fillStyle = pal.sunColor;
          mc.beginPath();
          mc.arc(6, 6, 5, 0, Math.PI * 2);
          mc.fill();
          mc.globalCompositeOperation = 'destination-out';
          mc.beginPath();
          mc.arc(8.4, 4.6, 4.4, 0, Math.PI * 2);
          mc.fill();
          c.drawImage(m, Math.round(sx - 6), Math.round(sy - 6));
        } else {
          c.fillStyle = pal.sunColor;
          c.beginPath();
          c.arc(sx, sy, 5, 0, Math.PI * 2);
          c.fill();
        }
      }
      this.drawSky(c, W, H);

      // Ville.
      for (const b of this.city) {
        c.fillStyle = pal.mid;
        c.fillRect(b.x, H - b.h, b.w - 1, b.h);
        c.fillStyle = rgb(pal.light, 0.8);
        for (let wy = H - b.h + 2; wy < H - 1; wy += 3) {
          for (let wx = b.x + 1; wx < b.x + b.w - 2; wx += 2) {
            if (Math.sin(wx * 12.9898 + wy * 78.233) > 0.55) c.fillRect(wx, wy, 1, 1);
          }
        }
      }
      this.drawWeather(c, W, H, win, true);
    }

    // Aurore et étoiles filantes : dans le ciel, derrière la ville.
    drawSky(c, W, H) {
      if (this.aurora) {
        for (let x = 0; x < W; x++) {
          const y = H * 0.22 + Math.sin(x * 0.07 + this.t * 0.6) * 4;
          const a = 0.18 + 0.12 * Math.sin(x * 0.3 + this.t);
          c.fillStyle = `rgba(90,240,170,${a})`;
          c.fillRect(x, Math.floor(y), 1, 7);
        }
      }
      for (const m of this.meteors) {
        const k = m.age / 0.8;
        for (let i = 0; i < 12; i++) {
          c.fillStyle = `rgba(255,255,255,${(1 - i / 12) * (1 - k)})`;
          c.fillRect(Math.floor(m.x + k * 40 - i), Math.floor(m.y + k * 18 - i * 0.45), 1, 1);
        }
      }
    }

    // La mini-fenêtre et le temps qui tombe dessus (skyDone : le ciel est déjà dessiné).
    drawWeather(c, W, H, win, skyDone) {
      if (!skyDone) this.drawSky(c, W, H);

      // Mini-fenêtre macOS : barre de titre, pastilles, contenu.
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.fillRect(win.x + 2, win.y + 2, win.w, H);
      c.fillStyle = '#eef2f8';
      c.fillRect(win.x, win.y, win.w, H);
      c.fillStyle = '#d9e0ea';
      c.fillRect(win.x, win.y, win.w, 4);
      ['#ff6159', '#ffbd2e', '#28c941'].forEach((col, i) => {
        c.fillStyle = col;
        c.fillRect(win.x + 2 + i * 3, win.y + 1, 2, 2);
      });
      c.fillStyle = '#c9d2df';
      for (let i = 0; i < 4; i++) c.fillRect(win.x + 4, win.y + 8 + i * 4, Math.round(win.w * (0.7 - i * 0.12)), 1);

      // Neige posée sur le toit.
      c.fillStyle = '#ffffff';
      for (let i = 0; i < win.w; i++) {
        const h = Math.round(this.roof[i]);
        if (h > 0) c.fillRect(win.x + i, win.y - h, 1, h);
      }

      // Météo.
      for (const it of this.items) {
        const x = Math.floor(it.x);
        const y = Math.floor(it.y);
        if (x >= win.x && x < win.x + win.w && y > win.y) continue; // derrière la fenêtre, comme dans l'app
        switch (this.effect) {
          case 'snow':
            c.fillStyle = '#ffffff';
            c.fillRect(x, y, it.size, it.size);
            break;
          case 'rain':
          case 'storm':
            c.fillStyle = 'rgba(190,212,236,0.75)';
            c.fillRect(x, y, 1, 3);
            break;
          case 'sakura':
          case 'leaves':
            c.fillStyle = it.c;
            c.fillRect(x, y, 2, Math.sin(this.t * 3 + it.p) > 0 || it.rest > 0 ? 1 : 2);
            break;
          case 'fireflies': {
            const a = 0.35 + 0.65 * Math.max(0, Math.sin(this.t * 2 + it.p));
            c.fillStyle = `rgba(220,255,120,${a * 0.25})`;
            c.fillRect(x - 1, y - 1, 3, 3);
            c.fillStyle = `rgba(235,255,150,${a})`;
            c.fillRect(x, y, 1, 1);
            break;
          }
        }
      }
      if (this.flash > 0) {
        c.fillStyle = `rgba(230,238,255,${this.flash * 0.35})`;
        c.fillRect(0, 0, W, H);
      }
    }
  }

  B.Preview = Preview;
})();
