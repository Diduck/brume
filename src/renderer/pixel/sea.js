// Brume — scène « Bord de mer », en pixel art.
//
// Une plage au coucher du soleil : ciel en bandes, nuages éclairés par en dessous, gros
// soleil bas et sa colonne de reflets sur la mer, vagues qui déroulent jusqu'au sable avec
// une ligne d'écume qui avance et recule, falaise rocheuse et son phare rayé dont le
// faisceau balaie le ciel, ponton en bois, parasol, serviette, château de sable, dunes.
// La vie : mouettes en vol, une mouette posée sur un pieu, un voilier à l'horizon, un crabe
// qui sort de son trou, un promeneur et son chien, un enfant et son cerf-volant, un pêcheur
// au bout du ponton, des poissons qui sautent.
// Le décor s'adapte à la météo (hiver, pluie, orage, printemps, automne, nuits d'été).
//
// Comme pour le café : le décor est peint une fois (éclairage compris) dans trois couches
// (fond, plan moyen, premier plan), puis chaque image ne dessine que ce qui bouge.
(function () {
  'use strict';
  const B = window.Brume;
  const { Raster, sprite, recolor, hex, mix, rng, hash, noise, fbm, bayer } = B.PX;
  const SP = B.Sprites;
  const PXC = B.PXC;
  const C = hex;
  const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const frac = (v) => v - Math.floor(v);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ================= Ambiances selon la météo ================= */
  const WOOD = ['#3e261e', '#6a4430', '#94643f'];
  const BASE = {
    clouds: 0.5,
    streaks: true,
    tree: ['#2c4630', '#46663a', '#c88a58'],
    ambient: [1, 1, 1],
    warm: [0.9, 0.65, 0.35],
    beam: 0.1,
    lamp: true,
    night: false,
    stars: 0,
    milky: false,
    snow: false,
    props: { umbrella: true, towel: true, castle: true, kite: true, fisher: true },
    walker: 'dog',
    waves: 1,
    whitecaps: false,
    lightning: false,
    boat: true,
    gulls: [7, 16],
    fish: true,
    litter: null,
  };
  const THEMES = {
    // Coucher de soleil (par défaut).
    none: {
      sky: ['#26346a', '#463c78', '#844a86', '#cc637c', '#f08c78', '#ffc488'],
      cloud: ['#6e4274', '#a85676', '#ffb27e'], // ombre, corps, dessous éclairé
      body: { kind: 'sun', x: 0.42, y: -8, r: 21, c: ['#fff6d6', '#ffd47c', '#ff9858'], glow: [255, 150, 90], k: 0.42, sliced: true },
      sea: ['#c47c8a', '#6c5692', '#3c4a88', '#33598c', '#4a8a9c'],
      crest: '#f4a88c',
      trough: '#262a5a',
      refl: '#ffe2a0',
      foam: '#fff4e6',
      swash: '#86aab8',
      wet: '#94707a',
      sand: ['#e6b88c', '#cc976f', '#f6d4a8', '#ab7a5e'], // base, ombre, clair, sombre
      rock: ['#3a2a42', '#563c54', '#76505e', '#e48c68'], // sombre, moyen, clair, bord éclairé
      grass: ['#3c5634', '#688842', '#a8b65a'],
    },
    // Hiver : ciel gris, neige sur les dunes et la falaise, pas de parasol, un bonhomme de neige.
    snow: {
      sky: ['#5c6676', '#76808e', '#929aa6', '#adb4bc', '#c4c8cd'],
      cloud: ['#646c7a', '#868e9a', '#c6cbd0'],
      clouds: 0.44,
      streaks: false,
      body: { kind: 'pale', x: 0.36, y: -42, r: 11, c: ['#eceee8', '#dcdedc', '#c8ccd0'], glow: [200, 205, 215], k: 0.16 },
      sea: ['#9ca4ac', '#6c7884', '#4c5c6a', '#405866', '#5a7480'],
      crest: '#ccd4dc',
      trough: '#33404c',
      refl: '#dfe3e6',
      foam: '#f6f9fc',
      swash: '#7c949e',
      wet: '#8a8c8a',
      sand: ['#c6baa6', '#aa9e8a', '#d8cebc', '#8c8270'],
      rock: ['#363842', '#505460', '#6c727e', '#8e949e'],
      grass: ['#56624e', '#768262', '#98a084'],
      tree: null,
      ambient: [0.96, 0.98, 1.02],
      beam: 0.12,
      snow: true,
      props: { snowman: true, kite: true },
      gulls: [9, 18],
    },
    // Pluie : mer grise et agitée, nuages sombres, faisceau du phare bien visible.
    rain: {
      sky: ['#1c2430', '#28323f', '#36414f', '#465364', '#5a687a'],
      cloud: ['#18202a', '#2a3340', '#4c5a6c'],
      clouds: 0.36,
      streaks: false,
      body: null,
      sea: ['#5c6a7a', '#3e4c5c', '#2c3a48', '#2a4450', '#3e5a64'],
      crest: '#7e8e9c',
      trough: '#1c2632',
      refl: null,
      foam: '#dfe7ec',
      swash: '#5c7682',
      wet: '#62605e',
      sand: ['#aa9a80', '#8e806a', '#bcae94', '#706654'],
      rock: ['#24262e', '#343842', '#484e5a', '#5e6672'],
      grass: ['#384834', '#526646', '#6e8058'],
      tree: ['#1c3226', '#2c4634', '#42604a'],
      ambient: [0.78, 0.82, 0.92],
      beam: 0.22,
      props: { castle: true },
      walker: 'umbrella',
      waves: 1.5,
      whitecaps: true,
      gulls: [12, 24],
    },
    // Orage : encore plus sombre, grosses vagues, éclairs au-dessus de la mer.
    storm: {
      sky: ['#0e1218', '#161c26', '#202834', '#2c3644', '#3e4a5a'],
      cloud: ['#0c1016', '#1c232e', '#3c4858'],
      clouds: 0.3,
      streaks: false,
      body: null,
      sea: ['#404c5a', '#2a3442', '#1e2834', '#1e3440', '#2e4a54'],
      crest: '#6e7e8c',
      trough: '#101822',
      refl: null,
      foam: '#e6eef4',
      swash: '#4c6672',
      wet: '#585656',
      sand: ['#a2927a', '#867864', '#b4a68c', '#6a604e'],
      rock: ['#20222a', '#30343e', '#444a56', '#58606c'],
      grass: ['#34442f', '#4c6042', '#687a54'],
      tree: ['#182c22', '#28402f', '#3c5844'],
      ambient: [0.64, 0.68, 0.82],
      beam: 0.3,
      props: { castle: true },
      walker: 'umbrella',
      waves: 2,
      whitecaps: true,
      lightning: true,
      boat: false,
      gulls: [14, 30],
      fish: false,
    },
    // Printemps : journée douce et pastel, cerisier en fleurs sur la falaise.
    sakura: {
      sky: ['#7ab6e2', '#98c8ea', '#c0daee', '#e8d8e8', '#fbe8e4'],
      cloud: ['#d4cce2', '#f2ecf6', '#ffffff'],
      clouds: 0.56,
      body: { kind: 'sun', x: 0.52, y: -66, r: 10, c: ['#ffffff', '#fff8de', '#ffe8bc'], glow: [255, 240, 210], k: 0.3 },
      sea: ['#c4e2ea', '#8ccae0', '#58aac8', '#46b2bc', '#7ad6ce'],
      crest: '#eef9ff',
      trough: '#3a8cae',
      refl: '#ffffff',
      foam: '#ffffff',
      swash: '#a6e2de',
      wet: '#c4b4a6',
      sand: ['#f4dcb4', '#e0c094', '#fbead0', '#c8a47c'],
      rock: ['#5a5868', '#787688', '#9896a8', '#c4c0d0'],
      grass: ['#468848', '#78b65a', '#b4d878'],
      tree: ['#d07a9e', '#ee9cbe', '#ffd6e6'],
      warm: [0.5, 0.5, 0.4],
      beam: 0,
      lamp: false,
      litter: 'petals',
    },
    // Automne : soirée ambrée, arbre roux, feuilles mortes sur le sable.
    leaves: {
      sky: ['#382240', '#5c2c48', '#8c4440', '#c6643a', '#ea9440', '#f8c262'],
      cloud: ['#62293a', '#94463e', '#ffb862'],
      clouds: 0.52,
      body: { kind: 'sun', x: 0.62, y: -12, r: 17, c: ['#fff0c2', '#ffc870', '#f0863a'], glow: [255, 140, 60], k: 0.42, sliced: true },
      sea: ['#d8905c', '#8a5a5c', '#4c3a5a', '#3e4a66', '#56707a'],
      crest: '#f8b070',
      trough: '#2a2240',
      refl: '#ffd284',
      foam: '#fff0d8',
      swash: '#8a9a98',
      wet: '#82625a',
      sand: ['#dcae7e', '#c09068', '#ecc89a', '#a0745a'],
      rock: ['#38283a', '#563a42', '#764e4a', '#ec9a5a'],
      grass: ['#6a5228', '#a07a32', '#d0a048'],
      tree: ['#8e3a1c', '#d26a28', '#f4a840'],
      beam: 0.12,
      props: { towel: true, castle: true, kite: true, fisher: true },
      litter: 'leaves',
    },
    // Nuit d'été chaude : lune et son reflet, feu de camp sur la plage.
    fireflies: {
      sky: ['#0c0e2a', '#161a44', '#262656', '#3c3064', '#5a3a66'],
      cloud: ['#161838', '#26284e', '#4a3e6c'],
      clouds: 0.6,
      body: { kind: 'moon', x: 0.3, y: -54, r: 8, c: ['#fff8e2', '#ece0c0', '#c4b898'], glow: [255, 228, 170], k: 0.28 },
      sea: ['#4a3a66', '#2a2a56', '#1a2248', '#1a2a4c', '#22384e'],
      crest: '#8a7cae',
      trough: '#0e122c',
      refl: '#ffe8b4',
      foam: '#fff2e6',
      swash: '#86aab8',
      wet: '#94707a',
      sand: ['#e6b88c', '#cc976f', '#f6d4a8', '#ab7a5e'],
      rock: ['#3a2a42', '#563c54', '#76505e', '#8a6a78'],
      grass: ['#3c5634', '#688842', '#a8b65a'],
      ambient: [0.36, 0.37, 0.56],
      warm: [1.05, 0.72, 0.36],
      beam: 0.22,
      night: true,
      stars: 0.55,
      props: { towel: true, castle: true, fire: true },
      gulls: null,
    },
    // Nuit claire et étoilée : voie lactée, lune.
    starfall: {
      sky: ['#04061a', '#090e2e', '#111a42', '#1a2652', '#283864'],
      cloud: ['#0a0e26', '#141c3a', '#2a3a62'],
      clouds: 0.7,
      streaks: false,
      body: { kind: 'moon', x: 0.64, y: -58, r: 9, c: ['#f6f2e4', '#e2dbca', '#b2ac9c'], glow: [190, 200, 240], k: 0.3 },
      sea: ['#2c3c64', '#18224a', '#101a3c', '#122440', '#1a3248'],
      crest: '#6c7cb2',
      trough: '#080c22',
      refl: '#e8ecff',
      foam: '#eef2ff',
      swash: '#86a2b8',
      wet: '#7c7a8a',
      sand: ['#d8bc9c', '#bc9e80', '#e8d2b4', '#9a7e66'],
      rock: ['#2e2c3e', '#46445a', '#5e5c74', '#787896'],
      grass: ['#3c5634', '#688842', '#a8b65a'],
      ambient: [0.3, 0.36, 0.58],
      warm: [0.95, 0.78, 0.5],
      beam: 0.26,
      night: true,
      stars: 1,
      milky: true,
      props: { castle: true },
      gulls: null,
    },
  };
  for (const k of Object.keys(THEMES)) THEMES[k] = { ...BASE, ...THEMES[k] };

  /* ================= Versions nuit (météo en direct, quand il fait nuit) =================
   * Chaque temps de jour garde ses conséquences (mer agitée, sable mouillé, éclairs, neige
   * posée, cerisier en fleurs, arbre roux…) mais sous un ciel de nuit : plus de soleil, le
   * phare balaie, les lampes et la fenêtre de la maison sont allumées, et la lune et les
   * étoiles ne se montrent que si le ciel est dégagé. Le sable, les rochers et les arbres
   * gardent leurs couleurs de jour : la lumière ambiante de la nuit les assombrit, et les
   * lampes les réchauffent (éclairage peint). Pas de mouettes ni de cerf-volant la nuit.
   * fireflies et starfall sont déjà des nuits : ils ne changent pas. */
  const NIGHT = {
    // Nuit claire et calme : lune haute et son reflet, étoiles, un pêcheur à la lanterne.
    none: {
      sky: ['#070b22', '#0e1638', '#18244c', '#24345e', '#38486e'],
      cloud: ['#0c1230', '#1a2446', '#56658e'],
      clouds: 0.64,
      streaks: false,
      body: { kind: 'moon', x: 0.38, y: -60, r: 8, c: ['#f8f4e6', '#e4dccb', '#b4ad9c'], glow: [200, 210, 245], k: 0.3 },
      sea: ['#2a3a62', '#172448', '#0f1a3c', '#112440', '#19324a'],
      crest: '#5e70a8',
      trough: '#070b20',
      refl: '#e6ecff',
      foam: '#eef2ff',
      swash: '#7c98b0',
      wet: '#74727e',
      rock: ['#2e2c3e', '#46445a', '#5e5c74', '#787896'],
      tree: ['#24402c', '#3a5a3a', '#6a8a72'],
      ambient: [0.34, 0.39, 0.6],
      warm: [1, 0.76, 0.46],
      beam: 0.26,
      stars: 0.8,
      props: { castle: true, fisher: true },
      fisherLamp: true,
    },
    // Hiver, la nuit : ciel couvert et bas (pas de lune), la neige garde un peu de lueur,
    // le bonhomme de neige veille sous la fenêtre allumée.
    snow: {
      sky: ['#121828', '#1a2234', '#242c40', '#30384c', '#3e4658'],
      cloud: ['#10162a', '#20283a', '#4a5468'],
      body: null,
      sea: ['#3a4454', '#262e3c', '#1a2230', '#1a2632', '#24343e'],
      crest: '#5a6672',
      trough: '#0c1018',
      refl: null,
      foam: '#e4eaf2',
      swash: '#5c707c',
      wet: '#5c5e64',
      ambient: [0.52, 0.56, 0.76],
      warm: [1.05, 0.78, 0.48],
      beam: 0.3,
      props: { snowman: true },
    },
    // Pluie de nuit : ciel couvert d'encre, mer grise qui moutonne, sable mouillé qui
    // renvoie les lumières, promeneur sous son parapluie.
    rain: {
      sky: ['#080b12', '#0e131c', '#151b25', '#1d2530', '#2a313c'],
      cloud: ['#06090e', '#121822', '#2a3340'],
      sea: ['#26303c', '#19222c', '#121a23', '#142129', '#1c2d35'],
      crest: '#46545f',
      trough: '#05080d',
      foam: '#c4ced8',
      swash: '#4e6672',
      wet: '#4c4c50',
      ambient: [0.42, 0.46, 0.6],
      warm: [1.1, 0.8, 0.48],
      beam: 0.34,
      wetShine: 1,
    },
    // Orage de nuit : noir d'encre, grosses vagues, les éclairs révèlent la mer.
    storm: {
      sky: ['#04060a', '#090c13', '#0f141c', '#161c26', '#212833'],
      cloud: ['#030508', '#0d1219', '#242d39'],
      sea: ['#1d2530', '#131a23', '#0c121a', '#0e1820', '#16242c'],
      crest: '#38464f',
      trough: '#020407',
      foam: '#b8c4ce',
      swash: '#40565f',
      wet: '#424246',
      ambient: [0.34, 0.37, 0.52],
      warm: [1.1, 0.8, 0.48],
      beam: 0.42,
      wetShine: 1.3,
    },
    // Nuit de printemps : ciel mauve et doux, lune pâle, le cerisier en fleurs sous la lune.
    sakura: {
      sky: ['#0c0e2c', '#181a42', '#2a2856', '#433660', '#5e4868'],
      cloud: ['#14163a', '#28284e', '#6c5c8c'],
      clouds: 0.62,
      streaks: false,
      body: { kind: 'moon', x: 0.55, y: -62, r: 8, c: ['#fff6f4', '#efe0e4', '#c2b0bc'], glow: [250, 215, 235], k: 0.3 },
      sea: ['#463f72', '#282c5c', '#1a2148', '#1a2a4e', '#243c58'],
      crest: '#8c8ec4',
      trough: '#0b0e2c',
      refl: '#ffe6f0',
      foam: '#f6f0ff',
      swash: '#8aa6bc',
      wet: '#7a6e86',
      ambient: [0.4, 0.4, 0.62],
      warm: [1, 0.74, 0.5],
      beam: 0.24,
      lamp: true,
      stars: 0.6,
      props: { castle: true },
    },
    // Nuit d'automne : grosse lune rousse au ras de l'eau, feu de feuilles sur la plage.
    leaves: {
      sky: ['#0c0a22', '#181236', '#2a1a40', '#402446', '#5a3446'],
      cloud: ['#140e26', '#2a1c3a', '#7a4c5a'],
      clouds: 0.58,
      streaks: false,
      body: { kind: 'moon', x: 0.62, y: -30, r: 10, c: ['#ffe4b4', '#f0c68c', '#c4986a'], glow: [255, 180, 110], k: 0.32 },
      sea: ['#4c3446', '#2c2448', '#19183a', '#19243e', '#20344a'],
      crest: '#8c6a78',
      trough: '#0a0a1e',
      refl: '#ffd49c',
      foam: '#fff0e0',
      swash: '#8a98a0',
      wet: '#7a6268',
      rock: ['#30263a', '#4a3a4c', '#665264', '#8a6a6e'],
      ambient: [0.37, 0.34, 0.52],
      warm: [1.1, 0.72, 0.36],
      beam: 0.24,
      stars: 0.5,
      props: { fire: true },
    },
  };
  const NIGHTS = {};
  for (const k of Object.keys(NIGHT)) NIGHTS[k] = { ...THEMES[k], ...NIGHT[k], night: true, gulls: null, nightOf: k };
  // L'ambiance d'un temps, de jour ou de nuit (les nuits déjà nocturnes restent telles quelles).
  const themeFor = (effect, night) => (night && NIGHTS[effect]) || THEMES[effect] || (night ? NIGHTS.none : THEMES.none);

  /* ================= Sprites propres à la scène ================= */
  // Crabe (vu de face, il marche de côté). Deux pas, puis pinces levées (deux images).
  const CRAB = {
    walk: [
      ['.R.....R.', 'RR.e.e.RR', '.RrRRRrR.', '..RRRRR..', '.l.lRl.l.', 'l..l.l..l'],
      ['.R.....R.', 'RR.e.e.RR', '.RrRRRrR.', '..RRRRR..', 'l.l.R.l.l', '.l.....l.'],
    ],
    claws: [
      ['RR.....RR', '.R.e.e.R.', '.RrRRRrR.', '..RRRRR..', '.l.lRl.l.', 'l..l.l..l'],
      ['R.R...R.R', '.R.e.e.R.', '.RrRRRrR.', '..RRRRR..', '.l.lRl.l.', 'l..l.l..l'],
    ],
  };
  const CRAB_PAL = { R: '#e0603e', r: '#f8946a', e: '#1a0e0e', l: '#a83a28' };

  // Mouette posée (de profil, tournée vers la gauche) : repos, tête levée, battements d'ailes.
  const GULL_LEGS = ['....o.o....', '....o.o....', '...oo.oo...'];
  const GULL_STAND = {
    idle: ['...........', '...........', '...........', '.ww........', 'ywkw.......', '.wwww......', '..wwwgggg..', '..wwwwgggGG', '...wwwwgG..', ...GULL_LEGS],
    look: ['...........', '...........', '.ww........', 'ywkw.......', '.ww........', '.wwww......', '..wwwgggg..', '..wwwwgggGG', '...wwwwgG..', ...GULL_LEGS],
    flapUp: ['......G....', '.....gG....', '....ggg....', '.ww.gg.....', 'ywkwg......', '.wwww......', '..wwwwwww..', '..wwwwwwwGG', '...wwwwww..', ...GULL_LEGS],
    flapMid: ['...........', '...........', '...........', '.ww...ggGG.', 'ywkw.ggg...', '.wwwwgg....', '..wwwwwww..', '..wwwwwwwGG', '...wwwwww..', ...GULL_LEGS],
  };
  const GULL_PAL = { w: '#f4f2ec', g: '#a8b0bc', G: '#383c46', k: '#1a1a1a', y: '#f0b030', o: '#e88a3a' };

  // Voilier lointain.
  const BOAT = [
    '.....m.....',
    '....sm.....',
    '....smS....',
    '...ssmSS...',
    '...ssmSSS..',
    '..sssmSSSS.',
    '..sssmSSSSS',
    '.ssssm.....',
    '.....m.....',
    'hhhhhhhhhhh',
    '.HHHHHHHHH.',
  ];
  const BOAT_PAL = { s: '#f6ead8', S: '#d4bcb6', m: '#5a3a2a', h: '#ece4d4', H: '#8a3a3a' };
  // Voilier plus proche (monde élargi), coque bleu marine.
  const BOAT2 = [
    '.......m........',
    '......sm........',
    '......smS.......',
    '.....ssmSS......',
    '.....ssmSSS.....',
    '....sssmSSSS....',
    '....sssmSSSSS...',
    '...ssssmSSSSSS..',
    '...ssssmSSSSSSS.',
    '..sssssm........',
    '.......m........',
    'hhhhhhhhhhhhhhhh',
    '.HHHHHHHHHHHHHH.',
    '..HHHHHHHHHHHH..',
  ];

  // Les deux enfants qui jouent au beach-volley (monde élargi).
  const PLAYERS = [
    { seed: 21, body: 'kid', skin: '#d49a74', hairColor: '#2e2018', hairStyle: 'curly', top: '#f0c040', topStyle: 'tee', sleeves: 'short', bottom: '#3a7ad0', shoes: '#e8e0d8' },
    { seed: 22, body: 'kid', skin: '#f2c8a8', hairColor: '#c8a060', hairStyle: 'pony', top: '#3e9a78', topStyle: 'tee', sleeves: 'short', bottom: '#e8e0d0', shoes: '#c84a3a' },
  ];

  // Cerf-volant losange à quatre couleurs.
  const KITE = ['...r...', '..RrY..', '.RRrYY.', 'RRRrYYY', '.BBbRR.', '..BbR..', '...b...'];
  const KITE_PAL = { R: '#e8403a', r: '#b02a28', Y: '#f8d040', B: '#3a7ad0', b: '#2a5a9a' };

  // Les gens de la plage (l'enfant au cerf-volant, le pêcheur, le promeneur) sont peints
  // par B.People (people.js).
  const KID = { seed: 14, body: 'kid', skin: '#eab48c', hairColor: '#6a3a1e', hairStyle: 'messy', top: '#f06a50', topStyle: 'tee', bottom: '#2e5a9a', shoes: '#f0e0c8' };
  const KID_WINTER = { ...KID, top: '#3a6ab0', topStyle: 'coat', bottom: '#2a2a3a', shoes: '#4a2a1e', scarf: '#e8c547', hat: { color: '#d4564f', band: '#e8e0d0', pom: true } };
  const FISHER = { seed: 15, body: 'm', skin: '#e2aa86', hairColor: '#d8c070', hairStyle: 'short', top: '#3a6a8a', topStyle: 'jacket', trim: '#e8e0d0', bottom: '#44465a', shoes: '#2a2018', hat: { color: '#d8b04a', band: '#a8842e' } };

  // Assombrit un sprite pour la nuit (teinte bleutée posée par-dessus ses pixels).
  function shade(img, k, tint = [14, 16, 44]) {
    if (k <= 0.02) return img;
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = css(tint, k);
    x.fillRect(0, 0, c.width, c.height);
    return c;
  }

  /* ---------- Monde élargi (animation d'ouverture) ----------
   * La scène peut peindre un monde plus large que l'écran : x de −extL à W + extR. On
   * peint toujours en coordonnées de la scène ; le pixel x est rangé dans la colonne
   * x + extL de la toile. Le cadre du fond d'écran [0, W) reste peint exactement pareil :
   * les décors ajoutés autour sont peints ensuite, cadre verrouillé (lock). */
  class WRaster extends Raster {
    constructor(x0, w, h, vw) {
      super(w, h);
      this.x0 = x0; // x de la scène de la première colonne
      this.vw = vw; // largeur du cadre du fond d'écran
      this.la = 0;
      this.lb = 0;
    }
    // Colonnes [a, b) protégées (rien ne s'y peint) ; lock() sans argument déverrouille.
    lock(a = 0, b = 0) {
      this.la = a;
      this.lb = b;
    }
    set(x, y, c, a = 255) {
      x |= 0;
      if (x >= this.la && x < this.lb) return;
      super.set(x - this.x0, y, c, a);
    }
    get(x, y) {
      return super.get((x | 0) - this.x0, y);
    }
  }

  // Halos additifs (comme B.PXC.makeHalo) sur toute la largeur du monde ; extra : halos
  // des décors ajoutés, seulement hors du cadre.
  function haloW(x0, w, h, vw, halos, extra) {
    const r = new Raster(w, h);
    for (let y = 0; y < h; y++) {
      for (let cx = 0; cx < w; cx++) {
        const x = cx + x0;
        let R = 0;
        let G = 0;
        let Bl = 0;
        const list = extra && (x < 0 || x >= vw) ? halos.concat(extra) : halos;
        for (const hl of list) {
          const d = Math.hypot(x - hl.x, (y - hl.y) * 1.2);
          if (d > hl.r) continue;
          const q = (Math.floor((1 - d / hl.r) ** 1.6 * 5 + bayer(x, y) * 0.9) / 5) * (hl.k || 0.55);
          R += hl.c[0] * q;
          G += hl.c[1] * q;
          Bl += hl.c[2] * q;
        }
        if (R + G + Bl > 2) r.set(cx, y, [R, G, Bl]);
      }
    }
    return r.toCanvas();
  }

  // Courbe lisse qui passe par des points [u, v].
  function curve(P, u) {
    if (u <= P[0][0]) return P[0][1];
    for (let i = 1; i < P.length; i++) {
      if (u > P[i][0]) continue;
      const [a, va] = P[i - 1];
      const [b, vb] = P[i];
      const t = (u - a) / (b - a);
      return va + (vb - va) * t * t * (3 - 2 * t);
    }
    return P[P.length - 1][1];
  }

  // Éclairage peint (même principe que B.PXC.applyLight) mais la lumière s'éteint vraiment
  // au loin : sinon la traîne des lampes allume un pixel sur seize et le sable se couvre
  // d'une grille de points la nuit. Sur une toile élargie, on calcule en x de la scène ;
  // extra : lumières des décors ajoutés, qui n'éclairent que hors du cadre.
  function light(r, lights, ambient, warm, mask, extra) {
    const x0 = r.x0 || 0;
    for (let y = 0; y < r.h; y++) {
      for (let cx = 0; cx < r.w; cx++) {
        const x = cx + x0;
        if (mask && !mask(x, y)) continue;
        const i = (y * r.w + cx) * 4;
        if (!r.data[i + 3]) continue;
        let I = 0;
        for (const l of lights) {
          const dx = x - l.x;
          const dy = (y - l.y) * (l.sy || 1);
          I += l.k / (1 + (dx * dx + dy * dy) / (l.r * l.r));
        }
        if (extra && extra.length && (x < 0 || x >= r.vw)) {
          for (const l of extra) {
            const dx = x - l.x;
            const dy = (y - l.y) * (l.sy || 1);
            I += l.k / (1 + (dx * dx + dy * dy) / (l.r * l.r));
          }
        }
        I = Math.max(0, I - 0.04) / 0.96;
        const q = Math.floor(Math.min(1.3, I) * 6 + bayer(x, y)) / 6;
        for (let c = 0; c < 3; c++) r.data[i + c] = Math.min(255, r.data[i + c] * (ambient[c] + warm[c] * q));
      }
    }
  }

  // Trace une ligne pixel par pixel (sur un contexte 2D, couleur déjà choisie).
  function line(g, x0, y0, x1, y1) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let k = 0; k <= n; k++) g.fillRect(Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n), 1, 1);
  }

  class Sea {
    constructor(W, H, opts = {}) {
      this.W = W;
      this.H = H;
      // Monde élargi pour l'animation d'ouverture : extL pixels à gauche, extR à droite.
      const ext = opts.ext || {};
      this.extL = Math.max(0, Math.round(ext.left || 0));
      this.extR = Math.max(0, Math.round(ext.right || 0));
      this.ext = this.extL + this.extR > 0;
      this.X0 = -this.extL;
      this.X1 = W + this.extR;
      this.WW = this.X1 - this.X0;
      const L = (this.L = {});
      L.hz = Math.round(H * 0.48); // horizon
      L.shore = Math.round(H * 0.72); // limite mer / sable
      L.wet1 = L.shore + 13; // fin du sable mouillé
      L.walkY = L.shore + 8; // pieds du promeneur
      L.crabY = L.shore + 19; // pattes du crabe
      L.band = 16; // bande où les vagues déroulent avant le rivage
      L.cx0 = Math.round(W * 0.77); // falaise
      L.cliffTop = L.hz - Math.round(H * 0.16);
      L.lhX = Math.round(L.cx0 + (W - L.cx0) * 0.55);
      L.pierX1 = Math.round(W * 0.2);
      L.pierY = L.hz + Math.round(H * 0.065);
      L.postX = Math.round(W * 0.665);
      L.postTop = L.shore - 17;
      L.castleX = Math.round(W * 0.39);
      L.castleY = H - 26;
      L.umbX = Math.round(W * 0.6);
      L.umbY = H - 18;
      L.kidX = Math.round(W * 0.16);
      L.kidY = Math.round(H * 0.87);
      L.holes = [0.24, 0.45, 0.53, 0.62].map((f) => Math.round(W * f));
      this.layoutWorld();
      this.t = 0;
      this.effect = null;
      this.night = false; // version nuit du temps (météo en direct, la nuit)
      this.build('none');
    }

    /* ================= Le monde élargi ================= */
    // Une toile de la largeur du monde.
    raster(h = this.H) {
      return new WRaster(this.X0, this.WW, h, this.W);
    }

    // Parties du monde hors du cadre : [[a, b), …].
    extSpans() {
      const s = [];
      if (this.extL) s.push([this.X0, 0]);
      if (this.extR) s.push([this.W, this.X1]);
      return s;
    }

    /* Le monde élargi, à gauche du cadre : le ponton continue et une passerelle descend
     * sur la plage ; une promenade en planches longe une rangée de cabines de plage ; un
     * poste de secours, un filet de beach-volley où jouent deux enfants, un chien ; devant,
     * des dunes et leurs oyats, des ganivelles, un transat, un parasol, une planche de surf.
     * Au large, d'autres voiliers ; au loin, une côte basse. Le rivage reste droit : tout
     * ce qui est posé sur le sable le reste, quel que soit le décalage des plans. */
    layoutWorld() {
      const { W, L, X0 } = this;
      const E = (L.ext = {});
      if (!this.extL) return;
      const fits = (u, r) => Math.round(-u * W) - r >= X0;
      const X = (u) => Math.round(-u * W);
      if (fits(0.21, 4)) {
        E.pierX0 = X(0.2); // bout gauche du ponton
        E.stem = { x0: X(0.12), x1: X(0.22), y1: L.shore + 21 }; // passerelle vers la plage
      }
      E.walkY = L.shore + 21; // promenade en planches (haut)
      if (fits(0.5, 10)) E.tower = { x: X(0.49), y: L.shore + 19 };
      if (fits(0.42, 30)) E.net = { x: X(0.34), y: L.shore + 39, half: 15 };
      if (fits(0.8, 2)) E.huts = { x0: X(0.79), y: L.shore + 20, n: 5, w: 13, gap: 4 };
      E.walkX0 = E.huts ? E.huts.x0 - 8 : X0;
      E.lamps = [0.42, 0.6, 0.86].filter((u) => fits(u, 3)).map((u) => ({ x: X(u), y: E.walkY }));
    }

    // Étoiles du ciel élargi (le ciel libre est donné par free(x, y)).
    paintStarsExt(r, free) {
      const { W, L, T } = this;
      const R = rng(707);
      const hz = L.hz;
      for (const [a, b] of this.extSpans()) {
        const n = Math.round((b - a) * hz * 0.006 * T.stars);
        for (let k = 0; k < n; k++) {
          const x = a + Math.floor(R() * (b - a));
          const y = Math.floor(R() * (hz - 10));
          const v = R();
          const ph = R() * 6.28;
          const sp = 1 + R() * 2.5;
          if (!free(x, y) || (x >= 0 && x < W)) continue;
          const c = v < 0.6 ? C('#7c86b0') : v < 0.85 ? C('#c8d0ec') : v < 0.93 ? C('#ffe8b8') : C('#ffffff');
          r.lock(0, W);
          r.set(x, y, c);
          r.lock();
          if (v > 0.9) this.twinkles.push({ x, y, ph, sp });
        }
      }
    }

    // Une côte basse au loin, dans la brume, avec un clocher minuscule.
    paintHeadland(r, isl, islHi) {
      const { W, L } = this;
      const hz = L.hz;
      const x0 = Math.max(this.X0, Math.round(-1.6 * W));
      const x1 = Math.round(-0.86 * W);
      if (x1 <= x0) return;
      r.lock(0, W);
      for (let x = x0; x < x1; x++) {
        const u = (x - x0) / (x1 - x0);
        const h = Math.round(4 + 3 * Math.sin(u * 5 + 1) * (1 - u) + noise(x * 0.08, 2, 5) * 3 - u * u * 6);
        for (let y = hz - h; y < hz; y++) r.set(x, y, y === hz - h ? islHi : isl);
      }
      const cx = Math.round(x0 + (x1 - x0) * 0.35);
      const top = hz - 8;
      r.rect(cx, top - 6, 2, 6, islHi);
      r.set(cx, top - 7, islHi);
      r.lock();
    }

    // Le sable de la plage élargie : coquillages, galets, étoile de mer, traces de pas.
    paintSandExt(r) {
      const { W, H, L, T } = this;
      const K = this.k;
      const R = rng(717);
      const shell = [C('#f6eee2'), C('#e8b4a8'), C('#d8c8b0')];
      for (const [a, b] of this.extSpans()) {
        const n = b - a;
        for (let k = 0; k < Math.round(n / 16); k++) {
          const x = a + Math.floor(R() * n);
          const y = L.wet1 + 3 + Math.floor(R() * (H - L.wet1 - 6));
          r.set(x, y, shell[0]);
          r.set(x + 1, y, shell[1 + (k % 2)]);
          if (k % 3 === 0) r.set(x, y - 1, shell[2]);
          if (k % 5 === 0) {
            // Coquille Saint-Jacques : éventail rayé.
            for (let i = -2; i <= 2; i++) r.set(x + i, y + 1, i % 2 ? shell[1] : shell[0]);
            for (let i = -1; i <= 1; i++) r.set(x + i, y + 2, shell[2]);
          }
        }
        for (let k = 0; k < Math.round(n / 10); k++) {
          const x = a + Math.floor(R() * n);
          const y = L.wet1 + 2 + Math.floor(R() * (H - L.wet1 - 4));
          r.set(x, y, K.sand[3]);
          r.set(x + 1, y, mix(K.sand[3], K.sand[1], 0.5));
          r.set(x, y - 1, K.sand[2]);
        }
        if (T.litter) {
          const cols = T.litter === 'leaves' ? ['#c8501e', '#e88a2a', '#8a3a1a', '#f0b040'].map(C) : ['#f6b8cc', '#ffd8e4', '#e890ac'].map(C);
          for (let k = 0; k < Math.round(n / 6); k++) {
            const x = a + Math.floor(R() * n);
            const y = L.wet1 + 2 + Math.floor(R() * (H - L.wet1 - 3));
            const c = cols[Math.floor(R() * cols.length)];
            r.set(x, y, c);
            if (R() < 0.5) r.set(x + 1, y, c);
          }
        }
      }
      // Traces de pas qui longent l'eau (elles arrivent de loin), et celles du chien.
      if (this.extL) {
        const x7 = Math.round(W * 0.02);
        for (let x = x7 - 5, k = -1; x > Math.round(-0.7 * W); x -= 5, k--) {
          const y = L.wet1 + 6 + (((k % 2) + 2) % 2) * 2 + Math.round(noise(x * 0.02, 5, 85) * 3);
          r.tint(x, y, K.sand[3], 0.45);
          r.tint(x + 1, y, K.sand[3], 0.35);
          r.tint(x, y + 1, K.sand[2], 0.4);
          if (k % 3 === 0) r.tint(x + 2, y + 4, K.sand[3], 0.35);
        }
        // Étoile de mer et bois flotté.
        const sx = Math.round(-0.3 * W);
        const sy = L.wet1 + 4;
        for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, -1], [0, -2], [-2, 1], [2, 1], [-1, 2], [1, 2], [-3, 1], [3, 1]]) r.set(sx + dx, sy + dy, dx === 0 && dy === 0 ? C('#f8a868') : C('#e8783a'));
        const dwx = Math.round(-1.05 * W);
        for (let k = 0; k < 20; k++) {
          const y = H - 40 + Math.round(k * 0.1);
          r.set(dwx + k, y, C('#b8a088'));
          r.set(dwx + k, y + 1, C('#8a7058'));
          r.set(dwx + k, y + 2, C('#5a4636'));
        }
      }
    }

    // Plan moyen hors du cadre : ponton, passerelle, promenade, cabines, poste de secours,
    // filet de volley, réverbères (cadre verrouillé).
    paintMidExt(r) {
      const E = this.L.ext;
      if (E.pierX0 != null) this.paintPierExt(r);
      if (E.huts) this.paintBoardwalk(r);
      if (E.huts) this.paintHuts(r);
      if (E.tower) this.paintTower(r);
      if (E.net) this.paintNet(r);
      for (const l of E.lamps || []) this.paintLamp(r, l.x, l.y);
    }

    paintPierExt(r) {
      const { L, T } = this;
      const E = L.ext;
      const K = this.k;
      const W0 = K.wood;
      const py = L.pierY;
      const xa = E.pierX0;
      for (let y = py + 3; y < py + 9; y++) for (let x = xa; x < 0; x++) if (bayer(x, y) < 0.5) r.set(x, y, [10, 12, 30], 70);
      for (let px = 2 - 9 * Math.ceil((2 - xa) / 9); px < 0; px += 9) {
        for (let y = py + 2; y < py + 12; y++) {
          const wet = y > py + 7;
          r.set(px, y, wet ? mix(W0[0], [10, 30, 30], 0.5) : W0[1]);
          r.set(px + 1, y, wet ? mix(W0[0], [10, 30, 30], 0.6) : W0[0]);
        }
        r.set(px - 1, py + 8, mix(K.foam, K.sea[2], 0.4), 160);
        r.set(px + 2, py + 8, mix(K.foam, K.sea[2], 0.4), 160);
        for (let y = py + 12; y < py + 17; y++) if (hash(px, y, 29) > 0.3) r.set(px + (y % 2), y, W0[0], 110);
        for (let k = 0; k < 9; k++) r.set(px + 1 + k, py + 3 + Math.round(k * 0.45), W0[0]);
      }
      r.rect(xa, py - 1, -xa, 1, W0[2]);
      r.rect(xa, py, -xa, 2, W0[1]);
      r.rect(xa, py + 2, -xa, 1, W0[0]);
      for (let x = 0; x >= xa; x -= 3) r.set(x, py, W0[0]);
      if (T.snow) r.rect(xa, py - 1, -xa, 1, C('#f2f6fa'));
      for (let px = 1 - 9 * Math.ceil((1 - xa) / 9); px < 0; px += 9) r.rect(px, py - 6, 1, 5, W0[1]);
      r.rect(xa, py - 6, -xa, 1, T.snow ? C('#f2f6fa') : W0[2]);
      r.rect(xa, py - 4, -xa, 1, W0[1]);
      r.rect(xa, py - 6, 1, 6, W0[1]);
      // Passerelle : elle part du ponton et descend vers nous jusqu'au sable (elle
      // s'élargit en approchant), sur ses pilotis.
      const S = E.stem;
      const n = S.y1 - py;
      for (let i = 0; i <= n; i++) {
        const y = py + 1 + i;
        const t = i / n;
        const cx = S.x0 + (S.x1 - S.x0) * t;
        const half = 2.5 + t * 3.5;
        const xa2 = Math.round(cx - half);
        const xb2 = Math.round(cx + half);
        const inWater = y < L.shore + 2;
        // Pilotis sous la passerelle (côté droit, on le voit), dans l'eau.
        if (inWater && i % 6 === 3) {
          for (let k = 1; k <= 4; k++) r.set(xb2 + 1, y + k, k > 2 ? mix(W0[0], [10, 30, 30], 0.5) : W0[0]);
          r.set(xb2 + 2, y + 4, mix(K.foam, K.sea[2], 0.4), 160);
        }
        for (let x = xa2; x <= xb2; x++) {
          let c = i % 3 === 0 ? W0[1] : hash(x >> 1, i, 31) < 0.5 ? W0[2] : mix(W0[2], [255, 240, 220], 0.12);
          if (T.snow && i % 3) c = C('#eef2f6');
          r.set(x, y, c);
        }
        r.set(xb2 + 1, y, W0[0]);
        // Main courante des deux côtés.
        if (i % 4 === 0) {
          r.rect(xa2 - 1, y - 4, 1, 4, W0[1]);
          r.rect(xb2 + 1, y - 4, 1, 4, W0[0]);
        }
        r.set(xa2 - 1, y - 4, W0[2]);
        r.set(xb2 + 1, y - 4, W0[2]);
      }
    }

    // Promenade en planches posée sur le sable, devant les cabines, jusqu'à la passerelle.
    paintBoardwalk(r) {
      const { L, T } = this;
      const E = L.ext;
      const W0 = this.k.wood;
      const y0 = E.walkY;
      const x1 = E.stem ? E.stem.x1 + 6 : -2;
      for (let x = E.walkX0; x <= x1; x++) {
        for (let y = y0; y < y0 + 5; y++) {
          const gap = (x - E.walkX0) % 4 === 3;
          let c = gap ? W0[1] : y === y0 ? mix(W0[2], [255, 240, 220], 0.15) : hash(x >> 2, y, 33) < 0.5 ? W0[2] : mix(W0[2], W0[1], 0.4);
          if (T.snow && !gap && hash(x, y, 34) < 0.7) c = C('#eef2f6');
          r.set(x, y, c);
        }
        r.set(x, y0 + 5, W0[0]);
        r.set(x, y0 + 6, mix(this.k.sand[3], W0[0], 0.5), 120);
      }
    }

    // Rangée de cabines de plage rayées, portes closes, sur leurs petits pilotis.
    paintHuts(r) {
      const { T } = this;
      const E = this.L.ext;
      const Hh = E.huts;
      const cols = ['#3a7ad0', '#e04a4a', '#f0b83a', '#3e9a78', '#e888a8'].map(C);
      const white = C('#f4eee2');
      const shade = [40, 24, 44];
      const lit = this.sunLeft;
      for (let i = 0; i < Hh.n; i++) {
        const hx = Hh.x0 + i * (Hh.w + Hh.gap);
        const base = Hh.y;
        const c = cols[i % cols.length];
        // Ombre portée sur le sable (vers la droite, le soleil est à gauche).
        for (let y = base - 2; y <= base; y++) for (let x = hx + Hh.w; x < hx + Hh.w + 3; x++) r.set(x, y, [60, 40, 40], 60);
        // Murs à rayures verticales, côté droit dans l'ombre.
        for (let y = base - 13; y < base; y++) {
          for (let x = hx; x < hx + Hh.w; x++) {
            let k = Math.floor((x - hx) / 2) % 2 ? white : c;
            if (x === hx + Hh.w - 1 || (x > hx + Hh.w - 4 && !lit)) k = mix(k, shade, 0.35);
            else if (x === hx && lit) k = mix(k, [255, 220, 170], 0.25);
            r.set(x, y, k);
          }
        }
        // Toit à deux pentes, avec un débord.
        for (let k = 0; k < 5; k++) {
          for (let x = hx - 1 + k; x <= hx + Hh.w - k; x++) {
            let rc = k === 0 ? mix(c, [20, 10, 20], 0.35) : mix(c, [20, 10, 20], 0.15);
            if (x > hx + Hh.w / 2) rc = mix(rc, shade, 0.25);
            if (T.snow && k > 0) rc = C(k > 2 || x < hx + Hh.w / 2 ? '#f2f6fa' : '#d0d8e4');
            r.set(x, base - 14 - k, rc);
          }
        }
        // Porte (avec un petit hublot), et le numéro au-dessus.
        const dx = hx + 4;
        r.rect(dx, base - 10, 5, 10, mix(c, [20, 14, 24], 0.45));
        r.rect(dx + 1, base - 9, 3, 9, mix(c, [20, 14, 24], 0.3));
        r.set(dx + 2, base - 7, C('#bcd4e0'));
        r.set(dx + 3, base - 4, C('#e8d8a8'));
        r.set(hx + 6, base - 12, white);
        // Petits pilotis sous le plancher.
        r.set(hx, base, C('#4a3a30'));
        r.set(hx + Hh.w - 1, base, C('#4a3a30'));
      }
    }

    // Poste de secours sur pilotis : cabine blanche et rouge, échelle, bouée.
    paintTower(r) {
      const { T } = this;
      const E = this.L.ext;
      const { x, y } = E.tower;
      const leg = C('#5a4636');
      const legD = C('#3a2c22');
      const top = y - 17;
      // Pieds et croisillons.
      for (let k = 0; k < 17; k++) {
        r.set(x - 5 + Math.round(k * 0.06), y - k, leg);
        r.set(x + 5 - Math.round(k * 0.06), y - k, legD);
      }
      for (let k = 0; k < 9; k++) {
        r.set(x - 4 + k, y - 3 - k, legD);
        r.set(x + 4 - k, y - 3 - k, leg);
      }
      // Plancher, cabine, fenêtre, toit.
      r.rect(x - 7, top, 15, 2, C('#6a5444'));
      const red = C('#d8443a');
      const white = C('#f2ece0');
      for (let yy = top - 9; yy < top; yy++) {
        for (let xx = x - 6; xx <= x + 6; xx++) {
          let c = yy < top - 6 ? white : yy < top - 3 ? C('#2e3a4a') : red;
          if (yy >= top - 6 && yy < top - 3 && (xx === x - 6 || xx === x + 6 || xx === x)) c = white; // montants
          if (yy >= top - 6 && yy < top - 3 && yy === top - 6 && xx > x - 6 && xx < x + 6 && xx !== x) c = C('#5a7a90'); // reflet du ciel
          if (xx > x + 3) c = mix(c, [40, 24, 44], 0.25);
          r.set(xx, yy, c);
        }
      }
      for (let k = 0; k < 3; k++) r.rect(x - 8 + k, top - 10 - k, 17 - k * 2, 1, T.snow && k > 0 ? C('#f2f6fa') : k === 0 ? mix(red, [30, 10, 10], 0.3) : red);
      // Mât du drapeau (le drapeau flotte à chaque image).
      r.rect(x + 6, top - 21, 1, 9, C('#3a3a42'));
      E.flag = { x: x + 7, y: top - 21 };
      // Bouée accrochée, échelle.
      const ring = [[1, 0], [2, 0], [0, 1], [3, 1], [0, 2], [3, 2], [1, 3], [2, 3]];
      ring.forEach(([dx, dy], i) => r.set(x - 10 + dx, top - 7 + dy, i % 3 === 0 ? white : C('#e04a3a')));
      for (let k = 0; k <= 15; k++) {
        const lx = x + 8 + Math.round(k * 0.45);
        r.set(lx, top + 1 + k, leg);
        r.set(lx + 3, top + 1 + k, legD);
        if (k % 3 === 1) r.rect(lx, top + 1 + k, 4, 1, leg);
      }
      E.seat = { x, y: top - 1 };
    }

    // Filet de beach-volley tendu entre deux poteaux (sans filet en hiver).
    paintNet(r) {
      const { T } = this;
      const N = this.L.ext.net;
      const post = C('#e8e2d6');
      const postD = C('#8a8a94');
      const top = N.y - 19;
      for (const px of [N.x - N.half, N.x + N.half]) {
        r.rect(px, top, 1, 20, post);
        r.rect(px + 1, top, 1, 20, postD);
        r.set(px, N.y + 1, mix(this.k.sand[3], [0, 0, 0], 0.2));
        // Haubans.
        const dir = px < N.x ? -1 : 1;
        for (let k = 0; k < 8; k++) r.set(px + dir * (1 + k), top + 2 + Math.round(k * 2.2), C('#bab4a8'));
      }
      if (T.snow) return;
      for (let y = top + 1; y < top + 8; y++) {
        for (let x = N.x - N.half + 2; x < N.x + N.half; x++) {
          if (y === top + 1) r.set(x, y, C('#f6f2ea'));
          else if (y === top + 7) r.set(x, y, C('#f6f2ea'));
          else if ((x + y) % 2 === 0) r.set(x, y, C('#2a2a32'), 150);
        }
      }
    }

    // Réverbère de la promenade (allumé avec les autres lampes de la scène).
    paintLamp(r, x, y) {
      const { T } = this;
      r.rect(x, y - 16, 1, 16, C('#26262e'));
      r.rect(x - 1, y - 1, 3, 1, C('#26262e'));
      r.rect(x - 2, y - 18, 5, 1, C('#26262e'));
      r.rect(x - 1, y - 17, 3, 2, C('#7a8088'));
      if (T.snow) r.rect(x - 2, y - 19, 5, 1, C('#f2f6fa'));
      if (T.lamp) {
        this.emissive.push({ r, x: x - 1, y: y - 17, w: 3, h: 2, c: C('#ffe2a0') });
        this.halosExt.push({ x, y: y - 16, r: 9, c: [255, 210, 140], k: 0.4 });
        // La lampe n'éclaire vraiment le sable que lorsqu'il fait sombre.
        if (T.night || T.walker === 'umbrella' || this.effect === 'snow') this.lightsExt.push({ x, y: y - 15, r: 12, k: 0.5 });
      }
    }

    // Premier plan hors du cadre : dunes et oyats, ganivelles, sentier de planches,
    // transat, glacière, parasol et serviette, planche de surf, seau, ballon.
    paintFrontExt(r, back) {
      const { W, H, T } = this;
      const K = this.k;
      const snowC = [C('#f2f6fa'), C('#d4dce6'), C('#aeb8c8')];
      const X = (u) => Math.round(-u * W);
      const shadow = (cx, cy, rx, ry, k = 0.35) => {
        for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) back.tint(x, y, K.sand[3], k);
      };
      // Dunes : la dune de gauche du fond d'écran continue, puis d'autres, plus loin.
      const v0 = H - 2 - Math.round(20 + noise(0, 7, 90) * 4); // sommet de la dune au bord du cadre
      const DUNE = [[0, 1], [0.05, 1.15], [0.16, 0], [0.55, 0], [0.62, 0.55], [0.72, 0.85], [0.88, 0.7], [0.98, 0], [1.24, 0], [1.32, 0.9], [1.45, 1.25], [1.6, 1]];
      const topAt = (x) => (x >= 0 ? v0 : H - 2 - Math.round(curve(DUNE, -x / W) * (H - 2 - v0) + noise(x * 0.12, 7, 90) * 4 * Math.min(1, curve(DUNE, -x / W))));
      for (let x = this.X0; x < 0; x++) {
        const top = topAt(x);
        if (top >= H - 2) continue;
        const sl = topAt(x + 2) - topAt(x - 2);
        for (let y = top; y < H; y++) {
          const dd = y - top;
          let c = K.sand[0];
          if (sl > 1 || (sl > 0 && bayer(x, y) < 0.5)) c = K.sand[1];
          else if (sl < -1 && dd < 6) c = K.sand[2];
          if (dd === 0) c = sl > 1 ? K.sand[0] : K.sand[2];
          if (Math.sin(x * 0.4 + y * 1.1 + noise(x * 0.05, y * 0.05, 89) * 5) > 0.92) c = mix(c, K.sand[3], 0.4);
          if (hash(x, y, 91) > 0.95) c = K.sand[3];
          if (T.snow) c = dd < 3 || hash(x, y, 92) > 0.35 ? (dd === 0 ? snowC[0] : snowC[sl > 0 ? 1 : 0]) : c;
          r.set(x, y, c);
        }
        if (top < H - 5 && hash(x, 5, 93) > 0.4) {
          const bh = 4 + Math.floor(hash(x, 6, 94) * (T.snow ? 4 : 8));
          this.blades.push({ x, y: top, h: bh, c: K.grass[Math.floor(hash(x, 7, 95) * 3)], ph: hash(x, 8, 96) * 6.28 });
          r.set(x, top - 1, K.grass[0]);
        }
      }
      // Ganivelles (clôtures de lattes) plantées sur les dunes.
      const wood = [C('#8a6a4a'), C('#b8956a'), C('#5a4432')];
      for (const [a, b] of [[0.86, 0.66], [1.5, 1.33]]) {
        for (let x = X(a); x <= X(b); x++) {
          const top = topAt(x);
          if ((x & 1) === 0) {
            const h = 9 + (hash(x, 1, 97) < 0.3 ? 1 : 0);
            for (let k = 2; k < h; k++) r.set(x, top - k + 3, k === h - 1 ? wood[1] : wood[(x >> 1) % 3 === 0 ? 2 : 0]);
          }
          r.set(x, top - 2, C('#6a6a6e'));
          r.set(x, top - 6, C('#6a6a6e'));
        }
      }
      // Sentier de planches qui traverse la dune et descend vers la plage.
      const px = X(0.765);
      for (let y = H - 1; y > topAt(px) - 6; y--) {
        const t = (H - y) / 24;
        const half = Math.max(2, 7 - t * 4);
        const cx = px + Math.round(t * 6);
        for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
          const gap = (H - y) % 3 === 0;
          let c = gap ? wood[2] : x === Math.round(cx - half) ? wood[0] : wood[1];
          if (T.snow && !gap && hash(x, y, 98) < 0.6) c = snowC[1];
          r.set(x, y, c);
        }
      }
      const P = T.props;
      // Transat rayé et glacière (sauf en hiver et sous la pluie).
      if (P.towel || P.umbrella) {
        const tx = X(0.3);
        const ty = H - 9;
        shadow(tx + 6, ty + 2, 9, 2, 0.3);
        const stripe = (k) => (Math.floor(k / 2) % 2 ? C('#f4eee2') : C('#3a7ad0'));
        for (let k = 0; k < 12; k++) r.set(tx + k, ty - Math.round(k * 0.2), stripe(k));
        for (let k = 0; k < 7; k++) r.set(tx + 11 + Math.round(k * 0.35), ty - 2 - k, stripe(k + 12));
        for (const [ax, ay, bx, by] of [[tx, ty + 1, tx + 2, ty - 1], [tx + 10, ty + 2, tx + 11, ty - 2], [tx + 14, ty + 2, tx + 13, ty - 4]]) {
          const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
          for (let k = 0; k <= n; k++) r.set(Math.round(ax + ((bx - ax) * k) / n), Math.round(ay + ((by - ay) * k) / n), C('#a87848'));
        }
        const gx = X(0.25);
        shadow(gx + 3, H - 6, 5, 1, 0.3);
        r.rect(gx, H - 12, 7, 6, C('#e8e2d8'));
        r.rect(gx, H - 12, 7, 1, C('#4a8ab8'));
        r.rect(gx, H - 8, 7, 1, C('#4a8ab8'));
        r.rect(gx + 6, H - 11, 1, 5, C('#b8b2a8'));
        r.rect(gx + 2, H - 14, 3, 1, C('#3a3a40'));
      }
      // Parasol à rayures jaunes et serviette rose, ou un bonhomme de neige en hiver.
      if (P.umbrella || P.towel) {
        const ux = X(1.13);
        const uy = H - 6;
        shadow(ux + 6, uy + 1, 16, 3);
        for (let k = 0; k < 33; k++) r.set(ux + Math.round(k * 0.15), uy - k, k % 6 === 0 ? C('#c8c0b4') : C('#ece6dc'));
        const tx = ux + 5;
        const ty = uy - 33;
        for (let j = 0; j < 9; j++) {
          const hw = Math.round(18 * Math.sqrt(Math.max(0, 1 - ((8 - j) / 8.6) ** 2)));
          for (let x = tx - hw; x <= tx + hw; x++) {
            if (j === 8 && Math.abs(((x - tx + 40) % 6) - 3) > 1) continue;
            const a = (x - tx) / (j + 3);
            let c = Math.floor(a * 1.3 + 20) % 2 ? C('#f0b83a') : C('#f6eee2');
            if (j >= 7) c = mix(c, [40, 20, 30], 0.3);
            if (x > tx + hw * 0.55) c = mix(c, [40, 20, 30], 0.18);
            r.set(x, ty - 2 + j, c);
          }
        }
        r.rect(tx, ty - 4, 1, 2, C('#ece6dc'));
        const ox = ux - 26;
        const oy = uy - 3;
        for (let j = 0; j < 6; j++) for (let x = 0; x < 20; x++) r.set(ox + x - Math.floor(j / 2), oy + j, mix(j % 2 ? C('#e888a8') : C('#f4f0e8'), [255, 255, 255], x === 0 || x === 19 ? 0.3 : 0));
        shadow(ox + 8, oy + 6, 10, 1, 0.2);
        r.rect(ox + 22, oy + 3, 2, 1, C('#3a8ad0'));
        r.rect(ox + 22, oy + 5, 2, 1, C('#3a8ad0'));
      }
      // Planche de surf plantée dans le sable, seau et pelle, ballon de plage.
      if (!T.snow) {
        const sx = X(0.52);
        const sy = H - 6;
        shadow(sx + 4, sy + 1, 6, 1, 0.3);
        for (let k = 0; k < 26; k++) {
          const half = k < 3 ? 1 : k > 22 ? 1 : 2;
          for (let i = -half; i <= half; i++) r.set(sx + i + Math.round(k * 0.12), sy - k, i === 0 ? C('#d8443a') : i < 0 ? C('#f4eee2') : C('#c8c0b4'));
        }
        const bx = X(0.37);
        r.rect(bx, H - 9, 5, 5, C('#3a9ad0'));
        r.rect(bx, H - 9, 5, 1, C('#6ab8e0'));
        r.rect(bx + 4, H - 8, 1, 4, C('#2a6a9a'));
        r.rect(bx, H - 11, 5, 1, C('#2a2a2a'));
        for (let k = 0; k < 6; k++) r.set(bx + 7 + Math.round(k * 0.5), H - 5 - k, C('#f0c040'));
        const cx = X(1.0);
        const cy = H - 7;
        shadow(cx + 2, cy + 3, 4, 1, 0.3);
        for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
          if (x * x + y * y > 10) continue;
          const seg = Math.floor((Math.atan2(y, x) + Math.PI) / (Math.PI / 3)) % 3;
          let c = [C('#e04a3a'), C('#f4eee2'), C('#3a7ad0')][seg];
          if (x + y < -3) c = mix(c, [255, 255, 255], 0.3);
          r.set(cx + x, cy + y, c);
        }
      }
    }

    /* ================= Forme de la falaise ================= */
    cliffTopAt(x) {
      const { L } = this;
      let y = L.cliffTop + Math.round(noise(x * 0.12, 3.3, 7) * 4);
      const sh = L.cx0 + 22 - x; // épaule arrondie côté mer
      if (sh > 0) y += Math.round(sh * sh * 0.03);
      return y;
    }
    cliffEdge(y) {
      const { L } = this;
      const a = Math.min(y, L.shore) - L.cliffTop;
      const b = Math.max(0, y - L.shore);
      return Math.round(L.cx0 + 4 - a * 0.3 - b * 0.25 + (fbm(1.7, y * 0.09, 11, 3) - 0.5) * 8);
    }
    skyAt(y) {
      const s = this.k.sky;
      const t = clamp(y / Math.max(1, this.L.hz - 1), 0, 1) * (s.length - 1);
      const k = Math.min(s.length - 2, Math.floor(t));
      return mix(s[k], s[k + 1], t - k);
    }

    /* ================= Construction complète (au départ et à chaque changement de météo) ================= */
    // night : version nuit de ce temps (voir NIGHT).
    build(effect, night = false) {
      const T = (this.T = themeFor(effect, night));
      this.effect = effect;
      this.night = night;
      const { W, H, L } = this;
      const cv = (a) => a.map(C);
      this.k = {
        sky: cv(T.sky),
        cloud: cv(T.cloud),
        sea: cv(T.sea),
        sand: cv(T.sand),
        rock: cv(T.rock),
        grass: cv(T.grass),
        wood: cv(WOOD),
        tree: T.tree ? cv(T.tree) : null,
        crest: C(T.crest),
        trough: C(T.trough),
        refl: T.refl ? C(T.refl) : null,
        foam: C(T.foam),
        swash: C(T.swash),
        wet: C(T.wet),
      };
      const amb = T.ambient;
      const dim = (c) => [c[0] * amb[0], c[1] * amb[1], c[2] * amb[2]];
      this.dim = dim;
      this.dimK = clamp(1 - (amb[0] + amb[1] + amb[2]) / 3, 0, 0.7);
      // Couleurs du premier plan dessinées à chaque image (assombries la nuit).
      this.cs = { foam: dim(this.k.foam), swash: dim(this.k.swash), wet: dim(mix(this.k.wet, this.k.swash, 0.3)) };

      this.top = new Int16Array(W);
      for (let x = 0; x < W; x++) this.top[x] = this.cliffTopAt(x);
      this.edge = new Int16Array(H + 1);
      for (let y = 0; y <= H; y++) this.edge[y] = this.cliffEdge(y);
      // Bas de la falaise : elle s'arrête au rivage, la plage continue devant.
      this.foot = new Int16Array(W);
      for (let x = 0; x < W; x++) this.foot[x] = L.shore + 4 + Math.round(noise(x * 0.15, 9, 29) * 5);
      // Les mêmes profils sur tout le monde peint (indice x − X0).
      this.topW = new Int16Array(this.WW);
      this.footW = new Int16Array(this.WW);
      for (let i = 0; i < this.WW; i++) {
        const x = i + this.X0;
        this.topW[i] = this.cliffTopAt(x);
        this.footW[i] = L.shore + 4 + Math.round(noise(x * 0.15, 9, 29) * 5);
      }
      const b = T.body;
      this.body = b ? { ...b, x: Math.round(W * b.x), y: L.hz + b.y, c: b.c.map(C) } : null;
      this.sunLeft = !!(b && b.kind === 'sun' && b.x < 0.75);
      this.emissive = [];
      this.lights = [];
      this.lightsExt = []; // lampes des décors ajoutés (hors du cadre)
      this.halosExt = [];
      this.blades = [];

      const back = this.paintBack();
      this.seaTex = this.paintSeaTex().toCanvas();
      const mid = this.paintMid();
      const front = this.paintFront(back);

      // Éclairage peint : le phare, la lampe du ponton, le feu de camp ; la nuit, tout
      // le sable et les rochers sont assombris par la lumière ambiante.
      light(back, this.lights, amb, T.warm, (x, y) => y >= L.shore, this.lightsExt);
      light(mid, this.lights, amb, T.warm, null, this.lightsExt);
      light(front, this.lights, amb, T.warm, null, this.lightsExt);
      for (const e of this.emissive) e.r.rect(e.x, e.y, e.w, e.h, e.c);
      if (T.nightOf) this.paintNightShine(back);
      this.back = back.toCanvas();
      this.mid = mid.toCanvas();
      this.front = front.toCanvas();

      // Halos additifs : soleil ou lune, lanterne du phare, lampe du ponton, feu.
      const halos = [];
      if (this.body) halos.push({ x: this.body.x, y: this.body.y, r: this.body.r * 3.2, c: b.glow, k: b.k });
      if (T.lamp) {
        halos.push({ x: this.lantern.x, y: this.lantern.y, r: 12, c: [255, 228, 160], k: 0.45 });
        halos.push({ x: this.pierLamp.x, y: this.pierLamp.y, r: 9, c: [255, 210, 140], k: 0.4 });
        if (T.night) halos.push({ x: this.houseWin.x, y: this.houseWin.y, r: 6, c: [255, 200, 120], k: 0.35 });
        if (this.fisherLamp) halos.push({ x: this.fisherLamp.x, y: this.fisherLamp.y, r: 8, c: [255, 200, 120], k: 0.45 });
      }
      const { X0, WW } = this;
      this.halo = haloW(X0, WW, H, W, halos);
      this.flashHalo = T.beam > 0 ? haloW(X0, WW, H, W, [{ x: this.lantern.x, y: this.lantern.y, r: 34, c: [255, 236, 180], k: 0.7 }]) : null;
      this.fireHalo = this.fire ? haloW(X0, WW, H, W, [{ x: this.fire.x, y: this.fire.y - 3, r: 30, c: [255, 140, 50], k: 0.6 }]) : null;
      // Monde élargi : lueur des réverbères ajoutés (dessinée avec le plan moyen).
      this.haloExt = this.halosExt.length ? haloW(X0, WW, H, W, [], this.halosExt) : null;

      this.makeSprites();
      this.resetLife();
    }

    // Versions nuit : la lampe du ponton se reflète sur le sable mouillé ; sous la pluie et
    // l'orage, le sable luit et des flaques renvoient le ciel et les lumières. Peint après
    // l'éclairage (ce sont des reflets de lumière). Placé en x de la scène : le centre est le
    // même avec ou sans monde élargi (les flaques hors du cadre sont peintes cadre verrouillé).
    paintNightShine(r) {
      const { W, H, L, T } = this;
      const K = this.k;
      const warm = C('#ffd48a');
      const wetH = L.wet1 - L.shore;
      const lx = L.pierX1 - 2;
      // Prolongement de la colonne de reflets de la lampe sur le sable mouillé.
      if (T.lamp) {
        for (let y = L.shore + 1; y < L.wet1; y++) {
          const tw = (y - L.shore) / wetH;
          const bw = 4 + tw * 2;
          for (let x = Math.floor(lx - bw); x <= Math.ceil(lx + bw); x++) {
            const p = 1 - Math.abs(x - lx) / bw;
            if (p > 0 && hash(x, y, 141) < p * (T.wetShine ? 0.75 : 0.45) * (1 - tw * 0.7)) r.tint(x, y, warm, 0.5 * p + 0.15);
          }
        }
      }
      if (!T.wetShine) return;
      const k = T.wetShine;
      // Le sable mouillé luit : reflets froids du ciel couvert, en tirets horizontaux.
      const sheen = mix(K.sky[K.sky.length - 1], [160, 175, 195], 0.35);
      for (let y = L.shore + 1; y < L.wet1 + 6; y++) {
        const tw = (y - L.shore) / (wetH + 6);
        for (let x = this.X0; x < this.X1; x++) if (hash(x >> 2, y, 143) > 0.86 - (1 - tw) * 0.08 && hash(x, y, 144) > 0.3) r.tint(x, y, sheen, 0.22 * k * (1 - tw));
      }
      // Flaques sur la plage : elles reflètent le ciel, liseré clair sur le bord éloigné.
      const sky = mix(K.sky[K.sky.length - 1], [8, 10, 16], 0.2);
      const sky2 = mix(K.sky[K.sky.length - 1], [120, 132, 150], 0.25);
      const rim = mix(K.sky[K.sky.length - 1], [200, 210, 225], 0.5);
      const mud = mix(K.sand[3], [0, 0, 0], 0.55);
      const puddle = (cx, cy, rx, ry) => {
        for (let y = cy - ry; y <= cy + ry; y++) {
          for (let x = cx - rx; x <= cx + rx; x++) {
            const q = ((x - cx) / rx) ** 2 + ((y - cy) / (ry + 0.5)) ** 2;
            if (q > 1) continue;
            // Ciel reflété (plus clair vers le bas : on y voit l'horizon), bord de sable
            // sombre côté proche, liseré clair côté éloigné, et une étincelle.
            let c = y > cy ? sky2 : sky;
            if (y === cy - ry && q > 0.3) c = rim;
            else if (y === cy + ry && q > 0.45) c = mud;
            else if (hash(x >> 1, y, 147) > 0.78) c = mix(c, rim, 0.45);
            if (x === cx - (rx >> 1) && y === cy) c = C('#dfe6f0');
            // Reflet chaud quand la flaque est sous une lumière.
            const d = Math.abs(x - lx);
            if (d < 6 && hash(x, y, 148) < 0.5) c = mix(c, warm, 0.45);
            r.set(x, y, c);
          }
        }
      };
      const step = 26;
      for (let cell = Math.floor(this.X0 / step); cell * step < this.X1; cell++) {
        if (hash(cell, 1, 151) < 0.3) continue;
        const cx = cell * step + Math.floor(hash(cell, 2, 152) * (step - 12)) + 6;
        const cy = L.wet1 + 4 + Math.floor(hash(cell, 3, 153) * 34);
        const rx = 4 + Math.floor(hash(cell, 4, 154) * 7);
        const ry = 1 + (hash(cell, 5, 155) < 0.4 ? 1 : 0);
        const inside = cx >= 0 && cx < W;
        if (!inside && !this.ext) continue;
        // Pas de flaque sous le château de sable.
        if (cy > L.castleY - 20 && Math.abs(cx - L.castleX) < 30) continue;
        if (!inside) r.lock(0, W);
        puddle(cx, cy, rx, ry);
        r.lock();
      }
    }

    makeSprites() {
      const T = this.T;
      const k = this.dimK;
      const S = (rows, pal, flip) => shade(sprite(rows, pal, flip), k);
      const PP = B.People;
      const night = PP.tint([14, 16, 44], k);
      // Promeneur le long de l'eau : sous son parapluie, ou avec son chien.
      const sets = PP.crowdSets({ hh: 5.2, wet: T.walker === 'umbrella', season: T.snow ? 'winter' : T.litter === 'leaves' ? 'autumn' : 'summer', bake: night, seed: 2 + Math.floor(Math.random() * 20), n: 2 });
      const rim = T.night ? null : { color: '#ffd0a0', dir: [0, -1], k: 0.25 };
      const bake = (sh) => PP.bake(sh, night);
      this.sp = {
        crab: { walk: CRAB.walk.map((f) => S(f, CRAB_PAL)), claws: CRAB.claws.map((f) => S(f, CRAB_PAL)) },
        gull: {},
        boat: S(BOAT, T.night ? { ...BOAT_PAL, s: '#c8c4c8', S: '#a09ca8' } : BOAT_PAL),
        kite: S(KITE, KITE_PAL),
        kid: bake(PP.heroes.kite(T.snow ? KID_WINTER : KID, { hh: 5, rim })),
        fisher: bake(PP.heroes.fisher(FISHER, { hh: 3.2, rim })),
        walker: T.walker === 'umbrella' ? sets.umbrella[0] : sets.dog,
      };
      for (const key of Object.keys(GULL_STAND)) this.sp.gull[key] = S(GULL_STAND[key], GULL_PAL);
      if (this.ext) this.makeSpritesExt(S, bake, rim, night);
    }

    // Monde élargi : le voilier proche, les joueurs de volley, le chien.
    makeSpritesExt(S, bake, rim, night) {
      const { T } = this;
      const PP = B.People;
      const E = this.L.ext;
      this.sp.boat2 = S(BOAT2, T.night ? { ...BOAT_PAL, s: '#c8c4c8', S: '#a09ca8', H: '#2e4a78' } : { ...BOAT_PAL, H: '#2e4a78' });
      // On joue au volley en fin de journée, au printemps et à l'automne (pas la nuit, ni
      // sous la pluie, ni dans la neige).
      this.sp.players = null;
      if (E.net && !T.night && !T.snow && T.walker !== 'umbrella') {
        const cold = T.litter === 'leaves';
        this.sp.players = PLAYERS.map((lk0, i) => {
          const lk = cold ? { ...lk0, topStyle: 'sweater', sleeves: null } : lk0;
          const st = (up) => PP.stand({ armR: { hand: up ? [0.3, 2.75, -0.16] : [0.5, 1.2, -0.2] }, armL: { hand: up ? [0.3, 2.75, 0.16] : [0.5, 1.2, 0.2] } });
          return bake(PP.sheet(lk, { ready: st(false), hit: st(true) }, { hh: 4.4, view: i ? Math.PI - 0.5 : 0.5, rim }));
        });
      }
      // Le chien de la plage (le jour).
      this.sp.dog = null;
      if (!T.night && T.walker !== 'umbrella') {
        const d = PP.dogSheet({ size: 3.4, color: '#c8884a', patch: '#f0e6d4' });
        const cv = (r) => (night(r), r.toCanvas());
        this.sp.dog = { right: d.right.map(cv), left: d.left.map(cv), w: d.w, h: d.h };
      }
    }

    // (Re)lance tout ce qui vit dans la scène.
    resetLife() {
      const { W, L, T } = this;
      const fast = PXC.fastTest();
      this.flock = T.gulls ? new PXC.Flock({ x0: this.X0, x1: this.X1, y0: 12, y1: L.hz - 40, kind: 'gull', rate: T.gulls }) : null;
      if (this.flock) {
        this.flock.frames = this.flock.frames.map((im) => shade(im, this.dimK));
        if (fast) this.flock.next = 0.1;
      }
      this.boat = T.boat ? { x: fast ? W * 0.3 : W * (0.05 + Math.random() * 0.5), v: 1.4 + Math.random() * 0.6 } : null;
      this.crab = null;
      this.nextCrab = fast ? 0.2 : 3 + Math.random() * 6;
      this.walker = null;
      this.nextWalker = fast ? 0.05 : 2 + Math.random() * 6;
      this.gullPost = { pose: 'idle', timer: fast ? 1 : 4 + Math.random() * 6, t: 0 };
      this.fish = null;
      this.splashes = [];
      this.nextFish = fast ? 1 : 4 + Math.random() * 8;
      this.fisher = { lift: 0, next: 10 + Math.random() * 15 };
      this.bolt = null;
      this.nextBolt = fast ? 1 : 3 + Math.random() * 6;
      this.sparks = new PXC.Puffs('255,190,110');
      this.firstWalker = fast;
      // Monde élargi : d'autres voiliers au large, et le chien qui court au bord de l'eau.
      this.boatsExt = [];
      this.dog = null;
      if (!this.ext) return;
      if (T.boat) {
        for (const [u, big, dy] of [[0.13, true, 10], [0.58, false, 2], [1.22, false, 4], [-1.1, false, 1]]) {
          const x = Math.round(-u * W);
          if (x < this.X0 + 4 || x > this.X1 - 16) continue;
          this.boatsExt.push({ x, big, y: L.hz + dy, v: (big ? 0.8 : 1.2) + Math.random() * 0.5, ph: Math.random() * 6 });
        }
      }
      if (this.sp.dog) this.dog = { x: Math.round(-0.3 * W), dir: -1, state: 'run', timer: 3 + Math.random() * 3, t: 0 };
    }

    /* ================= Fond : ciel, astre, nuages, mer, sable ================= */
    paintBack() {
      const { W, H, L, T, X0, X1, WW } = this;
      const K = this.k;
      const r = this.raster();
      const R = rng(7);
      const hz = L.hz;
      // 1 = ciel libre (pas de nuage), pour placer les étoiles ; indice y * WW + x − X0.
      const sky = new Uint8Array(WW * hz);
      const si = (x, y) => y * WW + x - X0;

      r.gradient(X0, 0, WW, hz, K.sky, 4);
      sky.fill(1);

      // Voie lactée (nuit claire) : une bande diagonale poudreuse.
      if (T.milky) {
        const band = C('#34406e');
        const band2 = C('#4a5684');
        for (let y = 0; y < hz - 6; y++) {
          for (let x = X0; x < X1; x++) {
            const cy = hz * 0.05 + x * 0.22;
            const d = Math.abs(y - cy) / 20;
            if (d > 1) continue;
            const n = fbm(x * 0.05, y * 0.07, 33, 3) * (1 - d);
            if (n > 0.3 && bayer(x, y) < (n - 0.3) * 3) r.set(x, y, n > 0.42 ? band2 : band);
            if (hash(x, y, 34) > 0.985 - (1 - d) * 0.02) r.set(x, y, C('#c8d0f0'));
          }
        }
      }

      // Astre : halo peint en paliers autour, puis le disque.
      const bd = this.body;
      if (bd) {
        const gR = bd.r * (bd.kind === 'sun' ? 2.7 : 2.2);
        for (let y = Math.max(0, bd.y - gR); y < Math.min(hz, bd.y + gR); y++) {
          for (let x = Math.max(0, Math.round(bd.x - gR)); x < Math.min(W, bd.x + gR); x++) {
            const d = Math.hypot(x - bd.x, y - bd.y);
            if (d < bd.r || d > gR) continue;
            const q = Math.floor((1 - (d - bd.r) / (gR - bd.r)) * 3 + bayer(x, y) * 0.9) / 3;
            if (q > 0) r.tint(x, y, bd.c[2], q * (bd.kind === 'sun' ? 0.4 : 0.22));
          }
        }
        const gaps = [4, 8, 11, 14, 15, 17, 18, 20];
        for (let y = bd.y - bd.r; y <= bd.y + bd.r && y < hz; y++) {
          if (y < 0) continue;
          if (bd.sliced && gaps.includes(y - bd.y)) continue; // tranches du soleil couchant
          for (let x = bd.x - bd.r; x <= bd.x + bd.r; x++) {
            const d = Math.hypot(x - bd.x, y - bd.y) / bd.r;
            if (d > 1) continue;
            const e = d + (bayer(x, y) - 0.5) * 0.12;
            let c = e < 0.58 ? bd.c[0] : e < 0.85 ? bd.c[1] : bd.c[2];
            if (bd.kind === 'moon') {
              c = bd.c[0];
              if (noise(x * 0.5, y * 0.5, 44) > 0.62) c = bd.c[1]; // mers lunaires
              if (x - bd.x + (y - bd.y) * 0.3 > bd.r * 0.55 && d > 0.6) c = bd.c[2]; // ombre sur le bord
            }
            if (bd.kind === 'pale') {
              r.tint(x, y, bd.c[0], 0.75 - d * 0.35);
              continue;
            }
            r.set(x, y, c);
          }
        }
      }

      // Nuages : bruit étiré à l'horizontale, dessous éclairés par le soleil couchant.
      const thr = T.clouds;
      const NW = WW;
      const NH = hz + 3;
      const N = new Float32Array(NW * NH);
      for (let y = 0; y < NH; y++) {
        const bias = 0.045 * Math.sin(y * 0.12 + 1) - (y < hz * 0.1 ? 0.08 : 0) - (y > hz - 8 ? 0.06 : 0);
        for (let x = X0; x < X1; x++) {
          // On dégage un peu le ciel autour du soleil couchant pour qu'il reste bien visible.
          const clear = bd && bd.sliced && y > hz - 34 ? 0.09 * Math.max(0, 1 - Math.abs(x - bd.x) / (bd.r * 2.6)) : 0;
          N[y * NW + x - X0] = fbm(x * 0.0105 + 5, y * 0.085, 21, 4) + bias - clear;
        }
      }
      for (let y = 0; y < hz - 2; y++) {
        const sk = this.skyAt(y);
        const bodyC = mix(sk, K.cloud[1], 0.82);
        const darkC = mix(sk, K.cloud[0], 0.85);
        for (let x = X0; x < X1; x++) {
          const n = N[y * NW + x - X0];
          if (n <= thr) continue;
          if (n < thr + 0.012 && bayer(x, y) > 0.5) continue; // bord tramé
          const below = N[(y + 2) * NW + x - X0];
          const above = y >= 2 ? N[(y - 2) * NW + x - X0] : 0;
          let c = n > thr + 0.1 ? darkC : bodyC;
          if (below <= thr + 0.015) c = K.cloud[2];
          else if (above <= thr + 0.01 && bayer(x, y) < 0.5) c = mix(c, K.cloud[2], 0.35);
          if (bd && bd.kind !== 'pale') {
            const d = Math.hypot(x - bd.x, y - bd.y);
            if (d < bd.r * 4) c = mix(c, bd.c[0], 0.45 * (1 - d / (bd.r * 4)) * (c === K.cloud[2] ? 1.4 : 0.5));
          }
          r.set(x, y, c);
          sky[si(x, y)] = 0;
        }
      }
      // Fines traînées de nuages près de l'horizon (elles « tranchent » le soleil).
      if (T.streaks) {
        for (let s = 0; s < 3; s++) {
          const y = hz - 5 - s * 6 - (s === 2 ? 3 : 0);
          for (let x = X0; x < X1; x++) {
            const n = noise(x * 0.02, s * 9.1, 51);
            if (n < 0.52) continue;
            const near = bd ? Math.abs(x - bd.x) < bd.r * 2.4 : false;
            r.set(x, y, near ? mix(K.cloud[2], bd.c[0], 0.3) : mix(this.skyAt(y), K.cloud[1], 0.7));
            sky[si(x, y)] = 0;
            if (n > 0.64) {
              r.set(x, y + 1, mix(this.skyAt(y), K.cloud[0], 0.6));
              sky[si(x, y + 1)] = 0;
            }
          }
        }
      }

      // Étoiles (fixes) ; quelques-unes scintilleront à chaque image.
      this.twinkles = [];
      if (T.stars) {
        const n = Math.round(W * hz * 0.006 * T.stars);
        for (let k = 0; k < n; k++) {
          const x = Math.floor(R() * W);
          const y = Math.floor(R() * (hz - 10));
          if (!sky[si(x, y)]) continue;
          if (bd && Math.hypot(x - bd.x, y - bd.y) < bd.r * 2.5) continue;
          const v = R();
          const c = v < 0.6 ? C('#7c86b0') : v < 0.85 ? C('#c8d0ec') : v < 0.93 ? C('#ffe8b8') : C('#ffffff');
          r.set(x, y, c);
          if (v > 0.9 && this.twinkles.length < 26) this.twinkles.push({ x, y, ph: R() * 6.28, sp: 1 + R() * 2.5 });
        }
        if (this.ext) this.paintStarsExt(r, (x, y) => sky[si(x, y)]);
      }

      // Île lointaine sur l'horizon, dans la brume.
      const isl = mix(K.sky[K.sky.length - 1], K.sea[1], 0.5);
      const islHi = mix(isl, K.sky[K.sky.length - 1], 0.4);
      const ix0 = Math.round(W * 0.05);
      const ix1 = Math.round(W * 0.17);
      for (let x = ix0; x < ix1; x++) {
        const u = (x - ix0) / (ix1 - ix0);
        const h = Math.round(Math.pow(Math.sin(u * Math.PI), 0.7) * 5 + (u > 0.55 && u < 0.7 ? 2 : 0) + noise(x * 0.3, 1, 3));
        for (let y = hz - h; y < hz; y++) r.set(x, y, y === hz - h && u < 0.5 ? islHi : isl);
      }
      if (this.ext) this.paintHeadland(r, isl, islHi);

      // Mer : profondeur (sombre au loin, plus claire près du bord), puis ligne de brume.
      r.gradient(X0, hz, WW, L.shore - hz, K.sea, 5);
      r.rect(X0, hz, WW, 1, mix(K.sky[K.sky.length - 1], K.sea[0], 0.45));

      // Sable mouillé qui reflète le ciel (et le soleil).
      const wetH = L.wet1 - L.shore;
      for (let y = L.shore; y < L.wet1; y++) {
        const tw = (y - L.shore) / wetH;
        const m = this.skyAt(clamp(hz - 2 - (y - L.shore) * 5, 0, hz - 1));
        const base = mix(mix(K.wet, K.sand[0], tw * 0.55), m, 0.3 * (1 - tw));
        for (let x = X0; x < X1; x++) {
          let c = base;
          if (hash(x >> 2, y, 71) > 0.72) c = mix(base, m, 0.35);
          if (bd && K.refl) {
            const dx = Math.abs(x - bd.x);
            const bw = bd.r * (bd.kind === 'moon' ? 0.8 : 1.5);
            if (dx < bw && hash(x, y, 73) < (1 - dx / bw) * 0.55 * (1 - tw)) c = mix(c, K.refl, 0.55);
          }
          r.set(x, y, c);
        }
      }
      r.rect(X0, L.shore, WW, 1, mix(K.wet, K.foam, 0.25));

      // Sable sec : dégradé, grain, taches claires et sombres.
      r.gradient(X0, L.wet1, WW, H - L.wet1, [mix(K.wet, K.sand[0], 0.6), K.sand[0], K.sand[0], mix(K.sand[0], K.sand[2], 0.35)], 6);
      for (let y = L.wet1; y < H; y++) {
        for (let x = X0; x < X1; x++) {
          const n = fbm(x * 0.05, y * 0.11, 31, 3);
          if (n > 0.6 && bayer(x, y) < (n - 0.6) * 6) r.tint(x, y, K.sand[2], 0.6);
          else if (n < 0.38 && bayer(x, y) < (0.38 - n) * 6) r.tint(x, y, K.sand[1], 0.6);
          const h = hash(x, y, 35);
          if (h > 0.988) r.set(x, y, K.sand[3]);
          else if (h > 0.976) r.set(x, y, K.sand[2]);
        }
      }
      // Petites rides laissées par le vent.
      for (let y = L.wet1 + 18; y < H - 4; y += 4) {
        for (let x = X0; x < X1; x++) {
          const v = Math.sin(x * 0.18 + noise(x * 0.03, y * 0.1, 37) * 6);
          if (v > 0.93 && hash(x, y, 38) > 0.3) r.tint(x, y + (x % 7 < 3 ? 0 : 1), K.sand[1], 0.45);
        }
      }
      // Laisse de mer : algues, bois flotté, coquillages, galets, étoile de mer.
      const weed = [C('#34442a'), C('#5a4a2a'), C('#46582e')];
      for (let x = X0; x < X1; x++) {
        if (noise(x * 0.07, 1, 81) < 0.6) continue;
        const y = L.wet1 + 1 + Math.round(noise(x * 0.3, 2, 82) * 3);
        r.set(x, y, weed[Math.floor(hash(x, 3, 83) * 3)]);
        if (hash(x, 4, 84) > 0.6) r.set(x, y - 1, weed[2]);
      }
      const shell = [C('#f6eee2'), C('#e8b4a8'), C('#d8c8b0')];
      for (let k = 0; k < Math.round(W / 22); k++) {
        const x = Math.floor(R() * W);
        const y = L.wet1 + 3 + Math.floor(R() * (H - L.wet1 - 6));
        r.set(x, y, shell[0]);
        r.set(x + 1, y, shell[1 + (k % 2)]);
        if (k % 3 === 0) r.set(x, y - 1, shell[2]);
      }
      for (let k = 0; k < Math.round(W / 10); k++) {
        const x = Math.floor(R() * W);
        const y = L.wet1 + 2 + Math.floor(R() * (H - L.wet1 - 4));
        r.set(x, y, K.sand[3]);
        r.set(x + 1, y, mix(K.sand[3], K.sand[1], 0.5));
        r.set(x, y - 1, K.sand[2]);
      }
      const sfx = Math.round(W * 0.47);
      const sfy = H - 12;
      const star = C('#e8783a');
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, -1], [0, -2], [-2, 1], [2, 1], [-1, 2], [1, 2], [-3, 1], [3, 1]]) r.set(sfx + dx, sfy + dy, dx === 0 && dy === 0 ? C('#f8a868') : star);
      // Bois flotté.
      const dwx = Math.round(W * 0.7);
      const dwy = H - 34;
      for (let k = 0; k < 16; k++) {
        const y = dwy + Math.round(k * 0.12);
        r.set(dwx + k, y, C('#b8a088'));
        r.set(dwx + k, y + 1, C('#8a7058'));
        r.set(dwx + k, y + 2, C('#5a4636'));
      }
      r.set(dwx + 4, dwy - 1, C('#b8a088'));
      r.set(dwx + 3, dwy - 2, C('#8a7058'));
      // Traces de pas qui longent l'eau.
      for (let x = Math.round(W * 0.02), k = 0; x < Math.round(W * 0.7); x += 5, k++) {
        const y = L.wet1 + 6 + (k % 2) * 2 + Math.round(noise(x * 0.02, 5, 85) * 3);
        r.tint(x, y, K.sand[3], 0.45);
        r.tint(x + 1, y, K.sand[3], 0.35);
        r.tint(x, y + 1, K.sand[2], 0.4);
      }
      // Trous de crabes.
      for (const hx of L.holes) {
        r.set(hx - 1, L.crabY, C('#4a3426'));
        r.set(hx, L.crabY, C('#3a2a1e'));
        r.set(hx + 1, L.crabY, C('#4a3426'));
        r.tint(hx - 2, L.crabY, K.sand[2], 0.5);
        r.tint(hx + 2, L.crabY, K.sand[2], 0.5);
      }
      // Feuilles mortes ou pétales sur le sable.
      if (T.litter) {
        const cols = T.litter === 'leaves' ? ['#c8501e', '#e88a2a', '#8a3a1a', '#f0b040'].map(C) : ['#f6b8cc', '#ffd8e4', '#e890ac'].map(C);
        for (let k = 0; k < Math.round(W / 6); k++) {
          const x = Math.floor(R() * W);
          const y = L.wet1 + 2 + Math.floor(R() * (H - L.wet1 - 3));
          const c = cols[Math.floor(R() * cols.length)];
          r.set(x, y, c);
          if (R() < 0.5) r.set(x + 1, y, c);
        }
      }
      // Hiver : plaques de neige sur le sable sec.
      if (T.snow) {
        const sn = [C('#eef2f6'), C('#d4dce6'), C('#b4bccc')];
        for (let y = L.wet1 + 3; y < H; y++) {
          const depth = (y - L.wet1) / (H - L.wet1);
          for (let x = X0; x < X1; x++) {
            const n = fbm(x * 0.035, y * 0.09, 41, 3) + depth * 0.18;
            if (n > 0.58) r.set(x, y, fbm(x * 0.035, (y + 1) * 0.09, 41, 3) + depth * 0.18 <= 0.58 ? sn[2] : n > 0.66 ? sn[0] : sn[1]);
            else if (n > 0.55 && bayer(x, y) < 0.5) r.set(x, y, sn[1]);
          }
        }
      }
      // Monde élargi : coquillages, galets, traces et feuilles sur le reste de la plage.
      if (this.ext) {
        r.lock(0, W);
        this.paintSandExt(r);
        r.lock();
      }
      return r;
    }

    // Motif de la mer (crêtes claires, creux sombres, colonne de reflets de l'astre),
    // dessiné à chaque image par bandes légèrement décalées : la mer ondule.
    paintSeaTex() {
      const { L, X0, WW } = this;
      const K = this.k;
      const seaH = L.shore - L.hz;
      const r = new Raster(WW + 8, seaH); // colonne xi = x − X0 + 4
      const bd = this.body;
      const reflK = bd ? (bd.kind === 'pale' ? 0.35 : bd.kind === 'moon' ? 0.7 : 1) : 0;
      const rw = bd && bd.kind === 'moon' ? 0.6 : 1.4; // la lune trace une colonne plus fine
      for (let j = 1; j < seaH; j++) {
        const t = j / (seaH - 1);
        const fx = 0.11 / (0.3 + t * 1.6);
        for (let xi = 0; xi < WW + 8; xi++) {
          const x = xi - 4 + X0;
          const n = noise(x * fx, j * 0.8 + 3, 61);
          if ((t > 0.25 || j % 2 === 0) && n > 0.71 - t * 0.06) r.set(xi, j, K.crest, 110 + t * 120);
          else if (n < 0.24 + t * 0.05) r.set(xi, j, K.trough, 90 + t * 90);
          if (bd && K.refl) {
            const bw = bd.r * 0.3 + t * bd.r * rw;
            const dx = Math.abs(x - bd.x);
            if (dx < bw) {
              const p = 1 - dx / bw;
              const n2 = noise(x * fx * 1.7, j * 0.9 + 7, 67);
              if (n2 > 0.56 - p * 0.36) r.set(xi, j, p > 0.6 ? mix(K.refl, [255, 255, 255], 0.3) : K.refl, Math.round(235 * reflK));
              else if (p > 0.3 && bayer(x + 4, j) < p * 0.4) r.set(xi, j, K.refl, Math.round(70 * reflK));
            }
          }
        }
      }
      // La nuit (versions nuit) : colonnes de reflets chauds sous la lampe du ponton et
      // sous la lanterne du pêcheur, qui ondulent avec la mer.
      if (this.T.nightOf && this.T.lamp) {
        const warm = C('#ffd890');
        const pale = C('#ffeccc');
        const cols = [[L.pierX1 - 2, 1]];
        if (this.T.fisherLamp) cols.push([L.pierX1 - 20, 0.6]);
        for (const [lx, k] of cols) {
          const j0 = L.pierY + 3 - L.hz;
          for (let j = j0; j < seaH; j++) {
            const u = (j - j0) / Math.max(1, seaH - j0);
            const bw = 1.2 + u * 2.8 * k;
            const fade = (1 - u * 0.75) * k;
            for (let x = Math.floor(lx - bw); x <= Math.ceil(lx + bw); x++) {
              const p = 1 - Math.abs(x - lx) / bw;
              if (p <= 0) continue;
              const n2 = noise(x * 0.25, j * 1.3 + 3, 69);
              if (n2 > 0.64 - p * 0.3) r.set(x - X0 + 4, j, p > 0.65 && u < 0.5 ? pale : warm, Math.round(215 * fade));
              else if (p > 0.4 && bayer(x, j) < p * 0.35) r.set(x - X0 + 4, j, warm, Math.round(80 * fade));
            }
          }
        }
      }
      return r;
    }

    /* ================= Plan moyen : falaise, phare, ponton, pieux ================= */
    paintMid() {
      const { W, H, L, T, X0, X1 } = this;
      const K = this.k;
      const r = this.raster();
      const R = rng(21);
      const rock = K.rock;
      const snowC = [C('#f2f6fa'), C('#d0d8e4')];

      // Falaise : relief en facettes (éclairées côté soleil, dans l'ombre de l'autre côté),
      // strates horizontales, fissures, pied mouillé couvert d'algues, herbe sur le dessus.
      const hg = (xx, yy) => fbm(xx * 0.05, yy * 0.035, 17, 3);
      const lit = this.sunLeft ? rock[3] : rock[2];
      for (let y = 0; y < H; y++) {
        const ex = this.edge[y];
        for (let x = Math.max(X0, ex); x < X1; x++) {
          const tp = this.topW[x - X0];
          if (y < tp || y > this.footW[x - X0]) continue;
          const d = x - ex;
          const dt = y - tp;
          const sl = hg(x + 1.5, y) - hg(x - 1.5, y) + (hg(x, y + 1.5) - hg(x, y - 1.5)) * 0.6;
          let c = rock[1];
          if (sl < -0.022 || (sl < -0.01 && bayer(x, y) < 0.5)) c = rock[2];
          else if (sl > 0.022 || (sl > 0.01 && bayer(x, y) < 0.5)) c = rock[0];
          // Strates d'épaisseur irrégulière ; les corniches ne sont marquées que par endroits.
          const s = y + Math.round((noise(x * 0.025, 0.5, 13) - 0.5) * 16);
          const layer = Math.floor(s / 9);
          const ledge = noise(x * 0.07, layer * 1.7, 14) > 0.5;
          if (ledge && s % 9 === 0) c = mix(rock[0], [0, 0, 0], 0.12); // ombre sous la corniche
          else if (ledge && s % 9 === 1 && c !== rock[0]) c = mix(c, rock[2], 0.55); // arête éclairée
          if (fbm(x * 0.02, y * 0.025, 15, 2) > 0.62 && c !== rock[0]) c = mix(c, rock[3], 0.18); // veines plus claires
          if (d < 2) c = lit;
          else if (d < 12 && bayer(x, y) < ((12 - d) / 12) * 0.55 && c !== rock[0]) c = mix(c, lit, 0.55);
          // Pied de falaise mouillé, avec des algues.
          if (y > L.shore - 6 - Math.round(noise(x * 0.2, 4, 22) * 4)) {
            c = mix(c, [10, 14, 20], 0.25);
            if (hash(x, y, 23) > 0.82) c = C('#3a5430');
          }
          if (dt < 2) c = K.grass[dt === 0 ? 2 : 1];
          else if (dt < 4 && hash(x, y, 3) > 0.5) c = K.grass[0];
          if (T.snow) {
            if (dt < 3) c = dt === 2 ? snowC[1] : snowC[0];
            else if (ledge && s % 9 === 2 && hash(x >> 1, layer, 24) > 0.45) c = snowC[sl < 0 ? 0 : 1]; // neige sur les corniches
          }
          r.set(x, y, c);
        }
      }
      // Herbe qui retombe sur le haut de la face.
      for (let x = this.edge[L.cliffTop + 20] - 6; x < X1; x++) {
        const tp = this.topW[x - X0];
        if (x < this.edge[tp + 2] || hash(x, 9, 31) < 0.6) continue;
        const n = 1 + Math.floor(hash(x, 10, 32) * 4);
        for (let k = 2; k < 2 + n; k++) r.set(x, tp + k, T.snow ? snowC[1] : K.grass[k === 1 + n ? 0 : 1]);
      }
      // Éboulis au pied de la falaise, sur le sable.
      for (let k = 0; k < 9; k++) {
        const x0 = this.edge[L.shore] + 4 + Math.floor(hash(k, 1, 35) * (W - this.edge[L.shore]));
        const y0 = this.foot[Math.min(W - 1, x0)] + 1;
        const rx = 2 + Math.floor(hash(k, 2, 36) * 3);
        for (let y = y0 - rx; y <= y0 + 1; y++) {
          for (let x = x0 - rx; x <= x0 + rx; x++) {
            if (((x - x0) / rx) ** 2 + ((y - y0) / (rx * 0.8)) ** 2 > 1) continue;
            r.set(x, y, y < y0 - rx * 0.4 ? (x < x0 ? lit : rock[2]) : y > y0 ? rock[0] : rock[1]);
          }
        }
      }
      // Touffes d'herbe au bord du plateau.
      for (let x = L.cx0 - 10; x < X1; x++) {
        if (hash(x, 1, 26) < 0.55) continue;
        const tp = this.topW[x - X0];
        if (x < this.edge[tp + 1]) continue;
        const h = 1 + Math.floor(hash(x, 2, 27) * 3);
        for (let k = 1; k <= h; k++) r.set(x + (k === h && hash(x, 3, 28) > 0.5 ? 1 : 0), tp - k, T.snow ? snowC[k === 1 ? 1 : 0] : K.grass[k === h ? 2 : 1]);
      }
      // Rochers au pied de la falaise, dans l'eau.
      this.rockFoam = [];
      const fx = this.edge[L.shore - 4];
      for (const [ox, oy, rx, ry] of [[-9, -3, 5, 3], [-17, -1, 3, 2], [-4, 2, 4, 3], [-24, -6, 2, 2]]) {
        const cx = fx + ox;
        const cy = L.shore + oy;
        for (let y = cy - ry; y <= cy + ry; y++) {
          for (let x = cx - rx; x <= cx + rx; x++) {
            const q = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
            if (q > 1) continue;
            let c = rock[1];
            if (y < cy - ry * 0.3) c = rock[2];
            if (x < cx && y < cy && this.sunLeft) c = rock[3];
            if (y > cy + ry * 0.4) c = rock[0];
            if (T.snow && y === cy - ry) c = snowC[0];
            r.set(x, y, c);
          }
        }
        for (let x = cx - rx - 1; x <= cx + rx + 1; x++) this.rockFoam.push({ x, y: cy + Math.round(ry * 0.5) });
      }

      this.paintTree(r, R);
      this.paintHouse(r);
      this.paintLighthouse(r);
      this.paintPier(r);

      // Pieux dans l'eau peu profonde (une mouette se pose sur celui du milieu).
      const W0 = K.wood;
      for (const [px, top, broken] of [[L.postX - 13, L.postTop + 6, false], [L.postX, L.postTop, false], [L.postX + 12, L.postTop + 4, true]]) {
        const bottom = L.shore - 1;
        for (let y = top; y < bottom; y++) {
          const under = y > bottom - 5;
          r.set(px - 1, y, under ? mix(W0[0], [20, 40, 30], 0.4) : W0[2]);
          r.set(px, y, under ? mix(W0[1], [20, 50, 30], 0.5) : W0[1]);
          r.set(px + 1, y, W0[0]);
          if (!under && (y - top) % 6 === 3) r.set(px, y, W0[0]); // veinage
        }
        if (broken) {
          r.set(px + 1, top, [0, 0, 0], 0);
          r.set(px, top - 1, W0[2]);
        } else r.rect(px - 1, top, 3, 1, mix(W0[2], [255, 240, 220], 0.25));
        if (T.snow && !broken) r.rect(px - 1, top - 1, 3, 1, snowC[0]);
        // Reflet sombre et tremblé sous le pieu.
        for (let y = bottom; y < bottom + 1; y++) r.set(px, y, W0[0], 120);
      }
      // Corde enroulée autour du pieu de la mouette.
      r.set(L.postX - 1, L.postTop + 6, C('#d8c8a0'));
      r.set(L.postX, L.postTop + 7, C('#d8c8a0'));
      r.set(L.postX + 1, L.postTop + 6, C('#b8a880'));
      // Monde élargi : le ponton continue, la promenade, les cabines, le poste de secours.
      if (this.ext) {
        r.lock(0, W);
        this.paintMidExt(r);
        r.lock();
      }
      return r;
    }

    paintTree(r, R) {
      const { L, T } = this;
      const K = this.k;
      const tx = L.cx0 + 14;
      const base = this.top[tx];
      const trunk = C('#3a2a22');
      // Tronc penché par le vent du large.
      for (let k = 0; k < 11; k++) {
        const x = tx + Math.round(k * k * 0.04);
        r.set(x, base - k, trunk);
        if (k < 6) r.set(x + 1, base - k, mix(trunk, [0, 0, 0], 0.3));
      }
      r.set(tx - 2, base - 6, trunk);
      r.set(tx - 3, base - 7, trunk);
      r.set(tx + 6, base - 8, trunk);
      r.set(tx + 7, base - 9, trunk);
      if (!K.tree) {
        // Arbre nu, branches poudrées de neige.
        for (const [x, y] of [[-4, -8], [-3, -9], [8, -10], [9, -11], [2, -12], [3, -13], [4, -14]]) {
          r.set(tx + x, base + y, trunk);
          r.set(tx + x, base + y - 1, C('#f2f6fa'));
        }
        return;
      }
      for (let k = 0; k < 70; k++) {
        const a = R() * Math.PI * 2;
        const d = Math.sqrt(R());
        const cx = Math.round(tx + 3 + Math.cos(a) * d * 10);
        const cy = Math.round(base - 13 + Math.sin(a) * d * 5);
        const lit = cy < base - 13 && cx < tx + 4;
        const c = lit ? K.tree[2] : d > 0.7 && cy > base - 13 ? K.tree[0] : K.tree[1];
        r.set(cx, cy, c);
        r.set(cx + 1, cy, c);
        if (k % 2) r.set(cx, cy - 1, k % 4 === 1 ? K.tree[2] : K.tree[1]);
      }
    }

    paintHouse(r) {
      const { L, T } = this;
      const hx = L.lhX - 27;
      let base = 0;
      for (let x = hx; x < hx + 16; x++) base = Math.max(base, this.top[x]);
      base += 1;
      const wall = C('#e8e0d0');
      const wallSh = C('#b8ac9c');
      const roof = [C('#7a2e26'), C('#b84a3a'), C('#d86a4e')];
      r.rect(hx, base - 9, 16, 10, wall);
      r.rect(hx + 12, base - 9, 4, 10, wallSh);
      r.rect(hx, base, 16, 1, C('#5a5048'));
      for (let k = 0; k < 6; k++) {
        r.rect(hx - 1 + k, base - 10 - k, 18 - k * 2, 1, k === 0 ? roof[0] : k < 3 ? roof[1] : roof[2]);
      }
      if (T.snow) for (let k = 2; k < 6; k++) r.rect(hx - 1 + k, base - 11 - k, 18 - k * 2, 1, C('#f2f6fa'));
      r.rect(hx + 11, base - 17, 2, 4, C('#5a4a42')); // cheminée
      r.rect(hx + 3, base - 5, 3, 5, C('#4a3028')); // porte
      r.rect(hx + 8, base - 7, 3, 3, C('#2e3a4a')); // fenêtre
      r.set(hx + 9, base - 7, C('#5a6a7a'));
      this.houseWin = { x: hx + 9, y: base - 6 };
      this.chimney = { x: hx + 11, y: base - 18 };
      if (T.lamp && (T.night || T.walker === 'umbrella' || this.effect === 'snow')) {
        this.emissive.push({ r, x: hx + 8, y: base - 7, w: 3, h: 3, c: C('#ffd890') });
        this.lights.push({ x: hx + 9, y: base - 6, r: 6, k: 0.3 });
      }
    }

    paintLighthouse(r) {
      const { H, L, T } = this;
      const x0 = L.lhX;
      let base = 0;
      for (let x = x0 - 6; x <= x0 + 6; x++) base = Math.max(base, this.top[x]);
      base += 2;
      const tH = Math.round(H * 0.18);
      const y0 = base - tH;
      const red = C('#c43a32');
      const white = C('#f2ece0');
      const dark = C('#262630');
      const sunC = this.body ? this.body.c[2] : white;
      for (let y = y0; y < base; y++) {
        const u = (base - y) / tH;
        const half = Math.round(5.5 - u * 2);
        const c0 = Math.floor((base - y) / 7) % 2 === 1 ? red : white;
        for (let x = x0 - half; x <= x0 + half; x++) {
          const sx = (x - (x0 - half)) / (2 * half);
          let c = c0;
          if (sx > 0.86) c = mix(c0, [20, 12, 34], 0.5);
          else if (sx > 0.66) c = mix(c0, [20, 12, 34], 0.28);
          else if (sx < 0.2 && this.sunLeft) c = mix(c0, sunC, 0.35);
          r.set(x, y, c);
        }
      }
      // Porte, hublots, socle.
      r.rect(x0 - 1, base - 6, 3, 6, C('#3a2a24'));
      r.set(x0, base - 7, C('#3a2a24'));
      r.rect(x0 - 6, base - 1, 13, 2, C('#8a8478'));
      for (const wy of [y0 + 10, y0 + 24]) r.rect(x0, wy, 1, 2, dark);
      // Galerie, garde-corps, lanterne, dôme et paratonnerre.
      r.rect(x0 - 6, y0 - 1, 13, 2, dark);
      r.rect(x0 - 6, y0 - 4, 13, 1, dark);
      for (let x = x0 - 6; x <= x0 + 6; x += 2) r.set(x, y0 - 3, dark), r.set(x, y0 - 2, dark);
      r.rect(x0 - 3, y0 - 10, 7, 6, C('#9ab0bc'));
      r.rect(x0 - 3, y0 - 10, 1, 6, dark);
      r.rect(x0 + 3, y0 - 10, 1, 6, dark);
      r.rect(x0, y0 - 10, 1, 6, dark);
      r.rect(x0 - 4, y0 - 11, 9, 1, dark);
      r.rect(x0 - 3, y0 - 12, 7, 1, red);
      r.rect(x0 - 2, y0 - 13, 5, 1, red);
      r.rect(x0 - 1, y0 - 14, 3, 1, mix(red, [0, 0, 0], 0.3));
      r.rect(x0, y0 - 17, 1, 3, dark);
      if (T.snow) {
        r.rect(x0 - 2, y0 - 14, 5, 1, C('#f2f6fa'));
        r.rect(x0 - 6, y0 - 5, 13, 1, C('#f2f6fa'));
      }
      this.lantern = { x: x0, y: y0 - 7 };
      this.lanternRect = { x: x0 - 2, y: y0 - 9, w: 5, h: 4 };
      if (T.lamp) {
        this.emissive.push({ r, x: x0 - 2, y: y0 - 9, w: 2, h: 4, c: C('#ffe9a0') });
        this.emissive.push({ r, x: x0 + 1, y: y0 - 9, w: 2, h: 4, c: C('#ffe9a0') });
        this.lights.push({ x: x0, y: y0 - 7, r: 16, k: 0.6 });
      }
    }

    paintPier(r) {
      const { L, T } = this;
      const K = this.k;
      const W0 = K.wood;
      const py = L.pierY;
      const x1 = L.pierX1;
      // Ombre du ponton sur l'eau.
      for (let y = py + 3; y < py + 9; y++) for (let x = 0; x < x1; x++) if (bayer(x, y) < 0.5) r.set(x, y, [10, 12, 30], 70);
      // Pilotis et croisillons.
      for (let px = 2; px < x1 - 1; px += 9) {
        for (let y = py + 2; y < py + 12; y++) {
          const wet = y > py + 7;
          r.set(px, y, wet ? mix(W0[0], [10, 30, 30], 0.5) : W0[1]);
          r.set(px + 1, y, wet ? mix(W0[0], [10, 30, 30], 0.6) : W0[0]);
        }
        r.set(px - 1, py + 8, mix(K.foam, K.sea[2], 0.4), 160); // petit remous au pied
        r.set(px + 2, py + 8, mix(K.foam, K.sea[2], 0.4), 160);
        for (let y = py + 12; y < py + 17; y++) if (hash(px, y, 29) > 0.3) r.set(px + (y % 2), y, W0[0], 110); // reflet
        if (px + 9 < x1 - 1) for (let k = 0; k < 9; k++) r.set(px + 1 + k, py + 3 + Math.round(k * 0.45), W0[0]);
      }
      // Platelage.
      r.rect(0, py - 1, x1, 1, W0[2]);
      r.rect(0, py, x1, 2, W0[1]);
      r.rect(0, py + 2, x1, 1, W0[0]);
      for (let x = 0; x < x1; x += 3) r.set(x, py, W0[0]);
      if (T.snow) r.rect(0, py - 1, x1, 1, C('#f2f6fa'));
      // Garde-corps.
      for (let px = 1; px < x1 - 2; px += 9) r.rect(px, py - 6, 1, 5, W0[1]);
      r.rect(0, py - 6, x1 - 2, 1, T.snow ? C('#f2f6fa') : W0[2]);
      r.rect(0, py - 4, x1 - 2, 1, W0[1]);
      // Bouée accrochée au garde-corps.
      const bx = Math.round(x1 * 0.45);
      const ring = [[1, 0], [2, 0], [0, 1], [3, 1], [0, 2], [3, 2], [1, 3], [2, 3]];
      ring.forEach(([dx, dy], i) => r.set(bx + dx, py - 7 + dy, i % 3 === 0 ? C('#f2ece0') : C('#e04a3a')));
      // Réverbère au bout du ponton.
      const lx = x1 - 2;
      r.rect(lx, py - 15, 1, 14, C('#26262e'));
      r.rect(lx - 2, py - 17, 5, 1, C('#26262e'));
      r.rect(lx - 1, py - 16, 3, 2, C('#7a8088'));
      this.pierLamp = { x: lx, y: py - 15 };
      if (T.lamp) {
        this.emissive.push({ r, x: lx - 1, y: py - 16, w: 3, h: 2, c: C('#ffe2a0') });
        this.lights.push({ x: lx, y: py - 14, r: 12, k: 0.5 });
      }
      // Nuit claire : le pêcheur a posé sa lanterne à côté de lui sur le ponton.
      this.fisherLamp = null;
      if (T.fisherLamp) {
        const fx = x1 - 20;
        const dk = C('#2a2420');
        r.set(fx, py - 7, dk); // anse
        r.rect(fx - 1, py - 6, 3, 1, dk);
        r.set(fx - 1, py - 5, dk);
        r.set(fx + 1, py - 5, dk);
        r.set(fx - 1, py - 4, dk);
        r.set(fx + 1, py - 4, dk);
        r.rect(fx - 1, py - 3, 3, 1, dk);
        r.rect(fx - 2, py - 2, 5, 1, mix(dk, [0, 0, 0], 0.3)); // ombre sur les planches
        this.emissive.push({ r, x: fx, y: py - 5, w: 1, h: 2, c: C('#ffe6a0') });
        this.lights.push({ x: fx, y: py - 4, r: 10, k: 0.55 });
        this.fisherLamp = { x: fx, y: py - 4 };
      }
    }

    /* ================= Premier plan : dunes, parasol, château, feu ================= */
    paintFront(back) {
      const { W, H, L, T } = this;
      const K = this.k;
      const r = this.raster();
      const R = rng(33);
      const snowC = [C('#f2f6fa'), C('#d4dce6'), C('#aeb8c8')];
      const shadow = (cx, cy, rx, ry, k = 0.35) => {
        for (let y = cy - ry; y <= cy + ry; y++) {
          for (let x = cx - rx; x <= cx + rx; x++) {
            if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) back.tint(x, y, K.sand[3], k);
          }
        }
      };

      // Dunes avec oyats (les brins bougent à chaque image).
      // xa, xb : colonnes à peindre (par défaut [x0, x1) ; au-delà, le profil continue à plat).
      const dune = (x0, x1, h, left, xa = x0, xb = x1) => {
        const topAt = (x) => {
          const u = clamp((x - x0) / (x1 - x0), 0, 1);
          const prof = left ? 1 - u ** 1.8 : Math.sin(Math.min(1, u * 1.5) * Math.PI * 0.5) ** 0.8;
          return H - 2 - Math.round(prof * h + noise(x * 0.12, 7, 90) * 4 * prof);
        };
        for (let x = xa; x < xb; x++) {
          const top = topAt(x);
          const sl = topAt(x + 2) - topAt(x - 2); // > 0 : la pente descend vers la droite (à l'ombre)
          for (let y = top; y < H; y++) {
            const dd = y - top;
            let c = K.sand[0];
            if (sl > 1 || (sl > 0 && bayer(x, y) < 0.5)) c = K.sand[1];
            else if (sl < -1 && dd < 6) c = K.sand[2];
            if (dd === 0) c = sl > 1 ? K.sand[0] : K.sand[2];
            if (Math.sin(x * 0.4 + y * 1.1 + noise(x * 0.05, y * 0.05, 89) * 5) > 0.92) c = mix(c, K.sand[3], 0.4); // rides
            if (hash(x, y, 91) > 0.95) c = K.sand[3];
            if (T.snow) c = dd < 3 || hash(x, y, 92) > 0.35 ? (dd === 0 ? snowC[0] : snowC[sl > 0 ? 1 : 0]) : c;
            r.set(x, y, c);
          }
          if (hash(x, 5, 93) > 0.4) {
            const bh = 4 + Math.floor(hash(x, 6, 94) * (T.snow ? 4 : 8));
            this.blades.push({ x, y: top, h: bh, c: K.grass[Math.floor(hash(x, 7, 95) * 3)], ph: hash(x, 8, 96) * 6.28 });
            r.set(x, top - 1, K.grass[0]);
          }
        }
      };
      dune(0, Math.round(W * 0.15), 20, true);
      dune(Math.round(W * 0.8), W, 14, false);
      // Monde élargi : la dune de droite continue derrière le bord.
      if (this.extR) {
        r.lock(0, W);
        dune(Math.round(W * 0.8), W, 14, false, W, this.X1);
        r.lock();
      }

      const P = T.props;
      // Parasol rayé, serviette, sac de plage.
      if (P.umbrella) {
        const ux = L.umbX;
        const uy = L.umbY;
        shadow(ux + 4, uy + 1, 17, 3);
        const tx = ux - 4;
        const ty = uy - 31;
        for (let k = 0; k < 31; k++) {
          const x = ux - Math.round(k * 0.13);
          r.set(x, uy - k, k % 6 === 0 ? C('#c8c0b4') : C('#ece6dc'));
        }
        const red = C('#e04a4a');
        const wht = C('#f6eee2');
        for (let j = 0; j < 9; j++) {
          const hw = Math.round(17 * Math.sqrt(Math.max(0, 1 - ((8 - j) / 8.6) ** 2)));
          for (let x = tx - hw; x <= tx + hw; x++) {
            if (j === 8 && Math.abs(((x - tx + 40) % 6) - 3) > 1) continue; // festons
            const a = (x - tx) / (j + 3);
            let c = Math.floor(a * 1.3 + 20) % 2 ? red : wht;
            if (j >= 7) c = mix(c, [40, 20, 30], 0.3);
            if (x > tx + hw * 0.55) c = mix(c, [40, 20, 30], 0.18);
            if (j < 3 && x < tx) c = mix(c, [255, 255, 255], 0.2);
            r.set(x, ty - 2 + j, c);
          }
        }
        r.rect(tx, ty - 4, 1, 2, C('#ece6dc'));
      }
      if (P.towel) {
        const ox = (P.fire ? L.umbX + 14 : L.umbX - 22);
        const oy = L.umbY - 4;
        const cols = [C('#3a7ac0'), C('#f4f0e8'), C('#f0c040'), C('#f4f0e8')];
        for (let j = 0; j < 7; j++) {
          for (let x = 0; x < 24; x++) r.set(ox + x - Math.floor(j / 2), oy + j, mix(cols[Math.floor(j / 2) % 4], [255, 255, 255], x === 0 || x === 23 ? 0.3 : 0));
        }
        for (let j = 0; j < 7; j += 2) {
          r.set(ox - 1 - Math.floor(j / 2), oy + j, C('#f4f0e8'));
          r.set(ox + 24 - Math.floor(j / 2), oy + j, C('#f4f0e8'));
        }
        shadow(ox + 10, oy + 7, 12, 1, 0.2);
        // Livre ouvert, tongs, crème solaire.
        r.rect(ox + 15, oy + 2, 3, 2, C('#c84a3a'));
        r.rect(ox + 18, oy + 2, 3, 2, C('#f4ecdc'));
        r.rect(ox + 26, oy + 5, 2, 1, C('#e8508a'));
        r.rect(ox + 26, oy + 7, 2, 1, C('#e8508a'));
        r.rect(ox + 4, oy - 1, 2, 4, C('#f08a2a'));
        r.set(ox + 4, oy - 2, C('#f4f0e8'));
        // Sac de plage en paille.
        const sx = ox - 9;
        r.rect(sx, oy + 1, 7, 5, C('#d8b070'));
        r.rect(sx, oy + 1, 7, 1, C('#ecc888'));
        for (let x = sx; x < sx + 7; x += 2) r.set(x, oy + 3, C('#b08a50'));
        r.set(sx + 1, oy, C('#8a6a3a'));
        r.set(sx + 2, oy - 1, C('#8a6a3a'));
        r.set(sx + 4, oy - 1, C('#8a6a3a'));
        r.set(sx + 5, oy, C('#8a6a3a'));
        r.rect(sx + 1, oy + 1, 2, 1, C('#3a8a9a'));
      }

      // Château de sable avec son drapeau, seau et pelle.
      if (P.castle) {
        const cx = L.castleX;
        const cy = L.castleY;
        shadow(cx + 3, cy + 1, 18, 3);
        const sA = mix(K.sand[1], K.sand[3], 0.25);
        const sL = K.sand[0];
        const sD = mix(K.sand[3], [40, 20, 20], 0.15);
        for (let y = cy - 2; y <= cy + 1; y++) for (let x = cx - 16; x <= cx + 16; x++) if (((x - cx) / 16) ** 2 + ((y - cy + 0.5) / 2.5) ** 2 <= 1) r.set(x, y, y === cy - 2 ? sL : sA);
        const block = (x, y, w, h) => {
          r.rect(x, y, w, h, sA);
          r.rect(x, y, w, 1, sL);
          r.rect(x + w - 1, y + 1, 1, h - 1, sD);
          for (let k = 0; k < w; k += 2) r.set(x + k, y - 1, sL); // créneaux
        };
        block(cx - 11, cy - 7, 22, 6);
        block(cx - 13, cy - 12, 5, 11);
        block(cx + 8, cy - 12, 5, 11);
        block(cx - 4, cy - 16, 9, 15);
        r.rect(cx - 1, cy - 5, 3, 4, sD); // porte
        r.set(cx, cy - 6, sD);
        r.set(cx - 11, cy - 9, sD);
        r.set(cx + 10, cy - 9, sD);
        r.set(cx, cy - 12, sD);
        for (let k = 0; k < 4; k++) r.set(cx - 15 + k * 9, cy - 1, mix(sA, sD, 0.5));
        r.rect(cx, cy - 22, 1, 6, C('#5a3a2a'));
        this.flag = { x: cx + 1, y: cy - 22 };
        // Seau et pelle.
        const bx = cx + 19;
        r.rect(bx, cy - 5, 5, 5, C('#e04a3a'));
        r.rect(bx, cy - 5, 5, 1, C('#f07a5a'));
        r.rect(bx + 4, cy - 4, 1, 4, C('#a8302a'));
        r.set(bx - 1, cy - 6, C('#2a2a2a'));
        r.set(bx + 5, cy - 6, C('#2a2a2a'));
        r.rect(bx, cy - 7, 5, 1, C('#2a2a2a'));
        for (let k = 0; k < 7; k++) r.set(bx + 8 + Math.round(k * 0.5), cy - 1 - k, C('#3a7ad0'));
        r.rect(bx + 7, cy - 1, 3, 2, C('#2a5aa0'));
      } else this.flag = null;

      // Bonhomme de neige (hiver).
      if (P.snowman) {
        const cx = L.castleX;
        const cy = L.castleY;
        shadow(cx + 3, cy + 1, 10, 2);
        const ball = (y, rad) => {
          for (let yy = -rad; yy <= rad; yy++) {
            for (let xx = -rad; xx <= rad; xx++) {
              const q = (xx * xx + yy * yy) / (rad * rad);
              if (q > 1) continue;
              r.set(cx + xx, y + yy, xx + yy > rad * 0.5 ? snowC[2] : xx + yy > -rad * 0.3 ? snowC[1] : snowC[0]);
            }
          }
        };
        ball(cy - 5, 6);
        ball(cy - 14, 4);
        ball(cy - 21, 3);
        r.set(cx - 1, cy - 22, C('#1a1a1a'));
        r.set(cx + 1, cy - 22, C('#1a1a1a'));
        r.rect(cx + 1, cy - 21, 2, 1, C('#f08a2a'));
        r.rect(cx - 3, cy - 18, 7, 2, C('#c83a32'));
        r.rect(cx + 2, cy - 17, 2, 4, C('#c83a32'));
        r.rect(cx - 3, cy - 25, 7, 1, C('#2a2a2a'));
        r.rect(cx - 2, cy - 28, 5, 3, C('#2a2a2a'));
        for (let k = 0; k < 6; k++) {
          r.set(cx - 5 - k, cy - 15 - Math.round(k * 0.6), C('#5a3a2a'));
          r.set(cx + 5 + k, cy - 15 - Math.round(k * 0.5), C('#5a3a2a'));
        }
        for (const dy of [-13, -10, -6]) r.set(cx, cy + dy, C('#2a2a2a'));
      }

      // Feu de camp (nuit d'été) : cercle de galets et bûches ; les flammes bougent.
      this.fire = null;
      if (P.fire) {
        const fx = L.umbX;
        const fy = L.umbY;
        for (let a = 0; a < 12; a++) {
          const x = Math.round(fx + Math.cos((a / 12) * Math.PI * 2) * 6);
          const y = Math.round(fy + Math.sin((a / 12) * Math.PI * 2) * 2);
          r.set(x, y, C('#8a8a8a'));
          r.set(x + 1, y, C('#5a5a5e'));
        }
        for (let k = -4; k <= 4; k++) {
          r.set(fx + k, fy - 1 + Math.round(k * 0.2), C('#5a3a22'));
          r.set(fx + k, fy + Math.round(-k * 0.2), C('#3e2616'));
        }
        r.rect(fx - 2, fy - 1, 5, 1, C('#ff8a2a'));
        // Bûche-banc à côté.
        r.rect(fx - 20, fy - 3, 10, 3, C('#6a4430'));
        r.rect(fx - 20, fy - 3, 10, 1, C('#94643f'));
        r.rect(fx - 20, fy - 3, 1, 3, C('#c8a070'));
        this.fire = { x: fx, y: fy - 1 };
        this.lights.push({ x: fx, y: fy - 4, r: 34, k: 1.1 });
      }

      // Ombre de l'enfant au cerf-volant.
      if (P.kite) shadow(L.kidX + 6, L.kidY, 5, 1, 0.3);
      // Monde élargi : dunes, oyats, ganivelles, transats… devant la plage qui continue.
      if (this.ext) {
        r.lock(0, W);
        back.lock(0, W);
        this.paintFrontExt(r, back);
        back.lock();
        r.lock();
      }
      return r;
    }

    /* ================= Vie de la scène ================= */
    update(dt, ctx) {
      const eff = (ctx && ctx.effect) || 'none';
      // night absent (caméra d'ouverture) : on garde l'état courant.
      const night = ctx && 'night' in ctx ? !!ctx.night : this.night;
      if (eff !== this.effect) this.build(eff, night);
      else if (night !== this.night) {
        // Même ambiance (temps déjà nocturne) : rien à repeindre.
        if (themeFor(eff, night) === this.T) this.night = night;
        else this.build(eff, night);
      }
      const { W, L, T } = this;
      this.t += dt;
      const t = this.t;

      if (this.flock) this.flock.update(dt);

      // Voilier qui dérive lentement à l'horizon.
      if (this.boat) {
        this.boat.x += this.boat.v * dt;
        if (this.boat.x > this.edge[L.hz] + 4) this.boat.x = this.X0 - 14;
      }
      // Monde élargi : les autres voiliers restent au large, hors du cadre.
      for (const b of this.boatsExt) {
        b.x += b.v * dt;
        if (b.x < 0 && b.x > -18) b.x = this.X0 - 16;
        if (b.x > this.X1) b.x = this.W + 2;
      }
      if (this.dog) this.updateDog(dt);

      // Mouette sur son pieu : repos, tête levée, et de temps en temps un battement d'ailes.
      const gp = this.gullPost;
      gp.t += dt;
      gp.timer -= dt;
      if (gp.timer <= 0) {
        if (gp.pose === 'idle') {
          const roll = Math.random();
          gp.pose = roll < (T.night ? 0.2 : 0.5) ? 'flap' : 'look';
          gp.timer = gp.pose === 'flap' ? 1.2 + Math.random() * 0.8 : 1 + Math.random() * 2;
          gp.t = 0;
        } else {
          gp.pose = 'idle';
          gp.timer = 4 + Math.random() * 8;
        }
      }

      // Promeneur (avec son chien, ou sous son parapluie) le long de l'eau.
      this.nextWalker -= dt;
      if (!this.walker && this.nextWalker <= 0) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        const end = this.X1 + 18;
        let x = dir > 0 ? this.X0 - 30 : end;
        if (this.firstWalker) {
          x = dir > 0 ? 4 : end - 50;
          this.firstWalker = false;
        }
        this.walker = { x, dir, t: Math.random(), v: 9 + Math.random() * 3 };
      }
      if (this.walker) {
        const w = this.walker;
        w.x += w.dir * w.v * dt;
        w.t += dt;
        if (w.x < this.X0 - 45 || w.x > this.X1 + 30) {
          this.walker = null;
          this.nextWalker = 8 + Math.random() * 14;
        }
      }

      this.updateCrab(dt);

      // Poissons qui sautent hors de l'eau.
      if (T.fish) {
        this.nextFish -= dt;
        if (!this.fish && this.nextFish <= 0) {
          const y = Math.round(L.hz + 10 + Math.random() * (L.shore - L.hz - 30));
          const x0 = L.pierX1 + 12;
          const x = Math.round(x0 + Math.random() * (this.edge[y] - 20 - x0));
          this.fish = { x, y, dir: Math.random() < 0.5 ? 1 : -1, age: 0 };
          this.splashes.push({ x, y, age: 0 });
          this.nextFish = 5 + Math.random() * 10;
        }
        if (this.fish) {
          this.fish.age += dt;
          if (this.fish.age >= 0.9) {
            this.splashes.push({ x: this.fish.x + this.fish.dir * 10, y: this.fish.y, age: 0 });
            this.fish = null;
          }
        }
      }
      for (const s of this.splashes) s.age += dt;
      this.splashes = this.splashes.filter((s) => s.age < 0.5);

      // Le pêcheur relève sa ligne de temps en temps.
      const f = this.fisher;
      f.next -= dt;
      if (f.next <= 0) {
        f.lift = 1.6;
        f.next = 12 + Math.random() * 18;
      }
      if (f.lift > 0) f.lift -= dt;

      // Étincelles du feu de camp.
      if (this.fire && Math.random() < dt * 6) this.sparks.emit(this.fire.x + Math.round((Math.random() - 0.5) * 4), this.fire.y - 5, 1 + Math.random(), 10 + Math.random() * 6);
      this.sparks.update(dt);

      // Orage : éclairs au-dessus de la mer.
      if (T.lightning) {
        this.nextBolt -= dt;
        if (this.nextBolt <= 0) {
          this.bolt = this.makeBolt();
          this.nextBolt = 4 + Math.random() * 9;
        }
        if (this.bolt) {
          this.bolt.age += dt;
          if (this.bolt.age > 0.45) this.bolt = null;
        }
      }
    }

    // Le chien trotte le long de l'eau, s'arrête, renifle, repart dans l'autre sens.
    updateDog(dt) {
      const d = this.dog;
      const { W } = this;
      const xa = Math.max(this.X0 + 10, Math.round(-0.4 * W));
      const xb = Math.round(-0.08 * W);
      d.t += dt;
      d.timer -= dt;
      if (d.state === 'run') {
        d.x += d.dir * 16 * dt;
        if (d.x < xa || d.x > xb - this.sp.dog.w) {
          d.dir = d.x < xa ? 1 : -1;
          d.x = clamp(d.x, xa, xb - this.sp.dog.w);
        }
        if (d.timer <= 0) {
          d.state = 'stop';
          d.timer = 1 + Math.random() * 2;
        }
      } else if (d.timer <= 0) {
        d.state = 'run';
        d.timer = 3 + Math.random() * 4;
        if (Math.random() < 0.5) d.dir = -d.dir;
      }
    }

    updateCrab(dt) {
      const { L } = this;
      if (!this.crab) {
        this.nextCrab -= dt;
        if (this.nextCrab > 0) return;
        const hole = Math.floor(Math.random() * L.holes.length);
        this.crab = { x: L.holes[hole], hole, state: 'emerge', timer: 0.8, t: 0, dir: 1, steps: 2 + Math.floor(Math.random() * 3), target: 0 };
        return;
      }
      const c = this.crab;
      c.t += dt;
      c.timer -= dt;
      if (c.state === 'walk') {
        c.x += c.dir * 11 * dt;
        if ((c.dir > 0 && c.x >= c.target) || (c.dir < 0 && c.x <= c.target)) {
          c.x = c.target;
          if (c.steps <= 0) {
            c.state = 'sink';
            c.timer = 0.7;
          } else {
            c.state = 'pause';
            c.timer = 1 + Math.random() * 2;
          }
        }
        return;
      }
      if (c.timer > 0) return;
      if (c.state === 'sink') {
        this.crab = null;
        this.nextCrab = 7 + Math.random() * 12;
        return;
      }
      // Fin de « sortie » ou de pause : nouvelle petite course de côté.
      c.steps--;
      if (c.steps <= 0) {
        let h = Math.floor(Math.random() * L.holes.length);
        if (h === c.hole) h = (h + 1) % L.holes.length;
        c.target = L.holes[h];
      } else {
        c.target = clamp(Math.round(c.x + (Math.random() < 0.5 ? -1 : 1) * (15 + Math.random() * 40)), 12, this.W - 24);
      }
      c.dir = c.target >= c.x ? 1 : -1;
      c.state = 'walk';
    }

    makeBolt() {
      const { W, H, L } = this;
      const pts = [];
      let x = Math.round(W * (0.12 + Math.random() * 0.5));
      let y = Math.round(H * 0.06);
      pts.push([x, y]);
      while (y < L.hz - 1) {
        y = Math.min(L.hz - 1, y + 3 + Math.floor(Math.random() * 5));
        x += Math.round((Math.random() - 0.5) * 9);
        pts.push([x, y]);
      }
      const branch = [];
      const s = pts[Math.min(3, pts.length - 1)];
      let bx = s[0];
      let by = s[1];
      const bd = Math.random() < 0.5 ? -1 : 1;
      for (let k = 0; k < 4; k++) {
        const nx = bx + bd * (3 + Math.floor(Math.random() * 4));
        const ny = by + 3 + Math.floor(Math.random() * 3);
        branch.push([bx, by, nx, ny]);
        bx = nx;
        by = ny;
      }
      return { pts, branch, age: 0, x: pts[pts.length - 1][0] };
    }

    /* ================= Dessin d'une image ================= */
    draw(g) {
      const { W, H, L, T } = this;
      const K = this.k;
      const t = this.t;
      g.imageSmoothingEnabled = false;
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      // Les toiles couvrent tout le monde peint : elles commencent en x = X0 (0 sans extension).
      const X0 = this.X0;
      g.drawImage(this.back, X0, 0);

      // Étoiles qui scintillent.
      for (const s of this.twinkles) {
        const v = Math.sin(t * s.sp + s.ph);
        if (v < -0.3) continue;
        g.fillStyle = `rgba(255,250,235,${0.4 + 0.6 * v})`;
        g.fillRect(s.x, s.y, 1, 1);
        if (v > 0.85) {
          g.fillStyle = 'rgba(200,215,255,0.45)';
          g.fillRect(s.x - 1, s.y, 1, 1);
          g.fillRect(s.x + 1, s.y, 1, 1);
          g.fillRect(s.x, s.y - 1, 1, 1);
          g.fillRect(s.x, s.y + 1, 1, 1);
        }
      }

      // Mer : le motif de vagues ondule par bandes (plus fort près du bord).
      const seaH = L.shore - L.hz;
      const amp = T.waves;
      for (let j = 0; j < seaH; j += 3) {
        const h = Math.min(3, seaH - j);
        const ox = Math.round(Math.sin(t * 0.9 * amp + j * 0.35) * (0.6 + (j / seaH) * 1.8 * amp));
        g.drawImage(this.seaTex, 0, j, this.WW + 8, h, X0 + ox - 4, L.hz + j, this.WW + 8, h);
      }
      this.drawGlints(g, seaH);
      this.drawBoat(g);
      if (this.boatsExt.length) this.drawBoatsExt(g);
      this.drawFish(g);
      this.drawShore(g);

      // Plan moyen : falaise, phare, ponton, pieux.
      g.drawImage(this.mid, X0, 0);
      this.drawRockFoam(g);
      this.drawLantern(g);
      this.drawPostGull(g);
      if (T.props.fisher) this.drawFisher(g);
      this.drawWalker(g);
      this.drawCrab(g);
      if (T.props.kite) this.drawKite(g);
      if (this.ext) this.drawMidExt(g);

      // Premier plan.
      g.drawImage(this.front, X0, 0);
      if (this.flag) this.drawFlag(g);
      if (this.fire) this.drawFire(g);
      this.drawGrass(g);
      if (this.flock) this.flock.draw(g);

      // Lumières additives : halos, faisceau du phare, feu.
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.9 + 0.06 * Math.sin(t * 1.1);
      g.drawImage(this.halo, X0, 0);
      g.globalAlpha = 1;
      if (T.beam > 0) this.drawBeam(g);
      if (this.fireHalo) {
        g.globalAlpha = 0.75 + 0.15 * Math.sin(t * 13) * Math.sin(t * 7.3) + 0.1 * Math.sin(t * 3.1);
        g.drawImage(this.fireHalo, X0, 0);
        g.globalAlpha = 1;
      }
      g.globalCompositeOperation = 'source-over';
      if (this.bolt) this.drawBolt(g);
    }

    // Paillettes de lumière sur la mer (ou moutons d'écume quand la mer est grosse),
    // et frémissement de la colonne de reflets du soleil ou de la lune.
    drawGlints(g, seaH) {
      const { L, T } = this;
      const K = this.k;
      const t = this.t;
      const xEnd = this.edge[L.shore];
      const n = T.whitecaps ? 46 : 26;
      const col = T.whitecaps ? K.foam : K.refl || K.crest;
      for (let k = 0; k < n; k++) {
        const ph = t * (T.whitecaps ? 0.6 : 0.45) + hash(k, 1, 101);
        const life = frac(ph);
        const id = Math.floor(ph);
        const tt = hash(k, id, 103);
        const y = L.hz + 3 + Math.floor(tt * tt * (seaH - L.band - 4));
        const x = Math.floor(hash(k, id, 102) * xEnd);
        if (x > this.edge[y] - 2) continue;
        if (y > L.pierY - 2 && y < L.pierY + 12 && x < L.pierX1) continue;
        const a = Math.sin(life * Math.PI);
        const len = 1 + Math.floor(((y - L.hz) / seaH) * (T.whitecaps ? 5 : 3));
        g.fillStyle = css(col, (T.whitecaps ? 0.75 : 0.55) * a);
        g.fillRect(x, y, len, 1);
        if (T.whitecaps && len > 2 && a > 0.5) g.fillRect(x + 1, y - 1, len - 2, 1);
      }
      // Monde élargi : la mer scintille aussi (ou moutonne) hors du cadre.
      for (const [a, b] of this.ext ? this.extSpans() : []) {
        const m = Math.round((n * (b - a)) / this.W);
        const E = this.L.ext;
        for (let k = 0; k < m; k++) {
          const ph = t * (T.whitecaps ? 0.6 : 0.45) + hash(k, 1, 201 + a);
          const life = frac(ph);
          const id = Math.floor(ph);
          const tt = hash(k, id, 203 + a);
          const y = L.hz + 3 + Math.floor(tt * tt * (seaH - L.band - 4));
          const x = a + Math.floor(hash(k, id, 202 + a) * (b - a));
          if (x >= this.edge[y] - 2 && x >= this.W) continue;
          if (E.pierX0 != null && y > L.pierY - 2 && y < L.pierY + 12 && x < 0 && x >= E.pierX0) continue;
          const al = Math.sin(life * Math.PI);
          const len = 1 + Math.floor(((y - L.hz) / seaH) * (T.whitecaps ? 5 : 3));
          g.fillStyle = css(col, (T.whitecaps ? 0.75 : 0.55) * al);
          g.fillRect(x, y, len, 1);
          if (T.whitecaps && len > 2 && al > 0.5) g.fillRect(x + 1, y - 1, len - 2, 1);
        }
      }
      const bd = this.body;
      if (!bd || !K.refl || bd.kind === 'pale') return;
      g.fillStyle = css(mix(K.refl, [255, 255, 255], 0.35), bd.kind === 'moon' ? 0.6 : 0.9);
      for (let j = 1; j < seaH; j++) {
        const tt = j / seaH;
        const bw = bd.r * 0.3 + tt * bd.r * (bd.kind === 'moon' ? 0.6 : 1.4);
        const step = Math.floor(t * 4 + hash(j, 1, 3) * 8);
        const m = tt > 0.4 ? 2 : 1;
        for (let d = 0; d < m; d++) {
          const hh = hash(j, d + step * 3, 77);
          if (hh < 0.4) continue;
          const x = Math.round(bd.x + (hash(j, d + step * 3, 79) - 0.5) * 1.8 * bw);
          g.fillRect(x, L.hz + j, 1 + Math.floor(hh * (1 + tt * 3)), 1);
        }
      }
    }

    // Les voiliers du large (monde élargi), avec leur reflet.
    drawBoatsExt(g) {
      const { T } = this;
      for (const b of this.boatsExt) {
        const img = b.big ? this.sp.boat2 : this.sp.boat;
        const x = Math.round(b.x);
        const y = b.y + 1 - img.height + (Math.sin(this.t * 1.1 + b.ph) > 0.6 ? 1 : 0);
        g.drawImage(img, x, y);
        g.save();
        g.globalAlpha = 0.25;
        g.translate(x, b.y + 2);
        g.scale(1, -0.5);
        g.drawImage(img, 0, -img.height);
        g.restore();
        if (T.night || T.walker === 'umbrella') {
          g.fillStyle = Math.sin(this.t * 2.2 + b.ph) > -0.6 ? '#ffe8a0' : '#806040';
          g.fillRect(x + (b.big ? 7 : 5), y - 1, 1, 1);
        }
      }
    }

    // La vie du monde élargi sur le plan moyen : les joueurs de volley et leur ballon, le
    // chien, le drapeau du poste de secours, la lueur des réverbères.
    drawMidExt(g) {
      const { T, L } = this;
      const E = L.ext;
      const t = this.t;
      if (E.flag && !T.night) {
        const fr = Math.floor(t / 0.2) % 3;
        const rows = [['RRRR.', 'RRRRR', 'RRR..'], ['RRRRR', 'RRRR.', 'RRRR.'], ['RRR..', 'RRRRR', 'RRRRR']][fr];
        const col = T.lightning ? '#e8403a' : T.walker === 'umbrella' || T.snow || T.litter === 'leaves' ? '#f08a2a' : '#3aa84a';
        g.fillStyle = css(this.dim(C(col)));
        rows.forEach((row, y) => {
          for (let x = 0; x < row.length; x++) if (row[x] === 'R') g.fillRect(E.flag.x + x, E.flag.y + y, 1, 1);
        });
      }
      const Pl = this.sp.players;
      if (Pl) {
        const N = E.net;
        const P = 1.7;
        const ph = t / P;
        const s = frac(ph);
        const ltr = Math.floor(ph) % 2 === 0;
        const feet = [[N.x - N.half - 13, N.y + 2], [N.x + N.half + 12, N.y + 3]];
        const hands = [];
        Pl.forEach((sp, i) => {
          const fromMe = (i === 0) === ltr;
          const hit = fromMe ? s < 0.16 : s > 0.86;
          const img = hit ? sp.frames.hit : sp.frames.ready;
          const x = feet[i][0] - sp.ax;
          const y = feet[i][1] - sp.ay - (hit && fromMe && s < 0.08 ? 1 : 0);
          g.fillStyle = 'rgba(70,40,40,0.25)';
          g.fillRect(feet[i][0] - 3, feet[i][1], 7, 1);
          g.drawImage(img, x, y);
          const hp = sp.pts.hit.handR || [sp.w / 2, 0];
          hands.push([x + hp[0], y + hp[1] - 2]);
        });
        const [a, b] = ltr ? hands : [hands[1], hands[0]];
        const bx = Math.round(a[0] + (b[0] - a[0]) * s);
        const by = Math.round(a[1] + (b[1] - a[1]) * s - Math.sin(s * Math.PI) * 24);
        const gy = Math.round(feet[0][1] + (feet[1][1] - feet[0][1]) * (ltr ? s : 1 - s));
        g.fillStyle = 'rgba(70,40,40,0.25)';
        g.fillRect(bx - 1, gy, 3, 1);
        g.fillStyle = css(this.dim(C('#f6f2e6')));
        g.fillRect(bx, by, 2, 2);
        g.fillStyle = css(this.dim(C('#3a7ad0')));
        g.fillRect(bx + 1, by + 1, 1, 1);
        g.fillStyle = css(this.dim(C('#f0c040')));
        g.fillRect(bx, by + 1, 1, 1);
      }
      if (this.dog) {
        const d = this.dog;
        const S = this.sp.dog;
        const fr = d.dir > 0 ? S.right : S.left;
        const img = d.state === 'run' ? fr[Math.floor(d.t / 0.1) % fr.length] : fr[0];
        const gy = L.walkY + 5;
        g.fillStyle = 'rgba(70,40,40,0.2)';
        g.fillRect(Math.round(d.x) + 1, gy, S.w - 2, 1);
        g.drawImage(img, Math.round(d.x), gy - S.h + 1);
      }
      if (this.haloExt) {
        g.globalCompositeOperation = 'lighter';
        g.drawImage(this.haloExt, this.X0, 0);
        g.globalCompositeOperation = 'source-over';
      }
    }

    drawBoat(g) {
      if (!this.boat) return;
      const { L, T } = this;
      const img = this.sp.boat;
      const x = Math.round(this.boat.x);
      const y = L.hz + 1 - img.height + (Math.sin(this.t * 1.3) > 0.6 ? 1 : 0);
      g.drawImage(img, x, y);
      // Reflet écrasé dans l'eau.
      g.save();
      g.globalAlpha = 0.28;
      g.translate(x, L.hz + 2);
      g.scale(1, -0.5);
      g.drawImage(img, 0, -img.height);
      g.restore();
      if (T.night || T.walker === 'umbrella') {
        g.fillStyle = Math.sin(this.t * 2.2) > -0.6 ? '#ffe8a0' : '#806040';
        g.fillRect(x + 5, y - 1, 1, 1);
      }
    }

    drawFish(g) {
      const t = this.t;
      for (const s of this.splashes) {
        const k = 1 + Math.floor(s.age * 8);
        g.fillStyle = `rgba(235,245,255,${0.8 * (1 - s.age / 0.5)})`;
        g.fillRect(s.x - k, s.y, 1, 1);
        g.fillRect(s.x + k, s.y, 1, 1);
        g.fillRect(s.x - 1, s.y - 1 - Math.floor(s.age * 6), 1, 1);
        g.fillRect(s.x + 1, s.y - 2 - Math.floor(s.age * 4), 1, 1);
      }
      const f = this.fish;
      if (!f) return;
      const u = f.age / 0.9;
      const px = Math.round(f.x + f.dir * 10 * u);
      const py = Math.round(f.y - 4 * 7 * u * (1 - u));
      const dy = u < 0.42 ? 1 : u > 0.58 ? -1 : 0;
      g.fillStyle = '#e4eef4';
      g.fillRect(px, py, 1, 1);
      g.fillStyle = '#9ab0c0';
      g.fillRect(px - f.dir, py + (dy > 0 ? 1 : dy < 0 ? -1 : 0) * (Math.sin(t * 30) > 0 ? 1 : 0), 1, 1);
      g.fillStyle = '#6a8090';
      g.fillRect(px - f.dir * 2, py + dy, 1, 1);
    }

    // Vagues qui déroulent jusqu'au rivage, nappe d'eau qui monte sur le sable et ligne d'écume.
    drawShore(g) {
      const { W, L, T } = this;
      const K = this.k;
      const t = this.t;
      const P = T.waves > 1 ? 7 - T.waves : 7.5;
      const ua = t / P;
      const u = frac(ua);
      const cycle = Math.floor(ua);
      const xEnd = Math.min(W, this.edge[L.shore] + 2);
      const band = L.band;

      // Crêtes qui approchent (la principale arrive pile quand la nappe repart).
      const x0 = this.X0; // les vagues longent tout le rivage du monde peint
      for (let k = 2; k >= 0; k--) {
        const pa = ua + k / 3;
        const p = frac(pa);
        const id = Math.floor(pa);
        if (k !== 0 && p > 0.85) continue;
        const y = L.shore - band + Math.round(band * p ** 1.4);
        if (y >= L.shore - 1) continue;
        const th = 0.64 - p * 0.3 - (T.waves - 1) * 0.1;
        const strong = k === 0 ? 1 : 0.6;
        const runs = [];
        let s = -1;
        for (let x = x0; x <= xEnd; x++) {
          const on = x < xEnd && noise(x * 0.045, id * 3.7 + k * 11, 41) > th;
          if (on && s < 0) s = x;
          else if (!on && s >= 0) {
            runs.push([s, x - s]);
            s = -1;
          }
        }
        g.fillStyle = css(K.trough, (0.15 + 0.3 * p) * strong);
        for (const [x, w] of runs) g.fillRect(x, y + 1, w, 1 + (T.waves > 1 ? 1 : 0));
        g.fillStyle = css(K.crest, (0.25 + 0.6 * p) * strong);
        for (const [x, w] of runs) g.fillRect(x, y, w, 1);
        if (k === 0 && p > 0.66) {
          g.fillStyle = css(K.foam, Math.min(1, (p - 0.66) / 0.25) * 0.9);
          for (const [x, w] of runs) {
            for (let xx = x; xx < x + w; xx++) {
              const h = hash(xx, id, 5);
              if (h > 0.4) g.fillRect(xx, y - (h > 0.8 ? 1 : 0), 1, 1);
              if (T.waves > 1 && h > 0.7) g.fillRect(xx, y - 2, 1, 1);
            }
          }
        }
      }

      // Nappe d'eau : monte vite, redescend doucement.
      let reach;
      if (u < 0.26) reach = 1 - (1 - u / 0.26) ** 2;
      else {
        const v = 1 - (u - 0.26) / 0.74;
        reach = v * v * (3 - 2 * v);
      }
      const A = 7 + (T.waves - 1) * 3;
      const retreat = u < 0.26 ? 0 : (u - 0.26) / 0.74;
      const cs = this.cs;
      // Sable encore luisant derrière la nappe qui se retire, et reste d'écume en dentelle.
      if (retreat > 0) {
        g.fillStyle = css(cs.wet, 0.35 * (1 - retreat));
        for (let x = x0; x < xEnd; x++) {
          const maxY = L.shore + Math.round(A * (0.6 + 0.4 * noise(x * 0.04, cycle, 23)));
          const f = L.shore + Math.round(A * reach * (0.6 + 0.4 * noise(x * 0.04, cycle, 23)));
          if (maxY > f) g.fillRect(x, f, 1, maxY - f + 1);
        }
        g.fillStyle = css(cs.foam, 0.65 * (1 - retreat));
        for (let x = x0; x < xEnd; x++) {
          if (hash(x, cycle, 9) < 0.5) continue;
          const maxY = L.shore + Math.round(A * (0.6 + 0.4 * noise(x * 0.04, cycle, 23)));
          g.fillRect(x, maxY + (hash(x, cycle, 10) > 0.7 ? 1 : 0), 1, 1);
        }
      }
      // Nappe elle-même.
      for (let x = x0; x < xEnd; x++) {
        const f = L.shore + Math.round(A * reach * (0.6 + 0.4 * noise(x * 0.04, cycle, 23)));
        if (f > L.shore) {
          g.fillStyle = css(cs.swash, 0.62);
          g.fillRect(x, L.shore, 1, f - L.shore);
          if (f - L.shore > 2 && hash(x, cycle, 12) > 0.75) {
            g.fillStyle = css(cs.foam, 0.4);
            g.fillRect(x, f - 2, 1, 1);
          }
        }
        if (retreat === 0 || hash(x, cycle, 11) > retreat * 0.9) {
          g.fillStyle = css(cs.foam, 0.95 - retreat * 0.4);
          g.fillRect(x, f, 1, 1);
        }
      }
      // Ligne de jonction entre la mer et le sable, toujours un peu écumeuse.
      g.fillStyle = css(cs.foam, 0.5);
      for (let x = x0; x < xEnd; x++) if (hash(x, Math.floor(t * 3), 13) > 0.6) g.fillRect(x, L.shore - 1, 1, 1);
    }

    drawRockFoam(g) {
      const t = this.t;
      const k = this.T.waves;
      g.fillStyle = css(this.cs.foam, 0.85);
      for (const p of this.rockFoam) {
        if (Math.sin(t * 3 + p.x * 1.7) + Math.sin(t * 1.3 + p.x) > 0.4) g.fillRect(p.x, p.y, 1, 1);
      }
      // Gerbes d'embruns quand une vague frappe les rochers.
      const u = frac(t / (k > 1 ? 7 - k : 7.5));
      if (u < 0.3 && this.rockFoam.length) {
        const s = this.rockFoam[Math.floor(this.rockFoam.length / 3)];
        const h = Math.round(Math.sin((u / 0.3) * Math.PI) * (3 + k * 3));
        g.fillStyle = css(this.cs.foam, 0.6);
        for (let i = 0; i < 6 + k * 4; i++) {
          const dx = Math.round((hash(i, 1, 111) - 0.5) * (8 + k * 4));
          const dy = Math.round(hash(i, 2, 112) * h);
          g.fillRect(s.x + dx, s.y - dy, 1, 1);
        }
      }
    }

    // Lanterne du phare : s'illumine fort quand le faisceau passe face à nous.
    drawLantern(g) {
      const { T } = this;
      if (!T.lamp) return;
      const s = Math.sin(this.t * 0.8);
      if (s > 0.6) {
        const lr = this.lanternRect;
        g.fillStyle = css([255, 252, 230], Math.min(1, (s - 0.6) * 2.5));
        g.fillRect(lr.x, lr.y, lr.w, lr.h);
      }
    }

    // Faisceau tournant : longues colonnes de pixels quand il pointe de côté, court et
    // éblouissant quand il nous fait face.
    drawBeam(g) {
      const { T } = this;
      const th = this.t * 0.8;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const len = Math.round(16 + 200 * Math.abs(c));
      const dir = c >= 0 ? 1 : -1;
      const lx = this.lantern.x;
      const ly = this.lantern.y;
      const k = T.beam * (s > 0 ? 1 : 0.55);
      let last = -1;
      for (let d = 3; d < len; d++) {
        const q = Math.floor((1 - d / len) * 4 + 0.6) / 4;
        if (q <= 0) break;
        if (q !== last) {
          g.fillStyle = css([255, 236, 180], k * q);
          last = q;
        }
        const h = 1 + Math.floor(d * 0.085);
        const y = Math.round(ly - d * 0.04);
        g.fillRect(lx + dir * d, y - h, 1, h * 2 + 1);
      }
      if (this.flashHalo && s > 0.5) {
        g.globalAlpha = Math.min(1, ((s - 0.5) * 2) ** 2) * Math.min(1, T.beam * 4);
        g.drawImage(this.flashHalo, this.X0, 0);
        g.globalAlpha = 1;
      }
    }

    drawPostGull(g) {
      const { L } = this;
      const gp = this.gullPost;
      const S = this.sp.gull;
      let img = S.idle;
      if (gp.pose === 'look') img = S.look;
      else if (gp.pose === 'flap') img = Math.floor(gp.t / 0.12) % 2 ? S.flapUp : S.flapMid;
      const lift = gp.pose === 'flap' && Math.floor(gp.t / 0.24) % 2 ? 1 : 0;
      g.drawImage(img, L.postX - 5, L.postTop - img.height - lift);
    }

    drawFisher(g) {
      const { L } = this;
      const f = this.fisher;
      const F = this.sp.fisher;
      const lifting = f.lift > 0;
      const i = Math.floor(this.t / 1.1) % 2; // jambes qui se balancent
      const img = lifting ? F.frames.lift : F.frames.idle[i];
      const pts = lifting ? F.pts.lift : F.pts.idle[i];
      const x = L.pierX1 - 14 - F.ax;
      const y = L.pierY - 1 - F.ay;
      g.drawImage(img, x, y);
      // Fil de la canne, du bout de la canne au bouchon.
      const tx = x + pts.tip[0];
      const ty = y + pts.tip[1];
      const lift = lifting ? 2 : 0;
      const by = L.pierY + 9 + (lift ? -2 : Math.sin(this.t * 2) > 0.3 ? 1 : 0);
      const bx = tx + 3;
      g.fillStyle = 'rgba(230,230,230,0.45)';
      line(g, tx, ty, bx, by - 1);
      g.fillStyle = '#e84a3a';
      g.fillRect(bx, by, 1, 1);
      g.fillStyle = 'rgba(255,255,255,0.5)';
      if (!lift && Math.sin(this.t * 2) > 0.3) {
        g.fillRect(bx - 1, by + 1, 1, 1);
        g.fillRect(bx + 1, by + 1, 1, 1);
      }
    }

    drawWalker(g) {
      const w = this.walker;
      if (!w) return;
      const { W, L } = this;
      const S = this.sp.walker;
      const x = Math.round(w.x);
      // Reflet sur le sable mouillé.
      g.save();
      g.beginPath();
      g.rect(this.X0, L.walkY, this.WW, L.wet1 - L.walkY);
      g.clip();
      g.globalAlpha = 0.22;
      g.translate(0, L.walkY * 2);
      g.scale(1, -1);
      B.People.drawWalker(g, S, x, L.walkY, w.dir, w.t);
      g.restore();
      B.People.drawWalker(g, S, x, L.walkY, w.dir, w.t);
    }

    drawCrab(g) {
      const c = this.crab;
      if (!c) return;
      const { L } = this;
      const S = this.sp.crab;
      let img;
      if (c.state === 'walk') img = S.walk[Math.floor(c.t / 0.09) % 2];
      else if (c.state === 'pause') img = S.claws[Math.floor(c.t / 0.25) % 2];
      else img = S.walk[0];
      const x = Math.round(c.x) - 4;
      const base = L.crabY + 1;
      let vis = img.height;
      if (c.state === 'emerge') vis = Math.round(img.height * clamp(1 - c.timer / 0.8, 0, 1));
      if (c.state === 'sink') vis = Math.round(img.height * clamp(c.timer / 0.7, 0, 1));
      if (vis <= 0) return;
      if (vis >= img.height) {
        g.fillStyle = 'rgba(60,30,20,0.3)';
        g.fillRect(x + 1, base, img.width - 2, 1);
      }
      g.drawImage(img, 0, 0, img.width, vis, x, base - vis, img.width, vis);
    }

    drawKite(g) {
      const { W, H, L } = this;
      const t = this.t;
      const pull = frac(t / 3.2) < 0.18;
      const K = this.sp.kid;
      const kx = L.kidX + 4 - K.ax;
      const ky = L.kidY - K.ay;
      g.drawImage(pull ? K.frames.pull : K.frames.hold, kx, ky);
      const hp = pull ? K.pts.pull.handR : K.pts.hold.handR;
      const hx = kx + hp[0];
      const hy = ky + hp[1];
      const ax = Math.round(W * 0.27 + Math.sin(t * 0.5) * 9 + Math.sin(t * 1.3) * 3);
      const ay = Math.round(H * 0.17 + Math.sin(t * 0.8) * 5 + Math.sin(t * 2.1) * 1.5 - (pull ? 2 : 0));
      // Ficelle légèrement détendue.
      g.fillStyle = this.T.night ? 'rgba(150,150,160,0.5)' : 'rgba(250,245,235,0.55)';
      const bx = ax + 3;
      const by = ay + 6;
      const n = Math.max(Math.abs(bx - hx), Math.abs(by - hy));
      const sag = 10;
      for (let k = 0; k <= n; k += 1) {
        const uu = k / n;
        g.fillRect(Math.round(hx + (bx - hx) * uu), Math.round(hy + (by - hy) * uu + Math.sin(uu * Math.PI) * sag), 1, 1);
      }
      // Queue qui ondule au vent, avec ses nœuds colorés.
      const cols = ['#e8403a', '#f8d040', '#3a7ad0'];
      for (let k = 1; k < 16; k++) {
        const qx = Math.round(bx + k * 0.6 + Math.sin(t * 4 - k * 0.55) * k * 0.28);
        const qy = by + Math.round(k * 1.5);
        g.fillStyle = 'rgba(240,235,225,0.8)';
        g.fillRect(qx, qy, 1, 1);
        if (k % 4 === 0) {
          g.fillStyle = cols[(k / 4) % 3];
          g.fillRect(qx - 1, qy, 3, 1);
        }
      }
      g.drawImage(this.sp.kite, ax, ay);
    }

    drawFlag(g) {
      const f = this.flag;
      const fr = Math.floor(this.t / 0.18) % 3;
      const rows = [
        ['RRRR.', 'RRRRR', 'RRR..'],
        ['RRRRR', 'RRRR.', 'RRRR.'],
        ['RRR..', 'RRRRR', 'RRRRR'],
      ][fr];
      g.fillStyle = css(this.dim(C('#e8403a')));
      rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (row[x] === 'R') g.fillRect(f.x + x, f.y + y, 1, 1);
      });
    }

    drawFire(g) {
      const f = this.fire;
      const t = this.t;
      const cols = ['#fff4b0', '#ffc850', '#ff8a2a', '#d8401a'];
      for (let k = -2; k <= 2; k++) {
        const h = Math.max(1, Math.round(6 - Math.abs(k) * 1.5 + Math.sin(t * 11 + k * 2.1) * 1.3 + Math.sin(t * 17 + k) * 0.8));
        for (let j = 0; j < h; j++) {
          const q = j / h;
          let ci = q < 0.3 ? 0 : q < 0.55 ? 1 : q < 0.8 ? 2 : 3;
          if (Math.abs(k) === 2 && ci === 0) ci = 1;
          const dx = j > h - 3 ? Math.round(Math.sin(t * 13 + k * 3) * 0.7) : 0;
          g.fillStyle = cols[ci];
          g.fillRect(f.x + k + dx, f.y - 1 - j, 1, 1);
        }
      }
      for (const q of this.sparks.p) {
        g.fillStyle = `rgba(255,${180 - Math.round(q.age * 60)},90,${1 - q.age / q.life})`;
        g.fillRect(Math.round(q.x), Math.round(q.y), 1, 1);
      }
    }

    // Oyats des dunes qui ondulent (plus fort par gros temps).
    drawGrass(g) {
      const t = this.t;
      const wind = this.T.waves;
      for (const b of this.blades) {
        const sw = Math.sin(t * 1.6 * wind + b.ph + b.x * 0.15) * (1 + wind * 0.5) + (wind - 1) * 1.5;
        g.fillStyle = css(this.dim(b.c));
        for (let k = 0; k < b.h; k++) {
          const q = k / b.h;
          g.fillRect(b.x + Math.round(sw * q * q), b.y - 1 - k, 1, 1);
        }
      }
    }

    drawBolt(g) {
      const b = this.bolt;
      const { W, H } = this;
      const on = b.age < 0.12 || (b.age > 0.2 && b.age < 0.28);
      const flash = on ? 0.3 : 0.08 * (1 - b.age / 0.45);
      g.fillStyle = `rgba(210,222,255,${flash})`;
      g.fillRect(this.X0, 0, this.WW, H);
      if (!on) return;
      g.fillStyle = '#f4f8ff';
      for (let k = 1; k < b.pts.length; k++) line(g, b.pts[k - 1][0], b.pts[k - 1][1], b.pts[k][0], b.pts[k][1]);
      g.fillStyle = 'rgba(200,215,255,0.7)';
      for (const [x0, y0, x1, y1] of b.branch) line(g, x0, y0, x1, y1);
      // Reflet de l'éclair sur la mer.
      g.fillStyle = 'rgba(220,230,255,0.35)';
      for (let y = this.L.hz + 1; y < this.L.hz + 30; y += 2) g.fillRect(b.x - 1 + Math.round(Math.sin(y) * 1.5), y, 3, 1);
    }
  }

  B.PixelScenes.mer = Sea;
})();
