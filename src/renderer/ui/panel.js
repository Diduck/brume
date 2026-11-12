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
  const WEATHER_OPTIONS = ['behind', 'accumulate', 'snowballs', 'aurora']; // « en direct » est en haut, bien visible
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
      sec.append(sectionHead('weather', N.title, N.line, 'sec-weather'), this.buildLive(), tiles);
      return sec;
    }

    // MÉTÉO EN DIRECT : le vrai temps du lieu (automatique ou choisi), à cette heure-ci.
    buildLive() {
      const L = S.panel.weather.live;
      const box = el('div', 'live');
      this.liveSw = switchCard(L.label, L.off, () => this.choose({ realWeather: !this.settings.realWeather }));
      this.liveSw.classList.add('live-sw');
      this.liveSw.prepend(B.icon('pin', 'live-pin'));
      this.liveLine = this.liveSw.querySelector('.sw-line');

      // Changer de lieu : un champ pour une ville, ou retour à la position automatique.
      const row = el('div', 'live-place');
      this.livePlaceBtn = button('link', L.change);
      const form = el('form', 'live-form');
      form.hidden = true;
      const input = el('input', 'live-input');
      input.type = 'text';
      input.placeholder = L.placeholder;
      input.autocomplete = 'off';
      input.spellcheck = false;
      const ok = button('ghost', L.ok);
      ok.type = 'submit';
      const auto = button('link', L.useAuto);
      this.liveMsg = el('span', 'live-msg');
      form.append(input, ok, auto, this.liveMsg);
      row.append(this.livePlaceBtn, form);
      this.livePlaceBtn.addEventListener('click', () => {
        form.hidden = false;
        this.livePlaceBtn.hidden = true;
        input.value = (this.settings.place && this.settings.place.city) || '';
        input.focus();
        input.select();
      });
      const close = () => {
        form.hidden = true;
        this.livePlaceBtn.hidden = false;
        this.liveMsg.textContent = '';
      };
      const go = async (name) => {
        this.liveMsg.textContent = L.loading;
        const res = await this.api.setPlace(name);
        if (res && res.error) this.liveMsg.textContent = res.error;
        else close();
      };
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (input.value.trim()) go(input.value.trim());
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      });
      auto.addEventListener('click', () => go(null));
      box.append(this.liveSw, row);
      this.liveEl = box;
      return box;
    }

    syncLive() {
      const L = S.panel.weather.live;
      const s = this.settings;
      const on = !!s.realWeather;
      const lv = this.live;
      this.liveSw.classList.toggle('on', on);
      this.liveSw.setAttribute('aria-checked', String(on));
      this.liveEl.classList.toggle('on', on);
      let line = L.off;
      if (on) {
        if (!lv || lv.state === 'loading') line = L.loading;
        else if (lv.state === 'error' && !lv.city) line = L.error;
        else {
          const time = new Date(lv.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
          line = L.status(lv.city, lv.temperature, S.panel.weather.sky(lv.code, lv.isDay), time);
          if (lv.auto) line += ` (${L.auto})`;
          if (lv.state === 'error') line += ` · ${L.error}`;
        }
      }
      this.liveLine.textContent = line;
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

      sec.append(sectionHead('scene', N.title, N.line, 'sec-wallpaper'), grid, this.sceneDesc, this.buildStickers());
      return sec;
    }

    // TES ICÔNES : un petit écran où l'on fait glisser ses icônes (image ou app) sur la
    // scène, avec leur taille. Le vrai fond d'écran suit en direct.
    buildStickers() {
      const T = S.panel.stickers;
      const box = el('div', 'stickers');
      const head = el('div', 'stk-head');
      const text = el('div', 'stk-text');
      text.append(el('p', 'pw-label', T.title), el('p', 'stk-line', T.line));
      this.stkAdd = button('ghost', B.icon('plus', 'line'), el('span', null, T.add));
      this.stkAdd.addEventListener('click', () => this.addSticker(this.api.addSticker()));
      head.append(text, this.stkAdd);

      // L'écran miniature (aux proportions de ton écran).
      const stage = el('div', 'stk-stage');
      const canvas = el('canvas', 'stk-canvas');
      canvas.setAttribute('aria-label', T.hint);
      this.stkDrop = el('p', 'stk-drop', T.drop);
      stage.append(canvas, this.stkDrop);
      this.stkStage = stage;
      this.stkCanvas = canvas;
      this.stkCtx = canvas.getContext('2d');
      this.stkSel = null; // id de l'icône choisie

      // Réglages de l'icône choisie : taille, style pixel art, retirer.
      const tools = el('div', 'stk-tools');
      const sizeWrap = el('label', 'stk-size');
      this.stkSize = el('input');
      this.stkSize.type = 'range';
      this.stkSize.min = '3';
      this.stkSize.max = '60';
      this.stkSize.step = '1';
      this.stkSizeOut = el('span', 'stk-size-out');
      sizeWrap.append(el('span', 'stk-size-label', T.size), this.stkSize, this.stkSizeOut);
      this.stkSize.addEventListener('input', () => this.editSticker({ size: Number(this.stkSize.value) / 100 }));
      this.stkPixel = switchCard(T.pixel, T.pixelLine, () => {
        const cur = this.selectedSticker();
        if (cur) this.editSticker({ pixel: !cur.pixel }, true);
      });
      this.stkPixel.classList.add('stk-pixel');
      const remove = button('stk-remove', B.icon('trash', 'line'), el('span', null, T.remove));
      remove.addEventListener('click', () => this.removeSticker());
      tools.append(sizeWrap, this.stkPixel, remove);
      this.stkTools = tools;
      this.stkHint = el('p', 'stk-hint', T.hint);

      box.append(head, stage, tools, this.stkHint);
      this.stickersEl = box;
      this.wireStage();
      B.Stickers.onChange(() => this.drawStage());
      new ResizeObserver(() => this.drawStage()).observe(stage);
      return box;
    }

    stickerList() {
      return this.settings.stickers || [];
    }

    selectedSticker() {
      return this.stickerList().find((t) => t.id === this.stkSel) || null;
    }

    async addSticker(promise) {
      this.stkAdd.disabled = true;
      try {
        const res = await promise;
        if (res && res.id) this.stkSel = res.id;
        else if (res && res.error) this.api.toast(res.error);
      } finally {
        this.stkAdd.disabled = false;
      }
    }

    // Modifie l'icône choisie : tout de suite ici, et vers le vrai fond d'écran (au plus
    // ~16 fois par seconde pendant un glissé, puis une dernière fois à la fin).
    editSticker(patch, now) {
      const list = this.stickerList().map((t) => (t.id === this.stkSel ? { ...t, ...patch } : t));
      this.settings = { ...this.settings, stickers: list };
      this.syncStickers();
      clearTimeout(this.stkTimer);
      this.stkTimer = null;
      const push = () => {
        this.stkTimer = null;
        this.stkPushed = performance.now();
        this.api.setSettings({ stickers: this.settings.stickers });
      };
      if (now || performance.now() - (this.stkPushed || 0) > 60) push();
      else this.stkTimer = setTimeout(push, 60);
    }

    removeSticker() {
      const list = this.stickerList();
      const i = list.findIndex((t) => t.id === this.stkSel);
      if (i < 0) return;
      const next = list.filter((_, j) => j !== i);
      this.stkSel = next.length ? next[Math.min(i, next.length - 1)].id : null;
      this.choose({ stickers: next });
    }

    // Glisser une icône pour la placer, molette (ou deux doigts) pour changer sa taille,
    // et dépôt d'une image ou d'une app depuis le Finder.
    wireStage() {
      const c = this.stkCanvas;
      const at = (e) => {
        const r = c.getBoundingClientRect();
        return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, w: r.width, h: r.height };
      };
      c.addEventListener('pointerdown', (e) => {
        const p = at(e);
        const list = this.stickerList();
        const i = B.Stickers.hit(list, 1, 1, p.x, p.y);
        if (i < 0) return;
        const t = list[i];
        this.stkSel = t.id;
        // L'icône prise passe au-dessus des autres.
        if (i !== list.length - 1) this.settings = { ...this.settings, stickers: [...list.slice(0, i), ...list.slice(i + 1), t] };
        this.stkDrag = { dx: p.x - t.x, dy: p.y - t.y };
        c.setPointerCapture(e.pointerId);
        c.classList.add('dragging');
        this.syncStickers();
      });
      c.addEventListener('pointermove', (e) => {
        const p = at(e);
        if (!this.stkDrag) {
          c.classList.toggle('grab', B.Stickers.hit(this.stickerList(), 1, 1, p.x, p.y) >= 0);
          return;
        }
        const clamp01 = (v) => Math.min(1, Math.max(0, v));
        this.editSticker({ x: clamp01(p.x - this.stkDrag.dx), y: clamp01(p.y - this.stkDrag.dy) });
      });
      const end = () => {
        if (!this.stkDrag) return;
        this.stkDrag = null;
        c.classList.remove('dragging');
        this.editSticker({}, true);
      };
      c.addEventListener('pointerup', end);
      c.addEventListener('pointercancel', end);
      c.addEventListener(
        'wheel',
        (e) => {
          const p = at(e);
          const list = this.stickerList();
          const i = B.Stickers.hit(list, 1, 1, p.x, p.y);
          const t = i >= 0 ? list[i] : this.selectedSticker();
          if (!t) return;
          e.preventDefault();
          this.stkSel = t.id;
          const size = Math.min(0.6, Math.max(0.03, t.size * Math.exp(-e.deltaY * 0.004)));
          this.editSticker({ size });
        },
        { passive: false }
      );
      const stage = this.stkStage;
      stage.addEventListener('dragover', (e) => {
        e.preventDefault();
        stage.classList.add('over');
      });
      stage.addEventListener('dragleave', () => stage.classList.remove('over'));
      stage.addEventListener('drop', (e) => {
        e.preventDefault();
        stage.classList.remove('over');
        const file = e.dataTransfer && e.dataTransfer.files[0];
        if (file) this.addSticker(this.api.addStickerFile(file));
      });
    }

    syncStickers() {
      const list = this.stickerList();
      if (this.stkSel && !list.some((t) => t.id === this.stkSel)) this.stkSel = null;
      if (!this.stkSel && list.length) this.stkSel = list[list.length - 1].id;
      const cur = this.selectedSticker();
      this.stickersEl.classList.toggle('has', list.length > 0);
      this.stkTools.hidden = !cur;
      this.stkHint.hidden = !cur;
      this.stkDrop.hidden = list.length > 0;
      this.stkAdd.querySelector('span').textContent = list.length ? S.panel.stickers.addMore : S.panel.stickers.add;
      if (cur) {
        const pct = Math.round(cur.size * 100);
        if (document.activeElement !== this.stkSize) this.stkSize.value = String(pct);
        this.stkSizeOut.textContent = `${pct} %`;
        this.stkPixel.classList.toggle('on', !!cur.pixel);
        this.stkPixel.setAttribute('aria-checked', String(!!cur.pixel));
      }
      this.drawStage();
    }

    // L'écran miniature : la scène du moment, puis les icônes comme sur le vrai fond.
    drawStage() {
      const c = this.stkCanvas;
      if (!c) return;
      const d = (this.display && this.display.width && this.display) || { width: 16, height: 10 };
      this.stkStage.style.aspectRatio = `${d.width} / ${d.height}`;
      const dpr = window.devicePixelRatio || 1;
      const r = this.stkStage.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width * dpr));
      const h = Math.max(1, Math.round(r.height * dpr));
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      const g = this.stkCtx;
      g.clearRect(0, 0, w, h);
      const key = P.resolve(this.settings.wallpaper, this.settings.effect);
      const img = key && this.images[key];
      if (img && img.complete && img.naturalWidth) {
        // Comme le fond : la scène couvre l'écran, en gros pixels.
        g.imageSmoothingEnabled = false;
        const k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
        g.drawImage(img, (w - img.naturalWidth * k) / 2, (h - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
      } else {
        const grad = g.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#2a3350');
        grad.addColorStop(1, '#141a2a');
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
      }
      // Taille d'un gros pixel de la scène, à l'échelle de la miniature.
      const kScreen = Math.max(2, Math.round(d.height / 240));
      const grid = (h / d.height) * kScreen;
      B.Stickers.render(g, this.stickerList(), w, h, grid);
      const cur = this.selectedSticker();
      if (cur) {
        const b = B.Stickers.box(cur, w, h);
        g.save();
        g.strokeStyle = 'rgba(242, 194, 126, 0.95)';
        g.lineWidth = 1.5 * dpr;
        g.setLineDash([4 * dpr, 3 * dpr]);
        g.strokeRect(Math.round(b.x) - 2.5 * dpr, Math.round(b.y) - 2.5 * dpr, Math.round(b.w) + 5 * dpr, Math.round(b.h) + 5 * dpr);
        g.restore();
      }
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
      const mine = this.settings.stickers;
      this.settings = st.settings;
      // Pendant un glissé, la liste d'ici est la plus récente : on la garde.
      if (this.stkDrag || this.stkTimer) this.settings = { ...this.settings, stickers: mine };
      this.display = st.display;
      this.live = st.live;
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
        img.onload = () => {
          this.preview.setBackdrops(this.images);
          this.drawStage();
        };
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
      this.syncLive();
      this.syncStickers();
    }

    /* ---------- Aperçu (arrêté quand la fenêtre est cachée) ---------- */

    setVisible(visible) {
      if (visible) requestAnimationFrame(() => this.preview.start());
      else this.preview.stop();
    }
  }

  B.Panel = Panel;
})();
