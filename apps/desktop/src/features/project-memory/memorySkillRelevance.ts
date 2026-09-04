import { DEFAULT_MEMORY_SKILL_LABEL } from "@/features/project-memory/memorySettingsStore"

/**
 * Which of the user's skills can drive the memory map.
 *
 * The library is not just Cozea's own: it also surfaces every skill installed
 * under a provider's root, so a typical list holds Cloudflare docs, PDF tooling
 * and brand guides. Offering those as memory providers is noise.
 *
 * The test is deliberately asymmetric. A memory-ish word in the *name* is
 * strong evidence, because names are short and chosen. The same word in a
 * *description* is not — long descriptions mention "context" and "graph" in
 * passing constantly — so descriptions must carry a specific multi-word phrase.
 * A text heuristic rather than a manifest flag, because skills are plain folders
 * authored outside Cozea and cannot be required to declare anything.
 */

/** Short, chosen, and rarely incidental. */
const NAME_SIGNALS = /\b(memory|graph|graphify|atlas|knowledge)\b/i

/** Phrases that only appear when a description really means this. */
const DESCRIPTION_SIGNALS =
  /\b(knowledge graph|memory map|codebase map|project map|project memory|code graph|dependency graph|graph of (the |this )?(project|codebase|repo))\b/i

/** Named tools whose whole job is this, however they word themselves. */
const KNOWN_MEMORY_SKILLS = new Set([DEFAULT_MEMORY_SKILL_LABEL.toLowerCase(), "graphify"])

export interface MemoryCandidateSkill {
  id: string
  name: string
  description?: string
}

export function isMemoryRelevantSkill(skill: MemoryCandidateSkill): boolean {
  const name = skill.name.trim().toLowerCase()
  if (KNOWN_MEMORY_SKILLS.has(name)) return true
  if (NAME_SIGNALS.test(name)) return true
  return DESCRIPTION_SIGNALS.test(skill.description ?? "")
}

export function filterMemorySkills<T extends MemoryCandidateSkill>(skills: readonly T[]): T[] {
  return skills.filter(isMemoryRelevantSkill)
}

export interface OrderedMemorySkill<T extends MemoryCandidateSkill> {
  skill: T
  /** True for the skill Cozea ships and seeds, which is tagged in the picker. */
  isCozeaDefault: boolean
}

export function isCozeaDefaultMemorySkill(skill: MemoryCandidateSkill): boolean {
  return skill.name.trim().toLowerCase() === DEFAULT_MEMORY_SKILL_LABEL
}

/**
 * Cozea's own skill pins to the top; everything else sorts alphabetically.
 *
 * The default is not just another entry — it is the one that works with nothing
 * installed, so it should be the first thing read rather than wherever the
 * alphabet happens to put it.
 */
export function orderMemorySkills<T extends MemoryCandidateSkill>(
  skills: readonly T[],
): Array<OrderedMemorySkill<T>> {
  return skills
    .map((skill) => ({ skill, isCozeaDefault: isCozeaDefaultMemorySkill(skill) }))
    .sort((a, b) => {
      if (a.isCozeaDefault !== b.isCozeaDefault) return a.isCozeaDefault ? -1 : 1
      return a.skill.name.localeCompare(b.skill.name, undefined, { sensitivity: "base" })
    })
}
