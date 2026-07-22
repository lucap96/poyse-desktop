// Ad-hoc code-sign the macOS .app so Apple Silicon doesn't reject it as
// "damaged". Skipped when a real Developer ID cert is configured (CSC_LINK set) —
// electron-builder does the proper signing then, and we must not overwrite it.
// Without a paid cert we can't notarize, so users get a one-time "unidentified
// developer" prompt; with the cert + Apple creds in CI, the build is fully signed.
const { execSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.CSC_LINK) return // real signing identity present → don't ad-hoc over it
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execSync(`codesign --deep --force --sign - ${JSON.stringify(appPath)}`, { stdio: 'inherit' })
  console.log(`ad-hoc signed: ${appPath}`)
}
