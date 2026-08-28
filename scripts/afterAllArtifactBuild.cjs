const { addUnquarantineHelperToMacZips } = require('./add-mac-zip-unquarantine.cjs')

/** electron-builder : après les artefacts, avant / autour de la publication. */
module.exports = async function afterAllArtifactBuild(buildResult) {
  if (process.platform !== 'darwin') return
  const zips = (buildResult.artifactPaths || []).filter(
    (p) => typeof p === 'string' && p.endsWith('.zip') && p.includes('-mac-')
  )
  addUnquarantineHelperToMacZips(zips)
}
