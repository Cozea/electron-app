#!/usr/bin/env node
/**
 * Full IPC audit: ipcMain.handle registrations vs ipcRenderer.invoke in preload.
 *
 * Usage: node scripts/audit-electron-ipc.mjs
 *
 * Limitations:
 * - Only scans electron .ts files recursively for handlers (excludes assistant-runtime subprocess).
 * - String-literal channels only, plus ASSISTANT_RUNTIME_STATUS_HANDLE resolved from main.ts + preload.ts.
 * - Does not validate renderer (src) usage of electronAPI.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const electronDir = path.join(root, 'electron')
const preloadPath = path.join(electronDir, 'preload.ts')
const mainPath = path.join(electronDir, 'main.ts')

/** @param {string} dir @returns {string[]} */
function walkTs(dir) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name)
    if (name.isDirectory()) {
      if (name.name === 'node_modules' || name.name === 'out') continue
      out.push(...walkTs(p))
    } else if (name.isFile() && name.name.endsWith('.ts')) {
      out.push(p)
    }
  }
  return out
}

/** @param {string} filePath @returns {Map<string, string>} */
function parseStringConsts(filePath) {
  const map = new Map()
  const text = fs.readFileSync(filePath, 'utf8')
  const re = /^const\s+([A-Z][A-Z0-9_]*)\s*=\s*['"]([^'"]+)['"]/gm
  let m
  while ((m = re.exec(text)) !== null) {
    map.set(m[1], m[2])
  }
  return map
}

/**
 * @param {string} text
 * @param {Map<string, string>} constMap
 * @param {'handle' | 'invoke'} mode
 */
function extractChannels(text, constMap, mode) {
  const channels = new Set()
  const prefix = mode === 'handle' ? 'ipcMain\\.handle' : 'ipcRenderer\\.invoke'

  // Quoted first argument: ipcMain.handle( 'ch' or ipcRenderer.invoke( 'ch'
  const quoted = new RegExp(`${prefix}\\s*\\(\\s*['"]([^'"]+)['"]`, 'g')
  let m
  while ((m = quoted.exec(text)) !== null) {
    channels.add(m[1])
  }

  // Variable first argument: ipcMain.handle(FOO,
  const varRe = new RegExp(`${prefix}\\s*\\(\\s*([A-Z][A-Z0-9_]*)\\s*[,)]`, 'g')
  while ((m = varRe.exec(text)) !== null) {
    const resolved = constMap.get(m[1])
    if (resolved) channels.add(resolved)
    else channels.add(`<unresolved:${m[1]}>`)
  }

  return channels
}

function main() {
  const handlers = new Set()
  const files = walkTs(electronDir)

  const mainConsts = parseStringConsts(mainPath)
  const preloadConsts = parseStringConsts(preloadPath)
  const mergedConsts = new Map([...mainConsts, ...preloadConsts])

  for (const file of files) {
    if (file === preloadPath) continue
    const text = fs.readFileSync(file, 'utf8')
    const localConsts = parseStringConsts(file)
    const map = new Map([...mergedConsts, ...localConsts])
    for (const ch of extractChannels(text, map, 'handle')) {
      handlers.add(ch)
    }
  }

  const preloadText = fs.readFileSync(preloadPath, 'utf8')
  const invokes = extractChannels(preloadText, mergedConsts, 'invoke')

  const sortedHandlers = [...handlers].filter((c) => !c.startsWith('<unresolved')).sort()
  const unresolvedHandlers = [...handlers].filter((c) => c.startsWith('<unresolved')).sort()
  const sortedInvokes = [...invokes].filter((c) => !c.startsWith('<unresolved')).sort()
  const unresolvedInvokes = [...invokes].filter((c) => c.startsWith('<unresolved')).sort()

  const handlerSet = new Set(sortedHandlers)
  const invokeSet = new Set(sortedInvokes)

  const handlersOnly = sortedHandlers.filter((c) => !invokeSet.has(c))
  const invokesOnly = sortedInvokes.filter((c) => !handlerSet.has(c))

  console.log('=== Electron IPC audit ===\n')
  console.log(`ipcMain.handle registrations (electron/**/*.ts, excl. preload): ${sortedHandlers.length}`)
  console.log(`ipcRenderer.invoke channels (electron/preload.ts only): ${sortedInvokes.length}`)
  if (unresolvedHandlers.length) {
    console.log(`\nWARN: unresolved handler vars: ${unresolvedHandlers.join(', ')}`)
  }
  if (unresolvedInvokes.length) {
    console.log(`WARN: unresolved invoke vars: ${unresolvedInvokes.join(', ')}`)
  }

  console.log('\n--- Handlers with NO matching preload invoke (orphan main handlers) ---')
  if (handlersOnly.length === 0) {
    console.log('(none)')
  } else {
    for (const c of handlersOnly) console.log(`  ${c}`)
  }

  console.log('\n--- Preload invokes with NO matching handler (likely bugs) ---')
  if (invokesOnly.length === 0) {
    console.log('(none)')
  } else {
    for (const c of invokesOnly) console.log(`  ${c}`)
  }

  console.log('\n--- Matched channels (handler + preload) ---')
  console.log(`Count: ${sortedHandlers.length - handlersOnly.length}`)

  console.log('\n--- Notes ---')
  console.log(
    'Orphan handlers under integrations:* (listRepositories, listRepositoryOwners, createRepository, syncRepositoryAccess) duplicate the sourceControl:* handlers; preload uses sourceControl:* for Git flows.',
  )
  console.log(
    'This script does not detect: (1) preload APIs never called from src, (2) ipcRenderer.on listeners vs webContents.send, (3) channels used outside preload (e.g. utility processes).',
  )
}

main()
