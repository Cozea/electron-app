import { describe, expect, it } from "vitest"

import {
  ALL_SKILL_PROVIDERS,
  BUILT_IN_SKILLS,
  MEMORY_SKILL_KEY,
  MEMORY_SKILL_NAME,
} from "../../apps/desktop/electron/services/agentSkills/builtInSkills"

const memorySkill = BUILT_IN_SKILLS.find((skill) => skill.key === MEMORY_SKILL_KEY)

describe("built-in memory skill", () => {
  it("ships enabled for every agent provider Cozea hosts", () => {
    // "Any agent tile can use it" only holds if it seeds everywhere.
    expect(memorySkill).toBeTruthy()
    expect(memorySkill?.name).toBe(MEMORY_SKILL_NAME)
    expect(memorySkill?.compatibleProviders).toEqual(ALL_SKILL_PROVIDERS)
    expect(ALL_SKILL_PROVIDERS).toEqual(["claude", "codex", "cursor", "opencode"])
  })

  it("needs no external tool, so it works on first launch", () => {
    const text = memorySkill?.instructions ?? ""
    // The whole point of authoring our own: no dependency the user must install.
    expect(text).not.toMatch(/\bgraphify\s+(update|query|explain|path)\b/)
    expect(text).not.toContain("pipx")
    expect(text).toMatch(/you read files and write JSON/i)
  })

  it("specifies the exact schema the Memory tile reads", () => {
    const text = memorySkill?.instructions ?? ""
    for (const field of [
      "built_at_commit",
      "community_name",
      "source_file",
      "source_location",
      "confidence_score",
      "hyperedges",
    ]) {
      expect(text, `schema field ${field}`).toContain(field)
    }
    expect(text).toContain("graphify-out/graph.json")
  })

  it("requires stable ids, which the change colouring depends on", () => {
    const text = memorySkill?.instructions ?? ""
    expect(text).toMatch(/stable/i)
    // A churning id reads as delete-plus-add and destroys new/changed signal.
    expect(text).toMatch(/delete-plus-add|churning id/i)
  })

  it("tells agents to consult the map before reading files", () => {
    const text = memorySkill?.instructions ?? ""
    expect(text).toMatch(/before you read files/i)
    // And to distrust it where it conflicts with source.
    expect(text).toMatch(/the file wins/i)
  })

  it("keeps inferred edges honest", () => {
    const text = memorySkill?.instructions ?? ""
    expect(text).toContain("EXTRACTED")
    expect(text).toContain("INFERRED")
    expect(text).toMatch(/never label a guess\s+EXTRACTED/i)
  })

  it("pins the shared file_type vocabulary and says what each holds", () => {
    const text = memorySkill?.instructions ?? ""
    // memory-skill and graphify must agree, or a map built by one cannot be
    // continued by the other and the tile's type filters fragment.
    for (const type of ["code", "document", "paper", "image", "rationale", "concept"]) {
      expect(text, `type ${type}`).toContain(`\`${type}\``)
    }
    expect(text).toMatch(/MUST be exactly one of/)
    // Naming a type is not enough; the skill has to say what to extract from it.
    expect(text).toMatch(/READMEs, specs, decks/)
    expect(text).toMatch(/diagrams and screenshots/i)
    // The tsconfig-noise failure mode seen in a real graph.
    expect(text).toMatch(/not eight concepts/i)
  })

  it("defines the shared relation vocabulary", () => {
    const text = memorySkill?.instructions ?? ""
    for (const relation of [
      "calls",
      "imports",
      "implements",
      "references",
      "cites",
      "rationale_for",
      "conceptually_related_to",
      "shares_data_with",
    ]) {
      expect(text, `relation ${relation}`).toContain(relation)
    }
    // Otherwise every edge becomes a vague "references".
    expect(text).toMatch(/fallback, not the default/i)
  })

  it("carries all three confidence levels", () => {
    const text = memorySkill?.instructions ?? ""
    expect(text).toContain("EXTRACTED")
    expect(text).toContain("INFERRED")
    expect(text).toContain("AMBIGUOUS")
  })

  it("supports hyperedges for relationships wider than a pair", () => {
    const text = memorySkill?.instructions ?? ""
    expect(text).toContain("hyperedges")
    expect(text).toMatch(/participate_in/)
  })

  it("guards an existing map against a failed extraction", () => {
    const text = memorySkill?.instructions ?? ""
    // The worst outcome is a broken run silently replacing a good map.
    expect(text).toMatch(/zero nodes, write nothing/i)
    expect(text).toMatch(/dramatically fewer nodes/i)
    expect(text).toMatch(/never write a partial file/i)
  })

  it("updates from git status letters, not by re-reading the project", () => {
    const text = memorySkill?.instructions ?? ""
    // --name-only cannot tell a deletion from a modification, and the two are
    // handled differently: one drops nodes, the other replaces them.
    expect(text).toMatch(/git diff --name-status/)
    expect(text).toMatch(/only the touched files/i)
    expect(text).toMatch(/byte for byte/i)
  })

  it("drops the edges a re-extraction would otherwise strand", () => {
    const text = memorySkill?.instructions ?? ""
    // A link recorded against an untouched file can still name a symbol that
    // has just been deleted. Missing this leaves dangling edges in the map.
    expect(text).toMatch(/points at an id no longer present/i)
    // Which is only possible because links carry the file they were read from.
    expect(text).toMatch(/Carry `source_file` and `source_location` on \*\*every link\*\*/)
  })

  it("builds the containment spine a navigable map needs", () => {
    const text = memorySkill?.instructions ?? ""
    // Measured against real maps of this shape, `contains` is around a third
    // of all links; a map without it is a pile of symbols with no structure.
    expect(text).toMatch(/Emit a node for the file itself/i)
    expect(text).toMatch(/`contains`/)
    expect(text).toMatch(/_callable/)
  })

  it("warns that needless re-clustering fakes a project-wide change", () => {
    const text = memorySkill?.instructions ?? ""
    // The tile fingerprints community_name, so re-clustering paints every node
    // "changed" while nothing moved.
    expect(text).toMatch(/community_name/)
    expect(text).toMatch(/turns "changed" while nothing actually moved/i)
  })
})
