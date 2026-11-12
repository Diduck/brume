// Brume — page de la couche météo : relie le moteur au processus principal.
// Les textes (notifications, statistiques, boule tenue) partent vers la couche
// interface, qui reste au-dessus de tes fenêtres.
(function () {
  'use strict';
  const B = window.Brume;
  const api = window.brume;
  const canvas = document.getElementById('sky');
  const ui = {
    toast: (text) => api.toast(text),
    updateStats: (stats) => api.stats(stats),
    hitTest: () => false,
    busy: () => false,
  };
  const engine = new B.Engine(canvas, ui);

  api.onState((st) => {
    engine.setDisplay(st.display);
    engine.setSettings(st.settings);
    if (st.paused) engine.stop();
    else engine.start();
  });
  api.onWindows((m) => engine.setWindows(m.list, m.closed));
  api.onCursor((c) => engine.setCursor(c));
  api.onPaused((paused) => (paused ? engine.stop() : engine.start()));
  api.onCommand((cmd) => {
    engine.wake();
    if (cmd.type === 'melt') engine.meltAll();
  });

  // La souris n'arrive ici que lorsque la fenêtre est « interactive » (sur une boule).
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) engine.pointerDown();
  });
  window.addEventListener('mouseup', () => engine.pointerUp());
  window.addEventListener('resize', () => engine.resize());
})();
