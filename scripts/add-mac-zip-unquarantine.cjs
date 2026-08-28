/**
 * Ajoute « Ouvrir Chamaccounts.command » à la racine des zip Mac.
 * Le script retire com.apple.quarantine puis lance l’app (pas de Developer ID).
 */
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const COMMAND_NAME = 'Ouvrir Chamaccounts.command'

const SCRIPT = `#!/bin/bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/Chamaccounts.app"
if [[ ! -d "$APP" ]]; then
  osascript -e 'display dialog "Chamaccounts.app introuvable dans ce dossier. Décompressez le zip et lancez ce fichier à côté de l’application." buttons {"OK"} default button 1 with icon stop' || true
  exit 1
fi
xattr -cr "$APP" 2>/dev/null || true
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
open "$APP"
`

function zipHasCommand(zipPath) {
  try {
    const listing = execFileSync('zipinfo', ['-1', zipPath], { encoding: 'utf8' })
    return listing.split(/\r?\n/).some((line) => line === COMMAND_NAME || line.endsWith(`/${COMMAND_NAME}`))
  } catch {
    return false
  }
}

function addHelperToZip(zipPath) {
  if (!zipPath.endsWith('.zip') || !fs.existsSync(zipPath)) return false
  if (zipHasCommand(zipPath)) return false

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cham-unq-'))
  try {
    const cmdPath = path.join(tmp, COMMAND_NAME)
    fs.writeFileSync(cmdPath, SCRIPT, { encoding: 'utf8', mode: 0o755 })
    execFileSync('zip', ['-u', zipPath, COMMAND_NAME], { cwd: tmp, stdio: 'inherit' })
    return true
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

function addUnquarantineHelperToMacZips(zipPaths) {
  const added = []
  for (const zipPath of zipPaths) {
    if (addHelperToZip(zipPath)) added.push(zipPath)
  }
  return added
}

module.exports = {
  COMMAND_NAME,
  addHelperToZip,
  addUnquarantineHelperToMacZips,
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const zips =
    args.length > 0
      ? args
      : fs
          .readdirSync(path.join(__dirname, '..', 'release'))
          .filter((name) => name.includes('-mac-') && name.endsWith('.zip'))
          .map((name) => path.join(__dirname, '..', 'release', name))
  const added = addUnquarantineHelperToMacZips(zips)
  console.log(added.length ? `Helper ajouté : ${added.join(', ')}` : 'Aucun zip Mac à modifier.')
}
