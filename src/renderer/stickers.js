// Brume — tes icônes, posées où tu veux sur le fond d'écran.
//
// Une icône = une image (rangée par le processus principal, envoyée ici en data URL) +
// une place : son centre (x, y en fraction de l'écran) et sa taille (fraction de la
// hauteur de l'écran). En « style pixel art », elle est redessinée aux gros pixels de la
// scène : réduite sur la grille, bords nets (pas de demi-transparence), puis agrandie.
// Utilisé par la couche fond d'écran et par l'éditeur de la fenêtre de Brume.
(function () {
  'use strict';
  const B = (window.Brume = window.Brume || {});
  const images = new Map(); // id -> { url, img, ready }
  const pixelCache = new Map(); // `${id}:${w}x${h}` -> petite toile
  const listeners = new Set();

  // map : { id: dataURL }. Les images déjà connues ne sont pas rechargées.
  function setImages(map) {
    for (const [id, url] of Object.entries(map || {})) {
      const cur = images.get(id);
      if (!url) {
        images.delete(id);
        continue;
      }
      if (cur && cur.url === url) continue;
      const entry = { url, img: new Image(), ready: false };
      entry.img.onload = () => {
        entry.ready = true;
        for (const key of pixelCache.keys()) if (key.startsWith(`${id}:`)) pixelCache.delete(key);
        for (const fn of listeners) fn();
      };
      entry.img.src = url;
      images.set(id, entry);
    }
  }

  const onChange = (fn) => listeners.add(fn);

  function naturalSize(img) {
    const w = img.naturalWidth || img.width || 1;
    const h = img.naturalHeight || img.height || 1;
    return { w, h };
  }

  // Rectangle occupé par une icône dans une toile w × h.
  function box(s, w, h) {
    const e = images.get(s.id);
    const ratio = e && e.ready ? naturalSize(e.img).w / naturalSize(e.img).h : 1;
    const bh = s.size * h;
    const bw = bh * ratio;
    return { x: s.x * w - bw / 2, y: s.y * h - bh / 2, w: bw, h: bh };
  }

  // La version « gros pixels » d'une image : pw × ph pixels, alpha tout ou rien.
  function pixelated(id, img, pw, ph) {
    const key = `${id}:${pw}x${ph}`;
    let c = pixelCache.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = pw;
    c.height = ph;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, pw, ph);
    const data = g.getImageData(0, 0, pw, ph);
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a < 110) {
        d[i + 3] = 0;
        continue;
      }
      // Couleur « dé-prémultipliée » sur les bords, puis opaque.
      if (a < 255) {
        const f = 255 / a;
        d[i] = Math.min(255, d[i] * f);
        d[i + 1] = Math.min(255, d[i + 1] * f);
        d[i + 2] = Math.min(255, d[i + 2] * f);
      }
      d[i + 3] = 255;
    }
    g.putImageData(data, 0, 0);
    if (pixelCache.size > 64) pixelCache.clear();
    pixelCache.set(key, c);
    return c;
  }

  // Dessine les icônes dans g (toile de w × h). grid : taille d'un gros pixel de la scène,
  // en pixels de cette toile (pour le style pixel art).
  function render(g, list, w, h, grid) {
    for (const s of list || []) {
      const e = images.get(s.id);
      if (!e || !e.ready) continue;
      const r = box(s, w, h);
      if (s.pixel && grid >= 1.5) {
        const pw = Math.max(1, Math.round(r.w / grid));
        const ph = Math.max(1, Math.round(r.h / grid));
        const x = Math.round(r.x / grid) * grid;
        const y = Math.round(r.y / grid) * grid;
        g.imageSmoothingEnabled = false;
        g.drawImage(pixelated(s.id, e.img, pw, ph), x, y, pw * grid, ph * grid);
      } else {
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(e.img, r.x, r.y, r.w, r.h);
      }
    }
  }

  // L'icône sous un point (la plus au-dessus), ou -1.
  function hit(list, w, h, px, py) {
    for (let i = (list || []).length - 1; i >= 0; i--) {
      const r = box(list[i], w, h);
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return i;
    }
    return -1;
  }

  B.Stickers = { setImages, onChange, render, hit, box };
})();
