// Brume — le chef d'orchestre : boucle d'animation, vent, curseur, effets, rendu,
// qualité adaptative et mise en veille quand il n'y a plus rien à afficher.
(function () {
  'use strict';
  const B = window.Brume;
  const U = B.U;

  // Ordre de dessin (du fond vers l'avant) et formes dessinées en mode « lumière ».
  const DRAW_ORDER = [8, 6, 7, 1, 2, 3, 0, 9, 11, 14, 13, 10, 12, 4, 5];
  const ADDITIVE = new Set([4, 5, 8]);
  const INTENSITY = { light: 0.5, normal: 1, heavy: 2 };

  class Engine {
    constructor(canvas, ui) {
      this.ui = ui;
      this.r = new B.Renderer(canvas);
      this.world = new B.World();
      this.snowpack = new B.Snowpack(this);
      this.aurora = new B.Aurora(this);
      this.effects = [];
      this.effectName = 'none';
      this.settings = { effect: 'none', intensity: 'normal', wind: 0, accumulate: true, snowballs: true, behind: false, aurora: false, stats: false };
      this.batches = {};
      for (const shape of DRAW_ORDER) this.batches[shape] = new B.SpriteBatch(512);
      this.cursor = { x: -1e5, y: -1e5, vx: 0, vy: 0, speed: 0, active: false, t: 0, lastMove: 0, stillFor: 0 };
      this.wind = 0;
      this.quality = 1;
      this.slowFor = 0;
      this.fastFor = 0;
      this.frameMs = 16;
      this.workMs = 1;
      this.interactive = false;
      this.cursorStyle = '';
      this.idle = null;
      this.idleSince = 0;
      this.running = false;
      this.last = 0;
      this.statsAt = 0;
      this.frame = this.frame.bind(this);
    }

    /* ---------- Entrées venant du processus principal ---------- */

    setDisplay(d) {
      this.display = d;
      this.resize();
    }

    resize() {
      const W = window.innerWidth;
      const H = window.innerHeight;
      this.r.resize(W, H, window.devicePixelRatio || 1);
      const d = this.display || { workTop: 0, groundY: H };
      const groundY = Math.min(H, d.groundY);
      this.world.setDisplay(W, H, d.workTop, groundY);
      this.r.setBand(d.workTop, groundY + 2);
    }

    setSettings(s) {
      this.settings = s;
      this.wake();
      if (s.effect !== this.effectName) this.switchEffect(s.effect);
      if (!s.snowballs && this.snowpack.drag) this.snowpack.release();
    }

    switchEffect(name) {
      // L'ancien effet arrête d'en créer et se termine naturellement (fondu doux).
      for (const fx of this.effects) fx.spawning = false;
      const make = {
        snow: () => new B.Snow(this),
        rain: () => new B.Rain(this, false),
        storm: () => new B.Rain(this, true),
        sakura: () => new B.Drifters(this, 'sakura'),
        leaves: () => new B.Drifters(this, 'leaves'),
        fireflies: () => new B.Fireflies(this),
        starfall: () => new B.Starfall(this),
      }[name];
      if (make) this.effects.push(make());
      this.effectName = name;
      this.wake();
    }

    setWindows(list, closed) {
      this.world.updateWindows(list, performance.now(), closed);
    }

    setCursor(m) {
      const now = performance.now();
      const c = this.cursor;
      if (c.active && m.inside) {
        const dt = Math.max(0.008, (now - c.t) / 1000);
        c.vx = U.lerp(c.vx, U.clamp((m.x - c.x) / dt, -6000, 6000), 0.55);
        c.vy = U.lerp(c.vy, U.clamp((m.y - c.y) / dt, -6000, 6000), 0.55);
      } else {
        c.vx = 0;
        c.vy = 0;
      }
      c.x = m.x;
      c.y = m.y;
      c.t = now;
      c.lastMove = now;
      c.active = m.inside;
    }

    meltAll() {
      this.snowpack.meltAll();
      for (const fx of this.effects) if (fx.items) fx.items = fx.items.filter((it) => it.state !== 'rest');
    }

    /* ---------- Services offerts aux effets ---------- */

    intensityMult() {
      return INTENSITY[this.settings.intensity] || 1;
    }

    // Nombre de particules : intensité × surface de l'écran × qualité adaptative.
    count(base) {
      const { W, H } = this.world;
      const area = U.clamp((W * H) / (1440 * 900), 0.5, 3);
      return Math.round(base * this.intensityMult() * area * this.quality);
    }

    // Le mouvement du curseur entraîne l'air autour de lui.
    cursorPush(p, radius, strength, dt) {
      const c = this.cursor;
      if (!c.active || c.speed < 40) return;
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > radius * radius) return;
      const f = 1 - Math.sqrt(d2) / radius;
      const k = Math.min(1, f * f * strength * dt * 7);
      p.kx += (c.vx * 0.9 - p.kx) * k;
      p.ky += (c.vy * 0.9 - p.ky) * k;
    }

    push(shape, x, y, w, h, rot, alpha, order, variant) {
      this.batches[shape].push(x, y, w, h, rot, alpha, order, variant);
    }

    /* ---------- Souris : attraper et lancer les boules ---------- */

    pointerDown() {
      const c = this.cursor;
      const b = this.settings.snowballs && this.snowpack.ballAt(c.x, c.y);
      if (b) this.snowpack.grab(b);
    }

    pointerUp() {
      this.snowpack.release();
    }

    updateInteraction() {
      const c = this.cursor;
      let want = false;
      let style = '';
      if (c.active && this.ui.hitTest(c.x, c.y)) want = true;
      else if (this.snowpack.drag) {
        want = true;
        style = 'grabbing';
      } else if (c.active && this.settings.snowballs && this.snowpack.ballAt(c.x, c.y)) {
        want = true;
        style = 'grab';
      }
      // La fenêtre ne capte la souris que sur une boule ou sur la carte ; partout
      // ailleurs, les clics traversent vers tes applications.
      if (want !== this.interactive) {
        this.interactive = want;
        window.brume.setInteractive(want);
      }
      if (style !== this.cursorStyle) {
        this.cursorStyle = style;
        document.body.style.cursor = style;
      }
    }

    /* ---------- Boucle ---------- */

    start() {
      if (this.running) return;
      this.running = true;
      this.last = 0;
      requestAnimationFrame(this.frame);
    }

    stop() {
      this.running = false;
    }

    wake() {
      this.idleSince = 0;
      if (this.idle) {
        this.idle = false;
        window.brume.setIdle(false);
      }
    }

    frame(now) {
      if (!this.running) return;
      requestAnimationFrame(this.frame);
      const dt = this.last ? U.clamp((now - this.last) / 1000, 0.001, 0.05) : 1 / 60;
      this.frameMs = U.lerp(this.frameMs, this.last ? now - this.last : 16, 0.05);
      this.last = now;
      const t = now / 1000;
      const work0 = performance.now();

      // Curseur : sans nouvelle position, sa vitesse retombe.
      const c = this.cursor;
      if (now - c.t > 50) {
        const k = Math.exp(-14 * dt);
        c.vx *= k;
        c.vy *= k;
      }
      c.speed = Math.hypot(c.vx, c.vy);
      c.stillFor = c.speed < 15 ? (now - c.lastMove) / 1000 : 0;

      // Vent : réglage + rafales (bruit lisse à deux échelles).
      this.wind = (this.settings.wind || 0) * 80 + U.noise(t * 0.11) * 42 + U.noise(t * 0.7 + 30) * 10;

      for (const ev of this.world.drainEvents()) {
        this.snowpack.onEvent(ev);
        for (const fx of this.effects) if (fx.onEvent) fx.onEvent(ev);
      }
      for (const fx of this.effects) fx.update(dt, t);
      this.effects = this.effects.filter((fx) => fx.spawning || !fx.isEmpty());
      this.snowpack.update(dt, t);
      this.aurora.update(dt);
      this.updateInteraction();
      this.render(t);

      this.workMs = U.lerp(this.workMs, performance.now() - work0, 0.05);
      this.adapt(dt);
      this.reportStats(now);
      this.checkIdle(now);
    }

    render(t) {
      const r = this.r;
      r.begin(t);
      // Découpe à la forme des fenêtres (et de la barre des menus / du Dock) dans le
      // shader : en mode « derrière », jamais rien devant une application.
      if (this.world.rectsDirty) {
        r.setRects(this.world.rects);
        this.world.rectsDirty = false;
      }
      // Pendant l'animation d'un changement de bureau, les fenêtres glissent plus vite que
      // leur position n'arrive : l'aurore s'efface un instant plutôt que de montrer un trou.
      const settled = U.clamp((performance.now() - this.world.spaceChangeAt - 600) / 400, 0, 1);
      if (this.aurora.visible() && settled > 0) r.drawAurora(this.aurora.level * settled);
      for (const fx of this.effects) if (fx.drawFlash) fx.drawFlash(r, this.settings.behind);
      r.drawPiles(this.world.piles);
      for (const shape of DRAW_ORDER) this.batches[shape].count = 0;
      for (const fx of this.effects) fx.draw(this);
      this.snowpack.draw(this);
      for (const shape of DRAW_ORDER) r.drawBatch(this.batches[shape], shape, ADDITIVE.has(shape));
    }

    // Qualité adaptative : si le Mac peine (< ~40 images/s), on réduit le nombre de
    // particules ; s'il est à l'aise, on remonte progressivement.
    adapt(dt) {
      if (this.frameMs > 25) {
        this.slowFor += dt;
        this.fastFor = 0;
      } else if (this.frameMs < 18) {
        this.fastFor += dt;
        this.slowFor = 0;
      }
      if (this.slowFor > 2) {
        this.quality = Math.max(0.3, this.quality * 0.85);
        this.slowFor = 0;
      }
      if (this.fastFor > 6 && this.quality < 1) {
        this.quality = Math.min(1, this.quality * 1.08);
        this.fastFor = 0;
      }
    }

    particleCount() {
      let n = this.snowpack.debris.length + this.snowpack.balls.length;
      for (const fx of this.effects) {
        n += (fx.flakes || fx.drops || fx.items || fx.flies || fx.meteors || []).length;
        if (fx.splashes) n += fx.splashes.length;
        if (fx.sparks) n += fx.sparks.length;
      }
      return n;
    }

    reportStats(now) {
      // Un seul écran (le principal) alimente le panneau, sinon les chiffres se mélangent.
      if (!this.settings.stats || !this.display || !this.display.primary || now - this.statsAt < 250) return;
      this.statsAt = now;
      let columns = 0;
      for (const p of this.world.piles) if (p.active) columns += p.n;
      this.ui.updateStats({
        fps: 1000 / this.frameMs,
        work: this.workMs,
        particles: this.particleCount(),
        columns,
        windows: this.world.order.length,
        balls: this.snowpack.balls.length,
        quality: this.quality,
        draws: this.r.drawCalls,
      });
    }

    // Plus rien à dessiner pendant 1,5 s : on prévient le processus principal, qui
    // cache la fenêtre (et la carte graphique se repose complètement).
    checkIdle(now) {
      const idle =
        this.effects.length === 0 && !this.aurora.visible() && this.snowpack.isEmpty() && !this.ui.busy();
      if (!idle) {
        this.wake();
        return;
      }
      if (!this.idleSince) this.idleSince = now;
      if (!this.idle && now - this.idleSince > 1500) {
        this.idle = true;
        window.brume.setIdle(true);
      }
    }
  }

  B.Engine = Engine;
})();
