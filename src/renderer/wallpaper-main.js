// Brume — page de la couche « fond d'écran » (sous les icônes du bureau).
// Deux moteurs :
//  • les scènes redessinées en pixel art (B.PixelScenes) : une petite toile 2D agrandie
//    d'un facteur entier, avec personnages et animaux animés ;
//  • les autres scènes : l'ancien shader lofi (WebGL).
// Fournit aussi, sur demande, une image fixe de la scène pour le vrai fond d'écran macOS.
(function () {
  'use strict';
  const B = window.Brume;
  const P = window.BRUME_PALETTES;
  const api = window.brume;
  const canvas = document.getElementById('sky');
  const pixelCanvas = document.getElementById('pixel');
  const pg = pixelCanvas.getContext('2d');
  const r = new B.Renderer(canvas);
  const host = { settings: { wallpaper: 'off', effect: 'none' }, effectName: 'none' };
  const wallpaper = new B.Wallpaper(host);
  let pixelScene = null;
  let pixelKey = null;
  let running = false;
  let last = 0;
  let tick = 0;

  function resize() {
    r.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
    r.setRects([]);
    r.bandEnabled = false;
    pixelKey = null; // la scène pixel sera repeinte à la nouvelle taille
  }

  // Taille logique : ~240 pixels de haut, agrandis d'un facteur ENTIER (pixels nets).
  function pixelSize() {
    const k = Math.max(2, Math.round(window.innerHeight / 240));
    return { k, W: Math.ceil(window.innerWidth / k), H: Math.ceil(window.innerHeight / k) };
  }

  function ensurePixelScene(key) {
    if (!key || !B.PixelScenes[key]) {
      pixelScene = null;
      pixelKey = null;
      return;
    }
    if (pixelScene && pixelKey === key) return;
    const { k, W, H } = pixelSize();
    pixelCanvas.width = W;
    pixelCanvas.height = H;
    pixelCanvas.style.width = `${W * k}px`;
    pixelCanvas.style.height = `${H * k}px`;
    pixelScene = new B.PixelScenes[key](W, H);
    pixelKey = key;
  }

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (tick++ % 2) return; // 30 images/s suffisent pour un fond
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 30;
    last = now;
    const key = P.resolve(host.settings.wallpaper, host.effectName);
    ensurePixelScene(key);
    if (pixelScene) {
      pixelScene.update(dt, { effect: host.effectName });
      pixelScene.draw(pg);
      pixelCanvas.style.opacity = '1';
      canvas.style.opacity = '0';
      return;
    }
    pixelCanvas.style.opacity = '0';
    canvas.style.opacity = '1';
    wallpaper.update(dt, r.lofiSize[0], r.lofiSize[1]);
    r.begin(now / 1000);
    if (wallpaper.visible()) r.drawWallpaper(wallpaper.cur, wallpaper.level);
  }

  function start() {
    if (running) return;
    running = true;
    last = 0;
    requestAnimationFrame(frame);
  }

  api.onState((st) => {
    host.settings = st.settings;
    host.effectName = st.settings.effect;
    if (st.paused) running = false;
    else start();
  });
  api.onPaused((paused) => (paused ? (running = false) : start()));

  // Agrandit une petite image en pixels nets à la taille de l'écran, puis l'encode en
  // PNG ici, dans la page : le processus principal ne gèle pas.
  async function sendStill(small) {
    const dpr = window.devicePixelRatio || 1;
    const big = new OffscreenCanvas(Math.round(window.innerWidth * dpr), Math.round(window.innerHeight * dpr));
    const ctx = big.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, big.width, big.height);
    const blob = await big.convertToBlob({ type: 'image/png' });
    api.snapshot({ png: await blob.arrayBuffer() });
  }

  // Image fixe de la scène, pour le vrai fond d'écran macOS.
  async function snapshot() {
    const key = P.resolve(host.settings.wallpaper, host.effectName);
    if (key && B.PixelScenes[key]) {
      ensurePixelScene(key);
      pixelScene.update(0.001, { effect: host.effectName }); // décor du temps actif, même en pause
      pixelScene.draw(pg);
      return sendStill(pixelCanvas);
    }
    wallpaper.snapTo(); // palette cible tout de suite, même si la page était en pause
    if (!wallpaper.cur) return api.snapshot(null);
    const still = { ...wallpaper.cur, animA: new Float32Array(B.MAX_ANIMALS * 4), animB: new Float32Array(B.MAX_ANIMALS * 4) };
    const img = r.readLofi(still);
    const small = new OffscreenCanvas(img.w, img.h);
    const pixels = new ImageData(img.w, img.h);
    const row = img.w * 4;
    for (let y = 0; y < img.h; y++) pixels.data.set(img.data.subarray((img.h - 1 - y) * row, (img.h - y) * row), y * row);
    small.getContext('2d').putImageData(pixels, 0, 0);
    return sendStill(small);
  }

  // Vignettes de la fenêtre de réglages : chaque scène est peinte une fois, à part, puis
  // renvoyée en PNG. Cette page (cachée) connaît déjà toutes les scènes, même les nouvelles.
  async function thumbs({ list, w, h }) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    for (const { key, effect } of list) {
      try {
        const Scene = B.PixelScenes[key];
        if (!Scene) throw new Error('scène inconnue');
        const scene = new Scene(w, h);
        for (let i = 0; i < 45; i++) scene.update(1 / 30, { effect }); // un peu de vie : passants, fumée…
        g.clearRect(0, 0, w, h);
        scene.draw(g);
        api.thumb(key, c.toDataURL('image/png'));
      } catch {
        api.thumb(key, null);
      }
      await new Promise((done) => setTimeout(done, 0));
    }
  }

  api.onCommand((cmd) => {
    // Easter egg : coup de baguette (positions à l'écran → pixels de la scène).
    if (cmd.type === 'magic' && pixelScene && pixelScene.magic) {
      const k = window.innerHeight / pixelCanvas.height;
      pixelScene.magic((cmd.path || []).map((p) => ({ x: p.x / k, y: p.y / k })));
      return;
    }
    if (cmd.type === 'snapshot') snapshot().catch(() => api.snapshot(null));
    else if (cmd.type === 'thumbs') thumbs(cmd);
  });
  window.addEventListener('resize', resize);
  resize();
  // Pour les captures de test : #fauna fait passer un animal tout de suite.
  if (location.hash === '#fauna') wallpaper.fauna.next = 0;
})();
