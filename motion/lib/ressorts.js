/**
 * Les ressorts de l'atelier — et surtout : QUAND ne pas en mettre.
 *
 * Doctrine (`.claude/skills/motion/SKILL.md`, §10) :
 *   - Ressort → ce qui a une MASSE : un objet qu'on pousse, une poignée, un
 *               indicateur, une pastille.
 *   - Bézier  → la CAMÉRA et les FONDUS. Une caméra qui rebondit, c'est un
 *               caméraman qui trébuche.
 *
 * GSAP n'a pas de ressort physique (`elastic` et `back` sont des
 * courbes dessinées, pas une masse). On écrit donc la position EXACTE d'un
 * oscillateur amorti, en forme close : c'est une fonction pure du temps, donc
 * sûre au « seek » de HyperFrames, qui rend n'importe quelle image dans
 * n'importe quel ordre.
 *
 * Les présets sont des paramètres PHYSIQUES (raideur, amortissement, masse),
 * pas des courbes : un geste réglé garde son caractère quelle que soit sa durée.
 *
 * Deux façons de s'en servir :
 *   1. `ressortTo(tl, el, vars, position, 'settle')` — un tween GSAP ordinaire
 *      dont l'ease EST le ressort, et la durée le temps qu'il met à se poser.
 *   2. `valeurMulti(changes, t)` / `bords(arrets, t)` — des fonctions pures du
 *      temps, appliquées à chaque image par `chaqueImage(tl, fn)`. Pour une
 *      valeur qui change de cible plusieurs fois, ou l'étirement à deux bords.
 *
 * Script CLASSIQUE : pose `window.BR.ressorts`, et s'exporte en CommonJS pour
 * les tests.
 */
(function (racine) {
  'use strict';

  /* ==========================================================================
   * Les présets. Quatre, pas quinze. Le nom dit l'INTENTION, pas la physique.
   * ======================================================================== */
  var PRESETS = Object.freeze({
    /** Le geste qui part vite et se pose net (ζ ≈ 1,05 : aucun dépassement). */
    snap: Object.freeze({ damping: 26, stiffness: 220, mass: 0.7 }),
    /**
     * La pose : ce qui ARRIVE et s'installe. ⚠ 22 et pas 34 — à 34 le ressort
     * est SUR-amorti (ζ ≈ 1,55) et RAMPE : 1,6 % du trajet encore à faire une
     * seconde plus tard, et la boucle ne se referme pas.
     */
    settle: Object.freeze({ damping: 22, stiffness: 120, mass: 1 }),
    /**
     * Le bord d'attaque, le seul qui oscille (ζ ≈ 0,69, ~5 % de dépassement).
     * ⚠ JAMAIS seul sur un objet entier — c'est le rebond interdit. Il n'existe
     * que pour être opposé à `settle` sur l'AUTRE bord (cf. `bords`).
     */
    stretch: Object.freeze({ damping: 18, stiffness: 190, mass: 0.9 }),
    /** Repli caméra, critique, jamais de rebond. Préférer `rampe()` (Bézier). */
    camera: Object.freeze({ damping: 21, stiffness: 100, mass: 1 }),
  });

  /** Écart résiduel sous lequel un ressort est « posé » : 0,05 % du trajet. */
  var EPS_POSE = 0.0005;

  function preset(nomOuConfig) {
    var c = typeof nomOuConfig === 'string' ? PRESETS[nomOuConfig] : nomOuConfig;
    if (!c || !(c.stiffness > 0) || !(c.mass > 0) || !(c.damping >= 0)) {
      throw new Error(
        'ressorts: préset inconnu ou invalide « ' + String(nomOuConfig) + ' ». ' +
          'Présets : ' + Object.keys(PRESETS).join(', ') + ', ou { damping, stiffness, mass }.',
      );
    }
    return c;
  }

  /**
   * La position x(t) d'un ressort qui part de 0, au repos, vers 1. `t` en
   * secondes. Forme close des trois régimes (sous-, critique, sur-amorti).
   */
  function position(nomOuConfig) {
    var c = preset(nomOuConfig);
    var w0 = Math.sqrt(c.stiffness / c.mass);
    var z = c.damping / (2 * Math.sqrt(c.stiffness * c.mass));
    if (Math.abs(z - 1) < 1e-6) {
      return function (t) {
        return t <= 0 ? 0 : 1 - Math.exp(-w0 * t) * (1 + w0 * t);
      };
    }
    if (z < 1) {
      var wd = w0 * Math.sqrt(1 - z * z);
      return function (t) {
        if (t <= 0) return 0;
        return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
      };
    }
    var wo = w0 * Math.sqrt(z * z - 1);
    return function (t) {
      if (t <= 0) return 0;
      return 1 - Math.exp(-z * w0 * t) * (Math.cosh(wo * t) + ((z * w0) / wo) * Math.sinh(wo * t));
    };
  }

  var cache = {};

  /**
   * `{ duree, ease }` — la durée est le temps que met le ressort à se poser
   * (dernier instant où il sort de ±EPS_POSE), l'ease la courbe normalisée pour
   * que `ease(1) === 1` EXACTEMENT. Balayage à pas fixe, une fois par préset :
   * déterministe (ni `Math.random`, ni horloge).
   */
  function ressort(nomOuConfig) {
    var cle = typeof nomOuConfig === 'string' ? nomOuConfig : JSON.stringify(nomOuConfig);
    if (cache[cle]) return cache[cle];
    var c = preset(nomOuConfig);
    var pos = position(c);
    var w0 = Math.sqrt(c.stiffness / c.mass);
    var z = c.damping / (2 * Math.sqrt(c.stiffness * c.mass));
    var lent = z <= 1 ? z * w0 : (z - Math.sqrt(z * z - 1)) * w0; // mode le plus lent
    var BALAYAGE = 14 / lent;
    var N = 6000;
    var T = BALAYAGE;
    for (var i = N; i >= 0; i--) {
      var t = (i / N) * BALAYAGE;
      if (Math.abs(1 - pos(t)) > EPS_POSE) {
        T = ((i + 1) / N) * BALAYAGE;
        break;
      }
    }
    var xT = pos(T);
    var r = Object.freeze({
      duree: T,
      ease: function (p) {
        return pos(p * T) + p * (1 - xT);
      },
    });
    cache[cle] = r;
    return r;
  }

  /**
   * Un tween GSAP porté par un ressort. Renvoie la timeline (chaînable).
   * `depuis` (facultatif, recommandé) : les valeurs de départ, pour un
   * `fromTo` — un `to` lit son départ quand GSAP l'initialise, et ce moment
   * dépend de l'ordre des seeks (voir `elan`).
   */
  function ressortTo(tl, cible, vars, positionTl, nomOuConfig, depuis) {
    var r = ressort(nomOuConfig || 'settle');
    var v = Object.assign({}, vars, { duration: r.duree, ease: r.ease });
    return depuis ? tl.fromTo(cible, Object.assign({}, depuis), v, positionTl) : tl.to(cible, v, positionTl);
  }

  /* ==========================================================================
   * LA VALEUR À CIBLES MULTIPLES — une somme de coups de pouce amortis.
   *
   * Au lieu de retenir « où en est le curseur », on additionne des
   * contributions : chaque changement démarre à son instant et s'éteint tout
   * seul. À l'instant t, la somme vaut toujours la même chose, qu'on ait rendu
   * les images précédentes ou aucune.
   * ======================================================================== */

  /**
   * @param changes  [{ temps (s), delta, preset? }]
   * @param t        l'instant (s), en temps LOCAL de la timeline
   * @param depuis   la valeur avant le premier changement (défaut 0)
   */
  function valeurMulti(changes, t, depuis, presetParDefaut) {
    var base = depuis === undefined ? 0 : depuis;
    if (!isFinite(base)) throw new Error('valeurMulti: `depuis` doit être fini (reçu : ' + base + ').');
    var somme = base;
    for (var i = 0; i < changes.length; i++) {
      var ch = changes[i];
      // ⚠ Un delta NaN n'est PAS une erreur en CSS : la propriété est ignorée,
      // l'élément reste empilé en haut à gauche, rien dans les logs.
      if (!isFinite(ch.delta)) throw new Error('valeurMulti: delta non numérique au changement #' + i + '.');
      if (!isFinite(ch.temps)) throw new Error('valeurMulti: temps non fini au changement #' + i + '.');
      var local = t - ch.temps;
      if (local <= 0) continue;
      somme += ch.delta * position(ch.preset || presetParDefaut || 'settle')(local);
    }
    return somme;
  }

  /**
   * L'ÉTIREMENT — deux ressorts, jamais un. Le bord qui MÈNE la course est plus
   * raide que celui qui SUIT : la barre s'allonge en route puis se resserre.
   * Le sens se recalcule à CHAQUE transition (sur le centre, pas sur un bord).
   *
   * @param arrets [{ temps, start, end }] — le premier est la position de départ
   * @returns { start, end, largeur }
   */
  function bords(arrets, t, options) {
    var o = options || {};
    var mene = o.mene || 'stretch';
    var suit = o.suit || 'settle';
    if (!arrets.length) throw new Error('bords: il faut au moins un arrêt.');
    var cs = [];
    var ce = [];
    for (var i = 1; i < arrets.length; i++) {
      var a = arrets[i - 1];
      var b = arrets[i];
      if (i > 1 && b.temps <= a.temps) {
        throw new Error(
          'bords: arrêts STRICTEMENT croissants en temps — l’arrêt #' + i + ' (' + b.temps +
            ' s) ne suit pas le #' + (i - 1) + ' (' + a.temps + ' s).',
        );
      }
      var versDroite = (b.start + b.end) / 2 >= (a.start + a.end) / 2;
      cs.push({ temps: b.temps, delta: b.start - a.start, preset: versDroite ? suit : mene });
      ce.push({ temps: b.temps, delta: b.end - a.end, preset: versDroite ? mene : suit });
    }
    var start = valeurMulti(cs, t, arrets[0].start);
    var end = valeurMulti(ce, t, arrets[0].end);
    return { start: start, end: end, largeur: end - start };
  }

  /* ==========================================================================
   * L'ANTICIPATION — le contre-mouvement minuscule avant tout geste ample.
   * ======================================================================== */

  /** 3 frames de contre-mouvement (la doctrine dit 2 à 4). */
  var ANTICIPATION_FRAMES = 3;
  /** 3,1 % × 1,6 (héros) = 4,96 % — sous le plafond de 5 %. 3,1 % × 0,7 (repos) = 2,17 %. */
  var ANTICIPATION_RATIO = 0.031;
  /** Sous 24 px de geste, pas d'anticipation : moins d'un pixel de recul, c'est un tremblement. */
  var SEUIL_ANTICIPATION_PX = 24;

  /**
   * Le POIDS d'un moment de la partition règle l'avance (syncope) et la force
   * de l'anticipation. Une avance CONSTANTE rendrait la grille audible.
   */
  var POIDS = Object.freeze({
    heros: Object.freeze({ avance: 9, multiplicateur: 1.6 }),
    appui: Object.freeze({ avance: 5, multiplicateur: 1.0 }),
    repos: Object.freeze({ avance: 2, multiplicateur: 0.7 }),
  });

  /**
   * Un geste complet sur UNE propriété : anticipation → ressort, calé sur un
   * temps de la grille. Le geste part `avance` frames AVANT `temps` ; le
   * contre-mouvement occupe les 3 frames qui précèdent ce départ.
   *
   * @param o.de, o.vers   valeurs de départ et d'arrivée (nombres)
   * @param o.temps        la position du TEMPS visé (s), typiquement `grille.temps(n)`
   * @param o.poids        'heros' | 'appui' | 'repos'
   * @param o.fps          fps de la grille (pour convertir les frames)
   * @param o.preset       préset du ressort (défaut 'settle')
   * @param o.anticiper    forcer/empêcher l'anticipation (défaut : |vers-de| ≥ 24)
   * @returns { depart, arrivee } en secondes
   */
  function elan(tl, cible, prop, o) {
    var p = POIDS[o.poids || 'appui'];
    if (!p) throw new Error('elan: poids inconnu « ' + o.poids + ' » (heros | appui | repos).');
    if (!isFinite(o.de) || !isFinite(o.vers)) throw new Error('elan: `de` et `vers` doivent être des nombres finis.');
    var fps = o.fps || 60;
    var depart = Math.max(0, o.temps - p.avance / fps);
    var amplitude = o.vers - o.de;
    var anticiper = o.anticiper === undefined ? Math.abs(amplitude) >= SEUIL_ANTICIPATION_PX : o.anticiper;

    // ⚠ fromTo PARTOUT, jamais to : un `to` lit sa valeur de départ au moment
    // où GSAP l'initialise, et ce moment dépend de l'ORDRE des seeks. Vu au
    // rendu : une image atteinte en reculant (4,9 s → 2,5 s) différait de la
    // même image atteinte en avançant. Les valeurs de départ sont connues : on
    // les écrit.
    var debut = {};
    debut[prop] = o.de;
    tl.set(cible, debut, 0);

    var recul = {};
    recul[prop] = o.de - amplitude * ANTICIPATION_RATIO * p.multiplicateur;
    if (anticiper && depart * fps >= ANTICIPATION_FRAMES) {
      var demi = ANTICIPATION_FRAMES / 2 / fps;
      tl.fromTo(cible, Object.assign({}, debut), Object.assign({}, recul, { duration: demi, ease: 'sine.out' }), depart - 2 * demi);
      tl.fromTo(cible, Object.assign({}, recul), Object.assign({}, debut, { duration: demi, ease: 'sine.in' }), depart - demi);
    }

    var fin = {};
    fin[prop] = o.vers;
    var r = ressort(o.preset || 'settle');
    tl.fromTo(cible, Object.assign({}, debut), Object.assign(fin, { duration: r.duree, ease: r.ease }), depart);
    return { depart: depart, arrivee: depart + r.duree };
  }

  /* ==========================================================================
   * LA CAMÉRA ET LES FONDUS — Bézier, jamais ressort.
   * ======================================================================== */

  /**
   * `--ease` de l'app (overlay.css : `cubic-bezier(0.16, 1, 0.3, 1)`), en forme close :
   * `1 - (1-t)^5` en est l'approximation à l'œil près, sans itération.
   */
  function easeCamera(t) {
    var c = Math.min(1, Math.max(0, t));
    return 1 - Math.pow(1 - c, 5);
  }

  /**
   * Une rampe de caméra (zoom, panoramique, fondu) bornée aux deux bouts.
   * `debut === fin` n'est PAS une erreur : c'est une caméra FIXE.
   */
  function rampe(tl, cible, vars, debut, fin) {
    if (fin === debut) return tl.set(cible, vars, debut);
    if (fin < debut) {
      throw new Error('rampe: la fin (' + fin + ' s) précède le début (' + debut + ' s).');
    }
    return tl.to(cible, Object.assign({}, vars, { duration: fin - debut, ease: easeCamera }), debut);
  }

  /* ==========================================================================
   * chaqueImage — un seul `onUpdate` par timeline, plusieurs rendus.
   *
   * Une timeline GSAP n'a qu'UN `onUpdate`. Toutes les valeurs calculées
   * (`valeurMulti`, `bords`, curseur…) passent par ce répartiteur et coexistent.
   * Chaque fonction reçoit `tl.time()` — le temps LOCAL de la timeline, ce qui
   * reste juste quand HyperFrames l'imbrique dans une timeline maîtresse.
   * ======================================================================== */
  function chaqueImage(tl, fn) {
    if (!tl.__brRendus) {
      tl.__brRendus = [];
      tl.eventCallback('onUpdate', function () {
        var t = tl.time();
        for (var i = 0; i < tl.__brRendus.length; i++) tl.__brRendus[i](t);
      });
    }
    tl.__brRendus.push(fn);
    fn(0);
  }

  var api = {
    PRESETS: PRESETS,
    POIDS: POIDS,
    ANTICIPATION_FRAMES: ANTICIPATION_FRAMES,
    ANTICIPATION_RATIO: ANTICIPATION_RATIO,
    SEUIL_ANTICIPATION_PX: SEUIL_ANTICIPATION_PX,
    position: position,
    ressort: ressort,
    ressortTo: ressortTo,
    valeurMulti: valeurMulti,
    bords: bords,
    elan: elan,
    easeCamera: easeCamera,
    rampe: rampe,
    chaqueImage: chaqueImage,
  };
  racine.BR = racine.BR || {};
  racine.BR.ressorts = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
