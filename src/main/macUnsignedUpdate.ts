import { app } from 'electron';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tm } from './uiI18n';

const execFileAsync = promisify(execFile);

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Bundle .app de l’instance en cours (…/Chamaccounts.app). */
export function getRunningMacAppBundle(): string | null {
  if (process.platform !== 'darwin') return null;
  const bundle = path.resolve(process.execPath, '..', '..', '..');
  return bundle.endsWith('.app') ? bundle : null;
}

async function findAppBundle(dir: string): Promise<string | null> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const found = entries.find((entry) => entry.isDirectory() && entry.name.endsWith('.app'));
  return found ? path.join(dir, found.name) : null;
}

/**
 * Sans certificat Developer ID, Squirrel.Mac ne peut pas installer.
 * On extrait le zip, on quitte, on remplace le .app, puis on relance.
 */
export async function installMacUpdateFromZip(zipPath: string): Promise<void> {
  const destApp = getRunningMacAppBundle();
  if (!destApp) {
    throw new Error(tm('error.macBundleMissing'));
  }
  if (!existsSync(zipPath)) {
    throw new Error(tm('error.updateArchiveMissing'));
  }

  const staging = path.join(app.getPath('temp'), 'chamaccounts-update-stage');
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });
  await execFileAsync('ditto', ['-x', '-k', zipPath, staging]);

  const newApp = await findAppBundle(staging);
  if (!newApp) {
    throw new Error(tm('error.updateArchiveNoApp'));
  }

  const scriptPath = path.join(app.getPath('temp'), 'chamaccounts-apply-update.sh');
  const logFile = path.join(app.getPath('temp'), 'chamaccounts-update.log');
  const pid = process.pid;
  // Message du dialogue osascript (hors guillemets doubles pour AppleScript).
  const replaceFailedMessage = tm('update.macReplaceFailedDialog').replace(/"/g, "'");
  const script = `#!/bin/bash
set -uo pipefail
exec >> ${shQuote(logFile)} 2>&1
echo "waiting for pid ${pid}"
while kill -0 ${pid} 2>/dev/null; do sleep 0.2; done
sleep 0.4
echo "replacing ${destApp}"
if rm -rf ${shQuote(destApp)} && ditto ${shQuote(newApp)} ${shQuote(destApp)}; then
  xattr -dr com.apple.quarantine ${shQuote(destApp)} || true
  echo "launching"
  open ${shQuote(destApp)}
  rm -rf ${shQuote(staging)}
  rm -f ${shQuote(scriptPath)}
else
  echo "replace failed"
  open -R ${shQuote(newApp)}
  osascript -e ${shQuote(`display dialog "${replaceFailedMessage}" buttons {"OK"} default button 1`)} || true
fi
`;
  await fs.writeFile(scriptPath, script, { encoding: 'utf-8', mode: 0o755 });

  const child = spawn('/bin/bash', [scriptPath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  app.quit();
}
