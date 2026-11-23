#!/usr/bin/env bash
# =============================================================================
# Vérifie qu'une composition est DÉTERMINISTE : la même image à l'instant t,
# qu'on y arrive en avançant, en reculant, ou dans une autre page.
#
#   bash scripts/determinisme.sh [dossier-projet] [instants]
#   bash scripts/determinisme.sh . 0,1.2,2.5,4.9
#
# Trois séries de snapshots : A (dans l'ordre), B (dans l'ordre, une autre
# page), C (à REBOURS : chaque seek recule, la scène est reconstruite et
# re-simulée). Les pixels sont comparés par empreinte (ffmpeg framemd5) ; une
# seule image différente → code de sortie 1.
#
# Ce qu'il attrape (vu) : un `to` GSAP qui lit son départ à un moment qui dépend
# de l'ordre des seeks ; un `Math.random()` ou un `Date` non figés dans une scène.
# =============================================================================
set -euo pipefail

PROJET="${1:-.}"
INSTANTS="${2:-0,1.2,2.5,4.9}"
SORTIE="$PROJET/snapshots/determinisme"
INVERSE="$(echo "$INSTANTS" | tr ',' '\n' | tail -r 2>/dev/null | paste -sd, - || echo "$INSTANTS" | tr ',' '\n' | tac | paste -sd, -)"

rm -rf "$SORTIE"
npx hyperframes snapshot "$PROJET" --at "$INSTANTS" --no-end --describe false -o "$SORTIE/a" >/dev/null
npx hyperframes snapshot "$PROJET" --at "$INSTANTS" --no-end --describe false -o "$SORTIE/b" >/dev/null
npx hyperframes snapshot "$PROJET" --at "$INVERSE" --no-end --describe false -o "$SORTIE/c-inverse" >/dev/null

empreinte() { ffmpeg -v error -i "$1" -f framemd5 -pix_fmt rgb24 - | tail -1 | awk '{print $NF}'; }

ECHEC=0
for t in $(echo "$INSTANTS" | tr ',' ' '); do
  A="$(empreinte "$(ls "$SORTIE"/a/*-at-"${t}"s.png)")"
  B="$(empreinte "$(ls "$SORTIE"/b/*-at-"${t}"s.png)")"
  C="$(empreinte "$(ls "$SORTIE"/c-inverse/*-at-"${t}"s.png)")"
  if [ "$A" = "$B" ] && [ "$A" = "$C" ]; then
    echo "✓ t = ${t} s : identiques ($A)"
  else
    echo "✗ t = ${t} s : DIFFÉRENTES — A $A · B $B · à rebours $C"
    ECHEC=1
  fi
done
echo "  Images : $SORTIE/{a,b,c-inverse}/"
exit $ECHEC
