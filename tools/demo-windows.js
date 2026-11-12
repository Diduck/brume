// Brume — fenêtres de démonstration (lancées dans un processus séparé).
// Ouvre deux fenêtres, laisse la neige s'y poser, puis secoue la première pour
// faire tomber sa neige sur la seconde, et enfin la ferme.
//   env -u ELECTRON_RUN_AS_NODE npx electron tools/demo-windows.js
'use strict';
const { app, BrowserWindow, screen } = require('electron');

const page = (title, color) =>
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(`<body style="margin:0;font:600 22px -apple-system;display:grid;place-items:center;height:100vh;background:${color};color:#1b2230">${title}</body>`);

app.whenReady().then(() => {
  const { workArea } = screen.getPrimaryDisplay();
  const make = (x, y, w, h, title, color) => {
    const win = new BrowserWindow({ x: workArea.x + x, y: workArea.y + y, width: w, height: h, title });
    win.loadURL(page(title, color));
    return win;
  };
  const a = make(260, 240, 760, 420, 'Fenêtre A — je vais être secouée', '#f4f6fa');
  const b = make(900, 560, 900, 480, 'Fenêtre B — je récupère la neige', '#e9eef7');

  const holdMs = Number(process.env.DEMO_HOLD || 25000);
  setTimeout(() => {
    // Secousse : allers-retours rapides de ±120 px.
    const [x0, y0] = a.getPosition();
    let k = 0;
    const timer = setInterval(() => {
      k++;
      a.setPosition(x0 + (k % 2 ? 120 : -120), y0 + (k % 2 ? -20 : 20));
      if (k > 10) {
        clearInterval(timer);
        a.setPosition(x0, y0);
      }
    }, 40);
  }, holdMs);
  setTimeout(() => a.close(), holdMs + 6000);
  setTimeout(() => app.quit(), holdMs + 20000);
});
