#!/usr/bin/env node
import fs from 'node:fs'
import zlib from 'node:zlib'

const tracePath = process.argv[2]

if (!tracePath) {
  console.error('Usage: bun run scripts/summarize-perf-trace.mjs <trace.json|trace.json.gz>')
  process.exit(1)
}

const raw = fs.readFileSync(tracePath)
const text = tracePath.endsWith('.gz') ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8')
const trace = JSON.parse(text)
const events = Array.isArray(trace) ? trace : trace.traceEvents ?? []
const cozeaMarks = events.filter((event) => event.cat === 'blink.user_timing' && event.name?.startsWith?.('cozea:'))
const pendingMeasures = new Map()
const completedMeasures = []

for (const event of cozeaMarks) {
  if (event.ph === 'b' && event.id2?.local) {
    pendingMeasures.set(event.id2.local, event)
    continue
  }

  if (event.ph === 'e' && event.id2?.local) {
    const start = pendingMeasures.get(event.id2.local)
    if (start) {
      completedMeasures.push({
        name: event.name,
        durationMs: (event.ts - start.ts) / 1000,
      })
      pendingMeasures.delete(event.id2.local)
    }
  }
}

const resourceEvents = events.filter((event) => event.name === 'ResourceReceiveResponse')
const scriptResponses = resourceEvents.filter((event) => {
  const mimeType = event.args?.data?.mimeType
  const url = event.args?.data?.url
  return (
    mimeType === 'application/javascript' ||
    mimeType === 'text/javascript' ||
    String(url ?? '').includes('.js')
  )
})
const longTasks = events
  .filter((event) => event.name === 'RunTask' && typeof event.dur === 'number' && event.dur >= 50_000)
  .map((event) => event.dur / 1000)
  .sort((left, right) => right - left)

console.log('Cozea measures:')
if (completedMeasures.length === 0) {
  console.log('  none found')
} else {
  for (const measure of completedMeasures.sort((left, right) => right.durationMs - left.durationMs)) {
    console.log(`  ${measure.name}: ${measure.durationMs.toFixed(1)}ms`)
  }
}

console.log('')
console.log('Trace summary:')
console.log(`  script responses: ${scriptResponses.length}`)
console.log(`  resource responses: ${resourceEvents.length}`)
console.log(`  long tasks >=50ms: ${longTasks.length}`)
if (longTasks.length > 0) {
  console.log(`  largest long task: ${longTasks[0].toFixed(1)}ms`)
}
