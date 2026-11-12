// Brume — véhicules, animaux et petits objets, dessinés pixel par pixel.
// Une lettre = une couleur ('.' = transparent). Chaque animation est une suite d'images.
(function () {
  'use strict';
  const B = window.Brume;
  const { sprite, recolor } = B.PX;

  /* ---------- Passants ----------
   * Les gens sont désormais peints par B.People (people.js, chargé juste après ce fichier).
   * Ces trois fonctions restent pour les scènes qui les appellent encore : elles renvoient
   * des jeux de passants au format de la foule (right / left / w / h / ax / ay…). */
  const crowdOf = (o) => B.People.crowdSets({ hh: 5, n: 1, ...o });
  const umbrellaWalker = (variant) => crowdOf({ wet: true, seed: 1 + (variant || 0) * 3 }).umbrella[0];
  const kid = () => crowdOf({ wet: true }).kid;
  const dogWalker = () => crowdOf({ wet: false }).dog;

  /* ---------- Voiture ---------- */
  const CAR = [
    '...........RRRRRRRRRRRRR.............',
    '.........RRwwwWwRRwwwwWwRR...........',
    '........RRwwwwwWwRRwwwwwWwRR.........',
    '......RRRRRRRRRRRRRRRRRRRRRRRRRRR....',
    '...rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr.',
    '..TrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrL',
    '..RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR.',
    '..RRRRttttRRRRRRRRRRRRRRRRttttRRRRR..',
    '...dd.tmmt.ddddddddddddddtmmt.dddd...',
    '......tttt...............tttt........',
  ];
  const CAR_COLORS = [
    { R: '#8e3434', r: '#b84a48' },
    { R: '#2e4e78', r: '#3e6a9e' },
    { R: '#c49a3a', r: '#e0b850' },
  ];
  function car(variant) {
    const pal = { w: '#22304a', W: '#5c6c92', t: '#101014', m: '#6a6a74', L: '#ffe9a8', T: '#ff3c3c', d: '#1a1012', ...CAR_COLORS[variant % CAR_COLORS.length] };
    return { right: sprite(CAR, pal), left: sprite(CAR, pal, true), w: 37, h: 10 };
  }

  /* ---------- Chat roux tigré ---------- */
  const CAT_PAL = { o: '#e2893c', O: '#a85a26', l: '#f2b67c', e: '#3a2014', n: '#e58a8a', g: '#9adf6a' };
  const CAT = {
    sleep: [
      ['..oo.............', '.oooo..oooooo....', 'ooeoooOoooOoooo..', 'ooooooooooooooooo', '.oOoooOoooOooooo.', '.oooooooooooooooo', '..OOOOOOOOOOOOoo.'],
      ['..oo...oooooo....', '.oooo.ooooooooo..', 'ooeoooOoooOoooo..', 'ooooooooooooooooo', '.oOoooOoooOooooo.', '.oooooooooooooooo', '..OOOOOOOOOOOOoo.'],
    ],
    sit: [
      ['o.o........', 'ooo........', 'ogoo.......', 'nooo.......', '.ooo.......', '.oooo......', '.ooOoo.....', '.oooOoo....', '.ooooOoo...', '.looooooo..', '.looooOo.o.', '.looooooo.o', '.oo.oooooo.', '.oo.oo.....'],
      ['o.o........', 'ooo........', 'ogoo.......', 'nooo.......', '.ooo.......', '.oooo......', '.ooOoo.....', '.oooOoo....', '.ooooOoo...', '.looooooo..', '.looooOo...', '.loooooooo.', '.oo.ooooooo', '.oo.oo.....'],
    ],
    lick: [
      ['...........', 'o.o........', 'ooo........', 'oeoo.......', 'nooo.......', 'oooo.......', 'o.oooo.....', '.oooOoo....', '.ooooOoo...', '.looooooo..', '.looooOo.o.', '.looooooo.o', '.oo.oooooo.', '.oo.oo.....'],
      ['...........', 'o.o........', 'ooo........', 'oeoo.......', 'noooo......', 'o.ooo......', '.ooooo.....', '.oooOoo....', '.ooooOoo...', '.looooooo..', '.looooOo.o.', '.looooooo.o', '.oo.oooooo.', '.oo.oo.....'],
    ],
    walk: [
      ['o.o...............', 'ooo..............o', 'ogooooooooooooo..o', 'noooooOooOooOooooo', '.oooooooooooooooo.', '..lllllllllllloo..', '..o.o......o.o....', '..o..o....o...o...'],
      ['o.o...............', 'ooo.............o.', 'ogooooooooooooo.o.', 'noooooOooOooOoooo.', '.oooooooooooooooo.', '..lllllllllllloo..', '...oo.......oo....', '...oo.......oo....'],
      ['o.o...............', 'ooo..............o', 'ogooooooooooooo..o', 'noooooOooOooOooooo', '.oooooooooooooooo.', '..lllllllllllloo..', '..o..o....o...o...', '..o.o......o.o....'],
      ['o.o...............', 'ooo.............o.', 'ogooooooooooooo.o.', 'noooooOooOooOoooo.', '.oooooooooooooooo.', '..lllllllllllloo..', '...oo.......oo....', '...oo.......oo....'],
    ],
  };
  function cat() {
    const make = (list, flip) => list.map((f) => sprite(f, CAT_PAL, flip));
    const out = {};
    for (const k of Object.keys(CAT)) {
      out[k] = make(CAT[k], false); // tête à gauche
      out[`${k}R`] = make(CAT[k], true); // tête à droite
    }
    return out;
  }

  /* ---------- Petits objets ---------- */
  const MUG = ['.wwww.', 'wwwwwh', 'wcccwh', 'wwwwwh', '.www..'];
  const mug = () => sprite(MUG, { w: '#ece4d8', c: '#6a3e26', h: '#d8d0c4' });

  B.Sprites = { umbrellaWalker, kid, dogWalker, car, cat, mug, recolor };
})();
