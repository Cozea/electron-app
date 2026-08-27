#!/usr/bin/env node
/**
 * Compare preload contextBridge surfaces (electronAPI, desktopBridge) with static
 * property access in src/ (renderer).
 *
 * Usage: node scripts/audit-electron-api-renderer.mjs
 *
 * Limitations:
 * - Parses electron/preload.ts with the TypeScript AST (object literal under exposeInMainWorld).
 * - Renderer usage: only direct chains like window.electronAPI.foo.bar or electronAPI.foo.bar
 *   (optional ?. after electronAPI/desktopBridge). Misses aliasing, bracket access, and
 *   dynamic keys.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const preloadPath = path.join(root, 'apps/desktop/electron', 'preload.ts')
const srcDir = path.join(root, 'src')

/** @param {string} dir @returns {string[]} */
function walkSrc(dir) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name)
    if (name.isDirectory()) {
      if (name.name === 'node_modules') continue
      out.push(...walkSrc(p))
    } else if (name.isFile() && (name.name.endsWith('.ts') || name.name.endsWith('.tsx'))) {
      out.push(p)
    }
  }
  return out
}

/** @param {ts.Expression} arg @returns {ts.ObjectLiteralExpression | null} */
function unwrapObjectLiteral(arg) {
  if (ts.isObjectLiteralExpression(arg)) return arg
  if (ts.isAsExpression(arg) || ts.isParenthesizedExpression(arg)) {
    return unwrapObjectLiteral(arg.expression)
  }
  if (ts.isSatisfiesExpression(arg)) {
    return unwrapObjectLiteral(arg.expression)
  }
  return null
}

/**
 * @param {ts.ObjectLiteralExpression} obj
 * @param {string[]} prefix
 * @param {Set<string>} leaves
 */
function collectLeafPaths(obj, prefix, leaves) {
  for (const prop of obj.properties) {
    if (ts.isSpreadAssignment(prop)) continue

    let name = null
    if (ts.isPropertyAssignment(prop)) {
      if (ts.isIdentifier(prop.name)) name = prop.name.text
      else if (ts.isStringLiteral(prop.name)) name = prop.name.text
      else continue

      const init = prop.initializer
      if (ts.isObjectLiteralExpression(init)) {
        collectLeafPaths(init, [...prefix, name], leaves)
      } else {
        leaves.add([...prefix, name].join('.'))
      }
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      leaves.add([...prefix, prop.name.text].join('.'))
    } else if (ts.isMethodDeclaration(prop)) {
      if (ts.isIdentifier(prop.name)) {
        leaves.add([...prefix, prop.name.text].join('.'))
      }
    }
  }
}

/**
 * @param {ts.SourceFile} sf
 * @param {string} bridgeName
 * @returns {Set<string>}
 */
function extractBridgeLeaves(sf, bridgeName) {
  const leaves = new Set()

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'exposeInMainWorld' &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'contextBridge' &&
      node.arguments.length >= 2
    ) {
      const nameArg = node.arguments[0]
      if (!ts.isStringLiteral(nameArg) && !ts.isNoSubstitutionTemplateLiteral(nameArg)) return
      if (nameArg.text !== bridgeName) return
      const obj = unwrapObjectLiteral(node.arguments[1])
      if (obj) collectLeafPaths(obj, [], leaves)
    }
    ts.forEachChild(node, visit)
  }

  visit(sf)
  return leaves
}

/** @param {string} filePath @returns {ts.SourceFile} */
function parseTs(filePath) {
  const text = fs.readFileSync(filePath, 'utf8')
  return ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

/**
 * @param {string} text
 * @param {string} rootName 'electronAPI' | 'desktopBridge'
 * @returns {Set<string>}
 */
function extractUsageChains(text, rootName) {
  const used = new Set()
  const re = new RegExp(
    `(?:window\\.)?${rootName}\\??((?:\\.[a-zA-Z_$][a-zA-Z0-9_$]*)+)`,
    'g',
  )
  let m
  while ((m = re.exec(text)) !== null) {
    const chain = m[1].replace(/^\./, '').split('.').filter(Boolean)
    if (chain.length === 0) continue
    const full = chain.join('.')
    used.add(full)
    for (let i = 1; i < chain.length; i++) {
      used.add(chain.slice(0, i).join('.'))
    }
  }
  return used
}

/**
 * @param {string} relPath
 * @param {Set<string>} leaves
 */
function usageLooksValid(relPath, leaves) {
  if (leaves.has(relPath)) return true
  const p = `${relPath}.`
  for (const leaf of leaves) {
    if (leaf.startsWith(p)) return true
  }
  return false
}

function main() {
  if (!fs.existsSync(preloadPath)) {
    console.error('Missing', preloadPath)
    process.exit(1)
  }

  const preloadSf = parseTs(preloadPath)
  const electronLeaves = extractBridgeLeaves(preloadSf, 'electronAPI')
  const desktopLeaves = extractBridgeLeaves(preloadSf, 'desktopBridge')

  const rendererFiles = walkSrc(srcDir)
  const electronUsed = new Set()
  const desktopUsed = new Set()

  for (const file of rendererFiles) {
    const text = fs.readFileSync(file, 'utf8')
    for (const u of extractUsageChains(text, 'electronAPI')) electronUsed.add(u)
    for (const u of extractUsageChains(text, 'desktopBridge')) desktopUsed.add(u)
  }

  const electronUnused = [...electronLeaves].filter((leaf) => !electronUsed.has(leaf)).sort()
  const desktopUnused = [...desktopLeaves].filter((leaf) => !desktopUsed.has(leaf)).sort()

  const electronSuspicious = [...electronUsed]
    .filter((u) => !usageLooksValid(u, electronLeaves))
    .sort()
  const desktopSuspicious = [...desktopUsed]
    .filter((u) => !usageLooksValid(u, desktopLeaves))
    .sort()

  console.log('=== Preload bridge vs renderer (src/) ===\n')

  console.log(`electronAPI leaves (preload AST): ${electronLeaves.size}`)
  console.log(`electronAPI path prefixes used in src/: ${electronUsed.size}`)
  console.log('\n--- electronAPI leaves with NO matching src chain (possibly dead API) ---')
  if (electronUnused.length === 0) {
    console.log('(none)')
  } else {
    for (const p of electronUnused) console.log(`  ${p}`)
  }

  console.log('\n--- electronAPI-looking src chains that do not match any exposed leaf/prefix ---')
  if (electronSuspicious.length === 0) {
    console.log('(none)')
  } else {
    for (const p of electronSuspicious) console.log(`  ${p}`)
  }

  console.log(`\ndesktopBridge leaves (preload AST): ${desktopLeaves.size}`)
  console.log(`desktopBridge path prefixes used in src/: ${desktopUsed.size}`)
  console.log('\n--- desktopBridge leaves with NO matching src chain ---')
  if (desktopUnused.length === 0) {
    console.log('(none)')
  } else {
    for (const p of desktopUnused) console.log(`  ${p}`)
  }

  console.log('\n--- desktopBridge-looking src chains that do not match any exposed leaf/prefix ---')
  if (desktopSuspicious.length === 0) {
    console.log('(none)')
  } else {
    for (const p of desktopSuspicious) console.log(`  ${p}`)
  }

  console.log('\n--- Notes ---')
  console.log(
    '“Unused” means no window.electronAPI.a.b… / electronAPI.a.b… (optional ?.) chain in src; aliases and destructuring are ignored.',
  )
  console.log('Run `bun run audit:electron-ipc` for ipcMain.handle vs preload invoke pairing.')
}

main()
