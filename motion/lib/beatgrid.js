/**
 * La grille de beats — le squelette temporel de TOUTE vidéo de l'atelier.
 *
 * Analogie : c'est le papier millimétré du temps. On ne dit plus « ça démarre
 * vers 2,28 s », on dit « ça démarre au temps 4 ». Changer le tempo d'une vidéo
 * entière, c'est changer UN nombre.
 *
 * Une particularité : GSAP place ses tweens en SECONDES, pas en frames. `temps(n)` rend donc des
 * secondes — mais des secondes CALÉES SUR UNE FRAME (multiple de 1/fps). Une
 * position à 2,2833 s tomberait entre deux images : selon l'arrondi du
 * moteur, le geste partirait une frame trop tôt une fois sur deux.
 *
 * Script CLASSIQUE (pas un module) : il pose `window.BR.beat`, et s'exporte en
 * CommonJS pour les tests. Voir la note `//pasDeType` de package.json.
 */
(function (racine) {
  'use strict';

  /** Le tempo de maison : 120 bpm, 60 fps, 4 temps par mesure — un temps = 0,5 s. */
  var BR_BEAT = Object.freeze({ bpm: 120, fps: 60, beatsPerBar: 4 });

  function fini(v) {
    return typeof v === 'number' && isFinite(v);
  }

  /**
   * ⚠ Les gardes LÈVENT. Un bpm nul donnerait des positions `NaN` ; GSAP
   * placerait le tween à 0 sans rien dire, et toute la vidéo partirait d'un bloc
   * à la première image. Mieux vaut un plantage net et nommé.
   */
  function beatGrid(options) {
    var o = options || {};
    var bpm = o.bpm === undefined ? BR_BEAT.bpm : o.bpm;
    var fps = o.fps === undefined ? BR_BEAT.fps : o.fps;
    var beatsPerBar = o.beatsPerBar === undefined ? BR_BEAT.beatsPerBar : o.beatsPerBar;

    if (!fini(bpm) || bpm <= 0) throw new Error('beatGrid: bpm doit être un nombre fini > 0 (reçu : ' + bpm + ').');
    if (!fini(fps) || fps <= 0) throw new Error('beatGrid: fps doit être un nombre fini > 0 (reçu : ' + fps + ').');
    if (!fini(beatsPerBar) || beatsPerBar <= 0) {
      throw new Error('beatGrid: beatsPerBar doit être un nombre fini > 0 (reçu : ' + beatsPerBar + ').');
    }

    // La durée EXACTE d'un temps, en frames. L'arrondi n'intervient qu'à la
    // toute fin, sur le résultat : arrondir la durée d'un temps PUIS la
    // multiplier fait dériver la grille (à 130 bpm / 60 fps, le temps 16
    // tombait 5 frames trop tard — invisible à 120 bpm, seul tempo testé).
    var framesParTemps = (fps * 60) / bpm;
    if (framesParTemps < 1) {
      throw new Error(
        'beatGrid: à ' + bpm + ' bpm et ' + fps + ' fps, un temps dure moins d’une image. ' +
          'Plafond : bpm ≤ 60 × fps (' + 60 * fps + ' ici).',
      );
    }

    function frame(n) {
      if (!fini(n)) throw new Error('beatGrid.frame: le numéro de temps doit être fini (reçu : ' + n + ').');
      return Math.round(n * framesParTemps);
    }

    /** Une durée en frames → secondes. Pour les décalages « 4 frames » de la doctrine. */
    function f(frames) {
      if (!fini(frames)) throw new Error('beatGrid.f: nombre de frames non fini (' + frames + ').');
      return frames / fps;
    }

    return Object.freeze({
      bpm: bpm,
      fps: fps,
      beatsPerBar: beatsPerBar,
      /** La frame du temps `n`. */
      frame: frame,
      /** La position GSAP (secondes, calée sur une frame) du temps `n`. */
      temps: function (n) {
        return frame(n) / fps;
      },
      /** La position GSAP du premier temps de la mesure `n`. */
      mesure: function (n) {
        return frame(n * beatsPerBar) / fps;
      },
      /** La durée de `n` temps en secondes — pour le `data-duration` de la racine. */
      duree: function (n) {
        return frame(n) / fps;
      },
      f: f,
    });
  }

  var api = { beatGrid: beatGrid, BR_BEAT: BR_BEAT };
  racine.BR = racine.BR || {};
  racine.BR.beat = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
