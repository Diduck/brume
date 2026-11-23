# Référence Brume — ce qu'on a le droit de montrer, et comment

Sources de vérité, dans le dépôt : `AGENTS.md` (comment une scène est faite),
`src/shared/palettes.js` (couleurs des scènes), `src/shared/strings.js` (TOUTES
les phrases), `src/renderer/overlay.css` et `settings.css` (l'interface),
`src/renderer/ui/icons.js` (les icônes), `src/renderer/pixel/*.js` (les
scènes). L'atelier en lit une **copie** (`motion/assets/brume/`, `npm run
brume`) et ne les modifie jamais.

---

## 1. Le pixel art — la règle qui ne se discute pas

- Une scène est une **petite toile** d'environ **240 px de haut**, agrandie
  d'un **facteur ENTIER**, pixels **nets** (`image-rendering: pixelated`).
  Toutes ses coordonnées sont entières.
- Le pont calcule la taille **comme le fond d'écran** (`wallpaper-main.js`) :
  `k = max(2, round(hauteur / 240))`, `W = ceil(largeur / k)`,
  `H = ceil(hauteur / k)`.

| Cadre | k | Toile logique | Remarque |
|---|---|---|---|
| 1920 × 1080 | 5 | 384 × 216 | l'image exacte d'un écran 1080p |
| 1440 × 900 | 4 | 360 × 225 | un MacBook Air |
| 1080 × 1920 (vertical) | 8 | 135 × 240 | étroit : peu de décor visible, choisir la scène |
| 1080 × 1080 | 5 | 216 × 216 | (`round(4,5)` = 5) |

  `data-k="4"` force un facteur (toujours entier ; 4 à 1080p donne 480 × 270).
- **Interdits** : agrandir d'un facteur non entier, lisser, zoomer la toile en
  CSS (`scale(1.12)` sur une scène = pixels inégaux, la grille bave). Le seul
  mouvement de caméra « de maison » sur une scène est la **caméra
  d'ouverture** (§ 5), qui fait exactement ce que fait l'app.
- Le passage d'un état à un autre se fait par une **trame** (Bayer 4 × 4 +
  balayage), pas par un fondu enchaîné, qui mélangerait les couleurs et
  sortirait du pixel art (§ 4).

## 2. Les 10 scènes et leurs clés

Libellés et phrases : `strings.js`, `wallpapers.<clé>` (`BR.scene.phrase('wallpapers.toits.label')`).

| Clé (`data-scene`) | Libellé | Ce qui s'y filme bien | Caméra d'ouverture arrive par |
|---|---|---|---|
| `toits` | Sur les toits | un couple au bord du toit, grand ciel, neige qui se pose sur les tuiles — **la plus récente, la modèle** | la gauche |
| `annecy` | Lac d'Annecy | voiliers, parapentes, eau turquoise ; lumineuse de jour | la gauche |
| `planete` | Planète lointaine | une géante annelée, une exploratrice et son robot ; vue cinéma | **la droite** |
| `drones` | Drones | heure bleue, un drone inspecte un viaduc ; easter egg (`magic`) | **la droite** |
| `terrasse` | Terrasse | lampadaire, arbre doré, ville bleue (nuit) | la gauche |
| `cafe` | Café | une tasse derrière la vitre (scène « intérieure ») | la gauche |
| `foret` | Forêt | sapins, lac, lucioles | la gauche |
| `mer` | Bord de mer | phare, coucher de soleil | la gauche |
| `chambre` | Chambre | guirlande, bureau, ville qui dort ; une **pendule** (lit l'heure : `data-heure`) | la gauche |
| *Ville* : `crepuscule`, `nuit`, `pluie`, `sakura`, `automne` | Ville (5 ambiances) | une rue animée ; l'app choisit l'ambiance selon le temps (`VILLE` dans `palettes.js`) | la gauche |

Les clés de la Ville sont des scènes à part entière pour le pont : on pose
`data-scene="pluie"`, pas `ville`.

## 3. Les 8 temps et la nuit

`data-effect` : `none`, `snow`, `rain`, `storm`, `sakura`, `leaves`,
`fireflies`, `starfall`. Libellés et icônes : `strings.js` `effects.<temps>`
et `icons.js` (même clé).

- La scène montre les **conséquences** du temps (neige posée, sol mouillé et
  reflets, ciel d'orage, arbres en fleurs, feuilles rousses). Ce qui **tombe**
  (flocons, gouttes, pétales) est une autre couche dans l'app ; le pont la
  dessine par-dessus avec le code de l'ouverture (`RainFx`, `Drift`).
  `data-meteo="0"` pour ne garder que la scène.
- **Nuit** : `data-night="1"`. Chaque temps a sa version nuit (fenêtres et
  lampadaires allumés, lune sur la neige). `fireflies` et `starfall` sont déjà
  des nuits.
- Les beaux couples pour un passage : `none` → `snow` + nuit (toits : le ciel
  rose devient nuit d'hiver, la neige se pose) ; `none` → `rain` (le sol se
  mouille) ; jour → nuit d'un même temps (les fenêtres s'allument) ; `sakura`
  → `leaves` (une saison passe).

## 4. Le pont — `lib/scene.js`

### Le charger

```html
<canvas class="br-scene" data-scene="toits" data-effect="none"></canvas>
…
<script src="assets/vendor/gsap.min.js"></script>
<script src="lib/beatgrid.js"></script>
<script src="lib/ressorts.js"></script>   <!-- piloter() passe par chaqueImage -->
<script src="lib/scene.js"></script>      <!-- AVANT le moteur : il sème son hasard -->
<!-- puis le bloc de 18 <script src="assets/brume/…"> d'index.html, TEL QUEL
     (ordre = BR.scene.SCRIPTS, vérifié par npm test) -->
```

### Une scène vivante

```js
var vue = BR.scene.poser(toile);               // options lues sur les data-*
var vue = BR.scene.poser(toile, { nuit: true, graine: 3 });   // ou écrasées en JS
BR.scene.piloter(tl, vue);                     // chaque seek → vue.allerA(tl.time())
```

| `data-*` | Option JS | Défaut | Rôle |
|---|---|---|---|
| `data-scene` | `cle` | — (obligatoire) | la scène (§ 2) |
| `data-effect` | `effet` | `none` | le temps (§ 3) |
| `data-night` | `nuit` | `0` | version nuit |
| `data-graine` | `graine` | `7` | le hasard : passants, nuages… Changer la graine = une autre « prise » de la même scène |
| `data-heure` | `heure` | `18:30` | l'heure simulée (pendule de la chambre, train des drones) |
| `data-meteo` | `meteo` | `1` | dessiner ce qui tombe |
| `data-prechauffe` | `prechauffe` | `2` (s) | la scène a déjà vécu à t = 0 (des passants, de la fumée) : l'image 0 est une bonne vignette |
| `data-camera` | `camera` | — | `ouverture` : la caméra multiplane (§ 5) |
| `data-camera-duree` | `dureeCamera` | `4` (s) | durée du travelling |
| `data-k` | `k` | calculé | facteur d'agrandissement forcé (entier) |
| — | `etats` | — | changements SECS au fil du temps : `[{ t: 2, nuit: true }, { t: 3, effet: 'snow' }]` — la scène repeint son décor d'une image à l'autre, comme l'app |

La taille logique suit `data-width` / `data-height` de la racine de la
composition.

### Le passage tramé (le héros de maison)

```js
var nuit = BR.scene.passage(toile, { vers: { effet: 'snow', nuit: true }, sens: 'haut' });
tl.fromTo(nuit, { p: 0 }, { p: 1, duration: g.temps(7) - debut, ease: 'power1.inOut' }, debut);
BR.scene.piloter(tl, nuit);
```

Deux scènes identiques (même clé, même graine) avancent ensemble ; chaque
pixel bascule de la première à la seconde quand `p` dépasse son seuil (trame
de Bayer + balayage). `sens: 'haut'` : la nuit tombe du ciel ; `'bas'` : elle
monte du sol. `grain` (0 à 1, défaut 0,45) : la part de trame face au
balayage. C'est un fondu → **Bézier**, jamais un ressort.

### Les phrases et les icônes

```js
el.textContent = BR.scene.phrase('tagline');            // « La météo vit sur ton écran »
el.textContent = BR.scene.phrase('effects.snow.label'); // « Neige »
el.prepend(BR.scene.icone('snow'));                     // <svg class="icon">
```

Une phrase absente lève : c'est voulu (elle doit d'abord exister dans
`strings.js`, la seule source de texte de l'app — c'est l'exercice du projet).
Les phrases qui sont des fonctions (`panel.weather.live.status`…) ne passent
pas par `phrase()` : les appeler sur `window.BRUME_STRINGS`.

## 5. La caméra d'ouverture — « survol du monde élargi »

`data-camera="ouverture"` : exactement l'enregistrement de l'animation
d'ouverture (`intro.js`, `record`) — la scène peint un monde ~2,8 fois plus
large que l'écran, la caméra multiplane (`intro-multiplane.js`) le longe, les
plaques proches défilent plus vite que les lointaines, et elle se pose **pile**
sur le fond d'écran à `data-camera-duree`. Ensuite la scène continue de vivre,
caméra arrêtée.

Limites : la toile est alors à la taille ÉCRAN (`W × k`) ; la nuit est fixée
au départ (la caméra ne transmet que le temps, comme dans l'app) ; pas de
passage tramé pendant un survol ; `prechauffe: 0` recommandé (l'ouverture part
d'une scène neuve). Un survol plus long que la durée du plan = la caméra n'a
pas fini : régler `data-camera-duree` sur la partition.

## 6. L'interface — le panneau de Brume

L'app est **sombre**, une seule apparence. Tokens recopiés dans
`motion/theme.css` (préfixe `--br-`) :

| Token | Valeur | Rôle |
|---|---|---|
| `--br-card` | `#0d111a` | fond du panneau |
| `--br-panel` | `rgba(13,17,25,.94)` | plaque posée sur une scène (l'aplat du texte, C7) |
| `--br-ink` | `#f2f4f8` | texte |
| `--br-ink-soft` / `-faint` | `rgba(226,233,243,.76)` / `rgba(206,216,232,.62)` | texte secondaire / tertiaire |
| `--br-line` | `rgba(255,255,255,.085)` | filets, bordures |
| `--br-weather` | `#a9c6ee` | **bleu glacier = MÉTÉO** |
| `--br-scene` | `#f2c27e` | **ambre = FOND D'ÉCRAN (scène)** |
| `--br-tile-on` / `--br-ink-on` | `#eef2f8` / `#0d1119` | tuile allumée et son texte |

Deux teintes guident l'œil : ce qui parle de météo est bleu glacier, ce qui
parle de scène est ambre. Ne pas les inverser, ne pas en ajouter.

- **Polices** : Young Serif (titres, `--br-serif`, une seule graisse 400,
  licence OFL, copiée de `src/renderer/fonts/`) ; la pile système
  (`--br-sans`) pour le reste. Rien de commercial.
- **Proportions** (`settings.css`) : tuile arrondie 11 px, hauteur 42, icône 18,
  texte 500 12,5 px ; pastilles de section 34 px arrondies 10 ; titres de
  section Young Serif 19 px. En vidéo : **× 2,5** (tuile 26 / 44 / 32 px).
- **Icônes** (`icons.js`, `BR.scene.icone`) : grille 24, trait 1,6, bouts
  arrondis — une seule famille. Noms : les 8 temps, `aurora`, `shake`, `roll`,
  `stack`, `weather`, `scene`, `noscene`, `auto`, `chevron`, `play`,
  `sticker`, `plus`, `pin`, `trash`. Jamais d'emoji en vidéo (l'app les
  remplace par ces icônes).
- **La police pixel 3 × 5** (`B.PXC.text`, `common.js`) : celle des enseignes
  dans les scènes. Majuscules seulement, et pas de J, Q, W, X. Elle fait partie
  du DÉCOR : un texte qui doit être lu ne s'écrit pas avec elle (C1).
- Ton des phrases : tutoiement, doux, court (« La météo vit sur ton écran »).
  Pas de point final aux titres.

## 7. Les palettes des scènes

`src/shared/palettes.js`, `PALETTES.<clé>` : `skyTop`, `skyMid`, `horizon`,
`sunColor`, `cloud`, `far`, `mid`, `near`, `light` (lumières chaudes), `neon`.
Ce sont les couleurs de secours et des vignettes, fidèles à l'ambiance de
chaque scène : `BR.couleurs.palette('toits').light` pour accorder un accent
de la composition à la scène (une plaque, un filet), sans recopier un hex.

## 8. Ce que l'atelier ne sait pas montrer

| Besoin | Réponse |
|---|---|
| La neige qui se pose sur les **vraies fenêtres** du Mac, les boules de neige, le curseur | Ça vit dans la couche WebGL (`engine/`) et le système : capture d'écran réelle, intégrée en `<video data-start>` |
| Le fond lofi WebGL (scènes sans version pixel) | Non chargé par le pont |
| L'aurore boréale | Effet WebGL de l'overlay, pas une scène |
| Une scène qui ne sait pas encore son monde élargi | Pas de caméra d'ouverture pour elle : plan fixe |
| Une scène modifiée dans `src/` | `npm run brume`, sinon la vidéo montre l'ancienne |

## 9. Dépôt PUBLIC

Le dépôt Brume est public : aucune donnée personnelle (nom complet, adresse,
e-mail) dans une composition, un commentaire ou un rendu commité ; aucune
police, image ou musique sous licence commerciale dans `motion/` ; les rendus
MP4 ne sont pas versionnés.
