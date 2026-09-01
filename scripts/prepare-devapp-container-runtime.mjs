import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '..')
const packageRoot = path.join(repositoryRoot, 'native', 'devapp-container-runtime')
const outputRoot = path.join(repositoryRoot, 'build', 'devapp-container-runtime')
const cacheRoot = path.join(packageRoot, '.cache')
const configuration = process.argv.includes('--debug') ? 'debug' : 'release'
const checkOnly = process.argv.includes('--check')
const packageResources = process.argv.includes('--package') || process.argv.includes('--with-resources')

// Apple Containerization's documented Kata kernel supply. The archive is immutable
// launch input only after this exact digest passes; the extracted kernel receives a
// second digest in the app-signed resource manifest.
const kernel = {
  url: 'https://github.com/kata-containers/kata-containers/releases/download/3.28.0/kata-static-3.28.0-arm64.tar.zst',
  archiveSha256: 'sha256:f63d54507d1f18635d94475077e4c2330de4d8e05cedf25f7c38f063b0e66a91',
  archivePath: 'opt/kata/share/kata-containers/vmlinux-6.18.15-186',
}
const initfsReference =
  'ghcr.io/apple/containerization/vminit@sha256:41934356c47f526640b2e865225c2f597bc5e6f1391ad300f95b9c0257fbba44'
const containerizationVersion = '0.43.0'

function log(message) {
  console.log(`[devapp-container-runtime] ${message}`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
    ...options,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function sha256(data) {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`
}

async function sha256File(filePath) {
  return sha256(await readFile(filePath))
}

async function ensureDownload(url, destination, expectedDigest) {
  if (fs.existsSync(destination) && (await sha256File(destination)) === expectedDigest) return
  await mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.tmp-${process.pid}`
  await rm(temporary, { force: true })
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`download failed (${response.status})`)
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary, { mode: 0o600 }))
  const actual = await sha256File(temporary)
  if (actual !== expectedDigest) {
    await rm(temporary, { force: true })
    throw new Error(`kernel archive digest mismatch (expected ${expectedDigest}, received ${actual})`)
  }
  await rename(temporary, destination)
}

function buildHelper() {
  run('/usr/bin/xcrun', [
    'swift',
    'build',
    '--package-path',
    packageRoot,
    '--configuration',
    configuration,
    '--product',
    'cozea-devapp-container-runtime',
  ])
}

async function prepareResources() {
  const archive = path.join(cacheRoot, path.basename(new URL(kernel.url).pathname))
  await ensureDownload(kernel.url, archive, kernel.archiveSha256)
  const extractionRoot = path.join(cacheRoot, `kernel-${kernel.archiveSha256.slice(7, 19)}`)
  const extractedKernel = path.join(extractionRoot, kernel.archivePath)
  if (!fs.existsSync(extractedKernel)) {
    await rm(extractionRoot, { recursive: true, force: true })
    await mkdir(extractionRoot, { recursive: true })
    run('/usr/bin/tar', ['-xf', archive, '-C', extractionRoot, kernel.archivePath])
  }

  await mkdir(outputRoot, { recursive: true })
  const helperSource = path.join(
    packageRoot,
    '.build',
    configuration,
    'cozea-devapp-container-runtime',
  )
  const helperDestination = path.join(outputRoot, 'cozea-devapp-container-runtime')
  const kernelDestination = path.join(outputRoot, 'vmlinux')
  fs.copyFileSync(helperSource, helperDestination)
  fs.chmodSync(helperDestination, 0o755)
  fs.copyFileSync(extractedKernel, kernelDestination)
  fs.chmodSync(kernelDestination, 0o644)

  const manifest = {
    version: 1,
    containerizationVersion,
    helperSha256: await sha256File(helperDestination),
    kernelSha256: await sha256File(kernelDestination),
    initfsReference,
    kernelSource: {
      url: kernel.url,
      archiveSha256: kernel.archiveSha256,
      archivePath: kernel.archivePath,
    },
  }
  await writeFile(
    path.join(outputRoot, 'resource-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  )
  log(`Prepared signed-package resources in ${outputRoot}`)
}

async function checkResources() {
  const helperPath = path.join(outputRoot, 'cozea-devapp-container-runtime')
  const kernelPath = path.join(outputRoot, 'vmlinux')
  const manifestPath = path.join(outputRoot, 'resource-manifest.json')
  if (!fs.existsSync(helperPath) || !fs.existsSync(kernelPath) || !fs.existsSync(manifestPath)) {
    throw new Error('prepared runtime resources are missing')
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (
    manifest.version !== 1 ||
    manifest.containerizationVersion !== containerizationVersion ||
    manifest.helperSha256 !== (await sha256File(helperPath)) ||
    manifest.kernelSha256 !== (await sha256File(kernelPath)) ||
    manifest.initfsReference !== initfsReference ||
    manifest.kernelSource?.archiveSha256 !== kernel.archiveSha256
  ) {
    throw new Error('prepared runtime resource verification failed')
  }
  log('Prepared runtime resources verified')
}

async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    log('Skipping Apple Containerization helper outside Apple silicon macOS.')
    return
  }
  if (checkOnly) {
    await checkResources()
    return
  }
  buildHelper()
  if (packageResources) await prepareResources()
  else log('Built debug helper; pass --with-resources to prepare the kernel and package resources.')
}

main().catch((error) => {
  console.error(`[devapp-container-runtime] ERROR: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
