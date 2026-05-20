#!/usr/bin/env bash
# Copie data-template/ → data/ pour les builds release (CI). N’écrase pas data-template/.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "${root}/data"
cp -R "${root}/data-template" "${root}/data"
echo "Données release préparées depuis data-template/ → data/"
