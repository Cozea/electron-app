import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const roots = ['apps', 'cloudflare', 'convex', 'shared', 'tests']
const extensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.md'])

function walk(directory) {
  if (!fs.existsSync(directory)) return
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'vendor') continue
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      walk(target)
      continue
    }
    if (!extensions.has(path.extname(entry.name))) continue
    const before = fs.readFileSync(target, 'utf8')
    const after = before.replaceAll('publisherDeviceLabel', 'publisherDisplayName')
    if (after !== before) fs.writeFileSync(target, after)
  }
}

for (const directory of roots) walk(path.join(root, directory))
console.log('Renamed DevApp publisher presentation field to publisherDisplayName.')
