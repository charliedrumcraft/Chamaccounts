/**
 * Résout la racine des données pour les scripts CLI.
 * Priorité : --data-root <chemin> > CHAMACCOUNTS_DATA_ROOT > profiles.json > ../data (dev legacy)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function userDataDir() {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'chamaccounts');
    case 'win32':
      return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'chamaccounts');
    default:
      return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'chamaccounts');
  }
}

function readActiveDataRootFromConfig() {
  const configPath = path.join(userDataDir(), 'profiles.json');
  if (!fs.existsSync(configPath)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const profile = config.profiles?.find((p) => p.id === config.activeProfileId);
    if (profile?.dataRoot && fs.existsSync(profile.dataRoot)) {
      return path.resolve(profile.dataRoot);
    }
  } catch {
    return null;
  }
  return null;
}

function resolveDataRoot(repoRoot) {
  const argIdx = process.argv.indexOf('--data-root');
  if (argIdx >= 0 && process.argv[argIdx + 1]) {
    return path.resolve(process.argv[argIdx + 1]);
  }
  if (process.env.CHAMACCOUNTS_DATA_ROOT) {
    return path.resolve(process.env.CHAMACCOUNTS_DATA_ROOT);
  }
  const fromConfig = readActiveDataRootFromConfig();
  if (fromConfig) return fromConfig;
  const legacy = path.join(repoRoot, 'data');
  if (fs.existsSync(legacy)) return legacy;
  throw new Error(
    'Racine des données introuvable. Utilisez --data-root <chemin> ou CHAMACCOUNTS_DATA_ROOT.'
  );
}

module.exports = { resolveDataRoot, userDataDir };
