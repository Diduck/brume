// Brume — lit ou change le fond d'écran macOS de chaque écran (NSWorkspace).
//   osascript -l JavaScript - get
//   osascript -l JavaScript - set '{"<id écran>": "/chemin/image.png"}'
// Aucune autorisation nécessaire. Renvoie du JSON : { "<id écran>": chemin ou réussite }.
ObjC.import('AppKit');

function run(argv) {
  var ws = $.NSWorkspace.sharedWorkspace;
  var screens = $.NSScreen.screens;
  var map = argv[0] === 'set' ? JSON.parse(argv[1]) : null;
  var out = {};
  for (var i = 0; i < screens.count; i++) {
    var screen = screens.objectAtIndex(i);
    var id = String(screen.deviceDescription.objectForKey('NSScreenNumber').js);
    if (argv[0] === 'get') {
      var url = ws.desktopImageURLForScreen(screen);
      out[id] = url.isNil() ? null : url.path.js;
    } else if (map && map[id]) {
      out[id] = ws.setDesktopImageURLForScreenOptionsError($.NSURL.fileURLWithPath(map[id]), screen, $({}), null);
    }
  }
  return JSON.stringify(out);
}
