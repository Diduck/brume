/**
 * La typo est un ACTEUR (doctrine §9) : jamais un simple fondu. Entrées mot par
 * mot (défaut), 3 à 6 frames de décalage. Lettre par lettre : réservé à un mot
 * court — sur un titre de huit mots, c'est une machine à écrire.
 *
 * Le découpage se fait de façon SYNCHRONE au chargement, avant la construction
 * de la timeline : HyperFrames exige une timeline enregistrée d'un bloc, et un
 * découpage asynchrone donnerait une timeline vide.
 *
 * Script CLASSIQUE : pose `window.BR.texte`. Dépend de `window.gsap`.
 */
(function (racine) {
  'use strict';

  /**
   * Remplace le texte de `el` par un `<span>` par mot. Les espaces restent des
   * nœuds texte entre les spans : la césure et l'approche du texte d'origine
   * sont conservées. Renvoie la liste des spans.
   */
  function mots(el) {
    if (!el) throw new Error('texte.mots: élément introuvable.');
    if (el.__brMots) return el.__brMots;
    var brut = el.textContent || '';
    var morceaux = brut.split(/(\s+)/);
    el.textContent = '';
    var spans = [];
    for (var i = 0; i < morceaux.length; i++) {
      var m = morceaux[i];
      if (!m) continue;
      if (/^\s+$/.test(m)) {
        el.appendChild(document.createTextNode(m));
        continue;
      }
      var s = document.createElement('span');
      s.className = 'br-mot';
      s.textContent = m;
      el.appendChild(s);
      spans.push(s);
    }
    el.__brMots = spans;
    return spans;
  }

  /**
   * Entrée mot par mot. La couleur/opacité arrive PLUS VITE que la montée
   * (contraste de vitesse à l'intérieur d'un même objet, doctrine §5).
   *
   * @param o.position  instant de départ (s)
   * @param o.fps       fps de la grille (défaut 60)
   * @param o.decalage  frames entre deux mots (défaut 4, borne 3-6)
   * @param o.monte     montée en em (défaut 0.35)
   */
  function entreeMots(tl, el, o) {
    var opts = o || {};
    var fps = opts.fps || 60;
    var decalage = opts.decalage === undefined ? 4 : opts.decalage;
    if (decalage < 3 || decalage > 6) {
      throw new Error('texte.entreeMots: décalage de ' + decalage + ' frames — la doctrine dit 3 à 6.');
    }
    var liste = mots(el);
    var monte = opts.monte === undefined ? 0.35 : opts.monte;
    var p0 = opts.position || 0;
    // Bornage de la cascade à ~8 rangs : au-delà, ce n'est plus une entrée,
    // c'est un chargement. Les mots suivants partent avec le 8e.
    for (var i = 0; i < liste.length; i++) {
      var rang = Math.min(i, 7);
      var t = p0 + (rang * decalage) / fps;
      tl.fromTo(liste[i], { opacity: 0 }, { opacity: 1, duration: 12 / fps, ease: 'power2.out' }, t);
      tl.fromTo(
        liste[i],
        { y: monte + 'em' },
        { y: 0, duration: 30 / fps, ease: 'expo.out' },
        t,
      );
    }
    return p0 + (Math.min(liste.length - 1, 7) * decalage + 30) / fps;
  }

  var api = { mots: mots, entreeMots: entreeMots };
  racine.BR = racine.BR || {};
  racine.BR.texte = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
