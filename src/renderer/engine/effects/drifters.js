// Brume — ce qui virevolte : pétales de sakura et feuilles d'automne.
// Ils tournoient en 3D (la largeur suit le cosinus d'un angle de bascule), se posent
// à plat sur les fenêtres, s'empilent, suivent la fenêtre, et on peut shooter dedans.
(function () {
  'use strict';
  const B = window.Brume;
  const U = B.U;

  const CONFIG = {
    sakura: { base: 90, shape: 2, size: [9, 15], fall: [26, 52], amp: [18, 42], flip: [1.2, 3.2], spin: [-1.4, 1.4], life: [16, 34], stack: 0.45, cap: 260, len: 1 },
    leaves: { base: 55, shape: 3, size: [14, 24], fall: [40, 78], amp: [26, 60], flip: [1.6, 4.2], spin: [-2.2, 2.2], life: [26, 60], stack: 1.9, cap: 220, len: 1.2 },
  };

  class Drifters {
    constructor(engine, kind) {
      this.e = engine;
      this.cfg = CONFIG[kind];
      this.items = [];
      this.spawning = true;
      this.flying = 0;
    }

    place(it, initial) {
      const c = this.cfg;
      const { W, H } = this.e.world;
      it.state = 'fly';
      it.z = Math.random();
      it.size = U.rand(c.size[0], c.size[1]) * (0.6 + 0.4 * it.z);
      it.fall = U.rand(c.fall[0], c.fall[1]) * (0.6 + 0.4 * it.z);
      it.amp = U.rand(c.amp[0], c.amp[1]);
      it.freq = U.rand(0.5, 1.2);
      it.phase = U.rand(0, Math.PI * 2);
      it.flip = U.rand(0, Math.PI * 2);
      it.flipSpeed = U.rand(c.flip[0], c.flip[1]);
      it.rot = U.rand(0, Math.PI * 2);
      it.spin = U.rand(c.spin[0], c.spin[1]);
      it.kx = 0;
      it.ky = 0;
      it.variant = Math.random();
      it.alpha = 1;
      it.pile = null;
      it.x = U.rand(-0.1 * W, 1.1 * W) - this.e.wind;
      it.y = initial ? U.rand(-H, -10) : U.rand(-60, -15);
      return it;
    }

    update(dt, t) {
      const e = this.e;
      const c = this.cfg;
      const world = e.world;
      const { W, H } = world;
      const cur = e.cursor;
      const target = this.spawning ? e.count(c.base) : 0;
      const items = this.items;
      let flying = 0;
      for (const it of items) if (it.state === 'fly') flying++;
      while (flying < target) {
        items.push(this.place({}, true));
        flying++;
      }
      const decay = Math.exp(-1.6 * dt);
      let resting = 0;

      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.state === 'rest') {
          resting++;
          const p = it.pile;
          if (p.hidden) continue; // sur une fenêtre d'un autre bureau : en attente
          it.x = p.x0 + it.off;
          it.y = p.y - p.heightAt(it.x) - it.stackH - it.size * 0.15;
          it.life -= dt;
          if (it.life < 2) it.alpha = Math.max(0, it.life / 2);
          if (it.life <= 0) {
            p.addDebris(it.x, -c.stack, 2);
            U.swapRemove(items, i);
            continue;
          }
          if (cur.active && cur.speed > 160) {
            const dx = it.x - cur.x;
            const dy = it.y - cur.y;
            const r = it.size + 22;
            if (dx * dx + dy * dy < r * r) this.kick(it, cur);
          }
          continue;
        }

        it.kx *= decay;
        it.ky *= decay;
        e.cursorPush(it, 130, 1.3, dt);
        const vx = e.wind * 0.9 + Math.sin(t * it.freq + it.phase) * it.amp + it.kx;
        const vy = it.fall + Math.cos(t * it.freq * 1.7 + it.phase) * it.amp * 0.22 + it.ky;
        const y0 = it.y;
        it.x += vx * dt;
        it.y += vy * dt;
        it.flip += it.flipSpeed * dt;
        it.rot += it.spin * dt;
        if (e.settings.accumulate && it.z > 0.3 && vy > 0) {
          const p = world.hit(it.x, y0, it.y);
          if (p) {
            this.rest(it, p);
            continue;
          }
        }
        if (it.y > H + 30 || it.x < -0.3 * W || it.x > 1.3 * W) {
          if (flying > target) {
            U.swapRemove(items, i);
            flying--;
          } else this.place(it, false);
        }
      }

      // Trop de choses posées : les plus anciennes s'effacent doucement.
      if (resting > c.cap) {
        let extra = resting - c.cap;
        for (const it of items) {
          if (extra <= 0) break;
          if (it.state === 'rest' && it.life > 2) {
            it.life = 2;
            extra--;
          }
        }
      }
    }

    rest(it, p) {
      it.state = 'rest';
      it.pile = p;
      it.off = it.x - p.x0;
      it.stackH = p.debrisAt(it.x);
      p.addDebris(it.x, this.cfg.stack, 2);
      it.life = U.rand(this.cfg.life[0], this.cfg.life[1]);
      it.restRot = (Math.random() < 0.5 ? 1 : -1) * Math.PI * 0.5 + U.rand(-0.35, 0.35);
      it.alpha = 1;
    }

    // Coup de pied dans le tas !
    kick(it, cur) {
      if (it.pile) it.pile.addDebris(it.x, -this.cfg.stack, 2);
      it.state = 'fly';
      it.pile = null;
      it.z = 0.8;
      it.kx = cur.vx * U.rand(0.35, 0.7) + U.rand(-60, 60);
      it.ky = -U.rand(160, 340) + Math.min(0, cur.vy * 0.3);
      it.spin = U.rand(-8, 8);
      it.flipSpeed *= 2.5;
      it.y -= 4;
    }

    // Pétales et feuilles sont légers : une petite secousse suffit à les faire décoller.
    onEvent(ev) {
      const jolt = ev.type === 'jolt';
      if (jolt && ev.ay < 700 && Math.abs(ev.ax) < 650) return;
      const vx = jolt ? ev.vx0 : ev.vx;
      const vy = jolt ? ev.vy0 : ev.vy;
      for (const it of this.items) {
        if (it.state !== 'rest' || it.pile !== ev.pile) continue;
        if (jolt && Math.random() < 0.35) continue; // quelques-uns s'accrochent
        it.pile.addDebris(it.x, -this.cfg.stack, 2);
        it.state = 'fly';
        it.pile = null;
        it.kx = U.clamp(vx, -2000, 2000) * U.rand(0.7, 1) + U.rand(-40, 40);
        it.ky = U.clamp(vy, -2000, 2000) * U.rand(0.7, 1) - U.rand(30, 140);
        it.z = 0.8;
      }
    }

    draw(e) {
      const c = this.cfg;
      const behind = e.settings.behind ? 1e4 : -1;
      for (const it of this.items) {
        if (it.state === 'rest') {
          if (it.pile.hidden) continue;
          // Posé à plat : vu en perspective, il est écrasé verticalement.
          e.push(c.shape, it.x, it.y, it.size * 0.55, it.size * c.len, it.restRot, it.alpha, it.pile.order, it.variant);
        } else {
          const w = it.size * Math.max(0.15, Math.abs(Math.cos(it.flip)));
          e.push(c.shape, it.x, it.y, w, it.size * c.len, it.rot, (0.55 + 0.45 * it.z) * it.alpha, behind, it.variant);
        }
      }
    }

    isEmpty() {
      return this.items.length === 0;
    }
  }

  B.Drifters = Drifters;
})();
