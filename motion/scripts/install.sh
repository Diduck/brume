#!/usr/bin/env bash
# =============================================================================
# Prépare l'atelier HyperFrames de Brume en UNE commande.
#
#   bash motion/scripts/install.sh
#
# Les sources sont versionnées ; ce script ne recolle que ce qui ne l'est pas :
# dépendances npm, GSAP local, copie du moteur de Brume (assets/brume/).
#
# Il lance `npm install` (une fois, ~1 min) : un process node court, qui se
# termine tout seul. Aucun serveur n'est laissé derrière.
#
# IDEMPOTENT : relançable sans dégât (FORCE=1 pour réinstaller les dépendances).
# =============================================================================
set -euo pipefail

ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RACINE="$(cd "$ICI/.." && pwd)"

echo "▸ Atelier : $ICI"
echo "▸ Dépôt   : $RACINE"

# --- 0. Garde : le bon package.json ------------------------------------------
# Sans lui, `npm install` remonterait jusqu'au package.json de l'APP et
# installerait Electron et electron-builder dans le mauvais dossier.
PKG="$ICI/package.json"
if [ ! -f "$PKG" ] || ! grep -q '"name"[[:space:]]*:[[:space:]]*"brume-motion"' "$PKG"; then
  echo "✗ $PKG absent ou étranger (name ≠ brume-motion). On refuse d'installer." >&2
  echo "  Le restaurer : git checkout -- motion/" >&2
  exit 1
fi

# --- 1. Prérequis ------------------------------------------------------------
NODE_MAJ="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJ" -lt 22 ]; then
  echo "✗ HyperFrames exige Node ≥ 22 (trouvé : $(node -v 2>/dev/null || echo aucun))." >&2
  exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "✗ ffmpeg introuvable — HyperFrames l'utilise pour encoder (brew install ffmpeg)." >&2
  exit 1
fi
echo "✓ Node $NODE_MAJ, ffmpeg"

# --- 2. Dépendances ----------------------------------------------------------
# L'atelier a SON package.json : il ne touche pas aux dépendances de l'app.
cd "$ICI"
if [ -d node_modules ] && [ "${FORCE:-0}" != "1" ]; then
  echo "✓ node_modules présent — installation sautée (FORCE=1 pour forcer)"
else
  echo "▸ npm install …"
  npm install --no-audit --no-fund
fi

# --- 3. GSAP en local --------------------------------------------------------
# Les compositions chargent `assets/vendor/gsap.min.js`, pas un CDN : un rendu
# ne doit pas dépendre du réseau, et la version reste celle du package.json.
mkdir -p "$ICI/assets/vendor"
cp -f "$ICI/node_modules/gsap/dist/gsap.min.js" "$ICI/assets/vendor/gsap.min.js"
echo "✓ GSAP $(node -p "require('$ICI/node_modules/gsap/package.json').version") → assets/vendor/"

# --- 4. Le moteur de Brume ---------------------------------------------------
# Les scènes, palettes, phrases, icônes et la police Young Serif (OFL), copiées
# de ../src : HyperFrames n'embarque que le dossier du projet.
bash "$ICI/scripts/copie-brume.sh"

cat <<'FIN'

────────────────────────────────────────────────────────────────────────────
Atelier prêt.

  cd motion

  npm test                                         # le filet, sans navigateur
  npx hyperframes lint                             # contrat HyperFrames
  npx hyperframes snapshot --at 0,1.2,2.5,4.983 --no-end -o snapshots/index
                                                   # IMAGES FIXES : LA boucle de travail
  bash scripts/determinisme.sh . 0,1.2,2.5,4.9     # même image dans tous les ordres
  npm run render -- -o renders/exemple.mp4         # le rendu complet, 60 fps, 2 workers
  npm run brume                                    # après avoir modifié une scène dans src/

⚠ `render` et `snapshot` ouvrent un Chrome headless qu'ils referment eux-mêmes.
  `npx hyperframes preview` est un serveur PERSISTANT : le fermer après usage.
────────────────────────────────────────────────────────────────────────────
FIN
