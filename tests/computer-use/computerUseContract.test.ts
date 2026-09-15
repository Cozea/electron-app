import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { computerUseCatalogue, patchComputerUseContract } from '../../scripts/patch-computer-use-contract.mjs'
import { patchT3ComputerUseSource, patchT3ComputerUseTest } from '../../scripts/prepare-t3-runtime.mjs'

// Reuse the JSON Schema validator already pinned in the build toolchain, without
// adding a runtime dependency or resolving a different copy from the environment.
const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder/package.json'))
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib/package.json'))
const Ajv = appBuilderRequire('ajv')
const readTools = ['get_app_state', 'list_apps']
const mutationTools = ['click', 'drag', 'perform_secondary_action', 'press_key', 'scroll', 'set_value', 'type_text']

describe('Computer Use provider contract', () => {
  it('has exactly the intended read and mutation sets, independent of annotations', () => {
    expect(computerUseCatalogue.tools.map((tool) => tool.name).sort()).toEqual([...readTools, ...mutationTools].sort())
    expect(computerUseCatalogue.tools.filter((tool) => tool.annotations.readOnlyHint === true).map((tool) => tool.name).sort()).toEqual(readTools)
    expect(computerUseCatalogue.tools.filter((tool) => tool.annotations.readOnlyHint === false).map((tool) => tool.name).sort()).toEqual(mutationTools)
    for (const tool of computerUseCatalogue.tools) {
      expect(tool.inputSchema.additionalProperties).toBe(false)
      if (readTools.includes(tool.name)) {
        expect(tool.annotations.readOnlyHint).toBe(true)
        expect(tool.annotations.destructiveHint).toBe(false)
      } else {
        expect(mutationTools).toContain(tool.name)
        expect(tool.annotations.readOnlyHint).toBe(false)
        expect(tool.annotations.idempotentHint).toBe(false)
        expect(tool.annotations.destructiveHint).toBe(true)
        expect(tool.description).toContain('acknowledgement')
        expect(tool.inputSchema.properties.snapshot_id).toBeDefined()
      }
    }
  })

  it('validates all eight click-target presence combinations with JSON Schema', () => {
    const click = computerUseCatalogue.tools.find((tool) => tool.name === 'click')!
    const validate = new Ajv({ strict: true, strictRequired: false }).compile(click.inputSchema)
    for (let mask = 0; mask < 8; mask++) {
      const args: Record<string, unknown> = { app: 'fixture' }
      if (mask & 1) args.element_index = 0
      if (mask & 2) args.x = 0
      if (mask & 4) args.y = 0
      expect(validate(args), `mask=${mask}: ${JSON.stringify(validate.errors)}`).toBe(mask === 1 || mask === 6)
    }
    expect(validate({ app: 'fixture', element_index: '0' })).toBe(true)
    for (const args of [{ element_index: 0 }, { app: 'fixture', x: true, y: 0 }, { app: 'fixture', element_index: null }]) {
      expect(validate(args)).toBe(false)
    }
  })

  it('patches the real pinned source and is idempotent', () => {
    const source = fs.readFileSync('vendor/t3code/apps/server/src/mcp/toolkits/computerUse.ts', 'utf8')
    const result = patchComputerUseContract(source)
    expect(result.source).toContain('include_screenshot')
    expect(result.source).toContain('DELIVERY_UNKNOWN')
    expect(patchComputerUseContract(result.source).changed).toBe(false)
  })

  it('handles strings and comments containing bracket characters', () => {
    const fixture = 'const COMPUTER_USE_TOOLS = [{ description: "[x]", /* ] */ values: [1, 2] }];\nconst keep = 1;'
    const result = patchComputerUseContract(fixture)
    expect(result.source).toContain('const keep = 1;')
    expect(patchComputerUseContract(result.source).changed).toBe(false)
    expect(() => patchComputerUseContract('const wrong = [];')).toThrow()
    expect(() => patchComputerUseContract(fixture + fixture)).toThrow()
  })

  it('never writes stale source in check mode and still patches normal preparation', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cozea-cu-check-'))
    const sourcePath = path.join(dir, 'computerUse.ts')
    const original = 'const COMPUTER_USE_TOOLS = [];\nconst keep = 1;\n'
    try {
      fs.writeFileSync(sourcePath, original)
      const before = fs.statSync(sourcePath, { bigint: true }).mtimeNs
      expect(() => patchT3ComputerUseSource({ checkOnly: true, sourcePath })).toThrow(/stale/i)
      expect(fs.readFileSync(sourcePath, 'utf8')).toBe(original)
      expect(fs.statSync(sourcePath, { bigint: true }).mtimeNs).toBe(before)
      expect(patchT3ComputerUseSource({ sourcePath })).toBe(true)
      const patched = fs.readFileSync(sourcePath, 'utf8')
      const patchedTime = fs.statSync(sourcePath, { bigint: true }).mtimeNs
      expect(patched).toContain('DELIVERY_UNKNOWN')
      expect(patched).toContain('const keep = 1;')
      expect(patchT3ComputerUseSource({ checkOnly: true, sourcePath })).toBe(false)
      expect(patchT3ComputerUseSource({ sourcePath })).toBe(false)
      expect(fs.readFileSync(sourcePath, 'utf8')).toBe(patched)
      expect(fs.statSync(sourcePath, { bigint: true }).mtimeNs).toBe(patchedTime)
      const missingPath = path.join(dir, 'missing.ts')
      expect(() => patchT3ComputerUseSource({ checkOnly: true, sourcePath: missingPath })).toThrow(/missing/i)
      expect(fs.existsSync(missingPath)).toBe(false)
      // The CLI must propagate the option, not only offer a read-only helper.
      expect(fs.readFileSync('scripts/prepare-t3-runtime.mjs', 'utf8')).toContain('patchT3ComputerUseSource({ checkOnly: options.checkOnly })')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('aligns the T3 backend timeout above the broker action budget', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cozea-cu-timeout-'))
    const sourcePath = path.join(dir, 'computerUse.ts')
    const original = 'const COMPUTER_USE_TOOLS = [];\nfetch(url, { signal: AbortSignal.timeout(30_000) });\n'
    try {
      fs.writeFileSync(sourcePath, original)
      expect(patchT3ComputerUseSource({ sourcePath })).toBe(true)
      const patched = fs.readFileSync(sourcePath, 'utf8')
      expect(patched).toContain('AbortSignal.timeout(40_000)')
      expect(patched).not.toContain('AbortSignal.timeout(30_000)')
      expect(patchT3ComputerUseSource({ sourcePath })).toBe(false)
      expect(patchT3ComputerUseSource({ checkOnly: true, sourcePath })).toBe(false)
      // And the broker budget it must exceed:
      expect(fs.readFileSync('apps/desktop/electron/services/ComputerUseRuntimeService.ts', 'utf8')).toContain(
        'CALL_TIMEOUT_MS = 35_000',
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('only promises observation budgets the embedded engine implements', () => {
    // The staged cua-driver binary has no text_limit argument (verified
    // against its strings table), so the contract must not advertise one:
    // T3 would pass a model-supplied text_limit through to silent ignorance.
    const state = computerUseCatalogue.tools.find((tool) => tool.name === 'get_app_state')!
    const properties = state.inputSchema.properties as Record<string, unknown>
    expect(properties.text_limit).toBeUndefined()
    expect(properties.max_tree_nodes).toBeDefined()
    expect(properties.max_tree_depth).toBeDefined()
    const bundled = fs.readFileSync('vendor/t3code/apps/server/dist/bin.mjs', 'utf8')
    expect(bundled).not.toContain('text_limit')
  })

  it('patches the stale vendor test expectations and is idempotent', () => {
    const fixture = [
      'it("mirrors the pinned open-computer-use v0.3.3 tool surface", () => {',
      '  expect(COMPUTER_USE_TOOLS.map((tool) => tool.name)).toEqual(EXPECTED_TOOLS);',
      'it("keeps state discovery read-only and actions non-open-world", () => {',
      '  for (const name of EXPECTED_TOOLS) {',
      '    expect(byName.get(name)?.annotations.openWorldHint).toBe(false);',
      '    expect(byName.get(name)?.annotations.destructiveHint).toBe(false);',
      '  }',
      '  expect(properties?.click_method?.enum).toEqual([',
      '    "auto",',
      '    "accessibility",',
      '    "app_post",',
      '    "sky_click",',
      '    "global",',
      '  ]);',
    ].join('\n')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cozea-cu-testpatch-'))
    const sourcePath = path.join(dir, 'computerUse.test.ts')
    try {
      fs.writeFileSync(sourcePath, fixture)
      expect(() => patchT3ComputerUseTest({ checkOnly: true, sourcePath })).toThrow(/stale/i)
      expect(patchT3ComputerUseTest({ sourcePath })).toBe(true)
      const patched = fs.readFileSync(sourcePath, 'utf8')
      expect(patched).toContain('mirrors the canonical Cozea computer-use tool surface')
      expect(patched).toContain('.sort()).toEqual(EXPECTED_TOOLS)')
      expect(patched).toContain('marks actions destructive')
      expect(patched).toContain('destructiveHint).toBe(true)')
      expect(patched).toContain('toEqual(["auto", "global"])')
      expect(patchT3ComputerUseTest({ sourcePath })).toBe(false)
      expect(patchT3ComputerUseTest({ checkOnly: true, sourcePath })).toBe(false)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('keeps the real pinned vendor test aligned with the v2 contract', () => {
    const sourcePath = 'vendor/t3code/apps/server/src/mcp/toolkits/computerUse.test.ts'
    expect(patchT3ComputerUseTest({ checkOnly: true, sourcePath })).toBe(false)
    const source = fs.readFileSync(sourcePath, 'utf8')
    expect(source).toContain('mirrors the canonical Cozea computer-use tool surface')
    expect(source).not.toContain('open-computer-use v0.3.3')
  })

  it('retains MIT provenance consistently with the bundled notice and source headers', () => {
    const root = 'native/computer-use-runtime'
    const manifest = JSON.parse(fs.readFileSync(`${root}/UPSTREAM.json`, 'utf8'))
    expect(manifest.license).toBe('MIT')
    expect(fs.readFileSync(`${root}/LICENSE.upstream.txt`, 'utf8')).toMatch(/^MIT License/)
    for (const name of Object.keys(manifest.files)) {
      const source = fs.readFileSync(`${root}/Sources/CozeaComputerUseRuntime/${name}`, 'utf8')
      expect(source).toContain('// MIT; see native/computer-use-runtime/LICENSE.upstream.txt')
      expect(source).not.toContain('AGPL-3.0-or-later')
    }
  })

  it('routes every tree messaging read through the per-object AX timeout helper', () => {
    const tree = fs.readFileSync('native/computer-use-runtime/Sources/CozeaComputerUseRuntime/Accessibility/AccessibilityTree.swift', 'utf8')
    for (const call of ['AXUIElementCopyAttributeValue(', 'AXUIElementCopyActionNames(', 'AXUIElementIsAttributeSettable(']) {
      expect(tree).not.toContain(call)
    }
    expect(tree).toContain('AXAccess.value(')
    expect(tree).toContain('AXAccess.actions(')
    expect(tree).toContain('AXAccess.settable(')
    const runtime = fs.readFileSync('native/computer-use-runtime/Sources/CozeaComputerUseRuntime/Accessibility/AccessibilityRuntime.swift', 'utf8')
    expect(runtime).toContain('readBudget.withScope')
    expect(runtime).toContain('readBudget.exhausted')
  })
})
