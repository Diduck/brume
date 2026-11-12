// Brume — transforme n'importe quel fichier en image PNG carrée (ou à ses proportions).
// Lancé par osascript -l JavaScript -e <ce script> '{"src": "...", "out": "...", "size": 1024}'.
//  • une image que macOS sait lire (PNG, JPEG, HEIC, TIFF, PDF, SVG…) : l'image elle-même ;
//  • une application (ou tout autre fichier) : son icône, comme dans le Finder.
// Affiche « ok <largeur> <hauteur> ».
ObjC.import('AppKit');

// L'icône d'origine d'une app, en couleurs (le fichier .icns de l'app), même si le Mac
// affiche ses icônes en version « claire » ou teintée.
function appIcon(src) {
  const bundle = $.NSBundle.bundleWithPath(src);
  if (!bundle || bundle.isNil()) return null;
  const info = bundle.infoDictionary;
  const name = info && !info.isNil() ? ObjC.unwrap(info.objectForKey('CFBundleIconFile')) : null;
  if (!name) return null;
  const file = bundle.pathForResourceOfType(String(name).replace(/\.icns$/i, ''), 'icns');
  if (!file || file.isNil()) return null;
  return $.NSImage.alloc.initWithContentsOfFile(file);
}

function run(argv) {
  const args = JSON.parse(argv[0]);
  const size = args.size || 1024;
  const isApp = /\.app\/?$/i.test(args.src);
  let img = isApp ? appIcon(args.src) : $.NSImage.alloc.initWithContentsOfFile(args.src);
  if (!img || img.isNil() || img.size.width < 1) img = $.NSWorkspace.sharedWorkspace.iconForFile(args.src);
  if (!img || img.isNil()) throw new Error('fichier illisible');

  // Taille de sortie : les proportions de l'image, au plus `size` de côté.
  const iw = img.size.width;
  const ih = img.size.height;
  const k = isApp ? size / Math.max(iw, ih) : Math.min(1, size / Math.max(iw, ih)) || 1;
  // Une petite image (une icône 64 px…) est quand même agrandie : on garde au moins 256 px.
  const scale = Math.max(k, 256 / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * scale));
  const h = Math.max(1, Math.round(ih * scale));

  const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
    null, w, h, 8, 4, true, false, $.NSCalibratedRGBColorSpace, 0, 0
  );
  rep.size = $.NSMakeSize(w, h);
  $.NSGraphicsContext.saveGraphicsState;
  const ctx = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep);
  $.NSGraphicsContext.setCurrentContext(ctx);
  ctx.setImageInterpolation($.NSImageInterpolationHigh);
  img.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, w, h), $.NSZeroRect, $.NSCompositingOperationCopy, 1);
  $.NSGraphicsContext.restoreGraphicsState;

  const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
  if (!png.writeToFileAtomically(args.out, true)) throw new Error('écriture impossible');
  return `ok ${w} ${h}`;
}
