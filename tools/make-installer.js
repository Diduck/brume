#!/usr/bin/env node
// Brume — fabrique les fichiers d'installation à partir de l'app construite :
//   • dist/Brume-<version>-arm64.dmg : l'image disque classique (glisser Brume dans Applications) ;
//   • dist/Brume-<version>-arm64.zip : l'app compressée, utilisée par install.sh.
// À lancer après `npm run build` (c'est ce que fait `npm run dist`).
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const app = path.join(root, 'dist', 'mac-arm64', 'Brume.app');
if (!fs.existsSync(app)) {
  console.error(`Introuvable : ${app} (lance d'abord npm run build)`);
  process.exit(1);
}
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });

// 1. Le zip (ditto garde les liens, attributs et la signature de l'app).
const zip = path.join(root, 'dist', `Brume-${version}-arm64.zip`);
fs.rmSync(zip, { force: true });
run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);

// 2. Le DMG : un dossier avec l'app et un raccourci vers Applications.
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'brume-dmg-'));
run('ditto', [app, path.join(stage, 'Brume.app')]);
fs.symlinkSync('/Applications', path.join(stage, 'Applications'));
fs.writeFileSync(
  path.join(stage, 'Lis-moi.txt'),
  [
    'Brume — la météo vit sur ton écran',
    '',
    '1. Glisse Brume dans le dossier Applications.',
    ...(process.env.BRUME_SIGNED
      ? ['2. Brume est signée et vérifiée par Apple : double-clique pour l’ouvrir.']
      : [
          '2. Brume n’est pas signée par Apple (projet de lycée) : la première fois,',
          '   fais clic droit sur Brume → Ouvrir → Ouvrir.',
          '   Si macOS dit que l’app est « endommagée », lance dans le Terminal :',
          '   xattr -dr com.apple.quarantine /Applications/Brume.app',
        ]),
    '3. Brume vit dans la barre des menus (le flocon).',
    '',
    'Code source : https://github.com/Diduck/brume',
    '',
  ].join('\n')
);
const dmg = path.join(root, 'dist', `Brume-${version}-arm64.dmg`);
fs.rmSync(dmg, { force: true });
run('hdiutil', ['create', '-volname', 'Brume', '-srcfolder', stage, '-ov', '-format', 'UDZO', '-quiet', dmg]);
fs.rmSync(stage, { recursive: true, force: true });

for (const f of [zip, dmg]) console.log(`${path.basename(f)} : ${(fs.statSync(f).size / 1e6).toFixed(1)} Mo`);
