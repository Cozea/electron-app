import { agentSkillCategoryLabel, agentSkillCategoryOrder } from "@shared/agentSkillCategories";
import type { AgentSkillBuild, AgentSkillProvider, AgentSkillRecord } from "@shared/electronApiTypes";

/**
 * Everything a build can draw on: what is installed, plus what the providers'
 * own catalogs offer.
 *
 * Catalog entries are on disk but not loaded by the provider yet, so ticking
 * one installs it first. Leaving them out made the plates read far lower than
 * the provider actually has available.
 */
export function buildableSkills(skills: readonly AgentSkillRecord[]): AgentSkillRecord[] {
  return [...skills];
}

/**
 * Ships with the provider and is restored by it, so Cozea cannot switch it
 * off. These are reported, not offered — a tick would be a promise the
 * filesystem does not keep.
 */
export function isEssential(skill: AgentSkillRecord): boolean {
  return skill.bindings.some((binding) => binding.essential);
}

/** Splits a bucket into the skills a build controls and the ones it cannot. */
export function partitionEssential(skills: readonly AgentSkillRecord[]): {
  choosable: AgentSkillRecord[];
  essential: AgentSkillRecord[];
} {
  return {
    choosable: skills.filter((skill) => !isEssential(skill)),
    essential: skills.filter(isEssential),
  };
}

/**
 * How many skills this provider always runs, whatever the build says.
 *
 * The plates would otherwise report a Cursor that runs one skill while it
 * actually loads two dozen, because the ones it restores are not in any build.
 */
export function providerEssentialCount(
  skills: readonly AgentSkillRecord[],
  provider: AgentSkillProvider,
): number {
  return skills.filter((skill) =>
    skill.bindings.some((binding) => binding.provider === provider && binding.essential),
  ).length;
}

/**
 * Which build the hub shows.
 *
 * Falls back rather than resolving to nothing: starting a new build clears the
 * selection, so cancelling used to leave the hub with no build to draw and the
 * page went blank. Any path that drops the selection lands on the active build,
 * or the first one.
 */
export function resolveSelectedBuild(
  builds: readonly AgentSkillBuild[],
  selectedBuildId: string | null,
  activeBuildId: string | null,
): AgentSkillBuild | null {
  return (
    builds.find((build) => build.id === selectedBuildId) ??
    builds.find((build) => build.id === activeBuildId) ??
    builds[0] ??
    null
  );
}

/**
 * Two letters standing in for a skill, since skills carry no artwork.
 *
 * Qualified names read `plugin · skill`, and the plugin half repeats down a
 * whole group, so the mark is taken from the part that actually distinguishes
 * one row from the next.
 */
export function skillMonogram(name: string): string {
  const distinctive = name.split("·").pop()?.trim() || name.trim();
  const words = distinctive.split(/[\s\-_]+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.slice(0, 2).map((word) => word[0] ?? "");
  const mark = letters.join("") || distinctive.slice(0, 2);
  return mark.toUpperCase().slice(0, 2);
}

/** Whether ticking this skill has to install it before the build can hold it. */
export function needsInstall(skill: AgentSkillRecord): boolean {
  return skill.source === "catalog";
}

/** Skills a build names, in library order, ignoring ones that have gone. */
export function buildLoadout(
  build: Pick<AgentSkillBuild, "skillIds">,
  skills: readonly AgentSkillRecord[],
): AgentSkillRecord[] {
  const wanted = new Set(build.skillIds);
  return skills.filter((skill) => wanted.has(skill.id));
}

/** Slots grouped by category, the way a character sheet groups equipment. */
export function loadoutByCategory(
  loadout: readonly AgentSkillRecord[],
): Array<{ category: string; label: string; skills: AgentSkillRecord[] }> {
  const groups = new Map<string, AgentSkillRecord[]>();
  for (const skill of loadout) {
    const bucket = groups.get(skill.category);
    if (bucket) bucket.push(skill);
    else groups.set(skill.category, [skill]);
  }
  return Array.from(groups, ([category, skills]) => ({
    category,
    label: agentSkillCategoryLabel(category),
    skills,
  })).sort(
    (left, right) => agentSkillCategoryOrder(left.category) - agentSkillCategoryOrder(right.category),
  );
}

export const BUILD_PROVIDER_LABELS: Record<AgentSkillProvider, string> = {
  codex: "Codex",
  claude: "Claude",
  cursor: "Cursor",
  opencode: "OpenCode",
};



export const BUILD_PROVIDER_ORDER: AgentSkillProvider[] = [
  "claude",
  "codex",
  "cursor",
  "opencode",
];

/**
 * Whether a provider actually carries this skill.
 *
 * Not `compatible`: every skill is marked compatible with every provider (a
 * SKILL.md is portable), so compatibility cannot tell the providers apart —
 * it made all four plates show the same number. Ownership is where the skill
 * is really installed, which is what the hub is asking about.
 */
function providerOwns(skill: AgentSkillRecord, provider: AgentSkillProvider): boolean {
  return skill.bindings.some(
    (binding) =>
      binding.provider === provider &&
      // Installed for this provider, or offered by its own catalog — both are
      // skills this provider can run, which is what a plate is counting.
      (binding.ownership !== "none" || binding.available === true),
  );
}

/**
 * The Cozea skills: the ones in your own library.
 *
 * A library skill is installed *into* providers, so it reaches their folders
 * too — but it belongs here. The buckets partition the build by whose skill
 * it is, so nothing is listed on two pages.
 */
export function cozeaSkills(loadout: readonly AgentSkillRecord[]): AgentSkillRecord[] {
  return loadout.filter((skill) => skill.source === "managed");
}

/**
 * A provider's own skills inside a build: everything it has any relationship
 * with, on or off, minus the library.
 *
 * Deliberately broad. Activating a build disables what it leaves out, and a
 * disabled skill still belongs to its provider — if this narrowed to what is
 * currently switched on, a build's own contents would vanish from the plate
 * the moment it was activated.
 */
export function providerLoadout(
  loadout: readonly AgentSkillRecord[],
  provider: AgentSkillProvider,
): AgentSkillRecord[] {
  return loadout.filter(
    (skill) =>
      skill.source !== "managed" &&
      // Essential skills are shown beside the count as "+N", not inside it.
      // Counting them here reported them twice, and claimed the build
      // controlled skills it cannot switch off.
      !isEssential(skill) &&
      providerOwns(skill, provider),
  );
}

/**
 * What a provider's page offers to pick from: every skill this provider has a
 * copy of, plus what its catalog offers.
 *
 * A switched-off skill still counts. Disabling moves the folder to Cozea's
 * trash but the binding keeps its ownership, and listing only what is switched
 * on made unticking a one-way door: the skill vanished from the one page that
 * could put it back.
 */
export function providerCandidates(
  skills: readonly AgentSkillRecord[],
  provider: AgentSkillProvider,
): AgentSkillRecord[] {
  return skills.filter(
    (skill) =>
      skill.source !== "managed" &&
      skill.bindings.some(
        (binding) =>
          binding.provider === provider &&
          (binding.enabled || binding.available === true || binding.ownership !== "none"),
      ),
  );
}

/** How many skills each provider carries, in a stable order. */
export function providerSkillCounts(
  loadout: readonly AgentSkillRecord[],
): Array<{ provider: AgentSkillProvider; label: string; count: number }> {
  return BUILD_PROVIDER_ORDER.map((provider) => ({
    provider,
    label: BUILD_PROVIDER_LABELS[provider],
    count: providerLoadout(loadout, provider).length,
  }));
}

/**
 * Picking a whole category at once: if it is already fully chosen the click
 * clears it, otherwise it completes it. Partial selections fill up rather than
 * emptying, which is what a half-ticked group invites you to do.
 */
export function toggleCategorySelection(
  selected: readonly string[],
  categorySkillIds: readonly string[],
): string[] {
  const chosen = new Set(selected);
  const allChosen =
    categorySkillIds.length > 0 && categorySkillIds.every((id) => chosen.has(id));
  if (allChosen) {
    return selected.filter((id) => !categorySkillIds.includes(id));
  }
  return [...selected, ...categorySkillIds.filter((id) => !chosen.has(id))];
}

/** Narrow the picker to a search term and, optionally, one category. */
export function filterPickerSkills(
  skills: readonly AgentSkillRecord[],
  query: string,
  category: string | null,
): AgentSkillRecord[] {
  const needle = query.trim().toLowerCase();
  return skills.filter((skill) => {
    if (category && skill.category !== category) return false;
    if (!needle) return true;
    return `${skill.name} ${skill.description}`.toLowerCase().includes(needle);
  });
}
