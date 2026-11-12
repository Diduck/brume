// Brume — règle le fond d'écran macOS sur une vidéo « Aerial » (pour l'écran de
// verrouillage animé). Lancé par osascript -l JavaScript -e <ce script> '<json>' :
//   { "plist": "<chemin de Index.plist>", "assetID": "<UUID de la vidéo>" }
// Chaque entrée « Desktop » (tous les écrans, tous les bureaux) devient l'Aerial choisi ;
// l'écran de veille (« Idle ») aussi. Écrit le fichier puis affiche « ok ».
ObjC.import('Foundation');

function run(argv) {
  const args = JSON.parse(argv[0]);
  const url = $.NSURL.fileURLWithPath(args.plist);
  const data = $.NSData.dataWithContentsOfURL(url);
  const root = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(data, $.NSPropertyListMutableContainersAndLeaves, null, null);
  if (!root || root.isNil()) throw new Error('Index.plist illisible');

  // La configuration d'un Aerial : un petit plist binaire { assetID }.
  const conf = $.NSPropertyListSerialization.dataWithPropertyListFormatOptionsError($({ assetID: args.assetID }), $.NSPropertyListBinaryFormat_v1_0, 0, null);
  const empty = $.NSPropertyListSerialization.dataWithPropertyListFormatOptionsError($({ values: {} }), $.NSPropertyListBinaryFormat_v1_0, 0, null);

  function setAerial(entry) {
    const content = entry.objectForKey('Content');
    if (!content || content.isNil()) return;
    const choice = $.NSMutableDictionary.dictionary;
    choice.setObjectForKey(conf, 'Configuration');
    choice.setObjectForKey($.NSMutableArray.array, 'Files');
    choice.setObjectForKey('com.apple.wallpaper.choice.aerials', 'Provider');
    content.setObjectForKey($.NSMutableArray.arrayWithObject(choice), 'Choices');
    content.setObjectForKey(empty, 'EncodedOptionValues');
    entry.setObjectForKey($.NSDate.date, 'LastSet');
  }

  let n = 0;
  function walk(dict) {
    const keys = ObjC.deepUnwrap(dict.allKeys) || [];
    for (const k of keys) {
      const v = dict.objectForKey(k);
      if (!v || v.isNil() || !v.isKindOfClass($.NSDictionary)) continue;
      if (k === 'Desktop' || k === 'Idle') {
        setAerial(v);
        n++;
      } else walk(v);
    }
  }
  walk(root);

  const out = $.NSPropertyListSerialization.dataWithPropertyListFormatOptionsError(root, $.NSPropertyListBinaryFormat_v1_0, 0, null);
  if (!out.writeToURLAtomically(url, true)) throw new Error('écriture impossible');
  return `ok ${n}`;
}
