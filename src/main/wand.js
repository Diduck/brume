'use strict';
// Brume — le geste de la baguette magique (easter egg).
//
// Avec la souris : un petit cercle, puis un trait vers le bas, comme un coup de baguette.
// On garde les positions récentes du curseur ; à chaque nouveau point, on regarde si
// les derniers instants forment « un trait vers le bas » précédé d'« une boucle ».

const KEEP = 3000; // ms d'historique
const COOLDOWN = 8000;

function createWand(onCast) {
  let pts = [];
  let lastCast = -Infinity;

  // Angle total parcouru (en radians, signé) le long d'une suite de points.
  function turning(list) {
    let total = 0;
    let prev = null;
    let anchor = list[0];
    for (let i = 1; i < list.length; i++) {
      const p = list[i];
      const dx = p.x - anchor.x;
      const dy = p.y - anchor.y;
      if (dx * dx + dy * dy < 36) continue; // on ignore les micro-mouvements (< 6 px)
      const a = Math.atan2(dy, dx);
      if (prev !== null) {
        let d = a - prev;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        total += d;
      }
      prev = a;
      anchor = p;
    }
    return total;
  }

  function check(now) {
    if (now - lastCast < COOLDOWN || pts.length < 8) return null;
    // 1. Le trait vers le bas : on remonte depuis le dernier point tant que ça descend.
    const end = pts[pts.length - 1];
    let i = pts.length - 1;
    // (seulement la partie droite : chaque petit pas descend presque à la verticale)
    const steep = (a, b) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      return (dx * dx + dy * dy < 9) || (dy > 0 && Math.abs(dx) <= dy * 0.7);
    };
    while (i > 0 && steep(pts[i - 1], pts[i]) && end.t - pts[i - 1].t < 700) i--;
    const start = pts[i];
    const dy = end.y - start.y;
    const dx = Math.abs(end.x - start.x);
    if (dy < 110 || dx > dy * 0.6) return null;
    // 2. La boucle juste avant : un tour presque complet, de taille raisonnable.
    const loop = pts.filter((p) => p.t >= start.t - 1800 && p.t <= start.t);
    if (loop.length < 4) return null;
    const xs = loop.map((p) => p.x);
    const ys = loop.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (w < 30 || h < 30 || w > 700 || h > 700) return null;
    // Le dernier quart de la boucle peut déjà descendre (il compte alors dans le trait) :
    // on demande donc au moins ~240° de rotation avant le trait.
    if (Math.abs(turning(loop)) < Math.PI * 1.3) return null;
    lastCast = now;
    const path = pts.filter((p) => p.t >= start.t - 1800).map((p) => ({ x: p.x, y: p.y }));
    pts = [];
    return path;
  }

  return {
    // p : position du curseur à l'écran ; now : millisecondes.
    move(p, now = Date.now()) {
      pts.push({ x: p.x, y: p.y, t: now });
      while (pts.length && now - pts[0].t > KEEP) pts.shift();
      const path = check(now);
      if (path) onCast(path);
    },
  };
}

module.exports = { createWand };
