#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'

const DEFAULT_RENDERER_DIR = path.join(process.cwd(), 'out', 'renderer')
const rendererDir = path.resolve(process.argv[2] ?? DEFAULT_RENDERER_DIR)
const assetsDir = path.join(rendererDir, 'assets')
const strictBudget = process.argv.includes('--fail-on-budget') || process.env.BUNDLE_BUDGET_STRICT === '1'

const budgets = {
  entryJsGzip: 750 * 1024,
  largestAsyncJsGzip: 550 * 1024,
  totalJsGzip: 3 * 1024 * 1024,
}

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function walkFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await walkFiles(absolutePath))
      continue
    }
    files.push(absolutePath)
  }

  return files
}

function gzipSize(buffer) {
  return zlib.gzipSync(buffer, { level: 9 }).length
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  }
  return `${(bytes / 1024).toFixed(1)} KB`
}

function collectEntryAssets(html) {
  const entries = new Set()
  const assetRegex = /(?:src|href)=["']\.?\/?assets\/([^"']+)["']/g
  for (const match of html.matchAll(assetRegex)) {
    entries.add(match[1])
  }
  return entries
}

function printTable(rows) {
  const widths = {
    type: 7,
    load: 7,
    raw: 10,
    gzip: 10,
  }

  console.log(`${'type'.padEnd(widths.type)} ${'load'.padEnd(widths.load)} ${'raw'.padStart(widths.raw)} ${'gzip'.padStart(widths.gzip)} asset`)
  console.log(`${'-'.repeat(widths.type)} ${'-'.repeat(widths.load)} ${'-'.repeat(widths.raw)} ${'-'.repeat(widths.gzip)} ${'-'.repeat(40)}`)
  for (const row of rows) {
    console.log(
      `${row.type.padEnd(widths.type)} ${row.load.padEnd(widths.load)} ${formatBytes(row.rawSize).padStart(widths.raw)} ${formatBytes(row.gzipSize).padStart(widths.gzip)} ${row.displayName}`,
    )
  }
}

if (!await exists(assetsDir)) {
  console.error(`Renderer assets not found: ${assetsDir}`)
  console.error('Run `bun run build` first, or pass the renderer output directory.')
  process.exit(1)
}

const indexHtmlPath = path.join(rendererDir, 'index.html')
const indexHtml = await exists(indexHtmlPath) ? await fs.readFile(indexHtmlPath, 'utf8') : ''
const entryAssets = collectEntryAssets(indexHtml)
const files = (await walkFiles(assetsDir)).filter((filePath) => /\.(?:js|css)$/.test(filePath))
const rows = []

for (const filePath of files) {
  const buffer = await fs.readFile(filePath)
  const fileName = path.basename(filePath)
  const type = fileName.endsWith('.css') ? 'css' : 'js'
  rows.push({
    displayName: fileName,
    fileName,
    gzipSize: gzipSize(buffer),
    load: entryAssets.has(fileName) ? 'entry' : 'async',
    rawSize: buffer.length,
    type,
  })
}

const jsRows = rows.filter((row) => row.type === 'js')
const cssRows = rows.filter((row) => row.type === 'css')
const entryJsRows = jsRows.filter((row) => row.load === 'entry')
const asyncJsRows = jsRows.filter((row) => row.load === 'async')
const totals = {
  allGzip: rows.reduce((sum, row) => sum + row.gzipSize, 0),
  allRaw: rows.reduce((sum, row) => sum + row.rawSize, 0),
  asyncJsGzip: asyncJsRows.reduce((sum, row) => sum + row.gzipSize, 0),
  cssGzip: cssRows.reduce((sum, row) => sum + row.gzipSize, 0),
  entryJsGzip: entryJsRows.reduce((sum, row) => sum + row.gzipSize, 0),
  totalJsGzip: jsRows.reduce((sum, row) => sum + row.gzipSize, 0),
}
const largestAsyncJs = asyncJsRows.toSorted((left, right) => right.gzipSize - left.gzipSize)[0]

console.log(`Renderer bundle summary: ${rendererDir}`)
console.log('')
console.log('Totals:')
console.log(`  entry JS gzip: ${formatBytes(totals.entryJsGzip)}`)
console.log(`  async JS gzip: ${formatBytes(totals.asyncJsGzip)}`)
console.log(`  total JS gzip: ${formatBytes(totals.totalJsGzip)}`)
console.log(`  CSS gzip: ${formatBytes(totals.cssGzip)}`)
console.log(`  all assets raw/gzip: ${formatBytes(totals.allRaw)} / ${formatBytes(totals.allGzip)}`)
if (largestAsyncJs) {
  console.log(`  largest async JS: ${largestAsyncJs.displayName} (${formatBytes(largestAsyncJs.gzipSize)} gzip)`)
}

console.log('')
console.log('Largest assets:')
printTable(rows.toSorted((left, right) => right.rawSize - left.rawSize).slice(0, 30))

const budgetFailures = []
if (totals.entryJsGzip > budgets.entryJsGzip) {
  budgetFailures.push(
    `entry JS gzip ${formatBytes(totals.entryJsGzip)} > ${formatBytes(budgets.entryJsGzip)}`,
  )
}
if (largestAsyncJs && largestAsyncJs.gzipSize > budgets.largestAsyncJsGzip) {
  budgetFailures.push(
    `largest async JS gzip ${largestAsyncJs.displayName} ${formatBytes(largestAsyncJs.gzipSize)} > ${formatBytes(budgets.largestAsyncJsGzip)}`,
  )
}
if (totals.totalJsGzip > budgets.totalJsGzip) {
  budgetFailures.push(
    `total JS gzip ${formatBytes(totals.totalJsGzip)} > ${formatBytes(budgets.totalJsGzip)}`,
  )
}

console.log('')
if (budgetFailures.length === 0) {
  console.log('Budgets: pass')
} else {
  console.log('Budgets: warn')
  for (const failure of budgetFailures) {
    console.log(`  ${failure}`)
  }
  if (strictBudget) {
    process.exit(1)
  }
}
