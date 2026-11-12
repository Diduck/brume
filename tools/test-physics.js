#!/usr/bin/env node
// Brume — tests automatiques de la physique (sans écran ni carte graphique).
// Charge les vrais fichiers du moteur dans un bac à sable et simule des scénarios.
//   node tools/test-physics.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const SRC = path.join(__dirname, '..', 'src');
const ctx = { console, Math, performance };
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['shared/strings.js', 'renderer/engine/util.js', 'renderer/engine/world.js', 'renderer/engine/snowpack.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
}
const B = ctx.Brume;

function setup() {
  const toasts = [];
  const world = new B.World();
  world.setDisplay(1440, 900, 25, 900);
  // A devant B ; A en haut à gauche, B plus bas à droite (elles se chevauchent en x).
  world.updateWindows([[1, 200, 300, 600, 400], [2, 700, 600, 500, 250]], 0);
  const engine = {
    world,
    effectName: 'snow',
    settings: { accumulate: true, snowballs: true },
    cursor: { x: -1e5, y: -1e5, vx: 0, vy: 0, speed: 0, active: false },
    ui: { toast: (t) => toasts.push(t) },
  };
  const pack = new B.Snowpack(engine);
  return { world, engine, pack, toasts, A: world.windows.get(1).pile, B: world.windows.get(2).pile };
}

function fill(pile, h) {
  pile.h.fill(h);
  pile.active = true;
}

function step(pack, n, before) {
  for (let i = 0; i < n; i++) {
    if (before) before(i);
    for (const ev of pack.e.world.drainEvents()) pack.onEvent(ev);
    pack.update(1 / 60, i / 60);
  }
}

function moveCursor(engine, x, y, vx, vy) {
  Object.assign(engine.cursor, { x, y, vx, vy, speed: Math.hypot(vx, vy), active: true });
}

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('Brume — physique');

test('la neige se pose sur la fenêtre exposée, pas sous une fenêtre de devant', () => {
  const { world } = setup();
  assert.ok(world.hit(400, 290, 310), 'A doit attraper un flocon');
  // x = 750, y = 600 : le bord de B est sous A (A va jusqu'à y = 700) → B est caché à cet endroit.
  assert.equal(world.hit(750, 590, 610), null);
  assert.ok(world.hit(1000, 590, 610), 'B est exposé à droite de A');
});

test('glisser le curseur dans la neige roule une boule qui grossit', () => {
  const { engine, pack, A } = setup();
  fill(A, 8);
  let x = 260;
  step(pack, 70, () => {
    x += 400 / 60;
    moveCursor(engine, x, A.y - 4, 400, 0);
  });
  assert.equal(pack.balls.length, 1, 'une boule doit exister');
  assert.ok(pack.balls[0].r > 14, `rayon attendu > 14, obtenu ${pack.balls[0].r.toFixed(1)}`);
  assert.ok(A.heightAt(400) < 8, 'la boule a ramassé la neige sur son passage');
});

test('poussée au bout de la fenêtre, la boule tombe et atterrit sur la fenêtre du dessous', () => {
  const { engine, pack, A, B: pileB } = setup();
  fill(A, 8);
  let x = 520;
  let released = false;
  step(pack, 140, () => {
    x += 480 / 60;
    const ball = pack.balls[0];
    if (ball && ball.state === 'air') released = true; // le curseur lâche la boule dès qu'elle tombe
    if (released) moveCursor(engine, 20, 20, 0, 0);
    else moveCursor(engine, x, ball ? ball.y : A.y - 4, 480, 0);
  });
  const ball = pack.balls[0];
  assert.ok(ball, 'la boule existe toujours');
  assert.equal(ball.state, 'ground');
  assert.equal(ball.pile, pileB, 'elle repose maintenant sur B');
});

test('empiler deux boules fait un bonhomme de neige', () => {
  const { engine, pack, A, toasts } = setup();
  fill(A, 10);
  const big = { x: 400, y: 0, r: 26, vx: 0, vy: 0, rot: 0, state: 'ground', pile: A, off: 200, base: null, above: null, seed: 0.2, facing: 1, celebrated: 0 };
  const small = { x: 400, y: 100, r: 17, vx: 0, vy: 0, rot: 0, state: 'held', pile: null, off: 0, base: null, above: null, seed: 0.7, facing: 1, celebrated: 0 };
  pack.balls.push(big, small);
  pack.drag = small;
  moveCursor(engine, 400, 150, 0, 0);
  step(pack, 5);
  pack.release();
  engine.cursor.active = false;
  step(pack, 80);
  assert.equal(small.state, 'stacked');
  assert.equal(small.base, big);
  assert.ok(toasts.some((t) => t.includes('bonhomme')), 'un message de félicitations');
});

test('une boule lancée trop vite éclate en neige', () => {
  const { pack, A } = setup();
  const b = { x: 500, y: 100, r: 12, vx: 0, vy: 1400, rot: 0, state: 'air', pile: null, base: null, above: null, seed: 0, facing: 1, celebrated: 0, thrown: true };
  pack.balls.push(b);
  step(pack, 20);
  assert.equal(pack.balls.length, 0);
  step(pack, 60);
  assert.ok(A.sum > 0, 'la neige de la boule est retombée sur A');
});

const sum = (pile) => pile.h.reduce((s, v) => s + v, 0);
const DT_MS = 12; // le traqueur envoie une position toutes les ~12 ms pendant un mouvement

// Rejoue une trajectoire de la fenêtre A (positions successives), une image par position.
function drag(world, pack, path, t0 = 0) {
  path.forEach(([x, y], k) => {
    world.updateWindows([[1, x, y, 600, 400], [2, 700, 600, 500, 250]], t0 + (k + 1) * DT_MS);
    step(pack, 1);
  });
  return t0 + path.length * DT_MS;
}

// Compte les décollements (lift) et glissements (slip) déclenchés par l'inertie.
function countJolts(pack) {
  const counter = { n: 0 };
  for (const name of ['lift', 'slip']) {
    const original = pack[name].bind(pack);
    pack[name] = (...args) => {
      counter.n++;
      original(...args);
    };
  }
  return counter;
}

test('déplacer une fenêtre à vitesse constante : la neige reste dessus', () => {
  const { world, pack, A } = setup();
  fill(A, 8);
  step(pack, 90); // la neige se stabilise d'abord (les bords débordent naturellement)
  const path = [];
  for (let k = 0; k < 40; k++) path.push([200 + k * 3, 300 + k * 2]); // ~250 px/s, sans à-coup
  const t = drag(world, pack, path.slice(0, 6)); // le démarrage peut faire sautiller un peu de neige
  const jolts = countJolts(pack);
  drag(world, pack, path.slice(6), t);
  assert.equal(jolts.n, 0, 'ni décollement ni glissement pendant le déplacement régulier');
});

test('tirer la fenêtre d’un coup vers le bas : la neige décolle puis retombe sur son toit', () => {
  const { world, pack, A } = setup();
  fill(A, 8);
  const before = sum(A);
  const path = [[200, 300], [200, 300]];
  for (let k = 1; k <= 6; k++) path.push([200, 300 + k * 30]); // 2 500 px/s vers le bas
  drag(world, pack, path);
  assert.ok(pack.debris.length > 20, 'la neige est restée en l’air quand le toit s’est dérobé');
  assert.ok(sum(A) < before * 0.5);
  step(pack, 120);
  assert.ok(sum(A) > before * 0.6, `la neige est retombée sur son toit (${sum(A).toFixed(0)} / ${before.toFixed(0)})`);
});

test('tirer la fenêtre d’un coup vers la droite : la neige glisse et tombe par l’arrière', () => {
  const { world, pack, A } = setup();
  fill(A, 8);
  step(pack, 90); // la neige se stabilise d'abord (les bords débordent naturellement)
  pack.debris.length = 0;
  const xs = [];
  const original = pack.spawnDebris.bind(pack);
  pack.spawnDebris = (x, ...rest) => {
    xs.push(x);
    original(x, ...rest);
  };
  drag(world, pack, [[200, 300], [200, 300], [240, 300], [280, 300]]);
  assert.ok(xs.length > 0, 'de la neige est tombée');
  assert.ok(xs.every((x) => x < A.x0), 'elle tombe par le bout gauche (l’arrière du mouvement)');
  // Le toit a glissé vers la droite sous la neige : c'est l'avant (à droite) qui se retrouve à nu.
  assert.ok(A.heightAt(A.x0 + A.width - 6) < A.heightAt(A.x0 + 300), 'l’avant du toit s’est dégarni');
});

test('secouer une fenêtre fait pleuvoir sa neige sur ce qu’il y a en dessous', () => {
  const { world, pack, A, B: pileB } = setup();
  fill(A, 10);
  pileB.h.fill(0);
  world.ground.h.fill(0);
  const before = sum(A);
  const path = [];
  for (let k = 0; k < 12; k++) path.push([200 + (k % 2 ? 90 : -90), 300 + (k % 2 ? -25 : 25)]);
  drag(world, pack, path);
  assert.ok(sum(A) < before * 0.7, 'A a perdu une bonne partie de sa neige');
  step(pack, 150);
  assert.ok(sum(pileB) + sum(world.ground) > 1, 'la neige a atterri plus bas');
});

test('changer de bureau ne fait pas disparaître la neige', () => {
  const { world, pack, A } = setup();
  fill(A, 6);
  const before = sum(A);
  world.updateWindows([[2, 700, 600, 500, 250]], 33); // A n'est plus visible, mais pas fermée
  step(pack, 30);
  assert.equal(pack.debris.length, 0, 'rien ne tombe');
  world.updateWindows([[1, 260, 320, 600, 400], [2, 700, 600, 500, 250]], 5000); // retour sur le bureau
  const back = world.windows.get(1).pile;
  assert.equal(back, A, 'la fenêtre retrouve son tas');
  assert.ok(Math.abs(sum(back) - before) < 0.5, 'avec toute sa neige');
  assert.equal(back.x0, 268, 'placé à la nouvelle position de la fenêtre');
});

test('un bonhomme sur une fenêtre partie sur un autre bureau ne flotte pas dans le vide', () => {
  const { world, pack, A } = setup();
  const ball = { x: 400, y: 280, r: 14, vx: 0, vy: 0, rot: 0, state: 'ground', pile: A, off: 192, base: null, above: null, seed: 0, facing: 1, celebrated: 0 };
  pack.balls.push(ball);
  world.updateWindows([[2, 700, 600, 500, 250]], 33); // A part sur un autre bureau
  step(pack, 30);
  assert.ok(pack.hidden(ball), 'la boule est mise de côté avec sa fenêtre');
  assert.ok(pack.isEmpty(), 'rien à dessiner : la couche peut se mettre en veille');
  world.updateWindows([[1, 200, 300, 600, 400], [2, 700, 600, 500, 250]], 5000);
  assert.ok(!pack.hidden(ball), 'elle réapparaît au retour de la fenêtre');
});

test('fermer une fenêtre fait tomber tout ce qui était posé dessus', () => {
  const { world, pack, A } = setup();
  fill(A, 6);
  world.updateWindows([[2, 700, 600, 500, 250]], 33, [1]);
  step(pack, 1);
  assert.equal(sum(A), 0);
  assert.ok(pack.debris.length > 0);
});

test('balayage rapide : la neige part dans la direction du geste', () => {
  const { engine, pack, A } = setup();
  fill(A, 8);
  moveCursor(engine, 450, A.y - 4, 1600, -50);
  step(pack, 3, () => moveCursor(engine, 450, A.y - 4, 1600, -50));
  assert.ok(pack.debris.length > 0);
  const meanVx = pack.debris.reduce((s, d) => s + d.vx, 0) / pack.debris.length;
  assert.ok(meanVx > 300, `vitesse moyenne vers la droite attendue, obtenue ${meanVx.toFixed(0)}`);
});

console.log(`\n${passed} tests réussis.`);
