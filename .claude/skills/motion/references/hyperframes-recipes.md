# Recettes HyperFrames — le contrat, les chemins, et les pièges

Source : doc officielle HyperFrames (`heygen-com/hyperframes`, v0.8.181) et
l'expérience d'un atelier frère, dont celui-ci reprend la doctrine et les
primitives.

> ✅ **Validé par un rendu réel** (`motion/index.html`, 5 s à 120 bpm, 60 fps,
> 300 images) : vraie scène « Sur les toits » chargée par le pont, passage
> tramé jour → nuit sous la neige, Young Serif chargée, lint à 0, mêmes pixels
> en avançant, en reculant et dans une autre page (`scripts/determinisme.sh`),
> image 150 du MP4 = image fixe à 2,5 s. Ce qui a été VU, et qui n'était pas
> dans la doc, est au § 9.

---

## 1. Le contrat — ce que HyperFrames exige

HyperFrames **saute** d'un instant à l'autre dans la page et capture chaque
image. L'image à 2,35 s doit être la même qu'on l'ait rendue seule ou après
toutes les autres.

| Exigence | Dans l'atelier |
|---|---|
| Une timeline GSAP `{ paused: true }`, **finie** | `gsap.timeline({ paused: true })` + `tl.to({}, { duration }, 0)` pour atteindre `data-duration` |
| Enregistrée **de façon synchrone**, à la fin de la construction | `window.__timelines[ID] = tl;` en dernière ligne du script |
| Clé = `data-composition-id` de la racine **exactement** | même constante `ID` pour les deux |
| Ni horloge, ni hasard, ni boucle infinie | pas de `Date.now`, `setTimeout`, `rAF`, `Math.random`, `repeat: -1`, `stagger: { from: 'random' }` dans la composition — le hasard et l'horloge des SCÈNES sont figés par `lib/scene.js` |
| Ne jamais jouer soi-même | jamais `tl.play()`, `video.play()`, `audio.play()` |
| Musique = `<audio>` séparé | `<audio id="…" data-start="0" data-duration="…" data-track-index="9" src="assets/…">` |

**Pourquoi des scripts classiques et pas des modules :** un `<script
type="module">` est différé. La timeline serait enregistrée après que
HyperFrames l'a cherchée. Les fichiers `lib/*.js` se chargent donc par `<script
src>` et posent `window.BR.*`.

⚠ **HyperFrames INLINE les scripts locaux** dans la page, et les exécute une
fois le document **complet** (`document.readyState === 'complete'`). Tout ce
qui suppose l'analyse du HTML en cours est mort : `document.write`,
`document.currentScript.src`, un `<script>` injecté qu'on attendrait. D'où le
bloc de `<script src="assets/brume/…">` écrit en dur dans chaque composition.

---

## 2. Les chemins — tout dans le dossier de l'atelier

- Une composition **pleine page** vit à la RACINE de `motion/` (`index.html`,
  `<nom>.html`). `assets/…`, `lib/…`, `theme.css` s'y écrivent en relatif et
  sont justes.
- `theme.css` est à la racine **exprès** : HyperFrames inline les feuilles
  locales dans la page, et une `url('../assets/…')` écrite depuis `lib/` serait
  relue depuis la page — hors du projet. Young Serif disparaîtrait sans erreur.
- Un fichier hors de `motion/` **n'existe pas** pour le rendu. D'où la COPIE
  du moteur (`scripts/copie-brume.sh` → `assets/brume/`, même arborescence que
  `src/`) et de GSAP (`assets/vendor/`), jamais un `../src/…`.
- Une **sous-composition** réutilisable (`compositions/<nom>.html`) s'enveloppe
  dans un `<template>` et se monte avec `data-composition-src` ; ses chemins se
  résolvent depuis la racine du projet, pas depuis son propre fichier.

---

## 3. Le pont des scènes — `lib/scene.js`

Le mode d'emploi (options, passage, caméra) est dans `references/brume.md`.
Ici, la mécanique et ses pièges :

| Problème | Réponse du pont |
|---|---|
| Les scènes tirent `Math.random()` partout | Pendant chaque construction, `update` et `draw` : `Math.random` = générateur à graine (mulberry32), rendu aussitôt après. Au chargement aussi : `scene.js` se charge AVANT le moteur et sème le hasard jusqu'au premier `poser()` |
| Certaines scènes lisent l'heure (`new Date()` : pendule de la chambre, train des drones) | `Date` et `performance.now` remplacés par une horloge simulée (`data-heure` + temps simulé), **seulement s'ils se laissent remplacer** (au rendu, HyperFrames les virtualise et les fige en lecture seule) |
| HyperFrames saute dans n'importe quel ordre ; une scène avance par `update(dt)` | Re-simulation à pas fixes de **1/30 s** (la cadence du fond d'écran). Seek vers l'avant : seulement les pas manquants. Seek vers l'arrière : reconstruction et rejeu depuis 0. Le préchauffage (2 s par défaut) est rejoué à l'identique |
| Une scène peut tenir de l'état dans `draw` | `draw` est appelé à **chaque pas**, dans les deux chemins : la suite des appels est identique |
| La météo qui TOMBE est une couche WebGL de l'app, absente ici | Le pont reprend celle de l'animation d'ouverture (`Multiplane.prototype.buildWeather` : `RainFx`, `Drift`), dessinée par-dessus la scène — même code, mêmes réglages |
| 60 fps vidéo, 30 fps scène | Deux images vidéo consécutives montrent le même pas de scène, exactement comme le fond d'écran. Les tweens GSAP (plaques, texte), eux, sont à 60 |

**Coût** : un seek à rebours vers la fin d'une vidéo de 5 s rejoue ~210 pas
(préchauffage compris) — une fraction de seconde. Un passage tramé fait
avancer DEUX scènes et un `getImageData` par image (384 × 216 : négligeable).

**Ordre d'exécution** : le contenu (phrases, icônes) posé dans le DOM AVANT de
construire la timeline ; `BR.scene.piloter` dessine l'image 0 dès son appel.

---

## 4. Les ressorts sans `spring()`

GSAP n'a pas de ressort physique (`elastic`, `back` sont des courbes
dessinées). `lib/ressorts.js` écrit la position exacte d'un oscillateur amorti
en forme close — même méthode que le `springEase` de la doc HyperFrames —
avec quatre présets nommés par intention (`snap`, `settle`, `stretch`,
`camera`).

- `ressort(nom)` → `{ duree, ease }` : la durée EST le temps de pose (±0,05 %),
  `ease(1) === 1` exactement.
- `ressortTo(tl, el, vars, t, nom, depuis)` : un tween porté par le ressort ;
  avec `depuis`, un `fromTo` (recommandé, voir § 9).
- `elan(tl, el, prop, { de, vers, temps, poids })` : anticipation (3 images,
  2-5 % selon le poids) + ressort, parti `avance` images avant le temps
  (héros 9, appui 5, repos 2 — jamais une avance constante). Que des `fromTo`.
- `valeurMulti(changes, t)` / `bords(arrets, t)` : fonctions **pures** du temps
  pour une valeur qui change plusieurs fois de cible ou l'étirement à deux
  bords, appliquées par `chaqueImage(tl, fn)` (un seul `onUpdate` par
  timeline, plusieurs rendus — le pont des scènes passe par lui aussi).
- `rampe(tl, el, vars, debut, fin)` : caméra et fondus, **Bézier** (le
  `--ease` de l'app, `cubic-bezier(0.16, 1, 0.3, 1)`), jamais ressort.
  `debut === fin` = caméra fixe.

⚠ `chaqueImage` reçoit `tl.time()`, le temps **local** : juste même quand
HyperFrames imbrique la timeline dans une timeline maîtresse. Ne jamais lire
une horloge globale. Vérifié : HyperFrames déclenche bien `onUpdate` à chaque
seek, en snapshot comme en rendu.

---

## 5. La boucle parfaite

Trois conditions, et la troisième est celle qu'on oublie :

1. la somme des deltas de chaque propriété vaut zéro ;
2. le curseur revient à son point de départ ;
3. **la vitesse revient à zéro** — d'où les deux temps de respiration finale.

Avec une scène : elle ne boucle PAS d'elle-même (passants, nuages avancent).
Une boucle parfaite exige soit une scène presque immobile sur la durée, soit un
raccord tenu par autre chose (plaque plein cadre, passage tramé aller-retour).
Le dire dans la partition.

HyperFrames parle en **secondes** : la dernière image rendue d'une vidéo de
`D` s à 60 fps est à `D − 1/60` (4,983 s pour 5 s). C'est elle qu'on compare
à l'image 0, côte à côte.

---

## 6. Les commandes — et ce qui reste à vérifier

```bash
cd motion
npm test                                    # filet, sans navigateur
npx hyperframes lint                        # contrat : timeline, clés, déterminisme
npx hyperframes validate                    # Chrome headless : erreurs JS, contrastes WCAG
npx hyperframes snapshot --at 0,0.7,2.5,4.983 --no-end --describe false -o snapshots/index
bash scripts/determinisme.sh . 0,1.2,2.5,4.9
npm run render -- -c <nom>.html -o renders/<nom>.mp4
```

⚠ **`validate`** est la seule commande qui montre une **erreur JS** de la
composition (« moteur de Brume incomplet », « clé inconnue »…). `lint` passe,
`snapshot` rend des images NOIRES sans rien dire. Une toile noire → `validate`
d'abord. (`validate` est annoncé déprécié au profit de `check` ; les deux
marchent en v0.8.181.)

⚠ **`snapshot` n'a PAS d'option `-c`** (v0.8.181) : il prend un DOSSIER de
projet et en lit l'`index.html` (`--composition` vise un `data-composition-id`
DANS cet index, pas un fichier). Sa sortie par défaut est
`.hyperframes/artifacts/snapshots/` : passer `-o snapshots/<nom>`. La méthode
pour une autre composition, sans toucher au modèle — un **projet bac à sable**
dans le scratchpad :

```bash
B=<scratchpad>/hf-etude
cp -R assets lib theme.css hyperframes.json meta.json "$B/"   # une fois
cp <nom>.html "$B/index.html"                                 # à chaque itération
npx hyperframes snapshot "$B" --at 0,2.5,4.983 --no-end --describe false -o "$B/snaps"
bash scripts/determinisme.sh "$B" 0,2.5,4.9
```

Une planche `contact-sheet.jpg` sort en prime : la lire d'abord, puis les PNG
des instants douteux. `--no-end` : sinon une image de fin s'ajoute aux `--at`.
`render`, lui, accepte `-c <nom>.html` depuis l'atelier.

⚠ `snapshot --describe` envoie les images à Gemini si `GEMINI_API_KEY` est
posée. Ce n'est pas notre boucle de relecture (c'est `Read` sur le PNG) :
toujours `--describe false`.

---

## 7. Pièges hérités, toujours valables

- **`will-change` sous une caméra** fige une couche à la résolution de départ :
  le zoom sort flou. Jamais sur une racine.
- **Épaisseur d'un trait sous un zoom** : diviser par l'échelle.
- **Un `transform` sur un `<span>` en ligne est ignoré** : `.br-mot` est en
  `inline-block` pour cette raison (`theme.css`).
- **Transitions CSS** : coupées par le coupe-circuit de `theme.css`. Ne pas
  importer `settings.css` ou `overlay.css` de l'app tels quels : ils en sont
  pleins (`.tile`, `.greet`…), on réintroduirait des animations sur l'horloge.
  Recopier les VALEURS (couleurs, arrondis, polices) dans la composition.

---

## 8. La RAM

`npm run render` fixe `--workers 2` : un Chrome par worker. Monter se fait à la
main, pour un rendu précis. `hyperframes preview` est un serveur persistant :
le fermer après usage. Après un rendu interrompu, vérifier qu'aucun Chrome
headless ne traîne.

---

## 9. Vu au rendu — ce que la doc ne disait pas

**Propres à cet atelier (installation, 2026-11) :**

- **`document.write` est mort** : HyperFrames inline les scripts et les exécute
  document complet. Le moteur se charge par un bloc de `<script src>` en dur,
  dans l'ordre de `BR.scene.SCRIPTS` (un test vérifie l'ordre d'`index.html`).
- **`performance.now` est en LECTURE SEULE au rendu** — et seulement au rendu :
  les snapshots passaient, le rendu échouait (« Cannot assign to read only
  property 'now' », timeline jamais enregistrée, rendu bloqué). Tout
  remplacement d'un objet global passe par `BR.scene.remplacer` (qui renonce
  poliment). Leçon : **un snapshot vert ne prouve pas le rendu.**
- **Largeur impaire + `scale` = image qui dépend du chemin.** Un élément centré
  sur un point (porte de largeur nulle) avec une largeur impaire a son bord à
  un demi-pixel ; pendant un `scale`, Chrome l'arrondit différemment selon les
  images rendues avant. Vu : la tuile « Neige » d'un pixel plus large à 2,5 s
  quand on y arrivait à rebours. Remède : **largeur et hauteur PAIRES, écrites
  en px**. `scripts/determinisme.sh` l'attrape.
- **`to` contre `fromTo`** : un `to` lit son départ quand GSAP l'initialise, et
  ce moment dépend de l'ordre des seeks. `elan` n'écrit plus que des `fromTo`,
  `ressortTo` accepte `depuis`. Préférer `fromTo` partout où le départ est
  connu.
- **Comparer le MP4 aux images fixes** : à cause de la compression, pas
  d'égalité au pixel, mais l'image N du MP4 doit être la PLUS PROCHE de
  l'image fixe à N/60 s parmi ses voisines (vu : écart moyen 0,80 à l'image 150
  contre 0,86 à 152 et 0,89 à 148). Un minimum ailleurs = décalage de temps.

```bash
ffmpeg -v error -i renders/x.mp4 -vf "select='eq(n\,150)'" -frames:v 1 -y /tmp/f150.png
ffmpeg -i /tmp/f150.png -i snapshots/x/frame-at-2.5s.png -filter_complex \
  "[0]format=rgb24[a];[1]format=rgb24[b];[a][b]blend=all_mode=difference,format=gray,signalstats,metadata=print" \
  -f null - 2>&1 | grep -o "YAVG=[0-9.]*"
```

- Le compilateur annonce des polices « Inter », « EB Garamond », « New York »
  récupérées ou embarquées (`[Compiler] Fetched …`) : il remplace les piles
  système par des faces déterministes. Normal. Young Serif, elle, vient de
  `theme.css` (« Fonts: 3 loaded »).

**Hérités de l'atelier frère, toujours vrais :**

- **`<audio>` SANS `id` = rendu MUET.** Le lint le signale en erreur
  (`media_missing_id`) ; rien d'autre ne le ferait.
- **Mesurer un texte = AU RENDU, jamais à la construction.** À la
  construction, la police n'est pas forcément chargée (`font-display: block`
  mesure avec la police de repli). Mieux : des tailles ÉCRITES en px (la boîte
  de la devise d'`index.html`).
- **CSS 3D OK** : `preserve-3d`, `perspective`, `backface-visibility` rendent
  juste en snapshot comme en rendu.
- **Sortie mot par mot = compter la cascade.** `stagger` de 2 images sur 5
  mots ajoute 8 images : la sortie doit partir à `T(n) − F(durée + 2 × (mots −
  1))`, sinon la phrase traîne sur le temps suivant.
- **Une plaque qui disparaît part AVEC ses mots** (check-list n° 17) : son
  fondu se cale sur la sortie des mots, pas sur le temps suivant.
- **Une `<video data-start>` est posée au pixel** : l'image à `data-start` est
  identique à l'image 0 du fichier. C'est LA façon d'intégrer une vidéo déjà
  faite (une capture d'écran réelle de Brume sur un bureau, une démo
  `tools/demo-video.js`) sans la redessiner.
- **Le rendu baisse le son tout seul** (vers −1 dBTP) et le traite. Pour garder
  la main : remuxer la vidéo avec le WAV (`-c:v copy -c:a aac -b:a 320k`).
- **Relais entre deux calques identiques** : la caméra doit ARRIVER à vitesse
  nulle (`power2.inOut`), sinon le dernier pas fait un saut. Mesurer les images
  N−1 et N, pas les regarder. (La caméra d'ouverture de Brume arrive déjà à
  vitesse nulle : `0.5 − 0.5 cos(πu)`.)
