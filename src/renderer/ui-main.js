// Brume — page de la couche interface (toujours au-dessus des fenêtres, jamais cliquable).
// Notifications et statistiques ; les réglages ont leur propre fenêtre (settings.html).
(function () {
  'use strict';
  const B = window.Brume;
  const api = window.brume;
  const ui = new B.UI(document.getElementById('ui'));

  api.onState((st) => {
    ui.setDisplay(st.display);
    ui.setSettings(st.settings);
  });
  api.onCommand((cmd) => {
    if (cmd.type === 'toast') ui.toast(cmd.text);
  });
  api.onStats((stats) => ui.updateStats(stats));
})();
