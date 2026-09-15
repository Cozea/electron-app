#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'build/computer-use-runtime')
const cacheDir = path.join(root, 'node_modules/.cache/cua-driver')
const checkOnly = process.argv.includes('--check')
const supported = process.platform === 'darwin'
const licenseName = 'OPEN_COMPUTER_USE_LICENSE.txt'

const CUA_VERSION = '0.28.1'
const EXPECTED_HASH = '9ba84f64b04fadf7c03520d6af5d821efdd46571b84686248b3498c1ad0113db'
const DOWNLOAD_URL = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${CUA_VERSION}/cua-driver-rs-${CUA_VERSION}-darwin-universal-binary.tar.gz`

const fail = (message) => {
  console.error(`[prepare-computer-use-runtime] ${message}`)
  process.exit(1)
}

function hashFile(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

if (checkOnly) {
  const manifestPath = path.join(output, 'manifest.json')
  if (!fs.existsSync(manifestPath)) fail('manifest.json does not exist. Run bun run prepare:computer-use.')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (manifest.schemaVersion !== 3 || manifest.version !== CUA_VERSION || manifest.backend !== 'EmbeddedCuaDriver') {
    fail('Prepared runtime manifest is stale. Rebuild it.')
  }
  if (supported) {
    const binPath = path.join(output, 'cua-driver')
    if (!fs.existsSync(binPath)) fail('Missing cua-driver binary in runtime directory.')
    const actualHash = hashFile(binPath)
    if (actualHash !== EXPECTED_HASH) fail(`cua-driver hash mismatch: expected ${EXPECTED_HASH}, got ${actualHash}`)
  }
  console.log('[prepare-computer-use-runtime] Runtime check passed.')
  process.exit(0)
}

const staging = `${output}.staging-${randomUUID()}`
fs.mkdirSync(staging, { recursive: true })

try {
  if (supported) {
    fs.mkdirSync(cacheDir, { recursive: true })
    const cachedBin = path.join(cacheDir, 'cua-driver')
    const cachedCursor = path.join(cacheDir, 'cua-cursor-theme')

    let hasValidCache = false
    if (fs.existsSync(cachedBin)) {
      if (hashFile(cachedBin) === EXPECTED_HASH) {
        hasValidCache = true
      }
    }

    if (!hasValidCache) {
      console.log(`[prepare-computer-use-runtime] Fetching official Cua Driver v${CUA_VERSION} universal binary...`)
      const tempTar = path.join(cacheDir, `cua-driver-rs-${CUA_VERSION}-universal.tar.gz`)
      const curl = spawnSync('curl', ['-fSL', '-o', tempTar, DOWNLOAD_URL], { stdio: 'inherit' })
      if (curl.status !== 0) fail(`Failed to download Cua Driver release from ${DOWNLOAD_URL}`)

      const tar = spawnSync('tar', ['-xzf', tempTar, '-C', cacheDir], { stdio: 'inherit' })
      if (tar.status !== 0) fail('Failed to extract Cua Driver release archive.')
      try { fs.unlinkSync(tempTar) } catch {}

      if (!fs.existsSync(cachedBin) || hashFile(cachedBin) !== EXPECTED_HASH) {
        fail(`Downloaded cua-driver binary did not match expected hash ${EXPECTED_HASH}`)
      }
    }

    const targetBin = path.join(staging, 'cua-driver')
    fs.copyFileSync(cachedBin, targetBin)
    fs.chmodSync(targetBin, 0o755)

    if (fs.existsSync(cachedCursor)) {
      const targetCursor = path.join(staging, 'cua-cursor-theme')
      fs.copyFileSync(cachedCursor, targetCursor)
      fs.chmodSync(targetCursor, 0o755)
    }

    // Upstream license
    const licenseText = `MIT License\n\nCopyright (c) 2026 Cua Technologies Inc.\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction...`
    fs.writeFileSync(path.join(staging, licenseName), licenseText, 'utf8')

    const manifest = {
      schemaVersion: 3,
      version: CUA_VERSION,
      backend: 'EmbeddedCuaDriver',
      supported: true,
      platform: process.platform,
      arch: 'universal',
      artifacts: {
        'cua-driver': EXPECTED_HASH,
      },
      generatedAt: new Date().toISOString(),
    }
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  } else {
    // Non-darwin platforms: write unsupported manifest
    const manifest = {
      schemaVersion: 3,
      version: CUA_VERSION,
      backend: 'EmbeddedCuaDriver',
      supported: false,
      platform: process.platform,
      arch: process.arch,
      artifacts: {},
      generatedAt: new Date().toISOString(),
    }
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    fs.writeFileSync(path.join(staging, licenseName), 'Computer Use is available on macOS only.\n', 'utf8')
  }

  fs.rmSync(output, { recursive: true, force: true })
  fs.renameSync(staging, output)
} finally {
  fs.rmSync(staging, { recursive: true, force: true })
}

console.log(`[prepare-computer-use-runtime] Successfully prepared Cua Driver v${CUA_VERSION} on ${process.platform}/${process.arch}.`)
