// Brume — animation d'ouverture du Mac.
//
// À l'ouverture (déverrouillage, sortie de veille), une courte séquence « caméra de
// cinéma » joue en plein écran : la scène du fond d'écran peint un monde plus large que
// l'écran, et la caméra arrive en le longeant (travelling multiplane, voir
// intro-multiplane.js) jusqu'à cadrer exactement le fond d'écran.
// La fenêtre s'efface ensuite : derrière, le vrai fond d'écran est déjà la même image.
(function () {
  'use strict';
  const B = window.Brume;
  const api = window.brume;
  const view = document.getElementById('intro');
  const vg = view.getContext('2d');
  const greet = document.getElementById('greet');

  // Même taille logique que la couche fond d'écran (pour que l'arrivée tombe pile).
  function pixelSize() {
    const k = Math.max(2, Math.round(window.innerHeight / 240));
    return { k, W: Math.ceil(window.innerWidth / k), H: Math.ceil(window.innerHeight / k) };
  }

  /* ---------- Le nom du compte du Mac + l'heure ---------- */
  function showGreeting(name) {
    greet.querySelector('.greet-hello').textContent = name || '';
    greet.querySelector('.greet-time').textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    greet.classList.add('show');
    setTimeout(() => greet.classList.remove('show'), 3200);
  }

  /* ---------- Lecture ---------- */
  let skip = false;

  function play({ key, effect, name }) {
    const { k, W, H } = pixelSize();
    const sceneKey = B.PixelScenes[key] ? key : 'cafe';
    view.width = W * k;
    view.height = H * k;
    view.style.width = `${W * k}px`;
    view.style.height = `${H * k}px`;

    // La scène peint un monde plus large que l'écran (si elle le sait) : la caméra
    // arrivera en le longeant. Côté d'arrivée : celui que la scène préfère.
    const from = B.Multiplane.from(sceneKey);
    const wide = Math.round(W * 1.6);
    const margin = Math.round(W * 0.25);
    const ext = from === 'right' ? { left: margin, right: wide } : { left: wide, right: margin };
    const scene = new B.PixelScenes[sceneKey](W, H, { ext });
    scene.update(0.001, { effect }); // peint le décor du temps choisi
    const cam = new B.Multiplane(scene, sceneKey, effect, W, H, k, scene.extL || scene.extR ? 9 : 8);
    document.body.classList.add('playing');
    setTimeout(() => showGreeting(name), 700);

    let last = 0;
    let ending = false;
    function frame(now) {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const done = cam.draw(vg, dt);
      if ((done || skip) && !ending) {
        ending = true;
        // Fondu final : on révèle le vrai bureau (dont le fond d'écran est la même scène).
        document.body.classList.remove('playing');
        document.body.classList.add('ended');
        greet.classList.remove('show');
        setTimeout(() => api.introDone(), skip ? 450 : 1100);
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- Enregistrement en vidéo (pour l'écran de verrouillage) ----------
   * Même scène, même caméra, mais image par image à cadence fixe, sans agrandissement :
   * chaque image (W × H pixels) part vers le processus principal qui l'encode. */
  async function record({ key, effect, fps = 30, seconds = 30, W, H }) {
    try {
      const sceneKey = B.PixelScenes[key] ? key : 'cafe';
      view.width = W;
      view.height = H;
      const from = B.Multiplane.from(sceneKey);
      const wide = Math.round(W * 1.6);
      const margin = Math.round(W * 0.25);
      const ext = from === 'right' ? { left: margin, right: wide } : { left: wide, right: margin };
      const scene = new B.PixelScenes[sceneKey](W, H, { ext });
      scene.update(0.001, { effect });
      const cam = new B.Multiplane(scene, sceneKey, effect, W, H, 1, 9);
      const n = Math.round(fps * seconds);
      for (let i = 0; i < n; i++) {
        cam.draw(vg, i ? 1 / fps : 0);
        const img = vg.getImageData(0, 0, W, H);
        await api.recordFrame(img.data.buffer);
      }
      api.recordDone({ frames: n });
    } catch (err) {
      api.recordDone({ error: String((err && err.stack) || err) });
    }
  }

  api.onCommand((cmd) => {
    if (cmd.type === 'record') record(cmd);
    else if (cmd.type === 'intro') play(cmd);
    else if (cmd.type === 'skip') skip = true;
  });
})();
