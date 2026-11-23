/**
 * Le filet de l'atelier — ce qu'une image fixe ne montre pas.
 *
 *   cd motion && npm test
 *
 * Règle : un test qui ne peut pas échouer ne teste rien. Chaque assertion
 * ci-dessous dit, en commentaire, ce qu'il faudrait casser pour la faire rougir.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const ICI = dirname(fileURLToPath(import.meta.url));
const { beatGrid } = require('../lib/beatgrid.js');
const R = require('../lib/ressorts.js');
const S = require('../lib/scene.js');
const C = require('../lib/couleurs.js');

describe('beatGrid', () => {
  it('ne dérive pas hors de 120 bpm (arrondi en DERNIER)', () => {
    // Rougit si l'on arrondit la durée d'un temps avant de la multiplier :
    // à 130 bpm, le temps 16 tomberait à 448 au lieu de 443.
    const g = beatGrid({ bpm: 130, fps: 60 });
    expect(g.frame(16)).toBe(443);
  });

  it('place chaque temps sur une image entière', () => {
    // Rougit si `temps()` rend des secondes non calées sur 1/fps.
    const g = beatGrid({ bpm: 130, fps: 60 });
    for (let n = 0; n < 40; n++) {
      const frames = g.temps(n) * 60;
      expect(Math.abs(frames - Math.round(frames))).toBeLessThan(1e-9);
    }
  });

  it('refuse un tempo qui donnerait des positions NaN', () => {
    expect(() => beatGrid({ bpm: 0 })).toThrow(/bpm/);
    expect(() => beatGrid({ bpm: 5000, fps: 60 })).toThrow(/moins d’une image/);
  });
});

describe('ressorts', () => {
  it('ease(0) = 0 et ease(1) = 1 EXACTEMENT, pour chaque préset', () => {
    // Rougit si la normalisation de fin disparaît : le geste s'arrêterait à
    // 0,9995 de sa cible et une boucle ne se refermerait pas.
    for (const nom of Object.keys(R.PRESETS)) {
      const { ease } = R.ressort(nom);
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
    }
  });

  const pic = (nom) => {
    const pos = R.position(nom);
    const { duree } = R.ressort(nom);
    let max = 0;
    for (let i = 0; i <= 2000; i++) max = Math.max(max, pos((i / 2000) * duree));
    return max;
  };

  it('settle, snap et camera ne dépassent JAMAIS la cible', () => {
    // Rougit si l'on « adoucit » un amortissement sous le critique (rebond interdit).
    for (const nom of ['settle', 'snap', 'camera']) expect(pic(nom)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('stretch, lui, dépasse — c’est sa raison d’être', () => {
    // Rougit si stretch devient critique : l'étirement à deux bords disparaît.
    expect(pic('stretch')).toBeGreaterThan(1.02);
  });

  it('settle se pose en moins de 1,5 s (pas de ressort qui rampe)', () => {
    // Rougit si damping repasse à 34 (sur-amorti, ζ ≈ 1,55).
    expect(R.ressort('settle').duree).toBeLessThan(1.5);
  });

  it('valeurMulti : rien avant le premier changement, la somme des deltas après', () => {
    const changes = [
      { temps: 1, delta: 100 },
      { temps: 2, delta: -40 },
    ];
    expect(R.valeurMulti(changes, 0.5, 10)).toBe(10);
    expect(R.valeurMulti(changes, 10, 10)).toBeCloseTo(70, 3);
  });

  it('valeurMulti refuse un delta NaN (le CSS l’ignorerait en silence)', () => {
    expect(() => R.valeurMulti([{ temps: 0, delta: NaN }], 1)).toThrow(/delta/);
  });

  it('bords : la barre s’ÉTIRE à mi-course, dans les deux sens', () => {
    // Rougit si les deux bords portent le même ressort (translation en bloc),
    // ou si le sens n'est pas recalculé à chaque transition (compression au retour).
    const arrets = [
      { temps: 0, start: 0, end: 100 },
      { temps: 1, start: 400, end: 500 },
      { temps: 3, start: 0, end: 100 },
    ];
    let maxAller = 0;
    let maxRetour = 0;
    for (let i = 1; i < 60; i++) {
      maxAller = Math.max(maxAller, R.bords(arrets, 1 + i / 60).largeur);
      maxRetour = Math.max(maxRetour, R.bords(arrets, 3 + i / 60).largeur);
    }
    expect(maxAller).toBeGreaterThan(110);
    expect(maxRetour).toBeGreaterThan(110);
  });

  it('l’anticipation du héros reste sous 5 % de l’amplitude', () => {
    // Rougit si le ratio ou le multiplicateur du héros monte : ce serait un rebond.
    expect(R.ANTICIPATION_RATIO * R.POIDS.heros.multiplicateur).toBeLessThanOrEqual(0.05);
    expect(R.ANTICIPATION_RATIO * R.POIDS.repos.multiplicateur).toBeGreaterThanOrEqual(0.02);
  });

  it('les avances varient avec le poids (une avance constante rend la grille audible)', () => {
    const avances = new Set(Object.values(R.POIDS).map((p) => p.avance));
    expect(avances.size).toBe(Object.keys(R.POIDS).length);
  });

  it('easeCamera est bornée et monotone', () => {
    let prec = -1;
    for (let i = 0; i <= 100; i++) {
      const v = R.easeCamera(i / 100);
      expect(v).toBeGreaterThanOrEqual(prec);
      prec = v;
    }
    expect(R.easeCamera(1)).toBe(1);
    expect(R.easeCamera(2)).toBe(1);
  });
});

describe('elan', () => {
  // Une fausse timeline qui note les appels.
  const fausse = () => {
    const appels = [];
    const tl = {};
    for (const m of ['set', 'to', 'fromTo']) tl[m] = (...a) => (appels.push([m, ...a]), tl);
    return { tl, appels };
  };

  it('n’écrit QUE des fromTo (un `to` lit son départ selon l’ordre des seeks)', () => {
    // Rougit si elan repasse à tl.to : vu au rendu, une image atteinte à rebours
    // différait de la même image atteinte en avançant.
    const { tl, appels } = fausse();
    R.elan(tl, {}, 'y', { de: 100, vers: 0, temps: 1, poids: 'heros' });
    expect(appels.filter(([m]) => m === 'to')).toHaveLength(0);
    expect(appels.filter(([m]) => m === 'fromTo')).toHaveLength(3); // recul, retour, ressort
  });

  it('le recul part dans le sens INVERSE du geste, à l’avance du poids', () => {
    // Rougit si l'anticipation va dans le même sens que le geste (ce serait un
    // élan qui « saute »), ou si l'avance ne dépend plus du poids.
    const { tl, appels } = fausse();
    const r = R.elan(tl, {}, 'y', { de: 100, vers: 0, temps: 1, poids: 'heros', fps: 60 });
    const recul = appels.find(([m]) => m === 'fromTo')[3].y;
    expect(recul).toBeGreaterThan(100);
    expect(r.depart).toBeCloseTo(1 - 9 / 60, 9);
  });
});

describe('scene — les fonctions pures du pont', () => {
  it('taille : à 1920 × 1080, la même toile que le fond d’écran sur un écran 1080p', () => {
    // Rougit si la formule s'écarte de wallpaper-main.js (pixelSize).
    expect(S.taille(1920, 1080)).toEqual({ k: 5, W: 384, H: 216 });
    expect(S.taille(1440, 900)).toEqual({ k: 4, W: 360, H: 225 });
  });

  it('taille refuse un agrandissement non entier', () => {
    // Rougit si l'on laisse passer k = 4,5 (pixels baveux, grille cassée).
    expect(() => S.taille(1920, 1080, 4.5)).toThrow(/ENTIER/);
  });

  it('pas : 30 images/s, et deux images à 60 fps tombent sur le même pas', () => {
    // Rougit si l'arrondi flottant fait sauter un pas (2/60 doit donner 1).
    expect(S.pas(0)).toBe(0);
    expect(S.pas(1 / 60)).toBe(0);
    expect(S.pas(2 / 60)).toBe(1);
    expect(S.pas(150 / 60)).toBe(75);
    expect(() => S.pas(NaN)).toThrow();
  });

  it('graine : la même graine donne la même suite, une autre graine une autre', () => {
    const a = S.graine(7);
    const b = S.graine(7);
    const c = S.graine(8);
    const sa = Array.from({ length: 50 }, a);
    expect(Array.from({ length: 50 }, b)).toEqual(sa);
    expect(Array.from({ length: 50 }, c)).not.toEqual(sa);
    expect(sa.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('etatA : chaque étape ne change que ce qu’elle nomme', () => {
    const base = { effet: 'rain', nuit: false };
    const etapes = [{ t: 1, nuit: true }, { t: 2, effet: 'snow' }];
    expect(S.etatA(base, etapes, 0.5)).toEqual({ effect: 'rain', night: false });
    expect(S.etatA(base, etapes, 1)).toEqual({ effect: 'rain', night: true });
    expect(S.etatA(base, etapes, 3)).toEqual({ effect: 'snow', night: true });
  });

  it('seuilTrame : p = 0 ne bascule rien, p = 1 bascule tout, le haut d’abord', () => {
    // Rougit si un seuil sort de [0, 1) (un pixel resterait figé au jour) ou si
    // le balayage s'inverse.
    let min = 1;
    let max = 0;
    for (let y = 0; y < 216; y++) {
      for (let x = 0; x < 8; x++) {
        const v = S.seuilTrame(x, y, 216, 'haut');
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
    const moyenne = (y) => [0, 1, 2, 3].reduce((s, x) => s + S.seuilTrame(x, y, 216, 'haut'), 0) / 4;
    expect(moyenne(10)).toBeLessThan(moyenne(200));
  });

  it('fige rend TOUJOURS le vrai Math.random et la vraie Date, même si fn lève', () => {
    // Rougit si le `finally` disparaît : GSAP et HyperFrames hériteraient du faux hasard.
    const vrai = Math.random;
    const VraieDate = globalThis.Date;
    let vu;
    expect(() =>
      S.fige(S.graine(1), 1234, () => {
        vu = [new Date().getTime(), Date.now()];
        throw new Error('boum');
      }),
    ).toThrow('boum');
    expect(vu).toEqual([1234, 1234]);
    expect(Math.random).toBe(vrai);
    expect(globalThis.Date).toBe(VraieDate);
  });

  it('fige tolère une horloge en lecture seule (le rendu HyperFrames la virtualise)', () => {
    // Rougit si fige affecte sans garde : vu au rendu, « Cannot assign to read
    // only property 'now' » — la timeline ne s'enregistrait jamais.
    const perf = { now: () => 42 };
    Object.defineProperty(perf, 'now', { value: perf.now, writable: false });
    expect(S.remplacer(perf, 'now', () => 0)).toBeNull();
    expect(perf.now()).toBe(42);
    const o = { v: 1 };
    const rendre = S.remplacer(o, 'v', 2);
    expect(o.v).toBe(2);
    rendre();
    expect(o.v).toBe(1);
  });
});

describe('scene — le moteur de Brume', () => {
  const SRC = join(ICI, '..', '..', 'src');

  it('chaque script de BR.scene.SCRIPTS existe dans src/', () => {
    // Rougit si une scène est renommée ou déplacée dans l'app : la copie
    // (copie-brume.sh) et les compositions pointeraient dans le vide.
    for (const f of S.SCRIPTS) expect(existsSync(join(SRC, f)), f).toBe(true);
  });

  it('chaque scène de src/renderer/pixel est chargée par le pont', () => {
    // Rougit si une nouvelle scène est ajoutée à l'app sans être ajoutée ici.
    const html = readFileSync(join(SRC, 'renderer', 'intro.html'), 'utf8');
    const scenes = [...html.matchAll(/src="(pixel\/[a-z]+\.js)"/g)].map((m) => 'renderer/' + m[1]);
    expect(scenes.length).toBeGreaterThan(8);
    for (const f of scenes) expect(S.SCRIPTS).toContain(f);
  });

  it('index.html charge lib/scene.js PUIS le moteur, dans l’ordre de SCRIPTS', () => {
    // Rougit si le bloc est réordonné (pixel.js après une scène = B.PX absent)
    // ou si scene.js passe après le moteur (hasard de chargement non semé).
    const html = readFileSync(join(ICI, '..', 'index.html'), 'utf8');
    const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    const i = srcs.indexOf('lib/scene.js');
    expect(i).toBeGreaterThanOrEqual(0);
    const moteur = srcs.slice(i + 1).filter((s) => s.startsWith('assets/brume/'));
    expect(moteur).toEqual(S.SCRIPTS.map((f) => 'assets/brume/' + f));
  });
});

describe('couleurs', () => {
  it('contraste : noir sur blanc = 21, une couleur sur elle-même = 1', () => {
    expect(C.contraste('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(C.contraste('#a9c6ee', '#a9c6ee')).toBeCloseTo(1, 9);
  });

  it('encreSur choisit l’encre lisible (C7 ≥ 4,5:1)', () => {
    // Rougit si encreSur renvoie l'encre claire sur la tuile allumée de l'app.
    expect(C.encreSur('#eef2f8')).toBe(C.ENCRES.sombre);
    expect(C.encreSur('#0d111a')).toBe(C.ENCRES.claire);
    expect(C.contraste(C.encreSur('#f2c27e'), '#f2c27e')).toBeGreaterThanOrEqual(4.5);
  });
});
