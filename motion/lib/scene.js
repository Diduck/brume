/**
 * Le PONT vers les vraies scènes de Brume — le même code que le fond d'écran,
 * rendu image par image, de façon DÉTERMINISTE, pour HyperFrames.
 *
 * Trois problèmes, trois réponses :
 *
 * 1. CHARGER LE MOTEUR. Les scènes sont des scripts classiques qui remplissent
 *    `window.Brume` (voir src/renderer/wallpaper.html et intro.html). La
 *    composition les liste en `<script src="assets/brume/…">`, dans l'ordre de
 *    `BR.scene.SCRIPTS` (bloc à copier depuis index.html ; un test vérifie
 *    l'ordre). Pourquoi pas un chargement automatique ? HyperFrames INLINE les
 *    scripts locaux dans la page et les exécute une fois le document complet :
 *    un `document.write` ou un `<script>` injecté arriverait trop tard, et la
 *    timeline doit être construite de façon synchrone.
 *    Les fichiers sont lus dans `assets/brume/` (copie de ../src faite par
 *    `scripts/copie-brume.sh`) : HyperFrames n'embarque que le dossier du
 *    projet, un `../src/…` n'existerait pas au rendu.
 *    ⚠ CE fichier se charge AVANT eux : les scripts qui tirent du hasard au
 *    chargement le tirent alors d'une graine fixe (le vrai `Math.random` est
 *    rendu au premier `poser()`).
 *
 * 2. LE HASARD ET L'HORLOGE. Les scènes tirent `Math.random()` partout
 *    (passants, nuages, oiseaux) et lisent parfois l'heure (`new Date()` : la
 *    pendule de la chambre, le train des drones). Pendant la construction,
 *    chaque `update` et chaque `draw`, on remplace donc `Math.random` par un
 *    générateur À GRAINE FIXE, et `Date` / `performance.now` par une horloge
 *    simulée. On rend les vrais objets aussitôt après : GSAP et HyperFrames ne
 *    voient jamais les faux.
 *
 * 3. LE SEEK. HyperFrames saute à n'importe quel instant, dans n'importe quel
 *    ordre. La scène, elle, avance par petits pas (`update(dt)`), comme dans
 *    l'app. À l'instant t, on RE-SIMULE donc depuis 0 par pas fixes de 1/30 s
 *    (la cadence du fond d'écran), en gardant l'état atteint : un seek vers
 *    l'avant (le cas du rendu) ne joue que les pas manquants ; un seek vers
 *    l'arrière reconstruit la scène et rejoue tout. L'image à t est ainsi la
 *    même, qu'on l'ait rendue seule ou après toutes les autres.
 *
 * Usage (voir index.html) :
 *
 *   <canvas class="br-scene" data-scene="toits" data-effect="snow" data-night="1"></canvas>
 *   <script src="lib/scene.js"></script>          ← AVANT les scripts de Brume
 *   <script src="assets/brume/shared/strings.js"></script>   … (BR.scene.SCRIPTS)
 *   <script> …
 *     var vue = BR.scene.poser(toile);             // lit les data-*
 *     BR.scene.piloter(tl, vue);                   // chaque seek → vue.allerA(t)
 *   </script>
 *
 * Script CLASSIQUE (pas un module) : pose `window.BR.scene`. Les fonctions pures
 * (graine, taille, pas, état à l'instant t, seuil de trame) s'exportent aussi en
 * CommonJS pour les tests.
 */
(function (racine) {
  'use strict';

  /** Cadence de simulation des scènes : celle du fond d'écran (wallpaper-main.js). */
  const FPS_SIM = 30;
  const PAS = 1 / FPS_SIM;

  /**
   * Les scripts du moteur, dans l'ordre de src/renderer/intro.html (qui charge
   * aussi strings.js et la caméra d'ouverture), chemins relatifs à
   * `assets/brume/`. Absents : le WebGL du fond lofi (shaders, renderer, lofi)
   * et engine/util.js, dont les scènes pixel ne se servent pas.
   */
  const SCRIPTS = [
    'shared/strings.js',
    'shared/palettes.js',
    'renderer/pixel/pixel.js',
    'renderer/pixel/sprites.js',
    'renderer/pixel/people.js',
    'renderer/pixel/common.js',
    'renderer/pixel/cafe.js',
    'renderer/pixel/city.js',
    'renderer/pixel/terrace.js',
    'renderer/pixel/forest.js',
    'renderer/pixel/sea.js',
    'renderer/pixel/room.js',
    'renderer/pixel/drones.js',
    'renderer/pixel/rooftops.js',
    'renderer/pixel/annecy.js',
    'renderer/pixel/planete.js',
    'renderer/intro-multiplane.js',
    'renderer/ui/icons.js',
  ];

  /** Les 8 temps de Brume (AGENTS.md § 1). */
  const TEMPS_METEO = ['none', 'snow', 'rain', 'storm', 'sakura', 'leaves', 'fireflies', 'starfall'];

  /* ==========================================================================
   * Fonctions PURES — testées sans navigateur (tests/lib.test.mjs).
   * ======================================================================== */

  /** Générateur à graine (mulberry32, comme `B.PX.rng`) : [0, 1). */
  function graine(n) {
    let s = (n >>> 0) || 1;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * La taille logique, calculée EXACTEMENT comme le fond d'écran
   * (wallpaper-main.js, pixelSize) : ~240 px de haut, agrandis d'un facteur
   * ENTIER. À 1920 × 1080 : k = 5, 384 × 216 — l'image d'un écran 1080p.
   * `k` forcé (ex. 4 → 480 × 270) reste un entier, sinon on lève.
   */
  function taille(largeur, hauteur, kForce) {
    if (!(largeur > 0) || !(hauteur > 0)) throw new Error('scene.taille: dimensions invalides (' + largeur + ' × ' + hauteur + ').');
    const k = kForce === undefined || kForce === null ? Math.max(2, Math.round(hauteur / 240)) : kForce;
    if (!Number.isInteger(k) || k < 1) {
      throw new Error('scene.taille: facteur k = ' + k + ' — il doit être ENTIER (pixels nets), sinon la grille de pixels bave.');
    }
    return { k: k, W: Math.ceil(largeur / k), H: Math.ceil(hauteur / k) };
  }

  /**
   * Le numéro du pas de simulation affiché à l'instant t (s). Le epsilon
   * absorbe l'arrondi des positions GSAP (2 × 1/60 ne fait pas toujours 1/30).
   */
  function pas(t) {
    if (!isFinite(t)) throw new Error('scene.pas: instant non fini (' + t + ').');
    return Math.max(0, Math.floor(t * FPS_SIM + 1e-6));
  }

  /**
   * L'état météo { effect, night } à l'instant t. `etats` : liste d'étapes
   * `{ t, effet?, nuit? }` triées ; chacune ne change que ce qu'elle nomme.
   * C'est un changement SEC (la scène repeint son décor, comme dans l'app) ;
   * pour un passage en douceur, voir `passage()`.
   */
  function etatA(base, etats, t) {
    let effect = base.effet;
    let night = !!base.nuit;
    for (let i = 0; i < (etats || []).length; i++) {
      const e = etats[i];
      if (e.t > t + 1e-9) break;
      if (e.effet !== undefined) effect = e.effet;
      if (e.nuit !== undefined) night = !!e.nuit;
    }
    return { effect: effect, night: night };
  }

  /** Bayer 4 × 4 normalisée dans [0, 1) — la trame de pixel.js. */
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function bayer(x, y) {
    return BAYER[(x & 3) + (y & 3) * 4] / 16;
  }

  /**
   * Le seuil de la TRAME de passage au pixel (x, y) : un pixel bascule vers la
   * scène d'arrivée quand la progression p le dépasse. Mélange de la trame de
   * Bayer (le grain pixel art) et d'un balayage vertical (`sens` : 'haut' = la
   * nuit tombe du ciel, 'bas' = elle monte du sol). Toujours dans [0, 1) :
   * p = 0 → aucune bascule, p = 1 → toutes.
   */
  function seuilTrame(x, y, H, sens, part) {
    const grain = part === undefined ? 0.45 : part;
    const v = sens === 'bas' ? 1 - (y + 0.5) / H : (y + 0.5) / H;
    return (1 - grain) * Math.min(0.999, Math.max(0, v)) + grain * bayer(x, y);
  }

  /** "21:30" → millisecondes d'une date fixe (le 21 décembre 2026, heure locale). */
  function heureFixe(texte) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(texte || '18:30'));
    if (!m) throw new Error('scene: data-heure « ' + texte + ' » — format attendu HH:MM.');
    return new Date(2026, 11, 21, Number(m[1]), Number(m[2]), 0, 0).getTime();
  }

  /* ==========================================================================
   * Le hasard et l'horloge, figés le temps d'un appel.
   * ======================================================================== */

  /** De quoi rendre le vrai Math.random à la fin du chargement (null : rien pris). */
  let rendreHasard = null;

  /**
   * Exécute fn avec Math.random = alea, Date et performance.now = horloge
   * simulée (ms). Les vrais objets sont TOUJOURS rendus, même si fn lève.
   */
  function fige(alea, ms, fn) {
    const DateVraie = racine.Date;
    class DateFigee extends DateVraie {
      constructor() {
        if (arguments.length) super(...arguments);
        else super(ms);
      }
      static now() {
        return ms;
      }
    }
    // ⚠ Au RENDU, HyperFrames virtualise lui-même l'horloge : `performance.now`
    // (et parfois `Date`) y sont en lecture seule, et une affectation LÈVE en
    // mode strict (vu : « Cannot assign to read only property 'now' »). On ne
    // remplace donc que ce qui se laisse remplacer, et on ne rend que ce qu'on
    // a pris. Une horloge déjà virtualisée reste déterministe de toute façon.
    const rendre = [
      remplacer(Math, 'random', alea),
      remplacer(racine, 'Date', DateFigee),
      racine.performance ? remplacer(racine.performance, 'now', () => ms) : null,
    ];
    try {
      return fn();
    } finally {
      for (let i = rendre.length - 1; i >= 0; i--) if (rendre[i]) rendre[i]();
    }
  }

  /** obj[cle] = valeur si c'est permis ; renvoie de quoi le rendre, ou null. */
  function remplacer(obj, cle, valeur) {
    let avant;
    try {
      avant = obj[cle];
      obj[cle] = valeur;
    } catch (e) {
      return null;
    }
    if (obj[cle] !== valeur) return null;
    return function () {
      obj[cle] = avant;
    };
  }

  /* ==========================================================================
   * 1. Le chargement du moteur : graine fixe JUSQU'AU premier usage.
   * ======================================================================== */

  function debutChargement() {
    if (typeof document === 'undefined') return;
    // Les scripts de Brume qui suivent tirent leur hasard de chargement d'ici.
    rendreHasard = remplacer(Math, 'random', graine(20261221));
  }

  function moteur() {
    if (rendreHasard) {
      rendreHasard(); // fin du chargement : le vrai hasard revient
      rendreHasard = null;
    }
    const B = racine.Brume;
    const manque = [];
    if (!racine.BRUME_STRINGS) manque.push('shared/strings.js');
    if (!racine.BRUME_PALETTES) manque.push('shared/palettes.js');
    if (!B || !B.PX) manque.push('renderer/pixel/pixel.js');
    if (!B || !B.PXC) manque.push('renderer/pixel/common.js');
    if (!B || !B.Multiplane) manque.push('renderer/intro-multiplane.js');
    if (manque.length) {
      throw new Error(
        'scene: moteur de Brume incomplet — manquent ' + manque.join(', ') + '. ' +
          'Copier les <script src="assets/brume/…"> d\'index.html (ordre : BR.scene.SCRIPTS), ' +
          'et lancer `bash motion/scripts/install.sh` (ou `npm run brume`) pour copier ../src.',
      );
    }
    return B;
  }

  /* ==========================================================================
   * 2. Une scène vivante, pilotée par l'instant t.
   * ======================================================================== */

  function lireBooleen(v, defaut) {
    if (v === undefined || v === null || v === '') return defaut;
    return !(v === '0' || v === 'false' || v === 'non' || v === false);
  }

  /** Options d'une toile : data-* de la toile, écrasées par `o`. */
  function options(toile, o) {
    const d = (toile && toile.dataset) || {};
    const cadre = toile && toile.closest ? toile.closest('[data-composition-id]') : null;
    const r = Object.assign(
      {
        cle: d.scene,
        effet: d.effect || 'none',
        nuit: lireBooleen(d.night, false),
        graine: d.graine ? Number(d.graine) : 7,
        heure: d.heure || '18:30',
        meteo: lireBooleen(d.meteo, true),
        prechauffe: d.prechauffe ? Number(d.prechauffe) : 2,
        camera: d.camera || null,
        dureeCamera: d.cameraDuree ? Number(d.cameraDuree) : 4,
        largeur: cadre ? Number(cadre.getAttribute('data-width')) || 1920 : 1920,
        hauteur: cadre ? Number(cadre.getAttribute('data-height')) || 1080 : 1080,
        k: d.k ? Number(d.k) : undefined,
        etats: null,
      },
      o || {},
    );
    if (!r.cle) throw new Error('scene: data-scene manquant (ex. data-scene="toits").');
    if (TEMPS_METEO.indexOf(r.effet) < 0) {
      throw new Error('scene: temps « ' + r.effet + ' » inconnu. Les 8 temps : ' + TEMPS_METEO.join(', ') + '.');
    }
    return r;
  }

  class Vivante {
    /**
     * @param toile  le <canvas> visible (ou null : toile hors page, pour passage())
     * @param o      { cle, effet, nuit, graine, heure, meteo, prechauffe, camera,
     *                 dureeCamera, etats, largeur, hauteur, k }
     */
    constructor(toile, o) {
      this.B = moteur();
      this.o = o;
      if (!this.B.PixelScenes[o.cle]) {
        throw new Error('scene: clé « ' + o.cle + ' » inconnue. Clés : ' + Object.keys(this.B.PixelScenes).join(', ') + '.');
      }
      const tl = taille(o.largeur, o.hauteur, o.k);
      this.k = tl.k;
      this.W = tl.W;
      this.H = tl.H;
      this.camera = o.camera === 'ouverture';
      this.toile = toile || document.createElement('canvas');
      // Ouverture : la caméra multiplane dessine déjà agrandie (× k) ; sinon, la
      // toile reste à la taille LOGIQUE et le CSS l'agrandit (pixelated).
      this.toile.width = this.camera ? this.W * this.k : this.W;
      this.toile.height = this.camera ? this.H * this.k : this.H;
      if (toile) {
        toile.style.width = this.W * this.k + 'px';
        toile.style.height = this.H * this.k + 'px';
        toile.style.imageRendering = 'pixelated';
      }
      this.g = this.toile.getContext('2d', { willReadFrequently: true });
      this.t0 = heureFixe(o.heure);
      this.n = -1;
    }

    /** Ce qui se passe à l'instant LOCAL t (s) de la timeline. */
    allerA(t) {
      const n = pas(t);
      if (n < this.n || this.n < 0) this.reconstruire();
      while (this.n < n) this.avancer();
      return this;
    }

    /** Hasard et horloge simulée du pas courant. */
    figer(fn) {
      const ms = this.t0 + Math.round((this.n + this.pre) * PAS * 1000);
      return fige(this.alea, ms, fn);
    }

    reconstruire() {
      const o = this.o;
      const B = this.B;
      this.alea = graine(o.graine);
      this.pre = Math.max(0, Math.round(o.prechauffe * FPS_SIM));
      this.n = -this.pre - 1;
      this.figer(() => {
        const etat0 = etatA(o, o.etats, 0);
        const Scene = B.PixelScenes[o.cle];
        if (this.camera) {
          // Exactement l'enregistrement de l'ouverture (intro.js, record) : un monde
          // élargi du côté d'où arrive la caméra, puis la caméra multiplane.
          const from = B.Multiplane.from(o.cle);
          const wide = Math.round(this.W * 1.6);
          const margin = Math.round(this.W * 0.25);
          const ext = from === 'right' ? { left: margin, right: wide } : { left: wide, right: margin };
          this.scene = new Scene(this.W, this.H, { ext: ext });
          this.scene.update(0.001, { effect: etat0.effect, night: etat0.night });
          this.cam = null; // posée après le préchauffage
          this.meteo = null; // la caméra a sa propre météo
        } else {
          this.scene = new Scene(this.W, this.H);
          // La météo qui TOMBE est une autre couche dans l'app (WebGL). On reprend
          // celle de l'ouverture (même code, mêmes réglages), dessinée par-dessus.
          this.meteo = o.meteo ? this.creerMeteo(etat0.effect) : null;
          this.meteoEffet = etat0.effect;
        }
      });
      this.tMeteo = 0;
      // Préchauffage : la scène a déjà vécu quelques secondes à t = 0 (des passants,
      // de la fumée…), comme les vignettes de l'app. Image 0 = la vignette de la vidéo.
      while (this.n < -1) this.avancer(true);
      if (this.camera) {
        this.figer(() => {
          const etat0 = etatA(o, o.etats, 0);
          this.cam = new B.Multiplane(this.scene, o.cle, etat0.effect, this.W, this.H, this.k, o.dureeCamera);
        });
        this.premiere = true;
      }
      this.n = -1;
      this.avancer();
    }

    creerMeteo(effet) {
      return this.B.Multiplane.prototype.buildWeather.call({ W: this.W, H: this.H, effect: effet });
    }

    /** Un pas de 1/30 s. Le dessin est fait à CHAQUE pas : la suite des appels est
     *  identique quel que soit l'ordre des seeks (une scène peut tenir de l'état
     *  dans draw). */
    avancer(prechauffage) {
      this.n++;
      const t = this.n * PAS;
      const etat = etatA(this.o, this.o.etats, Math.max(0, t));
      this.figer(() => {
        if (this.camera) {
          if (prechauffage || !this.cam) {
            this.scene.update(PAS, { effect: etat.effect, night: etat.night });
            return;
          }
          this.cam.draw(this.g, this.premiere ? 0 : PAS);
          this.premiere = false;
          return;
        }
        this.scene.update(PAS, { effect: etat.effect, night: etat.night });
        if (this.o.meteo && etat.effect !== this.meteoEffet) {
          this.meteo = this.creerMeteo(etat.effect);
          this.meteoEffet = etat.effect;
        }
        this.tMeteo += PAS;
        if (this.meteo) this.meteo.update(PAS, this.tMeteo);
        const g = this.g;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
        g.clearRect(0, 0, this.W, this.H);
        g.imageSmoothingEnabled = false;
        this.scene.draw(g);
        if (this.meteo) {
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.globalAlpha = 1;
          g.globalCompositeOperation = 'source-over';
          this.meteo.draw(g, this.tMeteo);
        }
      });
    }
  }

  /* ==========================================================================
   * 3. Le passage tramé — d'un état à un autre, au pixel près.
   *
   * Deux scènes identiques (même clé, même graine) avancent ensemble ; l'image
   * passe de l'une à l'autre par une TRAME (Bayer + balayage), pas par un fondu :
   * un fondu enchaîné mélangerait les couleurs et sortirait du pixel art. La
   * progression `p` (0 → 1) est une propriété ordinaire, tweenée par GSAP :
   *
   *   var nuit = BR.scene.passage(toile, { vers: { nuit: true }, sens: 'haut' });
   *   tl.to(nuit, { p: 1, duration: …, ease: 'power2.inOut' }, debut);
   *   BR.scene.piloter(tl, nuit);
   * ======================================================================== */

  class Passage {
    constructor(toile, o) {
      const a = options(toile, o);
      if (a.camera) throw new Error('scene.passage: pas de caméra d\'ouverture dans un passage (une seule plaque à la fois).');
      const vers = a.vers || {};
      const b = Object.assign({}, a, { effet: vers.effet || a.effet, nuit: vers.nuit === undefined ? a.nuit : !!vers.nuit });
      this.depart = new Vivante(null, a);
      this.arrivee = new Vivante(null, b);
      this.sens = a.sens || 'haut';
      this.grain = a.grain;
      this.p = 0;
      this.W = this.depart.W;
      this.H = this.depart.H;
      this.k = this.depart.k;
      this.toile = toile;
      toile.width = this.W;
      toile.height = this.H;
      toile.style.width = this.W * this.k + 'px';
      toile.style.height = this.H * this.k + 'px';
      toile.style.imageRendering = 'pixelated';
      this.g = toile.getContext('2d', { willReadFrequently: true });
      // Le seuil de chaque pixel ne dépend que de sa place : calculé une fois.
      this.seuils = new Float32Array(this.W * this.H);
      for (let y = 0; y < this.H; y++) {
        for (let x = 0; x < this.W; x++) this.seuils[y * this.W + x] = seuilTrame(x, y, this.H, this.sens, this.grain);
      }
    }

    allerA(t) {
      // Les deux scènes avancent TOUJOURS, même invisibles : sinon celle d'arrivée
      // aurait un autre passé (passants, nuages) selon l'instant de la bascule.
      this.depart.allerA(t);
      this.arrivee.allerA(t);
      const p = Math.min(1, Math.max(0, this.p));
      const g = this.g;
      if (p <= 0 || p >= 1) {
        g.clearRect(0, 0, this.W, this.H);
        g.drawImage((p >= 1 ? this.arrivee : this.depart).toile, 0, 0);
        return this;
      }
      const A = this.depart.g.getImageData(0, 0, this.W, this.H);
      const Bd = this.arrivee.g.getImageData(0, 0, this.W, this.H).data;
      const d = A.data;
      const s = this.seuils;
      for (let i = 0, j = 0; i < s.length; i++, j += 4) {
        if (s[i] < p) {
          d[j] = Bd[j];
          d[j + 1] = Bd[j + 1];
          d[j + 2] = Bd[j + 2];
          d[j + 3] = Bd[j + 3];
        }
      }
      g.putImageData(A, 0, 0);
      return this;
    }
  }

  /* ==========================================================================
   * L'API.
   * ======================================================================== */

  /** Pose une scène vivante sur une toile (data-* de la toile, ou `o`). */
  function poser(toile, o) {
    if (!toile) throw new Error('scene.poser: toile introuvable.');
    return new Vivante(toile, options(toile, o));
  }

  /** Pose un passage tramé (o.vers = { effet?, nuit? }, o.sens = 'haut' | 'bas'). */
  function passage(toile, o) {
    if (!toile) throw new Error('scene.passage: toile introuvable.');
    return new Passage(toile, o);
  }

  /**
   * Branche une scène (ou un passage) sur la timeline : à chaque image rendue,
   * `allerA(tl.time())`. Passe par `BR.ressorts.chaqueImage` (un seul onUpdate
   * par timeline). L'image 0 est dessinée tout de suite, à la construction.
   */
  function piloter(tl, vue) {
    if (!racine.BR || !racine.BR.ressorts) throw new Error('scene.piloter: charger lib/ressorts.js avant.');
    racine.BR.ressorts.chaqueImage(tl, function (t) {
      vue.allerA(t);
    });
    return vue;
  }

  /** Les phrases de l'app (src/shared/strings.js) : `phrase('wallpapers.toits.label')`. */
  function phrase(chemin) {
    const S = racine.BRUME_STRINGS;
    if (!S) throw new Error('scene.phrase: strings.js absent (moteur non chargé).');
    let v = S;
    const morceaux = String(chemin).split('.');
    for (let i = 0; i < morceaux.length; i++) v = v && v[morceaux[i]];
    if (typeof v !== 'string') throw new Error('scene.phrase: « ' + chemin + ' » n\'est pas une phrase de strings.js.');
    return v;
  }

  /** Une icône de l'app (src/renderer/ui/icons.js), en <svg class="icon">. */
  function icone(nom, cls) {
    return moteur().icon(nom, cls);
  }

  const api = {
    FPS_SIM: FPS_SIM,
    SCRIPTS: SCRIPTS,
    TEMPS_METEO: TEMPS_METEO,
    graine: graine,
    taille: taille,
    pas: pas,
    etatA: etatA,
    bayer: bayer,
    seuilTrame: seuilTrame,
    heureFixe: heureFixe,
    fige: fige,
    remplacer: remplacer,
    poser: poser,
    passage: passage,
    piloter: piloter,
    phrase: phrase,
    icone: icone,
  };
  racine.BR = racine.BR || {};
  racine.BR.scene = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
  else debutChargement();
})(typeof window !== 'undefined' ? window : globalThis);
