#!/usr/bin/env bash
# ÉTAPE 2 — Modifier n'importe quelle phrase (aucune contrainte de longueur)
#
# Remplace un texte par un autre dans tout le code extrait à l'étape 1.
# Tu peux aussi simplement ouvrir travail/source/src/shared/strings.js et éditer.
#
# Usage : ./2-modifier-phrase.sh "texte actuel" "nouveau texte"
# Exemple : ./2-modifier-phrase.sh "Ta météo, ton décor." \
#                                  "Ta météo, ton décor — et c’est moi qui l’ai décompilée !"
set -euo pipefail
cd "$(dirname "$0")"

if [ $# -ne 2 ]; then
  echo 'Usage : ./2-modifier-phrase.sh "texte actuel" "nouveau texte"'
  exit 1
fi
if [ ! -d travail/source ]; then
  echo "Lance d'abord ./1-decompiler.sh"
  exit 1
fi

node - "$1" "$2" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [from, to] = process.argv.slice(2);
const root = path.join('travail', 'source', 'src');
let total = 0;
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(js|html|css)$/.test(entry.name)) {
      const text = fs.readFileSync(file, 'utf8');
      const count = text.split(from).length - 1;
      if (!count) continue;
      fs.writeFileSync(file, text.split(from).join(to));
      total += count;
      console.log(`  ✎ ${path.relative('travail/source', file)} : ${count} remplacement(s)`);
    }
  }
})(root);
if (!total) {
  console.error(`Texte introuvable : « ${from} »`);
  process.exit(1);
}
console.log(`✓ ${total} remplacement(s). Ancienne longueur ${from.length} → nouvelle longueur ${to.length} caractères.`);
NODE
