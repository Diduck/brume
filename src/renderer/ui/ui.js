// Brume — couche interface (au-dessus de tout, traversée par la souris) :
// notifications et statistiques. La carte de réglages vit dans sa propre fenêtre
// (settings.html, ui/panel.js).
// Tout le texte vient de src/shared/strings.js (aucune phrase n'est écrite ici).
(function () {
  'use strict';
  const B = (window.Brume = window.Brume || {});
  const S = window.BRUME_STRINGS;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  class UI {
    constructor(root) {
      this.root = root;
      this.toastEl = el('div', 'toast');
      this.toastEl.setAttribute('role', 'status');
      this.toastTimer = null;
      this.statsEl = el('div', 'stats');
      this.statsEl.hidden = true;
      root.append(this.toastEl, this.statsEl);
    }

    setDisplay(d) {
      this.root.style.setProperty('--work-top', `${d.workTop}px`);
      this.root.style.setProperty('--ground-gap', `${Math.max(0, d.height - d.groundY)}px`);
    }

    setSettings(s) {
      this.statsEl.hidden = !s.stats;
    }

    /* ---------- Notifications ---------- */

    toast(text) {
      this.toastEl.textContent = text;
      this.toastEl.classList.add('show');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 3600);
    }

    /* ---------- Statistiques ---------- */

    updateStats(s) {
      const L = S.stats;
      const rows = [
        [Math.round(s.fps), L.fps],
        [`${s.work.toFixed(1)} ms`, L.frame],
        [s.particles, L.particles],
        [s.columns, L.piles],
        [s.windows, L.windows],
        [s.balls, L.balls],
        [`${Math.round(s.quality * 100)} %`, L.quality],
        [s.draws, L.draws],
      ];
      this.statsEl.replaceChildren(
        ...rows.map(([v, label]) => {
          const row = el('div', 'row');
          row.append(el('span', 'v', String(v)), el('span', 'l', label));
          return row;
        })
      );
    }
  }

  B.UI = UI;
})();
