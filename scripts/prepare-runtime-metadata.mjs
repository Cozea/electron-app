import fs from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = path.join(rootDir, 'build', 'runtime')

function log(message) {
  console.log(`[runtime-metadata] ${message}`)
}

async function exists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function ensureCapabilityCatalog() {
  const catalogPath = path.join(runtimeRoot, 'capability-catalog.json')
  if (await exists(catalogPath)) return

  const catalog = {
    version: '1',
    generatedAt: new Date().toISOString(),
    rules: [
      {
        id: 'node-default',
        matchAnyFile: ['package.json'],
        suggestedCommands: [
          {
            command: 'npm run dev',
            runtime: 'npm',
            confidence: 0.85,
            reason: 'Found package.json in project root.',
          },
        ],
      },
      {
        id: 'python-default',
        matchAnyFile: ['pyproject.toml', 'requirements.txt'],
        suggestedCommands: [
          {
            command: 'python -m uvicorn main:app --reload',
            runtime: 'python',
            confidence: 0.35,
            reason: 'Found common Python project markers.',
          },
        ],
      },
      {
        id: 'rust-default',
        matchAnyFile: ['Cargo.toml'],
        suggestedCommands: [
          {
            command: 'cargo run',
            runtime: 'rust',
            confidence: 0.35,
            reason: 'Found Cargo manifest.',
          },
        ],
      },
      {
        id: 'go-default',
        matchAnyFile: ['go.mod'],
        suggestedCommands: [
          {
            command: 'go run .',
            runtime: 'go',
            confidence: 0.35,
            reason: 'Found go.mod manifest.',
          },
        ],
      },
    ],
  }

  await writeFile(catalogPath, JSON.stringify(catalog, null, 2), 'utf-8')
  log(`Wrote capability catalog: ${catalogPath}`)
}

async function maybeWriteBundledPublicKey() {
  const bundledPublicKeyPath = path.join(runtimeRoot, 'runtime-public-key.pem')
  if (await exists(bundledPublicKeyPath)) return

  const configured =
    process.env.COZEA_RUNTIME_SIGNING_PUBLIC_KEY?.trim() ||
    process.env.COZEA_RUNTIME_PUBLIC_KEY_PEM?.trim()
  if (!configured) return

  const key = configured.includes('BEGIN PUBLIC KEY')
    ? configured
    : fs.readFileSync(path.resolve(configured), 'utf-8')

  await writeFile(bundledPublicKeyPath, key, 'utf-8')
  log(`Wrote runtime public key: ${bundledPublicKeyPath}`)
}

async function main() {
  await mkdir(runtimeRoot, { recursive: true })
  await ensureCapabilityCatalog()
  await maybeWriteBundledPublicKey()
  log(`Runtime metadata ready in ${runtimeRoot}`)
}

main().catch((error) => {
  console.error(`[runtime-metadata] ERROR: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
