# AGENTS.md — créer un fond d'écran (scène pixel art) pour Brume

Ce fichier s'adresse aux agents de code (Claude Code, Codex, Cursor…) et aux humains qui
veulent **ajouter une scène** à Brume : un fond d'écran animé en pixel art, dessiné
entièrement par le code. Lis-le en entier avant d'écrire la première ligne.

> Pour démarrer vite, donne à ton agent une photo et cette phrase :
> *« Lis AGENTS.md, puis crée une scène Brume qui reproduit ce point de vue
> (photo jointe). Clé : `montagne`. Vérifie avec ext-check et des captures. »*

---

## 1. Ce qu'est une scène

- Un fichier `src/renderer/pixel/<nom>.js`, sans dépendance, chargé par une balise
  `<script>` (pas de bundler, pas d'import). Tout passe par l'objet global `window.Brume`.
- Une **petite toile** d'environ **240 pixels de haut** (largeur selon l'écran : ~384 à
  16:10, ~427 à 16:9), agrandie d'un facteur entier, pixels nets. Toutes les coordonnées sont
  en pixels logiques et **entières**.
- **Aucune image externe** : décor, personnages, animaux sont peints par le code. C'est une
  règle du projet (licence, poids, style).
- Un **décor peint une fois** (en 2 à 4 calques, du plus loin au plus proche), puis, à chaque
  image, on ne dessine **que ce qui bouge** (personnages, nuages, eau, lumières…). 30 images/s.
- La scène s'adapte aux **8 temps** de Brume : `none`, `snow`, `rain`, `storm`, `sakura`,
  `leaves`, `fireflies`, `starfall` (jour, nuit, saison). La météo qui *tombe* (flocons,
  gouttes…) est dessinée par une autre couche, au-dessus des fenêtres : la scène montre
  plutôt ses **conséquences** (neige sur les toits, sol mouillé et reflets, lac agité, ciel
  d'orage, arbres en fleurs, feuilles rousses, lucioles, étoiles filantes). Regarde
  `rooftops.js` pour l'équilibre.
- **Jour ou nuit** : avec la « Météo actuelle », Brume dit aussi à la scène s'il fait nuit
  chez l'utilisateur (`night`). Chaque temps a alors sa **version nuit** : il pleut, mais
  de nuit (ciel sombre, fenêtres et lampadaires allumés, reflets) ; il a neigé, mais la
  lune éclaire la neige… `fireflies` et `starfall` sont déjà des nuits.

## 2. Le contrat

```js
(function () {
  'use strict';
  const B = window.Brume;
  const { Raster, hex, mix, rng, hash, noise, fbm, bayer } = B.PX; // pixel.js
  const X = B.PXC; // common.js : applyLight, makeHalo, Flock, Puffs, Drift, Crowd, Traffic…

  // Une ambiance par temps : couleurs du ciel, lumière, ce qui vit.
  const LOOKS = {
    none: { /* … */ }, snow: { /* … */ }, rain: { /* … */ }, storm: { /* … */ },
    sakura: { /* … */ }, leaves: { /* … */ }, fireflies: { /* … */ }, starfall: { /* … */ },
  };
  // Version nuit d'un temps : ses conséquences (sol mouillé, neige posée, nuages…) avec le
  // ciel et la lumière d'une nuit. fireflies et starfall sont déjà des nuits.
  const nightLook = (effect) =>
    effect === 'fireflies' || effect === 'starfall' ? LOOKS[effect]
      : { ...LOOKS[effect], sky: LOOKS.starfall.sky, amb: LOOKS.starfall.amb, birds: false /* … */ };

  class Montagne {
    // W, H : taille logique. opts.ext = { left, right } : monde élargi (voir § 3).
    constructor(W, H, opts = {}) {
      this.W = W;
      this.H = H;
      const ext = opts.ext || {};
      this.extL = Math.max(0, Math.round(ext.left || 0));
      this.extR = Math.max(0, Math.round(ext.right || 0));
      this.t = 0;
      this.effect = null;
      this.night = false;
      this.build('none');
    }

    // Repeint les calques pour un temps donné (appelé quand le temps change).
    // night : version nuit de ce temps (météo en direct, la nuit).
    build(effect, night = false) {
      this.effect = effect;
      this.night = night;
      this.look = night ? nightLook(effect) : LOOKS[effect] || LOOKS.none;
      this.back = this.paintBack().toCanvas(); // ciel, montagnes
      this.mid = this.paintMid().toCanvas();   // plan moyen
      this.fore = this.paintFore().toCanvas(); // premier plan
    }

    update(dt, ctx) {
      const eff = (ctx && ctx.effect) || 'none';
      // night absent (caméra d'ouverture) : on garde l'état courant.
      const night = ctx && 'night' in ctx ? !!ctx.night : this.night;
      if (eff !== this.effect || night !== this.night) this.build(eff, night);
      this.t += dt;
      // faire avancer ce qui bouge…
    }

    draw(g) {
      g.imageSmoothingEnabled = false;
      g.drawImage(this.back, -this.extL, 0);
      // nuages, oiseaux…
      g.drawImage(this.mid, -this.extL, 0);
      // personnages, bateaux…
      g.drawImage(this.fore, -this.extL, 0);
    }
  }

  B.PixelScenes.montagne = Montagne;
})();
```

Facultatif : `introReturn(duration)` (préparer l'état de la scène pour l'animation
d'ouverture) et `magic(path)` (easter egg : geste de la souris, voir `drones.js`).

Outils utiles :
- `B.PX` (`pixel.js`) : `Raster` (tableau de pixels avec `set`, `rect`, `toCanvas`…),
  `sprite(rows, palette)` (petit dessin en texte), `hex`, `mix`, `rng(seed)` (hasard
  reproductible), `noise`, `fbm`, `bayer` (trame pour des dégradés « peints »).
- `B.PXC` (`common.js`) : `applyLight` (éclairage peint pixel par pixel), `makeHalo`
  (halos lumineux, à dessiner en mode `lighter`), `Flock` (vols d'oiseaux), `Puffs`
  (fumée, vapeur, buée), `Drift`, `Crowd`, `Traffic`, `text` (police 3×5).
- `B.People` (`people.js`) : personnages procéduraux détaillés (`walker`, `seated`,
  `stand`, accessoires : parapluie, livre, tasse, guitare…), avec des teintes au hasard.
- Modèles à copier : `rooftops.js` (le plus récent : couple, ciel, nuages, monde élargi),
  `sea.js` (eau, reflets), `forest.js` (arbres, lucioles), `drones.js` (easter egg).

## 3. Le monde élargi (animation d'ouverture) — la règle la plus importante

À l'ouverture du Mac, la caméra arrive en longeant un monde **plus large que l'écran** et
s'arrête pile sur le fond d'écran. Il ne doit y avoir **aucune différence** entre la dernière
image de l'animation et le fond d'écran.

- Avec `opts.ext = { left, right }`, chaque calque fait `extL + W + extR` de large et se
  dessine à `(-extL, 0)`. On peint en coordonnées de la scène : x va de `-extL` à `W + extR`.
- **Le centre `[0, W)` doit être identique au pixel près** avec ou sans `ext`.
  `tools/ext-check.js` le vérifie : `diffPixels` doit valoir **0** pour chaque calque.
- Le prolongement continue le paysage (la rue continue, le lac continue, la montagne
  continue) : invente du contenu crédible, pas une copie étirée.
- Pièges :
  - le prolongement ne doit **pas consommer le hasard** du centre : peins-le avec ton propre
    `rng(graine)`, jamais avec `Math.random()` avant ou pendant la peinture du centre ;
  - les trames (`bayer`) et le bruit se calculent en coordonnées de la scène, pas de la toile ;
  - ce qui bouge (nuages, oiseaux, bateaux) doit aussi circuler dans les parties élargies.
- La classe `Wide` de `rooftops.js` (toile élargie qui protège le centre) est réutilisable.

## 4. L'inscrire dans l'app (6 endroits)

| Fichier | Quoi |
|---|---|
| `src/renderer/wallpaper.html` | `<script src="pixel/montagne.js"></script>` (à côté des autres scènes) |
| `src/renderer/intro.html` | la même ligne |
| `src/shared/palettes.js` | une entrée dans `PALETTES` (couleurs de secours et vignette), la clé dans `ORDER`, et dans `AUTO_SCENES` pour les temps qui lui vont |
| `src/shared/strings.js` | `wallpapers.montagne = { label: 'Montagne', line: 'Une phrase courte.' }` — **toutes** les phrases de l'app vivent ici (c'est l'exercice du projet) |
| `src/renderer/intro-multiplane.js` | `SPECS.montagne` : les plaques de profondeur (`layers`, du plus loin au plus proche, `Z` décroissant), le côté d'arrivée `from: 'left' \| 'right'`, et la promenade `path` |
| `tools/ext-check.js` | `montagne: ['back', 'mid', 'fore']` dans `LAYERS` |

La fenêtre de réglages, le menu et les vignettes se construisent tout seuls depuis
`ORDER` : rien d'autre à toucher.

## 5. Vérifier (obligatoire)

VS Code définit `ELECTRON_RUN_AS_NODE` : toujours lancer Electron avec `env -u ELECTRON_RUN_AS_NODE`.

```bash
# 1. Le centre est identique au fond d'écran (diffPixels: 0 pour chaque calque),
#    et une image du monde élargi entier est écrite dans le dossier de sortie.
env -u ELECTRON_RUN_AS_NODE npx electron tools/ext-check.js montagne none /tmp/brume-ext

#    Version nuit d'un temps : suffixe « :nuit » (ex. rain:nuit).
env -u ELECTRON_RUN_AS_NODE npx electron tools/ext-check.js montagne rain:nuit /tmp/brume-ext

# 2. Captures du fond, pour chaque temps (regarde-les vraiment), de jour puis de nuit :
for fx in none rain snow storm sakura leaves fireflies starfall; do
  env -u ELECTRON_RUN_AS_NODE npx electron tools/snap.js wallpaper /tmp/montagne-$fx.png \
    "{\"wallpaper\":\"montagne\",\"effect\":\"$fx\"}" 1440 900 3000
  env -u ELECTRON_RUN_AS_NODE npx electron tools/snap.js wallpaper /tmp/montagne-$fx-nuit.png \
    "{\"wallpaper\":\"montagne\",\"effect\":\"$fx\",\"night\":true}" 1440 900 3000
done

# 3. L'animation d'ouverture, à plusieurs instants :
env -u ELECTRON_RUN_AS_NODE npx electron tools/snap.js intro /tmp/montagne-intro.png \
  '{"wallpaper":"montagne","effect":"none"}' 1440 900 500,2500,5000,9000

# 4. En vrai :
npm start
```

Critères avant de rendre le travail :
- `diffPixels: 0` partout, et les autres scènes toujours à 0 ;
- chaque temps est lisible et différent (jour/nuit, neige posée, pluie, orage, printemps,
  automne), et chacun a une vraie version nuit (`night: true`) ;
- la dernière image de l'ouverture est le fond d'écran ;
- `draw()` reste léger : pas de `getImageData` ni de repeinture des calques à chaque image ;
- pas d'erreur dans la console (`[page]` dans la sortie des outils).

## 6. Style

- Pixel art **détaillé** et lumineux, ambiance lofi : dégradés tramés, éclairage peint,
  silhouettes lisibles, un peu de vie partout (mais calme : c'est un fond d'écran).
- Des personnages grands et expressifs quand la scène en a ; des animaux de temps en temps.
- Couleurs cohérentes par temps : ciel, lumière ambiante (`amb`), désaturation par temps
  gris, lumières chaudes la nuit.
- Code et commentaires **en français**, comme le reste du projet. Phrases visibles :
  uniquement dans `strings.js`.
