import * as React from "react";

import { Logo } from "@/components/Logo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { appToast } from "@/lib/appToast";
import { ensureNativeApi } from "@/lib/nativeApi";
import { useSearchParams } from "@/lib/router";
import { cn } from "@/lib/utils";
import {
  ClaudeAI,
  CursorIcon,
  OpenAI,
  OpenCodeIcon,
  type Icon,
} from "@/features/assistant/Icons";
import {
  conciseDescription,
  ESSENTIAL_SKILL_NOTE,
  prettifySkillName,
} from "@/features/projects/pages/AgentSkillsPage";
import {
  agentSkillCategoryLabel,
  agentSkillCategoryOrder,
} from "@shared/agentSkillCategories";
import type {
  AgentSkillBuild,
  AgentSkillProvider,
  AgentSkillMutationResult,
  AgentSkillRecord,
  AgentSkillsSnapshot,
} from "@shared/electronApiTypes";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon as __AddHugeIcon,
  ArrowLeft01Icon as __ArrowLeftHugeIcon,
  ArrowRight01Icon as __ArrowRightHugeIcon,
  Delete02Icon as __DeleteHugeIcon,
  FlashIcon as __FlashHugeIcon,
  FolderLibraryIcon as __LibraryHugeIcon,
  Search01Icon as __SearchHugeIcon,
  InformationCircleIcon as __InfoHugeIcon,
  Tick02Icon as __TickHugeIcon,
} from "@hugeicons/core-free-icons";

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

/** The providers' own marks, shared with the assistant's provider picker. */
const BUILD_PROVIDER_ICONS: Record<AgentSkillProvider, Icon> = {
  claude: ClaudeAI,
  codex: OpenAI,
  cursor: CursorIcon,
  opencode: OpenCodeIcon,
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

export function SkillBuildsView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const [snapshot, setSnapshot] = React.useState<AgentSkillsSnapshot | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [selectedBuildId, setSelectedBuildId] = React.useState<string | null>(null);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [isEditing, setIsEditing] = React.useState(false);
  const [openDetail, setOpenDetail] = React.useState<AgentSkillProvider | "cozea" | null>(null);
  const [draftName, setDraftName] = React.useState("");
  const [draftSkillIds, setDraftSkillIds] = React.useState<string[]>([]);

  const load = React.useCallback(async () => {
    setLoadError(null);
    try {
      const next = await window.electronAPI.agentSkills.list();
      setSnapshot(next);
      setSelectedBuildId((current) =>
        current && next.builds.some((build) => build.id === current)
          ? current
          : (next.activeBuildId ?? next.builds[0]?.id ?? null),
      );
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load builds.");
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const runMutation = React.useCallback(
    async (
      key: string,
      operation: () => Promise<AgentSkillMutationResult>,
      success: string | null,
    ) => {
      setBusyKey(key);
      try {
        const result = await operation();
        setSnapshot(result.snapshot);
        if (!result.success) {
          if (result.error) appToast.error({ title: "Builds", description: result.error });
          return result;
        }
        if (result.changedProviders?.length) {
          try {
            await ensureNativeApi().server.refreshProviders();
          } catch {
            // The runtime's periodic provider snapshot converges anyway.
          }
        }
        if (success) appToast.success({ title: success });
        return result;
      } catch (error) {
        appToast.error({
          title: "Builds",
          description: error instanceof Error ? error.message : "The local operation failed.",
        });
        return null;
      } finally {
        setBusyKey(null);
      }
    },
    [],
  );

  const skills = React.useMemo(() => buildableSkills(snapshot?.skills ?? []), [snapshot]);
  const builds = snapshot?.builds ?? [];
  const selectedBuild = resolveSelectedBuild(
    builds,
    selectedBuildId,
    snapshot?.activeBuildId ?? null,
  );
  const loadout = React.useMemo(
    () => (selectedBuild ? buildLoadout(selectedBuild, skills) : []),
    [selectedBuild, skills],
  );

  /** Builds are created and deleted, not edited: this always opens blank. */
  const startEditing = React.useCallback(() => {
    setIsEditing(true);
    setOpenDetail(null);
    setDraftName("");
    setDraftSkillIds([]);
  }, []);

  /**
   * Add or drop one skill on the open build. Deliberately silent: a bucket
   * page is a checklist, and a toast per tick would bury the screen.
   */
  const toggleBuildSkill = React.useCallback(
    async (skillId: string) => {
      if (!selectedBuild) return;

      // A catalog entry sits on disk unloaded, so it has to be installed
      // before a build can switch it on. Its id changes once installed, so
      // resolve the new record before writing the build.
      const candidate = skills.find((skill) => skill.id === skillId);
      let targetId = skillId;
      if (candidate && needsInstall(candidate)) {
        const installed = await runMutation(
          `toggle:${skillId}`,
          () => window.electronAPI.agentSkills.install({ skillId }),
          `${prettifySkillName(candidate.name)} installed`,
        );
        if (!installed?.success) return;
        targetId =
          installed.skillId ??
          installed.snapshot.skills.find((skill) => skill.slug === candidate.slug)?.id ??
          skillId;
      }

      const skillIds = selectedBuild.skillIds.includes(targetId)
        ? selectedBuild.skillIds.filter((held) => held !== targetId)
        : [...selectedBuild.skillIds, targetId];
      const isActive = snapshot?.activeBuildId === selectedBuild.id;
      const saved = await runMutation(
        `toggle:${skillId}`,
        () =>
          window.electronAPI.agentSkills.saveBuild({
            buildId: selectedBuild.id,
            name: selectedBuild.name,
            skillIds,
          }),
        null,
      );
      // `saveBuild` only records the build; it does not touch what is enabled
      // on disk. Editing the active build would therefore leave the providers
      // holding the previous set, so re-apply it here to keep them honest.
      if (saved?.success && isActive) {
        await runMutation(
          `toggle:${skillId}`,
          () => window.electronAPI.agentSkills.applyBuild({ buildId: selectedBuild.id }),
          null,
        );
      }
    },
    [runMutation, selectedBuild, skills, snapshot],
  );

  /** Deleting a build is destructive and unlabelled once gone: ask first. */
  const confirmDeleteBuild = React.useCallback(
    async (build: AgentSkillBuild) => {
      const result = await window.electronAPI.dialog.showMessageBox({
        type: "warning",
        title: "Delete build",
        message: `Delete “${build.name}”?`,
        detail:
          "The build is removed. The skills in it stay installed, and nothing is turned on or off by deleting it.",
        buttons: ["Delete", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (result.response !== 0) return;
      const mutation = await runMutation(
        `delete:${build.id}`,
        () => window.electronAPI.agentSkills.deleteBuild({ buildId: build.id }),
        "Build deleted",
      );
      // The hub renders nothing without a selection, so hand the page to a
      // surviving build rather than leaving it blank on the one just deleted.
      if (mutation?.success) {
        setSelectedBuildId((current) =>
          current === build.id
            ? (mutation.snapshot.activeBuildId ?? mutation.snapshot.builds[0]?.id ?? null)
            : current,
        );
        setOpenDetail(null);
      }
    },
    [runMutation],
  );

  const saveDraft = React.useCallback(async () => {
    const result = await runMutation(
      "save",
      () =>
        window.electronAPI.agentSkills.saveBuild({
          name: draftName,
          skillIds: draftSkillIds,
        }),
      "Build saved",
    );
    if (result?.success) {
      if (result.skillId) setSelectedBuildId(result.skillId);
      setIsEditing(false);
    }
  }, [draftName, draftSkillIds, runMutation]);

  return (
    <div
      style={HUB_TOKENS}
      className={cn(
        "relative flex h-full min-h-0 flex-col",
        // The lit field is the page, not a panel inside it: it rises toward
        // the middle and falls away at the edges, which is what makes the
        // plates sitting on it read as raised.
        "bg-[radial-gradient(120%_95%_at_50%_40%,color-mix(in_oklch,var(--foreground)_7%,var(--background))_0%,var(--background)_62%)]",
        "after:pointer-events-none after:absolute after:inset-0 after:z-[4] after:content-['']",
        "after:bg-[radial-gradient(76%_64%_at_50%_46%,transparent_46%,color-mix(in_oklch,var(--foreground)_7%,transparent)_100%)]",
      )}
    >
      <div className="relative z-[5] mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-8 pt-6 pb-5 sm:px-10">
        {loadError ? (
          <p className="p-6 text-sm text-destructive">{loadError}</p>
        ) : isEditing ? (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl border border-border/50 bg-card/40">
            <BuildEditor
              name={draftName}
              skillIds={draftSkillIds}
              allSkills={skills}
              busy={busyKey === "save"}
              onNameChange={setDraftName}
              onSetSkillIds={setDraftSkillIds}
              onToggleSkill={(id) =>
                setDraftSkillIds((current) =>
                  current.includes(id)
                    ? current.filter((candidate) => candidate !== id)
                    : [...current, id],
                )
              }
              onCancel={() => setIsEditing(false)}
              onSave={() => void saveDraft()}
            />
          </section>
        ) : builds.length === 0 ? (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl border border-border/50 bg-card/40">
            <EmptyBuilds onCreate={() => startEditing()} />
          </section>
        ) : selectedBuild ? (
          <>
            {openDetail ? (
              <DetailSheet
                detail={openDetail}
                candidates={filterPickerSkills(
                  openDetail === "cozea"
                    ? cozeaSkills(skills)
                    : providerCandidates(skills, openDetail),
                  query,
                  null,
                )}
                buildSkillIds={selectedBuild.skillIds}
                busySkillId={busyKey?.startsWith("toggle:") ? busyKey.slice(7) : null}
                onToggle={(skillId) => void toggleBuildSkill(skillId)}
                onOpenSkill={(skillId) => {
                  // Hands off to the skill's own page, which lives on the
                  // library side of this surface and reads the id from the URL.
                  const next = new URLSearchParams(searchParams);
                  next.delete("view");
                  next.set("skill", skillId);
                  setSearchParams(next);
                }}
                onSwitch={(direction) =>
                  setOpenDetail((current) => (current ? stepDetail(current, direction) : current))
                }
                onBack={() => setOpenDetail(null)}
              />
            ) : (
              <ProviderHub
                build={selectedBuild}
                loadout={loadout}
                skills={skills}
                isActive={snapshot?.activeBuildId === selectedBuild.id}
                busyKey={busyKey}
                onOpenProvider={setOpenDetail}
                onOpenShared={() => setOpenDetail("cozea")}
                onOpenAllSkills={() => {
                  const next = new URLSearchParams(searchParams);
                  next.delete("view");
                  setSearchParams(next);
                }}
                onEquip={() =>
                  void runMutation(
                    `apply:${selectedBuild.id}`,
                    () => window.electronAPI.agentSkills.applyBuild({ buildId: selectedBuild.id }),
                    `${selectedBuild.name} activated`,
                  )
                }
              />
            )}

            {/* The strip picks which build you are looking at, which is only
                a question on the hub. Inside a bucket page it is noise, and
                switching builds under an open page would be disorienting. */}
            {openDetail ? null : (
              <BuildStrip
                builds={builds}
                activeBuildId={snapshot?.activeBuildId ?? null}
                selectedBuildId={selectedBuildId}
                busyKey={busyKey}
                onDelete={(build) => void confirmDeleteBuild(build)}
                onSelect={(id) => {
                  setSelectedBuildId(id);
                  setIsEditing(false);
                  setOpenDetail(null);
                }}
                onCreate={() => {
                  setSelectedBuildId(null);
                  startEditing();
                }}
              />
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The hub is laid out in a fixed 900x560 coordinate space and then expressed
 * in percentages, so the whole diagram scales with the pane while the
 * hairlines stay 1px (`vector-effect: non-scaling-stroke`).
 */
const HUB_W = 900;
const HUB_H = 560;

const pctX = (value: number) => `${(value / HUB_W) * 100}%`;
const pctY = (value: number) => `${(value / HUB_H) * 100}%`;

/**
 * One seat in the ring. `d` is drawn in the node's own box, so each silhouette
 * chamfers the corners that face the core — the ring reads as one machined
 * plate rather than four identical cards.
 */
interface HubSlot {
  d: string;
  w: number;
  h: number;
  x: number;
  y: number;
  edge: "top" | "left" | "right" | "bottom";
}

const HUB_SLOTS: HubSlot[] = [
  { edge: "top", w: 300, h: 120, x: 450, y: 68, d: "M40 1 H260 L299 27 V119 H1 V27 Z" },
  { edge: "left", w: 280, h: 132, x: 145, y: 280, d: "M40 1 H279 V101 L239 131 H1 V31 Z" },
  { edge: "right", w: 280, h: 132, x: 755, y: 280, d: "M1 1 H239 L279 31 V131 H41 L1 101 Z" },
  { edge: "bottom", w: 300, h: 120, x: 450, y: 492, d: "M1 1 H299 V93 L260 119 H40 L1 93 Z" },
];

/** Decorative part codes, the way a machined panel carries a stamp. */
const HUB_STAMP = "8W7F1 1A1T1 21TRG";

/**
 * Structure colours are derived from the theme's foreground rather than fixed,
 * so the diagram re-skins with the app instead of carrying its own palette.
 */
const HUB_TOKENS = {
  "--hub-ln": "color-mix(in oklch, var(--foreground) 20%, transparent)",
  "--hub-ln-hi": "color-mix(in oklch, var(--foreground) 45%, transparent)",
  "--hub-fill": "color-mix(in oklch, var(--foreground) 4%, transparent)",
  "--hub-fill-hi": "color-mix(in oklch, var(--foreground) 8%, transparent)",
  "--hub-trace": "color-mix(in oklch, var(--foreground) 15%, transparent)",
  "--hub-micro": "color-mix(in oklch, var(--foreground) 32%, transparent)",
} as React.CSSProperties;

/**
 * The loadout screen: the build at the centre, each provider a plate around it
 * carrying the number of that build's skills it would run, joined by traces.
 * Clicking a plate opens what that provider actually gets.
 */
function ProviderHub({
  build,
  loadout,
  skills,
  isActive,
  busyKey,
  onOpenProvider,
  onOpenShared,
  onOpenAllSkills,
  onEquip,
}: {
  build: AgentSkillBuild;
  loadout: AgentSkillRecord[];
  skills: AgentSkillRecord[];
  isActive: boolean;
  busyKey: string | null;
  onOpenProvider: (provider: AgentSkillProvider) => void;
  onOpenShared: () => void;
  onOpenAllSkills: () => void;
  onEquip: () => void;
}) {
  const counts = providerSkillCounts(loadout);
  const shared = cozeaSkills(loadout);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The build names the page: centred like any page title, with the one
          action that belongs to the whole build parked on the right. No
          status badge — that button already reads "Activated" when active. */}
      <header className="relative flex shrink-0 items-center justify-center px-1 pb-3">
        {/* The way back to the library, mirroring the build action opposite. */}
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-1/2 left-0 -translate-y-1/2"
          onClick={onOpenAllSkills}
        >
          <HugeiconsIcon icon={__LibraryHugeIcon} />
          All skills
        </Button>
        {/* Reserves room for the button on each side, so the title truncates
            instead of running under one on a narrow pane. */}
        <h1 className="max-w-[calc(100%-280px)] truncate text-2xl font-bold tracking-tight text-foreground">
          {build.name}
        </h1>
        <div className="absolute top-1/2 right-0 -translate-y-1/2">
          <Button
            size="sm"
            onClick={onEquip}
            disabled={isActive || busyKey === `apply:${build.id}`}
          >
            {busyKey === `apply:${build.id}`
              ? "Activating…"
              : isActive
                ? "Activated"
                : "Activate build"}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div
          className={cn(
            // Sized by the height it is given, not the width: a fixed-ratio
            // box driven by `w-full` overflows a short pane instead of
            // shrinking (measured: 117px over at a 620px pane). The lit field
            // it used to carry is now the page's, so this box is transparent.
            "relative h-full max-h-[560px] w-auto max-w-full",
            "aspect-[900/560]",
          )}
        >
          <HubTraces />

          {counts.map((node, index) => {
            const slot = HUB_SLOTS[index];
            if (!slot) return null;
            return (
              <ProviderNode
                key={node.provider}
                node={node}
                slot={slot}
                essential={providerEssentialCount(skills, node.provider)}
                onClick={onOpenProvider}
              />
            );
          })}

          {/* The core plate: what every provider carries, on top of the traces. */}
          <button
            type="button"
            onClick={() => onOpenShared()}
            aria-label={`Cozea skills: ${shared.length} carried by every provider`}
            className="group absolute top-1/2 left-1/2 z-[2] aspect-square w-[20.6%] -translate-x-1/2 -translate-y-1/2 cursor-pointer"
          >
            <span
              className={cn(
                "absolute inset-0 rotate-45 rounded-[3px] border border-[var(--hub-ln-hi)] transition-colors",
                "bg-[linear-gradient(150deg,color-mix(in_oklch,var(--foreground)_10%,var(--background)),color-mix(in_oklch,var(--foreground)_3%,var(--background)))]",
                "shadow-[0_0_28px_color-mix(in_oklch,var(--foreground)_8%,transparent)]",
                "group-hover:border-foreground/60",
              )}
            />
            <span className="absolute inset-[12%] rotate-45 rounded-[2px] border border-[var(--hub-ln)] opacity-55" />
            {/* Same arrangement as a provider plate — name, then mark and
                count — so the core reads as one of the family, just bigger. */}
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-[8%]">
              <span className="text-[11px] tracking-[0.16em] text-muted-foreground uppercase transition-colors group-hover:text-foreground">
                Cozea
              </span>
              <span className="flex items-center gap-2.5">
                <Logo size={22} className="shrink-0 opacity-90" />
                <span
                  className={cn(
                    "text-[26px] leading-none font-medium tabular-nums text-foreground",
                    shared.length === 0 && "opacity-45",
                  )}
                >
                  {shared.length}
                </span>
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** Circuit routes from the core out to each plate, drawn behind them. */
function HubTraces() {
  return (
    <svg
      viewBox={`0 0 ${HUB_W} ${HUB_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="absolute inset-0 z-[1] size-full"
    >
      <g stroke="var(--hub-trace)" strokeWidth="1.1" fill="none" vectorEffect="non-scaling-stroke">
        <path d="M450 128 V150" />
        <path d="M436 128 V142 H406" />
        <path d="M464 128 V142 H494" />
        <path d="M450 410 V432" />
        <path d="M436 432 V418 H406" />
        <path d="M464 432 V418 H494" />
        <path d="M285 264 H316" />
        <path d="M285 246 H300 V226" />
        <path d="M285 298 H300 V318" />
        <path d="M615 264 H584" />
        <path d="M615 246 H600 V226" />
        <path d="M615 298 H600 V318" />
        <path d="M300 188 H352 L390 150" />
        <path d="M600 188 H548 L510 150" />
        <path d="M300 374 H352 L390 412" />
        <path d="M600 374 H548 L510 412" />
      </g>
      <g fill="var(--hub-trace)">
        <rect x="402" y="139" width="9" height="5" />
        <rect x="491" y="139" width="9" height="5" />
        <rect x="402" y="415" width="9" height="5" />
        <rect x="491" y="415" width="9" height="5" />
        <rect x="297" y="222" width="5" height="9" />
        <rect x="597" y="222" width="5" height="9" />
        <rect x="297" y="316" width="5" height="9" />
        <rect x="597" y="316" width="5" height="9" />
      </g>
    </svg>
  );
}

function ProviderNode({
  node,
  slot,
  essential,
  onClick,
}: {
  node: { provider: AgentSkillProvider; label: string; count: number };
  slot: HubSlot;
  essential: number;
  onClick: (provider: AgentSkillProvider) => void;
}) {
  const isEmpty = node.count === 0;
  const stampVertical = slot.edge === "left" || slot.edge === "right";

  return (
    <button
      type="button"
      onClick={() => onClick(node.provider)}
      aria-label={`${node.label}: ${node.count} skills in this build`}
      style={{
        left: pctX(slot.x),
        top: pctY(slot.y),
        width: pctX(slot.w),
        height: pctY(slot.h),
      }}
      className="group absolute z-[2] -translate-x-1/2 -translate-y-1/2 cursor-pointer"
    >
      <svg
        viewBox={`0 0 ${slot.w} ${slot.h}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        className="absolute inset-0 size-full drop-shadow-[0_0_10px_color-mix(in_oklch,var(--foreground)_5%,transparent)]"
      >
        <path
          d={slot.d}
          fill="var(--hub-fill)"
          stroke="var(--hub-ln)"
          strokeWidth="1.25"
          vectorEffect="non-scaling-stroke"
          className="transition-[fill,stroke] duration-150 group-hover:fill-[var(--hub-fill-hi)] group-hover:stroke-[var(--hub-ln-hi)]"
        />
      </svg>

      <span className="absolute inset-0 flex flex-col items-center justify-center gap-2">
        <span className="text-[11px] tracking-[0.16em] text-muted-foreground uppercase transition-colors group-hover:text-foreground">
          {node.label}
        </span>
        <span className="flex items-center gap-2.5">
          <ProviderMark provider={node.provider} />
          <span
            className={cn(
              "text-[22px] leading-none font-medium tabular-nums text-foreground",
              isEmpty && "opacity-45",
            )}
          >
            {node.count}
          </span>
          {/* Always on, whatever the build holds, so it is shown apart from
              the count rather than folded into it. */}
          {essential > 0 ? (
            <span
              className="text-[12px] leading-none tabular-nums text-muted-foreground"
              title={`${essential} essential ${essential === 1 ? "skill" : "skills"} always on`}
            >
              +{essential}
            </span>
          ) : null}
        </span>
      </span>

      {/* A clip straddling the edge that faces the core, and a stamped code. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute border border-[var(--hub-ln)] bg-background opacity-90",
          slot.edge === "top" && "bottom-[-4px] left-[42%] h-[7px] w-[16%]",
          slot.edge === "bottom" && "top-[-4px] left-[42%] h-[7px] w-[16%]",
          slot.edge === "left" && "top-[42%] right-[-4px] h-[22px] w-[8px]",
          slot.edge === "right" && "top-[42%] left-[-4px] h-[22px] w-[8px]",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "absolute font-mono text-[6.5px] leading-none tracking-[0.1em] whitespace-nowrap text-[var(--hub-micro)]",
          slot.edge === "right" ? "right-[15%]" : "left-[15%]",
          slot.edge === "bottom" ? "bottom-[-10px]" : "top-[-9px]",
        )}
      >
        {stampVertical ? HUB_STAMP : "8W7F1 1A1T1"}
      </span>
    </button>
  );
}

/** The provider's own mark, beside its count on the plate. */
function ProviderMark({ provider }: { provider: AgentSkillProvider }) {
  const Mark = BUILD_PROVIDER_ICONS[provider];
  return (
    <Mark
      aria-hidden
      className="size-[18px] shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
    />
  );
}

/** The A/D ring: the core, then the agents, in the order the hub draws them. */
const DETAIL_RING: Array<AgentSkillProvider | "cozea"> = ["cozea", ...BUILD_PROVIDER_ORDER];

export function stepDetail(
  current: AgentSkillProvider | "cozea",
  direction: -1 | 1,
): AgentSkillProvider | "cozea" {
  const index = DETAIL_RING.indexOf(current);
  const next = (index + direction + DETAIL_RING.length) % DETAIL_RING.length;
  return DETAIL_RING[next]!;
}

/**
 * A bucket's page: every skill that bucket holds, grouped by category, with a
 * tick for the ones this build carries.
 *
 * The candidates are the whole installed library filtered to this bucket, not
 * just what the build already holds; otherwise an empty plate would open onto
 * an empty page with nothing to add.
 */
function DetailSheet({
  detail,
  candidates,
  buildSkillIds,
  busySkillId,
  onToggle,
  onOpenSkill,
  onSwitch,
  onBack,
}: {
  detail: AgentSkillProvider | "cozea";
  candidates: AgentSkillRecord[];
  buildSkillIds: readonly string[];
  busySkillId: string | null;
  onToggle: (skillId: string) => void;
  onOpenSkill: (skillId: string) => void;
  onSwitch: (direction: -1 | 1) => void;
  onBack: () => void;
}) {
  const isShared = detail === "cozea";
  const chosen = new Set(buildSkillIds);
  // Essential skills are always on and cannot be chosen, so they sit out of
  // the categories and the counts, in their own section at the end.
  const { choosable, essential } = partitionEssential(candidates);
  const groups = loadoutByCategory(choosable);
  const inBuild = choosable.filter((skill) => chosen.has(skill.id)).length;
  const Mark = isShared ? null : BUILD_PROVIDER_ICONS[detail];
  const title = isShared ? "Cozea" : BUILD_PROVIDER_LABELS[detail];

  // A and D walk the ring, the way the reference screen pages between
  // attributes. Ignored while typing so it cannot fight a text field.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      if (key !== "a" && key !== "d") return;
      event.preventDefault();
      onSwitch(key === "a" ? -1 : 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSwitch]);

  return (
    <div style={HUB_TOKENS} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="relative flex shrink-0 items-center justify-center gap-4 px-5 pt-3 pb-3">
        {/* Back and the tally are pinned to opposite ends so neither can
            land on the other, leaving the middle free for the agent. */}
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-1/2 left-1 h-7 -translate-y-1/2 px-2"
          onClick={onBack}
        >
          <HugeiconsIcon icon={__ArrowLeftHugeIcon} />
          Back
        </Button>

        <RingKey label="A" onClick={() => onSwitch(-1)} />
        <span className="flex items-center gap-2.5">
          {Mark ? (
            <Mark aria-hidden className="size-[18px] shrink-0 text-muted-foreground" />
          ) : (
            <Logo size={18} className="shrink-0 opacity-90" />
          )}
          <h2 className="text-[15px] tracking-[0.17em] text-foreground uppercase">{title}</h2>
          <span className="text-[13px] leading-none tabular-nums text-muted-foreground">
            <span className="font-medium text-foreground">{inBuild}</span>/{choosable.length}
          </span>
        </span>
        <RingKey label="D" onClick={() => onSwitch(1)} />

        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-[var(--hub-ln)]" />
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-1/2 h-0.5 w-[210px] -translate-x-1/2 bg-foreground/55"
        />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-1 pb-6">
        {choosable.length === 0 && essential.length === 0 ? (
          <p className="mx-auto max-w-sm py-12 text-center text-sm leading-6 text-muted-foreground">
            {isShared
              ? "Your library is empty. Skills you create or import into Cozea appear here."
              : `${BUILD_PROVIDER_LABELS[detail as AgentSkillProvider]} has no skills of its own yet. Skills from your library are listed on the Cozea page.`}
          </p>
        ) : null}

        {groups.map((group) => {
          const held = group.skills.filter((skill) => chosen.has(skill.id)).length;
          return (
            <section key={group.category} className="pt-5 first:pt-2">
              {/* Plain type, no frame: the hub carries the drawn structure,
                  and a page of lists is easier to read without it. */}
              <div className="flex items-baseline gap-2 pb-1.5">
                <h3 className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                  {group.label}
                </h3>
                <span className="text-[10px] tabular-nums text-muted-foreground/60">
                  {held}/{group.skills.length}
                </span>
              </div>

              <ul className="grid gap-0.5 sm:grid-cols-2">
                {group.skills.map((skill) => {
                  const isChosen = chosen.has(skill.id);
                  return (
                    <li key={skill.id} className="min-w-0">
                      {/* Two controls, not one: the box decides whether the
                          build carries the skill, the rest opens its page. */}
                      <div
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors",
                          isChosen
                            ? "bg-foreground/[0.07] hover:bg-foreground/[0.1]"
                            : "hover:bg-foreground/[0.04]",
                        )}
                      >
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={isChosen}
                          aria-label={`${isChosen ? "Remove" : "Add"} ${prettifySkillName(skill.name)}`}
                          disabled={busySkillId === skill.id}
                          onClick={() => onToggle(skill.id)}
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                            "focus-visible:ring-ring/50 focus-visible:ring-2 focus-visible:outline-none",
                            "disabled:pointer-events-none disabled:opacity-60",
                            isChosen
                              ? "border-transparent bg-foreground text-background"
                              : "border-border hover:border-foreground/50",
                          )}
                        >
                          {isChosen ? (
                            <HugeiconsIcon icon={__TickHugeIcon} className="size-3" />
                          ) : null}
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenSkill(skill.id)}
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:ring-ring/50 focus-visible:rounded-md focus-visible:ring-2 focus-visible:outline-none"
                        >
                          <SkillMark name={skill.name} lit={isChosen} />
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                "block truncate text-[13px] font-medium transition-colors",
                                isChosen ? "text-foreground" : "text-muted-foreground",
                              )}
                            >
                              {prettifySkillName(skill.name)}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/80">
                              {conciseDescription(skill.description)}
                            </span>
                          </span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}

        {essential.length > 0 ? (
          <section className="pt-6">
            <div className="flex items-baseline gap-2 pb-1.5">
              <h3 className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                Essential
              </h3>
              <span className="text-[10px] tabular-nums text-muted-foreground/60">
                {essential.length}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Why these cannot be switched off"
                    className="flex size-4 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground"
                  >
                    <HugeiconsIcon icon={__InfoHugeIcon} className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {ESSENTIAL_SKILL_NOTE}
                </TooltipContent>
              </Tooltip>
            </div>

            <ul className="grid gap-0.5 sm:grid-cols-2">
              {essential.map((skill) => (
                <li key={skill.id} className="min-w-0">
                  <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-foreground/[0.04]">
                    {/* No tick: the provider restores these, so a build cannot
                        promise to turn one off. */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          tabIndex={0}
                          role="note"
                          aria-label={ESSENTIAL_SKILL_NOTE}
                          className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70"
                        >
                          <HugeiconsIcon icon={__InfoHugeIcon} className="size-3.5" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {ESSENTIAL_SKILL_NOTE}
                      </TooltipContent>
                    </Tooltip>
                    <button
                      type="button"
                      onClick={() => onOpenSkill(skill.id)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:ring-ring/50 focus-visible:rounded-md focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <SkillMark name={skill.name} lit={false} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-muted-foreground">
                          {prettifySkillName(skill.name)}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/80">
                          {conciseDescription(skill.description)}
                        </span>
                      </span>
                    </button>
                    <span className="shrink-0 text-[9px] tracking-[0.16em] text-muted-foreground/60 uppercase">
                      Essential
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A skill's stand-in image. Skills ship no artwork, so this is a monogram on a
 * chamfered plate, cut the same way as the hub's.
 */
function SkillMark({ name, lit }: { name: string; lit: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex size-7 shrink-0 items-center justify-center border transition-colors",
        "[clip-path:polygon(0_0,calc(100%-6px)_0,100%_6px,100%_100%,6px_100%,0_calc(100%-6px))]",
        lit
          ? "border-[var(--hub-ln-hi)] bg-[var(--hub-fill-hi)] text-foreground"
          : "border-[var(--hub-ln)] bg-[var(--hub-fill)] text-muted-foreground",
      )}
    >
      <span className="text-[10px] leading-none font-medium tracking-[0.04em]">
        {skillMonogram(name)}
      </span>
    </span>
  );
}

/** The bracketed A / D keys that page between agents. */
function RingKey({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label === "A" ? "Previous agent" : "Next agent"}
      className="flex h-[22px] min-w-[26px] items-center justify-center rounded-[4px] border border-[var(--hub-ln)] px-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-[var(--hub-ln-hi)] hover:text-foreground"
    >
      {label}
    </button>
  );
}

/** Shared chrome for the small actions that sit on a build card. */
const CARD_ACTION_CLASS = cn(
  "flex size-6 items-center justify-center rounded-md text-muted-foreground",
  "transition-colors focus-visible:ring-ring/50 focus-visible:ring-2 focus-visible:outline-none",
  "disabled:pointer-events-none disabled:opacity-40",
);

function BuildStrip({
  builds,
  activeBuildId,
  selectedBuildId,
  busyKey,
  onSelect,
  onCreate,
  onDelete,
}: {
  builds: AgentSkillBuild[];
  activeBuildId: string | null;
  selectedBuildId: string | null;
  busyKey: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (build: AgentSkillBuild) => void;
}) {
  const trackRef = React.useRef<HTMLDivElement | null>(null);

  const nudge = (direction: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * Math.max(track.clientWidth * 0.6, 200), behavior: "smooth" });
  };

  return (
    <div style={HUB_TOKENS} className="relative shrink-0 pt-3">
      <Button
        variant="outline"
        size="icon-xl"
        aria-label="Previous builds"
        onClick={() => nudge(-1)}
        className="absolute top-1/2 left-0 z-10 size-9 -translate-y-1/2 rounded-full border-border bg-popover shadow-md sm:size-9 dark:bg-popover"
      >
        <HugeiconsIcon icon={__ArrowLeftHugeIcon} className="size-4" />
      </Button>
      <Button
        variant="outline"
        size="icon-xl"
        aria-label="More builds"
        onClick={() => nudge(1)}
        className="absolute top-1/2 right-0 z-10 size-9 -translate-y-1/2 rounded-full border-border bg-popover shadow-md sm:size-9 dark:bg-popover"
      >
        <HugeiconsIcon icon={__ArrowRightHugeIcon} className="size-4" />
      </Button>

      <div
        ref={trackRef}
        className="flex gap-2 overflow-x-auto px-11 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {builds.map((build) => {
          const isSelected = build.id === selectedBuildId;
          return (
            // A card is two controls: select the build, or bin it. Nesting a
            // button inside a button is invalid, so the plate is the select
            // and the trash sits over it.
            <div key={build.id} className="group relative w-[158px] shrink-0">
            <button
              type="button"
              onClick={() => onSelect(build.id)}
              aria-current={isSelected ? "true" : undefined}
              className="relative flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left"
            >
              {/* Same chamfered plate as the hub, at card scale. */}
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-0 border transition-colors",
                  "[clip-path:polygon(0_0,calc(100%-10px)_0,100%_10px,100%_100%,10px_100%,0_calc(100%-10px))]",
                  isSelected
                    ? "border-[var(--hub-ln-hi)] bg-[var(--hub-fill-hi)]"
                    : "border-[var(--hub-ln)] bg-[var(--hub-fill)] group-hover:border-[var(--hub-ln-hi)]",
                )}
              />
              {/* Lit top edge: the selected build reads as the powered one. */}
              {isSelected ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-3 top-0 h-px bg-foreground/55"
                />
              ) : null}
              <span
                className={cn(
                  "relative w-full min-w-0 truncate text-[12.5px] font-medium transition-colors",
                  isSelected ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
                )}
              >
                {build.name}
              </span>
              <span className="relative flex items-center gap-1 text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
                {build.skillIds.length}
                {build.id === activeBuildId ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-success">Activated</span>
                  </>
                ) : null}
              </span>
            </button>
            {/* Deleting a build belongs to the build, not the page header.
                Hidden until the card is under the pointer; keyboard focus
                always brings it back. */}
            <span
              className={cn(
                "absolute right-1.5 bottom-1.5 z-10 flex items-center gap-0.5 rounded-md",
                // Opaque, because the cluster sits over the card's count row.
                "bg-background/90 transition-opacity",
                "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
              )}
            >
              <button
                type="button"
                onClick={() => onDelete(build)}
                disabled={busyKey === `delete:${build.id}`}
                aria-label={`Delete ${build.name}`}
                title={`Delete ${build.name}`}
                className={cn(CARD_ACTION_CLASS, "hover:bg-destructive/12 hover:text-destructive")}
              >
                <HugeiconsIcon icon={__DeleteHugeIcon} className="size-3.5" />
              </button>
            </span>
            </div>
          );
        })}
        <button
          type="button"
          onClick={onCreate}
          className="flex w-[158px] shrink-0 items-center justify-center gap-1.5 border border-dashed border-[var(--hub-ln)] px-3 py-2.5 text-[11.5px] text-muted-foreground transition-colors [clip-path:polygon(0_0,calc(100%-10px)_0,100%_10px,100%_100%,10px_100%,0_calc(100%-10px))] hover:border-[var(--hub-ln-hi)] hover:text-foreground"
        >
          <HugeiconsIcon icon={__AddHugeIcon} className="size-3.5" />
          New build
        </button>
      </div>
    </div>
  );
}

function BuildEditor({
  name,
  skillIds,
  allSkills,
  busy,
  onNameChange,
  onSetSkillIds,
  onToggleSkill,
  onCancel,
  onSave,
}: {
  name: string;
  skillIds: string[];
  allSkills: AgentSkillRecord[];
  busy: boolean;
  onNameChange: (value: string) => void;
  onSetSkillIds: (ids: string[]) => void;
  onToggleSkill: (id: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState<string | null>(null);

  const chosen = new Set(skillIds);
  const categories = React.useMemo(() => loadoutByCategory(allSkills), [allSkills]);
  const visible = React.useMemo(
    () => filterPickerSkills(allSkills, query, category),
    [allSkills, category, query],
  );
  const groups = React.useMemo(() => loadoutByCategory(visible), [visible]);

  return (
    <>
      <header className="flex shrink-0 items-center gap-3 rounded-t-2xl border-b border-border/50 bg-foreground/[0.05] px-5 py-3">
        <Input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="Name this build"
          autoFocus
          className="h-8 max-w-xs"
        />
        <span className="text-[11px] text-muted-foreground/70">{skillIds.length} selected</span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSave} disabled={busy}>
            {busy ? "Saving…" : "Save build"}
          </Button>
        </div>
      </header>

      <div className="shrink-0 space-y-2.5 border-b border-border/40 px-5 py-3">
        <div className="relative">
          <HugeiconsIcon
            icon={__SearchHugeIcon}
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground/70"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search skills to add..."
            className="h-9 pl-9"
          />
        </div>

        {/* Browsing by category beats scrolling 39 skills looking for one. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <CategoryChip
            label="All"
            count={allSkills.length}
            isActive={category === null}
            onClick={() => setCategory(null)}
          />
          {categories.map((group) => (
            <CategoryChip
              key={group.category}
              label={group.label}
              count={group.skills.length}
              isActive={category === group.category}
              onClick={() => setCategory(category === group.category ? null : group.category)}
            />
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {groups.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No matching skills.</p>
        ) : (
          groups.map((group) => {
            const ids = group.skills.map((skill) => skill.id);
            const allChosen = ids.every((id) => chosen.has(id));
            return (
              <div key={group.category} className="mb-4 last:mb-0">
                <div className="flex items-center justify-between gap-3 px-2 pb-1.5">
                  <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                    {group.label}
                  </h3>
                  <button
                    type="button"
                    onClick={() => onSetSkillIds(toggleCategorySelection(skillIds, ids))}
                    className="text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
                  >
                    {allChosen ? "Clear" : "Select all"}
                  </button>
                </div>
                <ul>
                  {group.skills.map((skill) => {
                    const isChosen = chosen.has(skill.id);
                    return (
                      <li key={skill.id}>
                        <button
                          type="button"
                          aria-pressed={isChosen}
                          onClick={() => onToggleSkill(skill.id)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                            isChosen
                              ? "border-transparent bg-foreground/[0.08] text-foreground"
                              : "border-transparent text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                          )}
                        >
                          <span
                            className={cn(
                              "flex size-4 shrink-0 items-center justify-center rounded border",
                              isChosen
                                ? "border-transparent bg-foreground text-background"
                                : "border-border",
                            )}
                          >
                            {isChosen ? (
                              <HugeiconsIcon icon={__TickHugeIcon} className="size-3" />
                            ) : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {prettifySkillName(skill.name)}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/70">
                              {conciseDescription(skill.description)}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

function CategoryChip({
  label,
  count,
  isActive,
  onClick,
}: {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
        isActive
          ? "border-transparent bg-foreground/12 font-medium text-foreground"
          : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground",
      )}
    >
      {label}
      <span className="tabular-nums opacity-60">{count}</span>
    </button>
  );
}

function EmptyBuilds({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <HugeiconsIcon icon={__FlashHugeIcon} className="size-7 text-muted-foreground/50" />
      <div>
        <p className="text-sm font-medium text-foreground">No builds yet</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          A build is a named set of skills. Activate one and Cozea turns those on and
          everything else off.
        </p>
      </div>
      <Button size="sm" onClick={onCreate}>
        <HugeiconsIcon icon={__AddHugeIcon} />
        Create your first build
      </Button>
    </div>
  );
}

export default SkillBuildsView;
