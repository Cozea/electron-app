// Wired as electron-builder's `afterPack` hook (see apps/desktop/electron-builder.config.cjs).
// The filename is historical; the hook itself is afterPack.

const fsp = require('node:fs/promises')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function log(message) {
  console.log(`[afterPack:adhoc-sign] ${message}`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || result.error?.message || '').trim()
    throw new Error(`${command} ${args.join(' ')} failed${details ? `: ${details}` : ''}`)
  }
  return result
}

async function findAppBundles(appOutDir) {
  const entries = await fsp.readdir(appOutDir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
    .map((entry) => path.join(appOutDir, entry.name))
}

/**
 * Whether this build is the deliberately unsigned one.
 *
 * Mirrors the flag electron-builder.config.cjs reads to set `identity: null`.
 * The identity this hook could resolve from the local keychain says nothing
 * about whether electron-builder is going to sign.
 */
function isUnsignedBuild() {
  return (
    process.env.COZEA_LOCAL_UNSIGNED_DIST === '1' || process.env.COZEA_MAC_SIGNING === '0'
  )
}

/**
 * Give an unsigned build a valid ad-hoc signature.
 *
 * With `identity: null`, electron-builder skips signing altogether, which
 * leaves the bundle with no `Contents/_CodeSignature` while the inner Mach-O
 * still carries its linker signature. macOS reads that mismatch as a broken
 * bundle: `codesign --verify` reports "code has no resources but signature
 * indicates they must be present", and Gatekeeper refuses to open the app as
 * "damaged", which right-click Open cannot get past.
 *
 * An ad-hoc signature needs no certificate and no Apple membership. It only
 * makes the bundle internally consistent, restoring the ordinary unsigned
 * experience: macOS warns that the developer is unverified, and the user can
 * open it anyway.
 */
async function adhocSignAppBundles(appOutDir) {
  const appBundles = await findAppBundles(appOutDir)
  if (appBundles.length === 0) {
    log('No app bundle found to ad-hoc sign.')
    return
  }

  for (const appBundlePath of appBundles) {
    run('codesign', ['--force', '--deep', '--sign', '-', appBundlePath])
    run('codesign', ['--verify', '--deep', '--strict', appBundlePath])
    log(`Ad-hoc signed and verified ${path.basename(appBundlePath)}`)
  }
}

module.exports = async function afterPack(context) {
  if (process.platform !== 'darwin') {
    return
  }

  // Signed builds need nothing here: electron-builder seals the bundle itself,
  // and no extraResource ships archived Mach-O binaries for us to re-sign.
  if (!isUnsignedBuild()) {
    return
  }

  const appOutDir = context?.appOutDir
  if (!appOutDir) {
    log('No appOutDir available in afterPack context, skipping ad-hoc signing.')
    return
  }

  await adhocSignAppBundles(appOutDir)
}
