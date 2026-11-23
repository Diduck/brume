# Atelier motion design — HyperFrames

Des vidéos de Brume en **HTML + CSS + une timeline GSAP**, rendues en MP4 par
[HyperFrames](https://github.com/heygen-com/hyperframes). Les **vraies scènes**
pixel art (le même code que le fond d'écran) passent par un **pont**,
`lib/scene.js`, qui les rend image par image de façon déterministe.

La doctrine (partition, syncope, anticipation, les 9 mesures d'une image) est
dans `.claude/skills/motion/SKILL.md` (commande `/motion` dans Claude Code).
Les pièges techniques sont dans `references/hyperframes-recipes.md` à côté,
l'identité visuelle et le pont dans `references/brume.md`.

Cet atelier est **hors de l'app** : il a son propre `package.json`, rien n'est
embarqué dans Brume.app, et il ne modifie jamais `src/`.

---

## Les commandes

```bash
bash motion/scripts/install.sh                # une fois : npm, GSAP local, copie du moteur

cd motion
npm test                                      # le filet, sans navigateur
npx hyperframes lint                          # le contrat HyperFrames
npx hyperframes snapshot --at 0,1.2,2.5,4.983 --no-end --describe false -o snapshots/index
                                              # IMAGES FIXES : la boucle de travail
bash scripts/determinisme.sh . 0,1.2,2.5,4.9  # même image en avançant, en reculant, dans une autre page
npm run render -- -o renders/exemple.mp4      # 60 fps, 2 workers
npm run brume                                 # après avoir modifié une scène dans src/
```

`snapshot` et `render` ouvrent un Chrome headless et le referment.
`npx hyperframes preview` est un serveur persistant : le fermer après usage.

## Une nouvelle vidéo

1. Écrire la **partition** (temps → poids → sujet) et la faire valider.
2. Copier `index.html` en `<nom>.html`, à la racine. Changer
   `data-composition-id` **et** la clé `window.__timelines[…]`.
3. Une scène : un `<canvas class="br-scene" data-scene="…" data-effect="…">`,
   le bloc de `<script src="assets/brume/…">` recopié tel quel, puis
   `BR.scene.poser()` (ou `passage()`) et `BR.scene.piloter(tl, vue)`.
4. Les phrases : `BR.scene.phrase('tagline')` — jamais écrites dans la
   composition (elles vivent dans `src/shared/strings.js`).
5. Relire des images fixes, corriger, vérifier le déterminisme, puis rendre.

`snapshot` ne vise que `index.html` d'un dossier : pour une autre composition,
la copier en `index.html` d'un projet bac à sable (voir les recettes, § 6).

## Ce qui est versionné

| Versionné | Ignoré (se regénère) |
|---|---|
| `*.html`, `theme.css`, `lib/`, `scripts/`, `tests/`, `package.json`, `package-lock.json`, `hyperframes.json` | `node_modules/`, `assets/vendor/` (GSAP), `assets/brume/` (copie de `../src`), `snapshots/`, `renders/`, `out/`, `.hyperframes/` |

## Comment c'est bâti

| Fichier | Rôle |
|---|---|
| `index.html` | La composition **modèle** « la nuit tombe » : partition en tête, grille, élan, passage tramé jour → nuit sous la neige |
| `theme.css` | Young Serif (`@font-face`, `display: block`), tokens `--br-*` de l'app, `.br-cadre`, `.br-scene`, coupe-circuit des transitions. À la racine **exprès** (url relatives après inlining) |
| `lib/scene.js` | **Le pont des scènes** : hasard semé, horloge simulée, re-simulation à pas fixes de 1/30 s à chaque seek, passage tramé, caméra d'ouverture |
| `lib/beatgrid.js` | La grille de beats, en secondes calées sur une image |
| `lib/ressorts.js` | Ressorts physiques (snap, settle, stretch, camera), élan, cibles multiples, double bord, rampe de caméra |
| `lib/texte.js` | Entrée mot par mot |
| `lib/couleurs.js` | Lire un token `--br-*`, la palette d'une scène, contraste WCAG |
| `scripts/install.sh` | npm, GSAP local, copie du moteur |
| `scripts/copie-brume.sh` | `../src` → `assets/brume/` (scènes, palettes, phrases, icônes, Young Serif + OFL) |
| `scripts/determinisme.sh` | Trois séries de snapshots (avant, avant, à rebours), comparées au pixel |
| `tests/lib.test.mjs` | Le filet : grille, ressorts, élan, fonctions pures du pont, ordre des scripts |
