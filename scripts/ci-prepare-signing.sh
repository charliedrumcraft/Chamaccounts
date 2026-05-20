#!/usr/bin/env bash
# Décode les certificats base64 (secrets GitHub) pour electron-builder.
# Sans secrets, le build continue non signé.
set -euo pipefail

if [[ -n "${MAC_CERTIFICATE_BASE64:-}" ]]; then
  CERT_PATH="${RUNNER_TEMP:-/tmp}/chamaccounts-mac.p12"
  echo "$MAC_CERTIFICATE_BASE64" | base64 --decode > "$CERT_PATH"
  echo "CSC_LINK=$CERT_PATH" >> "${GITHUB_ENV:-/dev/null}"
  echo "Certificat Mac décodé."
fi

if [[ -n "${WIN_CERTIFICATE_BASE64:-}" ]]; then
  WIN_PATH="${RUNNER_TEMP:-/tmp}/chamaccounts-win.pfx"
  echo "$WIN_CERTIFICATE_BASE64" | base64 --decode > "$WIN_PATH"
  echo "WIN_CSC_LINK=$WIN_PATH" >> "${GITHUB_ENV:-/dev/null}"
  echo "Certificat Windows décodé."
fi
