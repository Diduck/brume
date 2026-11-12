#!/usr/bin/env bash
# ÉTAPE 3 — Recompiler et relancer
#
# 1. reconstruit l'archive app.asar à partir du code modifié ;
# 2. recalcule son empreinte d'intégrité dans Info.plist ;
# 3. re-signe l'app (la signature d'origine ne correspond plus au contenu) ;
# 4. quitte Brume s'il tourne et lance la version modifiée.
set -euo pipefail
cd "$(dirname "$0")"

APP=travail/Brume.app
ARCHIVE="$APP/Contents/Resources/app.asar"

if [ ! -d travail/source ]; then
  echo "Lance d'abord ./1-decompiler.sh puis ./2-modifier-phrase.sh"
  exit 1
fi

echo "▸ Reconstruction de app.asar"
../node_modules/.bin/asar pack travail/source "$ARCHIVE"
echo "▸ Empreinte d'intégrité"
node ../tools/asar-integrity.js "$APP"
echo "▸ Signature"
node ../tools/adhoc-sign.js "$APP"

echo "▸ Lancement de la version modifiée"
pkill -x Brume 2>/dev/null || true
pkill -f "Brume/node_modules/electron/dist/Electron.app" 2>/dev/null || true
# Brume n'autorise qu'une instance : on attend que l'ancienne soit vraiment fermée.
for _ in $(seq 1 50); do
  pgrep -x Brume >/dev/null || pgrep -f "Brume/node_modules/electron/dist/Electron.app" >/dev/null || break
  sleep 0.2
done
sleep 0.5
open "$APP"
echo "✓ Brume modifiée est lancée. Affiche la carte d'accueil depuis le flocon de la barre des menus."
