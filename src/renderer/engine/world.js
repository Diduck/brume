// Brume — le « monde » physique : les surfaces où la météo peut se poser.
//
// Chaque fenêtre visible possède un tas (Pile) collé à son bord supérieur, et
// l'écran a un sol. Un tas est une carte de hauteurs : une hauteur de neige par
// colonne de 3 px.
//
// Quand une fenêtre bouge, on mesure sa vitesse ET son accélération, et on émet un
// évènement « jolt » : c'est la neige (snowpack.js) qui décide, selon la physique,
// si elle reste collée, glisse ou décolle. Une fenêtre fermée émet « shed » (tout
// tombe) ; une fenêtre partie sur un autre bureau est mise de côté avec sa neige.
(function () {
  'use strict';
  const B = window.Brume;
  const U = B.U;
  const COL = B.COL;
  const INSET = 8; // les coins des fenêtres macOS sont arrondis
  const STASH_MS = 15 * 60 * 1000; // une fenêtre d'un autre bureau garde sa neige 15 min

  class Pile {
    constructor(kind, width, maxH) {
      this.kind = kind;
      this.maxH = maxH;
      this.walls = kind === 'ground'; // le sol ne déborde pas, une fenêtre si
      this.x0 = 0;
      this.y = 0;
      this.order = 0;
      this.active = false;
      this.sum = 0;
      this.spill = [0, 0];
      this.n = Math.max(2, Math.ceil(width / COL));
      this.h = new Float32Array(this.n);
      this.debris = new Float32Array(this.n); // feuilles et pétales empilés
    }

    resize(width) {
      const n = Math.max(2, Math.ceil(width / COL));
      if (n === this.n) return;
      const h = new Float32Array(n);
      const d = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const src = Math.min(this.n - 1, Math.floor((i * this.n) / n));
        h[i] = this.h[src];
        d[i] = this.debris[src];
      }
      this.n = n;
      this.h = h;
      this.debris = d;
    }

    get width() {
      return this.n * COL;
    }
    index(x) {
      return Math.floor((x - this.x0) / COL);
    }
    contains(x) {
      return x >= this.x0 && x < this.x0 + this.n * COL;
    }
    heightAt(x) {
      const i = this.index(x);
      return i < 0 || i >= this.n ? 0 : this.h[i];
    }
    debrisAt(x) {
      const i = this.index(x);
      return i < 0 || i >= this.n ? 0 : this.debris[i];
    }
    topAt(x) {
      return this.y - this.heightAt(x) - this.debrisAt(x);
    }

    add(x, amount) {
      const i = this.index(x);
      if (i < 0 || i >= this.n) return;
      const h = this.h;
      h[i] += amount * 0.5;
      if (i > 0) h[i - 1] += amount * 0.25;
      else h[i] += amount * 0.25;
      if (i < this.n - 1) h[i + 1] += amount * 0.25;
      else h[i] += amount * 0.25;
      this.active = true;
    }

    addDebris(x, amount, spread) {
      const i = this.index(x);
      for (let k = -spread; k <= spread; k++) {
        const j = i + k;
        if (j < 0 || j >= this.n) continue;
        this.debris[j] = Math.max(0, this.debris[j] + amount * (1 - Math.abs(k) / (spread + 1)));
      }
    }

    // Éboulement : la pente entre deux colonnes ne peut pas dépasser l'angle de repos
    // de la neige. Ce qui dépasse glisse vers la voisine, et tombe aux extrémités.
    relax() {
      const h = this.h;
      const n = this.n;
      const maxStep = COL * 0.85;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < n - 1; i++) {
          const d = h[i] - h[i + 1];
          if (d > maxStep) {
            const m = (d - maxStep) * 0.5;
            h[i] -= m;
            h[i + 1] += m;
          } else if (d < -maxStep) {
            const m = (-d - maxStep) * 0.5;
            h[i + 1] -= m;
            h[i] += m;
          }
        }
      }
      if (!this.walls) {
        const lim = maxStep * 0.7;
        if (h[0] > lim) {
          this.spill[0] += h[0] - lim;
          h[0] = lim;
        }
        if (h[n - 1] > lim) {
          this.spill[1] += h[n - 1] - lim;
          h[n - 1] = lim;
        }
      }
      let sum = 0;
      for (let i = 0; i < n; i++) {
        if (h[i] > this.maxH) h[i] = this.maxH;
        sum += h[i];
      }
      this.sum = sum;
      if (sum < 0.01) this.active = false;
    }

    melt(amount) {
      if (amount <= 0) return;
      const h = this.h;
      for (let i = 0; i < this.n; i++) h[i] = h[i] > amount ? h[i] - amount : 0;
    }
  }

  class World {
    constructor() {
      this.W = 1;
      this.H = 1;
      this.workTop = 0;
      this.groundY = 1;
      this.windows = new Map();
      this.stash = new Map(); // fenêtres cachées (autre bureau, réduites) et leur neige
      this.order = [];
      this.piles = [];
      this.rects = [];
      this.rectsDirty = true;
      this.colMap = [];
      this.events = [];
      this.spaceChangeAt = -1e9;
      this.ground = new Pile('ground', 100, 34);
      this.ground.order = 1e4; // le sol est derrière toutes les fenêtres
    }

    setDisplay(W, H, workTop, groundY) {
      this.W = W;
      this.H = H;
      this.workTop = workTop;
      this.groundY = groundY;
      this.ground.resize(W);
      this.ground.x0 = 0;
      this.ground.y = groundY;
      this.rebuild();
    }

    // list   : [[id, x, y, w, h], ...] de la fenêtre la plus en avant à la plus en arrière.
    // closed : identifiants des fenêtres réellement fermées depuis la dernière fois.
    updateWindows(list, now, closed = []) {
      const closedSet = new Set(closed);
      const seen = new Set();
      list.forEach(([id, x, y, w, h], index) => {
        seen.add(id);
        let win = this.windows.get(id);
        if (!win && this.stash.has(id)) {
          // Retour sur ce bureau : la fenêtre retrouve sa neige, intacte.
          win = this.stash.get(id);
          this.stash.delete(id);
          this.spaceChangeAt = now;
          if (win.pile) {
            win.pile.hidden = false;
            win.pile.x0 += x - win.x;
            win.pile.y += y - win.y;
          }
          Object.assign(win, { x, y, svx: 0, svy: 0, t: now });
          this.windows.set(id, win);
        }
        if (!win) {
          win = { id, x, y, w, h, svx: 0, svy: 0, t: now, order: index, pile: null };
          this.windows.set(id, win);
        } else {
          this.moveWindow(win, x, y, now);
        }
        if (w !== win.w || h !== win.h) {
          win.w = w;
          win.h = h;
          if (win.pile) win.pile.resize(w - 2 * INSET);
        }
        win.order = index;
      });

      for (const [id, win] of this.windows) {
        if (seen.has(id)) continue;
        this.windows.delete(id);
        if (closedSet.has(id)) {
          // Fermée pour de bon : tout ce qui était posé dessus tombe.
          if (win.pile) this.emit({ type: 'shed', pile: win.pile, frac: 1, vx: win.svx, vy: win.svy, closed: true });
        } else {
          // Autre bureau, fenêtre réduite… : on garde sa neige (et ce qui est posé dessus)
          // pour plus tard, sans la dessiner.
          win.stashedAt = now;
          if (win.pile) win.pile.hidden = true;
          this.spaceChangeAt = now;
          this.stash.set(id, win);
        }
      }
      for (const [id, win] of this.stash) if (now - win.stashedAt > STASH_MS) this.stash.delete(id);

      this.order = list.map(([id]) => this.windows.get(id));
      this.rebuild();
    }

    // Vitesse lissée et accélération de la fenêtre ; le tas suit le mouvement et la
    // neige reçoit un évènement « jolt » pour réagir selon la physique.
    moveWindow(win, x, y, now) {
      const gap = now - win.t;
      if (gap > 120) {
        win.svx = 0; // elle était immobile
        win.svy = 0;
      }
      const dt = U.clamp(gap / 1000, 0.006, 0.07);
      const dx = x - win.x;
      const dy = y - win.y;
      const svx = U.lerp(win.svx, dx / dt, 0.6);
      const svy = U.lerp(win.svy, dy / dt, 0.6);
      if (win.pile) {
        win.pile.x0 += dx;
        win.pile.y += dy;
        if (dx || dy || win.svx || win.svy) {
          this.emit({ type: 'jolt', pile: win.pile, ax: (svx - win.svx) / dt, ay: (svy - win.svy) / dt, vx0: win.svx, vy0: win.svy, dx, dy });
        }
      }
      win.svx = svx;
      win.svy = svy;
      win.x = x;
      win.y = y;
      win.t = now;
    }

    emit(event) {
      this.events.push(event);
    }

    drainEvents() {
      if (!this.events.length) return this.events;
      const out = this.events;
      this.events = [];
      return out;
    }

    // Recalcule les surfaces exposées au ciel, colonne par colonne.
    rebuild() {
      const piles = [];
      for (const win of this.order) {
        const valid =
          win.y > this.workTop + 3 && win.y < this.H - 24 && win.w > 2 * INSET + 12 && win.x + win.w > 0 && win.x < this.W;
        if (!valid) {
          // Fenêtre plein écran / collée sous la barre des menus : pas de toit visible.
          if (win.pile) this.emit({ type: 'shed', pile: win.pile, frac: 1, vx: win.svx, vy: win.svy, closed: true });
          win.pile = null;
          continue;
        }
        if (!win.pile) {
          win.pile = new Pile('window', win.w - 2 * INSET, 16);
          win.pile.x0 = win.x + INSET;
          win.pile.y = win.y;
        }
        win.pile.order = win.order;
        win.pile.win = win;
        piles.push(win.pile);
      }
      piles.push(this.ground);
      this.piles = piles;

      const ncols = Math.ceil(this.W / COL);
      const colMap = new Array(ncols);
      for (let c = 0; c < ncols; c++) {
        const x = c * COL + COL / 2;
        let list = null;
        for (const p of piles) {
          if (!p.contains(x) || this.covered(x, p.y - 2, p.order)) continue;
          (list || (list = [])).push(p);
        }
        if (list && list.length > 1) list.sort((a, b) => a.y - b.y);
        colMap[c] = list;
      }
      this.colMap = colMap;
      this.rects = this.order.map((w) => [w.x, w.y, w.w, w.h]);
      this.rectsDirty = true;
    }

    // Le point (x, y) est-il caché par une fenêtre située devant l'ordre donné ?
    covered(x, y, order) {
      for (const win of this.order) {
        if (win.order >= order) break;
        if (x >= win.x && x <= win.x + win.w && y >= win.y && y <= win.y + win.h) return true;
      }
      return false;
    }

    // Premier tas dont la surface est traversée entre y0 et y1 à l'abscisse x.
    hit(x, y0, y1) {
      const list = this.colMap[Math.floor(x / COL)];
      if (!list) return null;
      for (const p of list) {
        const top = p.topAt(x);
        if (y1 >= top && y0 <= p.y + 1) return p;
      }
      return null;
    }

    // Tas sous le curseur (avec une petite marge).
    pileAt(x, y, margin) {
      const list = this.colMap[Math.floor(x / COL)];
      if (!list) return null;
      for (const p of list) {
        if (y >= p.topAt(x) - margin && y <= p.y + margin) return p;
      }
      return null;
    }

    isEmpty() {
      for (const p of this.piles) if (p.active) return false;
      return true;
    }

    meltAll() {
      for (const p of this.piles) {
        p.h.fill(0);
        p.debris.fill(0);
        p.active = false;
      }
    }
  }

  B.Pile = Pile;
  B.World = World;
})();
