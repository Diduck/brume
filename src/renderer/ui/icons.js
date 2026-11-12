// Brume — jeu d'icônes dessinées à la main (grille 24 × 24, trait 1,6, bouts arrondis).
// Une seule famille cohérente pour toute l'interface, à la place des emojis.
(function () {
  'use strict';
  const B = (window.Brume = window.Brume || {});

  const arm = '<path d="M12 2.6v18.8M9.7 4.7 12 7l2.3-2.3M9.7 19.3 12 17l2.3 2.3"/>';
  const cloud = '<path d="M7.6 14.2h9a3.6 3.6 0 0 0 .3-7.2 5.1 5.1 0 0 0-9.8 1.5 2.9 2.9 0 0 0 .5 5.7z"/>';
  const petal = '<path d="M12 10.3c-1.7-1.3-2.3-3.6-1-5.4.4-.6 1-.7 1-.7s.6.1 1 .7c1.3 1.8.7 4.1-1 5.4z"/>';

  const ICONS = {
    snow: `${arm}<g transform="rotate(60 12 12)">${arm}</g><g transform="rotate(120 12 12)">${arm}</g>`,
    none: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v2.3M12 18.9v2.3M2.8 12h2.3M18.9 12h2.3M5.5 5.5l1.6 1.6M16.9 16.9l1.6 1.6M5.5 18.5l1.6-1.6M16.9 7.1l1.6-1.6"/>',
    rain: `${cloud}<path d="M9 17.2l-1 3M13 17.2l-1 3M17 17.2l-1 3"/>`,
    storm: `${cloud}<path d="M12.6 15.2l-2.1 3.4h3.1l-2.1 3.4"/>`,
    sakura: `<circle cx="12" cy="12" r="1.4"/>${[0, 72, 144, 216, 288].map((a) => `<g transform="rotate(${a} 12 12)">${petal}</g>`).join('')}`,
    leaves: '<path d="M5 19c0-8.2 5-14 14-14 0 9-5.8 14-14 14z"/><path d="M5 19 14.6 9.4M9.2 14.8h3.6M11.9 12.1V8.7"/>',
    fireflies: '<circle cx="13" cy="15.5" r="1.7"/><circle cx="7.2" cy="8.4" r="1.1"/><circle cx="17.4" cy="6.6" r="0.9"/><path d="M13 10.6v1.4M13 19v1.4M8.1 15.5h1.4M16.5 15.5h1.4"/>',
    starfall: '<path d="M16.5 3.8l1 2.7 2.7 1-2.7 1-1 2.7-1-2.7-2.7-1 2.7-1z"/><path d="M4 20l7.4-7.4M3.6 15.2l4.2-4.2M8.8 20.4l2.8-2.8"/>',
    aurora: '<path d="M3 8.5c3-3 6 3 9 0s6 3 9 0M3 12.5c3-3 6 3 9 0s6 3 9 0M3 16.5c3-3 6 3 9 0s6 3 9 0"/>',
    shake: '<path d="M6.5 8.5h11a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18v-8a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M5.5 8.4c.8-1.5 2-1.5 2.8 0 .8-1.5 2-1.5 2.8 0 .8-1.5 2-1.5 2.8 0 .8-1.5 2-1.5 2.8 0M2 11.5v4.5M22 11.5v4.5"/>',
    roll: '<circle cx="9.5" cy="13" r="5"/><path d="M8 10.5c1.4-.6 3 .1 3.5 1.4M3 18.5h3M15.5 18.5h6M19 16l2.5 2.5L19 21"/>',
    stack: '<circle cx="12" cy="15.6" r="4.4"/><circle cx="12" cy="8" r="3"/><path d="M14.3 8.2h2.6M12 3.2v1.6"/>',
    // Fenêtre de réglages.
    weather: `${cloud}<path d="M9 18.4v.01M12.5 19.6v.01M16 18.4v.01" stroke-width="2.2"/>`,
    scene: '<rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.4"/><path d="M3.6 16.4l5-4.6 3.6 3.2 2.6-2.2 5.6 4.8"/><circle cx="15.6" cy="9" r="1.5"/>',
    noscene: '<rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.4"/><path d="M5 18 19 6"/>',
    auto: '<path d="M19.4 12a7.4 7.4 0 0 1-12.8 5M4.6 12a7.4 7.4 0 0 1 12.8-5"/><path d="M17.6 3.6v3.6H14M6.4 20.4v-3.6H10"/>',
    chevron: '<path d="M7 9.5l5 5 5-5"/>',
    play: '<path d="M8.2 5.6v12.8a.8.8 0 0 0 1.2.7l10.2-6.4a.8.8 0 0 0 0-1.4L9.4 4.9a.8.8 0 0 0-1.2.7z"/>',
  };

  B.icon = function icon(name, cls) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', `icon${cls ? ` ${cls}` : ''}`);
    svg.innerHTML = ICONS[name] || ''; // balisage constant, défini ci-dessus
    return svg;
  };
})();
