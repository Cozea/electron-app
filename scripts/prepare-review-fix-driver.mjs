import fs from 'node:fs'

const path = 'scripts/review-fix-device-principal.mjs'
let source = fs.readFileSync(path, 'utf8')

const oldBlock = `replaceOnce(
  'convex/yjs.ts',
  '    roomId: v.optional(v.string()),\\n    userId: v.id("devicePrincipals"),\\n    deviceId: v.string(),',
  '    roomId: v.optional(v.string()),\\n    principalId: v.id("devicePrincipals"),',
)`

const newBlock = `replaceRegex(
  'convex/yjs.ts',
  /(export const getEncryptionBootstrap = query\\(\\{[\\s\\S]*?roomId: v\\.optional\\(v\\.string\\(\\)\\),\\n)    userId: v\\.id\\("devicePrincipals"\\),\\n    deviceId: v\\.string\\(\\),/g,
  '$1    principalId: v.id("devicePrincipals"),',
)`

if (!source.includes(oldBlock)) {
  throw new Error('Could not find the ambiguous Yjs bootstrap replacement block.')
}
source = source.replace(oldBlock, newBlock)
fs.writeFileSync(path, source)
console.log('Scoped the Yjs encryption-bootstrap transform.')
