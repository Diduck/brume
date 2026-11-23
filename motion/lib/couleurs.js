/**
 * Les couleurs de Brume — le seul endroit de l'atelier qui manipule une couleur
 * calculée.
 *
 * Deux sources, jamais un hex recopié à la main :
 *   - l'INTERFACE (panneau, pastilles, texte) : les tokens `--br-*` de
 *     `theme.css`, recopiés d'overlay.css / settings.css de l'app. Dans le CSS :
 *     `var(--br-ink)`. Pour une interpolation GSAP : `couleur('ink')`.
 *   - les SCÈNES : leurs palettes de secours et de vignette, dans
 *     `src/shared/palettes.js` (copié dans assets/brume/). `palette('toits')`.
 *
 * Et une mesure, pour la check-list (C7) : `contraste(a, b)`, le rapport WCAG
 * entre deux couleurs, et `encreSur(fond)`, l'encre de l'app la plus lisible sur
 * un fond donné.
 *
 * Script CLASSIQUE : pose `window.BR.couleurs`, et s'exporte en CommonJS pour
 * les tests (les fonctions pures n'ont pas besoin du DOM).
 */
(function (racine) {
  'use strict';

  /** Les deux encres de l'app (overlay.css) : texte clair, et texte sur tuile allumée. */
  var ENCRES = Object.freeze({ claire: '#f2f4f8', sombre: '#0d1119' });

  function couleur(token, element) {
    var el = element || document.querySelector('.br-cadre') || document.documentElement;
    var v = getComputedStyle(el).getPropertyValue('--br-' + token).trim();
    if (!v) throw new Error('couleurs: token --br-' + token + ' vide ou inconnu (voir theme.css).');
    return v;
  }

  /** La palette d'une scène (clé de palettes.js : toits, annecy, nuit, pluie…). */
  function palette(cle) {
    var P = racine.BRUME_PALETTES;
    if (!P) throw new Error('couleurs.palette: palettes.js absent (charger lib/scene.js avant).');
    var p = P.PALETTES[cle];
    if (!p) throw new Error('couleurs.palette: scène « ' + cle + ' » inconnue. Clés : ' + Object.keys(P.PALETTES).join(', ') + '.');
    return p;
  }

  function rvb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) throw new Error('couleurs: « ' + hex + ' » n’est pas un hex #rrggbb.');
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /** Luminance relative WCAG 2.x. */
  function luminance(hex) {
    var c = rvb(hex).map(function (v) {
      var s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  /** Rapport de contraste WCAG (1 à 21). C7 : ≥ 4,5 sous 48 px, ≥ 3 au-delà. */
  function contraste(a, b) {
    var la = luminance(a);
    var lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /** L'encre de l'app la plus lisible sur `fond` (hex). */
  function encreSur(fond) {
    return contraste(ENCRES.claire, fond) >= contraste(ENCRES.sombre, fond) ? ENCRES.claire : ENCRES.sombre;
  }

  var api = { ENCRES: ENCRES, couleur: couleur, palette: palette, luminance: luminance, contraste: contraste, encreSur: encreSur };
  racine.BR = racine.BR || {};
  racine.BR.couleurs = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
