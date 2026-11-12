// Brume — page de la fenêtre de Brume (accueil et réglages).
// Une vraie fenêtre macOS : on la déplace par son aperçu, elle passe derrière les autres
// applications, le bouton jaune la réduit et le rouge la cache (Brume continue dans la
// barre des menus). Sa hauteur suit son contenu (« Voir plus »).
(function () {
  'use strict';
  const B = window.Brume;
  const api = window.brume;
  const panel = new B.Panel(document.getElementById('panel'), api);

  // #more : « Voir plus » déplié d'emblée (captures de test).
  if (location.hash === '#more') panel.setMore(true, false);

  api.onState((st) => panel.setState(st));
  api.onThumbs((map) => panel.setThumbs(map));
  api.onStickers((map) => B.Stickers.setImages(map));

  // L'aperçu ne tourne que lorsque la fenêtre est visible.
  const visibility = () => panel.setVisible(document.visibilityState === 'visible');
  document.addEventListener('visibilitychange', visibility);
  visibility();

  // Échap ou ⌘W : cacher la fenêtre (comme le bouton rouge).
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || (e.metaKey && e.key.toLowerCase() === 'w')) {
      e.preventDefault();
      api.hidePanel();
    }
  });
})();
