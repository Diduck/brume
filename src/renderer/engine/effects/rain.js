// Brume — pluie et orage : gouttes étirées, éclaboussures et ronds sur les fenêtres,
// éclairs lointains pour l'orage.
(function () {
  'use strict';
  const B = window.Brume;
  const U = B.U;

  // Un éclair = deux flashs rapprochés, comme dans la vraie vie.
  const FLASH = [
    [0, 0],
    [0.04, 0.3],
    [0.09, 0.02],
    [0.15, 0.2],
    [0.4, 0],
  ];

  class Rain {
    constructor(engine, storm) {
      this.e = engine;
      this.storm = storm;
      this.drops = [];
      this.splashes = [];
      this.ripples = [];
      this.spawning = true;
      this.flash = 0;
      this.flashT = -1;
      this.nextFlash = U.rand(2, 6);
    }

    place(d, initial) {
      const { W, H } = this.e.world;
      d.z = Math.random();
      d.len = 12 + d.z * 24;
      d.w = 0.9 + d.z * 1.1;
      d.vy = 900 + d.z * 700;
      d.vx = 0;
      d.kx = 0;
      d.ky = 0;
      d.x = U.rand(-0.2 * W, 1.2 * W) - this.e.wind;
      d.y = initial ? U.rand(-H, 0) : U.rand(-80, -20);
      return d;
    }

    update(dt) {
      const e = this.e;
      const world = e.world;
      const { W, H } = world;
      const target = this.spawning ? e.count(this.storm ? 950 : 430) : 0;
      const drops = this.drops;
      while (drops.length < target) drops.push(this.place({}, true));
      const windX = e.wind * (this.storm ? 3.4 : 2.4);
      const decay = Math.exp(-3 * dt);

      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.kx *= decay;
        d.ky = 0;
        e.cursorPush(d, 90, 0.6, dt);
        d.vx = windX + d.kx;
        const y0 = d.y;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        let done = false;
        if (d.z > 0.5) {
          const p = world.hit(d.x, y0, d.y);
          if (p) {
            this.splash(d.x, p.topAt(d.x), p, d.vx);
            done = true;
          }
        }
        if (!done && (d.y > H + 40 || d.x < -0.3 * W || d.x > 1.3 * W)) done = true;
        if (done) {
          if (drops.length > target) U.swapRemove(drops, i);
          else this.place(d, false);
        }
      }

      for (let i = this.splashes.length - 1; i >= 0; i--) {
        const s = this.splashes[i];
        s.vy += 1700 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.life -= dt;
        if (s.life <= 0) U.swapRemove(this.splashes, i);
      }
      for (let i = this.ripples.length - 1; i >= 0; i--) {
        const r = this.ripples[i];
        r.age += dt;
        if (r.age >= r.life) U.swapRemove(this.ripples, i);
      }

      // Éclairs d'orage.
      this.flash = 0;
      if (this.storm && this.spawning) {
        this.nextFlash -= dt;
        if (this.nextFlash <= 0) {
          this.flashT = 0;
          this.nextFlash = U.rand(5, 16);
        }
      }
      if (this.flashT >= 0) {
        this.flashT += dt;
        const t = this.flashT;
        for (let k = 0; k < FLASH.length - 1; k++) {
          const [t0, a0] = FLASH[k];
          const [t1, a1] = FLASH[k + 1];
          if (t >= t0 && t < t1) this.flash = U.lerp(a0, a1, (t - t0) / (t1 - t0));
        }
        if (t >= FLASH[FLASH.length - 1][0]) this.flashT = -1;
      }
    }

    splash(x, y, pile, vx) {
      if (this.splashes.length < 1500) {
        const n = 2 + ((Math.random() * 2) | 0);
        for (let k = 0; k < n; k++) {
          this.splashes.push({ x, y: y - 1, vx: U.rand(-110, 110) + vx * 0.2, vy: -U.rand(90, 240), life: U.rand(0.25, 0.5), size: U.rand(1.6, 2.8) });
        }
      }
      if (Math.random() < 0.35 && this.ripples.length < 200) {
        this.ripples.push({ pile, off: x - pile.x0, dy: y - pile.y, age: 0, life: U.rand(0.35, 0.6), max: U.rand(8, 16) });
      }
    }

    draw(e) {
      const order = e.settings.behind ? 1e4 : -1;
      for (const d of this.drops) {
        const speed = Math.hypot(d.vx, d.vy) || 1;
        const ux = d.vx / speed;
        const uy = d.vy / speed;
        e.push(1, d.x - (ux * d.len) / 2, d.y - (uy * d.len) / 2, d.w, d.len, Math.atan2(-ux, uy), 0.3 + 0.45 * d.z, order, 0);
      }
      for (const s of this.splashes) e.push(7, s.x, s.y, s.size, s.size, 0, Math.min(1, s.life * 4) * 0.8, -1, 0);
      for (const r of this.ripples) {
        const k = r.age / r.life;
        const rad = 2 + r.max * k;
        e.push(6, r.pile.x0 + r.off, r.pile.y + r.dy, rad * 2, rad * 0.6, 0, (1 - k) * 0.7, r.pile.order, 0);
      }
    }

    drawFlash(renderer, behind) {
      if (this.flash > 0.002) renderer.drawFlash(this.flash, behind);
    }

    isEmpty() {
      return this.drops.length === 0 && this.splashes.length === 0 && this.ripples.length === 0 && this.flashT < 0;
    }
  }

  B.Rain = Rain;
})();
