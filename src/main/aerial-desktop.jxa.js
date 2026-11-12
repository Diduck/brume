// Brume — règle le fond d'écran macOS de TOUS les bureaux et écrans d'un coup.
// Lancé par osascript -l JavaScript -e <ce script> '<json>' :
//   { "plist": "<Index.plist>", "assetID": "<UUID>" }  → la vidéo « Aerial » (écran verrouillé)
//   { "plist": "<Index.plist>", "image": "<chemin PNG>" } → une image (le bureau normal)
// Avec une vidéo, l'écran de veille (« Idle ») la joue aussi. Écrit le fichier, affiche « ok ».
ObjC.import('Foundation');

function run(argv) {
  const args = JSON.parse(argv[0]);
  const url = $.NSURL.fileURLWithPath(args.plist);
  const data = $.NSData.dataWithContentsOfURL(url);
  const root = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(data, $.NSPropertyListMutableContainersAndLeaves, null, null);
  if (!root || root.isNil()) throw new Error('Index.plist illisible');

  // La configuration d'un choix : un petit plist binaire.
  const bplist = (o) => $.NSPropertyListSerialization.dataWithPropertyListFormatOptionsError($(o), $.NSPropertyListBinaryFormat_v1_0, 0, null);
  const image = !!args.image;
  const conf = image
    ? bplist({ type: 'imageFile', url: { relative: ObjC.unwrap($.NSURL.fileURLWithPath(args.image).absoluteString) } })
    : bplist({ assetID: args.assetID });
  const provider = image ? 'com.apple.wallpaper.choice.image' : 'com.apple.wallpaper.choice.aerials';
  const empty = bplist({ values: {} });

  function setChoice(entry) {
    const content = entry.objectForKey('Content');
    if (!content || content.isNil()) return;
    const choice = $.NSMutableDictionary.dictionary;
    choice.setObjectForKey(conf, 'Configuration');
    choice.setObjectForKey($.NSMutableArray.array, 'Files');
    choice.setObjectForKey(provider, 'Provider');
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
      if (k === 'Desktop' || (k === 'Idle' && !image)) {
        setChoice(v);
        n++;
      } else if (k !== 'Idle') walk(v);
    }
  }
  walk(root);

  const out = $.NSPropertyListSerialization.dataWithPropertyListFormatOptionsError(root, $.NSPropertyListBinaryFormat_v1_0, 0, null);
  if (!out.writeToURLAtomically(url, true)) throw new Error('écriture impossible');
  return `ok ${n}`;
}
