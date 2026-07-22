// Ad-hoc code-sign the macOS .app. Apple Silicon refuses to launch an unsigned
// arm64 app ("… is damaged and can't be opened"); an ad-hoc signature makes it
// launchable. Without a paid Developer ID we can't notarize, so users still get
// a one-time "unidentified developer" prompt (right-click → Open, or System
// Settings → Privacy & Security → Open Anyway) — but the app opens.
const { execSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execSync(`codesign --deep --force --sign - ${JSON.stringify(appPath)}`, { stdio: 'inherit' })
  console.log(`ad-hoc signed: ${appPath}`)
}
