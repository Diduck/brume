// Brume — ce qui brille : lucioles, étoiles filantes et aurore boréale.
(function () {
  'use strict';
  const B = window.Brume;
  const U = B.U;

  /* ---------- Lucioles ----------
   * Chaque luciole est reliée par un ressort amorti à une cible qui erre lentement.
   * Curseur immobile plus d'une seconde : la cible devient une orbite autour de lui.
   * Curseur rapide : elles s'enfuient. */
  class Fireflies {
    constructor(engine) {
      this.e = engine;
      this.flies = [];
      this.spawning = true;
      this.t = 0;
    }

    make() {
      const { W, H } = this.e.world;
      const hx = U.rand(0.03 * W, 0.97 * W);
      const hy = U.rand(0.3 * H, 0.95 * H);
      return {
        hx, hy, x: hx, y: hy, vx: 0, vy: 0,
        ax: U.rand(40, 140), ay: U.rand(20, 70),
        f1: U.rand(0.05, 0.18), f2: U.rand(0.2, 0.5), f3: U.rand(0.08, 0.25),
        p1: U.rand(0, 6.28), p2: U.rand(0, 6.28), p3: U.rand(0, 6.28),
        blink: U.rand(0.6, 1.6), bp: U.rand(0, 6.28), size: U.rand(14, 24),
        orbitR: U.rand(25, 85), orbitS: U.rand(0.6, 1.6) * (Math.random() < 0.5 ? -1 : 1),
        life: 0, dying: false,
      };
    }

    update(dt, t) {
      this.t = t;
      const e = this.e;
      const c = e.cursor;
      const target = this.spawning ? Math.min(140, e.count(42)) : 0;
      let alive = 0;
      for (const f of this.flies) if (!f.dying) alive++;
      while (alive < target) {
        this.flies.push(this.make());
        alive++;
      }
      for (const f of this.flies) {
        if (alive > target && !f.dying) {
          f.dying = true;
          alive--;
        }
      }
      const still = c.active && c.stillFor > 1.1;
      const TAU = Math.PI * 2;
      for (let i = this.flies.length - 1; i >= 0; i--) {
        const f = this.flies[i];
        let tx = f.hx + Math.sin(t * f.f1 * TAU + f.p1) * f.ax + Math.sin(t * f.f2 * TAU + f.p2) * f.ax * 0.35;
        let ty = f.hy + Math.sin(t * f.f3 * TAU + f.p3) * f.ay;
        let k = 1.2;
        if (still && Math.hypot(f.x - c.x, f.y - c.y) < 560) {
          const a = t * f.orbitS + f.p1;
          tx = c.x + Math.cos(a) * f.orbitR;
          ty = c.y + Math.sin(a) * f.orbitR * 0.75;
          k = 2.6;
        }
        if (c.active && c.speed > 650) {
          const dx = f.x - c.x;
          const dy = f.y - c.y;
          const d = Math.hypot(dx, dy);
          if (d < 240) {
            f.vx += (dx / (d + 1)) * 1800 * dt;
            f.vy += (dy / (d + 1)) * 1800 * dt;
          }
        }
        f.vx += ((tx - f.x) * k - f.vx * 1.7) * dt;
        f.vy += ((ty - f.y) * k - f.vy * 1.7) * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.life = f.dying ? f.life - dt * 0.8 : Math.min(1, f.life + dt * 0.6);
        if (f.dying && f.life <= 0) U.swapRemove(this.flies, i);
      }
    }

    draw(e) {
      const order = e.settings.behind ? 1e4 : -1;
      for (const f of this.flies) {
        const b = 0.5 + 0.5 * Math.sin(this.t * f.blink * 2 + f.bp);
        e.push(4, f.x, f.y, f.size, f.size, 0, (0.18 + 0.82 * b * b * b) * f.life, order, 0.2);
      }
    }

    isEmpty() {
      return this.flies.length === 0;
    }
  }

  /* ---------- Étoiles filantes ----------
   * Un ciel étoilé reste derrière les fenêtres ; les étoiles filantes passent devant
   * et éclatent en étincelles quand elles touchent le haut d'une fenêtre. */
  class Starfall {
    constructor(engine) {
      this.e = engine;
      this.spawning = true;
      this.meteors = [];
      this.sparks = [];
      this.next = 0.6;
      this.sky = 0;
      this.t = 0;
      const { W, H } = engine.world;
      this.stars = Array.from({ length: Math.round(Math.min(260, (W * H) / 16000)) }, () => ({
        x: U.rand(0, W), y: U.rand(0, H * 0.62) * Math.random() + U.rand(0, 20),
        size: U.rand(4, 9), base: U.rand(0.35, 1), rate: U.rand(0.6, 2.5), p: U.rand(0, 6.28),
      }));
    }

    update(dt, t) {
      this.t = t;
      const e = this.e;
      const world = e.world;
      const { W, H } = world;
      this.sky = U.clamp(this.sky + (this.spawning ? dt : -dt) * 0.5, 0, 1);
      if (this.spawning) {
        this.next -= dt * e.intensityMult();
        if (this.next <= 0) {
          this.launch();
          this.next = U.rand(0.5, 2.4);
        }
      }
      for (let i = this.meteors.length - 1; i >= 0; i--) {
        const m = this.meteors[i];
        const y0 = m.y;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        m.age += dt;
        if (m.front) {
          const p = world.hit(m.x, y0, m.y);
          if (p) {
            this.burst(m.x, p.topAt(m.x));
            U.swapRemove(this.meteors, i);
            continue;
          }
        }
        if (m.y > H + 300 || m.x < -400 || m.x > W + 400) U.swapRemove(this.meteors, i);
      }
      for (let i = this.sparks.length - 1; i >= 0; i--) {
        const s = this.sparks[i];
        s.vy += 700 * dt;
        s.vx *= Math.exp(-1.2 * dt);
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.life -= dt;
        if (s.life <= 0) U.swapRemove(this.sparks, i);
      }
    }

    launch() {
      const { W, H } = this.e.world;
      const side = Math.random() < 0.5 ? 1 : -1;
      const angle = U.rand(0.31, 0.73);
      const speed = U.rand(750, 1350);
      this.meteors.push({
        x: side > 0 ? U.rand(-0.1 * W, 0.7 * W) : U.rand(0.3 * W, 1.1 * W),
        y: U.rand(-0.05 * H, 0.3 * H),
        vx: side * Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        speed,
        len: U.rand(120, 280),
        age: 0,
        front: Math.random() < 0.75,
      });
    }

    burst(x, y) {
      const n = (22 + Math.random() * 12) | 0;
      for (let k = 0; k < n && this.sparks.length < 900; k++) {
        const life = U.rand(0.5, 1.2);
        this.sparks.push({ x, y, vx: U.rand(-320, 320), vy: -U.rand(80, 420), life, max: life, size: U.rand(6, 12), variant: U.rand(0.5, 0.999) });
      }
    }

    draw(e) {
      const t = this.t;
      for (const s of this.stars) {
        const a = s.base * (0.55 + 0.45 * Math.sin(t * s.rate + s.p)) * this.sky;
        if (a > 0.01) e.push(8, s.x, s.y, s.size, s.size, 0, a, 1e4, 0);
      }
      const order = e.settings.behind ? 1e4 : -1;
      for (const m of this.meteors) {
        const len = Math.min(m.len, m.age * m.speed * 0.6);
        const ux = m.vx / m.speed;
        const uy = m.vy / m.speed;
        e.push(5, m.x - (ux * len) / 2, m.y - (uy * len) / 2, 3.2, len, Math.atan2(-ux, uy), 1, order, 0);
        e.push(4, m.x, m.y, 12, 12, 0, 1, order, 0.7);
      }
      for (const s of this.sparks) e.push(4, s.x, s.y, s.size, s.size, 0, s.life / s.max, -1, s.variant);
    }

    isEmpty() {
      return this.sky <= 0 && this.meteors.length === 0 && this.sparks.length === 0;
    }
  }

  /* ---------- Aurore boréale ---------- (le dessin est dans le shader auroraFS) */
  class Aurora {
    constructor(engine) {
      this.e = engine;
      this.level = 0;
    }
    update(dt) {
      const want = this.e.settings.aurora ? 1 : 0;
      this.level += (want - this.level) * Math.min(1, dt * 0.8);
      if (Math.abs(this.level - want) < 0.002) this.level = want;
    }
    visible() {
      return this.level > 0.002;
    }
  }

  B.Fireflies = Fireflies;
  B.Starfall = Starfall;
  B.Aurora = Aurora;
})();
