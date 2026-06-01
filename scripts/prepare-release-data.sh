#!/usr/bin/env bash
# Vérifie que data-template/ est prêt pour le build (plus de copie vers data/ dans le repo).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
template="${root}/data-template"
if [[ ! -d "${template}" ]]; then
  echo "Erreur : data-template/ introuvable." >&2
  exit 1
fi
echo "data-template/ prêt pour l’empaquetage (aucun dossier data/ dans le dépôt)."
