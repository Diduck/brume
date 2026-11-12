'use strict';
// Lance le script JXA du traqueur et transmet chaque liste de fenêtres reçue.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

class WindowTracker {
  constructor(onUpdate, { fast = 0.012, slow = 0.06 } = {}) {
    this.onUpdate = onUpdate;
    this.fast = fast;
    this.slow = slow;
    this.proc = null;
    this.stopped = false;
    this.restarts = 0;
  }

  start() {
    this.stopped = false;
    // fs lit dans l'archive app.asar ; le script est ensuite envoyé à osascript par stdin.
    const source = fs
      .readFileSync(path.join(__dirname, 'window-tracker.jxa.js'), 'utf8')
      .replace('__PARENT_PID__', String(process.pid))
      .replace('__FAST__', String(this.fast))
      .replace('__SLOW__', String(this.slow));

    const proc = spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-'], { stdio: ['pipe', 'ignore', 'pipe'] });
    this.proc = proc;
    proc.stdin.end(source);

    let buffer = '';
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('W ')) continue;
        try {
          this.onUpdate(JSON.parse(line.slice(2)));
          this.restarts = 0;
        } catch {
          /* ligne incomplète : ignorée */
        }
      }
    });

    proc.on('exit', () => {
      if (this.proc === proc) this.proc = null;
      if (this.stopped || this.restarts > 5) return;
      this.restarts += 1;
      setTimeout(() => !this.stopped && this.start(), 1500 * this.restarts);
    });
  }

  stop() {
    this.stopped = true;
    if (this.proc) this.proc.kill();
    this.proc = null;
  }
}

module.exports = { WindowTracker };
