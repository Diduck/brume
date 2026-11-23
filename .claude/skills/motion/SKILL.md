---
name: motion
description: Produit des vidéos de motion design de Brume avec HyperFrames (HTML + CSS + timeline GSAP) dans ./motion/, en montrant les VRAIES scènes pixel art (pont lib/scene.js, déterministe) — doctrine esthétique, grille de beats, primitives à ressorts, passage tramé jour/nuit, caméra d'ouverture, boucle de correction par images fixes. Use when the user says "/motion", "motion design", "vidéo de Brume", "fais une vidéo", "teaser", "démo", "showreel", "anime la scène", "hyperframes", ou demande une animation ou une vidéo de l'app ou d'une scène.
---

# /motion — faire une vidéo de Brume qui ait l'air conçue

> **L'atelier est dans `./motion/`, VERSIONNÉ.** Une vidéo = un fichier HTML à
> sa racine (copie de `index.html`, la composition modèle « la nuit tombe »).
> Les scènes y sont les **vraies** : le code de `src/renderer/pixel/`, rendu
> image par image par le pont `lib/scene.js`. Rien n'est redessiné.

---

# PARTIE I — LA DOCTRINE

**Cette partie prime sur toute la partie technique.** Une vidéo techniquement
irréprochable et esthétiquement plate est un échec ; c'est même le résultat le
plus probable si on lit la partie II en premier.

## Le défaut à éviter, nommé

Un brief dit « un événement par temps ». Lu à la lettre, ça donne un
**métronome** : tout bouge à la même vitesse, tout pèse pareil, tout tombe juste
sur la grille — et c'est mort. Chaque élément pris isolément est correct, et
l'ensemble n'a aucune intention.

> **La grille de beats est un SQUELETTE, pas un métronome.**
> Elle dit *quand on a le droit de faire quelque chose*. Elle ne dit ni *quoi*,
> ni *à quelle intensité*, ni *pendant combien de temps*.

Les dix règles ci-dessous sont là pour empêcher exactement ça. Elles sont
chiffrées parce que « fais joli » n'est pas une instruction.

---

## 1. Hiérarchie des moments — écrire la partition AVANT le code

Tous les temps ne se valent pas. Sur 8 mesures :

- **UN moment héros.** Un seul. La plus grande amplitude, la plus longue
  anticipation, et souvent le seul mouvement de caméra du plan.
- **Quelques temps qui appuient.** Ils soutiennent, ils ne rivalisent pas.
- **Des temps qui respirent.**

**Une respiration n'est pas un temps mort.** La différence :

| | Ce qui se passe |
|---|---|
| **Temps mort** | Rien ne bouge, et rien n'était prévu. Absence d'intention. |
| **Respiration** | Le sujet est **tenu**, volontairement immobile, **pendant que quelque chose de secondaire continue à vivre** — la neige qui tombe, un nuage qui dérive, le couple sur le toit, un sous-titre qui se construit. |

Chez Brume, la respiration est **offerte** : une scène vit toute seule (passants,
fumée, oiseaux). Tenir le sujet pendant qu'elle vit, c'est le cas d'école.

**Livrable obligatoire avant la première ligne de code :** un tableau
temps → poids → sujet. En commentaire en tête du fichier `<nom>.html`. S'il
n'existe pas, le plan sera plat, et aucune correction ultérieure ne le
rattrapera.

## 2. Syncope — ne jamais tomber pile sur chaque temps

Un ressort lancé **sur** le temps arrive **après** le temps : on voit le
mouvement finir une demi-seconde plus tard et ça sonne mou.

> **L'anticipation part quelques frames AVANT le temps. La résolution tombe SUR
> le temps.**

En pratique : chaque transition démarre à `atBeat(n) - avance`, où l'avance
dépend du **poids** du moment — un héros s'arme plus longtemps qu'un appui.
Repères : **héros 8-10 frames, appui 4-6, repos 2-3** (à 60 fps).

⚠ **Une avance CONSTANTE rend la grille audible** : tout part au même décalage,
donc tout arrive au même décalage. C'est un métronome avec un temps de retard.
C'est ce décalage variable qui donne du groove.

## 3. Anticipation → action → repos

**Tout mouvement ample est précédé d'un contre-mouvement minuscule :**

- **2 à 4 frames**
- **2 à 5 % de l'amplitude**
- **sens inverse**

Avant de sauter, on plie les genoux. C'est ce qui sépare « ça se déplace » de
« ça s'élance ». Au-delà de 5 %, ce n'est plus une anticipation, c'est un
rebond — et le rebond exagéré est interdit.

Seuil : ne pas armer un geste de moins de ~24 px. 4 % de 24 px, c'est un
pixel : ça ne se lit pas comme une intention, ça se lit comme un tremblement.

## 4. Mouvement secondaire et décalage

Ce qui est attaché à un objet en mouvement **traîne**. Une plaque qui s'ouvre
emmène sa devise avec un temps de retard.

> **Les enfants d'une liste n'entrent JAMAIS ensemble : 3 à 6 frames de
> décalage.**

**Tout ce qui arrive en même temps se lit comme une seule masse et s'aplatit.**
Trois tuiles de météo qui apparaissent simultanément, c'est un bloc ;
échelonnées, c'est un panneau qui se construit.

Borner la cascade à ~8 rangs : au-delà, ce n'est plus une entrée, c'est un
chargement.

## 5. Le contraste est ce qui se lit comme « conçu »

Quatre axes, à jouer explicitement :

- **Vitesse** — entrée rapide / sortie lente. Et, à l'intérieur d'un même objet,
  deux propriétés à deux vitesses : la couleur plus vite que la géométrie,
  l'opacité plus vite que la montée.
- **Échelle** — un plan serré après deux plans larges.
- **Densité** — un écran chargé après un écran vide.
- **Direction** — ne pas enchaîner trois mouvements dans le même sens.

> **Un plan où tout va à la même allure est plat, même si chaque élément est
> irréprochable pris seul.**

## 6. Chaque frame doit être une bonne image fixe — **et ça se MESURE**

> **Si une frame arrêtée est moche, l'animation ne la sauvera pas — elle passera
> juste trop vite pour qu'on sache pourquoi c'est raté.**

⚠ **Cette section a longtemps été la seule de la doctrine sans un seul chiffre.**
Toutes les règles de temps ci-dessus sont chiffrées et opposables ; celle-ci
disait « point focal unique », « vide assumé », « alignement qui tient ». Trois
formules avec lesquelles un agent sans goût coche « oui » partout et livre une
vidéo bien rythmée et mal composée. **Une règle qui ne peut pas faire échouer une
frame ne sert à rien.** Les neuf règles ci-dessous se vérifient donc par une
MESURE sur le PNG, pas par une opinion.

Les valeurs sont données en **pourcentage du cadre** (donc valables à toute
définition), avec l'équivalent en pixels **à 1920 × 1080**, le format de maison.

### C1 — Texte : plancher de lisibilité

| Rôle du texte | Plancher | À 1080 |
|---|---|---|
| Texte que le spectateur DOIT lire (titre, cartouche, libellé) | **2,5 % de la hauteur** | **27 px** |
| Texte secondaire porteur de sens (sous-titre, valeur, légende) | **1,8 % de la hauteur** | **19 px** |
| En dessous de 1,8 % | **c'est de la TEXTURE d'interface** | — |

**La conséquence est dure et c'est le but :** un texte sous le plancher n'a pas
le droit de porter une information nécessaire à la compréhension. Le libellé
d'une tuile du panneau (12,5 px) agrandi × 1,3 fait 16 px ; l'enseigne d'une
scène, en police 3 × 5 agrandie × 5, fait 25 px de haut mais se lit comme un
décor — ils font joli, ils disent « app » ou « ville », ils ne disent rien que
le spectateur doive comprendre. Le sens passe alors par le cartouche ou le
libellé, agrandis pour la vidéo.

*Mesure :* ouvrir le PNG, comparer la hauteur de capitale du texte à la hauteur
du cadre.

### C2 — Échelle typographique bornée

- **Au plus 3 niveaux typographiques simultanés** dans le cadre. Quatre, c'est
  déjà une hiérarchie absente.
- Deux niveaux consécutifs **d'un même bloc** s'écartent d'au moins **1,25×**.
  En dessous, l'œil ne les distingue pas : ce sont deux tailles, pas deux rangs.
- Le **héros** a droit à un corps supérieur aux autres plans, d'un facteur
  **1,4× au moins**. Une typographie de même corps partout, c'est une partition
  sans héros.

### C3 — Marges de sécurité

**Rien de porteur de sens à moins de 5 % d'un bord** — 96 px en largeur, 54 px
en hauteur à 1080. Et **au moins 2 % (22 px) entre deux blocs distincts**, sinon
ils se lisent comme un seul.

Le plan arrière, le flou, les dégradés de profondeur ont le droit de toucher les
bords. Le texte, le sujet et les cadres de surlignage, non.

### C4 — Placement du sujet : centré OU sur un tiers, jamais entre les deux

Le centre du point focal est soit **au centre géométrique** dans les deux axes
(composition frontale, assumée), soit **sur une ligne de tiers** (±3 % de
tolérance). Un sujet à 58 % de la largeur n'est ni l'un ni l'autre : il a l'air
d'avoir glissé.

*Mesure :* les coordonnées du centre du point focal, en pourcentage du cadre.

### C5 — Occupation : le sujet et son plan porteur ≥ 40 % de l'aire

Les cotes du panneau de réglages (une fenêtre de 640 px) sont écrites pour un
écran de Mac, pas pour un cadre de 1920 × 1080. Posées telles quelles, elles
laissent le sujet flotter dans un immense vide.

**Le sujet et le plan qui le porte (scène de fond, plaque, cartouche) couvrent
ensemble au moins 40 % de l'aire du cadre.** Si ce n'est pas le cas : mettre
l'ENSEMBLE à l'échelle (le panneau × 2,5, ses arrondis et ses icônes avec lui) —
jamais fausser ses proportions, qui sont la raison d'être de l'atelier. Une
scène pixel, elle, s'agrandit d'un facteur **ENTIER** (voir `references/brume.md`).

### C6 — Vide : aucune région vide contiguë > 55 % de l'aire

Le vide DÉSIGNE ; il ne reste pas. Un fond uni qui occupe plus de la moitié du
cadre sans qu'aucun plan de profondeur ne l'habite est du vide **subi**. (Une
scène de Brume plein cadre n'en a jamais : c'est la meilleure toile de fond de
l'atelier.)

*Mesure :* à l'œil sur le PNG, la plus grande zone d'un seul aplat. Si elle
dépasse la moitié de l'image, il manque un plan.

### C7 — Contraste du texte

- Texte sous 48 px : **ratio ≥ 4,5:1** avec son fond.
- Texte de 48 px et plus : **ratio ≥ 3:1**.
- Un texte posé sur une scène ou sur une image porte **son propre aplat** (la
  plaque `--br-panel` du panneau) — jamais un dégradé (interdit sur le chrome),
  jamais « ça passe parce que le ciel est sombre ici ».

⚠ **À vérifier de JOUR et de NUIT.** Une scène de Brume change de ciel avec le
temps et l'heure : un texte blanc lisible sur la nuit d'hiver tombe à moins de
2:1 sur le ciel rose de `sakura` ou le bleu d'`annecy`. C'est pour ça que le
texte porte sa plaque. Mesurer avec `BR.couleurs.contraste(a, b)` ; choisir
l'encre avec `encreSur(fond)`, ne jamais peindre le couple à la main.

### C8 — Nombre maximal d'éléments simultanés : 5 blocs

Un « bloc » = un groupe qui se lit d'un seul coup d'œil (une plaque et tout son
contenu comptent pour un). **Au-delà de 5 blocs distincts dans le cadre, le
point focal n'existe plus** — l'œil arbitre, et il arbitre mal.

### C9 — Durée de plan plancher : 2 temps

Un plan de moins de **2 temps** (60 frames à 120 bpm / 60 fps, soit 1 s) ne se
lit pas : il se subit. Et les durées de plans doivent être **inégales** — des
plans de durée égale donnent un diaporama, quel que soit le soin mis à chacun.

---

### Les trois questions qui restent qualitatives

Elles ne remplacent pas les mesures, elles viennent après :

1. **Point focal unique.** Où va l'œil en premier ? S'il y a deux réponses, il
   n'y en a aucune.
2. Ce point focal est-il bien le **sujet de ce moment de la partition** ?
3. Y a-t-il un élément qui capte l'attention **sans la mériter** ?

## 7. Retenue — une idée par moment

Si deux choses bougent ensemble, **l'une est le sujet et l'autre
l'accompagnement**, et ça se décide **explicitement**, dans le code, en
commentaire.

> **Deux sujets simultanés = zéro sujet.**

L'accompagnement, concrètement : amplitude réduite, démarrage décalé de quelques
frames, jamais de coïncidence avec le pic du sujet.

## 8. Profondeur

Superposer par **l'échelle**, un **flou léger d'arrière-plan**, la
**parallaxe** (l'arrière-plan suit la caméra à 30-50 %) — plutôt que faire
glisser des éléments à plat.

Brume a déjà SA profondeur : la **caméra multiplane** de l'animation
d'ouverture (`intro-multiplane.js`), qui longe le monde élargi plaque par
plaque. Le pont l'expose (`data-camera="ouverture"`) : c'est le mouvement de
caméra de maison, à préférer à un zoom CSS sur la toile — qui casserait la
grille de pixels.

> **La caméra cadre l'intention : elle zoome sur ce qui compte, elle ne balaie
> pas au hasard.**

Un zoom qui se promène « pour faire vivre l'image » est du remplissage : le
regard cherche ce qu'on lui montre et ne trouve rien. Chaque mouvement de caméra
doit avoir une **cible nommable**.

**Un seul mouvement de caméra par plan**, en général, et il sert le héros.

## 9. La typo est un acteur

**Jamais un simple fondu.** Entrées **mot par mot** (défaut) ou lettre par
lettre, avec 3 à 6 frames de décalage, et alignement optique.

Lettre par lettre : réservé à **un mot court** (un chiffre, un label de deux
syllabes). Sur un titre de huit mots, ça devient une machine à écrire — 40
objets en cascade, plus aucune hiérarchie.

Le cartouche ne change pas de place d'un plan à l'autre : un titre qui saute
d'un coin à l'autre force l'œil à le chercher à chaque coupe, et pendant qu'il
cherche il ne regarde pas le produit.

La police de Brume : **Young Serif** (titres, une seule graisse — jamais de
gras) et la pile système (texte). Les phrases viennent de
`src/shared/strings.js`, par `BR.scene.phrase('…')` — jamais tapées dans la
composition.

## 10. Le ressort est un CHOIX, pas un réglage par défaut

| | Outil |
|---|---|
| Ce qui a une **masse** — plaques, tuiles, pastilles, indicateurs | **Ressort** |
| **Caméra**, **fondus**, **flous**, **passages tramés** | **Courbe de Bézier** |

Une caméra qui dépasse sa cible puis revient, c'est un caméraman qui trébuche.

> **Jamais le même préréglage partout.** Un préset par intention (`snap`,
> `settle`, `stretch`), et le nom dit l'intention, pas la physique.

**Et le corollaire qui fait tout :** l'étirement d'un indicateur vient de **deux
ressorts, jamais d'un**. Le bord qui mène la course est plus raide que celui qui
suit ; l'objet s'allonge en route puis se resserre à l'arrivée. Avec le même
ressort des deux côtés, il se translate en bloc — propre, et mort.

---

## LES INTERDITS

**D'esthétique :**

- Uniformité métronomique ; tout à la même vitesse
- Easing **linéaire**
- Entrées systématiques **depuis les bords du cadre**
- Le **fondu comme seule entrée**
- **Stagger identique partout**
- **Rebond exagéré**
- **Éclats de particules**, **halos** ajoutés par-dessus (la neige qui tombe,
  les lucioles, les halos de lampadaires sont ceux de la SCÈNE : ils sont le
  sujet, pas un ornement)
- **Dégradés sur le chrome d'interface**
- **Épaisseurs d'icônes dépareillées**
- **Temps mort** (≠ respiration, cf. §1)

**De technique :**

- Tout mouvement qui ne passe pas par **la timeline GSAP enregistrée** — pas de
  `setTimeout`/`setInterval`, pas de `requestAnimationFrame`, pas de
  `Date.now()`/`performance.now()`, pas de `Math.random()` non semé, pas de
  `transition`/`animation` CSS, pas de `repeat: -1`, pas de `tl.play()`
- Une timeline construite **de façon asynchrone** (après un `fetch`, un
  `setTimeout`) : HyperFrames enregistrerait une timeline vide
- Un **hex en dur** dans une composition — `var(--br-*)`, ou `BR.couleurs`
  pour une interpolation
- Une **phrase visible tapée dans la composition** — elle vit dans
  `src/shared/strings.js` (`BR.scene.phrase`)
- Une **scène agrandie d'un facteur non entier**, lissée (`image-rendering`
  autre que `pixelated`), ou zoomée en CSS — la grille de pixels bave
- **Redessiner une scène** en CSS, SVG ou image : on montre la VRAIE scène, par
  le pont (`lib/scene.js`) ; une capture d'écran de l'app se périme à la
  première retouche de la scène
- Un `Math.random()` ou un `new Date()` qui contourne `lib/scene.js`
- Un **`to` GSAP dont le départ dépend de l'état** quand on le connaît :
  `fromTo` (un `to` lit son départ selon l'ordre des seeks — vu en revue)
- Réimplémenter ce que l'atelier ou HyperFrames fournit : ressorts
  (`lib/ressorts.js`), grille (`lib/beatgrid.js`), entrée de texte
  (`lib/texte.js`), pont des scènes (`lib/scene.js`), pipeline « screenshots +
  ffmpeg » (c'est `hyperframes render`)
- Un `<script type="module">` pour une timeline (différé : enregistrement trop
  tardif) ou GSAP chargé depuis un CDN (le rendu dépendrait du réseau)

---

## LA BARRE DE VÉRIFICATION — relire une image fixe

On rend une image fixe, **on l'ouvre avec `Read`, et on la juge**. La question
n'est **pas** « est-ce correct ». La question est :

> ### **Un designer posterait-il cette frame ?**

### Check-list de relecture — les 9 mesures, puis les 4 jugements

**A. Les mesures de §6.** Chacune se coche avec un chiffre, pas avec un avis.
Une seule case non tenue = la frame ne passe pas.

| # | Mesure | Seuil (à 1080) |
|---|---|---|
| 1 | Plus petit texte porteur de sens | ≥ 19 px (≥ 27 px s'il doit être lu) |
| 2 | Niveaux typographiques simultanés | ≤ 3, écart ≥ 1,25× entre rangs |
| 3 | Distance du texte au bord le plus proche | ≥ 96 px (h) / 54 px (v) |
| 4 | Écart entre deux blocs distincts | ≥ 22 px |
| 5 | Centre du point focal | centré, ou sur un tiers ±3 % |
| 6 | Aire du sujet + son plan porteur | ≥ 40 % du cadre |
| 7 | Plus grande zone vide d'un seul aplat | ≤ 55 % du cadre |
| 8 | Contraste de chaque texte, **de jour et de nuit** | ≥ 4,5:1 (≥ 3:1 si ≥ 48 px) |
| 9 | Blocs distincts dans le cadre | ≤ 5 |

**B. Les jugements** (après les mesures, jamais à leur place)
10. Où va l'œil en premier ? **Une seule réponse possible ?**
11. Ce point focal est-il bien le sujet de ce moment de la partition ?
12. Le vide est-il **assumé** (il désigne) ou **subi** (il reste) ?
13. L'image a-t-elle une **profondeur** (échelle, flou, parallaxe) ou est-elle
    plate ?

**C. Le socle technique** (le minimum, pas la conclusion)
14. Le titre est-il en **Young Serif** et pas en police de repli (un serif
    système plus maigre, aux « e » ronds) ?
15. Les couleurs correspondent-elles aux tokens `--br-*` de l'app ?
16. La scène est-elle **nette** (pixels carrés, facteur entier) et **vivante dès
    l'image 0** (passants, fumée : le préchauffage) ? Une toile noire = moteur
    non copié (`npm run brume`) ou bloc de `<script src>` incomplet — l'erreur
    nomme le fichier manquant.
17. **Un bloc est-il peint AVANT son contenu ?** Un cartouche dont le fond
    apparaît huit frames avant son texte est un rectangle vide à l'écran.

### Les frames à rendre, au minimum

Pas « une frame ». **Ces six-là**, parce que ce sont celles où les défauts se
cachent :

1. **La frame 0** — c'est la vignette de la vidéo, et c'est celle qu'on ne rend
   jamais parce qu'« il ne s'y passe rien ».
2. **La dernière frame rendue (N−1)** — à comparer à la frame 0 si la boucle est
   demandée. Les mettre **côte à côte**, pas les regarder l'une après l'autre.
3. **La frame du moment héros.**
4. **Le MILIEU d'une transition** — là où les fondus se croisent, là où le
   contenu peut disparaître entièrement.
5. **Une respiration** — pour vérifier qu'elle est tenue et qu'elle ne clignote
   pas.
6. **La première frame de chaque plan** d'un montage — c'est là que vivent les
   voiles de coupe et les cartouches vides.

### La règle qui va avec

> **Si la réponse à une question de A→E est « non », on corrige la COMPOSITION
> AVANT de continuer la chronologie.**

Continuer à poser des temps sur une image ratée, c'est empiler du travail sur du
sable. Une frame ratée à laquelle on ajoute 400 frames reste une vidéo ratée,
et elle coûte alors dix fois plus cher à corriger.

**Vérifier une image fixe PAR TEMPS de la grille** avant tout rendu vidéo
complet. C'est là qu'on repère un élément hors grille, à l'étroit ou illisible —
et c'est 100× moins cher qu'un rendu complet.

---

# PARTIE I bis — L'ENTRÉE COURTE

La doctrine ci-dessus **empêche la platitude**. Elle ne la remplace pas par de
l'ambition — pour ça, il faut une entrée. Il en existe une, courte, repérée pour la
régularité de ses résultats. Sa forme canonique :

> *« make a dynamic 20s motion graphics video that shows what an incredible
> motion designer you are, like it's your showreel for this app `<NOM>`,
> highlighting `<feature A>`, `<feature B>` and other features you deem fit to
> be in video. Go all out. »*

Ce n'est pas une tournure heureuse : c'est une **porte d'entrée à part entière**
de cette skill, à égalité avec la doctrine. Elle se reproduit, elle ne se récite
pas — d'où le démontage clause par clause.

## Pourquoi ce patron marche

| La clause | Ce qu'elle fait |
|---|---|
| *« montre quel incroyable motion designer tu es »* | **Convoque une identité, pas une tâche.** Un brief décrit un travail à faire ; celui-ci installe un RÔLE — quelqu'un qui a du goût et qui en répond, pas un exécutant qui remplit un cahier des charges. |
| *« comme ton showreel »* | **Pose l'enjeu, donc la barre.** Une pièce de portfolio se juge autrement qu'un livrable qui doit juste fonctionner. Un showreel qui « marche » est un showreel raté. |
| *« 20 secondes »* | **Contrainte dure.** Sans durée, la vidéo dérive en catalogue de fonctionnalités — et un catalogue est plat par construction, puisque tout y pèse pareil. |
| *« et les autres features que tu juges pertinentes »* | **La clause décisive.** La curation est DÉLÉGUÉE : il faut donc avoir un avis sur ce qui mérite d'être montré. Un brief exhaustif interdit d'en avoir un, et c'est très souvent lui qui produit du plat. |
| *« go all out »* | **La permission.** Sans elle, le réflexe par défaut est la retenue prudente — et la retenue prudente, en motion design, s'appelle un métronome. |

## « Go all out » ne lève AUCUN interdit

C'est le contresens à ne pas faire, et il faut le dire explicitement sinon il se
fait tout seul.

> **« Go all out » = de l'ambition DANS LE MÉTIER. Pas de l'ornement en plus.**

Concrètement, aller à fond veut dire : **plus d'états** dans le morph, **plus de
précision** dans les timings, **plus d'audace** dans les cadrages et les
contrastes d'échelle, **une partition plus tenue** — un vrai héros, de vraies
respirations, une syncope qui varie. Ça ne veut **jamais** dire des particules,
des halos, des dégradés sur le chrome ou du rebond. Les showreels qui
impressionnent le font par la **maîtrise**, jamais par les effets.

**LES INTERDITS restent intégralement en vigueur sous « go all out ».** Les neuf
mesures de composition (§6) aussi. Une pièce de portfolio, c'est précisément une
pièce qui les tient toutes.

## Le protocole face à un brief de ce type

Le brief court **ne dispense de rien**. Le livrable obligatoire reste le même :

> ### **Le tableau temps → poids → sujet, présenté AVANT la première ligne de code.**

La seule différence, c'est **qui remplit les cases que le brief laisse ouvertes**
— et c'est l'agent. Il propose, puis il soumet :

1. **La sélection de fonctionnalités**, en disant **pourquoi celles-là et pas
   d'autres**. C'est là que se voit qu'on a un avis. « J'ai pris la nuit qui
   tombe sur les toits et l'ouverture caméra ; j'ai écarté les statistiques,
   qui sont un tableau de chiffres et se filment mal. »
2. **La durée en mesures**, pas en secondes. 20 s ≈ **40 temps à 120 bpm**, soit
   10 mesures.
3. **La partition complète** — le tableau, avec le héros désigné.
4. **Attendre la validation.** Ensuite seulement, écrire du code.

## Le patron, adapté à Brume

À copier tel quel :

> *« Fais une vidéo de motion graphics dynamique de 20 s qui montre quel
> incroyable motion designer tu es — comme si c'était ton showreel pour Brume.
> Mets en avant la météo qui change la scène (de jour, de nuit), l'animation
> d'ouverture, et les autres fonctionnalités que tu juges pertinentes. Vas-y à
> fond. »*

**Les fonctionnalités qui se filment le mieux**, et pourquoi :

| Fonctionnalité | Pourquoi elle se filme bien |
|---|---|
| **Le temps qui change la scène** | La cause (une tuile du panneau) et l'effet (la neige se pose, le sol se mouille) dans le même plan. `BR.scene.passage()` : le passage tramé, au pixel. |
| **Le jour qui devient nuit** | Un contraste de densité et de couleur énorme sur une image identique : les fenêtres s'allument, la lune éclaire la neige. Option `nuit` / `vers: { nuit: true }`. |
| **L'animation d'ouverture** | Un vrai mouvement de caméra, avec parallaxe, qui finit PILE sur le fond d'écran : un héros tout fait. `data-camera="ouverture"`. |
| **Les 10 scènes** | Un contraste d'échelle : une mosaïque, puis un plan serré sur une seule. Chaque scène a sa clé (`references/brume.md`). |
| **Le panneau de réglages** | Des tuiles qui s'allument, une respiration où le sujet est tenu et l'accompagnement parle. À rebâtir en HTML aux tokens de l'app (`settings.css`), agrandi × 2,5. |
| **Les vraies fenêtres du Mac** | ⚠ **À éviter dans l'atelier.** La neige qui se pose sur tes fenêtres, les boules qu'on roule : ça vit dans la couche WebGL et dans le système, rien de tout ça n'existe dans HyperFrames. Le montrer exige une capture d'écran réelle, montée à part. |

**Variante abstraite**, pour une pièce sans interface :

> *« Fais une vidéo de motion graphics dynamique de 20 s : UNE scène, les 8
> temps, jamais de coupe, boucle parfaite. Montre quel incroyable motion designer
> tu es. Vas-y à fond. »*

## ⚠ La réciproque — et c'est la vraie leçon

Quand l'utilisateur arrive avec un brief court de ce type :

> ### **Ne pas le regonfler en cahier des charges.**

L'ouverture **est la source de la qualité**, ce n'est pas un manque à combler. Un
agent qui répond par vingt questions de cadrage détruit exactement ce qui faisait
la valeur du brief : l'obligation d'avoir un avis. Il rend la décision à
l'utilisateur alors qu'on venait de la lui confier.

**On comble en PROPOSANT, pas en demandant.** Une proposition se corrige en une
phrase ; vingt questions coûtent un quart d'heure et ramènent au brief
exhaustif — celui qui produit du plat.

---

# PARTIE II — LE PROTOCOLE

## Étape 0 — Demander les entrées (avant tout code)

1. **Quel message ?** Une phrase. Pas trois.
2. **Quelles scènes, quels temps ?** Une clé (`toits`, `annecy`, `planete`…),
   un temps parmi les 8, jour ou nuit, ou un passage de l'un à l'autre. Voir
   `references/brume.md`.
3. **Quelle durée ?** En **temps**, pas en secondes. 16 temps à 120 bpm = 8 s.
4. **Quel format ?** 1920 × 1080 par défaut (la scène y est en 384 × 216 × 5,
   l'image exacte d'un écran 1080p). Un format carré ou vertical change la
   taille logique : la recalculer (`BR.scene.taille`).
5. **Boucle parfaite** attendue ou non ?

Face à un brief court (Partie I bis) : on ne pose PAS ces questions, on
PROPOSE les réponses dans la partition.

## Étape 1 — PRÉSENTER LA PARTITION, et attendre

**Avant d'écrire une ligne de code**, présenter le tableau :

| Temps | Poids | Sujet | Accompagnement |
|---|---|---|---|
| 0 | respiration | « Brume » tenu dans sa plaque (la vignette) | la scène vit |
| 1 | appui | la plaque s'ouvre, la devise entre mot par mot | — |
| 3 | appui | la tuile « Neige » se pose | — |
| 5 | **★ HÉROS ★** | la tuile s'allume → la nuit tombe, la neige se pose | — |
| 7-9 | respiration | la nuit **tenue** | la neige tombe, le couple vit |

(C'est la partition de `motion/index.html`.) Un tableau où tous les poids sont
identiques doit être **refait**, pas codé.

## Étape 2 — Écrire la partition en code

Copier `motion/index.html` en `motion/<nom>.html` (à la RACINE de l'atelier :
les chemins `assets/…`, `lib/…`, `theme.css` y sont justes). Changer
`data-composition-id` **et** la clé de `window.__timelines[…]` — elles doivent
être identiques, sinon HyperFrames ne trouve pas la timeline.

La partition va **en commentaire en tête du fichier** (le tableau), puis en
code avec la grille : chaque position s'écrit `g.temps(n)`, chaque décalage
`g.f(frames)` — jamais une seconde écrite à la main. Les valeurs qui changent
plusieurs fois de cible (curseur, indicateur) sont des **fonctions pures du
temps** (`BR.ressorts.valeurMulti`, `bords`) appliquées par
`BR.ressorts.chaqueImage(tl, fn)` : testables sans navigateur.

## Étape 3 — Donner un corps à la partition

- **Les scènes** — le pont (détail : `references/brume.md`) :
  ```html
  <canvas class="br-scene" data-scene="toits" data-effect="none"></canvas>
  …
  <script src="lib/scene.js"></script>            <!-- AVANT le moteur -->
  <script src="assets/brume/shared/strings.js"></script>   <!-- … le bloc d'index.html, tel quel -->
  ```
  ```js
  var vue = BR.scene.poser(toile);                // une scène vivante (data-*)
  var nuit = BR.scene.passage(toile, { vers: { effet: 'snow', nuit: true } });
  tl.fromTo(nuit, { p: 0 }, { p: 1, duration: …, ease: 'power1.inOut' }, t);
  BR.scene.piloter(tl, nuit);                     // chaque seek → la bonne image
  ```
- **Les phrases** : `BR.scene.phrase('tagline')`, `phrase('effects.snow.label')`
  — posées dans le DOM AVANT la timeline (le découpage mot par mot en dépend).
- **Les icônes** : `BR.scene.icone('snow')` (celles du panneau, trait 1,6).
- **L'interface** (plaque, tuile) : du HTML aux tokens `--br-*` de `theme.css`,
  proportions de `src/renderer/settings.css` agrandies (× 2,5 en général).
- **Le mouvement** : `BR.ressorts.elan()` (anticipation + ressort, avance selon
  le poids), `ressortTo(…, depuis)`, `rampe()` pour la caméra,
  `BR.texte.entreeMots()` pour la typo.
- La timeline `{ paused: true }`, complétée jusqu'à `data-duration`
  (`tl.to({}, { duration }, 0)`), enregistrée **à la fin du script, de façon
  synchrone**. Des **`fromTo`**, pas des `to`, dès que le départ est connu.

## Étape 4 — La boucle de correction (le cœur)

```bash
cd motion
npx hyperframes lint                          # le contrat HyperFrames d'abord
npx hyperframes snapshot --at 0,0.7,2,3,4.983 --no-end --describe false -o snapshots/index
```

→ **Ouvrir chaque PNG avec `Read`. Le décrire. Le juger sur les 9 mesures.**
(La planche `contact-sheet.jpg` d'abord, puis les PNG des instants douteux.)
→ Corriger la composition. Re-rendre. Recommencer.

Rendre **les six instants de la liste** (0, N−1 image, héros, milieu de
transition, respiration, début de chaque plan) — pas un seul. ⚠ HyperFrames
parle en **secondes** : l'image N−1 d'une vidéo de 5 s à 60 fps est à
`4.983`, pas à `5` (qui n'est jamais rendue).

Puis le **déterminisme** — la même image quel que soit le chemin pour y
arriver (en avançant, dans une autre page, à rebours) :

```bash
bash scripts/determinisme.sh . 0,1.2,2.5,4.9   # ✗ = code de sortie 1
```

Ce qu'il a déjà attrapé : un élément centré de largeur IMPAIRE qui s'anime en
`scale` (bord à un demi-pixel : Chrome l'arrondit selon l'historique des
images) → largeur et hauteur PAIRES, écrites.

**Une composition n'est JAMAIS « faite » sur la foi du code seul.** Sans rendu,
l'état s'appelle « partition écrite — corps non relu », et il n'est pas
livrable : voir la section dédiée plus bas.

## Étape 5 — Le filet

```bash
cd motion && npm test
```

Il couvre ce qu'une image fixe ne montre pas : la dérive de la grille, les
ressorts qui dépassent ou rampent, l'étirement du double bord, `ease(1) === 1`,
l'élan en `fromTo`, la taille logique de la scène (facteur entier), le pas de
simulation, l'ordre des scripts du moteur, et qu'aucune scène de l'app ne
manque au pont. Une primitive nouvelle dans `lib/` = un test qui peut rougir.

## Étape 6 — Le rendu

```bash
cd motion && npm run render -- -c <nom>.html -o renders/<nom>.mp4
ffprobe -v error -show_entries format=duration -of default=nw=1 renders/<nom>.mp4
```

`npm run render` impose **60 fps** (le tempo de maison) et **2 workers** (un
Chrome par worker). Seulement quand les images fixes sont bonnes. Vérifier la
durée, et comparer une image du MP4 à la même image fixe (recettes, § 9).

---

# ⚠ LES PROCESS — lancer, puis FERMER

L'agent **lance lui-même** ce dont il a besoin pour voir son travail — sans
image, rien n'est fait (section suivante) :
`scripts/install.sh` · `npm test` · `hyperframes lint|snapshot|render` ·
`scripts/determinisme.sh`. Ce sont des process **courts** : ils ouvrent leur
Chrome headless et le referment.

Ce qui reste interdit, c'est de **laisser vivre** quelque chose :

- **`npx hyperframes preview` est un serveur PERSISTANT.** L'agent peut le
  proposer ; s'il le lance, il le ferme dans la même session.
- Après un rendu interrompu (Ctrl-C, délai dépassé), **vérifier qu'aucun Chrome
  ne traîne** : `ps aux | grep -i "chrome-headless\|hyperframes" | grep -v grep`.
- Electron n'est pas nécessaire à l'atelier. Si on lance l'app pour comparer
  (`tools/snap.js`), toujours `env -u ELECTRON_RUN_AS_NODE`, et rien ne doit
  survivre à la commande.
- Pas de rendu à plus de 2 workers sans raison : un Chrome par worker.

## ⛔ SANS RENDU, CE N'EST PAS « FAIT »

> « Une composition n'est JAMAIS faite sur la foi du code seul. »

**L'état où les fichiers sont écrits et aucune frame n'a été rendue a un nom, et
ce n'est pas « terminé » :**

> ### **« Partition écrite — corps non relu. » Explicitement NON LIVRABLE.**

Si, pour une raison réelle (pas de Node ≥ 22, pas de ffmpeg, refus de
l'utilisateur), aucune image ne peut être rendue, l'agent :

1. **Le dit à l'utilisateur en ces termes.** Pas « la vidéo est prête », pas
   « il ne reste qu'à lancer le rendu » : « la partition est écrite, le corps
   n'a pas été relu, je n'ai vu aucune image ».
2. **Nomme ce qui n'est donc pas vérifié** : la composition, les contrastes, la
   police, la netteté de la scène, le déterminisme, le raccord de boucle —
   c'est-à-dire tout ce que la check-list couvre.
3. **Donne les commandes exactes** et les frames à rendre (les six de la liste).

Un lot livré sans image est un lot dont **personne** — ni l'agent, ni le
relecteur, ni l'utilisateur — ne sait à quoi il ressemble.

## ⚠ LA LEÇON DE REVUE — un mécanisme juste, et aucun effet visible

Le premier lot de l'atelier dont celui-ci descend a été livré avec **21 tâches
cochées, 3 608 lignes écrites, et zéro frame rendue**. Trois effets proprement
esthétiques s'y sont révélés morts, et ils partagent une signature :

| L'effet annoncé | Le mécanisme | Ce qu'on voyait |
|---|---|---|
| Profondeur par plan arrière flouté | Correct, parallaxe comprise | 2,7 unités d'écart sur 255 — **rien** |
| Contraste de vitesse sur la couleur | Correct, interpolation comprise | `#ffffff` → `#eff3f7` — **deux blancs** |
| Anticipation amplifiée du héros | Correct, multiplicateur ×1,6 compris | Indexé sur l'acte précédent — **appliqué à aucune frame** |

> ### **Un mécanisme juste, un commentaire qui l'annonce, et aucun effet visible.**

Le rendu a ensuite ajouté des défauts que **ni la relecture, ni les tests**
n'avaient pu voir : une configuration entièrement **morte** (jamais appliquée
une seule fois), des `@font-face` qui **empêchaient toute construction**, une
**frame 0 sans son libellé** alors que la dernière l'avait, un **moment héros
entièrement blanc**, son contenu ne démarrant qu'au temps.

Et l'installation de CET atelier en a ajouté trois, tous invisibles sans rendu :

- un chargement du moteur par `document.write` : correct dans un navigateur,
  **mort** dans HyperFrames (qui inline les scripts et les exécute une fois le
  document complet) — toile noire, aucune erreur visible sans `validate` ;
- `performance.now` **en lecture seule** au rendu (et seulement au rendu : les
  snapshots passaient) — la timeline ne s'enregistrait jamais ;
- une tuile d'un pixel plus large quand l'image était atteinte **à rebours**.

**La règle qui en découle, et c'est la plus importante de cette skill :**

> **Un commentaire qui décrit un effet n'est pas une preuve que l'effet existe.
> Un test vert n'en est pas une. Un snapshot réussi n'en est pas une pour le
> rendu. Seule l'image — du snapshot ET du MP4 — en est une.**

Et son corollaire, pour les tests : **un test qui ne peut pas échouer ne teste
rien.** Avant d'écrire une assertion, se demander ce qu'il faudrait casser pour
la faire rougir. Si la réponse est « rien », elle n'a pas sa place.

---

# L'atelier

Les sources sont **versionnées** (`motion/`). Ce qui ne l'est pas — dépendances,
GSAP local, copie du moteur (`assets/brume/`), images fixes, rendus — se
regénère d'une commande :

```bash
bash motion/scripts/install.sh    # npm install (une fois), GSAP, copie de ../src
cd motion && npm run brume        # recopier le moteur après avoir touché une scène
```

⚠ `assets/brume/` est une **copie** : après une modification d'une scène dans
`src/`, la vidéo montre l'ANCIENNE version tant qu'on n'a pas relancé
`npm run brume`. L'atelier ne modifie jamais `src/` ni `tools/` : si une scène
résiste au pilotage, on contourne dans `lib/scene.js`.

Toute vidéo qui compte est **commitée** (son `<nom>.html`). Les rendus MP4, eux,
ne vont pas dans le dépôt (public) : ils se regénèrent.

Carte de l'atelier : `motion/README.md`.

---

# Références

- **`references/brume.md`** — l'identité visuelle (pixel art à facteur entier,
  palettes, Young Serif, tokens du panneau, icônes), les 10 scènes et leurs
  clés, les 8 temps et leur version nuit, et **le pont des scènes** (options,
  passage tramé, caméra d'ouverture, limites). *À lire avant de choisir une
  scène, une couleur ou un texte.*
- **`references/hyperframes-recipes.md`** — le contrat HyperFrames, les
  chemins, les ressorts sans `spring()`, la boucle parfaite, les commandes, les
  pièges déjà vus. *À lire avant d'écrire une composition et avant de déboguer.*
- **`AGENTS.md`** (racine du dépôt) — comment une scène est construite (décor
  peint une fois, `update`/`draw`, monde élargi). *À lire avant de piloter une
  scène de façon inhabituelle.*
