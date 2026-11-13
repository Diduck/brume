#!/usr/bin/env node
// Brume — version « officielle » : app et DMG signés avec un certificat Developer ID,
// puis notarisés par Apple. Le DMG s'ouvre alors sur n'importe quel Mac, sans alerte.
//
// À faire une fois sur le Mac qui publie :
//   1. Xcode → Réglages → Comptes → Gérer les certificats → + → Developer ID Application ;
//   2. xcrun notarytool store-credentials brume-notary --apple-id … --team-id …
//
// Puis : npm run dist (signé si le certificat et le profil sont là, ad hoc sinon).
// npm run dist:signed exige la signature (erreur si elle est impossible).
//
// `npm run build` (signature ad hoc) reste la voie de l'exercice : décompiler,
// modifier une phrase, recompiler. Une app modifiée perd la signature d'Apple.
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const PROFILE = process.env.BRUME_NOTARY_PROFILE || 'brume-notary';
const run = (cmd, args, env) => execFileSync(cmd, args, { stdio: 'inherit', cwd: root, env: { ...process.env, ...env } });

// Le certificat Developer ID Application (le premier trouvé, ou celui de BRUME_TEAM).
const ids = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
  .split('\n')
  .map((l) => (l.match(/"Developer ID Application: (.+)"/) || [])[1])
  .filter(Boolean)
  .filter((n) => !process.env.BRUME_TEAM || n.includes(`(${process.env.BRUME_TEAM})`));
const notaryOk = (() => {
  try {
    execFileSync('xcrun', ['notarytool', 'history', '--keychain-profile', PROFILE], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!ids.length || !notaryOk) {
  // Pas de certificat (ou pas d'accès à la notarisation) sur ce Mac : version ad hoc,
  // comme avant. Elle marche, mais s'ouvre par clic droit → Ouvrir chez les autres.
  console.warn(
    !ids.length
      ? '⚠ Aucun certificat « Developer ID Application » : DMG non signé (voir l’en-tête de ce fichier).'
      : `⚠ Profil de notarisation « ${PROFILE} » introuvable : DMG non signé (voir l’en-tête de ce fichier).`
  );
  if (process.env.BRUME_REQUIRE_SIGNED) process.exit(1);
  run('npm', ['run', 'build']);
  run('node', ['tools/make-installer.js']);
  process.exit(0);
}
const identity = ids[0];
const team = identity.match(/\(([A-Z0-9]{10})\)$/)[1];
console.log(`Signature avec : Developer ID Application: ${identity}`);

// 1. L'app : signée (Hardened Runtime), notarisée et agrafée par electron-builder.
run('npx', [
  'electron-builder', '--mac', 'dir', '--arm64',
  `-c.mac.identity=${identity}`,
  '-c.mac.hardenedRuntime=true',
  '-c.mac.entitlements=build/entitlements.mac.plist',
  '-c.mac.entitlementsInherit=build/entitlements.mac.plist',
  '-c.mac.notarize=true',
], { APPLE_KEYCHAIN_PROFILE: PROFILE, APPLE_TEAM_ID: team, CSC_IDENTITY_AUTO_DISCOVERY: 'true' });

const app = path.join(root, 'dist', 'mac-arm64', 'Brume.app');
run('codesign', ['--verify', '--deep', '--strict', app]);
run('xcrun', ['stapler', 'validate', app]);

// 2. Le zip et le DMG, à partir de l'app agrafée.
run('node', ['tools/make-installer.js'], { BRUME_SIGNED: '1' });

// 3. Le DMG lui-même : signé, notarisé, agrafé.
const dmg = path.join(root, 'dist', `Brume-${version}-arm64.dmg`);
run('codesign', ['--force', '--timestamp', '--sign', `Developer ID Application: ${identity}`, dmg]);
run('xcrun', ['notarytool', 'submit', dmg, '--keychain-profile', PROFILE, '--wait']);
run('xcrun', ['stapler', 'staple', dmg]);

// 4. Ce que Gatekeeper en pense, comme sur le Mac d'un inconnu.
run('spctl', ['--assess', '--type', 'execute', '-vv', app]);
run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '-vv', dmg]);
console.log(`\nPrêt : ${path.basename(dmg)} (signé et notarisé)`);
