// Brume — la neige posée et tout ce qu'on peut en faire.
//
// • Les tas fondent, s'éboulent et débordent au bout des fenêtres.
// • Un coup de curseur rapide projette la neige dans la direction du geste : elle
//   retombe (gravité) et s'accumule sur les fenêtres voisines.
// • Secouer / fermer une fenêtre fait s'envoler son tas avec la vitesse de la fenêtre.
// • Glisser doucement le curseur dans la neige roule une boule qui grossit en
//   ramassant la neige sur son passage. On peut l'attraper, la lâcher, la lancer,
//   et l'empiler sur une autre : 2 boules = un bonhomme, 3 = un bonhomme complet.
(function () {
  'use strict';
  const B = window.Brume;
  const U = B.U;
  const COL = B.COL;
  const GRAVITY = 1250;
  const COHESION = 450; // la neige « colle » un peu à son toit (px/s²)
  const LIFT = GRAVITY + COHESION; // accélération vers le bas au-delà de laquelle le toit se dérobe
  const SLIP = 0.55 * GRAVITY + COHESION; // frottement maximal neige/toit (μ ≈ 0,55)
  const MAX_BALLS = 14;
  const MAX_DEBRIS = 1600;
  const MAX_RADIUS = 42;

  class Snowpack {
    constructor(engine) {
      this.e = engine;
      this.debris = [];
      this.balls = [];
      this.sparkles = [];
      this.drag = null;
      this.rollTime = 0;
      this.t = 0;
    }

    meltRate() {
      const fx = this.e.effectName;
      if (fx === 'snow') return 0.0025;
      if (fx === 'rain' || fx === 'storm') return 0.6; // la pluie fait fondre la neige
      return 0.18;
    }

    update(dt, t) {
      this.t = t;
      const world = this.e.world;
      const melt = this.meltRate() * dt;
      for (const p of world.piles) {
        if (!p.active) continue;
        p.relax();
        p.melt(melt);
        if (p.spill[0] > 0.7) {
          this.spawnDebris(p.x0 - 1, p.y - 2, U.rand(-70, -20), U.rand(-30, 10), p.spill[0]);
          p.spill[0] = 0;
        }
        if (p.spill[1] > 0.7) {
          this.spawnDebris(p.x0 + p.width + 1, p.y - 2, U.rand(20, 70), U.rand(-30, 10), p.spill[1]);
          p.spill[1] = 0;
        }
      }
      this.sweep(dt);
      this.updateDebris(dt);
      this.updateBalls(dt);
      for (let i = this.sparkles.length - 1; i >= 0; i--) {
        const s = this.sparkles[i];
        s.vy += 300 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.life -= dt;
        if (s.life <= 0) U.swapRemove(this.sparkles, i);
      }
    }

    /* ---------- Paquets de neige en vol ---------- */

    spawnDebris(x, y, vx, vy, vol) {
      if (this.debris.length >= MAX_DEBRIS) return;
      this.debris.push({
        x, y, vx, vy, vol,
        size: U.clamp(2.2 + Math.sqrt(vol) * 2.2, 2.5, 9),
        rot: U.rand(0, 6.28), spin: U.rand(-4, 4), life: 8,
      });
    }

    updateDebris(dt) {
      const world = this.e.world;
      const land = this.e.settings.accumulate;
      const drag = Math.exp(-0.6 * dt);
      for (let i = this.debris.length - 1; i >= 0; i--) {
        const d = this.debris[i];
        d.vy += GRAVITY * dt;
        d.vx *= drag;
        const y0 = d.y;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.rot += d.spin * dt;
        d.life -= dt;
        if (land && d.vy > 0) {
          const p = world.hit(d.x, y0, d.y);
          if (p) {
            p.add(d.x, d.vol);
            U.swapRemove(this.debris, i);
            continue;
          }
        }
        if (d.life <= 0 || d.y > world.H + 30 || d.x < -150 || d.x > world.W + 150) U.swapRemove(this.debris, i);
      }
    }

    onEvent(ev) {
      if (ev.type === 'jolt') this.jolt(ev);
      else this.shed(ev);
    }

    // La fenêtre bouge : la neige obéit à l'inertie.
    //  • Accélération vers le bas plus forte que la gravité (on tire la fenêtre d'un
    //    coup vers le bas, ou on stoppe net une montée) : le toit se dérobe, la neige
    //    reste sur sa lancée puis retombe.
    //  • Accélération horizontale plus forte que le frottement : la neige ne suit pas
    //    toute la secousse, elle glisse vers l'arrière et tombe par le bout du toit.
    jolt(ev) {
      const p = ev.pile;
      const slipK = Math.abs(ev.ax) > SLIP ? U.clamp((Math.abs(ev.ax) - SLIP) / Math.abs(ev.ax), 0, 1) : 0;
      for (const b of this.balls) {
        if (b.state !== 'ground' || b.pile !== p) continue;
        if (ev.ay > LIFT + 250) this.launch(b, ev.vx0, ev.vy0);
        else if (slipK) {
          b.off -= ev.dx * slipK; // la boule roule vers l'arrière
          b.x = p.x0 + b.off;
          if (b.off < -b.r * 0.2 || b.off > p.width + b.r * 0.2) this.launch(b, ev.vx0, ev.vy0);
        }
      }
      if (!p.active) return;
      if (ev.ay > LIFT) this.lift(p, U.clamp((ev.ay - LIFT) / 3500, 0.08, 0.9), ev);
      if (slipK) this.slip(p, -ev.dx * slipK, ev);
    }

    // Groupe de colonnes par paquet, pour ne jamais dépasser MAX_DEBRIS.
    groupSize(p) {
      const room = Math.max(1, (MAX_DEBRIS - this.debris.length) / 2);
      return Math.max(2, Math.ceil(p.n / room));
    }

    lift(p, frac, ev) {
      const oldX0 = p.x0 - ev.dx;
      const oldY = p.y - ev.dy;
      const group = this.groupSize(p);
      let acc = 0;
      let top = 0;
      for (let i = 0; i < p.n; i++) {
        const take = p.h[i] * frac;
        p.h[i] -= take;
        acc += take;
        top = Math.max(top, p.h[i] + take);
        if ((i % group === group - 1 || i === p.n - 1) && acc > 0.05) {
          // La neige est restée là où était le toit, avec l'ancienne vitesse de la fenêtre.
          const x = oldX0 + (i + 1 - group / 2) * COL;
          this.spawnDebris(x, oldY - top * 0.6, ev.vx0 + U.rand(-25, 25), ev.vy0 + U.rand(-40, 10), acc);
          acc = 0;
          top = 0;
        }
      }
    }

    slip(p, shift, ev) {
      if (Math.abs(shift) < 0.25) return;
      const n = p.n;
      const h = p.h;
      const src = h.slice();
      const s = shift / COL;
      let before = 0;
      let after = 0;
      for (let i = 0; i < n; i++) before += src[i];
      for (let i = 0; i < n; i++) {
        const j = i - s;
        const j0 = Math.floor(j);
        const f = j - j0;
        const a = j0 >= 0 && j0 < n ? src[j0] : 0;
        const b = j0 + 1 >= 0 && j0 + 1 < n ? src[j0 + 1] : 0;
        h[i] = a * (1 - f) + b * f;
        after += h[i];
      }
      const lost = before - after;
      if (lost <= 0.05) return;
      // Ce qui a glissé hors du toit tombe, à l'endroit où la neige est restée.
      const left = shift < 0;
      const span = Math.abs(shift);
      const pieces = U.clamp(Math.round(lost / 1.5), 1, 14);
      for (let k = 0; k < pieces; k++) {
        const x = left ? p.x0 - U.rand(1, span + 1) : p.x0 + p.width + U.rand(1, span + 1);
        this.spawnDebris(x, p.y - U.rand(1, 8), ev.vx0 + U.rand(-30, 30), ev.vy0 + U.rand(-20, 20), lost / pieces);
      }
    }

    // Fenêtre fermée ou passée en plein écran : tout tombe.
    shed(ev) {
      const p = ev.pile;
      const vx = U.clamp(ev.vx, -2400, 2400);
      const vy = U.clamp(ev.vy, -2400, 2400);
      const threshold = Math.max(1.2, (p.sum * ev.frac) / 250);
      let acc = 0;
      for (let i = 0; i < p.n; i++) {
        const take = p.h[i] * ev.frac;
        p.h[i] -= take;
        acc += take;
        if (acc >= threshold || (i === p.n - 1 && acc > 0.05)) {
          this.spawnDebris(p.x0 + i * COL, p.y - p.h[i] - 3, vx * U.rand(0.7, 1.05) + U.rand(-50, 50), vy * U.rand(0.7, 1) - U.rand(20, 140), acc);
          acc = 0;
        }
      }
      p.active = true;
      for (const b of this.balls) {
        if (b.state === 'ground' && b.pile === p && (ev.closed || ev.frac > 0.25)) this.launch(b, vx * 0.9, vy * 0.9 - 120);
      }
    }

    /* ---------- Le curseur dans la neige ---------- */

    sweep(dt) {
      const e = this.e;
      const c = e.cursor;
      if (!c.active || this.drag || c.speed < 50) {
        this.rollTime = 0;
        return;
      }
      const p = e.world.pileAt(c.x, c.y, 6);
      if (!p || !p.active) {
        this.rollTime = 0;
        return;
      }
      if (this.ballNear(p, c.x, c.y)) return; // on pousse une boule : géré dans updateBalls

      const horizontal = Math.abs(c.vx) > Math.abs(c.vy) * 0.9;
      if (e.settings.snowballs && c.speed < 950 && horizontal && p.heightAt(c.x) > 2.2) {
        this.rollTime += dt;
        if (this.rollTime > 0.12) {
          this.createBall(p, c.x);
          this.rollTime = 0;
        }
        return;
      }
      this.rollTime = 0;

      // Geste rapide : on balaie, et la neige part dans la direction du curseur.
      const R = 28;
      const strength = U.clamp(c.speed / 700, 0.4, 3);
      const i0 = Math.max(0, p.index(c.x - R));
      const i1 = Math.min(p.n - 1, p.index(c.x + R));
      let acc = 0;
      for (let i = i0; i <= i1; i++) {
        const f = 1 - Math.abs(p.x0 + (i + 0.5) * COL - c.x) / R;
        if (f <= 0) continue;
        const take = Math.min(p.h[i], 160 * strength * f * dt);
        p.h[i] -= take;
        acc += take;
      }
      if (acc > 0.05) {
        const n = Math.min(10, Math.ceil(acc / 0.8));
        for (let k = 0; k < n; k++) {
          this.spawnDebris(
            c.x + U.rand(-R * 0.6, R * 0.6),
            p.topAt(c.x) - U.rand(2, 8),
            c.vx * U.rand(0.45, 0.9) + U.rand(-40, 40),
            Math.min(c.vy * U.rand(0.3, 0.6), 200) - U.rand(120, 300),
            acc / n
          );
        }
      }
    }

    /* ---------- Boules de neige ---------- */

    createBall(p, x) {
      if (this.balls.length >= MAX_BALLS) {
        const old = this.balls.find((b) => !b.above && !b.base && b.state !== 'held');
        if (!old) return;
        this.removeBall(old);
      }
      const b = {
        x, y: p.y - 6, r: 5, vx: this.e.cursor.vx * 0.5, vy: 0, rot: 0,
        state: 'ground', pile: p, off: x - p.x0, base: null, above: null,
        seed: Math.random(), facing: Math.random() < 0.5 ? -1 : 1, celebrated: 0, thrown: false,
      };
      this.gather(b, x - 6, x + 6, 0.8);
      this.balls.push(b);
    }

    // La boule ramasse une partie de la neige entre xa et xb et grossit d'autant.
    gather(b, xa, xb, frac) {
      const p = b.pile;
      const i0 = Math.max(0, p.index(Math.min(xa, xb)));
      const i1 = Math.min(p.n - 1, p.index(Math.max(xa, xb)));
      let got = 0;
      for (let i = i0; i <= i1; i++) {
        const take = p.h[i] * frac;
        p.h[i] -= take;
        got += take;
      }
      if (got > 0) b.r = Math.min(MAX_RADIUS, Math.sqrt(b.r * b.r + got * 1.8));
    }

    ballNear(p, x, y) {
      for (const b of this.balls) {
        if (b.state === 'ground' && b.pile === p && Math.abs(b.x - x) < b.r + 22 && Math.abs(b.y - y) < b.r + 14) return b;
      }
      return null;
    }

    // La boule (ou la pile de boules) repose-t-elle sur une fenêtre cachée ?
    hidden(b) {
      let o = b;
      while (o.base) o = o.base;
      return o.state === 'ground' && !!o.pile.hidden;
    }

    orderOf(b) {
      if (b.state === 'ground') return b.pile.order;
      if (b.state === 'stacked' && b.base) return this.orderOf(b.base);
      return -1;
    }

    depth(b) {
      let n = 1;
      for (let o = b.base; o; o = o.base) n++;
      return n;
    }

    // Boule sous le curseur (la plus haute d'une pile), si aucune fenêtre ne la cache.
    ballAt(x, y) {
      let best = null;
      for (const b of this.balls) {
        if (b.state === 'held') continue;
        const dx = x - b.x;
        const dy = y - b.y;
        if (dx * dx + dy * dy > (b.r + 3) * (b.r + 3)) continue;
        if (this.e.world.covered(x, y, this.orderOf(b))) continue;
        if (!best || b.y < best.y) best = b;
      }
      return best;
    }

    // Détache une boule (et fait tomber celles qui sont posées dessus).
    launch(b, vx, vy) {
      if (b.above) {
        const top = b.above;
        b.above = null;
        top.base = null;
        this.launch(top, vx * U.rand(0.8, 1.1), vy - U.rand(40, 120));
      }
      if (b.base) {
        b.base.above = null;
        b.base = null;
      }
      b.state = 'air';
      b.pile = null;
      b.vx = vx;
      b.vy = vy;
    }

    removeBall(b) {
      if (b.above) this.launch(b.above, 0, 0);
      if (b.base) b.base.above = null;
      const i = this.balls.indexOf(b);
      if (i >= 0) this.balls.splice(i, 1);
      if (this.drag === b) this.drag = null;
    }

    // Boule qui arrive trop vite : elle éclate en paquets de neige.
    splat(b) {
      const vol = (b.r * b.r) / 1.8;
      const n = U.clamp(Math.round(b.r / 2), 6, 16);
      for (let k = 0; k < n; k++) {
        const a = U.rand(Math.PI, Math.PI * 2);
        this.spawnDebris(b.x, b.y, Math.cos(a) * U.rand(80, 320), Math.sin(a) * U.rand(80, 300), vol / n);
      }
      if (b.thrown) this.e.ui.toast(window.BRUME_STRINGS.toasts.splat);
      this.removeBall(b);
    }

    grab(b) {
      this.launch(b, 0, 0);
      b.state = 'held';
      b.thrown = false;
      this.drag = b;
    }

    release() {
      const b = this.drag;
      if (!b) return;
      const c = this.e.cursor;
      b.state = 'air';
      b.vx = U.clamp(c.vx, -2600, 2600);
      b.vy = U.clamp(c.vy, -2600, 2600);
      b.thrown = c.speed > 900;
      this.drag = null;
    }

    stackTarget(b, y0) {
      for (const o of this.balls) {
        if (o === b || o.above || (o.state !== 'ground' && o.state !== 'stacked')) continue;
        if (this.depth(o) >= 3) continue;
        const top = o.y - o.r;
        if (Math.abs(b.x - o.x) < o.r * 0.85 + b.r * 0.3 && y0 + b.r <= top + 6 && b.y + b.r >= top) return o;
      }
      return null;
    }

    stack(b, o) {
      b.state = 'stacked';
      b.base = o;
      b.pile = null;
      o.above = b;
      b.dx = U.clamp(b.x - o.x, -o.r * 0.15, o.r * 0.15);
      b.vx = 0;
      b.vy = 0;
      let bottom = b;
      while (bottom.base) bottom = bottom.base;
      const height = this.depth(b);
      if (height > bottom.celebrated) {
        bottom.celebrated = height;
        const S = window.BRUME_STRINGS;
        this.e.ui.toast(height >= 3 ? S.toasts.snowman3 : S.toasts.snowman2);
        for (let k = 0; k < 24; k++) {
          const life = U.rand(0.6, 1.3);
          this.sparkles.push({ x: b.x, y: b.y - b.r, vx: U.rand(-160, 160), vy: -U.rand(60, 260), life, max: life, variant: U.rand(0.5, 0.999) });
        }
      }
    }

    updateBalls(dt) {
      const e = this.e;
      const c = e.cursor;
      const world = e.world;
      const melting = e.effectName !== 'snow';
      const meltRate = e.effectName === 'rain' || e.effectName === 'storm' ? 2.2 : 0.5;

      for (let i = this.balls.length - 1; i >= 0; i--) {
        const b = this.balls[i];
        if (!this.balls.includes(b) || this.hidden(b)) continue;
        if (melting && b.state !== 'held') {
          b.r -= meltRate * dt;
          if (b.r < 3) {
            this.removeBall(b);
            continue;
          }
        }

        if (b.state === 'held') {
          const k = Math.min(1, dt * 25);
          b.x = U.lerp(b.x, c.x, k);
          b.y = U.lerp(b.y, c.y, k);
          continue;
        }

        if (b.state === 'stacked') {
          const base = b.base;
          if (!base || !this.balls.includes(base)) {
            this.launch(b, 0, 0);
            continue;
          }
          b.x = base.x + b.dx;
          b.y = base.y - base.r * 0.78 - b.r * 0.82;
          continue;
        }

        if (b.state === 'ground') {
          const p = b.pile;
          if (!b.above && c.active && !this.drag && c.speed > 30 && Math.abs(c.y - b.y) < b.r + 12 && Math.abs(c.x - b.x) < b.r + 22) {
            // Le curseur roule la boule : elle suit sa vitesse, plus un ressort vers lui.
            const want = c.vx + (c.x - b.x) * 6;
            b.vx = U.lerp(b.vx, want, Math.min(1, dt * 20));
          }
          b.vx *= Math.exp(-2.4 * dt);
          if (b.above) b.vx = 0; // la base d'un bonhomme ne roule pas
          const oldX = b.x;
          b.off += b.vx * dt;
          b.x = p.x0 + b.off;
          if (Math.abs(b.x - oldX) > 0.05 && e.effectName === 'snow') this.gather(b, oldX, b.x, 0.55);
          b.rot += (b.x - oldX) / b.r;
          b.y = p.y - p.heightAt(b.x) * 0.55 - b.r * 0.94;
          if (b.off < -b.r * 0.2 || b.off > p.width + b.r * 0.2) this.launch(b, b.vx, 0); // bord de la fenêtre
          continue;
        }

        // En l'air.
        b.vy += 1500 * dt;
        b.vx *= Math.exp(-0.25 * dt);
        const y0 = b.y;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.rot += (b.vx * dt) / b.r;
        if (b.vy > 0) {
          const o = this.stackTarget(b, y0);
          if (o) {
            if (b.r > o.r * 1.12) this.splat(o); // trop lourde : elle écrase celle du dessous
            else {
              this.stack(b, o);
              continue;
            }
          }
          const p = world.hit(b.x, y0 + b.r, b.y + b.r);
          if (p) {
            if (b.vy > 1150 && b.r < 26) {
              this.splat(b);
              continue;
            }
            b.state = 'ground';
            b.pile = p;
            b.off = b.x - p.x0;
            b.vx *= 0.5;
            b.vy = 0;
            continue;
          }
        }
        if (b.y - b.r > world.H + 40 || b.x < -300 || b.x > world.W + 300) this.removeBall(b);
      }
    }

    /* ---------- Dessin ---------- */

    draw(e) {
      const behind = e.settings.behind ? 1e4 : -1;
      for (const d of this.debris) e.push(0, d.x, d.y, d.size, d.size, d.rot, 0.95, behind, 0.3);
      for (const b of this.balls) {
        if (!this.hidden(b)) e.push(9, b.x, b.y, b.r * 2, b.r * 2, b.rot, 1, this.orderOf(b), 0);
      }
      for (const b of this.balls) {
        if (b.state !== 'ground' || !b.above || this.hidden(b)) continue;
        const chain = [b];
        while (chain[chain.length - 1].above) chain.push(chain[chain.length - 1].above);
        this.decorate(e, chain);
      }
      for (const s of this.sparkles) e.push(4, s.x, s.y, 10, 10, 0, s.life / s.max, -1, s.variant);
    }

    decorate(e, chain) {
      const order = this.orderOf(chain[0]);
      const head = chain[chain.length - 1];
      const body = chain[chain.length - 2];
      const f = chain[0].facing;
      const r = head.r;
      const t = this.t;

      // Yeux, nez en carotte, sourire en charbon.
      e.push(13, head.x - r * 0.3 + f * r * 0.12, head.y - r * 0.22, r * 0.22, r * 0.22, 0, 1, order, 0);
      e.push(13, head.x + r * 0.3 + f * r * 0.12, head.y - r * 0.22, r * 0.22, r * 0.22, 0, 1, order, 0);
      const nose = r * 0.95;
      e.push(10, head.x + f * (r * 0.12 + nose * 0.5), head.y + r * 0.02, nose, r * 0.3, f > 0 ? 0 : Math.PI, 1, order, 0);
      for (let k = 0; k < 5; k++) {
        const a = Math.PI * (0.25 + 0.125 * k);
        e.push(13, head.x + f * r * 0.08 + Math.cos(a) * r * 0.48, head.y + r * 0.05 + Math.sin(a) * r * 0.38, r * 0.11, r * 0.11, 0, 1, order, 0);
      }

      // Bras en branches (qui saluent doucement) et boutons.
      const R = body.r;
      const wave = Math.sin(t * 2 + chain[0].seed * 10) * 0.12;
      e.push(11, body.x - R * 1.25, body.y - R * 0.25, R * 1.5, R * 0.65, Math.PI + 0.45 + wave, 1, order, 0);
      e.push(11, body.x + R * 1.25, body.y - R * 0.25, R * 1.5, R * 0.65, -0.45 - wave, 1, order, 0);
      for (let k = 0; k < 3; k++) e.push(13, body.x, body.y - R * 0.42 + k * R * 0.42, R * 0.16, R * 0.16, 0, 1, order, 0);

      // Chapeau ou écharpe, selon le bonhomme.
      if (chain[0].seed < 0.5) e.push(12, head.x, head.y - r * 1.1, r * 1.6, r * 1.4, 0.15 * f, 1, order, 0);
      else e.push(14, head.x, head.y + r * 0.85, r * 2.1, r * 0.8, 0, 1, order, 0);
    }

    isEmpty() {
      return !this.debris.length && !this.balls.some((b) => !this.hidden(b)) && !this.sparkles.length && this.e.world.isEmpty();
    }

    meltAll() {
      this.debris.length = 0;
      this.balls.length = 0;
      this.drag = null;
      this.e.world.meltAll();
    }
  }

  B.Snowpack = Snowpack;
})();
