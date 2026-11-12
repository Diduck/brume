#!/usr/bin/env node
// Recalcule l'empreinte d'intégrité de app.asar et la réécrit dans Info.plist.
//
// Electron peut vérifier au lancement que l'archive app.asar n'a pas été modifiée :
// il compare le SHA-256 de son en-tête à la valeur « ElectronAsarIntegrity » de
// Info.plist. Après une recompilation, il faut donc mettre cette empreinte à jour,
// sinon une app protégée (fusible EnableEmbeddedAsarIntegrityValidation) refuse de démarrer.
'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

async function main() {
  const app = process.argv[2];
  if (!app) throw new Error('Usage : node tools/asar-integrity.js chemin/vers/Brume.app');
  const asar = await import('@electron/asar');
  const archive = path.join(app, 'Contents', 'Resources', 'app.asar');
  const { headerString } = asar.getRawHeader(archive);
  const hash = crypto.createHash('sha256').update(headerString).digest('hex');
  const value = JSON.stringify({ 'Resources/app.asar': { algorithm: 'SHA256', hash } });
  execFileSync('plutil', ['-replace', 'ElectronAsarIntegrity', '-json', value, path.join(app, 'Contents', 'Info.plist')]);
  console.log(`Empreinte app.asar mise à jour : ${hash.slice(0, 16)}…`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
