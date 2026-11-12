/*
 * Brume — toutes les phrases de l'application.
 *
 * Ce fichier est la seule source de texte : la barre des menus, la carte
 * d'accueil, les notifications et les statistiques lisent tout ici.
 * Pour changer une phrase (même en la rallongeant), il suffit de l'éditer.
 *
 * Il est chargé à la fois par le processus principal (require) et par la
 * page de rendu (balise <script>), d'où l'enveloppe ci-dessous.
 */
(function (root) {
  'use strict';

  const STRINGS = {
    appName: 'Brume',
    tagline: 'La météo vit sur ton écran',

    welcome: {
      label: 'Bienvenue sur Brume',
      title: 'Ton écran a maintenant sa propre météo.',
      body: 'Elle tombe sur ton fond d’écran, se pose sur tes vraies fenêtres et réagit quand tu les bouges.',
      gestures: [
        'Secoue une fenêtre : sa neige s’envole et retombe sur ses voisines.',
        'Glisse doucement le curseur dans la neige pour rouler une boule.',
        'Attrape les boules et empile-les : deux font un bonhomme de neige.',
      ],
      hint: 'Tout se règle aussi depuis le flocon, dans la barre des menus.',
      start: 'C’est parti',
    },

    // Fonds d'écran animés : des LIEUX (des scènes), à ne pas confondre avec la météo.
    wallpapers: {
      off: { label: 'Aucune scène', line: 'Ton fond d’écran habituel, tel quel.' },
      auto: { label: 'Auto', line: 'Brume choisit la scène selon la météo et en change au fil de la journée : toutes les scènes y passent.' },
      ville: { label: 'Ville', line: 'Une rue animée dont l’ambiance suit la météo : neige, pluie, cerisiers, automne…' },
      // Les ambiances de la Ville, choisies toutes seules selon la météo.
      nuit: { label: 'Ville, nuit d’hiver', line: 'Une ville qui s’endort sous la lune.' },
      crepuscule: { label: 'Ville au crépuscule', line: 'Le soleil se couche sur les toits.' },
      pluie: { label: 'Ville sous la pluie', line: 'Néons et nuages bas.' },
      sakura: { label: 'Ville aux cerisiers en fleurs', line: 'Une ville à l’aube, toute rose et douce.' },
      automne: { label: 'Ville en automne', line: 'Un soir couleur d’ambre.' },
      cafe: { label: 'Café', line: 'Une tasse qui fume derrière la vitre.' },
      foret: { label: 'Forêt', line: 'Des sapins, un lac et des lucioles.' },
      mer: { label: 'Bord de mer', line: 'Le phare tourne, le soleil se couche.' },
      chambre: { label: 'Chambre', line: 'Une guirlande, un bureau, la ville dort.' },
      drones: { label: 'Drones', line: 'À l’heure bleue, un drone inspecte un viaduc dans la brume.' },
      toits: { label: 'Sur les toits', line: 'Deux amoureux au bord du toit, sous un ciel rose.' },
      annecy: { label: 'Lac d’Annecy', line: 'Des voiliers sur l’eau turquoise, des parapentes au-dessus des montagnes.' },
      terrasse: { label: 'Terrasse', line: 'Un lampadaire, un arbre doré, la ville bleue.' },
    },

    effects: {
      none: { label: 'Aucun effet', emoji: '○', line: 'Ciel dégagé. Ce qui est posé va fondre doucement.' },
      snow: { label: 'Neige', emoji: '❄️', line: 'Elle tient sur tes fenêtres. Roule-la en boules avec le curseur.' },
      rain: { label: 'Pluie', emoji: '🌧️', line: 'Elle éclabousse le haut de tes fenêtres. Toi, tu restes au sec.' },
      storm: { label: 'Orage', emoji: '⛈️', line: 'Pluie battante et éclairs au loin.' },
      sakura: { label: 'Sakura', emoji: '🌸', line: 'Des pétales de cerisier se posent et font la sieste.' },
      leaves: { label: 'Feuilles d’automne', emoji: '🍂', line: 'Elles s’entassent. Tu as le droit de shooter dedans.' },
      fireflies: { label: 'Lucioles', emoji: '✨', line: 'Laisse ton curseur immobile : elles viendront le voir.' },
      starfall: { label: 'Étoiles filantes', emoji: '🌠', line: 'Elles éclatent en étincelles sur tes fenêtres. Fais un vœu.' },
    },

    aurora: { label: 'Aurore boréale', emoji: '🌌', line: 'Des voiles de lumière dansent derrière tes fenêtres.' },

    // La fenêtre de Brume : accueil et réglages, en deux parties bien séparées.
    // L'essentiel est visible tout de suite ; « Voir plus » déplie le reste.
    panel: {
      title: 'Ta météo, ton décor.',
      done: 'Terminé',
      more: 'Voir plus de réglages',
      less: 'Moins de réglages',
      weather: {
        title: 'Météo',
        line: 'Ce qui tombe sur ton écran et se pose sur tes vraies fenêtres.',
        windShort: { '-2': '⇇', '-1': '←', '0': 'Calme', '1': '→', '2': '⇉' },
        optionLines: {
          behind: 'Elle ne passe jamais devant tes applications.',
          accumulate: 'Neige, pétales et feuilles se posent sur le haut des fenêtres.',
          snowballs: 'Avec la neige : roule, attrape et empile des boules.',
          aurora: 'Des voiles de lumière dansent dans le ciel de ton écran.',
          realWeather: 'Le vrai temps de ta ville, mis à jour toutes les 20 minutes.',
        },
        tryIt: 'À essayer',
        live: {
          label: 'Météo actuelle',
          off: 'Le vrai temps qu’il fait chez toi, en ce moment : Brume choisit l’effet toute seule.',
          loading: 'Je regarde le ciel…',
          error: 'Météo indisponible pour l’instant (pas d’Internet ?).',
          // ex. « Annecy · 14 °C · Nuageux — vu à 18:16 »
          status: (city, temp, sky, time) => `${city} · ${temp} °C · ${sky} — vu à ${time}`,
          auto: 'position automatique',
          change: 'Changer de lieu',
          placeholder: 'Une ville (ex. Annecy)',
          ok: 'OK',
          useAuto: 'Position automatique',
          notFound: 'Je ne trouve pas ce lieu.',
          now: (label) => `Effet choisi : ${label}`,
        },
        // Le ciel, d'après les codes météo internationaux (WMO).
        sky: (code, day) =>
          code === 0 ? (day ? 'Grand soleil' : 'Nuit claire')
          : code <= 2 ? 'Éclaircies'
          : code === 3 ? 'Couvert'
          : code <= 48 ? 'Brouillard'
          : code <= 57 ? 'Bruine'
          : code <= 67 ? 'Pluie'
          : code <= 77 ? 'Neige'
          : code <= 82 ? 'Averses'
          : code <= 86 ? 'Averses de neige'
          : 'Orage',
      },
      wallpaper: {
        title: 'Fond d’écran',
        line: 'Une scène animée en pixel art, derrière tes icônes.',
        auto: 'suit la météo',
        now: (weather, scene) => `En ce moment, avec « ${weather} » : ${scene}.`,
        opening: 'Animation d’ouverture',
        openingLine: 'Quand tu déverrouilles ton Mac, la scène s’anime en grand pour t’accueillir.',
        lockLine: 'Brume filme l’animation de ta scène et la joue derrière l’écran de connexion, dès que tu ouvres ton Mac.',
        play: 'Jouer maintenant',
      },
      stickers: {
        title: 'Tes icônes',
        line: 'Pose une image ou l’icône d’une app où tu veux sur ton fond d’écran.',
        add: 'Ajouter une icône',
        addMore: 'Ajouter',
        drop: 'Glisse ici une image ou une app, ou clique sur « Ajouter une icône ».',
        hint: 'Fais glisser l’icône pour la placer. Elle reste sous les icônes du bureau.',
        size: 'Taille',
        pixel: 'Style pixel art',
        pixelLine: 'L’icône prend les gros pixels de la scène.',
        remove: 'Retirer',
        chooseTitle: 'Choisis une image ou une application',
        error: 'Brume n’a pas pu lire ce fichier (essaie une image PNG ou JPEG, ou une app).',
      },
      general: {
        title: 'Général',
        optionLines: {
          pauseOnBattery: 'Brume s’arrête quand ton Mac n’est pas branché.',
          stats: 'Images par seconde, particules… pour les curieux.',
        },
      },
    },

    // Menu de l'app (en haut de l'écran, quand la fenêtre de Brume est au premier plan).
    appMenu: {
      open: 'Afficher la fenêtre de Brume',
      edit: 'Édition',
      copy: 'Copier',
      selectAll: 'Tout sélectionner',
      window: 'Fenêtre',
      minimize: 'Réduire',
      close: 'Fermer',
    },

    menu: {
      header: 'Brume — la météo sur ton écran',
      open: 'Ouvrir Brume…',
      weatherHeader: 'Météo — sur ton écran',
      wallpaperHeader: 'Fond d’écran — derrière tes icônes',
      weather: 'Temps',
      wallpaper: 'Fond d’écran',
      scene: 'Scène',
      intensity: 'Intensité',
      intensityLevels: { light: 'Légère', normal: 'Normale', heavy: 'Forte' },
      wind: 'Vent',
      windLevels: { '-2': '⇇ Fort vers la gauche', '-1': '← Vers la gauche', '0': 'Pas de vent', '1': '→ Vers la droite', '2': '⇉ Fort vers la droite' },
      behind: 'Derrière les fenêtres',
      accumulate: 'S’accumule sur les fenêtres',
      snowballs: 'Boules de neige et bonshommes',
      realWeather: 'Météo actuelle (chez moi, en direct)',
      pauseOnBattery: 'Pause sur batterie',
      openAtLogin: 'Lancer au démarrage',
      stats: 'Afficher les statistiques',
      intro: 'Animation à l’ouverture du Mac',
      lockScreen: 'Animer l’écran de verrouillage',
      playIntro: 'Jouer l’animation d’ouverture',
      meltAll: 'Faire fondre tout ce qui est posé',
      pause: 'Mettre en pause',
      resume: 'Reprendre',
      quit: 'Quitter Brume',
    },

    toasts: {
      snowman2: '☃️ Un petit bonhomme de neige !',
      snowman3: '☃️ Bonhomme de neige complet. Bravo, artiste.',
      splat: 'Splash !',
      paused: 'Brume est en pause',
      resumed: 'Brume reprend',
      battery: 'Sur batterie : Brume se met en pause',
      melted: 'Tout a fondu.',
      realWeather: (city, label, temp) => `Météo réelle à ${city} : ${label}, ${temp}°C`,
      realWeatherError: 'Impossible de récupérer la météo réelle, je garde ton choix.',
    },

    stats: {
      fps: 'images/s',
      frame: 'image',
      particles: 'particules',
      piles: 'colonnes de neige',
      windows: 'fenêtres suivies',
      balls: 'boules',
      quality: 'qualité',
      draws: 'appels GPU',
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = STRINGS;
  else root.BRUME_STRINGS = STRINGS;
})(typeof window !== 'undefined' ? window : globalThis);
