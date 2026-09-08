#!/usr/bin/env node
import { parseArgs } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
const { values } = parseArgs({ options: {
  mode: { type: 'string', default: 'correctness' },
  samples: { type: 'string', default: '100' }, fixture: { type: 'string', default: 'all' },
  evidence: { type: 'string' }, help: { type: 'boolean', default: false },
} })
if (values.help) { console.log('Navigation validation requires executable Electron scenarios and measured evidence. No fixture-count fallback is permitted.'); process.exit(0) }
if (!['correctness', 'performance'].includes(values.mode)) throw new Error('Unknown validation mode')
if (!['all', 'resident-warm', 'cold', 'migration'].includes(values.fixture)) throw new Error('Unknown fixture')
const samples = Number(values.samples)
if (!Number.isSafeInteger(samples) || samples < 1) throw new Error('Invalid sample count')
// Fail closed until the real Electron driver is connected. This is deliberately
// nonzero: CI must not confuse absent desktop execution with successful testing.
const driver = path.resolve('scripts/perf/navigation/electron-driver.mjs')
if (!fs.existsSync(driver)) {
  console.error('BLOCKED: real Electron navigation driver is not implemented. No correctness or performance verdict is available.')
  process.exit(2)
}
const { runNavigationScenarios } = await import(driver)
await runNavigationScenarios({ mode: values.mode, samples, fixture: values.fixture, evidence: values.evidence })
