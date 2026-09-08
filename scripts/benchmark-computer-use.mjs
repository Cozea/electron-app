#!/usr/bin/env node
// Summarize redacted OSLog output, not screenshots or tool arguments.
// log show --last 10m --debug --style ndjson --predicate
//   'subsystem == "com.cozea.desktop" AND category == "ComputerUse"' > trace.ndjson
import fs from 'node:fs'
const file = process.argv[2]
if (!file) throw new Error('Usage: node scripts/benchmark-computer-use.mjs trace.ndjson')
const stages = new Map()
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  let message = line
  try { message = JSON.parse(line).eventMessage ?? line } catch { /* accepts compact log text too */ }
  const match = /stage=([a-zA-Z0-9_.-]+) ms=([0-9]+(?:\.[0-9]+)?)/.exec(message)
  if (!match) continue
  const samples = stages.get(match[1]) ?? []
  samples.push(Number(match[2])); stages.set(match[1], samples)
}
const report = [...stages].sort(([a], [b]) => a.localeCompare(b)).map(([stage, samples]) => {
  samples.sort((a, b) => a - b)
  const percentile = (p) => samples[Math.max(0, Math.ceil(samples.length * p) - 1)]
  return { stage, samples: samples.length, p50_ms: percentile(.5), p95_ms: percentile(.95), p99_ms: percentile(.99) }
})
if (!report.length) throw new Error('No Computer Use timing spans found. Capture debug OSLog output first.')
console.log(JSON.stringify({ measured: true, stages: report }, null, 2))
