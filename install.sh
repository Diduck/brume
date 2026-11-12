#!/usr/bin/env bash
# Brume — installation en une ligne :
#   curl -fsSL https://raw.githubusercontent.com/Diduck/brume/main/install.sh | bash
#
# Télécharge la dernière version publiée sur GitHub, l'installe dans /Applications et la
# lance. (Téléchargée par curl, l'app n'est pas mise en « quarantaine » par macOS : pas
# besoin du clic droit → Ouvrir.)
set -euo pipefail

REPO="Diduck/brume"
APP="/Applications/Brume.app"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Brume ne fonctionne que sur macOS." >&2
  exit 1
fi
if [ "$(uname -m)" != "arm64" ]; then
  echo "Brume est construite pour les Mac Apple Silicon (M1 et suivants)." >&2
  exit 1
fi

echo "❄  Recherche de la dernière version de Brume…"
URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
  grep -o '"browser_download_url": *"[^"]*arm64\.zip"' | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')
if [ -z "$URL" ]; then
  echo "Impossible de trouver la version à télécharger." >&2
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
echo "❄  Téléchargement : $(basename "$URL")"
curl -fL --progress-bar "$URL" -o "$TMP/Brume.zip"
ditto -x -k "$TMP/Brume.zip" "$TMP"

# Une version déjà ouverte est fermée avant d'être remplacée.
if pgrep -x Brume >/dev/null; then
  echo "❄  Fermeture de la version ouverte…"
  osascript -e 'quit app "Brume"' >/dev/null 2>&1 || pkill -x Brume || true
  sleep 2
fi

echo "❄  Installation dans /Applications…"
if [ -w /Applications ]; then
  rm -rf "$APP"
  ditto "$TMP/Brume.app" "$APP"
else
  sudo rm -rf "$APP"
  sudo ditto "$TMP/Brume.app" "$APP"
fi
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

open "$APP"
echo "✅ Brume est installée : cherche le flocon dans la barre des menus."
