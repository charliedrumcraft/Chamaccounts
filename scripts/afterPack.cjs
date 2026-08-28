const { execFileSync } = require('child_process')
const path = require('path')

/** Signature ad-hoc : l’app n’est plus « non signée », la quarantaine peut ensuite être retirée. */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
}
