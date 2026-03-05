import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import fs from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function log(message) {
  console.log(`[runtime-sign] ${message}`)
}

function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    manifest: path.join(rootDir, 'build', 'runtime', 'manifest.json'),
    archivesRoot: path.join(rootDir, 'build', 'runtime', 'packs'),
    catalog: path.join(rootDir, 'build', 'runtime', 'capability-catalog.json'),
    outDir: path.join(rootDir, 'build', 'runtime'),
    publicKeyOut: path.join(rootDir, 'build', 'runtime', 'runtime-public-key.pem'),
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const next = args[index + 1]
    if (arg === '--manifest' && next) {
      options.manifest = path.resolve(next)
      index += 1
    } else if (arg === '--archives-root' && next) {
      options.archivesRoot = path.resolve(next)
      index += 1
    } else if (arg === '--catalog' && next) {
      options.catalog = path.resolve(next)
      index += 1
    } else if (arg === '--out-dir' && next) {
      options.outDir = path.resolve(next)
      index += 1
    } else if (arg === '--public-key-out' && next) {
      options.publicKeyOut = path.resolve(next)
      index += 1
    }
  }

  return options
}

function resolvePrivateKeyPem() {
  const inline = process.env.COZEA_RUNTIME_SIGNING_PRIVATE_KEY?.trim()
  const pathOverride = process.env.COZEA_RUNTIME_SIGNING_PRIVATE_KEY_PATH?.trim()

  if (pathOverride) {
    return fs.readFileSync(path.resolve(pathOverride), 'utf-8')
  }

  if (inline) {
    if (inline.includes('BEGIN PRIVATE KEY')) return inline
    if (fs.existsSync(path.resolve(inline))) {
      return fs.readFileSync(path.resolve(inline), 'utf-8')
    }
    const decoded = Buffer.from(inline, 'base64').toString('utf-8')
    if (decoded.includes('BEGIN PRIVATE KEY')) return decoded
  }

  throw new Error('Missing signing key. Set COZEA_RUNTIME_SIGNING_PRIVATE_KEY or COZEA_RUNTIME_SIGNING_PRIVATE_KEY_PATH.')
}

function sha256Hex(payload) {
  return createHash('sha256').update(payload).digest('hex')
}

function signPayloadBase64(privateKeyPem, payload) {
  const privateKey = createPrivateKey(privateKeyPem)
  const signature = sign(null, payload, privateKey)
  return signature.toString('base64')
}

function resolveArchivePath(archivesRoot, target, archiveName) {
  const targetPath = path.join(archivesRoot, target, archiveName)
  if (fs.existsSync(targetPath)) return targetPath
  const flatPath = path.join(archivesRoot, archiveName)
  if (fs.existsSync(flatPath)) return flatPath
  return null
}

async function signRuntimeManifest(options, privateKeyPem) {
  const rawManifest = await readFile(options.manifest, 'utf-8')
  const manifest = JSON.parse(rawManifest)
  if (!Array.isArray(manifest.entries)) {
    throw new Error('Runtime manifest is invalid: entries must be an array.')
  }

  for (const entry of manifest.entries) {
    if (!entry?.archiveName || !entry?.target) {
      continue
    }
    const archivePath = resolveArchivePath(options.archivesRoot, entry.target, entry.archiveName)
    if (!archivePath) {
      log(`Skipping signature for missing archive: ${entry.archiveName}`)
      continue
    }
    const payload = await readFile(archivePath)
    entry.sha256 = sha256Hex(payload)
    entry.signature = signPayloadBase64(privateKeyPem, payload)
  }

  const updatedManifest = JSON.stringify(manifest, null, 2)
  await writeFile(options.manifest, updatedManifest, 'utf-8')
  const manifestPayload = Buffer.from(updatedManifest, 'utf-8')
  const manifestSignature = signPayloadBase64(privateKeyPem, manifestPayload)

  await mkdir(options.outDir, { recursive: true })
  await writeFile(path.join(options.outDir, 'runtime-manifest.sig'), `${manifestSignature}\n`, 'utf-8')
  await writeFile(path.join(options.outDir, 'manifest.sig'), `${manifestSignature}\n`, 'utf-8')
  log(`Signed runtime manifest: ${options.manifest}`)
}

async function signCapabilityCatalog(options, privateKeyPem) {
  if (!fs.existsSync(options.catalog)) {
    log(`Capability catalog not found, skipping signature: ${options.catalog}`)
    return
  }
  const payload = await readFile(options.catalog)
  const signature = signPayloadBase64(privateKeyPem, payload)
  await writeFile(path.join(options.outDir, 'capability-catalog.sig'), `${signature}\n`, 'utf-8')
  log(`Signed capability catalog: ${options.catalog}`)
}

async function writePublicKey(options, privateKeyPem) {
  const publicKey = createPublicKey(createPrivateKey(privateKeyPem)).export({
    type: 'spki',
    format: 'pem',
  })
  await mkdir(path.dirname(options.publicKeyOut), { recursive: true })
  await writeFile(options.publicKeyOut, publicKey, 'utf-8')
  log(`Wrote public key: ${options.publicKeyOut}`)
}

async function main() {
  const options = parseArgs()
  const privateKeyPem = resolvePrivateKeyPem()

  await signRuntimeManifest(options, privateKeyPem)
  await signCapabilityCatalog(options, privateKeyPem)
  await writePublicKey(options, privateKeyPem)
}

main().catch((error) => {
  console.error(`[runtime-sign] ERROR: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
