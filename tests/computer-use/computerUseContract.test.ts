import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { computerUseCatalogue, patchComputerUseContract } from '../../scripts/patch-computer-use-contract.mjs'

describe('Computer Use provider contract', () => {
  it('has one bounded schema per native tool and marks mutations accurately', () => {
    expect(computerUseCatalogue.tools).toHaveLength(9)
    for (const tool of computerUseCatalogue.tools) {
      expect(tool.inputSchema.additionalProperties).toBe(false)
      if (!tool.annotations.readOnlyHint) {
        expect(tool.annotations.destructiveHint).toBe(true)
        expect(tool.description).toContain('acknowledgement')
        expect(tool.inputSchema.properties.snapshot_id).toBeDefined()
      }
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
})
