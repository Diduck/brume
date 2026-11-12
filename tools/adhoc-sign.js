#!/usr/bin/env node
// Signature « ad hoc » (sans certificat Apple) de l'app construite, pour qu'elle se
// lance sur ce Mac. Utilisé après electron-builder et après chaque recompilation.
'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const app = process.argv[2] || path.join(__dirname, '..', 'dist', 'mac-arm64', 'Brume.app');
if (!fs.existsSync(app)) {
  console.error(`Introuvable : ${app}`);
  process.exit(1);
}
execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
console.log(`Signé (ad hoc) : ${app}`);
