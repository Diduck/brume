#!/usr/bin/env bash
# ÉTAPE 1 — Décompiler Brume.app
#
# Une app Electron range tout son code (moteur, effets, interface, phrases) dans
# une archive Contents/Resources/app.asar. On copie l'app, puis on extrait
# l'archive : on récupère le code JavaScript lisible, à l'identique.
#
# Usage : ./1-decompiler.sh [chemin/vers/Brume.app]
set -euo pipefail
cd "$(dirname "$0")"

APP_SOURCE="${1:-../dist/mac-arm64/Brume.app}"
ASAR_TOOL=../node_modules/.bin/asar

if [ ! -d "$APP_SOURCE" ]; then
  echo "Introuvable : $APP_SOURCE (lance d'abord « npm run build » à la racine)"
  exit 1
fi

rm -rf travail
mkdir -p travail
cp -R "$APP_SOURCE" travail/Brume.app
ARCHIVE=travail/Brume.app/Contents/Resources/app.asar

echo "▸ Archive trouvée : $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
echo "▸ Contenu de l'archive :"
"$ASAR_TOOL" list "$ARCHIVE" | sed 's/^/    /'

"$ASAR_TOOL" extract "$ARCHIVE" travail/source
echo
echo "✓ Code source extrait dans exercice/travail/source"
echo "  Toutes les phrases de l'app sont dans : travail/source/src/shared/strings.js"
