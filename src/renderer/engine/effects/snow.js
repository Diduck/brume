// Brume — chute de neige.
// Chaque flocon a une profondeur z : les flocons lointains sont petits, lents et pâles
// (parallaxe) et passent « derrière » ; seuls les proches se posent sur les fenêtres.
(function () {
  'use strict';
  const B = window.Brume;
  const U = B.U;

  class Snow {
    constructor(engine) {
      this.e = engine;
      this.flakes = [];
      this.spawning = true;
    }

    place(f, initial) {
      const { W, H } = this.e.world;
      const drift = this.e.wind * 2;
      f.z = Math.random();
      f.size = 1.6 + f.z * f.z * 6.6;
      f.vy = 26 + f.z * 90;
      f.freq = U.rand(0.4, 1.3);
      f.phase = U.rand(0, Math.PI * 2);
      f.amp = U.rand(6, 22) * (0.4 + 0.6 * f.z);
      f.kx = 0;
      f.ky = 0;
      f.rot = U.rand(0, Math.PI * 2);
      f.spin = U.rand(-0.8, 0.8);
      f.variant = Math.random();
      f.vol = 0.55 + f.size * 0.12;
      f.x = U.rand(-0.1 * W - Math.max(0, drift), 1.1 * W - Math.min(0, drift));
      f.y = initial ? U.rand(-H * 0.9, -10) : U.rand(-60, -10);
      return f;
    }

    update(dt, t) {
      const e = this.e;
      const world = e.world;
      const { W, H } = world;
      const target = this.spawning ? e.count(700) : 0;
      const flakes = this.flakes;
      while (flakes.length < target) flakes.push(this.place({}, true));
      const land = e.settings.accumulate;
      const decay = Math.exp(-1.6 * dt);

      for (let i = flakes.length - 1; i >= 0; i--) {
        const f = flakes[i];
        f.kx *= decay;
        f.ky *= decay;
        e.cursorPush(f, 120, 1.0, dt);
        const vx = e.wind * (0.35 + 0.65 * f.z) + Math.sin(t * f.freq + f.phase) * f.amp + f.kx;
        const vy = f.vy + f.ky;
        const y0 = f.y;
        f.x += vx * dt;
        f.y += vy * dt;
        f.rot += f.spin * dt;

        let done = false;
        if (land && f.z > 0.45 && vy > 0) {
          const p = world.hit(f.x, y0, f.y);
          if (p) {
            p.add(f.x, f.vol);
            done = true;
          }
        }
        if (!done && (f.y > H + 20 || f.x < -0.3 * W || f.x > 1.3 * W)) done = true;
        if (done) {
          if (flakes.length > target) U.swapRemove(flakes, i);
          else this.place(f, false);
        }
      }
    }

    draw(e) {
      const order = e.settings.behind ? 1e4 : -1;
      for (const f of this.flakes) {
        e.push(0, f.x, f.y, f.size, f.size, f.rot, 0.45 + 0.55 * f.z, order, f.size > 5.5 ? f.variant : f.variant * 0.8);
      }
    }

    count() {
      return this.flakes.length;
    }
    isEmpty() {
      return this.flakes.length === 0;
    }
  }

  B.Snow = Snow;
})();
