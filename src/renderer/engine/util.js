// Brume — petits outils mathématiques partagés par tout le moteur.
(function () {
  'use strict';
  const B = (window.Brume = window.Brume || {});

  // Largeur (en px) d'une colonne de neige : la neige posée est une « carte de hauteurs ».
  B.COL = 3;

  const perm = new Float32Array(512);
  for (let i = 0; i < 512; i++) perm[i] = Math.random() * 2 - 1;

  const U = {
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    rand: (a, b) => a + Math.random() * (b - a),
    smooth: (t) => t * t * (3 - 2 * t),
    // Bruit 1D lisse dans [-1, 1] : rafales de vent, ondulations.
    noise(x) {
      const i = Math.floor(x);
      const f = x - i;
      const a = perm[i & 511];
      const b = perm[(i + 1) & 511];
      return a + (b - a) * U.smooth(f);
    },
    // Retire l'élément i d'un tableau en O(1) (l'ordre n'a pas d'importance).
    swapRemove(arr, i) {
      arr[i] = arr[arr.length - 1];
      arr.pop();
    },
  };

  B.U = U;
})();
