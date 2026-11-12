// Brume — traqueur de fenêtres (JavaScript for Automation, exécuté par /usr/bin/osascript).
//
// Interroge CoreGraphics pour connaître la position de toutes les fenêtres visibles,
// de la plus en avant à la plus en arrière, et écrit sur stderr une ligne
//   W {"w":[[id,x,y,w,h],...],"closed":[id,...],"back":true}
// "back" indique si la fenêtre météo de Brume est bien derrière toutes les autres.
// • Rythme adaptatif : ~80 fois/s quand quelque chose bouge (et on renvoie la liste
//   à chaque passage pour que le moteur mesure vitesses et accélérations), ~16 fois/s
//   au repos (économie d'énergie).
// • Une fenêtre qui disparaît est-elle fermée, ou juste sur un autre bureau / réduite ?
//   On interroge macOS pour cette fenêtre précise : si elle existe encore, sa neige
//   est conservée ; sinon elle est signalée dans "closed" et sa neige tombe.
// Seules les positions sont lues : aucun titre, aucun contenu, aucune autorisation.
ObjC.import('CoreGraphics');
ObjC.import('AppKit');
ObjC.import('stdlib');

var PARENT_PID = __PARENT_PID__;
var FAST = __FAST__;
var SLOW = __SLOW__;
var ACTIVE_MS = 700;
var ON_SCREEN_ONLY = 1;
var INCLUDING_WINDOW = 8;
var EXCLUDE_DESKTOP = 16;

var last = '';
var lastIds = {};
var lastChange = 0;
var tick = 0;

function parentAlive() {
  var app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(PARENT_PID);
  return !app.isNil() && !app.terminated;
}

function stillExists(id) {
  return ObjC.castRefToObject($.CGWindowListCopyWindowInfo(INCLUDING_WINDOW, id)).count > 0;
}

while (true) {
  if (tick++ % 60 === 0 && !parentAlive()) $.exit(0);

  var list = ObjC.castRefToObject($.CGWindowListCopyWindowInfo(ON_SCREEN_ONLY | EXCLUDE_DESKTOP, 0));
  var n = list.count;
  var out = [];
  var ids = {};
  var seenSelf = false; // a-t-on déjà croisé la fenêtre météo de Brume ?
  var notBack = false; // une fenêtre d'une autre app est-elle DERRIÈRE la météo ?
  for (var i = 0; i < n; i++) {
    var w = list.objectAtIndex(i);
    if (w.objectForKey('kCGWindowLayer').js !== 0) continue;
    // Les couches de Brume (météo, interface, ouverture, fond) ne sont jamais au niveau 0 :
    // la seule fenêtre de Brume ici est sa fenêtre de réglages, une vraie fenêtre comme les
    // autres. Elle est suivie aussi : la neige s'y pose au lieu de tomber devant.
    if (w.objectForKey('kCGWindowOwnerPID').js === PARENT_PID) seenSelf = true;
    var alpha = w.objectForKey('kCGWindowAlpha');
    if (!alpha.isNil() && alpha.js < 0.05) continue;
    if (seenSelf) notBack = true;
    var b = w.objectForKey('kCGWindowBounds');
    var bw = b.objectForKey('Width').js;
    var bh = b.objectForKey('Height').js;
    if (bw < 80 || bh < 40) continue;
    var id = w.objectForKey('kCGWindowNumber').js;
    ids[id] = true;
    out.push([id, Math.round(b.objectForKey('X').js), Math.round(b.objectForKey('Y').js), Math.round(bw), Math.round(bh)]);
  }

  var closed = [];
  for (var key in lastIds) {
    if (!ids[key] && !stillExists(Number(key))) closed.push(Number(key));
  }
  lastIds = ids;

  var s = JSON.stringify(out) + (notBack ? '!' : '');
  var now = Date.now();
  if (s !== last || closed.length) {
    lastChange = now;
    last = s;
    console.log('W ' + JSON.stringify({ w: out, closed: closed, back: !notBack }));
  } else if (now - lastChange < ACTIVE_MS) {
    console.log('W ' + JSON.stringify({ w: out, closed: [], back: !notBack }));
  }
  delay(now - lastChange < ACTIVE_MS ? FAST : SLOW);
}
