import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  buildMemoryInstructionsBlock,
  removeMemoryInstructions,
  writeMemoryInstructions,
} from "../../apps/desktop/electron/services/agentSkills/memoryInstructions"

let dir: string
const target = () => path.join(dir, "AGENTS.md")

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-memory-instructions-"))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("memory instructions block", () => {
  it("tells the agent to consult the map before reading files", () => {
    const block = buildMemoryInstructionsBlock("memory-skill")
    expect(block).toMatch(/consult that map first/i)
    expect(block).toContain("graphify-out/graph.json")
    expect(block).toContain("`memory-skill` skill")
  })

  it("creates the file and any missing directories", () => {
    const nested = path.join(dir, "rules", "cozea-project-memory.mdc")
    writeMemoryInstructions(nested, "memory-skill")
    expect(fs.readFileSync(nested, "utf8")).toContain("cozea:project-memory:start")
  })

  it("preserves whatever the user already keeps in the file", () => {
    fs.writeFileSync(target(), "# My notes\n\nDo not lose this.\n", "utf8")
    writeMemoryInstructions(target(), "memory-skill")

    const contents = fs.readFileSync(target(), "utf8")
    expect(contents).toContain("Do not lose this.")
    expect(contents).toContain("cozea:project-memory:start")
  })

  it("rewrites in place instead of appending a second block", () => {
    writeMemoryInstructions(target(), "memory-skill")
    writeMemoryInstructions(target(), "memory-skill")
    writeMemoryInstructions(target(), "graphify")

    const contents = fs.readFileSync(target(), "utf8")
    expect(contents.match(/cozea:project-memory:start/g)).toHaveLength(1)
    // The selected skill is named, so switching provider updates the guidance.
    expect(contents).toContain("`graphify` skill")
    expect(contents).not.toContain("`memory-skill` skill")
  })

  it("removes only the managed block, leaving the user's content", () => {
    fs.writeFileSync(target(), "# My notes\n\nKeep me.\n", "utf8")
    writeMemoryInstructions(target(), "memory-skill")
    removeMemoryInstructions(target())

    const contents = fs.readFileSync(target(), "utf8")
    expect(contents).toContain("Keep me.")
    expect(contents).not.toContain("cozea:project-memory")
  })

  it("deletes a file that held nothing but the block", () => {
    writeMemoryInstructions(target(), "memory-skill")
    removeMemoryInstructions(target())
    expect(fs.existsSync(target())).toBe(false)
  })

  it("is a no-op on a file it never wrote to", () => {
    fs.writeFileSync(target(), "# Untouched\n", "utf8")
    removeMemoryInstructions(target())
    expect(fs.readFileSync(target(), "utf8")).toBe("# Untouched\n")
  })
})
