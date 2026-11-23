#!/usr/bin/env bash
# =============================================================================
# Recopie le moteur de Brume dans l'atelier : motion/assets/brume/ (ignoré par git).
#
#   bash motion/scripts/copie-brume.sh      (ou : cd motion && npm run brume)
#
# POURQUOI UNE COPIE, et pas `../src/…` : HyperFrames sert et embarque le DOSSIER
# du projet (motion/). Un fichier hors de ce dossier n'existe pas pour le rendu —
# la scène ne se chargerait pas, sans autre message qu'une toile vide.
#
# ⚠ À relancer après toute modification d'une scène dans src/ : la vidéo montre
# sinon l'ANCIENNE version de la scène. install.sh l'appelle à chaque fois.
#
# Ne copie que des fichiers du dépôt (le code des scènes, les palettes, les
# phrases, la police libre Young Serif et sa licence OFL). Rien n'est modifié
# dans src/.
# =============================================================================
set -euo pipefail

ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$(cd "$ICI/.." && pwd)/src"
DEST="$ICI/assets/brume"

if [ ! -f "$SRC/renderer/pixel/pixel.js" ]; then
  echo "✗ $SRC/renderer/pixel/pixel.js introuvable : l'atelier doit vivre dans Brume/motion/." >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST/shared" "$DEST/renderer/pixel" "$DEST/renderer/ui" "$DEST/renderer/fonts"

# Même arborescence que src/ : un chemin lu dans wallpaper.html ou intro.html se
# retrouve tel quel sous assets/brume/.
cp -f "$SRC/shared/palettes.js" "$SRC/shared/strings.js" "$DEST/shared/"
cp -f "$SRC/renderer/pixel/"*.js "$DEST/renderer/pixel/"
cp -f "$SRC/renderer/intro-multiplane.js" "$DEST/renderer/"
cp -f "$SRC/renderer/ui/icons.js" "$DEST/renderer/ui/"
cp -f "$SRC/renderer/fonts/YoungSerif-Regular.woff2" "$SRC/renderer/fonts/OFL.txt" "$DEST/renderer/fonts/"

N="$(ls "$DEST/renderer/pixel/"*.js | wc -l | tr -d ' ')"
echo "✓ Moteur de Brume copié dans assets/brume/ ($N fichiers de scènes, palettes, phrases, Young Serif)"
