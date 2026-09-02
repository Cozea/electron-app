import { describe, expect, it } from "vitest"

import {
  filterMemorySkills,
  isCozeaDefaultMemorySkill,
  isMemoryRelevantSkill,
  orderMemorySkills,
} from "../../apps/desktop/src/features/projects/memory/memorySkillRelevance"

describe("memory skill relevance", () => {
  it("accepts the skills that could actually drive the map", () => {
    for (const skill of [
      { id: "1", name: "memory-skill", description: "Build and consult the project map." },
      { id: "2", name: "graphify", description: "Turns a folder into a knowledge graph." },
      { id: "3", name: "Repo Atlas", description: "Builds a codebase map for navigation." },
      // Name gives nothing away; the description carries a specific phrase.
      {
        id: "4",
        name: "codebase-nav",
        description: "Builds a knowledge graph of the project so agents can navigate it.",
      },
    ]) {
      expect(isMemoryRelevantSkill(skill), skill.name).toBe(true)
    }
  })

  it("rejects the skills that actually leaked into the picker", () => {
    // Verbatim from the user's library — these appeared under "Memory skill"
    // because the first heuristic matched "context" and a bare "graph".
    for (const skill of [
      {
        id: "5",
        name: "agents-sdk",
        description:
          "Build AI agents on Cloudflare Workers using the Agents SDK. Load when creating stateful agents, durable workflows, real-time WebSocket apps, scheduled tasks, MCP servers, chat applications, voice agents, or browser automation.",
      },
      {
        id: "6",
        name: "cloudflare",
        description:
          "Comprehensive Cloudflare platform skill covering Workers, Pages, storage (KV, D1, R2), AI (Workers AI, Vectorize, Agents SDK), feature flags, networking, security, and infrastructure-as-code. Use for any Cloudflare development task.",
      },
      {
        id: "7",
        name: "cloudflare-email-service",
        description:
          "Send and receive transactional emails with Cloudflare Email Service. Use when building email sending, email routing, or integrating email into any app.",
      },
      {
        id: "8",
        name: "dataviz",
        description:
          "Use whenever you are about to create ANY chart, graph, plot, dashboard, or data visualization, in ANY output medium.",
      },
      {
        id: "9",
        name: "brand-review",
        description: "Review content against your brand voice, style guide, and messaging pillars.",
      },
      { id: "10", name: "pdf", description: "Read, split, and fill PDF files." },
      {
        id: "11",
        name: "deploy-checklist",
        description: "Pre-deployment verification checklist for shipping a release.",
      },
    ]) {
      expect(isMemoryRelevantSkill(skill), skill.name).toBe(false)
    }
  })

  it("keeps a passing mention of graph or context from qualifying a skill", () => {
    // The whole reason descriptions need a phrase rather than a word.
    expect(
      isMemoryRelevantSkill({
        id: "12",
        name: "web-perf",
        description: "Analyzes performance, identifies network dependency chains and context.",
      }),
    ).toBe(false)
  })

  it("matches the built-in and graphify by name even with unhelpful wording", () => {
    expect(isMemoryRelevantSkill({ id: "9", name: "graphify", description: "" })).toBe(true)
    expect(isMemoryRelevantSkill({ id: "10", name: "memory-skill", description: "" })).toBe(true)
    // Case and padding come from user-authored folders, not from us.
    expect(isMemoryRelevantSkill({ id: "11", name: "  GraphiFy  ", description: "" })).toBe(true)
  })

  it("tolerates a missing description", () => {
    expect(isMemoryRelevantSkill({ id: "12", name: "Project Graph" })).toBe(true)
    expect(isMemoryRelevantSkill({ id: "13", name: "xlsx" })).toBe(false)
  })

  it("filters a mixed library down to the usable ones", () => {
    const filtered = filterMemorySkills([
      { id: "a", name: "memory-skill", description: "the map" },
      { id: "b", name: "pptx", description: "Make slide decks." },
      { id: "c", name: "graphify", description: "" },
    ])
    expect(filtered.map((skill) => skill.id)).toEqual(["a", "c"])
  })
})

describe("memory skill ordering", () => {
  it("pins Cozea's own skill above everything else", () => {
    // It is the one that works with nothing installed, so it should be read
    // first rather than wherever the alphabet puts it.
    const ordered = orderMemorySkills([
      { id: "a", name: "atlas-graph" },
      { id: "b", name: "memory-skill" },
      { id: "c", name: "graphify" },
    ])
    expect(ordered.map((entry) => entry.skill.name)).toEqual([
      "memory-skill",
      "atlas-graph",
      "graphify",
    ])
    expect(ordered[0].isCozeaDefault).toBe(true)
    expect(ordered.slice(1).every((entry) => !entry.isCozeaDefault)).toBe(true)
  })

  it("sorts the rest alphabetically, ignoring case", () => {
    const ordered = orderMemorySkills([
      { id: "1", name: "Zeta Graph" },
      { id: "2", name: "alpha-memory" },
      { id: "3", name: "Beta Map" },
    ])
    expect(ordered.map((entry) => entry.skill.name)).toEqual([
      "alpha-memory",
      "Beta Map",
      "Zeta Graph",
    ])
  })

  it("still orders sensibly when the built-in was deleted", () => {
    const ordered = orderMemorySkills([
      { id: "1", name: "graphify" },
      { id: "2", name: "atlas" },
    ])
    expect(ordered.map((entry) => entry.skill.name)).toEqual(["atlas", "graphify"])
    expect(ordered.some((entry) => entry.isCozeaDefault)).toBe(false)
  })

  it("identifies the built-in regardless of case or padding", () => {
    expect(isCozeaDefaultMemorySkill({ id: "1", name: "  Memory-Skill " })).toBe(true)
    expect(isCozeaDefaultMemorySkill({ id: "2", name: "graphify" })).toBe(false)
  })
})
