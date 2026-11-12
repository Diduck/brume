// Brume — la fenêtre de Brume : accueil et réglages.
//
// Deux idées bien séparées, l'une sous l'autre :
//  • MÉTÉO : ce qui tombe sur ton écran (neige, pluie…) et se pose sur tes fenêtres ;
//  • FOND D'ÉCRAN : la scène en pixel art, un LIEU, qui vit derrière tes icônes.
// Seul l'essentiel est visible ; « Voir plus » déplie les autres réglages.
// En haut, un aperçu vivant montre les deux ensemble : la scène en décor, le temps qui
// tombe sur une mini-fenêtre.
// Tout le texte vient de src/shared/strings.js (aucune phrase n'est écrite ici).
(function () {
  'use strict';
  const B = window.Brume;
  const S = window.BRUME_STRINGS;
  const P = window.BRUME_PALETTES;
  const EFFECTS = ['snow', 'rain', 'storm', 'sakura', 'leaves', 'fireflies', 'starfall', 'none'];
  const GESTURE_ICONS = ['shake', 'roll', 'stack'];
  const WEATHER_OPTIONS = ['realWeather', 'behind', 'accumulate', 'snowballs', 'aurora'];
  const GENERAL_OPTIONS = ['pauseOnBattery', 'stats'];
  const MORE_KEY = 'brume.panel.more';

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const button = (cls, ...children) => {
    const b = el('button', cls);
    b.type = 'button';
    b.append(...children);
    return b;
  };
  const sceneLabel = (key) => (S.wallpapers[key] ? S.wallpapers[key].label : key);
  const sceneLine = (key) => (S.wallpapers[key] ? S.wallpapers[key].line : '');
  // Scènes qui changent d'elles-mêmes avec la météo (vignette = l'ambiance du moment).
  const follows = (key) => key === 'auto' || key === 'ville';

  // Vignette de secours (avant que les vraies scènes soient peintes) : le ciel en dégradé
  // et une silhouette de ville, aux couleurs de la scène.
  function swatchBackground(key) {
    const p = P.PALETTES[key];
    if (!p) return 'linear-gradient(#1a2033, #0d111a)';
    return `linear-gradient(to top, ${p.near} 0 20%, transparent 20%), linear-gradient(to top, ${p.mid} 0 32%, transparent 32%), linear-gradient(${p.skyTop}, ${p.skyMid} 55%, ${p.horizon})`;
  }

  // Un interrupteur sous forme de ligne : titre, phrase d'explication, glissière.
  function switchCard(label, line, onClick) {
    const text = el('span', 'sw-text');
    text.append(el('span', 'sw-label', label));
    if (line) text.append(el('span', 'sw-line', line));
    const b = button('sw', text, el('span', 'switch-track'));
    b.setAttribute('role', 'switch');
    b.addEventListener('click', onClick);
    return b;
  }

  // Petit groupe de boutons exclusifs (intensité, vent).
  let segId = 0;
  function segmented(labelText, items, onPick) {
    const wrap = el('div', 'field');
    const label = el('p', 'pw-label', labelText);
    label.id = `seg-${++segId}`;
    const seg = el('div', 'seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-labelledby', label.id);
    const buttons = new Map();
    for (const { value, text, title } of items) {
      const b = button(`seg-btn${text.length <= 2 ? ' glyph' : ''}`, text);
      b.setAttribute('role', 'radio');
      if (title) b.title = title;
      b.addEventListener('click', () => onPick(value));
      seg.append(b);
      buttons.set(value, b);
    }
    wrap.append(label, seg);
    return { wrap, buttons };
  }

  function sectionHead(icon, title, line, id) {
    const head = el('div', 'sec-head');
    const badge = el('span', 'sec-badge');
    badge.append(B.icon(icon));
    const text = el('div');
    const h = el('h2', 'sec-title', title);
    h.id = id;
    text.append(h, el('p', 'sec-line', line));
    head.append(badge, text);
    return head;
  }

  function group(labelText, cls, ...children) {
    const g = el('div', `group ${cls || ''}`);
    if (labelText) g.append(el('p', 'pw-label', labelText));
    g.append(...children);
    return g;
  }

  class Panel {
    constructor(root, api) {
      this.root = root;
      this.api = api;
      this.settings = { effect: 'snow', wallpaper: 'off' };
      this.images = {}; // scène -> Image (vignettes peintes par la page du fond d'écran)
      this.thumbUrls = {};
      this.build();
      let more = false;
      try {
        more = localStorage.getItem(MORE_KEY) === '1';
      } catch {
        /* stockage indisponible : replié */
      }
      this.setMore(more, false);
      this.watchHeight();
    }

    /* ---------- Construction ---------- */

    build() {
      const N = S.panel;
      const W = S.welcome;

      // En-tête : l'aperçu vivant, qui sert aussi de poignée pour déplacer la fenêtre.
      const hero = el('header', 'hero');
      const canvas = el('canvas', 'hero-canvas');
      canvas.setAttribute('aria-hidden', 'true');
      this.preview = new B.Preview(canvas);
      const mark = el('div', 'hero-mark');
      mark.append(B.icon('snow'), el('span', null, S.appName));
      this.titleEl = el('h1', 'hero-title');
      const text = el('div', 'hero-text');
      text.append(mark, this.titleEl);
      hero.append(canvas, text);
      this.heroEl = hero;

      this.ledeEl = el('p', 'lede', W.body);

      // Le contenu défile si l'écran est trop petit ; l'aperçu et le pied restent en place.
      const scroll = el('div', 'scroll');
      const content = el('div', 'content');
      this.moreBtn = button('more-toggle', el('span', 'more-label'), B.icon('chevron'));
      this.moreBtn.setAttribute('aria-controls', 'more');
      this.moreBtn.addEventListener('click', () => this.setMore(!this.more, true));
      content.append(this.ledeEl, this.buildWeather(), this.buildWallpaper(), this.moreBtn, this.buildMore());
      scroll.append(content);
      this.scrollEl = scroll;
      this.contentEl = content;

      const foot = el('footer', 'foot');
      const hint = el('p', 'hint');
      hint.append(B.icon('snow'), el('span', null, W.hint));
      this.startEl = button('start');
      this.startEl.addEventListener('click', () => {
        if (!this.settings.welcomeSeen) this.api.welcomeDone();
        this.api.hidePanel();
      });
      foot.append(hint, this.startEl);
      this.footEl = foot;

      this.root.append(hero, scroll, foot);
    }

    // MÉTÉO : les huit temps, en tuiles.
    buildWeather() {
      const N = S.panel.weather;
      const sec = el('section', 'block is-weather');
      sec.setAttribute('aria-labelledby', 'sec-weather');
      const tiles = el('div', 'tiles');
      tiles.setAttribute('role', 'radiogroup');
      tiles.setAttribute('aria-labelledby', 'sec-weather');
      this.tileEls = {};
      for (const key of EFFECTS) {
        const tile = button('tile', B.icon(key), el('span', 'tile-label', S.effects[key].label));
        tile.setAttribute('role', 'radio');
        tile.title = S.effects[key].line;
        tile.addEventListener('click', () => this.choose({ effect: key }));
        tiles.append(tile);
        this.tileEls[key] = tile;
      }
      sec.append(sectionHead('weather', N.title, N.line, 'sec-weather'), tiles);
      return sec;
    }

    // FOND D'ÉCRAN : les scènes, construites depuis BRUME_PALETTES.ORDER (une nouvelle
    // scène apparaît toute seule).
    buildWallpaper() {
      const N = S.panel.wallpaper;
      const sec = el('section', 'block is-scene');
      sec.setAttribute('aria-labelledby', 'sec-wallpaper');
      const grid = el('div', 'scenes');
      grid.setAttribute('role', 'radiogroup');
      grid.setAttribute('aria-labelledby', 'sec-wallpaper');
      this.sceneEls = {};
      for (const key of P.ORDER) {
        const thumb = el('span', `thumb${key === 'off' ? ' thumb-off' : ''}`);
        if (key === 'off') thumb.append(B.icon('noscene'));
        else if (!follows(key)) thumb.style.backgroundImage = swatchBackground(key);
        if (follows(key)) {
          // Pastille « suit la météo » : cette vignette change avec le temps choisi.
          const badge = el('span', 'follow-badge');
          badge.title = N.auto;
          badge.append(B.icon('auto'));
          thumb.append(badge);
        }
        const item = button('scene', thumb, el('span', 'scene-name', sceneLabel(key)));
        item.setAttribute('role', 'radio');
        item.title = sceneLine(key);
        item.addEventListener('click', () => this.choose({ wallpaper: key }));
        grid.append(item);
        this.sceneEls[key] = { item, thumb };
      }

      // Ce que fait la scène choisie, en une phrase.
      this.sceneDesc = el('p', 'scene-desc');
      this.sceneDesc.setAttribute('aria-live', 'polite');

      sec.append(sectionHead('scene', N.title, N.line, 'sec-wallpaper'), grid, this.sceneDesc);
      return sec;
    }

    // « Voir plus » : tout le reste, rangé sous les mêmes deux titres, plus « Général ».
    buildMore() {
      const N = S.panel;
      const M = S.menu;
      const more = el('div', 'more');
      more.id = 'more';
      const inner = el('div', 'more-inner');

      // Météo : intensité, vent, interrupteurs, gestes.
      this.intensitySeg = segmented(
        M.intensity,
        ['light', 'normal', 'heavy'].map((v) => ({ value: v, text: M.intensityLevels[v] })),
        (v) => this.choose({ intensity: v })
      );
      this.windSeg = segmented(
        M.wind,
        [-2, -1, 0, 1, 2].map((v) => ({ value: v, text: N.weather.windShort[String(v)], title: M.windLevels[String(v)] })),
        (v) => this.choose({ wind: v })
      );
      const fields = el('div', 'fields');
      fields.append(this.intensitySeg.wrap, this.windSeg.wrap);

      const labels = { behind: M.behind, accumulate: M.accumulate, snowballs: M.snowballs, aurora: S.aurora.label, realWeather: M.realWeather, pauseOnBattery: M.pauseOnBattery, stats: M.stats };
      this.switchEls = {};
      const switches = (keys, lines) => {
        const box = el('div', 'switches');
        for (const key of keys) {
          const sw = switchCard(labels[key], lines[key], () => this.choose({ [key]: !this.settings[key] }));
          box.append(sw);
          this.switchEls[key] = sw;
        }
        return box;
      };

      const gestures = el('ul', 'gestures');
      S.welcome.gestures.forEach((t, i) => {
        const li = el('li');
        li.append(B.icon(GESTURE_ICONS[i]), el('span', null, t));
        gestures.append(li);
      });

      // Fond d'écran : l'animation d'ouverture joue la scène en grand.
      this.introSwitch = switchCard(M.intro, N.wallpaper.openingLine, () => this.choose({ intro: !this.settings.intro }));
      const play = button('ghost', B.icon('play'), el('span', null, N.wallpaper.play));
      play.title = M.playIntro;
      play.addEventListener('click', () => this.api.playIntro());
      this.lockSwitch = switchCard(M.lockScreen, N.wallpaper.lockLine, () => this.choose({ lockScreen: !this.settings.lockScreen }));
      const opening = el('div', 'opening');
      opening.append(this.introSwitch, play, this.lockSwitch);

      inner.append(
        group(N.weather.title, 'is-weather', fields, switches(WEATHER_OPTIONS, N.weather.optionLines)),
        group(N.weather.tryIt, 'is-weather', gestures),
        group(N.wallpaper.title, 'is-scene', opening),
        group(N.general.title, 'is-general', switches(GENERAL_OPTIONS, N.general.optionLines))
      );
      more.append(inner);
      this.moreEl = more;
      return more;
    }

    /* ---------- « Voir plus » ---------- */

    setMore(open, remember) {
      this.more = open;
      this.root.classList.toggle('more-open', open);
      this.moreBtn.setAttribute('aria-expanded', String(open));
      this.moreBtn.querySelector('.more-label').textContent = open ? S.panel.less : S.panel.more;
      this.moreEl.inert = !open;
      if (open && remember) {
        // Une fois déplié, on fait défiler doucement jusqu'aux nouveaux réglages.
        setTimeout(() => this.moreBtn.scrollIntoView({ behavior: 'smooth', block: 'start' }), 360);
      }
      if (!remember) return;
      try {
        localStorage.setItem(MORE_KEY, open ? '1' : '0');
      } catch {
        /* rien de grave */
      }
    }

    // La fenêtre prend la hauteur de son contenu (le processus principal la limite à l'écran).
    watchHeight() {
      let last = 0;
      const report = () => {
        const h = Math.ceil(this.heroEl.offsetHeight + this.contentEl.offsetHeight + this.footEl.offsetHeight);
        if (h && h !== last) {
          last = h;
          this.api.panelHeight(h);
        }
      };
      const ro = new ResizeObserver(report);
      for (const n of [this.heroEl, this.contentEl, this.footEl]) ro.observe(n);
    }

    /* ---------- État ---------- */

    setState(st) {
      this.settings = st.settings;
      this.sync();
    }

    // Réponse immédiate dans la fenêtre, puis enregistrement par le processus principal.
    choose(patch) {
      const next = { ...this.settings, ...patch };
      if ('effect' in patch && !('realWeather' in patch)) next.realWeather = false; // comme le processus principal
      this.settings = next;
      this.sync();
      this.api.setSettings(patch);
    }

    setThumbs(map) {
      for (const [key, url] of Object.entries(map)) {
        if (!url || this.thumbUrls[key] === url) continue;
        this.thumbUrls[key] = url;
        const img = new Image();
        img.onload = () => this.preview.setBackdrops(this.images);
        img.src = url;
        this.images[key] = img;
      }
      this.sync();
    }

    thumbStyle(key) {
      return this.thumbUrls[key] ? `url("${this.thumbUrls[key]}")` : swatchBackground(key);
    }

    sync() {
      const s = this.settings;
      const N = S.panel;
      const welcome = !s.welcomeSeen;
      this.root.classList.toggle('welcome', welcome);
      this.titleEl.textContent = welcome ? S.welcome.title : N.title;
      this.ledeEl.hidden = !welcome;
      this.startEl.textContent = welcome ? S.welcome.start : N.done;

      const radio = (node, on) => {
        node.classList.toggle('on', on);
        node.setAttribute('aria-checked', String(on));
      };
      for (const [key, tile] of Object.entries(this.tileEls)) radio(tile, s.effect === key);
      for (const [v, b] of this.intensitySeg.buttons) radio(b, s.intensity === v);
      for (const [v, b] of this.windSeg.buttons) radio(b, s.wind === v);
      for (const [key, sw] of Object.entries(this.switchEls)) radio(sw, !!s[key]);
      radio(this.introSwitch, !!s.intro);
      radio(this.lockSwitch, !!s.lockScreen);

      // Scènes : la choisie ; « Auto » et « Ville » montrent l'ambiance du moment.
      for (const [key, { item, thumb }] of Object.entries(this.sceneEls)) {
        radio(item, s.wallpaper === key);
        if (key === 'off') continue;
        const shown = follows(key) ? P.resolve(key, s.effect) : key;
        const bg = this.thumbStyle(shown);
        if (thumb.dataset.bg !== bg) {
          thumb.style.backgroundImage = bg;
          thumb.dataset.bg = bg;
        }
      }

      const fx = S.effects[s.effect] || S.effects.none;
      const shown = P.resolve(s.wallpaper, s.effect);
      this.sceneDesc.replaceChildren(el('strong', null, sceneLabel(s.wallpaper)), ` — ${sceneLine(s.wallpaper)}`);
      if (follows(s.wallpaper)) this.sceneDesc.append(` ${N.wallpaper.now(fx.label, sceneLabel(shown).toLowerCase())}`);

      this.preview.set(s.effect, s.wallpaper, s.aurora);
    }

    /* ---------- Aperçu (arrêté quand la fenêtre est cachée) ---------- */

    setVisible(visible) {
      if (visible) requestAnimationFrame(() => this.preview.start());
      else this.preview.stop();
    }
  }

  B.Panel = Panel;
})();
